# ZigZag-driven automatic trading — design

## Problem

The app currently qualifies symbols via a sticky per-timeframe step1/step2 state machine (close ≤ lower band → close ≥ ma20), displayed in "Ready"/"Watching" sections, with **manual** buying (a Buy button) and **automatic** selling at a fixed +0.5% target price. This replaces that entire activation mechanism with a ZigZag pivot detector: the Observer confirms local minima and maxima directly from price action, and the bot **automatically buys on a confirmed minimum and sells on a confirmed maximum** — no manual action, no fixed target price.

This is sub-project 1 of 2. Sub-project 2 (separate spec/plan, later) rebuilds the emulator — deleted on 2026-07-06 — to backtest this logic against the existing `history/BTCUSDT/` CSV data before running it live.

The architecture is generic (any symbol could use it), but only `BTCUSDT` is enabled for now via a config constant, per the "test with BTC first" requirement.

## ZigZag algorithm

Pure function, no side effects, in `backend/src/utils/zigzag.ts` — same shape as `backend/src/utils/signals.ts`'s `nextTimeframeSignal()`.

### Types (in `backend/src/types/index.ts`, mirroring the existing convention where `signals.ts` imports its types from there)

```ts
export type PivotType = 'min' | 'max';

export interface Pivot {
  price: number;
  type: PivotType;
}

export interface ZigZagState {
  direction: 'up' | 'down' | null;
  // Cold-start only (direction === null): two independent running
  // candidates tracked simultaneously until one deviates enough to decide
  // the initial direction. Meaningless once direction is set.
  pendingHigh: number;
  pendingHighBars: number;
  pendingLow: number;
  pendingLowBars: number;
  // Meaningful once direction !== null:
  extremePrice: number;
  barsSinceExtreme: number;
  lastPivot: Pivot | null;
}
```

### Constants (in `zigzag.ts`, not exported — same pattern as `signals.ts`'s unexported `WINDOW`)

```ts
const DEVIATION_PCT = 1;              // % retrace required to confirm a pivot
const MIN_BARS_BETWEEN_PIVOTS = 20;   // candles required between the extreme and its confirmation
const PRICE_SOURCE: 'close' | 'highLow' = 'close'; // switch to 'highLow' to use candle high/low instead
const TIMEFRAME: '1m' | '1h' = '1m';  // which Observer buffer drives the ZigZag — to be calibrated via the emulator (sub-project 2)
```

`PRICE_SOURCE` selects two small helpers used everywhere a "high" or "low" reading is needed:

```ts
function priceHigh(c: ZigZagCandle): number { return PRICE_SOURCE === 'close' ? c.close : c.high; }
function priceLow(c: ZigZagCandle): number { return PRICE_SOURCE === 'close' ? c.close : c.low; }
```

where `ZigZagCandle = { high: number; low: number; close: number }` (a `Candle` satisfies this structurally).

### Cold start (`direction === null`)

On the very first candle, both `pendingHigh`/`pendingLow` initialize to that candle's relevant price(s), bar counters at 0. On each subsequent candle, **before** direction is decided:

1. If `priceHigh(candle) > pendingHigh`: `pendingHigh = priceHigh(candle)`, `pendingHighBars = 0`. Else `pendingHighBars += 1`.
2. If `priceLow(candle) < pendingLow`: `pendingLow = priceLow(candle)`, `pendingLowBars = 0`. Else `pendingLowBars += 1`.
3. Check the high-side retrace first (deterministic tie-break if both would fire on the same candle): if `(pendingHigh - priceLow(candle)) / pendingHigh * 100 >= DEVIATION_PCT` **and** `pendingHighBars >= MIN_BARS_BETWEEN_PIVOTS` → confirm `{ price: pendingHigh, type: 'max' }` as the first pivot, set `direction = 'down'`, `extremePrice = priceLow(candle)`, `barsSinceExtreme = 0`. Cold start ends.
4. Otherwise check the low-side retrace: if `(priceHigh(candle) - pendingLow) / pendingLow * 100 >= DEVIATION_PCT` **and** `pendingLowBars >= MIN_BARS_BETWEEN_PIVOTS` → confirm `{ price: pendingLow, type: 'min' }` as the first pivot, set `direction = 'up'`, `extremePrice = priceHigh(candle)`, `barsSinceExtreme = 0`. Cold start ends.
5. Otherwise: still cold-starting, return the updated `pendingHigh`/`pendingLow`/bar-counter state, `direction` still `null`, `lastPivot` still `null`.

### Normal operation (`direction !== null`)

On each candle:

