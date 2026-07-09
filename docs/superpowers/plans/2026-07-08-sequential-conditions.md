# Sequential Qualification Conditions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the live-recomputed `bbUpper1m || bbUpper1h` qualification with a sticky, per-timeframe, two-step state machine evaluated only on candle close, and split the charts grid into a "Ready" section (step2 reached) and a "Watching" section (step1 only).

**Architecture:** A pure function `nextTimeframeSignal()` advances one timeframe's `{step1, step2}` state given its trailing 20-candle window; `Observer` holds one such state per timeframe (`m1Signal`, `h1Signal`), advancing them only when a 1m/1h candle closes (including during startup preload replay, so restarts reconstruct true state). The frontend mirrors the types and derives two render groups from `reasons.m1`/`reasons.h1` via a small pure grouping module, consumed by `ChartGrid`.

**Tech Stack:** TypeScript, Node.js `node:test` (backend), Express + Socket.IO (backend), React 18 + Vite + `node:test`/ts-node (frontend), Tailwind CSS.

## Global Constraints

- State transitions use a 20-candle trailing window (`WINDOW = 20`), the just-closed candle included — per spec, extended from the old `CLOSED_WINDOW = 19` (which excluded the live price as a 20th point).
- Reset (`close >= bbUpper`) is checked before step1/step2 on the same close, and wins if multiple conditions match simultaneously.
- 1m and 1h state machines are fully independent — no cross-timeframe reads/writes, ever.
- No live/per-tick recomputation — signal state only changes on `candle.isClosed === true`.
- Startup must reconstruct state by replaying preloaded history through the exact same transition function used for live closes (no separate "replay mode").
- Pinning affects sort order only, never visibility, under the new model.
- Buy button/footer behavior is unchanged in both grid sections — `step2`/`isReady` is a visual signal only.

---

## File Structure

- Modify `backend/src/types/index.ts` — replace `SignalReasons`, add `TimeframeSignal`.
- Rewrite `backend/src/utils/signals.ts` — pure `nextTimeframeSignal()` state transition (replaces `detectSignal()`).
- Rewrite `backend/src/utils/signals.test.ts` — covers the new state machine.
- Modify `backend/src/observers/Observer.ts` — per-timeframe sticky state, close-only updates, preload replay.
- Modify `backend/src/observers/Observer.test.ts` — add cases for replay reconstruction and live-price independence.
- Modify `frontend/src/types/index.ts` — mirror `TimeframeSignal`/`SignalReasons`.
- Create `frontend/src/components/chartGrouping.ts` — pure `groupObservers()` helper (ready/watching split + pinned-first ordering).
- Create `frontend/src/components/chartGrouping.test.ts` — covers `groupObservers()`.
- Modify `frontend/src/components/ChartGrid.tsx` — render two sections using `chartGrouping`.
- Modify `frontend/src/components/SymbolChartCard.tsx` — add `isReady` prop + badge.

---

### Task 1: Backend types — `TimeframeSignal` and new `SignalReasons`

**Files:**
- Modify: `backend/src/types/index.ts:20-23`

**Interfaces:**
- Produces: `TimeframeSignal { step1: boolean; step2: boolean }`, `SignalReasons { m1: TimeframeSignal; h1: TimeframeSignal }` (both exported), used by Tasks 2, 3, and mirrored in Task 4.

This task has no separate test — it's a type-only change, verified by `tsc` in Task 3 once consumers exist. Making the edit alone (with no consumers yet) would break the current `signals.ts`/`Observer.ts`, so this task's own verification is just that the file's syntax is valid; full compile verification happens once Task 2/3 land. To keep the branch buildable at every commit, Tasks 1 and 2 are combined into a single commit boundary — see Task 2's steps, which include this edit.

- [ ] **Step 1: Edit `backend/src/types/index.ts`**

Replace lines 20-23:

```ts
export interface SignalReasons {
  bbUpper1m: boolean;
  bbUpper1h: boolean;
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
```

Do not run tests or commit yet — proceed directly into Task 2, which fixes the now-broken `signals.ts` in the same commit.

---

### Task 2: `nextTimeframeSignal()` pure state machine

