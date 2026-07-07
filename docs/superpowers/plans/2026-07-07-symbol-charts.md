# Per-Symbol Candlestick Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare qualifying-symbols name list with a grid of live candlestick charts (lightweight-charts) — one per qualifying symbol — each showing OHLC candles plus MA20/MA99/bbUpper/bbLower as historical overlay lines, toggleable per-card between 1m and 1h.

**Architecture:** The backend grows each `Observer`'s rolling candle buffer from 19 to 200 closed candles per timeframe (detection logic is unaffected — it only reads the tail it already needs), adds a pure indicator-series function, and exposes chart data via a new REST snapshot endpoint plus two new socket events (`chart:tick` for live ticks, `chart:closed` when a candle closes), gated to symbols currently qualifying. The frontend adds a shared-socket singleton (so N chart cards don't open N separate connections), a data-fetching hook per card, and a lightweight-charts-based chart component inside a responsive 4-column grid.

**Tech Stack:** TypeScript, Node `node:test` + `node:assert/strict`, Express, Socket.IO, React 18, `lightweight-charts` (new dependency), Tailwind.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-07-symbol-charts-design.md` — this plan implements it in full.
- Charts render **only** for symbols currently in the qualifying list (same set the app already tracks) — never for all 175 observed symbols.
- Grid: max 4 columns, responsive to fewer on narrower viewports.
- Each card's 1m/1h toggle is **independent local state**, not a global control.
- Visible chart window: **100 candles**. Backend buffer: **200 closed candles** per symbol per timeframe (100 visible + 99 lookback margin for MA99).
- Bollinger uses **population standard deviation** (divide by N, not N-1) — matches the existing `utils/indicators.ts` convention exactly; do not deviate.
- `QualifyingList.tsx` is deleted outright — the chart grid is the sole main view. No dead code left behind.
- Library: `lightweight-charts` (Apache-2.0).

---

### Task 1: `bollingerBands()` in `indicators.ts`

**Files:**
- Modify: `backend/src/utils/indicators.ts`
- Modify: `backend/src/utils/indicators.test.ts`

**Interfaces:**
- Produces: `export interface BollingerBands { middle: number; upper: number; lower: number }` and `export function bollingerBands(values: number[]): BollingerBands` from `utils/indicators.ts`.
- `bollingerUpper(last20: number[]): number` keeps its exact existing signature and return values (refactored internally to call `bollingerBands`, no behavior change) — later tasks and the existing `signals.ts`/`signals.test.ts` continue to use it unchanged.

- [ ] **Step 1: Write the failing tests**

Add to the end of `backend/src/utils/indicators.test.ts` (the file already imports `sma`, `bollingerUpper` and defines `CLOSES_99`, `EXPECTED_MA20`, `EXPECTED_BB_UP`, and the `approx()` helper — reuse them):

```ts
test('bollingerBands over last 20 closes matches ma20/bb_up, and bb_low is symmetric around ma20', () => {
  const bands = bollingerBands(CLOSES_99.slice(-20));
  approx(bands.middle, EXPECTED_MA20);
  approx(bands.upper, EXPECTED_BB_UP);
  const expectedLower = EXPECTED_MA20 - (EXPECTED_BB_UP - EXPECTED_MA20);
  approx(bands.lower, expectedLower);
});

test('bollingerUpper still matches bollingerBands().upper (refactor did not change behavior)', () => {
  const window = CLOSES_99.slice(-20);
  assert.equal(bollingerUpper(window), bollingerBands(window).upper);
});
```

Also update the import line at the top of the file to add `bollingerBands`:

```ts
import { sma, bollingerUpper, bollingerBands } from './indicators';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test --require ts-node/register src/utils/indicators.test.ts`
Expected: FAIL — `bollingerBands is not a function` (or a TypeScript error that `bollingerBands` doesn't exist on the module).

- [ ] **Step 3: Implement `bollingerBands()` and refactor `bollingerUpper()`**

Replace the `bollingerUpper` function in `backend/src/utils/indicators.ts` with:

```ts
export interface BollingerBands {
  middle: number;
  upper: number;
  lower: number;
}

/** Bollinger bands: sma(values) ± 2 * populationStdDev(values). */
export function bollingerBands(values: number[]): BollingerBands {
  const mean = sma(values);
  let variance = 0;
  for (const v of values) {
    const d = v - mean;
    variance += d * d;
  }
  variance /= values.length;
  const stddev = Math.sqrt(variance);
  return { middle: mean, upper: mean + 2 * stddev, lower: mean - 2 * stddev };
}

