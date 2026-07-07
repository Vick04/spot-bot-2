# Live Signal Detector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the live bot's ImpulseTracker/OrderManager buy-sell strategy with a pure condition-based signal detector that exposes a live list of qualifying symbol names to the client.

**Architecture:** A pure function `detectSignal()` evaluates 4 OR'd conditions (bbUpper on 1m/1h with a "live" Bollinger band, 3-positive-candles on 1m/1h including the in-formation candle) against per-symbol rolling state kept in a rewritten `Observer`. `ObserverManager`/`BotManager`/socket/API are simplified to only carry `{ symbol, qualifies, reasons }`. The old strategy (ImpulseTracker, OrderManager, TopSymbolsManager, tradingPipeline, emulator) is deleted outright — no adapter, no dual-path.

**Tech Stack:** TypeScript, Node `node:test` + `node:assert/strict`, Express, Socket.IO, React 18, Vite, Tailwind.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-06-live-signal-detector-design.md` — this plan implements it in full; do not deviate from the condition definitions there.
- `bollingerUpper()` and `sma()` in `backend/src/utils/indicators.ts` already implement population-stddev Bollinger(20,2); reuse them, do not reimplement.
- Bollinger "live" window = 19 closed candles + the current live price as the 20th value. Below 19 closed candles → that sub-condition is `false` (not an error).
- "3 positive candles" = current in-formation candle (`price > formOpen`) + the 2 closed candles immediately before it, all with `close > open`. Below 2 closed candles → that sub-condition is `false`.
- No order/balance/enable/disable/reset concepts remain anywhere in backend or frontend after this plan.
- Commit after every task.

---

### Task 1: Backend types + pure signal-detection function

**Files:**
- Modify: `backend/src/types/index.ts`
- Create: `backend/src/utils/signals.ts`
- Create: `backend/src/utils/signals.test.ts`

**Interfaces:**
- Produces: `SignalReasons` (`{ bbUpper1m: boolean; bbUpper1h: boolean; threePositive1m: boolean; threePositive1h: boolean }`), `ObserverState` (`{ symbol: string; qualifies: boolean; reasons: SignalReasons }`) from `types/index.ts`.
- Produces: `detectSignal(price: number, closed1m: {open:number;close:number}[], form1mOpen: number | null, closed1h: {open:number;close:number}[], form1hOpen: number | null): { qualifies: boolean; reasons: SignalReasons }` from `utils/signals.ts`.
- Consumes: `bollingerUpper(values: number[]): number` from `utils/indicators.ts` (already exists, unchanged).

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
}

export interface CandleData {
  close: number;
  timestamp: number;
}

export interface SignalReasons {
  bbUpper1m: boolean;
  bbUpper1h: boolean;
  threePositive1m: boolean;
  threePositive1h: boolean;
}

export interface ObserverState {
  symbol: string;
  qualifies: boolean;
  reasons: SignalReasons;
}
```

(This removes `ImpulseTrackingSnapshot`, `ActiveOrder`, `CompletedOrder`, `OrderStatus` and the old shape of `ObserverState`. `CandleData` is kept — still structurally useful, harmless if unused for now.)

- [ ] **Step 2: Write the failing test for `detectSignal`**

