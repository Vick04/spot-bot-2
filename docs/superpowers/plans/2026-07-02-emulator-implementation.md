# Emulador de 12 meses — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI emulator that replays 12 months of 1m historical candles (175 symbols, `history/<SYMBOL>/<SYMBOL>_1m.csv`) through the bot's exact decision logic and produces a Markdown performance report, without changing the live bot's 1s-based behavior.

**Architecture:** Existing live classes (`Observer`, `ObserverManager`, `ImpulseTracker`, `OrderManager`) get optional, additive constructor parameters (`clock`, `mode`) that default to current behavior. A new `backend/src/emulator/` module streams the CSV history through a k-way merge (sorted by `open_time`, no full load into memory), drives those classes in `'emulation'` mode with a simulated clock, and writes a Markdown report. The buy/sell decision rule is extracted once from `BotManager` into a shared `evaluateTick()` function so live and emulator use identical logic.

**Tech Stack:** TypeScript (Node 22), no test framework in this repo — verification is `tsc` + ad-hoc `ts-node` smoke scripts, matching existing project convention.

## Global Constraints

- Live bot behavior (`Observer`, `BotManager`, `ImpulseTracker`, `OrderManager` used without new options) must not change in any way — every new parameter is optional and defaults to current behavior.
- No changes to `backend/src/types/index.ts`, `backend/src/config/constants.ts`, or any frontend file.
- No changes to strategy thresholds: allowed +0.8% (`1.008`), reached/hit +1.3% (`1.013`), sell target +0.5% (`1.005`), fee `0.001`, initial balance `10_000`.
- One active position at a time (all-in, compounding) — unchanged.
- No stop-loss, no time-based exit — out of scope.
- `tsc` (via `npm run build` in `backend/`) must pass clean after every task.
- Do not commit `results/*.md` files — those are generated run artifacts, not part of the plan's deliverable commits.

---

### Task 1: Clock injection in `ImpulseTracker`

**Files:**
- Modify: `backend/src/observers/ImpulseTracker.ts`

**Interfaces:**
- Produces: `new ImpulseTracker(clock?: () => number)` — `clock` defaults to `Date.now`. Used internally wherever the class currently calls `Date.now()`.

- [ ] **Step 1: Edit `ImpulseTracker.ts` to accept an optional clock**

Change the top of the class (lines 7-20 currently) to store an injected clock, defaulting to `Date.now`:

```ts
export class ImpulseTracker {
  private floor: number | undefined = undefined;
  private allowed = false;
  private reached = false;
  private counter = 0;
  private ma99AtFloorSet: number | undefined = undefined;
  private allowedActivatedAt: number | null = null;
  private timings: number[] = [];
  private averageTime: number | null = null;
  private clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }
```

- [ ] **Step 2: Replace internal `Date.now()` calls with `this.clock()`**

In `process()`:

```ts
    // Step 3: allow — price recovers +0.8% from floor
    if (!this.allowed && close >= this.floor * ALLOWED_THRESHOLD) {
      this.allowed = true;
      this.allowedActivatedAt = this.clock();
    }

    // Step 4: reached — price hits +1.3% from floor
    if (!this.reached && close >= this.floor * REACHED_THRESHOLD) {
      this.reached = true;

      if (this.allowedActivatedAt !== null) {
        const elapsed = this.clock() - this.allowedActivatedAt;
```

In the `currentElapsedTime` getter:

```ts
  get currentElapsedTime(): number | null {
    if (!this.allowed || this.allowedActivatedAt === null) return null;
    return this.clock() - this.allowedActivatedAt;
  }
```

- [ ] **Step 3: Verify no other `Date.now()` remains in the file**

Run: `grep -n "Date.now" backend/src/observers/ImpulseTracker.ts`
Expected: no matches (all replaced by `this.clock()`).

- [ ] **Step 4: Typecheck**

Run: `cd backend && npm run build`
Expected: exits 0, no errors.

- [ ] **Step 5: Ad-hoc verification that live default behavior is unchanged**

