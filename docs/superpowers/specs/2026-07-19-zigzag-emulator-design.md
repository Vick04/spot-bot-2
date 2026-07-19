# ZigZag strategy emulator — design

## Problem

Sub-project 1 replaced the bot's activation logic with a ZigZag pivot detector (buy on confirmed mínimo, sell on confirmed máximo), enabled for `BTCUSDT` only. Its parameters (`deviationPct: 1`, `minBarsBetweenPivots: 20`, `priceSource: 'close'`, `timeframe: '1m'`) were seeded with reasonable defaults but never calibrated against real history — and the emulator that would let us do that was deleted on 2026-07-06 as part of an earlier, unrelated rewrite. This sub-project rebuilds it: a CLI tool that replays `history/BTCUSDT/*.csv` through the real `Observer`/`ObserverManager`/`OrderManager` classes (unmodified in behavior, only additively configurable) and produces a Markdown report of the resulting trades, so different ZigZag parameter combinations can be compared before anything touches live trading.

## Architecture

### Principle: reuse production classes, inject nothing that changes live behavior

`Observer`, `ObserverManager`, and `OrderManager` are used exactly as they run in production. The only changes are **additive, optional constructor parameters** with defaults that reproduce today's live behavior byte-for-byte — the emulator is the only caller that ever passes non-default values.

- **`Observer`** gains two optional constructor parameters:
  ```ts
  constructor(
    symbol: string,
    zigzagConfig: ZigZagConfig = DEFAULT_ZIGZAG_CONFIG,
    zigzagTimeframe: ChartTimeframe = '1m'
  )
  ```
  `ObserverManager.createObserver()`/`createObservers()` gain matching optional parameters (`zigzagConfig`, `zigzagTimeframe`) threaded through to `new Observer(...)`, defaulting identically. `BotManager` calls `createObservers(symbols)` with no extra arguments, so live behavior is untouched. Internally, `Observer` stores the passed config/timeframe instead of reading the current module-level `DEFAULT_ZIGZAG_CONFIG`/`ZIGZAG_TIMEFRAME` constants directly — those constants become the parameters' default values instead of being read inline at each `nextZigZagState()` call site.

- **`OrderManager`** gains two optional constructor parameters:
  ```ts
  constructor(
    clock: () => number = () => Date.now(),
    orderSizeConfig: OrderSizeConfig = { factor: 0.0001, maxUsdt: 10_000 }
  )
  ```
  `buy()`'s `openedAt` and `complete()`'s `closedAt` use `this.clock()` instead of `Date.now()` directly. `computeOrderSize()` uses `this.orderSizeConfig` instead of the current module-level `ORDER_SIZE_CONFIG` constant. `BotManager` constructs `new OrderManager()` with no arguments, so live behavior (real wall-clock timestamps, $10,000-liquidity-capped sizing) is unchanged.

### All-in order sizing (no liquidity data needed)

The emulator's stated goal is calibrating the ZigZag *strategy* (does a confirmed mínimo→máximo cycle tend to be profitable, and by how much) — `profitPct` is size-independent, so liquidity-based sizing fidelity isn't needed for that question, and skipping it avoids having to merge two candle streams (1m for volume + whichever timeframe is under test) per run.

The emulator constructs `OrderManager` with:
```ts
{ factor: Number.MAX_SAFE_INTEGER, maxUsdt: Infinity }
```
and always passes a nonzero `quoteVolume24h` (e.g. `1`) to `buy()`. Since `computeOrderSize` is `min(balance, quoteVolume24h * factor, maxUsdt)`, this makes `quoteVolume24h * factor` astronomically larger than any balance and removes the `maxUsdt` cap — the result is always exactly `balance`, i.e. a true all-in, compounding order size on every buy, through the existing unmodified `computeOrderSize()` formula.

### Synthetic 1s price feed (keeps `getCurrentPrice()` valid)