- **`direction === 'up'`**: if `priceHigh(candle) > extremePrice` → `extremePrice = priceHigh(candle)`, `barsSinceExtreme = 0` (still extending, no pivot). Else if `(extremePrice - priceLow(candle)) / extremePrice * 100 >= DEVIATION_PCT` **and** `barsSinceExtreme >= MIN_BARS_BETWEEN_PIVOTS` → confirm `{ price: extremePrice, type: 'max' }`, flip `direction = 'down'`, `extremePrice = priceLow(candle)`, `barsSinceExtreme = 0`. Otherwise: `barsSinceExtreme += 1`, nothing confirmed.
- **`direction === 'down'`**: mirror — extending tracks `priceLow(candle) < extremePrice`; confirming a `'min'` pivot requires `(priceHigh(candle) - extremePrice) / extremePrice * 100 >= DEVIATION_PCT` and the same bar-gap check; flips to `direction = 'up'`.

`lastPivot` is **sticky**: it only changes when a pivot is newly confirmed on that exact call. It never reverts — matching this codebase's established close-only, no-repaint convention (same guarantee `TimeframeSignal.step1`/`step2` already give).

## Observer integration (`backend/src/observers/Observer.ts`)

- New field `private zigzag: ZigZagState`, computed for **every** observer (all 175 symbols) — cheap, and keeps `Observer` generic per the agreed design (activation, not computation, is what's scoped to BTC).
- Recomputed **only** on close of the `TIMEFRAME`-configured buffer (`updateCandle1m`'s or `updateCandle1h`'s `isClosed` branch — whichever matches the constant), never from the 1s tick, mirroring the existing `m1Signal`/`h1Signal` recompute discipline.
- **Replay on preload**: `preloadClosed1m`/`preloadClosed1h` (whichever matches `TIMEFRAME`) replays `nextZigZagState()` candle-by-candle over the ~200 preloaded historical candles, exactly like the existing step1/step2 replay — a restart reconstructs true direction/extreme/last-pivot state instead of starting cold.
- `getState()` returns `{ symbol, performance, zigzag }` — **`qualifies` and `reasons` are removed** from `ObserverState` entirely, along with the `m1Signal`/`h1Signal` fields and the `nextTimeframeSignal` import.
- `backend/src/utils/signals.ts` and `backend/src/utils/signals.test.ts` are **deleted** (dead code — nothing else in the new design uses `TimeframeSignal`/`SignalReasons`).

## `ObserverManager` (`backend/src/managers/ObserverManager.ts`)

- `updateCandle()` already captures `getState()` before and after applying each candle (that's how the existing `reasonsChanged`/`is1hClose` emit gate works today) — this task reuses that exact mechanism instead of adding any new per-symbol memory anywhere:

  ```ts
  const before = observer.getState();
  // ...apply the update (unchanged)...
  const state = observer.getState();

  const pivotChanged = state.zigzag.lastPivot !== null && state.zigzag.lastPivot !== before.zigzag.lastPivot;
  const is1hClose = candle.timeframe === '1h' && candle.isClosed; // unchanged trigger, still drives performance updates

  if (pivotChanged || is1hClose) {
    this.emit('signal', state); // UI-facing: unchanged shape/purpose, just a new trigger condition
  }
  if (pivotChanged) {
    this.emit('pivot', { symbol: candle.symbol, type: state.zigzag.lastPivot!.type, price: state.zigzag.lastPivot!.price }); // NEW: trading-facing
  }
  ```

  The old `reasonsChanged` four-boolean comparison is deleted along with `reasons`/`qualifies`.
- `getQualifyingSymbols()` is deleted (depended on the now-removed `qualifies` field; nothing in the new design needs a "qualifying list" concept).
- `chart:tick`/`chart:closed` emission (gated today on `state.qualifies`) changes its gate to unconditional — chart data should keep flowing regardless of ZigZag/trading state, since the chart is a general-purpose feature orthogonal to this work. (Today's gate exists only because `qualifies` happened to be available as a cheap "is this symbol interesting" filter; removing it just means charts always stream, matching how the REST chart endpoint already works with no such gate.)

## `BotManager` (`backend/src/managers/BotManager.ts`) — the trading wiring

```ts
const ZIGZAG_ENABLED_SYMBOLS = new Set(['BTCUSDT']);
```

In `start()`, after the existing WebSocket `'candle'` subscription, add:

```ts
this.observerManager.on('pivot', ({ symbol, type, price }) => {
  if (!ZIGZAG_ENABLED_SYMBOLS.has(symbol)) return;
  if (type === 'min') {
    const quoteVolume24h = this.observerManager.getQuoteVolume24h(symbol) ?? 0;
    this.orderManager.buy(symbol, price, quoteVolume24h);
  } else {
    this.orderManager.sellAtPrice(symbol, price);
  }
});
```

The existing `if (candle.timeframe === '1s') { this.orderManager.onPriceTick(...) }` line is **removed** — selling is no longer price-tick-driven.

## `OrderManager` (`backend/src/managers/OrderManager.ts`)

- **`onPriceTick()` is deleted.**
- **New method** `sellAtPrice(symbol: string, price: number): void`, replacing the target-check that used to live inside `onPriceTick`:
  ```ts
  sellAtPrice(symbol: string, price: number): void {
    const order = this.activeOrders.get(symbol);
    if (!order) return; // nothing to sell — same guard `onPriceTick` already had
    this.complete(order, price);
  }
  ```
  `complete()` itself (fee application, profit calc, balance update, `'completed'` emit) is **unchanged** — only what triggers it changes, per "las lógicas de órdenes se mantienen igual."
- **`targetPrice` is removed** from `ActiveOrder` (and therefore from `CompletedOrder`, which extends it) and from `buy()`'s computation — it no longer has a meaning (selling is pivot-driven, not price-driven), so keeping a stale "+0.5%" field around would be actively misleading. `buy()` otherwise keeps every other line: `hasActiveOrder` dedup guard, `computeOrderSize()` sizing, the 0.1% buy fee, balance deduction, `'opened'` emit.
- `TARGET_PCT` constant and its FP-drift-avoiding comment are removed along with `targetPrice`.

## REST API (`backend/src/routes/api.ts`)

- **`POST /orders/buy` is removed** — buying is now fully automatic, there is no manual trigger to expose.
- **`GET /qualifying` is removed** — depended on `getQualifyingSymbols()`, which is deleted.
- **`GET /orders/sizes` is kept** — even without a manual Buy button, showing the size a future automatic buy *would* use is useful informational context on the card, and the underlying `computeOrderSize()`/liquidity-sizing logic is explicitly unchanged.
- `GET /observers`, `GET /observers/:symbol`, `GET /observers/:symbol/chart`, `GET /orders` are unchanged (they already just pass through whatever shape `ObserverState`/`OrderStatus` have).

## Frontend

- **Deleted**: `frontend/src/components/chartGrouping.ts` and its test, the Ready/Watching `<section>`s in `ChartGrid.tsx`, the performance-sort dropdown (no longer meaningful with effectively one card), the Buy button and its `fetch('/api/orders/buy', ...)` call, the pin feature (pinning only made sense for ordering a multi-symbol grid), `TimeframeSignal`/`SignalReasons` from `frontend/src/types/index.ts`. `PerformanceWindows`/`ObserverData.performance` stay — performance display is independent of step1/step2.
- **`frontend/src/types/index.ts`** mirrors the new backend shapes: `PivotType`, `Pivot`, `ZigZagState`, and `ObserverData` becomes `{ symbol: string; performance: PerformanceWindows; zigzag: ZigZagState }`.
- **`ChartGrid.tsx`**: mirrors the same `ZIGZAG_ENABLED_SYMBOLS` constant (`new Set(['BTCUSDT'])`, with a comment cross-referencing `BotManager.ts` as the source of truth) and filters `observers` down to that set before rendering — in practice, a single card for now. Renders one flat grid (no sections) with whatever matches.
- **`SymbolChartCard.tsx`**: the READY badge is replaced by a small ZigZag status row — direction arrow (↑/↓, or a neutral marker while `direction === null` during cold start) plus the last confirmed pivot's type and price (`"Last: MIN @ 61234.50"`, or `"—"` before the first pivot confirms). The footer's "Target" line is removed (no longer meaningful); "Price" and "Size" stay as today. The Buy button is removed; the "Active / buy X" display for an open order stays unchanged.
- **`OrdersView.tsx`**: the "Target" column is removed from the active-orders table (the field no longer exists on `ActiveOrder`); everything else (Symbol, Buy price, Open for, the completed-count/performance/balance header) is unchanged.

## Out of scope

- Rebuilding the emulator — sub-project 2, separate spec/plan.
- Running ZigZag on more than one timeframe simultaneously per symbol (unlike the old `m1Signal`/`h1Signal` split, this is a single `TIMEFRAME` constant for the whole app).
- Enabling more symbols than `BTCUSDT` — the set exists and is easy to extend, but only BTC is turned on now.
- Stop-loss or any loss-protection logic — selling triggers purely on a confirmed máximo, even below the buy price, per "solo cambia la activación."
- Tuning `DEVIATION_PCT`/`MIN_BARS_BETWEEN_PIVOTS`/`PRICE_SOURCE`/`TIMEFRAME` beyond the stated initial values (1%, 20, `'close'`, `'1m'`) — calibration happens in sub-project 2 via the emulator.
- A UI control to change ZigZag parameters at runtime — they stay hardcoded constants for this phase.
