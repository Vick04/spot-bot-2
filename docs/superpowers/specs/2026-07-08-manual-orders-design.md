# Manual buy orders, liquidity-based sizing, and an Orders view

## Problem

Add a manual, per-card "buy" action to the live signal detector: each chart
card gets a footer showing the current price, a hypothetical target
(current price × 1.005), the USDT amount a buy would use right now, and a
Buy button. Clicking it opens a real (simulated) order against a shared
hypothetical balance; the order auto-completes (sells) the moment price
reaches its target — no stop-loss, no manual cancel, no time limit. Multiple
orders can be open concurrently, one per symbol. A new tab switches from the
chart grid to an Orders view showing active orders, with a header reporting
completed-order count and realized performance.

This also reinstates liquidity-based order sizing
(`docs/superpowers/specs/2026-07-03-liquidity-order-sizing-design.md`, never
actually built before the whole order system was deleted): order size is
capped by a fraction of the symbol's 24h quote volume, not a flat amount.

## Order model

- **Balance**: single shared pool, starts at **10,000 USDT**, in memory only
  (resets on backend restart, same as all other server state in this app).
- **Concurrency**: multiple active orders at once, **one per symbol** — a
  symbol with an active order cannot be bought again until that order
  completes.
- **Sizing**: `orderSize = min(availableBalance, quoteVolume24h × LIQUIDITY_FACTOR, MAX_ORDER_USDT)`,
  where `availableBalance` is the balance not already tied up in other active
  orders. `LIQUIDITY_FACTOR = 0.0001`, `MAX_ORDER_USDT = 10_000`. If
  `orderSize <= 0`, the symbol cannot be bought (Buy button reflects this).
- **Fees**: 0.1% on buy (deducted from the asset quantity received) and 0.1%
  on sell (deducted from the USDT received) — same convention as the
  deleted `OrderManager`.
- **Target**: `buyPrice × 1.005`, fixed at buy time.
- **Completion**: purely price-driven — the moment a symbol's live price
  (the same 1s-tick price driving signal detection) reaches or exceeds its
  active order's target, it sells automatically. **No stop-loss, no manual
  cancel** — an order can stay active indefinitely if price never reaches
  target.
- **Performance metric** ("rendimiento actual"): computed **only over
  completed orders** — `(Σ profit) / (Σ usdtSpent) × 100` across all
  completed orders. Active (unrealized) orders are excluded. `0` when there
  are no completed orders yet.

## Liquidity data pipeline (24h quote volume)

Reimplements the prior design, adapted for this app's current shape:

- `Candle` gains `quoteVolume?: number` — quote-asset volume of that candle
  (only meaningful for 1m candles here; absent elsewhere).
  - **Live**: `binanceWebSocket.ts` parses the kline event's `k.q` field into
    `candle.quoteVolume`.
  - **Historical**: `historicalCandles.ts`'s `parseRow` reads Binance's kline
    REST row index 7 (`quoteAssetVolume`) into `quoteVolume`.
- **Rolling 24h window**: `Observer` gains a `Queue<number>(1440)` (1 value
  per closed 1m candle over 24h) plus a running sum (same O(1) pattern as
  the existing MA99 sum) — updated in `updateCandle1m` when a 1m candle
  closes, pushing `candle.quoteVolume ?? 0`. `get24hQuoteVolume(): number`
  returns the running sum. Below a full 1440-candle window, this
  **underestimates** the true 24h volume — acceptable and self-correcting
  as live data accumulates (same tradeoff the prior design accepted).
- **Preload**: `historicalCandles.ts`'s `fetchHistoricalCandles` gains
  pagination — Binance's kline endpoint caps `limit` at 1000, so fetching
  1440 candles takes 2 requests, paging backward via `endTime`. `BotManager`
  fetches **1440** 1m candles per symbol at startup (one paginated fetch),
  using the most recent **200** of them for the existing chart/detection
  buffer (unchanged size) and **all 1440** for the new volume window. This
  replaces the previous single 200-candle, single-request preload — same
  parallelism (`Promise.allSettled` across symbols), just a larger,
  possibly-2-request fetch per symbol.
- `utils/orderSize.ts` (new): `computeOrderSize(availableBalance, quoteVolume24h, { factor, maxUsdt }): number`
  = `Math.max(0, Math.min(availableBalance, quoteVolume24h * factor, maxUsdt))`
  — a pure function, backend-only (the frontend never computes this itself;
  see API below).

## Backend: `OrderManager`

New class (not a resurrection of the deleted one — the model is
fundamentally different: multiple concurrent orders, no auto-buy signal
tie-in, no stop-loss).

- State: `balance: number`, `activeOrders: Map<symbol, ActiveOrder>`,
  `completedOrders: CompletedOrder[]`.
- `ActiveOrder { symbol, buyPrice, targetPrice, quantity, usdtSpent, openedAt }`.
- `CompletedOrder` extends `ActiveOrder` with `{ sellPrice, usdtReceived, profit, profitPct, closedAt, durationMs }`.
- `hasActiveOrder(symbol): boolean`.
- `computeOrderSize(quoteVolume24h): number` — delegates to `utils/orderSize.ts` using the current balance.
- `buy(symbol, price, quoteVolume24h): ActiveOrder | null` — `null` if the
  symbol already has an active order, or if the computed order size is
  `<= 0`. Otherwise opens the order, deducts `usdtSpent` from balance, emits
  `'opened'`.