Run:
```bash
cd backend && npx ts-node --transpile-only -e "
import { ImpulseTracker } from './src/observers/ImpulseTracker';
const t = new ImpulseTracker();
t.process(95, 100);   // sets floor=95
t.process(96, 100);   // below allowed threshold (95*1.008=95.76), no change
t.process(96, 100);   // above 95.76 -> allowed=true
console.log(JSON.stringify(t.getSnapshot()));
"
```
Expected: JSON output with `"allowed":true`, `"floor":95`, `"readyToBuy":true` (allowedActivatedAt is a real wall-clock timestamp close to `Date.now()`).

- [ ] **Step 6: Commit**

```bash
git add backend/src/observers/ImpulseTracker.ts
git commit -m "feat: allow injectable clock in ImpulseTracker (default Date.now)"
```

---

### Task 2: Clock injection + `cancelActiveOrder()` in `OrderManager`

**Files:**
- Modify: `backend/src/managers/OrderManager.ts`

**Interfaces:**
- Produces: `new OrderManager(clock?: () => number)` — defaults to `Date.now`.
- Produces: `orderManager.cancelActiveOrder(): void` — if there's an active order, restores `balance = activeOrder.usdtSpent` and clears `activeOrder` without adding to `history`. No-op if there's no active order.

- [ ] **Step 1: Add constructor with injectable clock**

```ts
export class OrderManager extends EventEmitter {
  private balance: number = INITIAL_BALANCE;
  private activeOrder: ActiveOrder | null = null;
  private history: CompletedOrder[] = [];
  private enabled: boolean = false;
  private clock: () => number;

  constructor(clock: () => number = Date.now) {
    super();
    this.clock = clock;
  }
```

- [ ] **Step 2: Replace `Date.now()` in `buy()` and `sell()` with `this.clock()`**

In `buy()`:

```ts
    this.activeOrder = { symbol, buyPrice: price, quantity, targetPrice, usdtSpent, openedAt: this.clock() };
```

In `sell()`:

```ts
    const closedAt = this.clock();
```

- [ ] **Step 3: Add `cancelActiveOrder()` method**

Add after `forceSell()`:

```ts
  cancelActiveOrder(): void {
    if (!this.activeOrder) return;
    console.log(`[Order] CANCEL ${this.activeOrder.symbol} — restoring balance to ${this.activeOrder.usdtSpent.toFixed(4)} USDT`);
    this.balance = this.activeOrder.usdtSpent;
    this.activeOrder = null;
  }
```

- [ ] **Step 4: Typecheck**

Run: `cd backend && npm run build`
Expected: exits 0, no errors.

- [ ] **Step 5: Ad-hoc verification**

Run:
```bash
cd backend && npx ts-node --transpile-only -e "
import { OrderManager } from './src/managers/OrderManager';
const om = new OrderManager(() => 12345);
om.setEnabled(true);
om.buy('BTCUSDT', 100);
console.log('balance after buy:', om.getBalance());
console.log('active order:', JSON.stringify(om.getActiveOrder()));
om.cancelActiveOrder();
console.log('balance after cancel:', om.getBalance());
console.log('active order after cancel:', om.getActiveOrder());
console.log('history length:', om.getHistory().length);
"
```
Expected: `balance after buy: 0`, active order shown with `usdtSpent: 10000`, `balance after cancel: 10000`, `active order after cancel: null`, `history length: 0`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/managers/OrderManager.ts
git commit -m "feat: injectable clock + cancelActiveOrder in OrderManager"
```

---

### Task 3: `'emulation'` mode + clock in `Observer`

**Files:**
- Modify: `backend/src/observers/Observer.ts`

**Interfaces:**
- Consumes: `new ImpulseTracker(clock?: () => number)` (Task 1).
- Produces: `new Observer(symbol: string, options?: { mode?: 'live' | 'emulation'; clock?: () => number })`. Default `mode: 'live'` — `updateCandle1s`/`updateCandle1m` behave exactly as before. In `'emulation'` mode, `updateCandle1m` feeds the impulse tracker from `candle.high` on closed candles, before pushing to the MA99 queue.

- [ ] **Step 1: Add mode/clock to the constructor**

```ts
export class Observer {
  private symbol: string;
  private queue1m: Queue<Candle>;
  private impulseTracker: ImpulseTracker;
  private lastCandle1s: Candle | null = null;
  private lastCandle1m: Candle | null = null;
  private mode: 'live' | 'emulation';