**Files:**
- Modify: `backend/src/utils/signals.ts` (full rewrite)
- Modify: `backend/src/utils/signals.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `TimeframeSignal` from `backend/src/types/index.ts` (Task 1). `bollingerBands(values: number[]): { middle: number; upper: number; lower: number }` from `backend/src/utils/indicators.ts` (pre-existing, population-stddev bands).
- Produces: `nextTimeframeSignal(closed: CandleOC[], prev: TimeframeSignal): TimeframeSignal`, `EMPTY_TIMEFRAME_SIGNAL: TimeframeSignal`, both exported from `backend/src/utils/signals.ts`. `CandleOC { open: number; close: number }` stays a local (non-exported) interface, structurally compatible with `Candle` — Task 3 passes `Candle[]` directly.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `backend/src/utils/signals.test.ts` with:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTimeframeSignal, EMPTY_TIMEFRAME_SIGNAL } from './signals';

function candle(close: number) {
  return { open: close, close };
}

/** 20-candle window: 10 closes at 90, 9 closes at 100, then `last`. Two
 * clusters give the band enough width that `last` can land strictly
 * between the middle and upper bands (unlike a flat baseline + single
 * outlier, where any deviation large enough to cross the middle band also
 * breaches the upper band, making step2-without-reset unreachable). Exact
 * band values for each `last` used below were verified with a throwaway
 * script computing bollingerBands() over these exact arrays:
 *   last=70  -> step1 crosses (<= lower), step2 doesn't, no reset
 *   last=90  -> inside the band (no step1, no step2, no reset)
 *   last=100 -> step2 crosses (>= middle), no reset
 *   last=108 -> step2 crosses AND reset crosses (>= upper) simultaneously
 *   last=110 -> reset crosses (>= upper) */
function window(last: number): { open: number; close: number }[] {
  return Array(10).fill(90).concat(Array(9).fill(100)).concat([last]).map(candle);
}

test('below WINDOW candles is a no-op, returns prev unchanged', () => {
  const nineteen = window(70).slice(0, 19);
  const prev = { step1: true, step2: true };
  const result = nextTimeframeSignal(nineteen, prev);
  assert.deepEqual(result, prev);
});

test('step1 sets when the closed candle is <= the lower band, from empty state', () => {
  const result = nextTimeframeSignal(window(70), EMPTY_TIMEFRAME_SIGNAL);
  assert.equal(result.step1, true);
  assert.equal(result.step2, false);
});

test('step1 does not set when the closed candle sits inside the band', () => {
  const result = nextTimeframeSignal(window(90), EMPTY_TIMEFRAME_SIGNAL);
  assert.equal(result.step1, false);
});

test('step2 requires step1 already true — a mid-band close with step1 false stays false', () => {
  const result = nextTimeframeSignal(window(100), { step1: false, step2: false });
  assert.equal(result.step2, false);
});

test('step2 sets when step1 is true and the closed candle is >= the middle band', () => {
  const result = nextTimeframeSignal(window(100), { step1: true, step2: false });
  assert.equal(result.step1, true);
  assert.equal(result.step2, true);
});

test('step2 does not set when step1 is true but the close stays below the middle band', () => {
  const result = nextTimeframeSignal(window(90), { step1: true, step2: false });
  assert.equal(result.step2, false);
});

test('reset clears both steps when the closed candle is >= the upper band', () => {
  const result = nextTimeframeSignal(window(110), { step1: true, step2: true });
  assert.deepEqual(result, { step1: false, step2: false });
});

test('reset wins even if the same close would also satisfy the step2 condition', () => {
  // last=108 crosses both the middle band (step2-eligible) and the upper
  // band (reset-eligible) at once — reset must take priority.
  const result = nextTimeframeSignal(window(108), { step1: true, step2: false });
  assert.deepEqual(result, { step1: false, step2: false });
});

test('once step2 is true, further mid-band closes leave state unchanged', () => {
  const result = nextTimeframeSignal(window(90), { step1: true, step2: true });
  assert.deepEqual(result, { step1: true, step2: true });
});

test('after reset, a subsequent drop can re-enter step1 independently', () => {
  const resetResult = nextTimeframeSignal(window(110), { step1: true, step2: true });
  assert.deepEqual(resetResult, { step1: false, step2: false });
  const reentered = nextTimeframeSignal(window(70), resetResult);
  assert.equal(reentered.step1, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `node --test --require ts-node/register src/utils/signals.test.ts`
Expected: FAIL — `nextTimeframeSignal`/`EMPTY_TIMEFRAME_SIGNAL` not exported (module still has the old `detectSignal` shape from before this task).

- [ ] **Step 3: Rewrite `backend/src/utils/signals.ts`**

Replace the entire file with:

```ts
import { TimeframeSignal } from '../types';
import { bollingerBands } from './indicators';