Create `backend/src/utils/signals.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSignal } from './signals';
import { bollingerUpper } from './indicators';

function candle(open: number, close: number) {
  return { open, close };
}

// 19 closed 1m candles, increasing closes 100..118 (open == close: irrelevant to bbUpper checks).
const CLOSED_19 = Array.from({ length: 19 }, (_, i) => candle(100 + i, 100 + i));
const CLOSED_18 = CLOSED_19.slice(0, 18);

test('bbUpper1m is true when live price exceeds the recomputed live band', () => {
  const price = 500;
  const expectedBbUpper = bollingerUpper([...CLOSED_19.map(c => c.close), price]);
  assert.ok(price > expectedBbUpper, 'test setup: price must exceed the band');

  const result = detectSignal(price, CLOSED_19, null, [], null);
  assert.equal(result.reasons.bbUpper1m, true);
  assert.equal(result.qualifies, true);
});

test('bbUpper1m is false when live price sits inside the recomputed live band', () => {
  const price = 100.001; // near the bottom of an increasing sequence's band
  const result = detectSignal(price, CLOSED_19, null, [], null);
  assert.equal(result.reasons.bbUpper1m, false);
});

test('the live band recomputes per tick — same closed candles, different price flips the result', () => {
  const low = detectSignal(100.001, CLOSED_19, null, [], null);
  const high = detectSignal(500, CLOSED_19, null, [], null);
  assert.equal(low.reasons.bbUpper1m, false);
  assert.equal(high.reasons.bbUpper1m, true);
});

test('bbUpper1m is false with fewer than 19 closed candles, regardless of price', () => {
  const result = detectSignal(1_000_000, CLOSED_18, null, [], null);
  assert.equal(result.reasons.bbUpper1m, false);
});

test('bbUpper1h mirrors bbUpper1m independently using the 1h series', () => {
  const result = detectSignal(100.001, [], null, CLOSED_19, null);
  assert.equal(result.reasons.bbUpper1m, false);
  assert.equal(result.reasons.bbUpper1h, false);

  const result2 = detectSignal(500, [], null, CLOSED_19, null);
  assert.equal(result2.reasons.bbUpper1h, true);
});

test('threePositive1m is true when the live candle and the 2 prior closed candles are all positive', () => {
  const closed = [candle(90, 95), candle(95, 105)]; // both positive (close > open)
  const result = detectSignal(110, closed, 100, [], null); // live price 110 > formOpen 100 → positive
  assert.equal(result.reasons.threePositive1m, true);
});

test('threePositive1m is false when the live candle is not positive', () => {
  const closed = [candle(90, 95), candle(95, 105)];
  const result = detectSignal(100, closed, 100, [], null); // price == formOpen → not positive
  assert.equal(result.reasons.threePositive1m, false);
});

test('threePositive1m is false when one of the 2 prior closed candles is negative', () => {
  const closed = [candle(90, 95), candle(105, 100)]; // second candle negative
  const result = detectSignal(110, closed, 100, [], null);
  assert.equal(result.reasons.threePositive1m, false);
});

test('threePositive1m is false with fewer than 2 closed candles', () => {
  const closed = [candle(90, 95)];
  const result = detectSignal(110, closed, 100, [], null);
  assert.equal(result.reasons.threePositive1m, false);
});

test('threePositive1m is false when there is no in-formation candle (formOpen null)', () => {
  const closed = [candle(90, 95), candle(95, 105)];
  const result = detectSignal(110, closed, null, [], null);
  assert.equal(result.reasons.threePositive1m, false);
});

test('qualifies is the OR of all four reasons — false when none hold, true when exactly one holds', () => {
  const none = detectSignal(100.001, CLOSED_19, null, CLOSED_19, null);
  assert.equal(none.qualifies, false);

  const onlyOne = detectSignal(500, CLOSED_19, null, [], null);
  assert.equal(onlyOne.reasons.bbUpper1m, true);
  assert.equal(onlyOne.reasons.bbUpper1h, false);
  assert.equal(onlyOne.reasons.threePositive1m, false);
  assert.equal(onlyOne.reasons.threePositive1h, false);
  assert.equal(onlyOne.qualifies, true);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && node --test --require ts-node/register src/utils/signals.test.ts`
Expected: FAIL — `Cannot find module './signals'`

- [ ] **Step 4: Implement `backend/src/utils/signals.ts`**

```ts
import { SignalReasons } from '../types';
import { bollingerUpper } from './indicators';

export interface SignalResult {
  qualifies: boolean;
  reasons: SignalReasons;
}

interface CandleOC {
  open: number;
  close: number;
}

/** 19 closed candles + the live price = a 20-value Bollinger window. */
const CLOSED_WINDOW = 19;

/** True when the live price exceeds the Bollinger upper band recomputed with
 * the live price standing in as the 20th (most recent) value. */
function bbUpperCondition(price: number, closed: CandleOC[]): boolean {
  if (closed.length < CLOSED_WINDOW) return false;
  const closes = closed.slice(-CLOSED_WINDOW).map(c => c.close);
  return price > bollingerUpper([...closes, price]);
}

/** True when the in-formation candle and the 2 closed candles before it are all positive. */
function threePositiveCondition(price: number, formOpen: number | null, closed: CandleOC[]): boolean {
  if (formOpen === null || closed.length < 2) return false;
  if (!(price > formOpen)) return false;
  const [prev2, prev1] = closed.slice(-2);
  return prev1.close > prev1.open && prev2.close > prev2.open;
}

export function detectSignal(
  price: number,
  closed1m: CandleOC[],
  form1mOpen: number | null,
  closed1h: CandleOC[],
  form1hOpen: number | null,
): SignalResult {
  const reasons: SignalReasons = {
    bbUpper1m: bbUpperCondition(price, closed1m),
    bbUpper1h: bbUpperCondition(price, closed1h),
    threePositive1m: threePositiveCondition(price, form1mOpen, closed1m),
    threePositive1h: threePositiveCondition(price, form1hOpen, closed1h),
  };

  return {
    qualifies: reasons.bbUpper1m || reasons.bbUpper1h || reasons.threePositive1m || reasons.threePositive1h,
    reasons,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && node --test --require ts-node/register src/utils/signals.test.ts`