- `onPriceTick(symbol, price): void` — if the symbol has an active order and
  `price >= order.targetPrice`, completes it (moves to `completedOrders`,
  credits `usdtReceived` to balance), emits `'completed'`.
- `getStatus(): { balance, activeOrders: ActiveOrder[], completedCount, totalProfitPct }`.

**Wiring**: `BotManager`'s existing `ws.on('candle', ...)` handler, which
already calls `observerManager.updateCandle(candle)`, additionally calls
`orderManager.onPriceTick(candle.symbol, candle.close)` whenever
`candle.timeframe === '1s'` — same tick source signal detection already
uses, so "current price" is identical across both systems.

`ObserverManager` gains two passthrough getters `OrderManager`'s wiring code
needs: `getCurrentPrice(symbol): number | null` and
`getQuoteVolume24h(symbol): number | null` (both delegate to a new public
`Observer.getCurrentPrice()` — `currentPrice` was private — and the new
`Observer.get24hQuoteVolume()`).

## Backend: REST + socket

- `POST /api/orders/buy` — body `{ symbol }`. Looks up the symbol's current
  price and 24h quote volume via `ObserverManager`; 404 if the symbol isn't
  tracked. Calls `orderManager.buy(...)`; 400 if it returns `null` (already
  active, or order size is 0). 200 with the new `ActiveOrder` on success.
- `GET /api/orders` — `{ data: OrderStatus }`, the full snapshot (balance,
  active orders, completed count, performance) — used for the Orders view's
  initial load and as a REST fallback.
- `GET /api/orders/sizes?symbols=A,B,C` — batched, on-demand order-size
  **preview** for a set of symbols (used by chart-card footers, which poll
  this periodically rather than needing a live push — order size only
  changes on a buy/sell anywhere, or a 1m candle close per symbol, neither
  frequent enough to justify per-tick broadcasting). Returns
  `{ data: { balance: number, sizes: Record<string, number> } }`; unknown
  symbols map to `0`.
- Socket: `createSocketServer` gains an `orderManager` parameter.
  - Initial `'snapshot'` payload gains `orders: OrderStatus`.
  - `'order:opened'` — `{ order: ActiveOrder, balance: number }`, forwarded
    from `OrderManager`'s `'opened'` event.
  - `'order:completed'` — `{ order: CompletedOrder, balance: number, completedCount: number, totalProfitPct: number }`,
    forwarded from `'completed'`.

## Frontend

### Types

Mirror (field-for-field, same convention as every other wire type in this
app) `ActiveOrder`, `CompletedOrder`, `OrderStatus`, `OrderOpenedEvent`,
`OrderCompletedEvent` into `frontend/src/types/index.ts`.

### `useOrders()` hook

New hook, same shape as `useSocket()`: fetches `GET /api/orders` on mount
for initial state, subscribes to the shared socket's `'order:opened'` /
`'order:completed'` events to stay live. Returns
`{ balance, activeOrders, completedCount, totalProfitPct }`.

### Order-size preview

A lightweight hook (or logic inside `ChartGrid`) polls
`GET /api/orders/sizes?symbols=...` every few seconds for the currently
*rendered* symbols only (qualifying + pinned), passing each card its current
`orderSize` and the shared `balance`.

### Card footer

Each `SymbolChartCard` gains a footer row: current price, target
(`currentPrice × 1.005`), and the symbol's current `orderSize` — all at the
same 6-decimal precision as the chart's price axis. If the symbol has **no**
active order: a **Buy** button (disabled if `orderSize <= 0`). If it **has**
an active order: the button is replaced by a compact "active" indicator
(buy price, target) — no button, since a symbol can't be bought twice.

To avoid opening a second socket subscription for the same symbol/timeframe
just to read the current price, `SymbolChartCard` now calls
`useSymbolChartData(symbol, timeframe)` itself and passes `candles`/`series`
down to `SymbolChart` as props (today `SymbolChart` calls the hook
internally) — the footer reads the current price off the last candle's
close from that same call.

Buying: the button POSTs `/api/orders/buy`; no optimistic UI update — the
`'order:opened'` socket event (via `useOrders()`, consumed higher up and
passed down) is what actually flips the footer to the "active" state.

### Tabs + Orders view

`App.tsx` gains simple tab state (`'charts' | 'orders'`) with two header
buttons, rendering `ChartGrid` or a new `OrdersView` accordingly.

`OrdersView`: header line — completed count, performance %, current
balance (all from `useOrders()`). Body: a simple table of **active** orders
(symbol, buy price, target, time open) — no per-order charts, no completed-
orders list (the header's aggregate numbers cover that).

## Out of scope

- No stop-loss, no manual order cancellation.
- No persistence across backend restarts.
- No completed-orders history list/table (only the aggregate count/%).
- No changes to signal detection or the qualifying-list logic — this is a
  fully independent, manually-triggered system layered on top.
