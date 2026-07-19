# ZigZag-Driven Automatic Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the step1/step2 qualification system (Ready/Watching, manual Buy, target-price sell) with a ZigZag pivot detector that automatically buys on a confirmed local minimum and sells on a confirmed local maximum, enabled for BTCUSDT only.

**Architecture:** A pure function `nextZigZagState()` (mirroring the removed `nextTimeframeSignal()`) confirms sticky, non-repainting pivots from a running extreme once price retraces past a deviation threshold and enough bars have passed. `Observer` recomputes it only on candle close of a single configured timeframe; `ObserverManager` reuses its existing before/after-state diff (already built for the old step1/step2 system) to detect a freshly confirmed pivot and emit a new `'pivot'` event; `BotManager` reacts to that event for symbols in an enabled-set, calling the unchanged `OrderManager.buy()`/new `sellAtPrice()`. The frontend drops Ready/Watching/pin/manual-Buy entirely and shows a single card (today, just BTC) with live ZigZag + performance state.

**Tech Stack:** TypeScript, Node.js `node:test` (backend), Express + Socket.IO (backend), React 18 + Vite + `node:test`/ts-node (frontend), Tailwind CSS.

## Global Constraints

- ZigZag pivots are computed on **closed candles only** (never the live 1s tick), sticky/non-repainting (confirmed once, never revised).
- Default parameters: `deviationPct: 1`, `minBarsBetweenPivots: 20`, `priceSource: 'close'`, all bundled in `DEFAULT_ZIGZAG_CONFIG` — production code never overrides them; only tests do, to exercise the `'highLow'` branch.
- `Observer` computes ZigZag state for **every** symbol (generic, cheap) — only `BotManager`'s `ZIGZAG_ENABLED_SYMBOLS` set (currently `{'BTCUSDT'}`) decides which symbols actually get auto-traded. The frontend mirrors this same set (`ChartGrid.tsx`) to decide what to display.
- Order-lifecycle math (fees, profit calc, balance, liquidity sizing via `computeOrderSize()`) is **completely unchanged** — only what triggers a buy/sell changes.
- `ActiveOrder`/`CompletedOrder` lose the `targetPrice` field entirely (no longer meaningful — selling is pivot-driven, not price-driven).
- No stop-loss or loss protection — `sellAtPrice()` closes at whatever price a confirmed máximo gives, even below the buy price.
- `qualifies`/`reasons`/`TimeframeSignal`/`SignalReasons` are removed everywhere (backend and frontend types, all consumers) — this is a full replacement, not an addition alongside the old system.

---

## File Structure

- Modify `backend/src/types/index.ts` — remove `TimeframeSignal`/`SignalReasons`, add `PivotType`/`Pivot`/`ZigZagState`/`PivotEvent`, change `ObserverState` to `{symbol, performance, zigzag}`, remove `targetPrice` from `ActiveOrder`.
- Create `backend/src/utils/zigzag.ts` — pure `nextZigZagState()`.
- Create `backend/src/utils/zigzag.test.ts`.
- Delete `backend/src/utils/signals.ts` and `backend/src/utils/signals.test.ts`.
- Modify `backend/src/observers/Observer.ts` — replace `m1Signal`/`h1Signal` with a single `zigzag` field driven by `ZIGZAG_TIMEFRAME`.
- Modify `backend/src/observers/Observer.test.ts` — remove step1/step2 tests, add ZigZag tests, keep performance/chart/quoteVolume tests as-is.
- Modify `backend/src/managers/ObserverManager.ts` — replace the `reasonsChanged` diff with a `pivotChanged` diff, emit `'pivot'`, remove `getQualifyingSymbols()`, unconditional `chart:tick`/`chart:closed`.
- Modify `backend/src/managers/ObserverManager.test.ts` — replace step1/step2-based tests with pivot-based tests.
- Modify `backend/src/managers/OrderManager.ts` — remove `onPriceTick()`/`targetPrice`, add `sellAtPrice()`.
- Modify `backend/src/managers/OrderManager.test.ts` — replace `onPriceTick` tests with `sellAtPrice` tests, drop `targetPrice` assertions.
- Modify `backend/src/managers/BotManager.ts` — add `ZIGZAG_ENABLED_SYMBOLS`, subscribe to `'pivot'`, remove the 1s-tick `onPriceTick` call.
- Modify `backend/src/routes/api.ts` — remove `POST /orders/buy` and `GET /qualifying`.
- Modify `frontend/src/types/index.ts` — mirror the same backend type changes.
- Delete `frontend/src/components/chartGrouping.ts` and `frontend/src/components/chartGrouping.test.ts`.
- Modify `frontend/src/components/ChartGrid.tsx` — drop pin/sort/Ready-Watching/Buy-fetch, filter by `ZIGZAG_ENABLED_SYMBOLS`.
- Modify `frontend/src/components/SymbolChartCard.tsx` — drop pin/READY-badge/Buy button/Target line, add a ZigZag status row.
- Modify `frontend/src/components/OrdersView.tsx` — remove the Target column.
- Modify `frontend/src/App.tsx` — drop the `qualifyingCount` header text.

---

### Task 1: Backend types + ZigZag pure function

**Files:**
- Modify: `backend/src/types/index.ts` (full rewrite)
- Create: `backend/src/utils/zigzag.ts`
- Create: `backend/src/utils/zigzag.test.ts`
- Delete: `backend/src/utils/signals.ts`, `backend/src/utils/signals.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `PivotType = 'min' | 'max'`, `Pivot { price: number; type: PivotType }`, `ZigZagState { direction: 'up'|'down'|null; pendingHigh: number; pendingHighBars: number; pendingLow: number; pendingLowBars: number; extremePrice: number; barsSinceExtreme: number; lastPivot: Pivot | null }`, `PivotEvent { symbol: string; type: PivotType; price: number }` (all exported from `backend/src/types/index.ts`). `ZigZagConfig { deviationPct: number; minBarsBetweenPivots: number; priceSource: 'close' | 'highLow' }`, `DEFAULT_ZIGZAG_CONFIG: ZigZagConfig`, `EMPTY_ZIGZAG_STATE: ZigZagState`, `nextZigZagState(candle: { high: number; low: number; close: number }, prev: ZigZagState, config?: ZigZagConfig): ZigZagState` (all exported from `backend/src/utils/zigzag.ts`). `ObserverState` becomes `{ symbol: string; performance: PerformanceWindows; zigzag: ZigZagState }` (no more `qualifies`/`reasons`). `ActiveOrder` loses `targetPrice`.

This task edits `types/index.ts` first (removing fields several other files still reference) and deletes `signals.ts` in the same commit — `Observer.ts`, `ObserverManager.ts`, and `OrderManager.ts` are all left temporarily broken by this task and get fixed in Tasks 2–4. Do not run the full backend suite (`'src/**/*.test.ts'`) until Task 4's final step — only run `zigzag.test.ts` on its own, which compiles cleanly in isolation (it only imports `zigzag.ts` and `types/index.ts`, neither of which any broken file is on its import path).

- [ ] **Step 1: Rewrite `backend/src/types/index.ts`**

Replace the entire file with:

```ts
export type CandleTimeframe = '1s' | '1m' | '1h';

export interface Candle {
  symbol: string;
  timeframe: CandleTimeframe;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  isClosed: boolean;
  quoteVolume?: number;
}

export interface CandleData {
  close: number;
  timestamp: number;
}

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

/** Emitted by ObserverManager when a symbol's ZigZag detector confirms a
 * new pivot on this exact candle close — the trading-facing signal
 * BotManager listens to (distinct from the UI-facing 'signal' event). */
export interface PivotEvent {
  symbol: string;
  type: PivotType;
  price: number;
}

export interface PerformanceWindows {
  h24: number | null;
  h12: number | null;
  h6: number | null;
  h3: number | null;
  h1: number | null;
}

export interface ObserverState {
  symbol: string;
  performance: PerformanceWindows;
  zigzag: ZigZagState;
}

export type ChartTimeframe = '1m' | '1h';

export interface ChartCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartSeriesPoint {
  ma20: number | null;
  ma99: number | null;
  bbUpper: number | null;
  bbLower: number | null;
}

export interface ChartSeries {
  ma20: (number | null)[];
  ma99: (number | null)[];
  bbUpper: (number | null)[];
  bbLower: (number | null)[];
}

export interface ChartData {
  symbol: string;
  timeframe: ChartTimeframe;
  candles: ChartCandle[];
  series: ChartSeries;
}

export interface ChartTickEvent {
  symbol: string;
  m1: { candle: ChartCandle; series: ChartSeriesPoint };
  h1: { candle: ChartCandle; series: ChartSeriesPoint };
}

export interface ChartClosedEvent {
  symbol: string;
  timeframe: ChartTimeframe;
  candle: ChartCandle;
  series: ChartSeriesPoint;
}

export interface ActiveOrder {
  symbol: string;
  buyPrice: number;
  quantity: number;
  usdtSpent: number;
  openedAt: number;
}

export interface CompletedOrder extends ActiveOrder {
  sellPrice: number;
  usdtReceived: number;
  profit: number;
  profitPct: number;
  closedAt: number;
  durationMs: number;
}

export interface OrderStatus {
  balance: number;
  activeOrders: ActiveOrder[];
  completedCount: number;
  totalProfitPct: number;
}

export interface OrderOpenedEvent {
  order: ActiveOrder;
  balance: number;
}

export interface OrderCompletedEvent {
  order: CompletedOrder;
  balance: number;
  completedCount: number;
  totalProfitPct: number;
}
```

- [ ] **Step 2: Delete the old signals files**

```bash
git rm backend/src/utils/signals.ts backend/src/utils/signals.test.ts
```

- [ ] **Step 3: Write the failing test for `nextZigZagState()`**

Create `backend/src/utils/zigzag.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextZigZagState, EMPTY_ZIGZAG_STATE, DEFAULT_ZIGZAG_CONFIG } from './zigzag';

function closeCandle(close: number) {
  return { high: close, low: close, close };
}

test('the very first candle seeds both pending candidates, direction stays null', () => {
  const state = nextZigZagState(closeCandle(110), EMPTY_ZIGZAG_STATE);
  assert.equal(state.direction, null);
  assert.equal(state.pendingHigh, 110);
  assert.equal(state.pendingLow, 110);
  assert.equal(state.lastPivot, null);
});

test('cold start confirms a MAX pivot once the price retraces >= 1% AND >= 20 bars have passed since the peak', () => {
  const closes = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  let state = EMPTY_ZIGZAG_STATE;
  closes.forEach(c => { state = nextZigZagState(closeCandle(c), state); });

  assert.equal(state.direction, 'down');
  assert.deepEqual(state.lastPivot, { price: 110, type: 'max' });
});