Production's `BotManager` reacts to a `'pivot'` event by buying/selling at `observerManager.getCurrentPrice(symbol)` — the live 1s-ticker price, not the pivot's own (stale-by-construction) price. The CSV history has no 1s data, only 1m/1h OHLC bars. To keep the emulator's pivot-handling glue structurally identical to `BotManager`'s (same method call, same null-guard, no special-cased "use candle.close instead" branch), the emulator feeds a synthetic 1s candle with `close` equal to the just-processed candle's `close` immediately after each real candle:
```ts
observerManager.updateCandle({ symbol, timeframe: '1s', openTime: candle.openTime, open: candle.close, high: candle.close, low: candle.close, close: candle.close, isClosed: true });
```
This is fed *after* the real candle update (so any `'pivot'` event already fired and `getCurrentPrice()` will resolve to the correct value once the handler runs — Node's `EventEmitter` calls listeners synchronously, so by the time this line runs, the `'pivot'` handler for this candle has already completed). `Observer.currentPrice` becomes valid before the next candle is processed, matching production's behavior of `currentPrice` almost always reflecting something very close to the last close by the time a candle finishes.

### Single symbol per run, structured for future multi-symbol

`EmulatorEngine.run(options)` takes `symbols: string[]` (today always length 1, `['BTCUSDT']` by default) and creates one `Observer`/candle-stream per entry, iterating candles per symbol in its own loop. No cross-symbol time-merge is implemented now (unlike the deleted emulator's k-way merge) — extending to multiple symbols later means adding that merge back, not restructuring `EmulatorEngine`'s public shape.

## `EmulatorEngine`

```ts
export interface EmulatorOptions {
  historyDir: string;       // e.g. path to `history/`
  symbols: string[];        // e.g. ['BTCUSDT']
  timeframe: ChartTimeframe; // '1m' | '1h' — which CSV file to read AND which Observer buffer drives ZigZag
  zigzagConfig: ZigZagConfig;
  limitPerSymbol?: number;  // cap candles processed, for quick smoke runs
}

export interface EmulatorTrade {
  symbol: string;
  buyPrice: number;
  buyTime: number;   // openTime of the candle that triggered the buy
  sellPrice: number;
  sellTime: number;
  profitPct: number;
  durationMs: number;
}

export interface EmulatorResult {
  options: EmulatorOptions;
  candlesProcessed: number;
  firstCandleTime: number | null;
  lastCandleTime: number | null;
  initialBalance: number;
  finalBalance: number;
  trades: EmulatorTrade[];
  discardedOpenOrders: number; // still-open orders at end of data, excluded from trades/balance
  maxDrawdownPct: number;
}
```

`run(options)`:
1. For each symbol: create an `Observer`/`ObserverManager` pair configured with `options.zigzagConfig`/`options.timeframe`; create one shared all-in-configured `OrderManager` with a simulated clock (`{ time: 0 }` object, `clock = () => simClock.time`).
2. Listen for `ObserverManager`'s `'pivot'` event exactly like `BotManager` does live — `'min'` → `orderManager.buy(symbol, currentPrice, 1)`, `'max'` → `orderManager.sellAtPrice(symbol, currentPrice)` — using `observerManager.getCurrentPrice(symbol)`, skipping if `null`.
3. Listen for `OrderManager`'s `'completed'` event to accumulate `EmulatorTrade` records and update a running peak-balance tracker for `maxDrawdownPct` (`(peak - balance) / peak * 100`, keep the maximum over the run).
4. Stream the symbol's `{timeframe}` CSV file candle-by-candle (see below), updating `simClock.time = candle.openTime` before each `observerManager.updateCandle(candle)` call, then feeding the synthetic 1s candle described above.
5. After the stream ends: if `orderManager.getStatus().activeOrders.length > 0`, increment `discardedOpenOrders` per symbol and do not include it in `trades` or final balance adjustments (its `usdtSpent` was already deducted from balance when opened — that's an accurate reflection of "this capital was tied up and its outcome is unknown," left as-is, not refunded).
6. Return the aggregated `EmulatorResult`.

## CSV candle source

`backend/src/emulator/csvCandleSource.ts` — reused from the deleted emulator's proven design (memory-efficient, no full-file load):
- `function* readSymbolCandles(historyDir: string, symbol: string, timeframe: ChartTimeframe, limit?: number): Generator<Candle>` — synchronous, fixed-size buffered reads (`fs.readSync`, 1MB chunks), parses `open_time,open,high,low,close,...` (the CSV's own `quote_volume` column is ignored — sizing is all-in per the decision above), skips malformed rows with a warning, opens `${historyDir}/${symbol}/${symbol}_${timeframe}.csv`.
- No k-way merge function is (re)written now — single-symbol callers just iterate `readSymbolCandles` directly.

## CLI entry point

`backend/src/emulator/run.ts`, wired to `npm run emulate` in `backend/package.json`:

```
npm run emulate -- [--symbol=BTCUSDT] [--timeframe=1m] [--deviation=1] [--minBars=20] [--priceSource=close] [--limit=100000] [--out=results/my-run.md]
```

All flags optional, defaulting to today's production `DEFAULT_ZIGZAG_CONFIG`/`'1m'` values and `BTCUSDT`. `--out` defaults to `results/emulation-<ISO-timestamp>.md` (the `results/` directory is already gitignored from the deleted emulator's era). On completion, prints elapsed wall-clock time and the output path to the console — the report itself is the primary output.

## Report format (Markdown)

```markdown
# Emulation Report — BTCUSDT

## Configuration
- Timeframe: 1m
- Deviation: 1%
- Min bars between pivots: 20
- Price source: close
- Candles processed: 483,841
- Period: 2025-08-01T00:00:00.000Z — 2026-07-02T23:59:00.000Z

## Summary
- Initial balance: 10,000.00 USDT
- Final balance: 12,345.67 USDT
- Total return: +23.46%
- Completed trades: 42
- Win rate: 61.9% (26 wins / 16 losses)
- Average profit per trade: +0.87%
- Average trade duration: 3h 12m
- Max drawdown: -8.34%
- Discarded (still open at end of data): 1

## Trades

| # | Buy Time | Buy Price | Sell Time | Sell Price | Profit % | Duration |
|---|----------|-----------|-----------|------------|----------|----------|
| 1 | 2025-08-02T14:23:00Z | 61234.50 | 2025-08-02T17:45:00Z | 62100.00 | +1.41% | 3h 22m |
| ... | | | | | | |
```

Durations formatted as `Xh Ym` (or `Ym Zs` for sub-hour durations), matching `frontend/src/components/OrdersView.tsx`'s existing `fmtElapsed` style for consistency across the codebase, reimplemented locally in the report writer (no cross-package import between `backend/` and `frontend/`).

## Out of scope

- Multi-symbol simultaneous runs (structure allows it later, not built now).
- Liquidity-based order sizing during emulation (all-in per the decision above).
- Any UI for running or viewing emulations — CLI + Markdown file only, matching the deleted emulator's precedent.
- Automatically sweeping/grid-searching parameter combinations — each run tests one combination; comparing multiple runs is a manual process (run N times with different flags, read N reports).
- Changing any of `DEFAULT_ZIGZAG_CONFIG`'s live values based on emulator findings — that's a follow-up decision after results are reviewed, not part of this sub-project.