interface CandleOC {
  open: number;
  close: number;
}

const WINDOW = 20;

export const EMPTY_TIMEFRAME_SIGNAL: TimeframeSignal = { step1: false, step2: false };

/** Advances one timeframe's sticky step1/step2 state using the trailing
 * WINDOW closed candles (last element is the just-closed candle, itself
 * included in the Bollinger/SMA window). Fewer than WINDOW candles is a
 * no-op — returns prev unchanged.
 *
 * Reset (close >= upper band) is checked first and wins over step1/step2
 * on the same close. Otherwise: step1 sets on close <= lower band (only if
 * not already true); step2 sets on close >= middle band, but only once
 * step1 is already true. */
export function nextTimeframeSignal(closed: CandleOC[], prev: TimeframeSignal): TimeframeSignal {
  if (closed.length < WINDOW) return prev;

  const window = closed.slice(-WINDOW).map(c => c.close);
  const { upper, lower, middle } = bollingerBands(window);
  const lastClose = closed[closed.length - 1].close;

  if (lastClose >= upper) {
    return { step1: false, step2: false };
  }

  let { step1, step2 } = prev;
  if (!step1 && lastClose <= lower) step1 = true;
  if (step1 && !step2 && lastClose >= middle) step2 = true;
  return { step1, step2 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `backend/`): `node --test --require ts-node/register src/utils/signals.test.ts`
Expected: PASS, 10/10 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/types/index.ts backend/src/utils/signals.ts backend/src/utils/signals.test.ts
git commit -m "feat: replace live bbUpper qualification with sticky per-timeframe state machine"
```

---

### Task 3: Wire `Observer` to close-only sticky state + preload replay

**Files:**
- Modify: `backend/src/observers/Observer.ts` (full rewrite)
- Modify: `backend/src/observers/Observer.test.ts` (add test cases; existing tests must keep passing unmodified)

**Interfaces:**
- Consumes: `nextTimeframeSignal`, `EMPTY_TIMEFRAME_SIGNAL` from `backend/src/utils/signals.ts` (Task 2). `TimeframeSignal`, `SignalReasons`, `Candle`, `ChartCandle`, `ChartTimeframe`, `ObserverState` from `backend/src/types/index.ts`.
- Produces: `Observer.getState(): ObserverState` where `ObserverState.reasons` is the new `{ m1: TimeframeSignal; h1: TimeframeSignal }` shape and `ObserverState.qualifies` is `true` iff any of the four booleans is `true`. No other public method signatures on `Observer` change (`preloadClosed1m`, `preloadClosed1h`, `preloadQuoteVolume1m`, `updateCandle1s`, `updateCandle1m`, `updateCandle1h`, `get24hQuoteVolume`, `getCurrentPrice`, `getChartData` all keep their existing signatures) — `ObserverManager` and everything above it needs no changes.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/observers/Observer.test.ts` (after the existing last test, before the final blank line):

```ts

function closedCandleAt(openTime: number, close: number): Candle {
  return { symbol: 'BTCUSDT', timeframe: '1m', openTime, open: close, high: close, low: close, close, isClosed: true };
}

/** 20-candle window: 10 closes at 90, 9 closes at 100, then `last`, with
 * ascending openTime starting at `startAt`. Mirrors the window shape used
 * in signals.test.ts (see that file's comment for why a two-cluster shape
 * is needed): last=70 crosses step1 (<= lower) without reset; a further
 * single close of 100 right after crosses step2 (>= middle) without reset
 * (verified with a throwaway script computing bollingerBands() over the
 * resulting sliding windows). */
function stepWindow(startAt: number, last: number): Candle[] {
  const closes = Array(10).fill(90).concat(Array(9).fill(100)).concat([last]);
  return closes.map((close, i) => closedCandleAt(startAt + i, close));
}

test('updateCandle1s never changes signal state, only currentPrice', () => {
  const observer = new Observer('BTCUSDT');
  const before = observer.getState().reasons;
  observer.updateCandle1s({ symbol: 'BTCUSDT', timeframe: '1s', openTime: 1, open: 999999, high: 999999, low: 999999, close: 999999, isClosed: true });
  assert.deepEqual(observer.getState().reasons, before);
  assert.equal(observer.getCurrentPrice(), 999999);
});

test('a live (non-closed) 1m candle does not advance the 1m state machine', () => {
  const observer = new Observer('BTCUSDT');
  const candles19 = Array.from({ length: 19 }, (_, i) => closedCandleAt(i, 100 + i));
  observer.preloadClosed1m(candles19);
  const before = observer.getState().reasons.m1;
  observer.updateCandle1m(formingCandle(20, 50, 50, 50, 50));
  assert.deepEqual(observer.getState().reasons.m1, before);
});

test('preloadClosed1m replays the state machine so restart reconstructs true state (reaches step1)', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m(stepWindow(0, 70));
  const reasons = observer.getState().reasons;
  assert.equal(reasons.m1.step1, true);
  assert.equal(reasons.m1.step2, false);
  assert.equal(reasons.h1.step1, false);
  assert.equal(observer.getState().qualifies, true);
});

test('preloadClosed1h replays independently from preloadClosed1m', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1h(stepWindow(0, 70));
  const reasons = observer.getState().reasons;
  assert.equal(reasons.h1.step1, true);
  assert.equal(reasons.m1.step1, false);
});

test('a live closed 1m candle after preload continues the replayed state (reaches step2)', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m(stepWindow(0, 70));
  assert.equal(observer.getState().reasons.m1.step1, true);

  // One more close (openTime 20, close 100) slides the 20-window forward
  // by one and crosses the middle band without crossing the upper band.
  observer.updateCandle1m(closedCandleAt(20, 100));

  const reasons = observer.getState().reasons;
  assert.equal(reasons.m1.step1, true);
  assert.equal(reasons.m1.step2, true);
});
```

Also add the missing import needed by the new tests — check the top of `backend/src/observers/Observer.test.ts` already imports `test`, `assert`, `Observer`, `Candle`; no new imports are required since `closedCandleAt` and `formingCandle` (already defined in the file) cover it.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `node --test --require ts-node/register src/observers/Observer.test.ts`
Expected: FAIL — `Observer` still uses the old `detectSignal`/`SignalResult` API, `getState().reasons` has the old shape, so `reasons.m1` is `undefined`.

- [ ] **Step 3: Rewrite `backend/src/observers/Observer.ts`**

Replace the entire file with:

```ts
import { Candle, ChartCandle, ChartTimeframe, ObserverState, SignalReasons, TimeframeSignal } from '../types';
import { Queue } from '../utils/Queue';
import { nextTimeframeSignal, EMPTY_TIMEFRAME_SIGNAL } from '../utils/signals';

/** 200 closed candles per timeframe: enough for a 100-candle visible chart
 * window with a full 99-candle MA99 lookback at the first visible point,
 * plus margin. Also backs signal detection, which only reads the tail (last
 * 20 — see utils/signals.ts) regardless of total buffer size, so this size
 * increase does not change detection behavior. */
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
  private m1Signal: TimeframeSignal = EMPTY_TIMEFRAME_SIGNAL;
  private h1Signal: TimeframeSignal = EMPTY_TIMEFRAME_SIGNAL;

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

  /** Same replay behavior as preloadClosed1m, for the 1h state machine. */
  preloadClosed1h(candles: Candle[]): void {
    candles.forEach(c => {
      this.closed1h.push(c);
      this.h1Signal = nextTimeframeSignal(this.closed1h.toArray(), this.h1Signal);
    });
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
    } else {
      this.form1hCandle = candle;
    }
  }

  getState(): ObserverState {
    const reasons: SignalReasons = { m1: this.m1Signal, h1: this.h1Signal };
    const qualifies = reasons.m1.step1 || reasons.m1.step2 || reasons.h1.step1 || reasons.h1.step2;
    return { symbol: this.symbol, qualifies, reasons };
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

- [ ] **Step 4: Run tests to verify they pass**

Run (from `backend/`): `node --test --require ts-node/register src/observers/Observer.test.ts`
Expected: PASS, all tests (9 pre-existing + 5 new = 14).

Then run the full backend suite and the compiler to catch any ripple effects into `ObserverManager`/`BotManager`/routes (none expected, per spec, but this task is the first point where the new types actually flow end-to-end):

Run (from `backend/`): `node --test --require ts-node/register 'src/**/*.test.ts'`
Expected: PASS, all tests.

Run (from `backend/`): `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/observers/Observer.ts backend/src/observers/Observer.test.ts
git commit -m "feat: advance Observer signal state only on candle close, replay history on preload"
```

---

### Task 4: Frontend types — mirror `TimeframeSignal`/`SignalReasons`

**Files:**
- Modify: `frontend/src/types/index.ts:1-4`

**Interfaces:**
- Produces: `TimeframeSignal { step1: boolean; step2: boolean }`, `SignalReasons { m1: TimeframeSignal; h1: TimeframeSignal }` — field-for-field identical to the backend shape from Task 1, consumed by Tasks 5 and 6.

- [ ] **Step 1: Edit `frontend/src/types/index.ts`**

Replace lines 1-4:

```ts
export interface SignalReasons {
  bbUpper1m: boolean;
  bbUpper1h: boolean;
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
```

`ObserverData` (below it, unchanged) still reads `{ symbol, qualifies, reasons }` — only the `reasons` shape changed via this edit.

- [ ] **Step 2: Verify the frontend still compiles**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: errors in `ChartGrid.tsx` (still reads `o.qualifies` only, which still exists and compiles) — actually expect 0 errors, since no code yet reads the old `bbUpper1m`/`bbUpper1h` field names. Confirm 0 errors before proceeding.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat: mirror TimeframeSignal/SignalReasons types on the frontend"
```

---

### Task 5: `chartGrouping.ts` — pure ready/watching split + ordering

**Files:**
- Create: `frontend/src/components/chartGrouping.ts`
- Create: `frontend/src/components/chartGrouping.test.ts`

**Interfaces:**
- Consumes: `ObserverData` from `frontend/src/types/index.ts` (Task 4).
- Produces: `groupObservers(observers: ObserverData[], pinnedSymbols: Set<string>): { ready: ObserverData[]; watching: ObserverData[] }`, exported from `frontend/src/components/chartGrouping.ts`. Within each returned array, pinned symbols come first (stable order otherwise), matching the existing pin-sorts-first behavior. Consumed by Task 6 (`ChartGrid.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/chartGrouping.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupObservers } from './chartGrouping';
import { ObserverData, TimeframeSignal } from '../types';

const EMPTY: TimeframeSignal = { step1: false, step2: false };

function observer(symbol: string, m1: TimeframeSignal, h1: TimeframeSignal): ObserverData {
  const qualifies = m1.step1 || m1.step2 || h1.step1 || h1.step2;
  return { symbol, qualifies, reasons: { m1, h1 } };
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

test('within a group, pinned symbols sort first; unpinned keep relative order', () => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `frontend/`): `TS_NODE_PROJECT=tsconfig.test.json node --require ts-node/register --test src/components/chartGrouping.test.ts`
Expected: FAIL — cannot find module `./chartGrouping`.

- [ ] **Step 3: Create `frontend/src/components/chartGrouping.ts`**

```ts
import { ObserverData } from '../types';

function isReady(o: ObserverData): boolean {
  return o.reasons.m1.step2 || o.reasons.h1.step2;
}

function isWatching(o: ObserverData): boolean {
  return o.reasons.m1.step1 || o.reasons.h1.step1;
}

function orderByPin(group: ObserverData[], pinnedSymbols: Set<string>): ObserverData[] {
  const pinned = group.filter(o => pinnedSymbols.has(o.symbol));
  const unpinned = group.filter(o => !pinnedSymbols.has(o.symbol));
  return [...pinned, ...unpinned];
}

/** Splits observers into "ready" (m1 or h1 reached step2) and "watching"
 * (step1 reached on some track, but step2 on none) — symbols with neither
 * step on either track are dropped entirely, pin status notwithstanding.
 * Within each returned group, pinned symbols sort first. */
export function groupObservers(
  observers: ObserverData[],
  pinnedSymbols: Set<string>
): { ready: ObserverData[]; watching: ObserverData[] } {
  const ready = observers.filter(isReady);
  const watching = observers.filter(o => !isReady(o) && isWatching(o));
  return {
    ready: orderByPin(ready, pinnedSymbols),
    watching: orderByPin(watching, pinnedSymbols),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `frontend/`): `TS_NODE_PROJECT=tsconfig.test.json node --require ts-node/register --test src/components/chartGrouping.test.ts`
Expected: PASS, 6/6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/chartGrouping.ts frontend/src/components/chartGrouping.test.ts
git commit -m "feat: add pure ready/watching grouping helper for the charts grid"
```

---

### Task 6: `ChartGrid.tsx` — render two sections

**Files:**
- Modify: `frontend/src/components/ChartGrid.tsx` (full rewrite)

**Interfaces:**
- Consumes: `groupObservers` from `frontend/src/components/chartGrouping.ts` (Task 5). `SymbolChartCard` gains an `isReady: boolean` prop in this task's usage — the prop itself is added to `SymbolChartCard`'s signature in Task 7; this task's edit passes it, so Tasks 6 and 7 must land together for the branch to compile (they are still separate commits, but Task 6's compile check is deferred to after Task 7 — see Step 2 below).

- [ ] **Step 1: Rewrite `frontend/src/components/ChartGrid.tsx`**

Replace the entire file with:

```tsx
import { useState } from 'react';
import { ObserverData } from '../types';
import { SymbolChartCard } from './SymbolChartCard';
import { useOrders } from '../hooks/useOrders';
import { useOrderSizes } from '../hooks/useOrderSizes';
import { groupObservers } from './chartGrouping';

interface Props {
  observers: ObserverData[];
}

export function ChartGrid({ observers }: Props) {
  const [pinnedSymbols, setPinnedSymbols] = useState<Set<string>>(new Set());
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

  const { ready, watching } = groupObservers(observers, pinnedSymbols);
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

  if (allVisible.length === 0) {
    return <p className="text-gray-500 text-sm">No symbols currently qualify.</p>;
  }

  const renderGrid = (group: ObserverData[], isReadyGroup: boolean) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {group.map(o => (
        <SymbolChartCard
          key={o.symbol}
          symbol={o.symbol}
          isPinned={pinnedSymbols.has(o.symbol)}
          onTogglePin={() => togglePin(o.symbol)}
          isReady={isReadyGroup}
          activeOrder={activeOrders.find(order => order.symbol === o.symbol) ?? null}
          orderSize={sizes[o.symbol] ?? 0}
          onBuy={() => buySymbol(o.symbol)}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
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
    </div>
  );
}
```

- [ ] **Step 2: Defer verification to Task 7**

`SymbolChartCard` does not yet accept an `isReady` prop, so `npx tsc --noEmit` will currently fail on this file. Do not run the type check or commit yet — proceed directly into Task 7, which adds the prop and is where both files are verified and committed together.

---

### Task 7: `SymbolChartCard.tsx` — `isReady` prop and badge

**Files:**
- Modify: `frontend/src/components/SymbolChartCard.tsx:6-13,28,39-59`

**Interfaces:**
- Consumes: `isReady: boolean`, passed by `ChartGrid.tsx` (Task 6).
- Produces: no new exports; this is the final piece needed for the branch to compile after Task 6.

- [ ] **Step 1: Add `isReady` to `Props` and the function signature**

In `frontend/src/components/SymbolChartCard.tsx`, replace lines 6-13:

```tsx
interface Props {
  symbol: string;
  isPinned: boolean;
  onTogglePin: () => void;
  activeOrder: ActiveOrder | null;
  orderSize: number;
  onBuy: () => void;
}
```

with:

```tsx
interface Props {
  symbol: string;
  isPinned: boolean;
  onTogglePin: () => void;
  isReady: boolean;
  activeOrder: ActiveOrder | null;
  orderSize: number;
  onBuy: () => void;
}
```

Replace line 28:

```tsx
export function SymbolChartCard({ symbol, isPinned, onTogglePin, activeOrder, orderSize, onBuy }: Props) {
```

with:

```tsx
export function SymbolChartCard({ symbol, isPinned, onTogglePin, isReady, activeOrder, orderSize, onBuy }: Props) {
```

- [ ] **Step 2: Add the "READY" badge to the header row**

Replace lines 39-59 (the header's symbol/pin block, from `<div className="flex items-center justify-between mb-2">` through the closing of the timeframe-toggle `<div>`):

```tsx
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
        </div>
        <div className="flex rounded overflow-hidden border border-gray-700">
```

with:

```tsx
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
```

- [ ] **Step 3: Verify the frontend compiles and existing tests pass**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: 0 errors.

Run (from `frontend/`): `TS_NODE_PROJECT=tsconfig.test.json node --require ts-node/register --test 'src/**/*.test.ts'`
Expected: PASS, all tests (existing `useSymbolChartData` tests + new `chartGrouping` tests from Task 5).

Run (from `frontend/`): `npx vite build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ChartGrid.tsx frontend/src/components/SymbolChartCard.tsx
git commit -m "feat: split charts grid into Ready/Watching sections with a READY badge"
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

Start both servers (backend on its configured port, frontend via `npm run dev`/Vite). Wait for backend preload logs to confirm historical candles loaded for all symbols. Open the frontend in a browser.

Confirm:
- The grid renders with a "Ready" section (if any symbol currently has `step2`) and/or a "Watching" section (if any symbol currently has `step1` only), each showing symbol cards in the same 4-column layout as before.
- Cards in the "Ready" section show the green "READY" badge next to their symbol name; cards in "Watching" do not.
- The footer (price/target/size) and Buy button render and behave identically in both sections — clicking Buy on a card in either section successfully opens an order (via the existing `/api/orders/buy` flow), unaffected by this feature.
- Pinning a card in either section moves it to the front of that section's grid, without moving it to the other section.
- No console errors.

If the current market state happens to produce an empty "Ready" or "Watching" section, that's expected (not every symbol will be mid-setup at any given moment) — confirm at least one non-empty section renders correctly rather than requiring both.

- [ ] **Step 4: No commit for this task**

This task is verification-only; nothing to stage or commit.

---

## Self-Review

**Spec coverage:**
- State machine mechanics (reset priority, step1/step2 triggers, 20-candle window, per-timeframe independence) → Task 2.
- Close-only evaluation (no live-tick recompute) → Task 3 (`updateCandle1s` no longer touches signal state; `updateCandle1m`/`updateCandle1h` only advance on `isClosed`).
- Startup replay from preloaded history → Task 3 (`preloadClosed1m`/`preloadClosed1h` rewritten to replay).
- `qualifies` derivation (OR of all four booleans) → Task 3 (`getState()`).
- Two-div frontend split + pinned-first ordering within each div + pin-does-not-force-visibility → Task 5 (`groupObservers`) + Task 6 (`ChartGrid`).
- Visual "READY" signal on step2 cards → Task 7.
- Buy button/footer unchanged and available in both divs → Task 6 (`renderGrid` passes the same `activeOrder`/`orderSize`/`onBuy` props regardless of `isReadyGroup`) + confirmed live in Task 8.
- Type mirroring backend↔frontend → Tasks 1 and 4.
- `ObserverManager`/`BotManager`/routes need no changes → confirmed by Task 3's full backend test+tsc run (Step 4) surfacing zero ripple effects.

**Placeholder scan:** none found — every step has complete, runnable code and exact commands.

**Type consistency:** `TimeframeSignal`/`SignalReasons` field names (`step1`, `step2`, `m1`, `h1`) are identical across Tasks 1, 2, 3, 4, 5. `nextTimeframeSignal(closed, prev)` signature matches its Task 2 definition everywhere it's called in Task 3. `groupObservers(observers, pinnedSymbols)` signature matches between its Task 5 definition and Task 6 usage. `SymbolChartCard`'s `isReady` prop name matches between Task 6 (passed) and Task 7 (declared/used).