Expected: PASS — all 11 tests green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/types/index.ts backend/src/utils/signals.ts backend/src/utils/signals.test.ts
git commit -m "feat: add pure signal-detection function and new ObserverState shape"
```

---

### Task 2: Preload fetch — configurable 1m candle limit

**Files:**
- Modify: `backend/src/services/historicalCandles.ts:41-50`

**Interfaces:**
- Produces: `fetchHistoricalCandles(symbol: string, limit?: number): Promise<Candle[]>` (limit defaults to 99 for backward compatibility of the signature; Task 5 will call it with 19).
- Consumes: nothing new.

- [ ] **Step 1: Update `fetchHistoricalCandles` to accept a `limit` parameter**

Replace lines 41-50 of `backend/src/services/historicalCandles.ts`:

```ts
/**
 * Fetches the last `limit` closed 1m candles for a symbol from Binance REST API.
 * We request limit+1 and drop the last row, which may be the currently open candle.
 */
export async function fetchHistoricalCandles(symbol: string, limit = 99): Promise<Candle[]> {
  const url = `${BINANCE_REST_URL}/api/v3/klines?symbol=${symbol}&interval=1m&limit=${limit + 1}`;
  const rows = await get<BinanceKlineRow[]>(url);
  return rows.slice(0, limit).map(row => parseRow(symbol, '1m', row));
}
```

- [ ] **Step 2: Verify the project still compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: no new errors introduced by this change (existing errors from not-yet-updated callers are expected at this point in the plan — ignore them for now, they're addressed in Task 5).

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/historicalCandles.ts
git commit -m "refactor: make fetchHistoricalCandles limit configurable"
```

---

### Task 3: Rewrite `Observer` — delete `ImpulseTracker`

**Files:**
- Modify (full rewrite): `backend/src/observers/Observer.ts`
- Delete: `backend/src/observers/ImpulseTracker.ts`
- Delete: `backend/src/observers/ImpulseTracker.test.ts`

**Interfaces:**
- Consumes: `Candle`, `ObserverState` from `../types`; `Queue<T>` from `../utils/Queue` (unchanged: `push`, `toArray`, `capacity`, `size`, `isFull`); `detectSignal`, `SignalResult` from `../utils/signals` (Task 1).
- Produces: `class Observer` with `constructor(symbol: string)`, `preloadClosed1m(candles: Candle[]): void`, `preloadClosed1h(candles: Candle[]): void`, `updateCandle1s(candle: Candle): void`, `updateCandle1m(candle: Candle): void`, `updateCandle1h(candle: Candle): void`, `getState(): ObserverState`. (Note: `calculateMA99`, `isReady`, `resetImpulseTracker`, `getBuffer1m`, the `mode`/`clock` constructor options are all gone — nothing later depends on them.)

- [ ] **Step 1: Delete the old ImpulseTracker files**

```bash
git rm backend/src/observers/ImpulseTracker.ts backend/src/observers/ImpulseTracker.test.ts
```

- [ ] **Step 2: Rewrite `backend/src/observers/Observer.ts`**