/** Upper Bollinger band: sma(last20) + 2 * populationStdDev(last20). */
export function bollingerUpper(last20: number[]): number {
  return bollingerBands(last20).upper;
}
```

(Keep `sma()` exactly as it is above this — unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test --require ts-node/register src/utils/indicators.test.ts`
Expected: PASS — all tests in the file green (the pre-existing `sma`/`bollingerUpper` tests plus the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/indicators.ts backend/src/utils/indicators.test.ts
git commit -m "feat: add bollingerBands(), refactor bollingerUpper to reuse it"
```

---

### Task 2: Chart wire types + `computeChartSeries()`

**Files:**
- Modify: `backend/src/types/index.ts`
- Create: `backend/src/utils/chartSeries.ts`
- Create: `backend/src/utils/chartSeries.test.ts`

**Interfaces:**
- Consumes: `sma`, `bollingerBands` from `./indicators` (Task 1).
- Produces (in `types/index.ts`): `ChartTimeframe = '1m' | '1h'`, `ChartCandle { openTime, open, high, low, close }`, `ChartSeriesPoint { ma20, ma99, bbUpper, bbLower: number | null }`, `ChartSeries { ma20, ma99, bbUpper, bbLower: (number | null)[] }`, `ChartData { symbol, timeframe, candles: ChartCandle[], series: ChartSeries }`.
- Produces (in `utils/chartSeries.ts`): `export function computeChartSeries(closes: number[]): ChartSeries`.

- [ ] **Step 1: Add the new types to `backend/src/types/index.ts`**

Append to the end of the file (after the existing `ObserverState` interface):

```ts
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
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/utils/chartSeries.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeChartSeries } from './chartSeries';
import { sma, bollingerBands } from './indicators';

test('ma20/bbUpper/bbLower are null before 20 closes have accumulated', () => {
  const closes = Array.from({ length: 19 }, (_, i) => 100 + i);
  const series = computeChartSeries(closes);
  assert.equal(series.ma20[18], null);
  assert.equal(series.bbUpper[18], null);
  assert.equal(series.bbLower[18], null);
});

test('ma99 is null before 99 closes have accumulated', () => {
  const closes = Array.from({ length: 98 }, (_, i) => 100 + i);
  const series = computeChartSeries(closes);
  assert.equal(series.ma99[97], null);
});

test('ma20/bbUpper/bbLower match the indicators.ts oracle once 20 closes are available', () => {
  const closes = Array.from({ length: 25 }, (_, i) => 100 + i * (i % 3 === 0 ? 2 : 1));
  const series = computeChartSeries(closes);

  for (let i = 19; i < closes.length; i++) {
    const window = closes.slice(i - 19, i + 1);
    const expectedBands = bollingerBands(window);
    assert.equal(series.ma20[i], sma(window));
    assert.equal(series.bbUpper[i], expectedBands.upper);
    assert.equal(series.bbLower[i], expectedBands.lower);
  }
});

test('ma99 matches the indicators.ts oracle once 99 closes are available', () => {
  const closes = Array.from({ length: 105 }, (_, i) => 100 + Math.sin(i) * 5);
  const series = computeChartSeries(closes);

  for (let i = 98; i < closes.length; i++) {
    const window = closes.slice(i - 98, i + 1);
    assert.equal(series.ma99[i], sma(window));
  }
});