  constructor(symbol: string, options?: { mode?: 'live' | 'emulation'; clock?: () => number }) {
    this.symbol = symbol;
    this.queue1m = new Queue<Candle>(MA_PERIOD);
    this.impulseTracker = new ImpulseTracker(options?.clock);
    this.mode = options?.mode ?? 'live';
  }
```

- [ ] **Step 2: Branch `updateCandle1m` on mode**

Replace the current `updateCandle1m`:

```ts
  updateCandle1m(candle: Candle): void {
    this.lastCandle1m = candle;

    if (this.mode === 'emulation' && candle.isClosed) {
      const ma99 = this.calculateMA99();
      if (ma99 !== null) {
        this.impulseTracker.process(candle.high, ma99);
      }
    }

    // Only closed 1m candles feed the MA99 queue
    if (candle.isClosed) {
      this.queue1m.push(candle);
    }
  }
```

Note: the impulse is processed against the MA99 computed from candles *before* this one is pushed — same ordering the live 1s path already relies on (MA99 reflects prior closed candles only).

- [ ] **Step 3: Typecheck**

Run: `cd backend && npm run build`
Expected: exits 0, no errors.

- [ ] **Step 4: Ad-hoc verification — live mode default unchanged**

Run:
```bash
cd backend && npx ts-node --transpile-only -e "
import { Observer } from './src/observers/Observer';
const obs = new Observer('BTCUSDT');
const state = obs.getState();
console.log('default mode state has candle1s/candle1m fields:', 'candle1s' in state, 'candle1m' in state);
"
```
Expected: `true true`, no throw.

- [ ] **Step 5: Ad-hoc verification — emulation mode processes impulse from 1m high**

Run:
```bash
cd backend && npx ts-node --transpile-only -e "
import { Observer } from './src/observers/Observer';
import { Candle } from './src/types';

const obs = new Observer('BTCUSDT', { mode: 'emulation' });

// preload 99 candles at close=100 so MA99 = 100
const preload: Candle[] = [];
for (let i = 0; i < 99; i++) {
  preload.push({ symbol: 'BTCUSDT', timeframe: '1m', openTime: i * 60000, open: 100, high: 100, low: 100, close: 100, isClosed: true });
}
obs.preload(preload);
console.log('isReady:', obs.isReady(), 'ma99:', obs.calculateMA99());

// next candle: high 95 -> should set floor via impulse tracker (processed BEFORE push, against ma99=100)
obs.updateCandle1m({ symbol: 'BTCUSDT', timeframe: '1m', openTime: 99 * 60000, open: 100, high: 95, low: 95, close: 95, isClosed: true });
console.log(JSON.stringify(obs.getState().impulseTracking));
"
```
Expected: `isReady: true ma99: 100`, and the impulse snapshot shows `"floor":95` (the high of 95 was below the MA99 of 100, setting the floor).

- [ ] **Step 6: Commit**

```bash
git add backend/src/observers/Observer.ts
git commit -m "feat: add emulation mode to Observer (impulse from 1m high, live untouched)"
```

---

### Task 4: `mode`/`clock` passthrough in `ObserverManager`

**Files:**
- Modify: `backend/src/managers/ObserverManager.ts`

**Interfaces:**
- Consumes: `new Observer(symbol, options?)` (Task 3).
- Produces: `new ObserverManager(options?: { mode?: 'live' | 'emulation'; clock?: () => number })`. Default behavior unchanged; `createObserver`/`createObservers` pass `options` through to each `Observer`.

- [ ] **Step 1: Add constructor + pass options to `createObserver`**

```ts
export class ObserverManager extends EventEmitter {
  private observers: Map<string, Observer> = new Map();
  private options?: { mode?: 'live' | 'emulation'; clock?: () => number };

  constructor(options?: { mode?: 'live' | 'emulation'; clock?: () => number }) {
    super();
    this.options = options;
  }