```ts
import { Candle, ObserverState } from '../types';
import { Queue } from '../utils/Queue';
import { detectSignal, SignalResult } from '../utils/signals';

/** 19 closed candles + the live price = a 20-value Bollinger window (see utils/signals.ts). */
const CLOSED_WINDOW = 19;

const EMPTY_SIGNAL: SignalResult = {
  qualifies: false,
  reasons: { bbUpper1m: false, bbUpper1h: false, threePositive1m: false, threePositive1h: false },
};

export class Observer {
  private symbol: string;
  private closed1m: Queue<Candle>;
  private closed1h: Queue<Candle>;
  private form1mOpen: number | null = null;
  private form1hOpen: number | null = null;
  private currentPrice: number | null = null;
  private signal: SignalResult = EMPTY_SIGNAL;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.closed1m = new Queue<Candle>(CLOSED_WINDOW);
    this.closed1h = new Queue<Candle>(CLOSED_WINDOW);
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
      this.form1mOpen = null;
    } else {
      this.form1mOpen = candle.open;
    }
    this.recompute();
  }

  updateCandle1h(candle: Candle): void {
    if (candle.isClosed) {
      this.closed1h.push(candle);
      this.form1hOpen = null;
    } else {
      this.form1hOpen = candle.open;
    }
    this.recompute();
  }

  getState(): ObserverState {
    return { symbol: this.symbol, qualifies: this.signal.qualifies, reasons: this.signal.reasons };
  }

  private recompute(): void {
    if (this.currentPrice === null) return;
    this.signal = detectSignal(
      this.currentPrice,
      this.closed1m.toArray(),
      this.form1mOpen,
      this.closed1h.toArray(),
      this.form1hOpen,
    );
  }
}
```

- [ ] **Step 3: Verify with a quick manual smoke script (no permanent test file needed — Observer is a thin wrapper over the already-tested `detectSignal`)**

Run:
```bash
cd backend && node --require ts-node/register -e "
const { Observer } = require('./src/observers/Observer');
const o = new Observer('BTCUSDT');
for (let i = 0; i < 19; i++) {
  o.updateCandle1m({ symbol: 'BTCUSDT', timeframe: '1m', openTime: i, open: 100+i, high: 100+i, low: 100+i, close: 100+i, isClosed: true });
}
o.updateCandle1m({ symbol: 'BTCUSDT', timeframe: '1m', openTime: 999, open: 118, high: 118, low: 118, close: 118, isClosed: false });
o.updateCandle1s({ symbol: 'BTCUSDT', timeframe: '1s', openTime: 1000, open: 500, high: 500, low: 500, close: 500, isClosed: true });
console.log(JSON.stringify(o.getState()));
"
```
Expected: `{"symbol":"BTCUSDT","qualifies":true,"reasons":{"bbUpper1m":true,...}}` — `qualifies: true` because price 500 is far above the band built from closes 100..118.

- [ ] **Step 4: Commit**

```bash
git add backend/src/observers/Observer.ts
git commit -m "refactor: rewrite Observer around detectSignal, remove ImpulseTracker"
```

---

### Task 4: Rewrite `ObserverManager`

**Files:**
- Modify (full rewrite): `backend/src/managers/ObserverManager.ts`

**Interfaces:**
- Consumes: `Observer` from `../observers/Observer` (Task 3) — `constructor(symbol)`, `preloadClosed1m`, `preloadClosed1h`, `updateCandle1s/1m/1h`, `getState()`; `Candle`, `ObserverState` from `../types`.
- Produces: `class ObserverManager extends EventEmitter` with `createObserver(symbol: string): void`, `createObservers(symbols: string[]): void`, `updateCandle(candle: Candle): void`, `getAllStates(): ObserverState[]`, `getObserverState(symbol: string): ObserverState | null`, `getQualifyingSymbols(): string[]`, `preloadObserver1m(symbol: string, candles: Candle[]): void`, `preloadObserver1h(symbol: string, candles: Candle[]): void`, `getSymbols(): string[]`. Emits `'signal'` with the full `ObserverState` whenever a symbol's `qualifies` flips value (in either direction). (Note: no more `'hit'`, `'reset'`, `'candle'` events, `resetAllImpulseTrackers`, `getBuffer1m`, or the `mode`/`clock` constructor options.)

- [ ] **Step 1: Rewrite `backend/src/managers/ObserverManager.ts`**