test('output arrays are index-aligned and the same length as the input', () => {
  const closes = Array.from({ length: 150 }, (_, i) => 100 + i);
  const series = computeChartSeries(closes);
  assert.equal(series.ma20.length, closes.length);
  assert.equal(series.ma99.length, closes.length);
  assert.equal(series.bbUpper.length, closes.length);
  assert.equal(series.bbLower.length, closes.length);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && node --test --require ts-node/register src/utils/chartSeries.test.ts`
Expected: FAIL — `Cannot find module './chartSeries'`.

- [ ] **Step 4: Implement `backend/src/utils/chartSeries.ts`**

```ts
import { ChartSeries } from '../types';
import { sma, bollingerBands } from './indicators';

const MA20_WINDOW = 20;
const MA99_WINDOW = 99;

/** For each index i, computes MA20/MA99/bbUpper/bbLower over the trailing
 * window ending at i (inclusive). null until enough history exists for
 * that window. Output arrays are the same length as `closes`, index-aligned. */
export function computeChartSeries(closes: number[]): ChartSeries {
  const n = closes.length;
  const ma20: (number | null)[] = new Array(n).fill(null);
  const ma99: (number | null)[] = new Array(n).fill(null);
  const bbUpper: (number | null)[] = new Array(n).fill(null);
  const bbLower: (number | null)[] = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (i + 1 >= MA20_WINDOW) {
      const window20 = closes.slice(i + 1 - MA20_WINDOW, i + 1);
      const bands = bollingerBands(window20);
      ma20[i] = bands.middle;
      bbUpper[i] = bands.upper;
      bbLower[i] = bands.lower;
    }
    if (i + 1 >= MA99_WINDOW) {
      ma99[i] = sma(closes.slice(i + 1 - MA99_WINDOW, i + 1));
    }
  }

  return { ma20, ma99, bbUpper, bbLower };
}
```

(Uses `bands.middle` for `ma20` rather than a separate `sma()` call — one variance computation serves ma20/bbUpper/bbLower together, avoiding duplicate work.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && node --test --require ts-node/register src/utils/chartSeries.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/types/index.ts backend/src/utils/chartSeries.ts backend/src/utils/chartSeries.test.ts
git commit -m "feat: add chart wire types and computeChartSeries()"
```

---

### Task 3: Grow `Observer`'s buffers, track full forming candles, add `getChartData()`

**Files:**
- Modify (full rewrite): `backend/src/observers/Observer.ts`
- Create: `backend/src/observers/Observer.test.ts`

**Interfaces:**
- Consumes: `Candle`, `ChartCandle`, `ChartTimeframe`, `ObserverState` from `../types` (Task 2 adds the chart types); `Queue<T>` from `../utils/Queue` (unchanged); `detectSignal`, `SignalResult` from `../utils/signals` (unchanged).
- Produces: `class Observer` — same public surface as before (`constructor(symbol)`, `preloadClosed1m`, `preloadClosed1h`, `updateCandle1s/1m/1h`, `getState()`) **plus** a new `getChartData(timeframe: ChartTimeframe): ChartCandle[]`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/observers/Observer.test.ts`:

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test --require ts-node/register src/observers/Observer.test.ts`
Expected: FAIL — `observer.getChartData is not a function`.

- [ ] **Step 3: Rewrite `backend/src/observers/Observer.ts`**

```ts
import { Candle, ChartCandle, ChartTimeframe, ObserverState } from '../types';
import { Queue } from '../utils/Queue';
import { detectSignal, SignalResult } from '../utils/signals';

/** 200 closed candles per timeframe: enough for a 100-candle visible chart
 * window with a full 99-candle MA99 lookback at the first visible point,
 * plus margin. Also backs live signal detection, which only reads the tail
 * (last 19/2 — see utils/signals.ts) regardless of total buffer size, so
 * this size increase does not change detection behavior. */
const CHART_HISTORY_CANDLES = 200;

const EMPTY_SIGNAL: SignalResult = {
  qualifies: false,
  reasons: { bbUpper1m: false, bbUpper1h: false, threePositive1m: false, threePositive1h: false },
};

export class Observer {
  private symbol: string;
  private closed1m: Queue<Candle>;
  private closed1h: Queue<Candle>;
  private form1mCandle: Candle | null = null;
  private form1hCandle: Candle | null = null;
  private currentPrice: number | null = null;
  private signal: SignalResult = EMPTY_SIGNAL;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.closed1m = new Queue<Candle>(CHART_HISTORY_CANDLES);
    this.closed1h = new Queue<Candle>(CHART_HISTORY_CANDLES);
  }

  preloadClosed1m(candles: Candle[]): void {
    candles.forEach(c => this.closed1m.push(c));
  }

  preloadClosed1h(candles: Candle[]): void {
    candles.forEach(c => this.closed1h.push(c));
  }

  updateCandle1s(candle: Candle): void {
    this.currentPrice = candle.close;
    this.recompute();
  }

  updateCandle1m(candle: Candle): void {
    if (candle.isClosed) {
      this.closed1m.push(candle);
      this.form1mCandle = null;
    } else {
      this.form1mCandle = candle;
    }
    this.recompute();
  }

  updateCandle1h(candle: Candle): void {
    if (candle.isClosed) {
      this.closed1h.push(candle);
      this.form1hCandle = null;
    } else {
      this.form1hCandle = candle;
    }
    this.recompute();
  }

  getState(): ObserverState {
    return { symbol: this.symbol, qualifies: this.signal.qualifies, reasons: this.signal.reasons };
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

  private recompute(): void {
    if (this.currentPrice === null) return;
    this.signal = detectSignal(
      this.currentPrice,
      this.closed1m.toArray(),
      this.form1mCandle?.open ?? null,
      this.closed1h.toArray(),
      this.form1hCandle?.open ?? null,
    );
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test --require ts-node/register src/observers/Observer.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Run the existing signals test suite to confirm no regression**

Run: `cd backend && node --test --require ts-node/register src/utils/signals.test.ts`
Expected: PASS — all tests still green (this task changes how `Observer` tracks the forming candle internally, but `form1mCandle?.open` is the exact same value `form1mOpen` held before, so `detectSignal`'s inputs are unchanged).

- [ ] **Step 6: Commit**

```bash
git add backend/src/observers/Observer.ts backend/src/observers/Observer.test.ts
git commit -m "feat: grow Observer buffers to 200 candles, add getChartData()"
```

---

### Task 4: `ObserverManager` — chart data + live chart events; `BotManager` preload size

**Files:**
- Modify (full rewrite): `backend/src/managers/ObserverManager.ts`
- Modify: `backend/src/managers/BotManager.ts:7` (and its comment)

**Interfaces:**
- Consumes: `Observer.getChartData(timeframe)` (Task 3); `computeChartSeries(closes)` (Task 2); `Candle, ChartCandle, ChartData, ChartSeries, ChartSeriesPoint, ChartTimeframe, ObserverState` from `../types`.
- Produces: `ObserverManager.getChartData(symbol: string, timeframe: ChartTimeframe): ChartData | null`. Emits `'chart:tick'` with `{ symbol: string; m1: { candle: ChartCandle; series: ChartSeriesPoint }; h1: { candle: ChartCandle; series: ChartSeriesPoint } }` after every update to a currently-qualifying symbol. Emits `'chart:closed'` with `{ symbol: string; timeframe: ChartTimeframe; candle: ChartCandle; series: ChartSeriesPoint }` when a 1m/1h candle closes for a currently-qualifying symbol. Existing `'signal'` event, `getAllStates()`, `getObserverState()`, `getQualifyingSymbols()`, `preloadObserver1m/1h()`, `getSymbols()` are unchanged.

- [ ] **Step 1: Rewrite `backend/src/managers/ObserverManager.ts`**

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

    const qualifiedBefore = observer.getState().qualifies;

    if (candle.timeframe === '1s') {
      observer.updateCandle1s(candle);
    } else if (candle.timeframe === '1m') {
      observer.updateCandle1m(candle);
    } else if (candle.timeframe === '1h') {
      observer.updateCandle1h(candle);
    }

    const state = observer.getState();
    if (state.qualifies !== qualifiedBefore) {
      this.emit('signal', state);
    }

    if (state.qualifies) {
      const m1 = this.getLatestChartPoint(candle.symbol, '1m');
      const h1 = this.getLatestChartPoint(candle.symbol, '1h');

      if (m1 && h1) {
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
  }

  getAllStates(): ObserverState[] {
    return Array.from(this.observers.values()).map(obs => obs.getState());
  }

  getObserverState(symbol: string): ObserverState | null {
    return this.observers.get(symbol)?.getState() ?? null;
  }

  getQualifyingSymbols(): string[] {
    return this.getAllStates().filter(s => s.qualifies).map(s => s.symbol);
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

  getSymbols(): string[] {
    return Array.from(this.observers.keys());
  }
}
```

- [ ] **Step 2: Update `BotManager`'s preload size**

In `backend/src/managers/BotManager.ts`, replace line 6-7:

```ts
/** 19 closed candles + the live price = the 20-value Bollinger window (see utils/signals.ts). */
const PRELOAD_CANDLES = 19;
```

with:

```ts
/** 200 closed candles per symbol per timeframe — backs both live signal
 * detection (which only reads the tail it needs) and the 100-candle chart
 * window with a full MA99 lookback (see observers/Observer.ts). */
const PRELOAD_CANDLES = 200;
```

- [ ] **Step 3: Verify the backend compiles and existing tests still pass**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: `tsc` 0 errors (note: `routes/api.ts` and `services/socketServer.ts` don't yet use the new `getChartData`/chart events — that's fine, this task doesn't require them to). `npm test` — all existing tests pass (Task 1-3's new tests plus `signals.test.ts` all green); no test file exists yet for `ObserverManager` itself, consistent with the rest of this codebase (manager/dispatcher classes aren't unit-tested here — only pure/isolable logic is).

- [ ] **Step 4: Commit**

```bash
git add backend/src/managers/ObserverManager.ts backend/src/managers/BotManager.ts
git commit -m "feat: add chart data + live chart:tick/chart:closed events to ObserverManager"
```

---

### Task 5: REST chart endpoint + socket event forwarding

**Files:**
- Modify: `backend/src/routes/api.ts`
- Modify: `backend/src/services/socketServer.ts`

**Interfaces:**
- Consumes: `ObserverManager.getChartData(symbol, timeframe)` (Task 4); `ObserverManager` events `'chart:tick'`, `'chart:closed'` (Task 4).
- Produces: `GET /api/observers/:symbol/chart?timeframe=1m|1h` → `{ data: ChartData }` (400 for bad/missing timeframe, 404 for unknown symbol). Socket forwards `'chart:tick'`/`'chart:closed'` to all connected clients unchanged.

- [ ] **Step 1: Add the chart route to `backend/src/routes/api.ts`**

Insert this route right after the existing `/observers/:symbol` route (before `/qualifying`):

```ts
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
```

The full `routes/api.ts` should now read (for reference — only the block above is new):

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

  router.get('/qualifying', (_req: Request, res: Response) => {
    res.json({ data: bot.observerManager.getQualifyingSymbols() });
  });

  return router;
}
```

- [ ] **Step 2: Forward the new events in `backend/src/services/socketServer.ts`**

Replace the full file with:

```ts
import { Server as HttpServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { ObserverManager } from '../managers/ObserverManager';
import { ObserverState } from '../types';

export function createSocketServer(httpServer: HttpServer, observerManager: ObserverManager): void {
  const io = new SocketIO(httpServer, { cors: { origin: '*' } });

  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    socket.emit('snapshot', { observers: observerManager.getAllStates() });

    socket.on('disconnect', () => {
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
  });

  observerManager.on('signal', (state: ObserverState) => {
    io.emit('signal', state);
  });

  observerManager.on('chart:tick', (payload) => {
    io.emit('chart:tick', payload);
  });

  observerManager.on('chart:closed', (payload) => {
    io.emit('chart:closed', payload);
  });
}
```

- [ ] **Step 3: Manual verification with a running backend**

Start the backend (`cd backend && npm run dev`), wait for `[Preload] Done` and `[WS] Connected to Binance` in the logs, then in another terminal:

```bash
curl -s "http://localhost:3000/api/observers/BTCUSDT/chart?timeframe=1m" | head -c 500
```

Expected: a JSON object with `data.symbol`, `data.timeframe`, `data.candles` (an array of `{openTime,open,high,low,close}`), and `data.series` (arrays `ma20`/`ma99`/`bbUpper`/`bbLower`). Also try an invalid timeframe:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/observers/BTCUSDT/chart?timeframe=bogus"
```

Expected: `400`. Stop the backend afterward.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/api.ts backend/src/services/socketServer.ts
git commit -m "feat: add REST chart endpoint and forward chart:tick/chart:closed events"
```

---

### Task 6: Frontend chart types + shared socket singleton

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/hooks/socket.ts`
- Modify (full rewrite): `frontend/src/hooks/useSocket.ts`
- Modify: `frontend/package.json` (add `lightweight-charts` dependency)

**Interfaces:**
- Produces (in `types/index.ts`): `ChartTimeframe`, `ChartCandle`, `ChartSeriesPoint`, `ChartSeries`, `ChartData`, `ChartTickEvent { symbol: string; m1: { candle: ChartCandle; series: ChartSeriesPoint }; h1: { candle: ChartCandle; series: ChartSeriesPoint } }`, `ChartClosedEvent { symbol: string; timeframe: ChartTimeframe; candle: ChartCandle; series: ChartSeriesPoint }` — mirror the backend wire shapes from Task 2/4 field-for-field.
- Produces (in `hooks/socket.ts`): `export function getSocket(): Socket` — a module-level singleton so multiple hooks (this task's `useSocket` and Task 7's `useSymbolChartData`) share one WebSocket connection instead of opening one each.
- `useSocket()` keeps its existing return shape `{ observers: Map<string, ObserverData>; connected: boolean }` — no change for `App.tsx`.

Why the singleton is needed: today `useSocket()` calls `io(...)` and `.disconnect()` itself, tied to its own mount/unmount. Task 7 adds one `useSymbolChartData` hook instance **per chart card** (potentially several qualifying symbols at once); if each called `io(...)` independently, that's one full WebSocket connection per card. Moving connection ownership into a shared singleton means every hook attaches/detaches listeners on the *same* connection.

- [ ] **Step 1: Install `lightweight-charts`**

The frontend uses `bun` as its package manager (`frontend/bun.lock` is the
lockfile, not `package-lock.json`) — install with `bun`, not `npm`, to avoid
creating a second, drifting lockfile:

```bash
cd frontend && bun add lightweight-charts
```

Verify it was added to `frontend/package.json`'s `dependencies` and that
`frontend/bun.lock` was updated (`git status` should show it modified).

- [ ] **Step 2: Add chart types to `frontend/src/types/index.ts`**

Append to the end of the file:

```ts
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
```

- [ ] **Step 3: Create the shared socket singleton `frontend/src/hooks/socket.ts`**

```ts
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

let socket: Socket | null = null;

/** Returns the single shared socket connection, creating it on first use.
 * All hooks that need live server events attach/detach their own listeners
 * to this one connection rather than opening their own. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, { transports: ['websocket'] });
  }
  return socket;
}
```

- [ ] **Step 4: Rewrite `frontend/src/hooks/useSocket.ts` to use the shared socket**

```ts
import { useEffect, useState } from 'react';
import { ObserverData } from '../types';
import { getSocket } from './socket';

interface SocketStore {
  observers: Map<string, ObserverData>;
  connected: boolean;
}

export function useSocket() {
  const [store, setStore] = useState<SocketStore>({
    observers: new Map(),
    connected: false,
  });

  useEffect(() => {
    const socket = getSocket();

    const handleConnect = () => setStore(s => ({ ...s, connected: true }));
    const handleDisconnect = () => setStore(s => ({ ...s, connected: false }));
    const handleSnapshot = ({ observers }: { observers: ObserverData[] }) => {
      setStore(s => ({ ...s, observers: new Map(observers.map(o => [o.symbol, o])) }));
    };
    const handleSignal = (state: ObserverData) => {
      setStore(s => {
        const next = new Map(s.observers);
        next.set(state.symbol, state);
        return { ...s, observers: next };
      });
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('snapshot', handleSnapshot);
    socket.on('signal', handleSignal);

    if (socket.connected) handleConnect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('snapshot', handleSnapshot);
      socket.off('signal', handleSignal);
    };
  }, []);

  return store;
}
```

Note: this version does **not** call `socket.disconnect()` on cleanup (unlike the old version) — the socket is now a shared singleton meant to live for the page's lifetime, not tied to one hook's mount cycle. It also handles the case where the socket is already connected by the time this hook runs (`if (socket.connected) handleConnect();`).

- [ ] **Step 5: Verify the frontend still compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors (this task doesn't touch any component; `App.tsx` still calls `useSocket()` with the same return shape).

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/bun.lock frontend/src/types/index.ts frontend/src/hooks/socket.ts frontend/src/hooks/useSocket.ts
git commit -m "feat: add chart types, shared socket singleton, lightweight-charts dependency"
```

---

### Task 7: `useSymbolChartData` hook

**Files:**
- Create: `frontend/src/hooks/useSymbolChartData.ts`

**Interfaces:**
- Consumes: `getSocket()` (Task 6); `ChartCandle`, `ChartClosedEvent`, `ChartSeries`, `ChartTickEvent`, `ChartTimeframe` from `../types` (Task 6); backend REST shape `GET /api/observers/:symbol/chart?timeframe=...` → `{ data: { candles: ChartCandle[]; series: ChartSeries } }` (Task 5).
- Produces: `export function useSymbolChartData(symbol: string, timeframe: ChartTimeframe): { candles: ChartCandle[]; series: ChartSeries; loading: boolean; error: string | null }` — used by Task 8's `SymbolChart`.

- [ ] **Step 1: Create `frontend/src/hooks/useSymbolChartData.ts`**

```ts
import { useEffect, useState } from 'react';
import { ChartCandle, ChartClosedEvent, ChartSeries, ChartTickEvent, ChartTimeframe } from '../types';
import { getSocket } from './socket';

interface ChartDataState {
  candles: ChartCandle[];
  series: ChartSeries;
  loading: boolean;
  error: string | null;
}

const EMPTY_SERIES: ChartSeries = { ma20: [], ma99: [], bbUpper: [], bbLower: [] };
const VISIBLE_CANDLES = 100;

export function useSymbolChartData(symbol: string, timeframe: ChartTimeframe): ChartDataState {
  const [state, setState] = useState<ChartDataState>({
    candles: [],
    series: EMPTY_SERIES,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ candles: [], series: EMPTY_SERIES, loading: true, error: null });

    fetch(`/api/observers/${symbol}/chart?timeframe=${timeframe}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: { data: { candles: ChartCandle[]; series: ChartSeries } }) => {
        if (cancelled) return;
        setState({ candles: json.data.candles, series: json.data.series, loading: false, error: null });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setState(s => ({ ...s, loading: false, error: err.message }));
      });

    const socket = getSocket();

    const handleTick = (event: ChartTickEvent) => {
      if (event.symbol !== symbol) return;
      const point = timeframe === '1m' ? event.m1 : event.h1;

      setState(s => {
        if (s.candles.length === 0) return s;
        const candles = s.candles.slice(0, -1).concat(point.candle);
        const series: ChartSeries = {
          ma20: s.series.ma20.slice(0, -1).concat(point.series.ma20),
          ma99: s.series.ma99.slice(0, -1).concat(point.series.ma99),
          bbUpper: s.series.bbUpper.slice(0, -1).concat(point.series.bbUpper),
          bbLower: s.series.bbLower.slice(0, -1).concat(point.series.bbLower),
        };
        return { ...s, candles, series };
      });
    };

    const handleClosed = (event: ChartClosedEvent) => {
      if (event.symbol !== symbol || event.timeframe !== timeframe) return;

      setState(s => {
        const candles = s.candles.concat(event.candle).slice(-VISIBLE_CANDLES);
        const series: ChartSeries = {
          ma20: s.series.ma20.concat(event.series.ma20).slice(-VISIBLE_CANDLES),
          ma99: s.series.ma99.concat(event.series.ma99).slice(-VISIBLE_CANDLES),
          bbUpper: s.series.bbUpper.concat(event.series.bbUpper).slice(-VISIBLE_CANDLES),
          bbLower: s.series.bbLower.concat(event.series.bbLower).slice(-VISIBLE_CANDLES),
        };
        return { ...s, candles, series };
      });
    };

    socket.on('chart:tick', handleTick);
    socket.on('chart:closed', handleClosed);

    return () => {
      cancelled = true;
      socket.off('chart:tick', handleTick);
      socket.off('chart:closed', handleClosed);
    };
  }, [symbol, timeframe]);

  return state;
}
```

- [ ] **Step 2: Verify the frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors (no component consumes this hook yet — that's fine, an unused exported hook doesn't error).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useSymbolChartData.ts
git commit -m "feat: add useSymbolChartData hook (REST fetch + live socket updates)"
```

---

### Task 8: `SymbolChart` component (lightweight-charts)

**Files:**
- Create: `frontend/src/components/SymbolChart.tsx`

**Interfaces:**
- Consumes: `useSymbolChartData(symbol, timeframe)` (Task 7); `ChartTimeframe` from `../types` (Task 6); `createChart`, `IChartApi`, `ISeriesApi`, `UTCTimestamp` from `lightweight-charts` (Task 6's dependency install).
- Produces: `export function SymbolChart({ symbol, timeframe }: { symbol: string; timeframe: ChartTimeframe }): JSX.Element` — used by Task 9's `SymbolChartCard`.

- [ ] **Step 1: Create `frontend/src/components/SymbolChart.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { ChartTimeframe } from '../types';
import { useSymbolChartData } from '../hooks/useSymbolChartData';

interface Props {
  symbol: string;
  timeframe: ChartTimeframe;
}

function toTime(openTimeMs: number): UTCTimestamp {
  return Math.floor(openTimeMs / 1000) as UTCTimestamp;
}

export function SymbolChart({ symbol, timeframe }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma99SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const { candles, series, loading, error } = useSymbolChartData(symbol, timeframe);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 220,
      layout: { background: { color: 'transparent' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      timeScale: { timeVisible: true },
    });

    chartRef.current = chart;
    candleSeriesRef.current = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    ma20SeriesRef.current = chart.addLineSeries({ color: '#60a5fa', lineWidth: 1 });
    ma99SeriesRef.current = chart.addLineSeries({ color: '#f97316', lineWidth: 1 });
    bbUpperSeriesRef.current = chart.addLineSeries({ color: '#9ca3af', lineWidth: 1, lineStyle: 2 });
    bbLowerSeriesRef.current = chart.addLineSeries({ color: '#9ca3af', lineWidth: 1, lineStyle: 2 });

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;

    candleSeriesRef.current.setData(
      candles.map(c => ({ time: toTime(c.openTime), open: c.open, high: c.high, low: c.low, close: c.close }))
    );

    const toLineData = (values: (number | null)[]) =>
      candles
        .map((c, i) => ({ time: toTime(c.openTime), value: values[i] }))
        .filter((point): point is { time: UTCTimestamp; value: number } => point.value !== null);

    ma20SeriesRef.current?.setData(toLineData(series.ma20));
    ma99SeriesRef.current?.setData(toLineData(series.ma99));
    bbUpperSeriesRef.current?.setData(toLineData(series.bbUpper));
    bbLowerSeriesRef.current?.setData(toLineData(series.bbLower));
  }, [candles, series]);

  return (
    <div>
      {loading && <p className="text-gray-500 text-xs px-1 py-1">Loading chart...</p>}
      {error && <p className="text-red-400 text-xs px-1 py-1">Error: {error}</p>}
      <div ref={containerRef} />
    </div>
  );
}
```

Note on update strategy: every change to `candles`/`series` calls `.setData()` with the full current array (rather than distinguishing `.update()` for ticks vs `.setData()` for closes). This is simpler and still cheap — 100 points re-set per qualifying-symbol tick is trivial rendering work, and it avoids extra branching logic for no behavioral benefit.

- [ ] **Step 2: Verify the frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors. If `lightweight-charts`'s installed version exports slightly different type names than `IChartApi`/`ISeriesApi`/`UTCTimestamp`/`addCandlestickSeries`/`addLineSeries`, check `node_modules/lightweight-charts/dist/typings.d.ts` (or the package's README) for the exact names in the installed version and adjust the imports/calls accordingly — the overall shape (candlestick series + line series, `.setData()`, `time` in seconds) is stable across recent versions.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SymbolChart.tsx
git commit -m "feat: add SymbolChart component (candlestick + MA20/MA99/BB overlays)"
```

---

### Task 9: `SymbolChartCard`, `ChartGrid`, wire into `App.tsx`, delete `QualifyingList`

**Files:**
- Create: `frontend/src/components/SymbolChartCard.tsx`
- Create: `frontend/src/components/ChartGrid.tsx`
- Modify (full rewrite): `frontend/src/App.tsx`
- Delete: `frontend/src/components/QualifyingList.tsx`

**Interfaces:**
- Consumes: `SymbolChart` (Task 8); `ChartTimeframe` from `../types` (Task 6); `ObserverData` from `../types` (pre-existing); `useSocket()` (Task 6, unchanged return shape).
- Produces: `ChartGrid({ observers: ObserverData[] })` — the new main view rendered by `App.tsx`.

- [ ] **Step 1: Delete `QualifyingList.tsx`**

```bash
git rm frontend/src/components/QualifyingList.tsx
```

- [ ] **Step 2: Create `frontend/src/components/SymbolChartCard.tsx`**

```tsx
import { useState } from 'react';
import { ChartTimeframe } from '../types';
import { SymbolChart } from './SymbolChart';

interface Props {
  symbol: string;
}

const TIMEFRAMES: ChartTimeframe[] = ['1m', '1h'];

export function SymbolChartCard({ symbol }: Props) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1m');

  return (
    <div className="rounded border border-gray-800 bg-gray-900 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-sm text-yellow-400">{symbol}</span>
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
      <SymbolChart symbol={symbol} timeframe={timeframe} />
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/src/components/ChartGrid.tsx`**

```tsx
import { ObserverData } from '../types';
import { SymbolChartCard } from './SymbolChartCard';

interface Props {
  observers: ObserverData[];
}

export function ChartGrid({ observers }: Props) {
  const qualifying = observers.filter(o => o.qualifies);

  if (qualifying.length === 0) {
    return <p className="text-gray-500 text-sm">No symbols currently qualify.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {qualifying.map(o => (
        <SymbolChartCard key={o.symbol} symbol={o.symbol} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `frontend/src/App.tsx`**

```tsx
import { useSocket } from './hooks/useSocket';
import { ChartGrid } from './components/ChartGrid';

export default function App() {
  const { observers, connected } = useSocket();
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
          <p className="text-xs text-gray-500 mt-0.5">Live signal detector — {qualifyingCount} qualifying</p>
        </div>
        <div className={`flex items-center gap-2 text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </header>

      <main className="px-6 py-6">
        <ChartGrid observers={observerList} />
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Build the frontend**

Run: `cd frontend && npm run build`
Expected: `tsc && vite build` completes with 0 errors, no unresolved imports (confirms `QualifyingList`'s deletion left no dangling references).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/SymbolChartCard.tsx frontend/src/components/ChartGrid.tsx frontend/src/App.tsx
git commit -m "feat: replace QualifyingList with a 4-column chart grid"
```

---

### Task 10: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: all tests pass, including the new `chartSeries.test.ts`, `Observer.test.ts`, and the updated `indicators.test.ts`, plus the pre-existing `signals.test.ts` (0 regressions).

- [ ] **Step 2: Compile both packages**

Run: `cd backend && npx tsc --noEmit && cd ../frontend && npx tsc --noEmit`
Expected: 0 errors in both.

- [ ] **Step 3: Start backend and frontend dev servers, verify in browser**

Use the preview tool to start both `backend` and `frontend` (per `.claude/launch.json`, already configured from the prior feature). Open the frontend preview and confirm:
- The grid renders one card per currently-qualifying symbol, laid out in up to 4 columns (resize the viewport to confirm the column count drops on narrower widths).
- Each card shows a candlestick chart with visible MA20, MA99, bbUpper, bbLower overlay lines (bbUpper/bbLower dashed, distinguishable colors from MA20/MA99).
- Clicking the "1h" button on one card switches only that card's chart to the 1h series (other cards stay on 1m) — confirms independent per-card state.
- Leave it running for a minute or two and confirm the rightmost candle visibly updates (live tick) without the whole chart flickering/resetting, and that a candle close (if one occurs during observation) shifts the window by one candle.
- Check the browser console (`preview_console_logs`) for errors — expect none.
- Check network tab (`preview_network`) — confirm exactly one WebSocket connection is open regardless of how many chart cards are rendered (verifies the Task 6 socket singleton is actually shared, not one connection per card).

- [ ] **Step 4: Report results to the user**

Summarize: tests passing, both packages compiling clean, and what was observed live in the browser (grid layout, overlay lines rendering, independent per-card timeframe toggle, live updates, single shared socket connection). Do not claim "done" without having completed Steps 1-3 first.