  createObserver(symbol: string): void {
    if (!this.observers.has(symbol)) {
      this.observers.set(symbol, new Observer(symbol, this.options));
    }
  }
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npm run build`
Expected: exits 0, no errors.

- [ ] **Step 3: Ad-hoc verification**

Run:
```bash
cd backend && npx ts-node --transpile-only -e "
import { ObserverManager } from './src/managers/ObserverManager';
const live = new ObserverManager();
live.createObserver('BTCUSDT');
console.log('live symbols:', live.getSymbols());

const emu = new ObserverManager({ mode: 'emulation', clock: () => 999 });
emu.createObserver('ETHUSDT');
console.log('emu symbols:', emu.getSymbols());
"
```
Expected: `live symbols: [ 'BTCUSDT' ]` and `emu symbols: [ 'ETHUSDT' ]`, no throw.

- [ ] **Step 4: Commit**

```bash
git add backend/src/managers/ObserverManager.ts
git commit -m "feat: pass mode/clock options through ObserverManager to Observer"
```

---

### Task 5: Extract `evaluateTick()` into shared `tradingPipeline.ts`

**Files:**
- Create: `backend/src/managers/tradingPipeline.ts`
- Modify: `backend/src/managers/BotManager.ts:34-50`

**Interfaces:**
- Produces: `evaluateTick(symbol: string, price: number, state: ObserverState, topSymbolsManager: TopSymbolsManager, orderManager: OrderManager): void` — checks sell condition via `orderManager.onPriceTick`, then buy condition via `state.impulseTracking.readyToBuy` + Top25 membership + no active order.
- Consumes (Task 6+): the emulator calls this same function per closed 1m candle.

- [ ] **Step 1: Create `tradingPipeline.ts` with the extracted logic**

```ts
import { ObserverState } from '../types';
import { TopSymbolsManager } from './TopSymbolsManager';
import { OrderManager } from './OrderManager';

/**
 * Core buy/sell decision rule, shared between the live bot (driven by 1s
 * ticks) and the emulator (driven by closed 1m candles). Both callers pass
 * in whichever price they consider "current" for their timeframe.
 */
export function evaluateTick(
  symbol: string,
  price: number,
  state: ObserverState,
  topSymbolsManager: TopSymbolsManager,
  orderManager: OrderManager
): void {
  // Check sell condition first
  orderManager.onPriceTick(symbol, price);

  // Check buy condition: symbol must be readyToBuy and in top 25
  if (!orderManager.hasActiveOrder() && state.impulseTracking.readyToBuy) {
    const inTop25 = topSymbolsManager.getTop25Symbols().includes(symbol);
    if (inTop25) {
      orderManager.buy(symbol, price);
    }
  }
}
```

- [ ] **Step 2: Use it from `BotManager.ts`**

Replace lines 34-50 (the `'candle'` handler body) with:

```ts
    this.observerManager.on('candle', ({ symbol, timeframe, state }: { symbol: string; timeframe: string; state: ObserverState }) => {
      if (timeframe !== '1s') return;

      const price = state.candle1s?.close;
      if (price == null) return;

      evaluateTick(symbol, price, state, this.topSymbolsManager, this.orderManager);
    });
```

Add the import at the top of `BotManager.ts`:

```ts
import { evaluateTick } from './tradingPipeline';
```

- [ ] **Step 3: Typecheck**

Run: `cd backend && npm run build`
Expected: exits 0, no errors.

- [ ] **Step 4: Ad-hoc verification — behavior-preserving refactor**

Run:
```bash
cd backend && npx ts-node --transpile-only -e "
import { evaluateTick } from './src/managers/tradingPipeline';
import { TopSymbolsManager } from './src/managers/TopSymbolsManager';
import { OrderManager } from './src/managers/OrderManager';
import { ObserverState } from './src/types';

const top = new TopSymbolsManager();
top.registerHit('BTCUSDT', 5);
const om = new OrderManager();
om.setEnabled(true);

const state: ObserverState = {
  symbol: 'BTCUSDT',
  candle1s: { close: 100, timestamp: 0 },
  candle1m: null,
  ma99: 90,
  isReady: true,
  impulseTracking: { floor: 95, allowed: true, reached: false, counter: 5, ma99AtFloorSet: 90, allowedActivatedAt: Date.now(), currentElapsedTime: 0, timings: [], averageTime: null, readyToBuy: true },
};

evaluateTick('BTCUSDT', 100, state, top, om);
console.log('has active order after evaluateTick:', om.hasActiveOrder());
"
```
Expected: `has active order after evaluateTick: true` (readyToBuy + in Top25 + no active order → buy fires).

- [ ] **Step 5: Commit**

```bash
git add backend/src/managers/tradingPipeline.ts backend/src/managers/BotManager.ts
git commit -m "refactor: extract shared evaluateTick() decision rule from BotManager"
```

---

### Task 6: CSV candle source (streaming reader + k-way merge)

**Files:**
- Create: `backend/src/emulator/csvCandleSource.ts`

**Interfaces:**
- Produces: `async function* streamMergedCandles(historyDir: string, symbols: string[], limitPerSymbol?: number): AsyncGenerator<Candle>` — yields `Candle` objects (`timeframe: '1m'`, `isClosed: true`) merged in ascending `openTime` order across all given symbols, reading each symbol's `<SYMBOL>_1m.csv` via a line-buffered stream (never loads a full file into memory).
- Produces: `function listHistorySymbols(historyDir: string): string[]` — reads subdirectory names of `historyDir` as the symbol list (mirrors what `history/` actually contains, no dependency on `SymbolManager`/Binance).

- [ ] **Step 1: Write `csvCandleSource.ts`**

```ts
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { Candle } from '../types';

export function listHistorySymbols(historyDir: string): string[] {
  return fs
    .readdirSync(historyDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

interface SymbolCursor {
  symbol: string;
  iterator: AsyncIterator<Candle>;
  next: Candle | null;
}

async function* readSymbolCandles(historyDir: string, symbol: string, limit?: number): AsyncGenerator<Candle> {
  const filePath = path.join(historyDir, symbol, `${symbol}_1m.csv`);
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let isHeader = true;
  let count = 0;

  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    if (!line) continue;
    if (limit !== undefined && count >= limit) break;

    const [openTimeStr, openStr, highStr, lowStr, closeStr] = line.split(',');

    yield {
      symbol,
      timeframe: '1m',
      openTime: Number(openTimeStr),
      open: Number(openStr),
      high: Number(highStr),
      low: Number(lowStr),
      close: Number(closeStr),
      isClosed: true,
    };

    count++;
  }

  rl.close();
  fileStream.close();
}

/**
 * Merges each symbol's 1m candle stream into a single ascending-openTime
 * stream, without loading any file fully into memory. Uses a simple O(n)
 * linear scan per step over the (small, <=175) set of active cursors —
 * a heap is unnecessary at this fan-in size.
 */
export async function* streamMergedCandles(
  historyDir: string,
  symbols: string[],
  limitPerSymbol?: number
): AsyncGenerator<Candle> {
  const cursors: SymbolCursor[] = [];

  for (const symbol of symbols) {
    const iterator = readSymbolCandles(historyDir, symbol, limitPerSymbol)[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (!first.done) {
      cursors.push({ symbol, iterator, next: first.value });
    }
  }

  while (cursors.length > 0) {
    let minIndex = 0;
    for (let i = 1; i < cursors.length; i++) {
      if (cursors[i].next!.openTime < cursors[minIndex].next!.openTime) {
        minIndex = i;
      }
    }

    const cursor = cursors[minIndex];
    yield cursor.next!;

    const result = await cursor.iterator.next();
    if (result.done) {
      cursors.splice(minIndex, 1);
    } else {
      cursor.next = result.value;
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npm run build`
Expected: exits 0, no errors.

- [ ] **Step 3: Ad-hoc verification — merge ordering and symbol listing**

Run (uses real history data, 2 symbols, capped at 5 rows each so it's fast):
```bash
cd backend && npx ts-node --transpile-only -e "
import path from 'path';
import { listHistorySymbols, streamMergedCandles } from './src/emulator/csvCandleSource';

const historyDir = path.join(__dirname, '..', '..', 'history');
const symbols = listHistorySymbols(historyDir);
console.log('symbol count:', symbols.length);
console.log('includes BTCUSDT:', symbols.includes('BTCUSDT'));

(async () => {
  let prevTime = -Infinity;
  let ordered = true;
  let n = 0;
  for await (const candle of streamMergedCandles(historyDir, ['BTCUSDT', 'ETHUSDT'], 5)) {
    if (candle.openTime < prevTime) ordered = false;
    prevTime = candle.openTime;
    n++;
  }
  console.log('candles read:', n, 'ordered:', ordered);
})();
"
```
Expected: `symbol count: 175`, `includes BTCUSDT: true`, `candles read: 10 ordered: true`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/emulator/csvCandleSource.ts
git commit -m "feat: streaming CSV candle source with k-way merge across symbols"
```

---

### Task 7: `EmulatorEngine`

**Files:**
- Create: `backend/src/emulator/EmulatorEngine.ts`

**Interfaces:**
- Consumes: `streamMergedCandles`, `listHistorySymbols` (Task 6); `ObserverManager` with `mode`/`clock` options (Task 4); `OrderManager` with `clock` + `cancelActiveOrder()` (Task 2); `evaluateTick` (Task 5); `TopSymbolsManager` (existing, unchanged).
- Produces: `class EmulatorEngine` with `async run(options: { historyDir: string; symbols?: string[]; limitPerSymbol?: number }): Promise<EmulationResult>`, where:
  ```ts
  interface EmulationResult {
    initialBalance: number;
    finalBalance: number;
    orders: CompletedOrder[];
    discardedOrder: boolean; // true if a final active order was cancelled
  }
  ```

- [ ] **Step 1: Write `EmulatorEngine.ts`**

```ts
import { ObserverManager } from '../managers/ObserverManager';
import { OrderManager } from '../managers/OrderManager';
import { TopSymbolsManager } from '../managers/TopSymbolsManager';
import { evaluateTick } from '../managers/tradingPipeline';
import { CompletedOrder } from '../types';
import { listHistorySymbols, streamMergedCandles } from './csvCandleSource';

const INITIAL_BALANCE = 10_000;

export interface EmulationResult {
  initialBalance: number;
  finalBalance: number;
  orders: CompletedOrder[];
  discardedOrder: boolean;
}

export interface EmulatorRunOptions {
  historyDir: string;
  symbols?: string[];
  limitPerSymbol?: number;
}

export class EmulatorEngine {
  async run(options: EmulatorRunOptions): Promise<EmulationResult> {
    const symbols = options.symbols ?? listHistorySymbols(options.historyDir);

    const simClock = { time: 0 };
    const clock = () => simClock.time;

    const observerManager = new ObserverManager({ mode: 'emulation', clock });
    const orderManager = new OrderManager(clock);
    const topSymbolsManager = new TopSymbolsManager();

    orderManager.setEnabled(true);
    observerManager.createObservers(symbols);

    const orders: CompletedOrder[] = [];
    orderManager.on('sell', (completed: CompletedOrder) => orders.push(completed));

    observerManager.on('hit', ({ symbol, counter }: { symbol: string; counter: number }) => {
      topSymbolsManager.registerHit(symbol, counter);
    });

    let candleCount = 0;

    for await (const candle of streamMergedCandles(options.historyDir, symbols, options.limitPerSymbol)) {
      simClock.time = candle.openTime;

      observerManager.updateCandle(candle);
      const state = observerManager.getObserverState(candle.symbol);
      if (state) {
        evaluateTick(candle.symbol, candle.high, state, topSymbolsManager, orderManager);
      }

      candleCount++;
      if (candleCount % 1_000_000 === 0) {
        console.log(`[Emulator] Processed ${candleCount.toLocaleString()} candles...`);
      }
    }

    const discardedOrder = orderManager.hasActiveOrder();
    if (discardedOrder) {
      orderManager.cancelActiveOrder();
    }

    console.log(`[Emulator] Done — ${candleCount.toLocaleString()} candles, ${orders.length} orders, discarded final order: ${discardedOrder}`);

    return {
      initialBalance: INITIAL_BALANCE,
      finalBalance: orderManager.getBalance(),
      orders,
      discardedOrder,
    };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npm run build`
Expected: exits 0, no errors.

- [ ] **Step 3: Ad-hoc verification — small run produces a sane result shape**

Run:
```bash
cd backend && npx ts-node --transpile-only -e "
import path from 'path';
import { EmulatorEngine } from './src/emulator/EmulatorEngine';

(async () => {
  const engine = new EmulatorEngine();
  const result = await engine.run({
    historyDir: path.join(__dirname, '..', '..', 'history'),
    symbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'],
    limitPerSymbol: 5000,
  });
  console.log(JSON.stringify({ initialBalance: result.initialBalance, finalBalance: result.finalBalance, orderCount: result.orders.length, discardedOrder: result.discardedOrder }));
})();
"
```
Expected: exits without throwing, prints a JSON line with `initialBalance: 10000`, a numeric `finalBalance`, and `orderCount`/`discardedOrder` present (values depend on data, not asserted exactly here).

- [ ] **Step 4: Commit**

```bash
git add backend/src/emulator/EmulatorEngine.ts
git commit -m "feat: EmulatorEngine orchestrating simulated-clock replay over CSV history"
```

---

### Task 8: Markdown report writer

**Files:**
- Create: `backend/src/emulator/reportWriter.ts`

**Interfaces:**
- Consumes: `EmulationResult` (Task 7).
- Produces: `function formatReport(result: EmulationResult): string` — returns the full Markdown document as a string (header table + orders table + optional discarded-order note).

- [ ] **Step 1: Write `reportWriter.ts`**

```ts
import { EmulationResult } from './EmulatorEngine';

function formatDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

export function formatReport(result: EmulationResult): string {
  const { initialBalance, finalBalance, orders, discardedOrder } = result;

  const returnPct = ((finalBalance - initialBalance) / initialBalance) * 100;
  const wins = orders.filter(o => o.profit > 0).length;
  const losses = orders.length - wins;
  const winRate = orders.length > 0 ? (wins / orders.length) * 100 : 0;

  const lines: string[] = [];
  lines.push('# Reporte de emulación — 12 meses');
  lines.push('');
  lines.push('| Métrica | Valor |');
  lines.push('|---|---|');
  lines.push(`| Saldo inicial | ${initialBalance.toFixed(2)} USDT |`);
  lines.push(`| Saldo final | ${finalBalance.toFixed(2)} USDT |`);
  lines.push(`| Rendimiento | ${returnPct.toFixed(2)}% |`);
  lines.push(`| Win rate | ${winRate.toFixed(1)}% (${wins}W/${losses}L) |`);
  lines.push(`| Órdenes ejecutadas | ${orders.length} |`);
  lines.push('');
  lines.push('| Símbolo | Rendimiento % | Fecha inicio | Fecha fin |');
  lines.push('|---|---|---|---|');

  for (const order of orders) {
    lines.push(`| ${order.symbol} | ${order.profitPct.toFixed(3)}% | ${formatDate(order.openedAt)} | ${formatDate(order.closedAt)} |`);
  }

  if (discardedOrder) {
    lines.push('');
    lines.push('_Orden final inconclusa: descartada (saldo restaurado al valor previo a esa compra, no incluida en la tabla)._');
  }

  return lines.join('\n') + '\n';
}
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npm run build`
Expected: exits 0, no errors.

- [ ] **Step 3: Ad-hoc verification — report format matches spec**

Run:
```bash
cd backend && npx ts-node --transpile-only -e "
import { formatReport } from './src/emulator/reportWriter';

const report = formatReport({
  initialBalance: 10000,
  finalBalance: 13242.92,
  discardedOrder: true,
  orders: [
    { symbol: 'BTCUSDT', buyPrice: 100, sellPrice: 100.5, quantity: 1, usdtSpent: 100, usdtReceived: 100.4, profit: 0.4, profitPct: 0.4, openedAt: 1751328000000, closedAt: 1751328060000, durationMs: 60000 },
  ],
});
console.log(report);
"
```
Expected: prints a Markdown document with the header table showing `10000.00 USDT`, `13242.92 USDT`, `32.43%`, `100.0% (1W/0L)`, `1`, an orders table row for `BTCUSDT`, and the discarded-order note at the bottom.

- [ ] **Step 4: Commit**

```bash
git add backend/src/emulator/reportWriter.ts
git commit -m "feat: Markdown report writer for emulation results"
```

---

### Task 9: CLI entry point + `npm run emulate`

**Files:**
- Create: `backend/src/emulator/run.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `EmulatorEngine` (Task 7), `formatReport` (Task 8).
- Produces: `backend/src/emulator/run.ts` as a standalone script, invoked via `npm run emulate` from `backend/`. Flags: `--symbols=A,B`, `--limit=N`, `--out=path`.

- [ ] **Step 1: Write `run.ts`**

```ts
import fs from 'fs';
import path from 'path';
import { EmulatorEngine } from './EmulatorEngine';
import { formatReport } from './reportWriter';

function parseArgs(argv: string[]): { symbols?: string[]; limit?: number; out?: string } {
  const result: { symbols?: string[]; limit?: number; out?: string } = {};

  for (const arg of argv) {
    if (arg.startsWith('--symbols=')) {
      result.symbols = arg.slice('--symbols='.length).split(',').map(s => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--limit=')) {
      result.limit = Number(arg.slice('--limit='.length));
    } else if (arg.startsWith('--out=')) {
      result.out = arg.slice('--out='.length);
    }
  }

  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const repoRoot = path.join(__dirname, '..', '..', '..');
  const historyDir = path.join(repoRoot, 'history');

  const engine = new EmulatorEngine();
  const startedAt = Date.now();

  const result = await engine.run({
    historyDir,
    symbols: args.symbols,
    limitPerSymbol: args.limit,
  });

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[Emulator] Finished in ${elapsedSec}s`);

  const report = formatReport(result);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOut = path.join(repoRoot, 'results', `emulation-${timestamp}.md`);
  const outPath = args.out ? path.resolve(process.cwd(), args.out) : defaultOut;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, report, 'utf-8');

  console.log(`[Emulator] Report written to ${outPath}`);
}

main().catch(err => {
  console.error('[Emulator] Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add `ts-node` devDependency and `emulate` script to `backend/package.json`**

Edit `backend/package.json`:

```json
{
  "name": "spot-bot-backend",
  "version": "2.2.1",
  "main": "dist/index.js",
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "emulate": "ts-node --transpile-only src/emulator/run.ts"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "socket.io": "^4.8.3",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "@types/ws": "^8.5.10",
    "ts-node": "^10.9.2",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.3.3"
  }
}
```

- [ ] **Step 3: Install and typecheck**

Run:
```bash
cd backend && npm install && npm run build
```
Expected: `npm install` completes without errors (ts-node already present transitively, this just pins it as a direct devDependency); `npm run build` exits 0.

- [ ] **Step 4: Smoke test the CLI with a small subset**

Run:
```bash
cd backend && npm run emulate -- --symbols=BTCUSDT,ETHUSDT,BNBUSDT --limit=5000 --out=/tmp/emulation-smoke.md
cat /tmp/emulation-smoke.md
```
Expected: command exits 0, prints `[Emulator] Finished in ...s` and `[Emulator] Report written to /tmp/emulation-smoke.md`; the file contains the header table and an orders table (possibly empty if no trades triggered in that small window — that's fine, the goal here is confirming the CLI runs end-to-end).

- [ ] **Step 5: Commit**

```bash
git add backend/src/emulator/run.ts backend/package.json backend/package-lock.json
git commit -m "feat: emulator CLI entry point (npm run emulate)"
```

---

### Task 10: Full 12-month run and manual report review

**Files:** none (verification-only task, no code changes).

**Interfaces:** none.

- [ ] **Step 1: Estimate throughput on the full symbol set before committing to a full run**

Run:
```bash
cd backend && time npm run emulate -- --limit=20000 --out=/tmp/emulation-perf-check.md
```
Note the elapsed time; with 175 symbols × 20,000 candles = 3.5M candles, this gives a throughput estimate to extrapolate the full ~81M-candle run (per the spec's prior measurement, expect on the order of a few minutes total — if this step suggests something wildly slower, e.g. more than ~20 minutes projected, stop and investigate before running the full set).

- [ ] **Step 2: Run the full 12-month emulation**

Run:
```bash
cd backend && npm run emulate
```
Expected: completes (per the throughput estimate from Step 1), prints the final `[Emulator] Report written to <repo-root>/results/emulation-<timestamp>.md` path.

- [ ] **Step 3: Manually inspect the generated report**

Run: `cat <path printed in Step 2>`
Confirm:
- Header table has all 5 required fields (saldo inicial, saldo final, rendimiento, win rate, órdenes ejecutadas) with plausible values (saldo inicial = 10000.00 USDT).
- Orders table rows have non-empty symbol, a `%` value, and two ISO-ish dates per row, in chronological order by `Fecha inicio`.
- If a discarded-order note is present, confirm the order count in the header matches the number of rows in the table (the discarded order is correctly excluded from both).

No commit for this task — per the Global Constraints, `results/*.md` files are run artifacts and are not committed.

---

## Post-plan note

This plan does not commit any file under `results/`. If the user wants a specific emulation result preserved in git history, that's a separate, explicit decision — do not commit it automatically.
