# ZigZag Strategy Emulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild a CLI backtesting tool that replays `history/BTCUSDT/*.csv` through the real `Observer`/`ObserverManager`/`OrderManager` classes and produces a Markdown report, so ZigZag parameters (deviation %, min bars, price source, timeframe) can be compared before touching live trading.

**Architecture:** `Observer`/`ObserverManager`/`OrderManager` gain additive, optional constructor parameters (ZigZag config/timeframe; a simulated clock and an all-in order-sizing config) whose defaults exactly reproduce today's live behavior — the emulator is the only caller that ever passes non-default values. A new `backend/src/emulator/` module streams a symbol's CSV candle-by-candle through these real classes (feeding a synthetic 1s "current price" tick after each candle so `getCurrentPrice()` stays valid, mirroring `BotManager`'s live pivot-handling logic exactly), collects completed trades, and writes a Markdown report.

**Tech Stack:** TypeScript, Node.js `node:test`, synchronous buffered file I/O (`fs.readSync`), no new dependencies.

## Global Constraints

- Every new constructor parameter is optional with a default that reproduces current live behavior exactly — `new Observer(symbol)`, `new OrderManager()`, `ObserverManager.createObservers(symbols)` (no extra args) must all continue to work and behave identically to before this plan.
- ZigZag pivots are computed on closed candles only; no change to `nextZigZagState()` itself (already supports a `config` parameter from a prior sub-project — this plan does not touch `backend/src/utils/zigzag.ts`).
- Order sizing during emulation is **all-in / uncapped**: `OrderSizeConfig { factor: Number.MAX_SAFE_INTEGER, maxUsdt: Infinity }` plus a nonzero placeholder `quoteVolume24h` argument, routed through the existing unmodified `computeOrderSize()` formula so every buy uses exactly the current balance.
- The emulator feeds a synthetic 1s candle (`close` = the just-processed candle's `close`) after every real candle, so its `'pivot'` handler can call `observerManager.getCurrentPrice(symbol)` exactly like `BotManager` does live, executing at that price — never at the pivot's own (stale-by-construction) price.
- A single symbol per run (`EmulatorOptions.symbols: string[]`, today always length 1) — no cross-symbol time-merge is built now; the shape allows adding one later without restructuring.
- An order still open when the historical data runs out is excluded from `trades`/reported stats (its `usdtSpent` stays deducted from balance, not refunded) — counted separately as `discardedOpenOrders`.
- `results/` is already gitignored (verified: `.gitignore` line 8).

---

## File Structure

- Modify `backend/src/observers/Observer.ts` — constructor gains optional `zigzagConfig`/`zigzagTimeframe` parameters.
- Modify `backend/src/observers/Observer.test.ts` — add tests proving the new parameters are honored.
- Modify `backend/src/managers/ObserverManager.ts` — `createObserver`/`createObservers` gain matching optional parameters, threaded to `new Observer(...)`.
- Modify `backend/src/managers/ObserverManager.test.ts` — add a pass-through test.
- Modify `backend/src/managers/OrderManager.ts` — constructor gains optional `clock`/`orderSizeConfig` parameters.
- Modify `backend/src/managers/OrderManager.test.ts` — add tests proving both new parameters are honored.
- Create `backend/src/emulator/csvCandleSource.ts` — streaming CSV reader (one symbol's `_1m.csv`/`_1h.csv`).
- Create `backend/src/emulator/csvCandleSource.test.ts`.
- Create `backend/src/emulator/EmulatorEngine.ts` — orchestrates the replay using the real classes above.
- Create `backend/src/emulator/EmulatorEngine.test.ts`.
- Create `backend/src/emulator/reportWriter.ts` — formats an `EmulatorResult` as Markdown.
- Create `backend/src/emulator/reportWriter.test.ts`.
- Create `backend/src/emulator/run.ts` — CLI entry point.
- Modify `backend/package.json` — add the `emulate` script.

---

### Task 1: `Observer`/`ObserverManager` — optional ZigZag config/timeframe injection

**Files:**
- Modify: `backend/src/observers/Observer.ts` (full rewrite)
- Modify: `backend/src/observers/Observer.test.ts` (append tests)
- Modify: `backend/src/managers/ObserverManager.ts:1-30`
- Modify: `backend/src/managers/ObserverManager.test.ts` (append test)

**Interfaces:**
- Consumes: `ZigZagConfig`, `DEFAULT_ZIGZAG_CONFIG` from `backend/src/utils/zigzag.ts` (already exist, unchanged by this plan).
- Produces: `Observer(symbol: string, zigzagConfig: ZigZagConfig = DEFAULT_ZIGZAG_CONFIG, zigzagTimeframe: ChartTimeframe = '1m')`. `ObserverManager.createObserver(symbol: string, zigzagConfig?: ZigZagConfig, zigzagTimeframe?: ChartTimeframe): void` and `createObservers(symbols: string[], zigzagConfig?: ZigZagConfig, zigzagTimeframe?: ChartTimeframe): void`. No other method on either class changes signature. Consumed by Task 4 (`EmulatorEngine`).

Since every new parameter is optional with a default matching current behavior, this task does **not** break anything else — run the full backend suite at the end, same as any other task (no deferred-verification chain needed for this plan).

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/observers/Observer.test.ts`, after the last existing test (and add `DEFAULT_ZIGZAG_CONFIG` to the existing `import { Candle } from '../types';` line — change it to two import lines as shown):

Replace line 4 (`import { Candle } from '../types';`) with:

```ts
import { Candle } from '../types';
import { DEFAULT_ZIGZAG_CONFIG } from '../utils/zigzag';
```

Then append at the end of the file:

```ts

test('a custom zigzagConfig changes when a pivot confirms (proves config injection reaches nextZigZagState)', () => {
  const decline = Array.from({ length: 15 }, (_, k) => +(110 - 0.2 * (k + 1)).toFixed(2));
  const candles = [110, ...decline].map((close, i) => closedCandleAt(i, close));

  const withDefault = new Observer('BTCUSDT');
  withDefault.preloadClosed1m(candles);
  assert.equal(withDefault.getState().zigzag.lastPivot, null); // minBarsBetweenPivots=20 never reached in only 16 candles

  const withCustom = new Observer('BTCUSDT', { deviationPct: 1, minBarsBetweenPivots: 2, priceSource: 'close' });
  withCustom.preloadClosed1m(candles);
  assert.deepEqual(withCustom.getState().zigzag.lastPivot, { price: 110, type: 'max' });
});

test('a custom zigzagTimeframe of "1h" drives the zigzag detector from the 1h buffer instead of 1m', () => {
  const closes = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  const hourCandles = closes.map((close, i) => closedHourAt(i, close));

  const observer = new Observer('BTCUSDT', DEFAULT_ZIGZAG_CONFIG, '1h');
  observer.preloadClosed1h(hourCandles);

  const zigzag = observer.getState().zigzag;
  assert.equal(zigzag.direction, 'down');
  assert.deepEqual(zigzag.lastPivot, { price: 110, type: 'max' });
});

test('when zigzagTimeframe is "1h", feeding 1m candles does NOT advance the zigzag detector', () => {
  const closes = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  const minuteCandles = closes.map((close, i) => closedCandleAt(i, close));

  const observer = new Observer('BTCUSDT', DEFAULT_ZIGZAG_CONFIG, '1h');
  observer.preloadClosed1m(minuteCandles);

  const zigzag = observer.getState().zigzag;
  assert.equal(zigzag.direction, null);
  assert.equal(zigzag.lastPivot, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `node --test --require ts-node/register src/observers/Observer.test.ts`
Expected: FAIL — `Observer`'s constructor doesn't yet accept a second/third argument (TypeScript compile error).

- [ ] **Step 3: Rewrite `backend/src/observers/Observer.ts`**

Replace the entire file with:

```ts
import { Candle, ChartCandle, ChartTimeframe, ObserverState, PerformanceWindows, ZigZagState } from '../types';
import { Queue } from '../utils/Queue';
import { computePerformance } from '../utils/performance';
import { nextZigZagState, EMPTY_ZIGZAG_STATE, ZigZagConfig, DEFAULT_ZIGZAG_CONFIG } from '../utils/zigzag';

/** 200 closed candles per timeframe: enough for a 100-candle visible chart
 * window with a full 99-candle MA99 lookback at the first visible point,
 * plus margin. Also comfortably covers the 24h performance window (24
 * hourly candles) and the ZigZag detector's 20-bar minimum gap. */
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
  private performance: PerformanceWindows = computePerformance([]);
  private zigzag: ZigZagState = EMPTY_ZIGZAG_STATE;
  private zigzagConfig: ZigZagConfig;
  private zigzagTimeframe: ChartTimeframe;

  /** `zigzagConfig`/`zigzagTimeframe` default to today's production values --
   * only the emulator (a separate module) ever passes non-default values,
   * to test other parameter combinations against historical data without
   * changing live behavior. */
  constructor(
    symbol: string,
    zigzagConfig: ZigZagConfig = DEFAULT_ZIGZAG_CONFIG,
    zigzagTimeframe: ChartTimeframe = '1m'
  ) {
    this.symbol = symbol;
    this.zigzagConfig = zigzagConfig;
    this.zigzagTimeframe = zigzagTimeframe;
    this.closed1m = new Queue<Candle>(CHART_HISTORY_CANDLES);
    this.closed1h = new Queue<Candle>(CHART_HISTORY_CANDLES);
    this.quoteVol1m = new Queue<number>(QUOTE_VOLUME_WINDOW);
  }

  /** Pushes each candle into the 1m chart buffer. If `zigzagTimeframe` is
   * '1m', also replays nextZigZagState() candle-by-candle so a freshly
   * started observer reconstructs true pivot state instead of starting
   * cold -- same replay discipline the old step1/step2 system used. */
  preloadClosed1m(candles: Candle[]): void {
    candles.forEach(c => {
      this.closed1m.push(c);
      if (this.zigzagTimeframe === '1m') {
        this.zigzag = nextZigZagState(c, this.zigzag, this.zigzagConfig);
      }
    });
  }

  /** Same replay discipline as preloadClosed1m, for the 1h buffer -- only
   * advances the ZigZag detector if `zigzagTimeframe` is '1h'. Always
   * recomputes performance once at the end (performance has no stickiness
   * or history dependency beyond "what's the buffer right now", unlike
   * ZigZag, so it doesn't need a per-candle recompute during replay). */
  preloadClosed1h(candles: Candle[]): void {
    candles.forEach(c => {
      this.closed1h.push(c);
      if (this.zigzagTimeframe === '1h') {
        this.zigzag = nextZigZagState(c, this.zigzag, this.zigzagConfig);
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
      if (this.zigzagTimeframe === '1m') {
        this.zigzag = nextZigZagState(candle, this.zigzag, this.zigzagConfig);
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
      if (this.zigzagTimeframe === '1h') {
        this.zigzag = nextZigZagState(candle, this.zigzag, this.zigzagConfig);
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

- [ ] **Step 4: Run the Observer test file to verify it passes**

Run (from `backend/`): `node --test --require ts-node/register src/observers/Observer.test.ts`
Expected: PASS, all 23 tests (20 pre-existing + 3 new).

- [ ] **Step 5: Write the failing test for `ObserverManager`**

Append to `backend/src/managers/ObserverManager.test.ts`, after the last existing test. First, add this import near the top of the file (after the existing `import { Candle, ObserverState } from '../types';` line):

```ts
import { ZigZagConfig } from '../utils/zigzag';
```

Then append at the end of the file:

```ts

test('createObserver passes a custom zigzagConfig/zigzagTimeframe through to the underlying Observer', () => {
  const manager = new ObserverManager();
  const customConfig: ZigZagConfig = { deviationPct: 1, minBarsBetweenPivots: 2, priceSource: 'close' };
  manager.createObserver('BTCUSDT', customConfig, '1h');

  const decline = Array.from({ length: 15 }, (_, k) => +(110 - 0.2 * (k + 1)).toFixed(2));
  const closes = [110, ...decline];
  closes.forEach((close, i) => {
    manager.updateCandle({ symbol: 'BTCUSDT', timeframe: '1h', openTime: i, open: close, high: close, low: close, close, isClosed: true });
  });

  const state = manager.getObserverState('BTCUSDT')!;
  assert.deepEqual(state.zigzag.lastPivot, { price: 110, type: 'max' });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run (from `backend/`): `node --test --require ts-node/register src/managers/ObserverManager.test.ts`
Expected: FAIL — `createObserver` doesn't yet accept a second/third argument.

- [ ] **Step 7: Edit `backend/src/managers/ObserverManager.ts`**

Replace lines 1-30:

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
```

with:

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
import { ZigZagConfig } from '../utils/zigzag';

/** REST/initial chart snapshots and the sliding client-side window both use
 * the last 100 candles; the Observer buffer (200 candles) holds more so
 * MA99 has a full lookback at the first visible point. */
const CHART_VISIBLE_CANDLES = 100;

export class ObserverManager extends EventEmitter {
  private observers: Map<string, Observer> = new Map();

  /** `zigzagConfig`/`zigzagTimeframe` are forwarded to `new Observer(...)`
   * unchanged (both optional there too) -- only the emulator passes them. */
  createObserver(symbol: string, zigzagConfig?: ZigZagConfig, zigzagTimeframe?: ChartTimeframe): void {
    if (!this.observers.has(symbol)) {
      this.observers.set(symbol, new Observer(symbol, zigzagConfig, zigzagTimeframe));
    }
  }

  createObservers(symbols: string[], zigzagConfig?: ZigZagConfig, zigzagTimeframe?: ChartTimeframe): void {
    symbols.forEach(symbol => this.createObserver(symbol, zigzagConfig, zigzagTimeframe));
  }
```

- [ ] **Step 8: Run the tests and the full backend suite**

Run (from `backend/`): `node --test --require ts-node/register src/managers/ObserverManager.test.ts`
Expected: PASS, all 8 tests (7 pre-existing + 1 new).

Run (from `backend/`): `node --test --require ts-node/register 'src/**/*.test.ts'`
Expected: PASS, all tests.

Run (from `backend/`): `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add backend/src/observers/Observer.ts backend/src/observers/Observer.test.ts backend/src/managers/ObserverManager.ts backend/src/managers/ObserverManager.test.ts
git commit -m "feat: allow Observer/ObserverManager to accept an injectable ZigZag config and timeframe"
```

---

### Task 2: `OrderManager` — optional clock/order-sizing injection

**Files:**
- Modify: `backend/src/managers/OrderManager.ts` (full rewrite)
- Modify: `backend/src/managers/OrderManager.test.ts` (append tests)

**Interfaces:**
- Consumes: `OrderSizeConfig` from `backend/src/utils/orderSize.ts` (already exists).
- Produces: `OrderManager(clock: () => number = () => Date.now(), orderSizeConfig: OrderSizeConfig = { factor: 0.0001, maxUsdt: 10_000 })`. No other method signature changes. Consumed by Task 4 (`EmulatorEngine`).

Again, purely additive/backward-compatible — full backend suite stays green throughout.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/managers/OrderManager.test.ts`, after the last existing test:

```ts

test('an injected clock is used for openedAt/closedAt/durationMs instead of Date.now()', () => {
  let simTime = 1000;
  const manager = new OrderManager(() => simTime);

  const order = manager.buy('BTCUSDT', 100, HIGH_VOLUME);
  assert.equal(order!.openedAt, 1000);

  const completedPayloads: Array<{ order: { closedAt: number; durationMs: number } }> = [];
  manager.on('completed', (payload) => { completedPayloads.push(payload); });

  simTime = 5000;
  manager.sellAtPrice('BTCUSDT', 105);

  assert.equal(completedPayloads.length, 1);
  assert.equal(completedPayloads[0].order.closedAt, 5000);
  assert.equal(completedPayloads[0].order.durationMs, 4000);
});

test('an injected orderSizeConfig with maxUsdt=Infinity sizes at the full balance even above $10,000 (compounding)', () => {
  const manager = new OrderManager(() => Date.now(), { factor: Number.MAX_SAFE_INTEGER, maxUsdt: Infinity });

  // First trade: full $10,000 balance in, a profitable close grows balance well above $10,000.
  manager.buy('BTCUSDT', 100, 1);
  manager.sellAtPrice('BTCUSDT', 200);

  const grownBalance = manager.getStatus().balance;
  assert.equal(grownBalance, 19960.02); // (10000/100)*0.999 * 200 * 0.999
  assert.ok(grownBalance > 10_000, `expected balance to grow above 10,000, got ${grownBalance}`);

  const second = manager.buy('BTCUSDT', 100, 1);
  assert.equal(second!.usdtSpent, grownBalance); // uses the FULL grown balance, not capped at 10,000
});

test('the default constructor (no arguments) still behaves exactly as before', () => {
  const manager = new OrderManager();
  const before = Date.now();
  const order = manager.buy('BTCUSDT', 100, HIGH_VOLUME);
  const after = Date.now();

  assert.ok(order!.openedAt >= before && order!.openedAt <= after); // real wall-clock time
  assert.equal(order!.usdtSpent, 10_000); // still capped at the default $10,000
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `node --test --require ts-node/register src/managers/OrderManager.test.ts`
Expected: FAIL — `OrderManager`'s constructor doesn't yet accept any arguments (TypeScript compile error on the first two new tests).

- [ ] **Step 3: Rewrite `backend/src/managers/OrderManager.ts`**

Replace the entire file with:

```ts
import { EventEmitter } from 'events';
import { ActiveOrder, CompletedOrder, OrderStatus } from '../types';
import { computeOrderSize, OrderSizeConfig } from '../utils/orderSize';

const INITIAL_BALANCE = 10_000;
const FEE = 0.001; // 0.1% on buy (asset) and sell (usdt)
const DEFAULT_ORDER_SIZE_CONFIG: OrderSizeConfig = { factor: 0.0001, maxUsdt: 10_000 };

export class OrderManager extends EventEmitter {
  private balance: number = INITIAL_BALANCE;
  private activeOrders: Map<string, ActiveOrder> = new Map();
  private completedOrders: CompletedOrder[] = [];
  private clock: () => number;
  private orderSizeConfig: OrderSizeConfig;

  /** `clock`/`orderSizeConfig` default to today's production values (real
   * wall-clock time, $10,000-liquidity-capped sizing) -- only the emulator
   * (a separate module) ever passes non-default values, to get historical
   * timestamps and all-in compounding sizing during a backtest without
   * changing live behavior. */
  constructor(
    clock: () => number = () => Date.now(),
    orderSizeConfig: OrderSizeConfig = DEFAULT_ORDER_SIZE_CONFIG
  ) {
    super();
    this.clock = clock;
    this.orderSizeConfig = orderSizeConfig;
  }

  hasActiveOrder(symbol: string): boolean {
    return this.activeOrders.has(symbol);
  }

  computeOrderSize(quoteVolume24h: number): number {
    return computeOrderSize(this.balance, quoteVolume24h, this.orderSizeConfig);
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
      openedAt: this.clock(),
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
    const closedAt = this.clock();

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

- [ ] **Step 4: Run the tests and the full backend suite**

Run (from `backend/`): `node --test --require ts-node/register src/managers/OrderManager.test.ts`
Expected: PASS, all 13 tests (10 pre-existing + 3 new).

Run (from `backend/`): `node --test --require ts-node/register 'src/**/*.test.ts'`
Expected: PASS, all tests.

Run (from `backend/`): `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/managers/OrderManager.ts backend/src/managers/OrderManager.test.ts
git commit -m "feat: allow OrderManager to accept an injectable clock and order-sizing config"
```

---

### Task 3: `csvCandleSource` — streaming CSV reader

**Files:**
- Create: `backend/src/emulator/csvCandleSource.ts`
- Create: `backend/src/emulator/csvCandleSource.test.ts`

**Interfaces:**
- Consumes: `Candle`, `ChartTimeframe` from `backend/src/types/index.ts` (unchanged).
- Produces: `function* readSymbolCandles(historyDir: string, symbol: string, timeframe: ChartTimeframe, limit?: number): Generator<Candle>` exported from `backend/src/emulator/csvCandleSource.ts`. Consumed by Task 4 (`EmulatorEngine`).

- [ ] **Step 1: Write the failing tests**

Create `backend/src/emulator/csvCandleSource.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readSymbolCandles } from './csvCandleSource';

function writeFixture(historyDir: string, symbol: string, timeframe: string, rows: string[]): void {
  const dir = path.join(historyDir, symbol);
  fs.mkdirSync(dir, { recursive: true });
  const content = ['open_time,open,high,low,close,ma20,ma99,bb_up,bb_down,quote_volume', ...rows].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, `${symbol}_${timeframe}.csv`), content, 'utf-8');
}

function tempHistoryDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'csvCandleSource-test-'));
}

test('reads candles from a CSV, skipping the header', () => {
  const dir = tempHistoryDir();
  writeFixture(dir, 'BTCUSDT', '1m', [
    '1000,100,105,95,102,,,,,500',
    '1060,102,106,101,103,,,,,600',
  ]);

  const candles = Array.from(readSymbolCandles(dir, 'BTCUSDT', '1m'));
  assert.equal(candles.length, 2);
  assert.deepEqual(candles[0], { symbol: 'BTCUSDT', timeframe: '1m', openTime: 1000, open: 100, high: 105, low: 95, close: 102, isClosed: true });
  assert.deepEqual(candles[1], { symbol: 'BTCUSDT', timeframe: '1m', openTime: 1060, open: 102, high: 106, low: 101, close: 103, isClosed: true });
});

test('respects the limit parameter', () => {
  const dir = tempHistoryDir();
  writeFixture(dir, 'BTCUSDT', '1m', [
    '1000,100,105,95,102,,,,,500',
    '1060,102,106,101,103,,,,,600',
    '1120,103,107,102,104,,,,,700',
  ]);

  const candles = Array.from(readSymbolCandles(dir, 'BTCUSDT', '1m', 2));
  assert.equal(candles.length, 2);
});

test('skips a malformed row without throwing', () => {
  const dir = tempHistoryDir();
  writeFixture(dir, 'BTCUSDT', '1m', [
    '1000,100,105,95,102,,,,,500',
    'not,a,valid,row',
    '1120,103,107,102,104,,,,,700',
  ]);

  const candles = Array.from(readSymbolCandles(dir, 'BTCUSDT', '1m'));
  assert.equal(candles.length, 2);
  assert.equal(candles[0].openTime, 1000);
  assert.equal(candles[1].openTime, 1120);
});

test('reads across chunk boundaries correctly (large file spanning multiple 1MB reads)', () => {
  const dir = tempHistoryDir();
  const rows = Array.from({ length: 50_000 }, (_, i) => `${1000 + i * 60},100,105,95,102,,,,,500`);
  writeFixture(dir, 'BTCUSDT', '1m', rows);

  const candles = Array.from(readSymbolCandles(dir, 'BTCUSDT', '1m'));
  assert.equal(candles.length, 50_000);
  assert.equal(candles[0].openTime, 1000);
  assert.equal(candles[49_999].openTime, 1000 + 49_999 * 60);
});

test('reads the final line even without a trailing newline', () => {
  const dir = tempHistoryDir();
  const symbolDir = path.join(dir, 'BTCUSDT');
  fs.mkdirSync(symbolDir, { recursive: true });
  fs.writeFileSync(
    path.join(symbolDir, 'BTCUSDT_1m.csv'),
    'open_time,open,high,low,close,ma20,ma99,bb_up,bb_down,quote_volume\n1000,100,105,95,102,,,,,500',
    'utf-8'
  ); // no trailing newline

  const candles = Array.from(readSymbolCandles(dir, 'BTCUSDT', '1m'));
  assert.equal(candles.length, 1);
  assert.equal(candles[0].openTime, 1000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `node --test --require ts-node/register src/emulator/csvCandleSource.test.ts`
Expected: FAIL — cannot find module `./csvCandleSource`.

- [ ] **Step 3: Create `backend/src/emulator/csvCandleSource.ts`**

```ts
import fs from 'fs';
import path from 'path';
import { Candle, ChartTimeframe } from '../types';

const READ_CHUNK_BYTES = 1 << 20; // 1MB

function parseCandleLine(symbol: string, timeframe: ChartTimeframe, line: string): Candle | null {
  const [openTimeStr, openStr, highStr, lowStr, closeStr] = line.split(',');
  const openTime = Number(openTimeStr);
  const open = Number(openStr);
  const high = Number(highStr);
  const low = Number(lowStr);
  const close = Number(closeStr);

  if (Number.isNaN(openTime) || Number.isNaN(open) || Number.isNaN(high) || Number.isNaN(low) || Number.isNaN(close)) {
    console.warn(`[csvCandleSource] Skipping malformed row for ${symbol}: ${line}`);
    return null;
  }

  return { symbol, timeframe, openTime, open, high, low, close, isClosed: true };
}

/**
 * Reads a symbol's CSV via synchronous, fixed-size buffered reads -- never
 * loads the full file into memory. Expects the same column layout as
 * history/<SYMBOL>/<SYMBOL>_<timeframe>.csv: a header row followed by
 * `open_time,open,high,low,close,...` (any trailing columns, e.g.
 * quote_volume, are ignored -- the emulator uses all-in order sizing, not
 * liquidity-based sizing, so quote volume isn't needed).
 */
export function* readSymbolCandles(
  historyDir: string,
  symbol: string,
  timeframe: ChartTimeframe,
  limit?: number
): Generator<Candle> {
  const filePath = path.join(historyDir, symbol, `${symbol}_${timeframe}.csv`);
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(READ_CHUNK_BYTES);
  let leftover = '';
  let isHeader = true;
  let count = 0;

  try {
    let bytesRead: number;
    while ((bytesRead = fs.readSync(fd, buffer, 0, READ_CHUNK_BYTES, null)) > 0) {
      const chunk = leftover + buffer.toString('utf-8', 0, bytesRead);
      const lines = chunk.split('\n');
      leftover = lines.pop() ?? '';

      for (const line of lines) {
        if (isHeader) {
          isHeader = false;
          continue;
        }
        if (!line) continue;
        if (limit !== undefined && count >= limit) return;

        const candle = parseCandleLine(symbol, timeframe, line);
        if (candle === null) continue;

        yield candle;
        count++;
      }
    }

    if (leftover && !isHeader && !(limit !== undefined && count >= limit)) {
      const candle = parseCandleLine(symbol, timeframe, leftover);
      if (candle !== null) yield candle;
    }
  } finally {
    fs.closeSync(fd);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `backend/`): `node --test --require ts-node/register src/emulator/csvCandleSource.test.ts`
Expected: PASS, 5/5 tests.

- [ ] **Step 5: Run the full backend suite and type check**

Run (from `backend/`): `node --test --require ts-node/register 'src/**/*.test.ts'`
Expected: PASS, all tests.

Run (from `backend/`): `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/emulator/csvCandleSource.ts backend/src/emulator/csvCandleSource.test.ts
git commit -m "feat: add streaming CSV candle reader for the emulator"
```

---

### Task 4: `EmulatorEngine` — replay orchestration

**Files:**
- Create: `backend/src/emulator/EmulatorEngine.ts`
- Create: `backend/src/emulator/EmulatorEngine.test.ts`

**Interfaces:**
- Consumes: `ObserverManager` (Task 1), `OrderManager` (Task 2), `readSymbolCandles` (Task 3), `ZigZagConfig` from `backend/src/utils/zigzag.ts`, `OrderSizeConfig` from `backend/src/utils/orderSize.ts`, `ChartTimeframe`/`CompletedOrder`/`PivotEvent` from `backend/src/types/index.ts`.
- Produces (all exported from `backend/src/emulator/EmulatorEngine.ts`):
  ```ts
  export interface EmulatorOptions {
    historyDir: string;
    symbols: string[];
    timeframe: ChartTimeframe;
    zigzagConfig: ZigZagConfig;
    limitPerSymbol?: number;
  }
  export interface EmulatorTrade {
    symbol: string;
    buyPrice: number;
    buyTime: number;
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
    discardedOpenOrders: number;
    maxDrawdownPct: number;
  }
  export class EmulatorEngine {
    run(options: EmulatorOptions): EmulatorResult;
  }
  ```
  Consumed by Tasks 5 (`reportWriter`) and 6 (`run.ts`).

- [ ] **Step 1: Write the failing tests**

Create `backend/src/emulator/EmulatorEngine.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EmulatorEngine } from './EmulatorEngine';
import { DEFAULT_ZIGZAG_CONFIG } from '../utils/zigzag';

function writeFixture(historyDir: string, symbol: string, timeframe: string, closes: number[]): void {
  const dir = path.join(historyDir, symbol);
  fs.mkdirSync(dir, { recursive: true });
  const rows = closes.map((close, i) => `${i * 60000},${close},${close},${close},${close},,,,,100`);
  const content = ['open_time,open,high,low,close,ma20,ma99,bb_up,bb_down,quote_volume', ...rows].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, `${symbol}_${timeframe}.csv`), content, 'utf-8');
}

function tempHistoryDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'EmulatorEngine-test-'));
}

/** 81-candle sequence, independently verified against the real ZigZag
 * algorithm (backend/src/utils/zigzag.ts) via a throwaway script before
 * writing this test: confirms MAX(110) at index 20 (no active order yet,
 * sellAtPrice no-ops), MIN(107) at index 51 (triggers a BUY at that
 * candle's own close, 109.1 -- NOT the stale pivot price 107), MAX(109.5)
 * at index 76 (triggers a SELL at that candle's own close, 107.4 -- NOT
 * the stale pivot price 109.5), completing exactly one round-trip trade. */
function buildCloses(): number[] {
  const seq1 = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  const continued = Array.from({ length: 5 }, (_, k) => +(107.5 - 0.1 * (k + 1)).toFixed(2));
  const rise = Array.from({ length: 25 }, (_, k) => +(107.0 + 0.1 * (k + 1)).toFixed(2));
  const declineB = Array.from({ length: 25 }, (_, k) => +(109.5 - 0.1 * (k + 1)).toFixed(2));
  return [...seq1, ...continued, ...rise, ...declineB];
}

test('runs a full sequence, executing at current price (not the stale pivot price), completing one round trip', () => {
  const dir = tempHistoryDir();
  const closes = buildCloses();
  writeFixture(dir, 'BTCUSDT', '1m', closes);

  const engine = new EmulatorEngine();
  const result = engine.run({
    historyDir: dir,
    symbols: ['BTCUSDT'],
    timeframe: '1m',
    zigzagConfig: DEFAULT_ZIGZAG_CONFIG,
  });

  assert.equal(result.candlesProcessed, 81);
  assert.equal(result.firstCandleTime, 0);
  assert.equal(result.lastCandleTime, 80 * 60000);
  assert.equal(result.initialBalance, 10_000);
  assert.equal(result.discardedOpenOrders, 0);
  assert.equal(result.trades.length, 1);

  const trade = result.trades[0];
  assert.equal(trade.symbol, 'BTCUSDT');
  assert.equal(trade.buyPrice, 109.1); // current price at the MIN pivot's candle, not the pivot's own 107
  assert.equal(trade.sellPrice, 107.4); // current price at the MAX pivot's candle, not the pivot's own 109.5
  assert.equal(trade.buyTime, 51 * 60000);
  assert.equal(trade.sellTime, 76 * 60000);
  assert.equal(trade.durationMs, 25 * 60000);
  assert.ok(trade.profitPct < 0, `expected a loss (price dropped from buy to sell), got ${trade.profitPct}`);

  assert.ok(result.finalBalance < result.initialBalance);
  assert.ok(result.maxDrawdownPct > 0);
});

test('an order still open at the end of the data is discarded, not counted as a trade', () => {
  const dir = tempHistoryDir();
  const closes = buildCloses().slice(0, 60); // stops well after the BUY (idx51) but before the SELL (idx76)
  writeFixture(dir, 'BTCUSDT', '1m', closes);

  const engine = new EmulatorEngine();
  const result = engine.run({
    historyDir: dir,
    symbols: ['BTCUSDT'],
    timeframe: '1m',
    zigzagConfig: DEFAULT_ZIGZAG_CONFIG,
  });

  assert.equal(result.candlesProcessed, 60);
  assert.equal(result.trades.length, 0);
  assert.equal(result.discardedOpenOrders, 1);
  assert.ok(result.finalBalance < result.initialBalance); // balance deducted by the open buy, not refunded
});

test('a custom zigzagConfig changes ZigZag behavior (proves the option reaches Observer)', () => {
  const dir = tempHistoryDir();
  const decline = Array.from({ length: 15 }, (_, k) => +(110 - 0.2 * (k + 1)).toFixed(2));
  const rise = Array.from({ length: 15 }, (_, k) => +(107 + 0.2 * (k + 1)).toFixed(2));
  const closes = [110, ...decline, ...rise]; // 31 candles
  writeFixture(dir, 'BTCUSDT', '1m', closes);

  const engine = new EmulatorEngine();

  const withDefault = engine.run({
    historyDir: dir, symbols: ['BTCUSDT'], timeframe: '1m', zigzagConfig: DEFAULT_ZIGZAG_CONFIG,
  });
  // Default minBarsBetweenPivots=20: only the first MAX confirms (idx20)
  // within these 31 candles -- nothing to sell yet, so no position ever opens.
  assert.equal(withDefault.trades.length, 0);
  assert.equal(withDefault.discardedOpenOrders, 0);

  const withCustom = engine.run({
    historyDir: dir, symbols: ['BTCUSDT'], timeframe: '1m',
    zigzagConfig: { deviationPct: 1, minBarsBetweenPivots: 2, priceSource: 'close' },
  });
  // With a much smaller bar-gap requirement, BOTH a MAX (idx6) and a
  // subsequent MIN (idx21, opening a position) confirm within the same 31
  // candles -- the position never gets a chance to close, so it's discarded.
  assert.equal(withCustom.trades.length, 0);
  assert.equal(withCustom.discardedOpenOrders, 1);
});

test('respects limitPerSymbol', () => {
  const dir = tempHistoryDir();
  writeFixture(dir, 'BTCUSDT', '1m', buildCloses());

  const engine = new EmulatorEngine();
  const result = engine.run({
    historyDir: dir,
    symbols: ['BTCUSDT'],
    timeframe: '1m',
    zigzagConfig: DEFAULT_ZIGZAG_CONFIG,
    limitPerSymbol: 10,
  });

  assert.equal(result.candlesProcessed, 10);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `node --test --require ts-node/register src/emulator/EmulatorEngine.test.ts`
Expected: FAIL — cannot find module `./EmulatorEngine`.

- [ ] **Step 3: Create `backend/src/emulator/EmulatorEngine.ts`**

```ts
import { ObserverManager } from '../managers/ObserverManager';
import { OrderManager } from '../managers/OrderManager';
import { ChartTimeframe, CompletedOrder, PivotEvent } from '../types';
import { ZigZagConfig } from '../utils/zigzag';
import { OrderSizeConfig } from '../utils/orderSize';
import { readSymbolCandles } from './csvCandleSource';

export interface EmulatorOptions {
  historyDir: string;
  symbols: string[];
  timeframe: ChartTimeframe;
  zigzagConfig: ZigZagConfig;
  limitPerSymbol?: number;
}

export interface EmulatorTrade {
  symbol: string;
  buyPrice: number;
  buyTime: number;
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
  discardedOpenOrders: number;
  maxDrawdownPct: number;
}

/** No liquidity data is fed during emulation (see design spec) -- this
 * config makes computeOrderSize() always resolve to the full balance
 * (min(balance, huge, Infinity) === balance), i.e. true all-in compounding
 * sizing, through the existing unmodified formula. */
const ALL_IN_ORDER_SIZE_CONFIG: OrderSizeConfig = { factor: Number.MAX_SAFE_INTEGER, maxUsdt: Infinity };
const ALL_IN_QUOTE_VOLUME = 1; // nonzero placeholder; see ALL_IN_ORDER_SIZE_CONFIG

export class EmulatorEngine {
  run(options: EmulatorOptions): EmulatorResult {
    const simClock = { time: 0 };
    const clock = () => simClock.time;

    const observerManager = new ObserverManager();
    const orderManager = new OrderManager(clock, ALL_IN_ORDER_SIZE_CONFIG);
    observerManager.createObservers(options.symbols, options.zigzagConfig, options.timeframe);

    const initialBalance = orderManager.getStatus().balance;
    let peakBalance = initialBalance;
    let maxDrawdownPct = 0;
    const trades: EmulatorTrade[] = [];

    observerManager.on('pivot', (pivot: PivotEvent) => {
      const currentPrice = observerManager.getCurrentPrice(pivot.symbol);
      if (currentPrice === null) return;

      if (pivot.type === 'min') {
        orderManager.buy(pivot.symbol, currentPrice, ALL_IN_QUOTE_VOLUME);
      } else {
        orderManager.sellAtPrice(pivot.symbol, currentPrice);
      }
    });

    orderManager.on('completed', ({ order }: { order: CompletedOrder }) => {
      trades.push({
        symbol: order.symbol,
        buyPrice: order.buyPrice,
        buyTime: order.openedAt,
        sellPrice: order.sellPrice,
        sellTime: order.closedAt,
        profitPct: order.profitPct,
        durationMs: order.durationMs,
      });

      const balance = orderManager.getStatus().balance;
      if (balance > peakBalance) peakBalance = balance;
      const drawdownPct = peakBalance > 0 ? ((peakBalance - balance) / peakBalance) * 100 : 0;
      if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;
    });

    let candlesProcessed = 0;
    let firstCandleTime: number | null = null;
    let lastCandleTime: number | null = null;

    for (const symbol of options.symbols) {
      for (const candle of readSymbolCandles(options.historyDir, symbol, options.timeframe, options.limitPerSymbol)) {
        simClock.time = candle.openTime;
        if (firstCandleTime === null) firstCandleTime = candle.openTime;
        lastCandleTime = candle.openTime;

        // Synthetic 1s tick BEFORE the real candle update, so
        // getCurrentPrice() already reflects this candle's own close by the
        // time the 'pivot' handler (fired synchronously from the
        // updateCandle() call below, if this candle confirms a pivot) runs
        // -- otherwise it would still see the PREVIOUS candle's close. The
        // CSV has no real tick data, so "current price" is approximated as
        // this candle's own close. See design spec.
        observerManager.updateCandle({
          symbol: candle.symbol,
          timeframe: '1s',
          openTime: candle.openTime,
          open: candle.close,
          high: candle.close,
          low: candle.close,
          close: candle.close,
          isClosed: true,
        });

        observerManager.updateCandle(candle);

        candlesProcessed++;
      }
    }

    const discardedOpenOrders = orderManager.getStatus().activeOrders.length;

    return {
      options,
      candlesProcessed,
      firstCandleTime,
      lastCandleTime,
      initialBalance,
      finalBalance: orderManager.getStatus().balance,
      trades,
      discardedOpenOrders,
      maxDrawdownPct,
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `backend/`): `node --test --require ts-node/register src/emulator/EmulatorEngine.test.ts`
Expected: PASS, 4/4 tests.

- [ ] **Step 5: Run the full backend suite and type check**

Run (from `backend/`): `node --test --require ts-node/register 'src/**/*.test.ts'`
Expected: PASS, all tests.

Run (from `backend/`): `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/emulator/EmulatorEngine.ts backend/src/emulator/EmulatorEngine.test.ts
git commit -m "feat: add EmulatorEngine orchestrating a replay through the real Observer/OrderManager classes"
```

---

### Task 5: `reportWriter` — Markdown report formatting

**Files:**
- Create: `backend/src/emulator/reportWriter.ts`
- Create: `backend/src/emulator/reportWriter.test.ts`

**Interfaces:**
- Consumes: `EmulatorResult`, `EmulatorTrade` from `backend/src/emulator/EmulatorEngine.ts` (Task 4).
- Produces: `function formatReport(result: EmulatorResult): string` exported from `backend/src/emulator/reportWriter.ts`. Consumed by Task 6 (`run.ts`).

- [ ] **Step 1: Write the failing tests**

Create `backend/src/emulator/reportWriter.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReport } from './reportWriter';
import { EmulatorResult } from './EmulatorEngine';
import { DEFAULT_ZIGZAG_CONFIG } from '../utils/zigzag';

function baseResult(overrides: Partial<EmulatorResult> = {}): EmulatorResult {
  return {
    options: { historyDir: 'history', symbols: ['BTCUSDT'], timeframe: '1m', zigzagConfig: DEFAULT_ZIGZAG_CONFIG },
    candlesProcessed: 100,
    firstCandleTime: 0,
    lastCandleTime: 6_000_000,
    initialBalance: 10_000,
    finalBalance: 10_000,
    trades: [],
    discardedOpenOrders: 0,
    maxDrawdownPct: 0,
    ...overrides,
  };
}

test('includes the configuration section with exact zigzag parameters', () => {
  const report = formatReport(baseResult());
  assert.ok(report.includes('Timeframe: 1m'));
  assert.ok(report.includes('Deviation: 1%'));
  assert.ok(report.includes('Min bars between pivots: 20'));
  assert.ok(report.includes('Price source: close'));
  assert.ok(report.includes('Candles processed: 100'));
});

test('reports zero trades with a placeholder instead of an empty table', () => {
  const report = formatReport(baseResult());
  assert.ok(report.includes('Completed trades: 0'));
  assert.ok(report.includes('_No completed trades._'));
});

test('computes win rate, average profit, and total return from the trades array', () => {
  const report = formatReport(baseResult({
    finalBalance: 11_000,
    trades: [
      { symbol: 'BTCUSDT', buyPrice: 100, buyTime: 0, sellPrice: 105, sellTime: 60_000, profitPct: 4.9, durationMs: 60_000 },
      { symbol: 'BTCUSDT', buyPrice: 100, buyTime: 120_000, sellPrice: 95, sellTime: 180_000, profitPct: -5.1, durationMs: 60_000 },
    ],
  }));

  assert.ok(report.includes('Completed trades: 2'));
  assert.ok(report.includes('Win rate: 50.0% (1 wins / 1 losses)'));
  assert.ok(report.includes('Total return: +10.00%'));
});

test('renders one table row per trade with formatted price/time/duration', () => {
  const report = formatReport(baseResult({
    trades: [
      { symbol: 'BTCUSDT', buyPrice: 61234.5, buyTime: 0, sellPrice: 62000, sellTime: 3_600_000, profitPct: 1.25, durationMs: 3_600_000 },
    ],
  }));

  assert.ok(report.includes('61234.500000'));
  assert.ok(report.includes('62000.000000'));
  assert.ok(report.includes('+1.25%'));
  assert.ok(report.includes('1h'));
});

test('shows the discarded-open-orders count', () => {
  const report = formatReport(baseResult({ discardedOpenOrders: 1 }));
  assert.ok(report.includes('Discarded (still open at end of data): 1'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `node --test --require ts-node/register src/emulator/reportWriter.test.ts`
Expected: FAIL — cannot find module `./reportWriter`.

- [ ] **Step 3: Create `backend/src/emulator/reportWriter.ts`**

```ts
import { EmulatorResult } from './EmulatorEngine';

function fmtPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function fmtPrice(value: number): string {
  return value.toFixed(6);
}

function fmtDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (h === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

function fmtTime(ms: number): string {
  return new Date(ms).toISOString();
}

/** Formats an EmulatorResult as a Markdown report -- see
 * docs/superpowers/specs/2026-07-19-zigzag-emulator-design.md for the
 * canonical example output. */
export function formatReport(result: EmulatorResult): string {
  const { options, trades } = result;
  const wins = trades.filter(t => t.profitPct > 0).length;
  const losses = trades.filter(t => t.profitPct <= 0).length;
  const winRatePct = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const avgProfitPct = trades.length > 0 ? trades.reduce((sum, t) => sum + t.profitPct, 0) / trades.length : 0;
  const avgDurationMs = trades.length > 0 ? trades.reduce((sum, t) => sum + t.durationMs, 0) / trades.length : 0;
  const totalReturnPct = ((result.finalBalance - result.initialBalance) / result.initialBalance) * 100;

  const lines: string[] = [];
  lines.push(`# Emulation Report — ${options.symbols.join(', ')}`);
  lines.push('');
  lines.push('## Configuration');
  lines.push(`- Timeframe: ${options.timeframe}`);
  lines.push(`- Deviation: ${options.zigzagConfig.deviationPct}%`);
  lines.push(`- Min bars between pivots: ${options.zigzagConfig.minBarsBetweenPivots}`);
  lines.push(`- Price source: ${options.zigzagConfig.priceSource}`);
  lines.push(`- Candles processed: ${result.candlesProcessed.toLocaleString()}`);
  lines.push(`- Period: ${result.firstCandleTime !== null ? fmtTime(result.firstCandleTime) : '—'} — ${result.lastCandleTime !== null ? fmtTime(result.lastCandleTime) : '—'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Initial balance: ${fmtPrice(result.initialBalance)} USDT`);
  lines.push(`- Final balance: ${fmtPrice(result.finalBalance)} USDT`);
  lines.push(`- Total return: ${fmtPct(totalReturnPct)}`);
  lines.push(`- Completed trades: ${trades.length}`);
  lines.push(`- Win rate: ${winRatePct.toFixed(1)}% (${wins} wins / ${losses} losses)`);
  lines.push(`- Average profit per trade: ${trades.length > 0 ? fmtPct(avgProfitPct) : '—'}`);
  lines.push(`- Average trade duration: ${trades.length > 0 ? fmtDuration(avgDurationMs) : '—'}`);
  lines.push(`- Max drawdown: -${result.maxDrawdownPct.toFixed(2)}%`);
  lines.push(`- Discarded (still open at end of data): ${result.discardedOpenOrders}`);
  lines.push('');
  lines.push('## Trades');
  lines.push('');

  if (trades.length === 0) {
    lines.push('_No completed trades._');
  } else {
    lines.push('| # | Buy Time | Buy Price | Sell Time | Sell Price | Profit % | Duration |');
    lines.push('|---|----------|-----------|-----------|------------|----------|----------|');
    trades.forEach((t, i) => {
      lines.push(`| ${i + 1} | ${fmtTime(t.buyTime)} | ${fmtPrice(t.buyPrice)} | ${fmtTime(t.sellTime)} | ${fmtPrice(t.sellPrice)} | ${fmtPct(t.profitPct)} | ${fmtDuration(t.durationMs)} |`);
    });
  }

  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `backend/`): `node --test --require ts-node/register src/emulator/reportWriter.test.ts`
Expected: PASS, 5/5 tests.

- [ ] **Step 5: Run the full backend suite and type check**

Run (from `backend/`): `node --test --require ts-node/register 'src/**/*.test.ts'`
Expected: PASS, all tests.

Run (from `backend/`): `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/emulator/reportWriter.ts backend/src/emulator/reportWriter.test.ts
git commit -m "feat: add Markdown report writer for emulation results"
```

---

### Task 6: `run.ts` CLI entry point

**Files:**
- Create: `backend/src/emulator/run.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `EmulatorEngine` (Task 4), `formatReport` (Task 5), `DEFAULT_ZIGZAG_CONFIG`/`ZigZagConfig` from `backend/src/utils/zigzag.ts`, `ChartTimeframe` from `backend/src/types/index.ts`.
- Produces: no exports (this is a script, run via `node`/`ts-node`, not imported elsewhere).

This file has no dedicated test (it's a thin CLI wrapper over already-tested `EmulatorEngine`/`formatReport`; correctness is verified by the live smoke-test run in Task 7) — matches this project's established convention of not unit-testing CLI/process-entry files (`BotManager.ts`/`index.ts` have none either).

- [ ] **Step 1: Create `backend/src/emulator/run.ts`**

```ts
// Usage: npm run emulate -- [--symbol=BTCUSDT] [--timeframe=1m] [--deviation=1] [--minBars=20] [--priceSource=close] [--limit=100000] [--out=path/to/report.md]
//   --symbol=       symbol to emulate, must have history/<SYMBOL>/<SYMBOL>_<timeframe>.csv (default: BTCUSDT)
//   --timeframe=    '1m' or '1h' -- which CSV to read and which buffer drives the ZigZag detector (default: 1m)
//   --deviation=    ZigZag deviationPct (default: 1)
//   --minBars=      ZigZag minBarsBetweenPivots (default: 20)
//   --priceSource=  'close' or 'highLow' (default: close)
//   --limit=        max candles to process, for quick smoke runs (default: all available)
//   --out=          output path for the generated report (default: results/emulation-<timestamp>.md)
import fs from 'fs';
import path from 'path';
import { EmulatorEngine } from './EmulatorEngine';
import { formatReport } from './reportWriter';
import { ChartTimeframe } from '../types';
import { ZigZagConfig, DEFAULT_ZIGZAG_CONFIG } from '../utils/zigzag';

interface CliArgs {
  symbol: string;
  timeframe: ChartTimeframe;
  zigzagConfig: ZigZagConfig;
  limit?: number;
  out?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = {
    symbol: 'BTCUSDT',
    timeframe: '1m',
    zigzagConfig: { ...DEFAULT_ZIGZAG_CONFIG },
  };

  for (const arg of argv) {
    if (arg.startsWith('--symbol=')) {
      result.symbol = arg.slice('--symbol='.length).trim().toUpperCase();
    } else if (arg.startsWith('--timeframe=')) {
      const value = arg.slice('--timeframe='.length).trim();
      if (value !== '1m' && value !== '1h') {
        throw new Error(`--timeframe must be '1m' or '1h', got '${value}'`);
      }
      result.timeframe = value;
    } else if (arg.startsWith('--deviation=')) {
      result.zigzagConfig.deviationPct = Number(arg.slice('--deviation='.length));
    } else if (arg.startsWith('--minBars=')) {
      result.zigzagConfig.minBarsBetweenPivots = Number(arg.slice('--minBars='.length));
    } else if (arg.startsWith('--priceSource=')) {
      const value = arg.slice('--priceSource='.length).trim();
      if (value !== 'close' && value !== 'highLow') {
        throw new Error(`--priceSource must be 'close' or 'highLow', got '${value}'`);
      }
      result.zigzagConfig.priceSource = value;
    } else if (arg.startsWith('--limit=')) {
      result.limit = Number(arg.slice('--limit='.length));
    } else if (arg.startsWith('--out=')) {
      result.out = arg.slice('--out='.length);
    }
  }

  return result;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.join(__dirname, '..', '..', '..');
  const historyDir = path.join(repoRoot, 'history');

  const engine = new EmulatorEngine();
  const startedAt = Date.now();
  const result = engine.run({
    historyDir,
    symbols: [args.symbol],
    timeframe: args.timeframe,
    zigzagConfig: args.zigzagConfig,
    limitPerSymbol: args.limit,
  });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[Emulator] Finished in ${elapsedSec}s — ${result.candlesProcessed.toLocaleString()} candles, ${result.trades.length} trades, ${result.discardedOpenOrders} discarded`);

  const report = formatReport(result);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOut = path.join(repoRoot, 'results', `emulation-${timestamp}.md`);
  const outPath = args.out ? path.resolve(process.cwd(), args.out) : defaultOut;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, report, 'utf-8');
  console.log(`[Emulator] Report written to ${outPath}`);
}

try {
  main();
} catch (err) {
  console.error('[Emulator] Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
}
```

- [ ] **Step 2: Edit `backend/package.json`**

Replace lines 5-10:

```json
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "node --test --require ts-node/register 'src/**/*.test.ts'"
  },
```

with:

```json
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "node --test --require ts-node/register 'src/**/*.test.ts'",
    "emulate": "ts-node src/emulator/run.ts"
  },
```

- [ ] **Step 3: Run the full backend suite and type check**

Run (from `backend/`): `node --test --require ts-node/register 'src/**/*.test.ts'`
Expected: PASS, all tests.

Run (from `backend/`): `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/emulator/run.ts backend/package.json
git commit -m "feat: add emulator CLI entry point (npm run emulate)"
```

---

### Task 7: Live smoke-test run against real BTC history

**Files:** none (verification only, no code changes).

**Interfaces:** none.

- [ ] **Step 1: Confirm the real BTC history file exists**

Run (from the repo root): `wc -l history/BTCUSDT/BTCUSDT_1m.csv`
Expected: a large number (hundreds of thousands of rows) confirming the file is present and non-empty.

- [ ] **Step 2: Run a bounded smoke test (fast, ~35 days of data)**

Run (from `backend/`): `npm run emulate -- --limit=50000 --out=/tmp/emulation-smoketest.md`
Expected: completes in well under a minute (50,000 candles is a small fraction of the full file); console output shows a line like `[Emulator] Finished in X.Xs — 50,000 candles, N trades, D discarded` and `[Emulator] Report written to /tmp/emulation-smoketest.md`.

- [ ] **Step 3: Inspect the generated report**

Read `/tmp/emulation-smoketest.md` (e.g. `cat /tmp/emulation-smoketest.md`). Confirm:
- The `## Configuration` section shows `Timeframe: 1m`, `Deviation: 1%`, `Min bars between pivots: 20`, `Price source: close`, `Candles processed: 50,000`.
- The `## Summary` section's trade count is a small double-digit number (per the design spec's own validation: ~35 pivots were observed over 20,000 real 1m BTC candles while designing the ZigZag algorithm, so roughly 2-3x that pivot count — and therefore roughly half as many completed round-trip trades — is plausible over 50,000 candles; exact numbers will vary since this is real market data, not a fixture).
- The `## Trades` table has one row per completed trade, each with a plausible BTC price (tens of thousands of USDT, matching `history/BTCUSDT/BTCUSDT_1m.csv`'s real price range) and a non-negative duration.

- [ ] **Step 4: Run a second smoke test with different parameters, confirm it changes the outcome**

Run (from `backend/`): `npm run emulate -- --limit=50000 --deviation=2 --out=/tmp/emulation-smoketest-dev2.md`
Expected: completes successfully; compare `## Summary`'s `Completed trades` count in this report against Step 3's — a larger deviation threshold should produce **fewer** completed trades over the same 50,000 candles (fewer, larger swings qualify as pivots), confirming the CLI flag actually reaches the ZigZag algorithm end-to-end.

- [ ] **Step 5: Clean up the smoke-test output files**

```bash
rm -f /tmp/emulation-smoketest.md /tmp/emulation-smoketest-dev2.md
```

- [ ] **Step 6: No commit for this task**

This task is verification-only; nothing to stage or commit.

---

## Self-Review

**Spec coverage:**
- `Observer`/`ObserverManager` optional ZigZag config/timeframe injection, defaults preserving live behavior → Task 1.
- `OrderManager` optional clock/order-sizing injection, defaults preserving live behavior → Task 2.
- All-in/uncapped sizing via injected `OrderSizeConfig` → Task 4 (`ALL_IN_ORDER_SIZE_CONFIG`).
- Synthetic 1s price feed so `getCurrentPrice()` resolves, mirroring `BotManager`'s live pivot-handling structure → Task 4.
- Streaming CSV reader, memory-efficient, single symbol → Task 3.
- Single-symbol-per-run structure that doesn't block future multi-symbol extension (`EmulatorOptions.symbols: string[]`, per-symbol loop) → Task 4.
- Discarded-open-order handling at end of data → Task 4, explicitly tested.
- Max drawdown tracking → Task 4.
- CLI flags for all ZigZag parameters + symbol/timeframe/limit/out → Task 6.
- Markdown report (config + summary + full per-trade table) → Task 5.
- `results/` already gitignored → confirmed in Global Constraints, no task needed.
- Live validation against real history → Task 7.

**Placeholder scan:** none found — every step has complete, runnable code and exact commands.

**Type consistency:** `ZigZagConfig`/`ChartTimeframe` parameter names and positions match between `Observer`'s constructor (Task 1), `ObserverManager.createObserver`/`createObservers` (Task 1), and `EmulatorEngine.run()`'s `createObservers()` call (Task 4). `OrderSizeConfig`/clock parameter names match between `OrderManager`'s constructor (Task 2) and `EmulatorEngine`'s `new OrderManager(...)` call (Task 4). `EmulatorResult`/`EmulatorTrade`/`EmulatorOptions` field names are identical across Task 4's definition, Task 5's `reportWriter.ts` usage, and Task 6's `run.ts` usage. `readSymbolCandles(historyDir, symbol, timeframe, limit?)` signature matches between Task 3's definition and Task 4's call site.