test('cold start confirms a MIN pivot symmetrically', () => {
  const closes = [90, ...Array.from({ length: 25 }, (_, k) => +(90 + 0.1 * (k + 1)).toFixed(2))];
  let state = EMPTY_ZIGZAG_STATE;
  closes.forEach(c => { state = nextZigZagState(closeCandle(c), state); });

  assert.equal(state.direction, 'up');
  assert.deepEqual(state.lastPivot, { price: 90, type: 'min' });
});

test('no confirmation before 20 bars even once the 1% deviation is already exceeded', () => {
  const closes = [110, ...Array.from({ length: 15 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  let state = EMPTY_ZIGZAG_STATE;
  closes.forEach(c => { state = nextZigZagState(closeCandle(c), state); });

  // After 16 candles (15 bars since the peak), deviation is already 1.364% --
  // past the 1% threshold -- but bars (15) < minBarsBetweenPivots (20), so no
  // pivot yet.
  assert.equal(state.direction, null);
  assert.equal(state.lastPivot, null);
  assert.equal(state.pendingHighBars, 15);
});

test('a new extreme mid-decline resets the bar counter, delaying confirmation and using the new extreme', () => {
  const declinePart = Array.from({ length: 10 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2));
  const bounce = [111]; // a new high -- resets pendingHighBars to 0
  const declinePart2 = Array.from({ length: 25 }, (_, k) => +(111 - 0.1 * (k + 1)).toFixed(2));
  const closes = [110, ...declinePart, ...bounce, ...declinePart2];

  let state = EMPTY_ZIGZAG_STATE;
  closes.forEach(c => { state = nextZigZagState(closeCandle(c), state); });

  // Confirms using 111 (the post-bounce high), not the original 110.
  assert.deepEqual(state.lastPivot, { price: 111, type: 'max' });
});

test('normal operation (post-cold-start) extends the extreme without confirming while price keeps making new lows', () => {
  const closes = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  let state = EMPTY_ZIGZAG_STATE;
  closes.forEach(c => { state = nextZigZagState(closeCandle(c), state); });
  assert.equal(state.direction, 'down'); // cold start confirmed a MAX, direction flipped

  const extended = nextZigZagState(closeCandle(state.extremePrice - 1), state);
  assert.equal(extended.direction, 'down');
  assert.deepEqual(extended.lastPivot, state.lastPivot);
  assert.equal(extended.extremePrice, state.extremePrice - 1);
  assert.equal(extended.barsSinceExtreme, 0);
});

test('normal operation confirms the next pivot and flips direction again', () => {
  const closes = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  let state = EMPTY_ZIGZAG_STATE;
  closes.forEach(c => { state = nextZigZagState(closeCandle(c), state); });
  // state.direction === 'down', state.extremePrice === 107.5 (last close)

  const continued = Array.from({ length: 5 }, (_, k) => +(107.5 - 0.1 * (k + 1)).toFixed(2)); // 5 more new lows
  const rise = Array.from({ length: 25 }, (_, k) => +(107.0 + 0.1 * (k + 1)).toFixed(2)); // then a rise
  [...continued, ...rise].forEach(c => { state = nextZigZagState(closeCandle(c), state); });

  assert.equal(state.direction, 'up');
  assert.deepEqual(state.lastPivot, { price: 107, type: 'min' });
});

test('lastPivot is sticky -- a candle that neither extends nor confirms leaves it unchanged', () => {
  const closes = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  let state = EMPTY_ZIGZAG_STATE;
  closes.forEach(c => { state = nextZigZagState(closeCandle(c), state); });
  const pivotBefore = state.lastPivot;

  const after = nextZigZagState(closeCandle(state.extremePrice), state); // exactly at the extreme: not a new low, not enough retrace
  assert.equal(after.lastPivot, pivotBefore); // same object reference, not just equal value
});

test('highLow price source uses the candle high/low, ignoring a constant close', () => {
  const config = { ...DEFAULT_ZIGZAG_CONFIG, priceSource: 'highLow' as const };
  const seed = { high: 110, low: 108, close: 109 };
  const rest = Array.from({ length: 25 }, (_, k) => ({ high: 110, low: +(110 - 0.1 * (k + 1)).toFixed(2), close: 109 }));

  let state = EMPTY_ZIGZAG_STATE;
  [seed, ...rest].forEach(c => { state = nextZigZagState(c, state, config); });

  // Every close was a constant 109 -- confirmation only happens because
  // highLow mode reads high/low, proving `close` was ignored.
  assert.equal(state.direction, 'down');
  assert.deepEqual(state.lastPivot, { price: 110, type: 'max' });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run (from `backend/`): `node --test --require ts-node/register src/utils/zigzag.test.ts`
Expected: FAIL — cannot find module `./zigzag`.

- [ ] **Step 5: Create `backend/src/utils/zigzag.ts`**

```ts
import { Pivot, ZigZagState } from '../types';

interface ZigZagCandle {
  high: number;
  low: number;
  close: number;
}

export interface ZigZagConfig {
  deviationPct: number;
  minBarsBetweenPivots: number;
  priceSource: 'close' | 'highLow';
}

export const DEFAULT_ZIGZAG_CONFIG: ZigZagConfig = {
  deviationPct: 1,
  minBarsBetweenPivots: 20,
  priceSource: 'close',
};

export const EMPTY_ZIGZAG_STATE: ZigZagState = {
  direction: null,
  pendingHigh: -Infinity,
  pendingHighBars: 0,
  pendingLow: Infinity,
  pendingLowBars: 0,
  extremePrice: 0,
  barsSinceExtreme: 0,
  lastPivot: null,
};

function priceHigh(c: ZigZagCandle, config: ZigZagConfig): number {
  return config.priceSource === 'close' ? c.close : c.high;
}

function priceLow(c: ZigZagCandle, config: ZigZagConfig): number {
  return config.priceSource === 'close' ? c.close : c.low;
}

/** Advances the ZigZag pivot detector by one closed candle. Confirms a
 * sticky pivot (never repaints, never reverts) once price retraces >=
 * config.deviationPct% from the running extreme AND at least
 * config.minBarsBetweenPivots candles have passed since that extreme was
 * last extended. See docs/superpowers/specs/2026-07-09-zigzag-auto-trading-design.md
 * for the full cold-start/normal-operation walkthrough. */
export function nextZigZagState(
  candle: ZigZagCandle,
  prev: ZigZagState,
  config: ZigZagConfig = DEFAULT_ZIGZAG_CONFIG
): ZigZagState {
  const high = priceHigh(candle, config);
  const low = priceLow(candle, config);

  if (prev.direction === null) {
    if (prev.pendingHigh === -Infinity) {
      return { ...prev, pendingHigh: high, pendingLow: low };
    }

    let { pendingHigh, pendingHighBars, pendingLow, pendingLowBars } = prev;
    if (high > pendingHigh) { pendingHigh = high; pendingHighBars = 0; } else { pendingHighBars += 1; }
    if (low < pendingLow) { pendingLow = low; pendingLowBars = 0; } else { pendingLowBars += 1; }

    if ((pendingHigh - low) / pendingHigh * 100 >= config.deviationPct && pendingHighBars >= config.minBarsBetweenPivots) {
      const pivot: Pivot = { price: pendingHigh, type: 'max' };
      return { direction: 'down', pendingHigh, pendingHighBars, pendingLow, pendingLowBars, extremePrice: low, barsSinceExtreme: 0, lastPivot: pivot };
    }
    if ((high - pendingLow) / pendingLow * 100 >= config.deviationPct && pendingLowBars >= config.minBarsBetweenPivots) {
      const pivot: Pivot = { price: pendingLow, type: 'min' };
      return { direction: 'up', pendingHigh, pendingHighBars, pendingLow, pendingLowBars, extremePrice: high, barsSinceExtreme: 0, lastPivot: pivot };
    }
    return { ...prev, pendingHigh, pendingHighBars, pendingLow, pendingLowBars };
  }

  if (prev.direction === 'up') {
    if (high > prev.extremePrice) {
      return { ...prev, extremePrice: high, barsSinceExtreme: 0 };
    }
    if ((prev.extremePrice - low) / prev.extremePrice * 100 >= config.deviationPct && prev.barsSinceExtreme >= config.minBarsBetweenPivots) {
      const pivot: Pivot = { price: prev.extremePrice, type: 'max' };
      return { ...prev, direction: 'down', extremePrice: low, barsSinceExtreme: 0, lastPivot: pivot };
    }
    return { ...prev, barsSinceExtreme: prev.barsSinceExtreme + 1 };
  }

  // prev.direction === 'down'
  if (low < prev.extremePrice) {
    return { ...prev, extremePrice: low, barsSinceExtreme: 0 };
  }
  if ((high - prev.extremePrice) / prev.extremePrice * 100 >= config.deviationPct && prev.barsSinceExtreme >= config.minBarsBetweenPivots) {
    const pivot: Pivot = { price: prev.extremePrice, type: 'min' };
    return { ...prev, direction: 'up', extremePrice: high, barsSinceExtreme: 0, lastPivot: pivot };
  }
  return { ...prev, barsSinceExtreme: prev.barsSinceExtreme + 1 };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run (from `backend/`): `node --test --require ts-node/register src/utils/zigzag.test.ts`
Expected: PASS, 9/9 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/types/index.ts backend/src/utils/zigzag.ts backend/src/utils/zigzag.test.ts
git commit -m "feat: replace step1/step2 qualification types with ZigZag pivot detector"
```

(`git rm` from Step 2 stages the deletions automatically — they'll be included in this commit since they're already staged.)

---

### Task 2: `Observer` — drive ZigZag from a single configured timeframe

**Files:**
- Modify: `backend/src/observers/Observer.ts` (full rewrite)
- Modify: `backend/src/observers/Observer.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `nextZigZagState`, `EMPTY_ZIGZAG_STATE` from `backend/src/utils/zigzag.ts` (Task 1). `ZigZagState`, `ObserverState`, `PerformanceWindows` from `backend/src/types/index.ts` (Task 1).
- Produces: `Observer.getState(): ObserverState` returns `{ symbol, performance, zigzag }` (no `qualifies`/`reasons`). No other public method signatures change (`preloadClosed1m`, `preloadClosed1h`, `preloadQuoteVolume1m`, `updateCandle1s`, `updateCandle1m`, `updateCandle1h`, `get24hQuoteVolume`, `getCurrentPrice`, `getChartData` all keep their existing signatures).

Do not run the full backend suite yet — `ObserverManager.ts` and `OrderManager.ts` are still broken (Tasks 3–4 fix them). Only run `Observer.test.ts` on its own.

- [ ] **Step 1: Write the failing tests**

Replace the entire file `backend/src/observers/Observer.test.ts` with:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Observer } from './Observer';
import { Candle } from '../types';

function closedCandle(openTime: number, open: number, high: number, low: number, close: number): Candle {
  return { symbol: 'BTCUSDT', timeframe: '1m', openTime, open, high, low, close, isClosed: true };
}

function formingCandle(openTime: number, open: number, high: number, low: number, close: number): Candle {
  return { symbol: 'BTCUSDT', timeframe: '1m', openTime, open, high, low, close, isClosed: false };
}

test('getChartData returns closed candles as-is when there is no forming candle yet', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m([closedCandle(1, 100, 105, 95, 102)]);

  const data = observer.getChartData('1m');
  assert.deepEqual(data, [{ openTime: 1, open: 100, high: 105, low: 95, close: 102 }]);
});

test('getChartData appends the forming candle with high/low widened by the live price', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m([closedCandle(1, 100, 105, 95, 102)]);
  observer.updateCandle1m(formingCandle(2, 103, 106, 101, 103));
  observer.updateCandle1s({ symbol: 'BTCUSDT', timeframe: '1s', openTime: 3, open: 110, high: 110, low: 110, close: 110, isClosed: true });

  const data = observer.getChartData('1m');
  assert.equal(data.length, 2);
  assert.deepEqual(data[1], { openTime: 2, open: 103, high: 110, low: 101, close: 110 });
});

test('getChartData omits the forming point when there is no live price yet', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m([closedCandle(1, 100, 105, 95, 102)]);
  observer.updateCandle1m(formingCandle(2, 103, 106, 101, 103));

  const data = observer.getChartData('1m');
  assert.equal(data.length, 1);
});

test('getChartData returns the 1h buffer independently from the 1m buffer', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m([closedCandle(1, 100, 105, 95, 102)]);
  observer.preloadClosed1h([
    { symbol: 'BTCUSDT', timeframe: '1h', openTime: 10, open: 200, high: 210, low: 190, close: 205, isClosed: true },
  ]);

  assert.equal(observer.getChartData('1m').length, 1);
  assert.equal(observer.getChartData('1m')[0].open, 100);
  assert.equal(observer.getChartData('1h').length, 1);
  assert.equal(observer.getChartData('1h')[0].open, 200);
});

test('get24hQuoteVolume sums preloaded quote volumes', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadQuoteVolume1m([
    { symbol: 'BTCUSDT', timeframe: '1m', openTime: 1, open: 1, high: 1, low: 1, close: 1, isClosed: true, quoteVolume: 100 },
    { symbol: 'BTCUSDT', timeframe: '1m', openTime: 2, open: 1, high: 1, low: 1, close: 1, isClosed: true, quoteVolume: 250 },
  ]);
  assert.equal(observer.get24hQuoteVolume(), 350);
});

test('get24hQuoteVolume treats a missing quoteVolume as 0', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadQuoteVolume1m([
    { symbol: 'BTCUSDT', timeframe: '1m', openTime: 1, open: 1, high: 1, low: 1, close: 1, isClosed: true },
  ]);
  assert.equal(observer.get24hQuoteVolume(), 0);
});

test('a closed 1m candle updates the rolling quote-volume window in real time', () => {
  const observer = new Observer('BTCUSDT');
  observer.updateCandle1m({ symbol: 'BTCUSDT', timeframe: '1m', openTime: 1, open: 1, high: 1, low: 1, close: 1, isClosed: true, quoteVolume: 500 });
  assert.equal(observer.get24hQuoteVolume(), 500);
});

test('getCurrentPrice reflects the latest 1s close, null before any tick', () => {
  const observer = new Observer('BTCUSDT');
  assert.equal(observer.getCurrentPrice(), null);
  observer.updateCandle1s({ symbol: 'BTCUSDT', timeframe: '1s', openTime: 1, open: 10, high: 10, low: 10, close: 12.5, isClosed: true });
  assert.equal(observer.getCurrentPrice(), 12.5);
});

function closedCandleAt(openTime: number, close: number): Candle {
  return { symbol: 'BTCUSDT', timeframe: '1m', openTime, open: close, high: close, low: close, close, isClosed: true };
}

/** Same 26-candle cold-start-confirms-MAX sequence verified in
 * backend/src/utils/zigzag.test.ts: seed at 110, then 25 candles declining
 * by 0.1 each. The confirming candle is index 20 (0-indexed) -- the first 20
 * candles (indices 0-19) do NOT confirm anything yet. */
function coldStartMaxSequence(startAt: number): Candle[] {
  const closes = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  return closes.map((close, i) => closedCandleAt(startAt + i, close));
}

test('zigzag is at its initial empty state before any candle is loaded', () => {
  const observer = new Observer('BTCUSDT');
  const zigzag = observer.getState().zigzag;
  assert.equal(zigzag.direction, null);
  assert.equal(zigzag.lastPivot, null);
});

test('updateCandle1s never changes zigzag or performance state, only currentPrice', () => {
  const observer = new Observer('BTCUSDT');
  const beforeZigzag = observer.getState().zigzag;
  const beforePerf = observer.getState().performance;
  observer.updateCandle1s({ symbol: 'BTCUSDT', timeframe: '1s', openTime: 1, open: 999999, high: 999999, low: 999999, close: 999999, isClosed: true });
  assert.deepEqual(observer.getState().zigzag, beforeZigzag);
  assert.deepEqual(observer.getState().performance, beforePerf);
  assert.equal(observer.getCurrentPrice(), 999999);
});

test('a live (non-closed) 1m candle does not advance the zigzag state', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m([closedCandleAt(0, 110)]);
  const before = observer.getState().zigzag;
  observer.updateCandle1m(formingCandle(1, 50, 50, 50, 50));
  assert.deepEqual(observer.getState().zigzag, before);
});

test('preloadClosed1m replays the zigzag detector so restart reconstructs true state', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m(coldStartMaxSequence(0));

  const zigzag = observer.getState().zigzag;
  assert.equal(zigzag.direction, 'down');
  assert.deepEqual(zigzag.lastPivot, { price: 110, type: 'max' });
});

test('preloadClosed1h does NOT advance the zigzag detector (the configured timeframe is 1m)', () => {
  const observer = new Observer('BTCUSDT');
  const hourCandles = coldStartMaxSequence(0).map(c => ({ ...c, timeframe: '1h' as const }));
  observer.preloadClosed1h(hourCandles);

  const zigzag = observer.getState().zigzag;
  assert.equal(zigzag.direction, null);
  assert.equal(zigzag.lastPivot, null);
});

test('a live closed 1m candle after preload continues the replayed zigzag state', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m(coldStartMaxSequence(0));
  assert.equal(observer.getState().zigzag.direction, 'down');
  const extremeBefore = observer.getState().zigzag.extremePrice;

  observer.updateCandle1m(closedCandleAt(26, extremeBefore - 1));

  const zigzag = observer.getState().zigzag;
  assert.equal(zigzag.extremePrice, extremeBefore - 1);
  assert.equal(zigzag.barsSinceExtreme, 0);
});

function closedHourAt(openTime: number, close: number): Candle {
  return { symbol: 'BTCUSDT', timeframe: '1h', openTime, open: close, high: close, low: close, close, isClosed: true };
}

test('performance is all-null before any 1h candle is loaded', () => {
  const observer = new Observer('BTCUSDT');
  assert.deepEqual(observer.getState().performance, { h24: null, h12: null, h6: null, h3: null, h1: null });
});

test('preloadClosed1h computes performance from the preloaded buffer', () => {
  const observer = new Observer('BTCUSDT');
  const closes = Array.from({ length: 25 }, (_, i) => closedHourAt(i, 100 + i));
  observer.preloadClosed1h(closes);

  const performance = observer.getState().performance;
  assert.equal(performance.h24, ((124 - 100) / 100) * 100);
  assert.equal(performance.h1, ((124 - 123) / 123) * 100);
});

test('preloadClosed1h with too few candles leaves performance null for all windows', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1h([closedHourAt(0, 100)]);
  assert.deepEqual(observer.getState().performance, { h24: null, h12: null, h6: null, h3: null, h1: null });
});

test('a closed 1h candle recomputes performance on top of the existing buffer', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1h([closedHourAt(0, 100)]);
  assert.equal(observer.getState().performance.h1, null);

  observer.updateCandle1h(closedHourAt(1, 110));

  const performance = observer.getState().performance;
  assert.equal(performance.h1, ((110 - 100) / 100) * 100);
});

test('a non-closed (forming) 1h candle does not recompute performance', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1h([closedHourAt(0, 100), closedHourAt(1, 110)]);
  const before = observer.getState().performance;

  observer.updateCandle1h({ symbol: 'BTCUSDT', timeframe: '1h', openTime: 2, open: 999, high: 999, low: 999, close: 999, isClosed: false });

  assert.deepEqual(observer.getState().performance, before);
});

test('updateCandle1m does not affect performance (1h-buffer-derived only)', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1h([closedHourAt(0, 100), closedHourAt(1, 110)]);
  const before = observer.getState().performance;

  observer.updateCandle1m({ symbol: 'BTCUSDT', timeframe: '1m', openTime: 0, open: 500, high: 500, low: 500, close: 500, isClosed: true });

  assert.deepEqual(observer.getState().performance, before);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `node --test --require ts-node/register src/observers/Observer.test.ts`
Expected: FAIL — TypeScript compile error, `Observer.ts` still imports the now-deleted `../utils/signals` and its `getState()` doesn't return `zigzag`.

- [ ] **Step 3: Rewrite `backend/src/observers/Observer.ts`**

Replace the entire file with:

```ts
import { Candle, ChartCandle, ChartTimeframe, ObserverState, PerformanceWindows, ZigZagState } from '../types';
import { Queue } from '../utils/Queue';
import { computePerformance } from '../utils/performance';
import { nextZigZagState, EMPTY_ZIGZAG_STATE } from '../utils/zigzag';

/** 200 closed candles per timeframe: enough for a 100-candle visible chart
 * window with a full 99-candle MA99 lookback at the first visible point,
 * plus margin. Also comfortably covers the 24h performance window (24
 * hourly candles) and the ZigZag detector's 20-bar minimum gap. */
const CHART_HISTORY_CANDLES = 200;

/** 1 quote-volume value per closed 1m candle, covering a rolling 24h window
 * (60 * 24 = 1440 minutes), used for liquidity-based order sizing. */
const QUOTE_VOLUME_WINDOW = 1440;

/** Which closed-candle buffer drives the ZigZag pivot detector -- a single
 * global choice (unlike the old per-timeframe step1/step2 system). To be
 * calibrated against real BTC history via the emulator (separate
 * sub-project) before changing this. */
const ZIGZAG_TIMEFRAME: ChartTimeframe = '1m';

export class Observer {
  private symbol: string;
  private closed1m: Queue<Candle>;
  private closed1h: Queue<Candle>;
  private quoteVol1m: Queue<number>;
  private quoteVolSum = 0;
  private form1mCandle: Candle | null = null;
  private form1hCandle: Candle | null = null;
  private currentPrice: number | null = null;
  private performance: PerformanceWindows = computePerformance([]);
  private zigzag: ZigZagState = EMPTY_ZIGZAG_STATE;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.closed1m = new Queue<Candle>(CHART_HISTORY_CANDLES);
    this.closed1h = new Queue<Candle>(CHART_HISTORY_CANDLES);
    this.quoteVol1m = new Queue<number>(QUOTE_VOLUME_WINDOW);
  }

  /** Pushes each candle into the 1m chart buffer. If ZIGZAG_TIMEFRAME is
   * '1m', also replays nextZigZagState() candle-by-candle so a freshly
   * started observer reconstructs true pivot state instead of starting
   * cold -- same replay discipline the old step1/step2 system used. */
  preloadClosed1m(candles: Candle[]): void {
    candles.forEach(c => {
      this.closed1m.push(c);
      if (ZIGZAG_TIMEFRAME === '1m') {
        this.zigzag = nextZigZagState(c, this.zigzag);
      }
    });
  }

  /** Same replay discipline as preloadClosed1m, for the 1h buffer -- only
   * advances the ZigZag detector if ZIGZAG_TIMEFRAME is '1h'. Always
   * recomputes performance once at the end (performance has no stickiness
   * or history dependency beyond "what's the buffer right now", unlike
   * ZigZag, so it doesn't need a per-candle recompute during replay). */
  preloadClosed1h(candles: Candle[]): void {
    candles.forEach(c => {
      this.closed1h.push(c);
      if (ZIGZAG_TIMEFRAME === '1h') {
        this.zigzag = nextZigZagState(c, this.zigzag);
      }
    });
    this.performance = computePerformance(this.closed1h.toArray());
  }

  /** Feeds the 24h rolling quote-volume window without touching the chart
   * buffer -- callers typically pass a longer history here than to
   * preloadClosed1m (e.g. 1440 candles vs. 200). */
  preloadQuoteVolume1m(candles: Candle[]): void {
    candles.forEach(c => this.pushQuoteVolume(c.quoteVolume ?? 0));
  }

  updateCandle1s(candle: Candle): void {
    this.currentPrice = candle.close;
  }

  updateCandle1m(candle: Candle): void {
    if (candle.isClosed) {
      this.closed1m.push(candle);
      this.pushQuoteVolume(candle.quoteVolume ?? 0);
      this.form1mCandle = null;
      if (ZIGZAG_TIMEFRAME === '1m') {
        this.zigzag = nextZigZagState(candle, this.zigzag);
      }
    } else {
      this.form1mCandle = candle;
    }
  }

  updateCandle1h(candle: Candle): void {
    if (candle.isClosed) {
      this.closed1h.push(candle);
      this.form1hCandle = null;
      this.performance = computePerformance(this.closed1h.toArray());
      if (ZIGZAG_TIMEFRAME === '1h') {
        this.zigzag = nextZigZagState(candle, this.zigzag);
      }
    } else {
      this.form1hCandle = candle;
    }
  }

  getState(): ObserverState {
    return { symbol: this.symbol, performance: this.performance, zigzag: this.zigzag };
  }

  /** Sum of the last (up to) 1440 closed 1m candles' quote volume. Below a
   * full window, this underestimates the true 24h volume -- self-corrects
   * as live data accumulates. */
  get24hQuoteVolume(): number {
    return this.quoteVolSum;
  }

  getCurrentPrice(): number | null {
    return this.currentPrice;
  }

  /** Closed candles for `timeframe` plus the live in-formation candle (if
   * any), as plain OHLC points. The forming candle's high/low are widened
   * by the current live price so the chart never shows a contradictory bar. */
  getChartData(timeframe: ChartTimeframe): ChartCandle[] {
    const closed = timeframe === '1m' ? this.closed1m.toArray() : this.closed1h.toArray();
    const formCandle = timeframe === '1m' ? this.form1mCandle : this.form1hCandle;

    const candles: ChartCandle[] = closed.map(c => ({
      openTime: c.openTime,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    if (formCandle !== null && this.currentPrice !== null) {
      candles.push({
        openTime: formCandle.openTime,
        open: formCandle.open,
        high: Math.max(formCandle.high, this.currentPrice),
        low: Math.min(formCandle.low, this.currentPrice),
        close: this.currentPrice,
      });
    }

    return candles;
  }

  private pushQuoteVolume(value: number): void {
    const evicted = this.quoteVol1m.push(value);
    this.quoteVolSum += value;
    if (evicted !== undefined) {
      this.quoteVolSum -= evicted;
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `backend/`): `node --test --require ts-node/register src/observers/Observer.test.ts`
Expected: PASS, all 20 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/observers/Observer.ts backend/src/observers/Observer.test.ts
git commit -m "feat: drive Observer's ZigZag detector from a single configured timeframe"
```

---

### Task 3: `ObserverManager` — detect confirmed pivots, emit `'pivot'`

**Files:**
- Modify: `backend/src/managers/ObserverManager.ts` (full rewrite)
- Modify: `backend/src/managers/ObserverManager.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `ObserverState.zigzag`/`.performance` from `Observer` (Task 2). `PivotEvent` from `backend/src/types/index.ts` (Task 1).
- Produces: `ObserverManager` emits `'pivot'` with a `PivotEvent` payload whenever a symbol's `zigzag.lastPivot` changes to a new confirmed pivot on that exact candle. The existing `'signal'` event keeps its shape (`ObserverState`) but its trigger condition changes from `reasonsChanged` to `pivotChanged`. `getQualifyingSymbols()` is removed. `chart:tick`/`chart:closed` now fire unconditionally (no more `state.qualifies` gate). No other method signatures change.

Do not run the full backend suite yet — `OrderManager.ts` and `BotManager.ts` are still broken (Task 4 fixes them, and is where the full suite finally runs green). Only run `ObserverManager.test.ts` on its own.

- [ ] **Step 1: Write the failing tests**

Replace the entire file `backend/src/managers/ObserverManager.test.ts` with:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObserverManager } from './ObserverManager';
import { Candle, ObserverState } from '../types';

function closedCandleAt(openTime: number, close: number): Candle {
  return { symbol: 'BTCUSDT', timeframe: '1m', openTime, open: close, high: close, low: close, close, isClosed: true };
}

/** Same 26-candle cold-start-confirms-MAX sequence verified in
 * backend/src/utils/zigzag.test.ts and backend/src/observers/Observer.test.ts:
 * seed at 110, then 25 candles declining by 0.1 each. The confirming candle
 * is index 20 (0-indexed) -- indices 0-19 do NOT confirm anything yet. */
function coldStartMaxSequence(startAt: number): Candle[] {
  const closes = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  return closes.map((close, i) => closedCandleAt(startAt + i, close));
}

function listenSignals(manager: ObserverManager): ObserverState[] {
  const signals: ObserverState[] = [];
  manager.on('signal', (state: ObserverState) => signals.push(state));
  return signals;
}

function listenPivots(manager: ObserverManager): Array<{ symbol: string; type: string; price: number }> {
  const pivots: Array<{ symbol: string; type: string; price: number }> = [];
  manager.on('pivot', (p: { symbol: string; type: string; price: number }) => pivots.push(p));
  return pivots;
}

test('candles before confirmation emit neither signal nor pivot', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');
  const signals = listenSignals(manager);
  const pivots = listenPivots(manager);

  const sequence = coldStartMaxSequence(0);
  sequence.slice(0, 20).forEach(c => manager.updateCandle(c)); // up to (not including) the confirming candle

  assert.equal(signals.length, 0);
  assert.equal(pivots.length, 0);
});

test('the candle that confirms a pivot emits both signal and pivot', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');

  const sequence = coldStartMaxSequence(0);
  sequence.slice(0, 20).forEach(c => manager.updateCandle(c));

  const signals = listenSignals(manager);
  const pivots = listenPivots(manager);

  manager.updateCandle(sequence[20]); // the confirming candle

  assert.equal(signals.length, 1);
  assert.deepEqual(signals[0].zigzag.lastPivot, { price: 110, type: 'max' });

  assert.equal(pivots.length, 1);
  assert.deepEqual(pivots[0], { symbol: 'BTCUSDT', type: 'max', price: 110 });
});

test('a further candle that does not confirm a new pivot emits neither event again', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');
  coldStartMaxSequence(0).forEach(c => manager.updateCandle(c)); // full sequence, already confirmed

  const signals = listenSignals(manager);
  const pivots = listenPivots(manager);

  const state = manager.getObserverState('BTCUSDT')!;
  manager.updateCandle(closedCandleAt(26, state.zigzag.extremePrice)); // exactly at the extreme -- extends, doesn't confirm

  assert.equal(signals.length, 0);
  assert.equal(pivots.length, 0);
});

test('a closed 1h candle emits signal even when zigzag does not change (performance-only update)', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');
  const signals = listenSignals(manager);

  manager.updateCandle({ symbol: 'BTCUSDT', timeframe: '1h', openTime: 0, open: 100, high: 100, low: 100, close: 100, isClosed: true });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].zigzag.direction, null); // 1h close doesn't touch zigzag (configured timeframe is 1m)
});

test('a second closed 1h candle also emits, carrying the updated performance', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');
  manager.updateCandle({ symbol: 'BTCUSDT', timeframe: '1h', openTime: 0, open: 100, high: 100, low: 100, close: 100, isClosed: true });

  const signals = listenSignals(manager);
  manager.updateCandle({ symbol: 'BTCUSDT', timeframe: '1h', openTime: 1, open: 110, high: 110, low: 110, close: 110, isClosed: true });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].performance.h1, ((110 - 100) / 100) * 100);
});