```ts
import { EventEmitter } from 'events';
import { Observer } from '../observers/Observer';
import { Candle, ObserverState } from '../types';

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

- [ ] **Step 2: Verify it compiles standalone**

Run: `cd backend && npx tsc --noEmit`
Expected: errors remaining only in `BotManager.ts`, `socketServer.ts`, `routes/api.ts` (not yet updated) and the soon-to-be-deleted `OrderManager`/`tradingPipeline`/`TopSymbolsManager`/`emulator` files — no errors in `ObserverManager.ts` or `Observer.ts` themselves.

- [ ] **Step 3: Commit**

```bash
git add backend/src/managers/ObserverManager.ts
git commit -m "refactor: simplify ObserverManager to signal-only events"
```

---

### Task 5: Rewrite `BotManager` — delete `OrderManager`, `TopSymbolsManager`, `tradingPipeline`

**Files:**
- Modify (full rewrite): `backend/src/managers/BotManager.ts`
- Delete: `backend/src/managers/OrderManager.ts`
- Delete: `backend/src/managers/OrderManager.test.ts`
- Delete: `backend/src/managers/TopSymbolsManager.ts`
- Delete: `backend/src/managers/tradingPipeline.ts`

**Interfaces:**
- Consumes: `SymbolManager` (unchanged), `ObserverManager` (Task 4) — `createObservers`, `preloadObserver1m`, `preloadObserver1h`, `updateCandle`; `BinanceWebSocket` (unchanged) — `on('candle', ...)`, `connect()`, `destroy()`; `fetchHistoricalCandles(symbol, limit?)` (Task 2), `fetchClosedHourCandles(symbol, limit?)` (unchanged, already takes a `limit`).
- Produces: `class BotManager` with `symbolManager`, `observerManager` (public readonly), `start(): Promise<void>`, `stop(): void`. (No more `topSymbolsManager`, `orderManager`, `resetBot()`, `forceSell()`, `getReadySymbols()`.)

- [ ] **Step 1: Delete the old order/top25/pipeline files**

```bash
git rm backend/src/managers/OrderManager.ts backend/src/managers/OrderManager.test.ts backend/src/managers/TopSymbolsManager.ts backend/src/managers/tradingPipeline.ts
```

- [ ] **Step 2: Rewrite `backend/src/managers/BotManager.ts`**

```ts
import { SymbolManager } from '../services/symbolManager';
import { ObserverManager } from './ObserverManager';
import { BinanceWebSocket } from '../services/binanceWebSocket';
import { fetchHistoricalCandles, fetchClosedHourCandles } from '../services/historicalCandles';

/** 19 closed candles + the live price = the 20-value Bollinger window (see utils/signals.ts). */
const PRELOAD_CANDLES = 19;

export class BotManager {
  readonly symbolManager: SymbolManager;
  readonly observerManager: ObserverManager;
  private ws: BinanceWebSocket | null = null;

  constructor() {
    this.symbolManager = new SymbolManager();
    this.observerManager = new ObserverManager();
  }

