# Per-Symbol Performance Windows + Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each symbol card's 24h/12h/6h/3h/1h percentage price performance (computed from closed 1h candles only), and let the charts grid be sorted descending by any one of those windows.

**Architecture:** A pure function `computePerformance()` derives all five percentages from an observer's existing `closed1h` buffer; `Observer` recomputes it whenever that buffer changes (preload + live 1h close) and includes it in `getState()`. `ObserverManager`'s existing socket emit gate is extended to also fire on every closed 1h candle (performance changes every hour even when step1/step2 don't). The frontend mirrors the type, extends the existing `groupObservers()` pin-ordering with an optional performance-descending sort, and adds a dropdown + a compact performance row on each card.

**Tech Stack:** TypeScript, Node.js `node:test` (backend), Express + Socket.IO (backend), React 18 + Vite + `node:test`/ts-node (frontend), Tailwind CSS.

## Global Constraints

- Performance uses **closed 1h candles only** — never the live 1s tick price. `perf(N) = (lastClosed1hClose - close1hCandleFromNHoursAgo) / close1hCandleFromNHoursAgo * 100`.
- A window is `null` when the `closed1h` buffer has `N` or fewer candles (needs strictly more than `N` to have both endpoints).
- Recomputation happens only when the `closed1h` buffer changes: once after `preloadClosed1h()`'s loop, and in the `isClosed` branch of `updateCandle1h()`. Never touches `updateCandle1s`/`updateCandle1m`.
- The socket `signal` event fires whenever `reasons` changed (existing rule, unchanged) OR whenever a 1h candle closes (new rule, unconditional — performance always potentially changes then).
- Sorting is descending only, one global dropdown affecting both the Ready and Watching sections identically.
- Within a section, pinned symbols still sort first (existing rule, unchanged); the performance sort applies **within** each pinned/unpinned partition, not across it.
- `null` performance values sort last within their partition when a sort window is active.
- Display format: `null → "—"`, otherwise `"+X.XX%"`/`"-X.XX%"` (2 decimals, explicit `+` sign for non-negative).

---

## File Structure

- Modify `backend/src/types/index.ts` — add `PerformanceWindows`, add `performance: PerformanceWindows` to `ObserverState`.
- Create `backend/src/utils/performance.ts` — pure `computePerformance()`.
- Create `backend/src/utils/performance.test.ts` — covers `computePerformance()`.
- Modify `backend/src/observers/Observer.ts` — recompute `performance` on buffer changes, include in `getState()`.
- Modify `backend/src/observers/Observer.test.ts` — add cases for performance recomputation.
- Modify `backend/src/managers/ObserverManager.ts` — broaden the emit gate to also fire on closed 1h candles.
- Modify `backend/src/managers/ObserverManager.test.ts` — add cases for the new emit trigger.
- Modify `frontend/src/types/index.ts` — mirror `PerformanceWindows`, add to `ObserverData`.
- Modify `frontend/src/components/chartGrouping.ts` — add optional `sortWindow` parameter + `PerformanceWindow` type export.
- Modify `frontend/src/components/chartGrouping.test.ts` — update the `observer()` test helper for the new required field, add sort-order tests.
- Modify `frontend/src/components/ChartGrid.tsx` — add the sort dropdown, wire `sortWindow` into `groupObservers`, pass `performance` to cards.
- Modify `frontend/src/components/SymbolChartCard.tsx` — new `performance` prop + compact performance row.

---

### Task 1: Backend — performance calculation + Observer wiring

**Files:**
- Modify: `backend/src/types/index.ts:30-34`
- Create: `backend/src/utils/performance.ts`
- Create: `backend/src/utils/performance.test.ts`
- Modify: `backend/src/observers/Observer.ts` (full rewrite)
- Modify: `backend/src/observers/Observer.test.ts` (append test cases)

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `PerformanceWindows { h24, h12, h6, h3, h1: number | null }` exported from `backend/src/types/index.ts`. `computePerformance(closed1h: { close: number }[]): PerformanceWindows` exported from `backend/src/utils/performance.ts`. `Observer.getState(): ObserverState` now includes `performance: PerformanceWindows`. No other `Observer` method signature changes. Consumed by Task 2 (`ObserverManager`, no code change needed there beyond what Task 2 does for its own reason) and Tasks 3-4 (frontend, via the socket/REST payload shape).

This task changes `types/index.ts` first (a required-field addition that temporarily makes `Observer.ts` fail to compile) and fixes it within the same task before any full-suite run — do not run the full backend suite until Step 8.

- [ ] **Step 1: Edit `backend/src/types/index.ts`**

Replace lines 30-34:

```ts
export interface ObserverState {
  symbol: string;
  qualifies: boolean;
  reasons: SignalReasons;
}
```

with:

```ts
export interface PerformanceWindows {
  h24: number | null;
  h12: number | null;
  h6: number | null;
  h3: number | null;
  h1: number | null;
}

export interface ObserverState {
  symbol: string;
  qualifies: boolean;
  reasons: SignalReasons;
  performance: PerformanceWindows;
}
```

Do not run tests yet — `backend/src/observers/Observer.ts` now fails to compile (missing `performance` in its returned object). Proceed directly to Step 2, which only touches an unrelated file (`performance.ts`/its test), so it can be verified in isolation before fixing `Observer.ts` in Step 6.

- [ ] **Step 2: Write the failing test for `computePerformance()`**

Create `backend/src/utils/performance.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePerformance } from './performance';

function candle(close: number) {
  return { close };
}

test('an empty buffer returns null for every window', () => {
  const result = computePerformance([]);
  assert.deepEqual(result, { h24: null, h12: null, h6: null, h3: null, h1: null });
});

test('a single candle is not enough for even the 1h window (needs > 1 candle)', () => {
  const result = computePerformance([candle(100)]);
  assert.equal(result.h1, null);
});

test('exactly 2 candles is enough for the 1h window', () => {
  const closes = [candle(100), candle(110)];
  const result = computePerformance(closes);
  assert.equal(result.h1, ((110 - 100) / 100) * 100);
  assert.equal(result.h3, null);
  assert.equal(result.h6, null);
  assert.equal(result.h12, null);
  assert.equal(result.h24, null);
});

test('a 25-candle buffer computes all five windows correctly', () => {
  // Distinct closes so every window's endpoints are unambiguous: close[i] = 100 + i.
  const closes = Array.from({ length: 25 }, (_, i) => candle(100 + i));
  const result = computePerformance(closes);
  const len = closes.length;

  const expected = (hoursAgo: number) => {
    const current = closes[len - 1].close;
    const past = closes[len - 1 - hoursAgo].close;
    return ((current - past) / past) * 100;
  };

  assert.equal(result.h24, expected(24));
  assert.equal(result.h12, expected(12));
  assert.equal(result.h6, expected(6));
  assert.equal(result.h3, expected(3));
  assert.equal(result.h1, expected(1));
});

test('a 24-candle buffer (exactly `hours` candles) leaves h24 null but the rest computed', () => {
  const closes = Array.from({ length: 24 }, (_, i) => candle(100 + i));
  const result = computePerformance(closes);
  assert.equal(result.h24, null);
  assert.notEqual(result.h12, null);
  assert.notEqual(result.h1, null);
});

test('a negative price change produces a negative percentage', () => {
  const closes = [candle(200), candle(150)];
  const result = computePerformance(closes);
  assert.equal(result.h1, ((150 - 200) / 200) * 100);
  assert.ok(result.h1! < 0);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run (from `backend/`): `node --test --require ts-node/register src/utils/performance.test.ts`
Expected: FAIL — cannot find module `./performance`.

- [ ] **Step 4: Create `backend/src/utils/performance.ts`**

```ts
import { PerformanceWindows } from '../types';

interface CandleClose {
  close: number;
}

const WINDOWS: { key: keyof PerformanceWindows; hours: number }[] = [
  { key: 'h24', hours: 24 },
  { key: 'h12', hours: 12 },
  { key: 'h6', hours: 6 },
  { key: 'h3', hours: 3 },
  { key: 'h1', hours: 1 },
];

/** Percentage change from N hours ago to the most recent closed 1h candle,
 * for each of the 24/12/6/3/1-hour windows — closed candles only, never a
 * live price. A window is null until the buffer holds more than `hours`
 * candles (need both the current and the N-hours-ago endpoint). */
export function computePerformance(closed1h: CandleClose[]): PerformanceWindows {
  const result = {} as PerformanceWindows;
  const len = closed1h.length;
  for (const { key, hours } of WINDOWS) {
    if (len <= hours) {
      result[key] = null;
      continue;
    }
    const current = closed1h[len - 1].close;
    const past = closed1h[len - 1 - hours].close;
    result[key] = ((current - past) / past) * 100;
  }
  return result;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run (from `backend/`): `node --test --require ts-node/register src/utils/performance.test.ts`
Expected: PASS, 6/6 tests.

- [ ] **Step 6: Write the failing Observer tests**

Append to `backend/src/observers/Observer.test.ts` (after the last existing test, before the final blank line):

```ts

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
  // Same formula as performance.test.ts's 25-candle case: close[i] = 100 + i.
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

- [ ] **Step 7: Run the Observer test file to verify the new tests fail**

Run (from `backend/`): `node --test --require ts-node/register src/observers/Observer.test.ts`
Expected: FAIL — TypeScript compile error, `Property 'performance' is missing in type` (from `Observer.ts`'s `getState()` not yet returning it), since `types/index.ts` now requires it.

- [ ] **Step 8: Rewrite `backend/src/observers/Observer.ts`**

Replace the entire file with:

```ts
import { Candle, ChartCandle, ChartTimeframe, ObserverState, PerformanceWindows, SignalReasons, TimeframeSignal } from '../types';
import { Queue } from '../utils/Queue';
import { nextTimeframeSignal } from '../utils/signals';
import { computePerformance } from '../utils/performance';

/** 200 closed candles per timeframe: enough for a 100-candle visible chart
 * window with a full 99-candle MA99 lookback at the first visible point,
 * plus margin. Also backs signal detection, which only reads the tail (last
 * 20 — see utils/signals.ts) regardless of total buffer size, so this size
 * increase does not change detection behavior. Also comfortably covers the
 * 24h performance window (24 hourly candles), see utils/performance.ts. */
const CHART_HISTORY_CANDLES = 200;

/** 1 quote-volume value per closed 1m candle, covering a rolling 24h window
 * (60 * 24 = 1440 minutes), used for liquidity-based order sizing. */
const QUOTE_VOLUME_WINDOW = 1440;

export class Observer {
  private symbol: string;
  private closed1m: Queue<Candle>;
  private closed1h: Queue<Candle>;
  private quoteVol1m: Queue<number>;
  private quoteVolSum = 0;
  private form1mCandle: Candle | null = null;
  private form1hCandle: Candle | null = null;
  private currentPrice: number | null = null;
  private m1Signal: TimeframeSignal = { step1: false, step2: false };
  private h1Signal: TimeframeSignal = { step1: false, step2: false };
  private performance: PerformanceWindows = computePerformance([]);

  constructor(symbol: string) {
    this.symbol = symbol;
    this.closed1m = new Queue<Candle>(CHART_HISTORY_CANDLES);
    this.closed1h = new Queue<Candle>(CHART_HISTORY_CANDLES);
    this.quoteVol1m = new Queue<number>(QUOTE_VOLUME_WINDOW);
  }

  /** Pushes each candle into the chart buffer AND replays it through the
   * 1m state machine in order, so a freshly started observer (fed ~200
   * historical candles) reconstructs the same step1/step2 state a
   * continuously-running observer would have reached — not a blank slate. */
  preloadClosed1m(candles: Candle[]): void {
    candles.forEach(c => {
      this.closed1m.push(c);
      this.m1Signal = nextTimeframeSignal(this.closed1m.toArray(), this.m1Signal);
    });
  }

  /** Same replay behavior as preloadClosed1m, for the 1h state machine, plus
   * a single performance recompute once the buffer is fully loaded
   * (performance has no stickiness/history dependency beyond "what's the
   * buffer right now", unlike step1/step2 — no need to recompute per candle). */
  preloadClosed1h(candles: Candle[]): void {
    candles.forEach(c => {
      this.closed1h.push(c);
      this.h1Signal = nextTimeframeSignal(this.closed1h.toArray(), this.h1Signal);
    });
    this.performance = computePerformance(this.closed1h.toArray());
  }

  /** Feeds the 24h rolling quote-volume window without touching the chart
   * buffer — callers typically pass a longer history here than to
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
      this.m1Signal = nextTimeframeSignal(this.closed1m.toArray(), this.m1Signal);
    } else {
      this.form1mCandle = candle;
    }
  }

  updateCandle1h(candle: Candle): void {
    if (candle.isClosed) {
      this.closed1h.push(candle);
      this.form1hCandle = null;
      this.h1Signal = nextTimeframeSignal(this.closed1h.toArray(), this.h1Signal);
      this.performance = computePerformance(this.closed1h.toArray());
    } else {
      this.form1hCandle = candle;
    }
  }

  getState(): ObserverState {
    const reasons: SignalReasons = { m1: this.m1Signal, h1: this.h1Signal };
    const qualifies = reasons.m1.step1 || reasons.m1.step2 || reasons.h1.step1 || reasons.h1.step2;
    return { symbol: this.symbol, qualifies, reasons, performance: this.performance };
  }

  /** Sum of the last (up to) 1440 closed 1m candles' quote volume. Below a
   * full window, this underestimates the true 24h volume — self-corrects
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

- [ ] **Step 9: Run the Observer test file to verify it passes**

Run (from `backend/`): `node --test --require ts-node/register src/observers/Observer.test.ts`
Expected: PASS, all tests (14 pre-existing + 6 new = 20).

- [ ] **Step 10: Run the full backend suite and type check**

Run (from `backend/`): `node --test --require ts-node/register 'src/**/*.test.ts'`
Expected: PASS, all tests.

Run (from `backend/`): `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 11: Commit**

```bash
git add backend/src/types/index.ts backend/src/utils/performance.ts backend/src/utils/performance.test.ts backend/src/observers/Observer.ts backend/src/observers/Observer.test.ts
git commit -m "feat: compute per-symbol 24h/12h/6h/3h/1h performance from closed 1h candles"
```

---

### Task 2: `ObserverManager` — broaden the signal emit to cover 1h closes

**Files:**
- Modify: `backend/src/managers/ObserverManager.ts:46-58`
- Modify: `backend/src/managers/ObserverManager.test.ts` (append test cases)

**Interfaces:**
- Consumes: `ObserverState.performance` from Task 1 (already flows through `observer.getState()` — no new method needed, just a broader emit condition).
- Produces: no new exports. `ObserverManager`'s existing `'signal'` event now also fires on every closed 1h candle, in addition to its existing reasons-changed trigger.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/managers/ObserverManager.test.ts` (after the last existing test, before the final blank line):

```ts

test('a closed 1h candle emits signal even when reasons and step state are unchanged', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');
  const signals = listenSignals(manager);

  // A single 1h close: reasons stay {false,false} (below the 20-candle
  // signals window), but performance is recomputed from the 1h buffer on
  // every 1h close, so the broadcast must still fire.
  manager.updateCandle({ symbol: 'BTCUSDT', timeframe: '1h', openTime: 0, open: 100, high: 100, low: 100, close: 100, isClosed: true });

  assert.equal(signals.length, 1);
  assert.deepEqual(signals[0].reasons, { m1: { step1: false, step2: false }, h1: { step1: false, step2: false } });
});

test('a second closed 1h candle also emits, not just the first', () => {
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`): `node --test --require ts-node/register src/managers/ObserverManager.test.ts`
Expected: FAIL — the first two new tests expect a `signal` emit that doesn't happen yet (current gate only checks `reasonsChanged`, and a lone/second 1h close with a <20-candle window never changes `reasons`).

- [ ] **Step 3: Edit `backend/src/managers/ObserverManager.ts`**

Replace lines 46-58:

```ts
    const state = observer.getState();
    // Compare all four step booleans, not just `qualifies` (which is their
    // OR): qualifies can stay true across a step1->step2 transition (step2
    // only ever sets while step1 is already true), so gating on it alone
    // misses the "Watching" -> "Ready" update the frontend depends on.
    const reasonsChanged =
      state.reasons.m1.step1 !== before.reasons.m1.step1 ||
      state.reasons.m1.step2 !== before.reasons.m1.step2 ||
      state.reasons.h1.step1 !== before.reasons.h1.step1 ||
      state.reasons.h1.step2 !== before.reasons.h1.step2;
    if (reasonsChanged) {
      this.emit('signal', state);
    }
```

with:

```ts
    const state = observer.getState();
    // Compare all four step booleans, not just `qualifies` (which is their
    // OR): qualifies can stay true across a step1->step2 transition (step2
    // only ever sets while step1 is already true), so gating on it alone
    // misses the "Watching" -> "Ready" update the frontend depends on.
    const reasonsChanged =
      state.reasons.m1.step1 !== before.reasons.m1.step1 ||
      state.reasons.m1.step2 !== before.reasons.m1.step2 ||
      state.reasons.h1.step1 !== before.reasons.h1.step1 ||
      state.reasons.h1.step2 !== before.reasons.h1.step2;
    // Performance windows are recomputed on every closed 1h candle (see
    // Observer.updateCandle1h) even when step1/step2 don't change — the
    // broadcast must fire on that trigger unconditionally too, otherwise
    // performance on the frontend would only refresh on step transitions.
    const is1hClose = candle.timeframe === '1h' && candle.isClosed;
    if (reasonsChanged || is1hClose) {
      this.emit('signal', state);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `backend/`): `node --test --require ts-node/register src/managers/ObserverManager.test.ts`
Expected: PASS, all tests (3 pre-existing + 3 new = 6).

- [ ] **Step 5: Run the full backend suite and type check**

Run (from `backend/`): `node --test --require ts-node/register 'src/**/*.test.ts'`
Expected: PASS, all tests.

Run (from `backend/`): `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/managers/ObserverManager.ts backend/src/managers/ObserverManager.test.ts
git commit -m "feat: emit signal on every closed 1h candle so performance updates reach the frontend"
```

---

### Task 3: Frontend — mirror types + performance-aware `groupObservers` sort

**Files:**
- Modify: `frontend/src/types/index.ts:1-15`
- Modify: `frontend/src/components/chartGrouping.ts` (full rewrite)
- Modify: `frontend/src/components/chartGrouping.test.ts` (full rewrite)

**Interfaces:**
- Consumes: nothing new from other tasks (mirrors Task 1's backend shape by hand, per this codebase's established convention of no shared type package).
- Produces: `PerformanceWindows` and `PerformanceWindow = keyof PerformanceWindows` exported from `frontend/src/types/index.ts`. `ObserverData.performance: PerformanceWindows`. `groupObservers(observers, pinnedSymbols, sortWindow?: PerformanceWindow | null): { ready: ObserverData[]; watching: ObserverData[] }` — the third parameter is optional and defaults to `null` (no sort, today's behavior), so this is a backward-compatible signature change. Consumed by Task 4 (`ChartGrid.tsx`).

- [ ] **Step 1: Edit `frontend/src/types/index.ts`**

Replace lines 1-15:

```ts
export interface TimeframeSignal {
  step1: boolean;
  step2: boolean;
}

export interface SignalReasons {
  m1: TimeframeSignal;
  h1: TimeframeSignal;
}

export interface ObserverData {
  symbol: string;
  qualifies: boolean;
  reasons: SignalReasons;
}
```

with:

```ts
export interface TimeframeSignal {
  step1: boolean;
  step2: boolean;
}

export interface SignalReasons {
  m1: TimeframeSignal;
  h1: TimeframeSignal;
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
  qualifies: boolean;
  reasons: SignalReasons;
  performance: PerformanceWindows;
}
```

Do not run tsc yet — `frontend/src/components/chartGrouping.test.ts`'s `observer()` helper now fails to compile (missing `performance` in its returned object literal). Proceed directly to Step 2, which fixes it in the same task.

- [ ] **Step 2: Rewrite `frontend/src/components/chartGrouping.test.ts`**

Replace the entire file with:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupObservers } from './chartGrouping';
import { ObserverData, PerformanceWindows, TimeframeSignal } from '../types';

const EMPTY: TimeframeSignal = { step1: false, step2: false };
const NO_PERFORMANCE: PerformanceWindows = { h24: null, h12: null, h6: null, h3: null, h1: null };

function observer(
  symbol: string,
  m1: TimeframeSignal,
  h1: TimeframeSignal,
  performance: PerformanceWindows = NO_PERFORMANCE
): ObserverData {
  const qualifies = m1.step1 || m1.step2 || h1.step1 || h1.step2;
  return { symbol, qualifies, reasons: { m1, h1 }, performance };
}

test('a symbol with m1.step2 goes to ready', () => {
  const o = observer('AUSDT', { step1: true, step2: true }, EMPTY);
  const { ready, watching } = groupObservers([o], new Set());
  assert.deepEqual(ready.map(x => x.symbol), ['AUSDT']);
  assert.deepEqual(watching, []);
});

test('a symbol with h1.step2 (but not m1) also goes to ready', () => {
  const o = observer('BUSDT', EMPTY, { step1: true, step2: true });
  const { ready } = groupObservers([o], new Set());
  assert.deepEqual(ready.map(x => x.symbol), ['BUSDT']);
});

test('a symbol with only step1 (either timeframe) goes to watching, not ready', () => {
  const o = observer('CUSDT', { step1: true, step2: false }, EMPTY);
  const { ready, watching } = groupObservers([o], new Set());
  assert.deepEqual(ready, []);
  assert.deepEqual(watching.map(x => x.symbol), ['CUSDT']);
});

test('a symbol with neither step in either timeframe is excluded entirely, even if pinned', () => {
  const o = observer('DUSDT', EMPTY, EMPTY);
  const { ready, watching } = groupObservers([o], new Set(['DUSDT']));
  assert.deepEqual(ready, []);
  assert.deepEqual(watching, []);
});

test('within a group, pinned symbols sort first; unpinned keep relative order when no sortWindow is given', () => {
  const a = observer('AUSDT', { step1: true, step2: false }, EMPTY);
  const b = observer('BUSDT', { step1: true, step2: false }, EMPTY);
  const c = observer('CUSDT', { step1: true, step2: false }, EMPTY);
  const { watching } = groupObservers([a, b, c], new Set(['CUSDT']));
  assert.deepEqual(watching.map(x => x.symbol), ['CUSDT', 'AUSDT', 'BUSDT']);
});

test('ready and watching are independently ordered by pin status', () => {
  const readySym = observer('RUSDT', { step1: true, step2: true }, EMPTY);
  const watchSym = observer('WUSDT', { step1: true, step2: false }, EMPTY);
  const { ready, watching } = groupObservers([watchSym, readySym], new Set(['WUSDT']));
  assert.deepEqual(ready.map(x => x.symbol), ['RUSDT']);
  assert.deepEqual(watching.map(x => x.symbol), ['WUSDT']);
});

test('with a sortWindow, unpinned symbols sort descending by that window', () => {
  const low = observer('LOWUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: 1 });
  const high = observer('HIGHUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: 5 });
  const mid = observer('MIDUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: 3 });
  const { watching } = groupObservers([low, high, mid], new Set(), 'h1');
  assert.deepEqual(watching.map(x => x.symbol), ['HIGHUSDT', 'MIDUSDT', 'LOWUSDT']);
});

test('with a sortWindow, null performance values sort last', () => {
  const withValue = observer('VALUEUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: -2 });
  const withNull = observer('NULLUSDT', { step1: true, step2: false }, EMPTY, NO_PERFORMANCE);
  const { watching } = groupObservers([withNull, withValue], new Set(), 'h1');
  assert.deepEqual(watching.map(x => x.symbol), ['VALUEUSDT', 'NULLUSDT']);
});

test('a sortWindow sorts within the pinned and unpinned partitions separately — pinned still comes first overall', () => {
  const pinnedLow = observer('PINLOWUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: 1 });
  const unpinnedHigh = observer('UNPINHIGHUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: 99 });
  const { watching } = groupObservers([unpinnedHigh, pinnedLow], new Set(['PINLOWUSDT']), 'h1');
  assert.deepEqual(watching.map(x => x.symbol), ['PINLOWUSDT', 'UNPINHIGHUSDT']);
});

test('omitting sortWindow (or passing null) preserves today\'s no-sort behavior', () => {
  const a = observer('AUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: 1 });
  const b = observer('BUSDT', { step1: true, step2: false }, EMPTY, { ...NO_PERFORMANCE, h1: 99 });
  const withoutArg = groupObservers([a, b], new Set());
  const withNull = groupObservers([a, b], new Set(), null);
  assert.deepEqual(withoutArg.watching.map(x => x.symbol), ['AUSDT', 'BUSDT']);
  assert.deepEqual(withNull.watching.map(x => x.symbol), ['AUSDT', 'BUSDT']);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run (from `frontend/`): `TS_NODE_PROJECT=tsconfig.test.json node --require ts-node/register --test src/components/chartGrouping.test.ts`
Expected: FAIL — `groupObservers` doesn't yet accept a third argument, and the sort-order assertions don't hold against the current implementation.

- [ ] **Step 4: Rewrite `frontend/src/components/chartGrouping.ts`**

Replace the entire file with:

```ts
import { ObserverData, PerformanceWindows } from '../types';

export type PerformanceWindow = keyof PerformanceWindows;

function isReady(o: ObserverData): boolean {
  return o.reasons.m1.step2 || o.reasons.h1.step2;
}

function isWatching(o: ObserverData): boolean {
  return o.reasons.m1.step1 || o.reasons.h1.step1;
}

/** Descending by performance[sortWindow]; null sorts last. Stable for ties
 * (Array.prototype.sort is stable per spec since ES2019). */
function sortByPerformance(group: ObserverData[], sortWindow: PerformanceWindow): ObserverData[] {
  return [...group].sort((a, b) => {
    const aVal = a.performance[sortWindow];
    const bVal = b.performance[sortWindow];
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return bVal - aVal;
  });
}

function orderByPin(
  group: ObserverData[],
  pinnedSymbols: Set<string>,
  sortWindow: PerformanceWindow | null
): ObserverData[] {
  const pinned = group.filter(o => pinnedSymbols.has(o.symbol));
  const unpinned = group.filter(o => !pinnedSymbols.has(o.symbol));
  if (sortWindow === null) {
    return [...pinned, ...unpinned];
  }
  return [...sortByPerformance(pinned, sortWindow), ...sortByPerformance(unpinned, sortWindow)];
}

/** Splits observers into "ready" (m1 or h1 reached step2) and "watching"
 * (step1 reached on some track, but step2 on none) — symbols with neither
 * step on either track are dropped entirely, pin status notwithstanding.
 * Within each returned group, pinned symbols sort first; within the pinned
 * and unpinned partitions, `sortWindow` (if given) sorts descending by that
 * performance window, with null values last — otherwise the incoming
 * relative order is preserved. */
export function groupObservers(
  observers: ObserverData[],
  pinnedSymbols: Set<string>,
  sortWindow: PerformanceWindow | null = null
): { ready: ObserverData[]; watching: ObserverData[] } {
  const ready = observers.filter(isReady);
  const watching = observers.filter(o => !isReady(o) && isWatching(o));
  return {
    ready: orderByPin(ready, pinnedSymbols, sortWindow),
    watching: orderByPin(watching, pinnedSymbols, sortWindow),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run (from `frontend/`): `TS_NODE_PROJECT=tsconfig.test.json node --require ts-node/register --test src/components/chartGrouping.test.ts`
Expected: PASS, 10/10 tests.

- [ ] **Step 6: Run the full frontend suite and type check**

Run (from `frontend/`): `TS_NODE_PROJECT=tsconfig.test.json node --require ts-node/register --test 'src/**/*.test.ts'`
Expected: PASS, all tests.

Run (from `frontend/`): `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/components/chartGrouping.ts frontend/src/components/chartGrouping.test.ts
git commit -m "feat: mirror PerformanceWindows type and add performance-descending sort to groupObservers"
```

---

### Task 4: Frontend — sort dropdown + performance row on cards

**Files:**
- Modify: `frontend/src/components/ChartGrid.tsx` (full rewrite)
- Modify: `frontend/src/components/SymbolChartCard.tsx:1-79`

**Interfaces:**
- Consumes: `groupObservers(observers, pinnedSymbols, sortWindow)` and `PerformanceWindow` from `frontend/src/components/chartGrouping.ts` (Task 3). `PerformanceWindows` from `frontend/src/types/index.ts` (Task 3).
- Produces: `SymbolChartCard` gains a `performance: PerformanceWindows` prop, used only by this task's own render — no other task depends on it.

Both files must land together: `ChartGrid.tsx` starts passing a `performance` prop that `SymbolChartCard` doesn't accept until this task's edit to it, so the branch only compiles once both changes are in place.

- [ ] **Step 1: Rewrite `frontend/src/components/ChartGrid.tsx`**

Replace the entire file with:

```tsx
import { useState } from 'react';
import { ObserverData } from '../types';
import { SymbolChartCard } from './SymbolChartCard';
import { useOrders } from '../hooks/useOrders';
import { useOrderSizes } from '../hooks/useOrderSizes';
import { groupObservers, PerformanceWindow } from './chartGrouping';

interface Props {
  observers: ObserverData[];
}

const SORT_OPTIONS: { value: PerformanceWindow | ''; label: string }[] = [
  { value: '', label: 'Sin ordenar' },
  { value: 'h24', label: '24h' },
  { value: 'h12', label: '12h' },
  { value: 'h6', label: '6h' },
  { value: 'h3', label: '3h' },
  { value: 'h1', label: '1h' },
];

export function ChartGrid({ observers }: Props) {
  const [pinnedSymbols, setPinnedSymbols] = useState<Set<string>>(new Set());
  const [sortWindow, setSortWindow] = useState<PerformanceWindow | null>(null);
  const { activeOrders } = useOrders();

  const togglePin = (symbol: string) => {
    setPinnedSymbols(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  };

  const { ready, watching } = groupObservers(observers, pinnedSymbols, sortWindow);
  const allVisible = [...ready, ...watching];

  const { sizes } = useOrderSizes(allVisible.map(o => o.symbol));

  const buySymbol = (symbol: string) => {
    fetch('/api/orders/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    }).catch(() => {
      // The order:opened socket event (via useOrders) is the source of
      // truth; a failed request just means nothing changes.
    });
  };

  const renderGrid = (group: ObserverData[], isReadyGroup: boolean) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {group.map(o => (
        <SymbolChartCard
          key={o.symbol}
          symbol={o.symbol}
          isPinned={pinnedSymbols.has(o.symbol)}
          onTogglePin={() => togglePin(o.symbol)}
          isReady={isReadyGroup}
          performance={o.performance}
          activeOrder={activeOrders.find(order => order.symbol === o.symbol) ?? null}
          orderSize={sizes[o.symbol] ?? 0}
          onBuy={() => buySymbol(o.symbol)}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
        <label htmlFor="sort-window">Ordenar por rendimiento:</label>
        <select
          id="sort-window"
          value={sortWindow ?? ''}
          onChange={e => setSortWindow(e.target.value === '' ? null : (e.target.value as PerformanceWindow))}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200"
        >
          {SORT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {allVisible.length === 0 ? (
        <p className="text-gray-500 text-sm">No symbols currently qualify.</p>
      ) : (
        <>
          {ready.length > 0 && (
            <section>
              <h2 className="text-sm font-mono text-green-400 mb-2">Ready</h2>
              {renderGrid(ready, true)}
            </section>
          )}
          {watching.length > 0 && (
            <section>
              <h2 className="text-sm font-mono text-gray-400 mb-2">Watching</h2>
              {renderGrid(watching, false)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Edit `frontend/src/components/SymbolChartCard.tsx`**

Replace lines 1-79 (imports through the end of the header `<div>` block, i.e. everything up to and including the `</div>` that closes `<div className="flex items-center justify-between mb-2">`) with:

```tsx
import { useState } from 'react';
import { ActiveOrder, ChartTimeframe, PerformanceWindows } from '../types';
import { SymbolChart } from './SymbolChart';
import { useSymbolChartData } from '../hooks/useSymbolChartData';

interface Props {
  symbol: string;
  isPinned: boolean;
  onTogglePin: () => void;
  isReady: boolean;
  performance: PerformanceWindows;
  activeOrder: ActiveOrder | null;
  orderSize: number;
  onBuy: () => void;
}

const TIMEFRAMES: ChartTimeframe[] = ['1m', '1h'];
const TARGET_PCT = 0.005; // +0.5%

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

export function SymbolChartCard({
  symbol,
  isPinned,
  onTogglePin,
  isReady,
  performance,
  activeOrder,
  orderSize,
  onBuy,
}: Props) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1m');
  const { candles, series, loading, error } = useSymbolChartData(symbol, timeframe);

  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : null;
  // price + price*pct (not price*mult) avoids IEEE754 drift (e.g. 100*1.005 !== 100.5),
  // matching the backend's OrderManager target calculation.
  const targetPrice = currentPrice !== null ? currentPrice + currentPrice * TARGET_PCT : null;

  return (
    <div className="rounded border border-gray-800 bg-gray-900 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={onTogglePin}
            aria-label={isPinned ? `Unpin ${symbol}` : `Pin ${symbol}`}
            aria-pressed={isPinned}
            className={`shrink-0 p-0.5 rounded ${isPinned ? 'text-yellow-400' : 'text-gray-600 hover:text-gray-400'}`}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
            </svg>
          </button>
          <a
            href={binanceSpotUrl(symbol)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-sm text-yellow-400 hover:underline truncate"
          >
            {symbol}
          </a>
          {isReady && (
            <span className="shrink-0 px-1 py-0.5 rounded text-[10px] font-mono font-bold bg-green-900 text-green-400">
              READY
            </span>
          )}
        </div>
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
```

The rest of the file (the performance row you're about to insert, then `<SymbolChart .../>` and the existing footer) stays structurally the same — see the next step for the one insertion needed.

- [ ] **Step 3: Insert the performance row**

Immediately after the closing `</div>` of the header block (the `<div className="flex items-center justify-between mb-2">...</div>` you just replaced in Step 2) and before the existing `<SymbolChart candles={candles} series={series} loading={loading} error={error} />` line, insert:

```tsx
      <div className="flex items-center justify-between mb-2 text-[10px] font-mono">
        {PERFORMANCE_WINDOWS.map(({ key, label }) => (
          <div key={key} className="flex flex-col items-center gap-0.5">
            <span className="text-gray-500">{label}</span>
            <span className={perfColor(performance[key])}>{fmtPerf(performance[key])}</span>
          </div>
        ))}
      </div>

```

The file's tail (from `<SymbolChart .../>` through the closing `</div>` of the component, i.e. the chart and the existing footer with Price/Target/Size/Buy) is unchanged — do not modify it.

- [ ] **Step 4: Verify the frontend compiles and all tests pass**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: 0 errors.

Run (from `frontend/`): `TS_NODE_PROJECT=tsconfig.test.json node --require ts-node/register --test 'src/**/*.test.ts'`
Expected: PASS, all tests (unchanged count from Task 3 — this task adds no new test files, it's UI wiring verified live in Task 5).

Run (from `frontend/`): `npx vite build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChartGrid.tsx frontend/src/components/SymbolChartCard.tsx
git commit -m "feat: add performance-window sort dropdown and per-card performance row"
```

---

### Task 5: Full-stack live verification

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

Start both servers (backend, then frontend via Vite). Wait for backend preload logs to confirm historical candles loaded for all symbols (including 1h history, already fetched by the existing preload pipeline). Open the frontend in a browser.

Confirm:
- Each card shows a row of 5 performance values (24h/12h/6h/3h/1h) with plausible non-`—` values for most symbols (175 symbols preloaded with 200 1h candles each comfortably exceeds the 24-candle minimum for every window), colored green/red by sign.
- The "Ordenar por rendimiento" dropdown is visible above the Ready/Watching sections, defaulting to "Sin ordenar".
- Selecting "1h" (or any window) re-sorts both the Ready and Watching sections descending by that window's value within each section, with pinned cards still leading.
- Pinning a card while a sort window is active keeps that card first in its section; unpinning it lets it fall back into sorted position among the unpinned cards.
- Switching back to "Sin ordenar" restores the original pin-then-insertion order.
- The Buy button/footer are unaffected — still visible and functional in both sections.
- No console errors.

- [ ] **Step 4: No commit for this task**

This task is verification-only; nothing to stage or commit.

---

## Self-Review

**Spec coverage:**
- Calculation formula (closed-1h-only percentage change, null below `N+1` candles) → Task 1 (`computePerformance`).
- Recomputation only on `closed1h` buffer changes (preload once, live close) → Task 1 (`Observer.ts`'s `preloadClosed1h`/`updateCandle1h`, never touched by `updateCandle1s`/`updateCandle1m` — confirmed by Task 1's own negative tests).
- Live delivery to the frontend on every 1h close → Task 2 (`ObserverManager` emit gate).
- Type mirroring backend↔frontend → Task 3.
- Descending sort by a chosen window, pinned-first still wins, null sorts last → Task 3 (`groupObservers`'s `sortWindow` parameter).
- Global dropdown affecting both sections identically → Task 4 (`ChartGrid.tsx`, single `sortWindow` state feeding both `ready`/`watching` groupings).
- Performance row placement (compact row under the header) and format (`—`/`+X.XX%`/`-X.XX%`, green/red) → Task 4 (`SymbolChartCard.tsx`).
- Buy button/footer unaffected → confirmed live in Task 5 (no code in Tasks 1-4 touches that JSX).

**Placeholder scan:** none found — every step has complete, runnable code and exact commands.

**Type consistency:** `PerformanceWindows` field names (`h24`, `h12`, `h6`, `h3`, `h1`) are identical across Tasks 1, 3, 4. `computePerformance(closed1h)` signature matches its Task 1 definition everywhere it's called in `Observer.ts`. `groupObservers(observers, pinnedSymbols, sortWindow)` signature matches between its Task 3 definition and Task 4's usage. `SymbolChartCard`'s `performance` prop name matches between Task 4's `ChartGrid.tsx` (passed) and `SymbolChartCard.tsx` (declared/used).