test('a non-closed (forming) 1h candle does not emit on its own', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');
  const signals = listenSignals(manager);

  manager.updateCandle({ symbol: 'BTCUSDT', timeframe: '1h', openTime: 0, open: 100, high: 100, low: 100, close: 100, isClosed: false });

  assert.equal(signals.length, 0);
});

test('chart:closed fires even for a symbol that has never confirmed a pivot (no qualification gate anymore)', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');

  const chartClosedEvents: unknown[] = [];
  manager.on('chart:closed', payload => chartClosedEvents.push(payload));

  // A single closed 1m candle: nowhere near enough history for any zigzag
  // pivot, yet chart:closed must still fire -- charts are no longer gated
  // on a qualification concept this feature removed entirely.
  manager.updateCandle(closedCandleAt(0, 100));

  assert.equal(chartClosedEvents.length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`): `node --test --require ts-node/register src/managers/ObserverManager.test.ts`
Expected: FAIL — `ObserverManager.ts` still reads `state.reasons`/`state.qualifies`, which no longer exist on `ObserverState`.

- [ ] **Step 3: Rewrite `backend/src/managers/ObserverManager.ts`**

Replace the entire file with:

```ts
import { EventEmitter } from 'events';
import { Observer } from '../observers/Observer';
import {
  Candle,
  ChartCandle,
  ChartData,
  ChartSeries,
  ChartSeriesPoint,
  ChartTimeframe,
  ObserverState,
} from '../types';
import { computeChartSeries } from '../utils/chartSeries';

/** REST/initial chart snapshots and the sliding client-side window both use
 * the last 100 candles; the Observer buffer (200 candles) holds more so
 * MA99 has a full lookback at the first visible point. */
const CHART_VISIBLE_CANDLES = 100;

export class ObserverManager extends EventEmitter {
  private observers: Map<string, Observer> = new Map();

  createObserver(symbol: string): void {
    if (!this.observers.has(symbol)) {
      this.observers.set(symbol, new Observer(symbol));
    }
  }

  createObservers(symbols: string[]): void {
    symbols.forEach(symbol => this.createObserver(symbol));
  }

  updateCandle(candle: Candle): void {
    const observer = this.observers.get(candle.symbol);
    if (!observer) return;

    const before = observer.getState();

    if (candle.timeframe === '1s') {
      observer.updateCandle1s(candle);
    } else if (candle.timeframe === '1m') {
      observer.updateCandle1m(candle);
    } else if (candle.timeframe === '1h') {
      observer.updateCandle1h(candle);
    }

    const state = observer.getState();

    // Reference inequality (not value equality) is the correct "did a new
    // pivot get confirmed on THIS candle" check: nextZigZagState() only
    // ever constructs a fresh `lastPivot` object inside its confirm
    // branches, so the object reference only changes exactly when a new
    // confirmation fires -- never on an "extending" or "no-op" update.
    const pivotChanged = state.zigzag.lastPivot !== null && state.zigzag.lastPivot !== before.zigzag.lastPivot;
    // Performance windows are recomputed on every closed 1h candle even
    // when zigzag doesn't change -- the broadcast must fire on that
    // trigger too, otherwise performance on the frontend would only
    // refresh on pivot confirmations.
    const is1hClose = candle.timeframe === '1h' && candle.isClosed;

    if (pivotChanged || is1hClose) {
      this.emit('signal', state); // UI-facing: unchanged shape, new trigger condition
    }
    if (pivotChanged) {
      this.emit('pivot', { symbol: candle.symbol, type: state.zigzag.lastPivot!.type, price: state.zigzag.lastPivot!.price }); // trading-facing
    }

    const m1 = this.getLatestChartPoint(candle.symbol, '1m');
    const h1 = this.getLatestChartPoint(candle.symbol, '1h');

    if (!candle.isClosed && m1 && h1) {
      this.emit('chart:tick', { symbol: candle.symbol, m1, h1 });
    }

    if (candle.isClosed && (candle.timeframe === '1m' || candle.timeframe === '1h')) {
      const point = candle.timeframe === '1m' ? m1 : h1;
      if (point) {
        this.emit('chart:closed', {
          symbol: candle.symbol,
          timeframe: candle.timeframe,
          candle: point.candle,
          series: point.series,
        });
      }
    }
  }

  getAllStates(): ObserverState[] {
    return Array.from(this.observers.values()).map(obs => obs.getState());
  }

  getObserverState(symbol: string): ObserverState | null {
    return this.observers.get(symbol)?.getState() ?? null;
  }

  /** Last 100 candles + index-aligned indicator series for `symbol`/`timeframe`.
   * Computes indicators over the FULL buffer first (so MA99 has its 99-candle
   * lookback), then slices both candles and series to the visible window. */
  getChartData(symbol: string, timeframe: ChartTimeframe): ChartData | null {
    const observer = this.observers.get(symbol);
    if (!observer) return null;

    const allCandles = observer.getChartData(timeframe);
    const fullSeries = computeChartSeries(allCandles.map(c => c.close));

    const candles = allCandles.slice(-CHART_VISIBLE_CANDLES);
    const series: ChartSeries = {
      ma20: fullSeries.ma20.slice(-CHART_VISIBLE_CANDLES),
      ma99: fullSeries.ma99.slice(-CHART_VISIBLE_CANDLES),
      bbUpper: fullSeries.bbUpper.slice(-CHART_VISIBLE_CANDLES),
      bbLower: fullSeries.bbLower.slice(-CHART_VISIBLE_CANDLES),
    };

    return { symbol, timeframe, candles, series };
  }

  private getLatestChartPoint(
    symbol: string,
    timeframe: ChartTimeframe
  ): { candle: ChartCandle; series: ChartSeriesPoint } | null {
    const data = this.getChartData(symbol, timeframe);
    if (!data || data.candles.length === 0) return null;

    const lastIndex = data.candles.length - 1;
    return {
      candle: data.candles[lastIndex],
      series: {
        ma20: data.series.ma20[lastIndex],
        ma99: data.series.ma99[lastIndex],
        bbUpper: data.series.bbUpper[lastIndex],
        bbLower: data.series.bbLower[lastIndex],
      },
    };
  }

  preloadObserver1m(symbol: string, candles: Candle[]): void {
    this.observers.get(symbol)?.preloadClosed1m(candles);
  }

  preloadObserver1h(symbol: string, candles: Candle[]): void {
    this.observers.get(symbol)?.preloadClosed1h(candles);
  }

  preloadObserverVolume(symbol: string, candles: Candle[]): void {
    this.observers.get(symbol)?.preloadQuoteVolume1m(candles);
  }

  getQuoteVolume24h(symbol: string): number | null {
    const observer = this.observers.get(symbol);
    return observer ? observer.get24hQuoteVolume() : null;
  }

  getCurrentPrice(symbol: string): number | null {
    const observer = this.observers.get(symbol);
    return observer ? observer.getCurrentPrice() : null;
  }

  getSymbols(): string[] {
    return Array.from(this.observers.keys());
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `backend/`): `node --test --require ts-node/register src/managers/ObserverManager.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/managers/ObserverManager.ts backend/src/managers/ObserverManager.test.ts
git commit -m "feat: emit 'pivot' on confirmed ZigZag pivots, drop qualification gate from chart events"
```

---

### Task 4: `OrderManager` + `BotManager` + REST routes — wire pivots to trading

**Files:**
- Modify: `backend/src/managers/OrderManager.ts` (full rewrite)
- Modify: `backend/src/managers/OrderManager.test.ts` (full rewrite)
- Modify: `backend/src/managers/BotManager.ts` (full rewrite)
- Modify: `backend/src/routes/api.ts` (full rewrite)

**Interfaces:**
- Consumes: `PivotEvent` from `backend/src/types/index.ts` (Task 1). `ObserverManager`'s `'pivot'` event (Task 3).
- Produces: `OrderManager.sellAtPrice(symbol: string, price: number): void` (new). `OrderManager.buy()` keeps its exact signature (`symbol, price, quoteVolume24h`) but no longer computes/stores `targetPrice`. `OrderManager.onPriceTick()` is removed. `BotManager` exposes no new public API — its constructor/`start()`/`stop()`/public readonly fields (`symbolManager`, `observerManager`, `orderManager`) are unchanged.

This is the last task in the backend chain broken by Task 1's types edit — run the FULL backend suite and `tsc --noEmit` for the first time at the end of this task.

- [ ] **Step 1: Write the failing tests**

Replace the entire file `backend/src/managers/OrderManager.test.ts` with:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrderManager } from './OrderManager';

const HIGH_VOLUME = 1_000_000_000; // large enough that MAX_ORDER_USDT (10_000) is always the binding cap

test('buy opens an active order sized by computeOrderSize, deducting balance', () => {
  const manager = new OrderManager();
  const order = manager.buy('BTCUSDT', 100, HIGH_VOLUME);

  assert.ok(order !== null);
  assert.equal(order!.symbol, 'BTCUSDT');
  assert.equal(order!.buyPrice, 100);
  assert.equal(order!.usdtSpent, 10_000); // capped by MAX_ORDER_USDT
  assert.ok(manager.hasActiveOrder('BTCUSDT'));
  assert.equal(manager.getStatus().balance, 0); // 10_000 initial - 10_000 spent
});

test('buy returns null and does not open a second order for a symbol that already has one active', () => {
  const manager = new OrderManager();
  manager.buy('BTCUSDT', 100, HIGH_VOLUME);
  const second = manager.buy('BTCUSDT', 105, HIGH_VOLUME);

  assert.equal(second, null);
  assert.equal(manager.getStatus().activeOrders.length, 1);
});

test('buy returns null when the computed order size is 0 (no quote volume)', () => {
  const manager = new OrderManager();
  const order = manager.buy('BTCUSDT', 100, 0);
  assert.equal(order, null);
  assert.equal(manager.hasActiveOrder('BTCUSDT'), false);
});

test('multiple symbols can have concurrent active orders', () => {
  const manager = new OrderManager();
  // Use a moderate quoteVolume for the first buy so it doesn't consume the
  // entire shared 10,000 USDT balance (MAX_ORDER_USDT == INITIAL_BALANCE,
  // so a HIGH_VOLUME/max-capped buy would leave nothing for a second order).
  const MODERATE_VOLUME = 30_000_000; // 30_000_000 * 0.0001 = 3_000 USDT order
  manager.buy('BTCUSDT', 100, MODERATE_VOLUME);
  manager.buy('ETHUSDT', 50, HIGH_VOLUME);

  assert.ok(manager.hasActiveOrder('BTCUSDT'));
  assert.ok(manager.hasActiveOrder('ETHUSDT'));
  assert.equal(manager.getStatus().activeOrders.length, 2);
});

test('sellAtPrice does nothing for a symbol with no active order', () => {
  const manager = new OrderManager();
  manager.sellAtPrice('BTCUSDT', 1000);
  assert.equal(manager.getStatus().activeOrders.length, 0);
  assert.equal(manager.getStatus().completedCount, 0);
});

test('sellAtPrice closes the order at the given price and credits balance', () => {
  const manager = new OrderManager();
  manager.buy('BTCUSDT', 100, HIGH_VOLUME);
  manager.sellAtPrice('BTCUSDT', 105);

  assert.equal(manager.hasActiveOrder('BTCUSDT'), false);
  const status = manager.getStatus();
  assert.equal(status.completedCount, 1);
  assert.equal(status.activeOrders.length, 0);
  assert.ok(status.balance > 0); // got usdtReceived back
});

test('sellAtPrice can close at a price below the buy price (a loss) -- no protection, activation only', () => {
  const manager = new OrderManager();
  manager.buy('BTCUSDT', 100, HIGH_VOLUME);
  manager.sellAtPrice('BTCUSDT', 90);

  assert.equal(manager.hasActiveOrder('BTCUSDT'), false);
  const status = manager.getStatus();
  assert.equal(status.completedCount, 1);
  assert.ok(status.totalProfitPct < 0, `expected a loss, got ${status.totalProfitPct}`);
});

test('totalProfitPct is 0 with no completed orders, and reflects profit/invested once one completes', () => {
  const manager = new OrderManager();
  assert.equal(manager.getStatus().totalProfitPct, 0);

  manager.buy('BTCUSDT', 100, HIGH_VOLUME);
  manager.sellAtPrice('BTCUSDT', 100.5);

  const status = manager.getStatus();
  // ~0.5% price move minus ~0.2% round-trip fees ≈ +0.3%
  assert.ok(status.totalProfitPct > 0.2 && status.totalProfitPct < 0.4, `expected ~0.3%, got ${status.totalProfitPct}`);
});

test('a symbol can be bought again once its previous order completes', () => {
  const manager = new OrderManager();
  manager.buy('BTCUSDT', 100, HIGH_VOLUME);
  manager.sellAtPrice('BTCUSDT', 100.5);

  const second = manager.buy('BTCUSDT', 200, HIGH_VOLUME);
  assert.ok(second !== null);
  assert.ok(manager.hasActiveOrder('BTCUSDT'));
});

test('emits opened and completed events with the expected payload shape', () => {
  const manager = new OrderManager();
  const openedPayloads: Array<{ order: { symbol: string }; balance: number }> = [];
  const completedPayloads: Array<{ order: { symbol: string }; balance: number; completedCount: number; totalProfitPct: number }> = [];
  manager.on('opened', (payload) => { openedPayloads.push(payload); });
  manager.on('completed', (payload) => { completedPayloads.push(payload); });

  manager.buy('BTCUSDT', 100, HIGH_VOLUME);
  assert.equal(openedPayloads.length, 1);
  assert.equal(openedPayloads[0].order.symbol, 'BTCUSDT');
  assert.equal(typeof openedPayloads[0].balance, 'number');

  manager.sellAtPrice('BTCUSDT', 100.5);
  assert.equal(completedPayloads.length, 1);
  assert.equal(completedPayloads[0].order.symbol, 'BTCUSDT');
  assert.equal(typeof completedPayloads[0].balance, 'number');
  assert.equal(completedPayloads[0].completedCount, 1);
  assert.equal(typeof completedPayloads[0].totalProfitPct, 'number');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`): `node --test --require ts-node/register src/managers/OrderManager.test.ts`
Expected: FAIL — `OrderManager.ts` still has `onPriceTick`/`targetPrice`, no `sellAtPrice`.

- [ ] **Step 3: Rewrite `backend/src/managers/OrderManager.ts`**

Replace the entire file with:

```ts
import { EventEmitter } from 'events';
import { ActiveOrder, CompletedOrder, OrderStatus } from '../types';
import { computeOrderSize, OrderSizeConfig } from '../utils/orderSize';

const INITIAL_BALANCE = 10_000;
const FEE = 0.001; // 0.1% on buy (asset) and sell (usdt)
const ORDER_SIZE_CONFIG: OrderSizeConfig = { factor: 0.0001, maxUsdt: 10_000 };

export class OrderManager extends EventEmitter {
  private balance: number = INITIAL_BALANCE;
  private activeOrders: Map<string, ActiveOrder> = new Map();
  private completedOrders: CompletedOrder[] = [];

  hasActiveOrder(symbol: string): boolean {
    return this.activeOrders.has(symbol);
  }

  computeOrderSize(quoteVolume24h: number): number {
    return computeOrderSize(this.balance, quoteVolume24h, ORDER_SIZE_CONFIG);
  }

  buy(symbol: string, price: number, quoteVolume24h: number): ActiveOrder | null {
    if (this.activeOrders.has(symbol)) return null;

    const orderSize = this.computeOrderSize(quoteVolume24h);
    if (orderSize <= 0) return null;

    const rawQuantity = orderSize / price;
    const quantity = rawQuantity * (1 - FEE);

    this.balance -= orderSize;
    const order: ActiveOrder = {
      symbol,
      buyPrice: price,
      quantity,
      usdtSpent: orderSize,
      openedAt: Date.now(),
    };
    this.activeOrders.set(symbol, order);

    console.log(`[Order] BUY  ${symbol} @ ${price} | size: ${orderSize.toFixed(2)} USDT | qty: ${quantity.toFixed(6)}`);
    this.emit('opened', { order, balance: this.balance });
    return order;
  }

  /** Closes the active order for `symbol` at `price` -- called when the
   * Observer's ZigZag detector confirms a máximo, replacing the old
   * price-target check. No-op if there's no active order (nothing to
   * sell) -- same guard the old onPriceTick had. */
  sellAtPrice(symbol: string, price: number): void {
    const order = this.activeOrders.get(symbol);
    if (!order) return;
    this.complete(order, price);
  }

  getStatus(): OrderStatus {
    return {
      balance: this.balance,
      activeOrders: Array.from(this.activeOrders.values()),
      completedCount: this.completedOrders.length,
      totalProfitPct: this.getTotalProfitPct(),
    };
  }

  private complete(order: ActiveOrder, price: number): void {
    const rawUsdt = order.quantity * price;
    const usdtReceived = rawUsdt * (1 - FEE);
    const profit = usdtReceived - order.usdtSpent;
    const profitPct = (profit / order.usdtSpent) * 100;
    const closedAt = Date.now();

    const completed: CompletedOrder = {
      ...order,
      sellPrice: price,
      usdtReceived,
      profit,
      profitPct,
      closedAt,
      durationMs: closedAt - order.openedAt,
    };

    this.activeOrders.delete(order.symbol);
    this.completedOrders.push(completed);
    this.balance += usdtReceived;

    console.log(`[Order] SELL ${completed.symbol} @ ${price} | profit: ${profit.toFixed(4)} USDT (${profitPct.toFixed(3)}%) | balance: ${this.balance.toFixed(4)}`);
    this.emit('completed', {
      order: completed,
      balance: this.balance,
      completedCount: this.completedOrders.length,
      totalProfitPct: this.getTotalProfitPct(),
    });
  }

  private getTotalProfitPct(): number {
    if (this.completedOrders.length === 0) return 0;
    const totalProfit = this.completedOrders.reduce((sum, o) => sum + o.profit, 0);
    const totalInvested = this.completedOrders.reduce((sum, o) => sum + o.usdtSpent, 0);
    return totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
  }
}
```

- [ ] **Step 4: Run the OrderManager tests to verify they pass**

Run (from `backend/`): `node --test --require ts-node/register src/managers/OrderManager.test.ts`
Expected: PASS, all 10 tests.

- [ ] **Step 5: Rewrite `backend/src/managers/BotManager.ts`**

Replace the entire file with:

```ts
import { SymbolManager } from '../services/symbolManager';
import { ObserverManager } from './ObserverManager';
import { OrderManager } from './OrderManager';
import { BinanceWebSocket } from '../services/binanceWebSocket';
import { fetchHistoricalCandles, fetchClosedHourCandles } from '../services/historicalCandles';
import { PivotEvent } from '../types';

/** Chart/detection buffer size -- unchanged from before. */
const CHART_PRELOAD_CANDLES = 200;

/** 24h of 1m candles (60 * 24), used to warm up the liquidity-based
 * order-sizing volume window (see observers/Observer.ts). The same fetch
 * also supplies the chart/detection buffer (its most recent 200 candles). */
const VOLUME_PRELOAD_CANDLES = 1440;

/** Symbols the ZigZag auto-trader is allowed to act on. The Observer
 * computes ZigZag state for every symbol (cheap, generic) -- this set is
 * what turns that state into actual buy/sell calls. Mirrored on the
 * frontend in ChartGrid.tsx; keep both in sync by hand. */
const ZIGZAG_ENABLED_SYMBOLS = new Set(['BTCUSDT']);

export class BotManager {
  readonly symbolManager: SymbolManager;
  readonly observerManager: ObserverManager;
  readonly orderManager: OrderManager;
  private ws: BinanceWebSocket | null = null;

  constructor() {
    this.symbolManager = new SymbolManager();
    this.observerManager = new ObserverManager();
    this.orderManager = new OrderManager();
  }

  async start(): Promise<void> {
    await this.symbolManager.load();

    const symbols = this.symbolManager.getSymbols();
    this.observerManager.createObservers(symbols);
    await this.preloadObservers(symbols);

    this.observerManager.on('pivot', (pivot: PivotEvent) => {
      if (!ZIGZAG_ENABLED_SYMBOLS.has(pivot.symbol)) return;
      if (pivot.type === 'min') {
        const quoteVolume24h = this.observerManager.getQuoteVolume24h(pivot.symbol) ?? 0;
        this.orderManager.buy(pivot.symbol, pivot.price, quoteVolume24h);
      } else {
        this.orderManager.sellAtPrice(pivot.symbol, pivot.price);
      }
    });

    this.ws = new BinanceWebSocket(symbols);
    this.ws.on('candle', candle => {
      this.observerManager.updateCandle(candle);
    });
    this.ws.connect();
  }

  stop(): void {
    this.ws?.destroy();
    this.symbolManager.destroy();
  }

  private async preloadObservers(symbols: string[]): Promise<void> {
    console.log(`[Preload] Fetching historical 1m candles for ${symbols.length} symbols...`);

    const results = await Promise.allSettled(
      symbols.map(async symbol => {
        const candles = await fetchHistoricalCandles(symbol, VOLUME_PRELOAD_CANDLES);
        this.observerManager.preloadObserver1m(symbol, candles.slice(-CHART_PRELOAD_CANDLES));
        this.observerManager.preloadObserverVolume(symbol, candles);
      })
    );

    const ok = results.filter(r => r.status === 'fulfilled').length;
    results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .forEach(r => console.error('[Preload] 1m candles failed:', r.reason));

    console.log(`[Preload] Done — ${ok}/${symbols.length} observers' 1m/volume windows loaded`);

    const hourResults = await Promise.allSettled(
      symbols.map(async symbol => {
        const candles = await fetchClosedHourCandles(symbol, CHART_PRELOAD_CANDLES);
        this.observerManager.preloadObserver1h(symbol, candles);
      })
    );

    const hourOk = hourResults.filter(r => r.status === 'fulfilled').length;
    hourResults
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .forEach(r => console.error('[Preload] 1h candles failed:', r.reason));

    console.log(`[Preload] Done — ${hourOk}/${symbols.length} symbols' 1h windows loaded`);
  }
}
```

- [ ] **Step 6: Rewrite `backend/src/routes/api.ts`**

Replace the entire file with:

```ts
import { Router, Request, Response } from 'express';
import { BotManager } from '../managers/BotManager';

export function createRouter(bot: BotManager): Router {
  const router = Router();

  router.get('/symbols', (_req: Request, res: Response) => {
    res.json({
      symbols: bot.symbolManager.getSymbols(),
      lastUpdated: bot.symbolManager.getLastUpdated(),
    });
  });

  router.get('/observers', (_req: Request, res: Response) => {
    res.json({ data: bot.observerManager.getAllStates() });
  });

  router.get('/observers/:symbol', (req: Request, res: Response) => {
    const symbol = req.params.symbol.toUpperCase();
    const state = bot.observerManager.getObserverState(symbol);
    if (!state) {
      res.status(404).json({ error: `Symbol ${symbol} not found` });
      return;
    }
    res.json({ data: state });
  });

  router.get('/observers/:symbol/chart', (req: Request, res: Response) => {
    const symbol = req.params.symbol.toUpperCase();
    const timeframe = req.query.timeframe;

    if (timeframe !== '1m' && timeframe !== '1h') {
      res.status(400).json({ error: `timeframe must be '1m' or '1h'` });
      return;
    }

    const data = bot.observerManager.getChartData(symbol, timeframe);
    if (!data) {
      res.status(404).json({ error: `Symbol ${symbol} not found` });
      return;
    }

    res.json({ data });
  });

  router.get('/orders', (_req: Request, res: Response) => {
    res.json({ data: bot.orderManager.getStatus() });
  });

  router.get('/orders/sizes', (req: Request, res: Response) => {
    const symbolsParam = typeof req.query.symbols === 'string' ? req.query.symbols : '';
    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

    const sizes: Record<string, number> = {};
    for (const symbol of symbols) {
      const quoteVolume24h = bot.observerManager.getQuoteVolume24h(symbol);
      sizes[symbol] = quoteVolume24h === null ? 0 : bot.orderManager.computeOrderSize(quoteVolume24h);
    }

    res.json({ data: { balance: bot.orderManager.getStatus().balance, sizes } });
  });

  return router;
}
```

- [ ] **Step 7: Run the full backend suite and type check**

Run (from `backend/`): `node --test --require ts-node/register 'src/**/*.test.ts'`
Expected: PASS, all tests (this is the first time since Task 1 that the whole backend compiles and runs together).

Run (from `backend/`): `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add backend/src/managers/OrderManager.ts backend/src/managers/OrderManager.test.ts backend/src/managers/BotManager.ts backend/src/routes/api.ts
git commit -m "feat: wire ZigZag pivots to automatic buy/sell, remove manual-buy and price-target routes"
```

---

### Task 5: Frontend types + delete `chartGrouping`

**Files:**
- Modify: `frontend/src/types/index.ts` (full rewrite)
- Delete: `frontend/src/components/chartGrouping.ts`, `frontend/src/components/chartGrouping.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (mirrors Task 1's backend shapes by hand, per this codebase's established convention of no shared type package).
- Produces: `PivotType`, `Pivot`, `ZigZagState`, `ObserverData` (`{symbol, performance, zigzag}`), `ActiveOrder` (no `targetPrice`) — all mirrored field-for-field from the backend.

This edit breaks `ChartGrid.tsx`, `SymbolChartCard.tsx`, `OrdersView.tsx`, and `App.tsx` (all reference removed fields) — Tasks 6–7 fix them. Do not run `tsc`/the frontend suite yet.

- [ ] **Step 1: Delete `chartGrouping.ts` and its test**

```bash
git rm frontend/src/components/chartGrouping.ts frontend/src/components/chartGrouping.test.ts
```

- [ ] **Step 2: Rewrite `frontend/src/types/index.ts`**

Replace the entire file with:

```ts
export type PivotType = 'min' | 'max';

export interface Pivot {
  price: number;
  type: PivotType;
}

export interface ZigZagState {
  direction: 'up' | 'down' | null;
  pendingHigh: number;
  pendingHighBars: number;
  pendingLow: number;
  pendingLowBars: number;
  extremePrice: number;
  barsSinceExtreme: number;
  lastPivot: Pivot | null;
}

export interface PerformanceWindows {
  h24: number | null;
  h12: number | null;
  h6: number | null;
  h3: number | null;
  h1: number | null;
}

export interface ObserverData {
  symbol: string;
  performance: PerformanceWindows;
  zigzag: ZigZagState;
}

export interface ApiResponse<T> {
  data: T;
}

export type ChartTimeframe = '1m' | '1h';

export interface ChartCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartSeriesPoint {
  ma20: number | null;
  ma99: number | null;
  bbUpper: number | null;
  bbLower: number | null;
}

export interface ChartSeries {
  ma20: (number | null)[];
  ma99: (number | null)[];
  bbUpper: (number | null)[];
  bbLower: (number | null)[];
}

export interface ChartData {
  symbol: string;
  timeframe: ChartTimeframe;
  candles: ChartCandle[];
  series: ChartSeries;
}

export interface ChartTickEvent {
  symbol: string;
  m1: { candle: ChartCandle; series: ChartSeriesPoint };
  h1: { candle: ChartCandle; series: ChartSeriesPoint };
}

export interface ChartClosedEvent {
  symbol: string;
  timeframe: ChartTimeframe;
  candle: ChartCandle;
  series: ChartSeriesPoint;
}

export interface ActiveOrder {
  symbol: string;
  buyPrice: number;
  quantity: number;
  usdtSpent: number;
  openedAt: number;
}

export interface CompletedOrder extends ActiveOrder {
  sellPrice: number;
  usdtReceived: number;
  profit: number;
  profitPct: number;
  closedAt: number;
  durationMs: number;
}

export interface OrderStatus {
  balance: number;
  activeOrders: ActiveOrder[];
  completedCount: number;
  totalProfitPct: number;
}

export interface OrderOpenedEvent {
  order: ActiveOrder;
  balance: number;
}

export interface OrderCompletedEvent {
  order: CompletedOrder;
  balance: number;
  completedCount: number;
  totalProfitPct: number;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat: mirror ZigZag/performance types on the frontend, drop step1/step2 types"
```

(`git rm` from Step 1 stages the deletions automatically — they'll be included in this commit since they're already staged.)

---

### Task 6: `ChartGrid.tsx` + `SymbolChartCard.tsx` — drop Ready/Watching/Buy, show ZigZag state

**Files:**
- Modify: `frontend/src/components/ChartGrid.tsx` (full rewrite)
- Modify: `frontend/src/components/SymbolChartCard.tsx` (full rewrite)

**Interfaces:**
- Consumes: `ObserverData`, `ZigZagState`, `PerformanceWindows` from `frontend/src/types/index.ts` (Task 5).
- Produces: `SymbolChartCard` props become `{ symbol: string; zigzag: ZigZagState; performance: PerformanceWindows; activeOrder: ActiveOrder | null; orderSize: number }` — no more `isPinned`/`onTogglePin`/`isReady`/`onBuy`.

Both files must land together — `ChartGrid.tsx` passes `zigzag`/no-`onBuy` props that only make sense once `SymbolChartCard.tsx` is updated to match. `OrdersView.tsx`/`App.tsx` (Task 7) are still broken after this task — don't run the frontend suite/`tsc` yet.

- [ ] **Step 1: Rewrite `frontend/src/components/ChartGrid.tsx`**

Replace the entire file with:

```tsx
import { ObserverData } from '../types';
import { SymbolChartCard } from './SymbolChartCard';
import { useOrders } from '../hooks/useOrders';
import { useOrderSizes } from '../hooks/useOrderSizes';

interface Props {
  observers: ObserverData[];
}

/** Mirrors backend/src/managers/BotManager.ts's ZIGZAG_ENABLED_SYMBOLS --
 * that constant is the source of truth; keep both in sync by hand. */
const ZIGZAG_ENABLED_SYMBOLS = new Set(['BTCUSDT']);

export function ChartGrid({ observers }: Props) {
  const { activeOrders } = useOrders();

  const enabled = observers.filter(o => ZIGZAG_ENABLED_SYMBOLS.has(o.symbol));
  const { sizes } = useOrderSizes(enabled.map(o => o.symbol));

  if (enabled.length === 0) {
    return <p className="text-gray-500 text-sm">No ZigZag-enabled symbols yet.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {enabled.map(o => (
        <SymbolChartCard
          key={o.symbol}
          symbol={o.symbol}
          zigzag={o.zigzag}
          performance={o.performance}
          activeOrder={activeOrders.find(order => order.symbol === o.symbol) ?? null}
          orderSize={sizes[o.symbol] ?? 0}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `frontend/src/components/SymbolChartCard.tsx`**

Replace the entire file with:

```tsx
import { useState } from 'react';
import { ActiveOrder, ChartTimeframe, PerformanceWindows, ZigZagState } from '../types';
import { SymbolChart } from './SymbolChart';
import { useSymbolChartData } from '../hooks/useSymbolChartData';

interface Props {
  symbol: string;
  zigzag: ZigZagState;
  performance: PerformanceWindows;
  activeOrder: ActiveOrder | null;
  orderSize: number;
}

const TIMEFRAMES: ChartTimeframe[] = ['1m', '1h'];

const PERFORMANCE_WINDOWS: { key: keyof PerformanceWindows; label: string }[] = [
  { key: 'h24', label: '24h' },
  { key: 'h12', label: '12h' },
  { key: 'h6', label: '6h' },
  { key: 'h3', label: '3h' },
  { key: 'h1', label: '1h' },
];

/** All symbols in this app are USDT pairs (e.g. "BTCUSDT" -> "BTC_USDT"). */
function binanceSpotUrl(symbol: string): string {
  const base = symbol.slice(0, -4);
  return `https://www.binance.com/es-AR/trade/${base}_USDT?type=spot`;
}

function fmtPrice(value: number): string {
  return value.toFixed(6);
}

function fmtPerf(value: number | null): string {
  if (value === null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function perfColor(value: number | null): string {
  if (value === null) return 'text-gray-500';
  return value >= 0 ? 'text-green-400' : 'text-red-400';
}

function fmtZigZag(zigzag: ZigZagState): string {
  const arrow = zigzag.direction === 'up' ? '↑' : zigzag.direction === 'down' ? '↓' : '—';
  const last = zigzag.lastPivot ? `${zigzag.lastPivot.type.toUpperCase()} @ ${fmtPrice(zigzag.lastPivot.price)}` : 'no pivot yet';
  return `${arrow} ${last}`;
}

export function SymbolChartCard({ symbol, zigzag, performance, activeOrder, orderSize }: Props) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1m');
  const { candles, series, loading, error } = useSymbolChartData(symbol, timeframe);

  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : null;

  return (
    <div className="rounded border border-gray-800 bg-gray-900 p-3">
      <div className="flex items-center justify-between mb-2">
        <a
          href={binanceSpotUrl(symbol)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-sm text-yellow-400 hover:underline truncate"
        >
          {symbol}
        </a>
        <div className="flex rounded overflow-hidden border border-gray-700">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-0.5 text-xs ${
                timeframe === tf ? 'bg-yellow-400 text-black' : 'bg-gray-800 text-gray-400'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-2 text-xs font-mono text-gray-300">
        ZigZag: {fmtZigZag(zigzag)}
      </div>

      <div className="flex items-center justify-between mb-2 text-[10px] font-mono">
        {PERFORMANCE_WINDOWS.map(({ key, label }) => (
          <div key={key} className="flex flex-col items-center gap-0.5">
            <span className="text-gray-500">{label}</span>
            <span className={perfColor(performance[key])}>{fmtPerf(performance[key])}</span>
          </div>
        ))}
      </div>

      <SymbolChart candles={candles} series={series} loading={loading} error={error} />

      <div className="mt-2 pt-2 border-t border-gray-800 flex items-center justify-between text-xs font-mono">
        <div className="flex flex-col gap-0.5 text-gray-400">
          <span>Price: <span className="text-gray-200">{currentPrice !== null ? fmtPrice(currentPrice) : '—'}</span></span>
          <span>Size: <span className="text-gray-200">{orderSize.toFixed(2)} USDT</span></span>
        </div>
        {activeOrder && (
          <div className="text-right text-yellow-400">
            <div>Active</div>
            <div className="text-gray-400">buy {fmtPrice(activeOrder.buyPrice)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Defer verification to Task 7**

`OrdersView.tsx` and `App.tsx` still reference removed fields (`order.targetPrice`, `o.qualifies`), so `npx tsc --noEmit` will currently fail on those files. Do not run the type check or commit yet — proceed directly into Task 7, which fixes both and is where both files are verified and committed together with this one's changes still staged.

Actually: since Tasks 6 and 7 are separate commits (unlike some earlier combined tasks in this project's history), commit this task's changes now — a temporarily-uncompiling intermediate commit is fine here because it's fixed by the very next task in the same sitting, and each task's diff needs to stay reviewable on its own. Run this instead:

```bash
git add frontend/src/components/ChartGrid.tsx frontend/src/components/SymbolChartCard.tsx
git commit -m "feat: replace Ready/Watching/manual-Buy grid with a single ZigZag-enabled-symbols view"
```

---

### Task 7: `OrdersView.tsx` + `App.tsx` — drop the last removed-field references

**Files:**
- Modify: `frontend/src/components/OrdersView.tsx:46-61`
- Modify: `frontend/src/App.tsx:9-22`

**Interfaces:**
- Consumes: `ActiveOrder` (no `targetPrice`) from `frontend/src/types/index.ts` (Task 5).
- Produces: no new exports — this is the final piece needed for the frontend to compile again.

This is the last task in the frontend chain broken by Task 5's types edit — run the full frontend suite, `tsc`, and `vite build` for the first time at the end of this task.

- [ ] **Step 1: Edit `frontend/src/components/OrdersView.tsx`**

Replace lines 46-61:

```tsx
        <table className="w-full text-xs font-mono text-left">
          <thead className="text-gray-500 border-b border-gray-800">
            <tr>
              <th className="py-1 pr-4">Symbol</th>
              <th className="py-1 pr-4">Buy price</th>
              <th className="py-1 pr-4">Target</th>
              <th className="py-1 pr-4">Open for</th>
            </tr>
          </thead>
          <tbody>
            {activeOrders.map(order => (
              <tr key={order.symbol} className="border-b border-gray-900">
                <td className="py-1 pr-4 text-yellow-400">{order.symbol}</td>
                <td className="py-1 pr-4">{fmtPrice(order.buyPrice)}</td>
                <td className="py-1 pr-4 text-green-400">{fmtPrice(order.targetPrice)}</td>
                <td className="py-1 pr-4 text-gray-400">{fmtElapsed(order.openedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
```

with:

```tsx
        <table className="w-full text-xs font-mono text-left">
          <thead className="text-gray-500 border-b border-gray-800">
            <tr>
              <th className="py-1 pr-4">Symbol</th>
              <th className="py-1 pr-4">Buy price</th>
              <th className="py-1 pr-4">Open for</th>
            </tr>
          </thead>
          <tbody>
            {activeOrders.map(order => (
              <tr key={order.symbol} className="border-b border-gray-900">
                <td className="py-1 pr-4 text-yellow-400">{order.symbol}</td>
                <td className="py-1 pr-4">{fmtPrice(order.buyPrice)}</td>
                <td className="py-1 pr-4 text-gray-400">{fmtElapsed(order.openedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
```

- [ ] **Step 2: Edit `frontend/src/App.tsx`**

Replace lines 9-22:

```tsx
  const { observers, connected } = useSocket();
  const [tab, setTab] = useState<Tab>('charts');
  const observerList = Array.from(observers.values());
  const qualifyingCount = observerList.filter(o => o.qualifies).length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            <span className="text-yellow-400">SPOT</span>
            <span className="text-gray-400 font-light ml-1">BOT</span>
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Signal detector — {qualifyingCount} qualifying</p>
        </div>
```

with:

```tsx
  const { observers, connected } = useSocket();
  const [tab, setTab] = useState<Tab>('charts');
  const observerList = Array.from(observers.values());

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            <span className="text-yellow-400">SPOT</span>
            <span className="text-gray-400 font-light ml-1">BOT</span>
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">ZigZag auto-trader</p>
        </div>
```

- [ ] **Step 3: Run the full frontend suite, type check, and build**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: 0 errors (first time since Task 5 that the whole frontend compiles together).

Run (from `frontend/`): `TS_NODE_PROJECT=tsconfig.test.json node --require ts-node/register --test 'src/**/*.test.ts'`
Expected: PASS, all tests (this feature adds no new frontend test files — the removed `chartGrouping.test.ts` accounts for the drop in count vs. before; `useSymbolChartData.test.ts` is untouched and still passes).

Run (from `frontend/`): `npx vite build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/OrdersView.tsx frontend/src/App.tsx
git commit -m "feat: drop remaining qualifies/targetPrice references from OrdersView and App header"
```

---

### Task 8: Full-stack live verification

**Files:** none (verification only, no code changes).

**Interfaces:** none.

- [ ] **Step 1: Run the full backend suite and type check**

Run (from `backend/`): `node --test --require ts-node/register 'src/**/*.test.ts'`
Expected: PASS, all tests.

Run (from `backend/`): `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2: Run the full frontend suite, type check, and build**

Run (from `frontend/`): `TS_NODE_PROJECT=tsconfig.test.json node --require ts-node/register --test 'src/**/*.test.ts'`
Expected: PASS, all tests.

Run (from `frontend/`): `npx tsc --noEmit`
Expected: 0 errors.

Run (from `frontend/`): `npx vite build`
Expected: build succeeds.

- [ ] **Step 3: Live browser verification**

Start both servers (backend, then frontend via Vite). Wait for backend preload logs to confirm historical candles loaded for all symbols (unchanged preload pipeline — still fetches all symbols, only `BTCUSDT` is auto-traded). Open the frontend in a browser.

Confirm:
- The Charts tab shows exactly one card: `BTCUSDT`.
- The card shows a "ZigZag: <arrow> <last pivot or 'no pivot yet'>" line, the 5 performance values, the price/size footer, and no Buy button, no pin icon, no READY badge.
- The header no longer shows a qualifying-symbols count.
- The Active Orders tab still renders (empty, since nothing has bought/sold yet in this short session) with a Symbol/Buy price/Open for table (no Target column).
- No console errors.
- `GET /api/observers/BTCUSDT` (or the browser's network tab) shows a JSON body shaped `{ data: { symbol, performance, zigzag } }` — no `qualifies`/`reasons`.

Live pivot-triggered trading cannot be observed in a short manual session — real BTC ZigZag pivots confirm roughly every several hours on the 1m timeframe (independently measured against `history/BTCUSDT/BTCUSDT_1m.csv` while writing this plan's design spec: ~35 pivots across 20,000 1m candles, ~1 every 9-10 hours). Behavioral validation of the actual trading strategy happens in the separate emulator sub-project, not here — this step only confirms the plumbing (types, wiring, rendering) is correct and crash-free.

- [ ] **Step 4: No commit for this task**

This task is verification-only; nothing to stage or commit.

---

## Self-Review

**Spec coverage:**
- ZigZag algorithm (cold start, normal operation, sticky/non-repainting, both price-source modes, all 4 configurable parameters) → Task 1, verified numerically against the design spec's own validated fixtures before this plan was written, and again with fresh fixtures while writing this plan (all 9 `zigzag.test.ts` cases independently computed and cross-checked with a throwaway script).
- Observer computes ZigZag for every symbol, recomputes only on the configured timeframe's close, replays on preload → Task 2.
- `ObserverManager` reuses its existing before/after diff to detect confirmed pivots, emits `'pivot'`, drops the qualification gate from chart events → Task 3.
- `OrderManager`'s order lifecycle (fees, profit, balance, sizing) unchanged; only the buy/sell trigger changes; no stop-loss → Task 4.
- `BotManager`'s `ZIGZAG_ENABLED_SYMBOLS` set, wired to the `'pivot'` event → Task 4.
- Manual buy/qualifying REST routes removed, size-preview route kept → Task 4.
- Frontend types mirror, Ready/Watching/pin/Buy button removed, single-card ZigZag-enabled view, `targetPrice` gone from `OrdersView` → Tasks 5-7.
- Full-stack compile/test/build verification, plus an explicit acknowledgment that live pivot-triggered trading isn't observable in a short session (that's what the emulator sub-project is for) → Task 8.

**Placeholder scan:** none found — every step has complete, runnable code and exact commands.

**Type consistency:** `ZigZagState`/`Pivot`/`PivotType`/`PivotEvent` field names are identical across Tasks 1 (backend types), 2 (`Observer`), 3 (`ObserverManager`), 4 (`BotManager`), 5 (frontend types), 6 (`SymbolChartCard`). `nextZigZagState(candle, prev, config?)` signature matches its Task 1 definition everywhere it's called in Task 2. `sellAtPrice(symbol, price)` signature matches between its Task 4 definition and `BotManager`'s Task 4 usage. `ZIGZAG_ENABLED_SYMBOLS` is the same literal set (`{'BTCUSDT'}`) in both `BotManager.ts` (Task 4) and `ChartGrid.tsx` (Task 6), each commented as mirroring the other.