  async start(): Promise<void> {
    await this.symbolManager.load();

    const symbols = this.symbolManager.getSymbols();
    this.observerManager.createObservers(symbols);
    await this.preloadObservers(symbols);

    this.ws = new BinanceWebSocket(symbols);
    this.ws.on('candle', candle => this.observerManager.updateCandle(candle));
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
        const candles = await fetchHistoricalCandles(symbol, PRELOAD_CANDLES);
        this.observerManager.preloadObserver1m(symbol, candles);
      })
    );

    const ok = results.filter(r => r.status === 'fulfilled').length;
    results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .forEach(r => console.error('[Preload] 1m candles failed:', r.reason));

    console.log(`[Preload] Done — ${ok}/${symbols.length} observers' 1m windows loaded`);

    const hourResults = await Promise.allSettled(
      symbols.map(async symbol => {
        const candles = await fetchClosedHourCandles(symbol, PRELOAD_CANDLES);
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

- [ ] **Step 3: Commit**

```bash
git add backend/src/managers/BotManager.ts
git commit -m "refactor: simplify BotManager, remove order/top25 strategy"
```

---

### Task 6: Rewrite API routes and socket server, update `index.ts`

**Files:**
- Modify (full rewrite): `backend/src/routes/api.ts`
- Modify (full rewrite): `backend/src/services/socketServer.ts`
- Modify: `backend/src/index.ts:20-21`

**Interfaces:**
- Consumes: `BotManager` (Task 5) — `.symbolManager`, `.observerManager`; `ObserverManager` (Task 4) — `getAllStates()`, `getObserverState()`, `getQualifyingSymbols()`, `on('signal', ...)`.
- Produces: socket events `'snapshot'` (`{ observers: ObserverState[] }`) on connect, `'signal'` (`ObserverState`) on every qualification change. REST: `GET /api/symbols`, `GET /api/observers`, `GET /api/observers/:symbol`, `GET /api/qualifying`.

- [ ] **Step 1: Rewrite `backend/src/routes/api.ts`**

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

  router.get('/qualifying', (_req: Request, res: Response) => {
    res.json({ data: bot.observerManager.getQualifyingSymbols() });
  });

  return router;
}
```

- [ ] **Step 2: Rewrite `backend/src/services/socketServer.ts`**

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
}
```

- [ ] **Step 3: Update `backend/src/index.ts`**

Change line 21 from:
```ts
  createSocketServer(httpServer, bot.observerManager, bot.topSymbolsManager, bot.orderManager);
```
to:
```ts
  createSocketServer(httpServer, bot.observerManager);
```

- [ ] **Step 4: Compile the whole backend**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors (the emulator directory still exists and will fail — that's addressed in Task 7; if `tsc` picks up the emulator files and errors on them, proceed to Task 7 immediately before treating this as a blocker).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/api.ts backend/src/services/socketServer.ts backend/src/index.ts
git commit -m "refactor: simplify API/socket payloads to signal-only state"
```

---

### Task 7: Delete the emulator module

**Files:**
- Delete: `backend/src/emulator/EmulatorEngine.ts`
- Delete: `backend/src/emulator/csvCandleSource.ts`
- Delete: `backend/src/emulator/hourCandleCursor.ts`
- Delete: `backend/src/emulator/hourCandleCursor.test.ts`
- Delete: `backend/src/emulator/reportWriter.ts`
- Delete: `backend/src/emulator/run.ts`
- Modify: `backend/package.json:9`

**Interfaces:** none — this is pure deletion, nothing outside `emulator/` imports from it (verified: only `package.json`'s `emulate` script references it).

- [ ] **Step 1: Delete the emulator directory**

```bash
git rm -r backend/src/emulator
```

- [ ] **Step 2: Remove the `emulate` script from `backend/package.json`**

Remove this line from the `"scripts"` block:
```json
    "emulate": "ts-node --transpile-only src/emulator/run.ts",
```

- [ ] **Step 3: Compile and run the full backend test suite**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: `tsc` reports 0 errors. `npm test` runs only `src/utils/signals.test.ts` and `src/utils/indicators.test.ts` (the only remaining `*.test.ts` files) and both pass.

- [ ] **Step 4: Commit**

```bash
git add backend/package.json
git commit -m "chore: remove emulator module (backtested the retired order strategy)"
```

---

### Task 8: Frontend types + `useSocket` rewrite

**Files:**
- Modify (full rewrite): `frontend/src/types/index.ts`
- Modify (full rewrite): `frontend/src/hooks/useSocket.ts`

**Interfaces:**
- Produces: `SignalReasons`, `ObserverData` (`{ symbol: string; qualifies: boolean; reasons: SignalReasons }`), `ApiResponse<T>` from `types/index.ts`.
- Produces: `useSocket(): { observers: Map<string, ObserverData>; connected: boolean }` from `hooks/useSocket.ts`.
- Consumes: socket events `'snapshot'` (`{ observers: ObserverData[] }`), `'signal'` (`ObserverData`) — matches Task 6's server payloads exactly.

- [ ] **Step 1: Rewrite `frontend/src/types/index.ts`**

```ts
export interface SignalReasons {
  bbUpper1m: boolean;
  bbUpper1h: boolean;
  threePositive1m: boolean;
  threePositive1h: boolean;
}

export interface ObserverData {
  symbol: string;
  qualifies: boolean;
  reasons: SignalReasons;
}

export interface ApiResponse<T> {
  data: T;
}
```

- [ ] **Step 2: Rewrite `frontend/src/hooks/useSocket.ts`**

```ts
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { ObserverData } from '../types';

const SOCKET_URL = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

interface SocketStore {
  observers: Map<string, ObserverData>;
  connected: boolean;
}

export function useSocket() {
  const [store, setStore] = useState<SocketStore>({
    observers: new Map(),
    connected: false,
  });

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setStore(s => ({ ...s, connected: true })));
    socket.on('disconnect', () => setStore(s => ({ ...s, connected: false })));

    socket.on('snapshot', ({ observers }: { observers: ObserverData[] }) => {
      setStore(s => ({ ...s, observers: new Map(observers.map(o => [o.symbol, o])) }));
    });

    socket.on('signal', (state: ObserverData) => {
      setStore(s => {
        const next = new Map(s.observers);
        next.set(state.symbol, state);
        return { ...s, observers: next };
      });
    });

    return () => { socket.disconnect(); };
  }, []);

  return store;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/hooks/useSocket.ts
git commit -m "refactor: simplify frontend socket types to signal-only state"
```

---

### Task 9: Frontend UI — single qualifying-symbols list

**Files:**
- Create: `frontend/src/components/QualifyingList.tsx`
- Modify (full rewrite): `frontend/src/App.tsx`
- Delete: `frontend/src/components/SymbolTable.tsx`
- Delete: `frontend/src/components/Top25Table.tsx`
- Delete: `frontend/src/components/ReadyTable.tsx`
- Delete: `frontend/src/components/OrdersPanel.tsx`
- Delete: `frontend/src/utils/format.ts`

**Interfaces:**
- Consumes: `ObserverData` from `../types` (Task 8); `useSocket()` from `./hooks/useSocket` (Task 8).
- Produces: `QualifyingList({ observers: ObserverData[] })` React component.

- [ ] **Step 1: Delete the old components and the now-unused format helpers**

```bash
git rm frontend/src/components/SymbolTable.tsx frontend/src/components/Top25Table.tsx frontend/src/components/ReadyTable.tsx frontend/src/components/OrdersPanel.tsx frontend/src/utils/format.ts
```

- [ ] **Step 2: Create `frontend/src/components/QualifyingList.tsx`**

```tsx
import { ObserverData } from '../types';

interface Props {
  observers: ObserverData[];
}

export function QualifyingList({ observers }: Props) {
  const qualifying = observers.filter(o => o.qualifies);

  if (qualifying.length === 0) {
    return <p className="text-gray-500 text-sm">No symbols currently qualify.</p>;
  }

  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
      {qualifying.map(o => (
        <li
          key={o.symbol}
          className="px-3 py-2 rounded bg-gray-900 border border-gray-800 font-mono text-sm text-yellow-400 text-center"
        >
          {o.symbol}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Rewrite `frontend/src/App.tsx`**

```tsx
import { useSocket } from './hooks/useSocket';
import { QualifyingList } from './components/QualifyingList';

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
        <QualifyingList observers={observerList} />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Build the frontend**

Run: `cd frontend && npm run build`
Expected: `tsc && vite build` completes with 0 errors, no unresolved imports.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/QualifyingList.tsx frontend/src/App.tsx
git commit -m "feat: single qualifying-symbols list replaces tabbed order/top25 UI"
```

---

### Task 10: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: all tests in `src/utils/signals.test.ts` and `src/utils/indicators.test.ts` pass, 0 failures.

- [ ] **Step 2: Compile both packages**

Run: `cd backend && npx tsc --noEmit && cd ../frontend && npx tsc --noEmit`
Expected: 0 errors in both.

- [ ] **Step 3: Start backend and frontend dev servers, verify in browser**

Use the preview tool to start both `backend` (`npm run dev`) and `frontend` (`npm run dev`) per `.claude/launch.json` (create the config if missing, pointing at each package's `dev` script and port — backend `3000`, frontend's Vite default `5173`).

Open the frontend in the browser preview and confirm:
- Header shows "SPOT BOT" and a connection indicator that turns green once the socket connects.
- The subtitle shows "Live signal detector — N qualifying" with a live-updating count.
- The main area shows either "No symbols currently qualify." or a grid of symbol names — no tabs, no order/balance UI anywhere.
- Check the browser console (`preview_console_logs`) for errors — expect none related to missing socket fields (`top25`, `orderStatus`, etc.).
- Check network tab (`preview_network`) for the `GET /api/qualifying` and `GET /api/observers` endpoints if manually hit — confirm the JSON shape matches `{ data: string[] }` and `{ data: ObserverState[] }` respectively.

- [ ] **Step 4: Report results to the user**

Summarize: tests passing, both packages compiling clean, and what was observed live in the browser (does the list populate, does the count move as candles arrive). Do not claim "done" without having completed Steps 1-3 first.
