# Manual Orders, Liquidity Sizing, and Orders View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual per-symbol buy action (footer button on each chart card) against a shared hypothetical 10,000 USDT balance, sized by 24h liquidity, that auto-sells when price reaches +0.5%, plus a tab switching from the chart grid to an Orders view showing active orders and realized performance.

**Architecture:** Backend gains a 24h rolling quote-volume window per symbol (reusing the MA99-style O(1) running-sum pattern), a pure `computeOrderSize()` function, and a new `OrderManager` that tracks multiple concurrent per-symbol orders against one shared balance, driven by the same 1s price tick that already feeds signal detection. REST endpoints expose buy/status/size-preview; two new socket events push order lifecycle changes live. Frontend adds two hooks (`useOrders`, `useOrderSizes`) mirroring the existing socket/REST hook conventions, a footer on each chart card, and a tabbed `OrdersView`.

**Tech Stack:** TypeScript, Node `node:test` + `node:assert/strict`, Express, Socket.IO, React 18, `lightweight-charts` (unchanged), Tailwind.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-08-manual-orders-design.md` — this plan implements it in full.
- Balance: starts at **10,000 USDT**, shared across all orders, in memory only (no persistence).
- Concurrency: multiple active orders at once, **one per symbol** — a symbol with an active order cannot be bought again until it completes.
- Sizing: `orderSize = min(availableBalance, quoteVolume24h × LIQUIDITY_FACTOR, MAX_ORDER_USDT)`, `LIQUIDITY_FACTOR = 0.0001`, `MAX_ORDER_USDT = 10_000`. `orderSize <= 0` → cannot buy.
- Fees: 0.1% on buy (`FEE = 0.001`, deducted from asset quantity received) and 0.1% on sell (deducted from USDT received).
- Target: `buyPrice × 1.005` (`TARGET_MULT = 1.005`), fixed at buy time.
- Completion: **only** when live price reaches target. **No stop-loss, no manual cancel** — an order can stay active indefinitely.
- Performance metric: `(Σ profit) / (Σ usdtSpent) × 100` over **completed** orders only; `0` with none completed.
- 24h quote-volume window: rolling sum over the last **1440** closed 1m candles (`QUOTE_VOLUME_WINDOW = 1440`); below a full window, this underestimates true 24h volume (self-corrects as live data accumulates) — not an error.
- No changes to signal detection (`utils/signals.ts`, qualifying logic) — this is a fully independent, manually-triggered system layered on top.

---

### Task 1: Backend types

**Files:**
- Modify: `backend/src/types/index.ts`

**Interfaces:**
- Produces: `Candle.quoteVolume?: number`; `ActiveOrder { symbol, buyPrice, targetPrice, quantity, usdtSpent, openedAt }`; `CompletedOrder` (extends `ActiveOrder`) `{ sellPrice, usdtReceived, profit, profitPct, closedAt, durationMs }`; `OrderStatus { balance, activeOrders: ActiveOrder[], completedCount, totalProfitPct }`; `OrderOpenedEvent { order: ActiveOrder, balance }`; `OrderCompletedEvent { order: CompletedOrder, balance, completedCount, totalProfitPct }`.

- [ ] **Step 1: Add `quoteVolume` to `Candle`**

In `backend/src/types/index.ts`, replace the `Candle` interface:

```ts
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
```

- [ ] **Step 2: Append the order types**

Append to the end of `backend/src/types/index.ts`:

```ts
export interface ActiveOrder {
  symbol: string;
  buyPrice: number;
  targetPrice: number;
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

- [ ] **Step 3: Verify the backend still compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 errors (nothing consumes the new types yet — that's fine, only `Candle` changed shape and it's additive/optional).

- [ ] **Step 4: Commit**

```bash
git add backend/src/types/index.ts
git commit -m "feat: add order and quoteVolume wire types"
```

---

### Task 2: `utils/orderSize.ts` (TDD)

**Files:**
- Create: `backend/src/utils/orderSize.ts`
- Create: `backend/src/utils/orderSize.test.ts`

**Interfaces:**
- Produces: `OrderSizeConfig { factor: number; maxUsdt: number }`, `computeOrderSize(availableBalance: number, quoteVolume24h: number, config: OrderSizeConfig): number`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/utils/orderSize.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOrderSize } from './orderSize';

const CONFIG = { factor: 0.0001, maxUsdt: 10_000 };

test('capped by quoteVolume24h * factor when that is the smallest bound', () => {
  const size = computeOrderSize(50_000, 1_000_000, CONFIG); // volume cap = 100
  assert.equal(size, 100);
});

test('capped by availableBalance when that is the smallest bound', () => {
  const size = computeOrderSize(50, 1_000_000_000, CONFIG); // volume cap = 100_000, maxUsdt = 10_000
  assert.equal(size, 50);
});

test('capped by maxUsdt when that is the smallest bound', () => {
  const size = computeOrderSize(50_000, 1_000_000_000, CONFIG); // volume cap = 100_000
  assert.equal(size, 10_000);
});

test('quoteVolume24h of 0 yields an order size of 0', () => {
  const size = computeOrderSize(50_000, 0, CONFIG);
  assert.equal(size, 0);
});

test('negative inputs are floored at 0, never negative', () => {
  assert.equal(computeOrderSize(-100, 1_000_000, CONFIG), 0);
  assert.equal(computeOrderSize(50_000, -1_000_000, CONFIG), 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test --require ts-node/register src/utils/orderSize.test.ts`
Expected: FAIL — `Cannot find module './orderSize'`.

- [ ] **Step 3: Implement `backend/src/utils/orderSize.ts`**

```ts
export interface OrderSizeConfig {
  factor: number;
  maxUsdt: number;
}

/** orderSize = min(availableBalance, quoteVolume24h * factor, maxUsdt), floored at 0. */
export function computeOrderSize(availableBalance: number, quoteVolume24h: number, config: OrderSizeConfig): number {
  return Math.max(0, Math.min(availableBalance, quoteVolume24h * config.factor, config.maxUsdt));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test --require ts-node/register src/utils/orderSize.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/orderSize.ts backend/src/utils/orderSize.test.ts
git commit -m "feat: add computeOrderSize() pure function"
```

---

### Task 3: `quoteVolume` data plumbing (WebSocket + REST + pagination)

**Files:**
- Modify: `backend/src/services/binanceWebSocket.ts`
- Modify (full rewrite): `backend/src/services/historicalCandles.ts`

**Interfaces:**
- Consumes: `Candle` (Task 1, now has `quoteVolume?: number`).
- Produces: `fetchHistoricalCandles(symbol: string, limit?: number): Promise<Candle[]>` — same signature as before, now paginates internally when `limit > 1000` and populates `quoteVolume`. `fetchClosedHourCandles` unchanged except `quoteVolume` now also populated (harmless — nothing 1h-specific uses it).

- [ ] **Step 1: Parse `quoteVolume` from the live kline WebSocket**

In `backend/src/services/binanceWebSocket.ts`, update the `BinanceKlineEvent` interface (add `q: string;` to `k`):

```ts
interface BinanceKlineEvent {
  e: string;
  E: number;
  s: string;
  k: {
    t: number;
    o: string;
    h: string;
    l: string;
    c: string;
    q: string;
    i: string;
    x: boolean;
  };
}
```

Update `handleKline` to include `quoteVolume`:

```ts
  private handleKline(event: BinanceKlineEvent): void {
    const k = event.k;
    const timeframe = k.i as CandleTimeframe;

    const candle: Candle = {
      symbol: event.s,
      timeframe,
      openTime: k.t,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      quoteVolume: parseFloat(k.q),
      isClosed: k.x,
    };

    this.emit('candle', candle);
  }
```

- [ ] **Step 2: Rewrite `backend/src/services/historicalCandles.ts` — parse `quoteVolume` and paginate `fetchHistoricalCandles`**

Replace the full file:

```ts
import https from 'https';
import { Candle, CandleTimeframe } from '../types';
import { BINANCE_REST_URL } from '../config/binance';

// Binance kline response columns
type BinanceKlineRow = [
  number,  // 0 open time
  string,  // 1 open
  string,  // 2 high
  string,  // 3 low
  string,  // 4 close
  string,  // 5 volume
  number,  // 6 close time
  string,  // 7 quote asset volume
  ...unknown[]
];

const BINANCE_KLINES_MAX_LIMIT = 1000;

function get<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(body) as T); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function parseRow(symbol: string, timeframe: CandleTimeframe, row: BinanceKlineRow): Candle {
  return {
    symbol,
    timeframe,
    openTime: row[0],
    open:     parseFloat(row[1]),
    high:     parseFloat(row[2]),
    low:      parseFloat(row[3]),
    close:    parseFloat(row[4]),
    quoteVolume: parseFloat(row[7]),
    isClosed: true,  // historical candles are always closed
  };
}

/**
 * Fetches the last `limit` closed 1m candles for a symbol from Binance REST
 * API, ascending order. Paginates backward via `endTime` when `limit`
 * exceeds Binance's 1000-per-request cap (e.g. limit=1440 takes 2
 * requests). We request one extra candle overall and drop it, since it may
 * be the currently open candle.
 */
export async function fetchHistoricalCandles(symbol: string, limit = 99): Promise<Candle[]> {
  const pages: BinanceKlineRow[][] = [];
  let remaining = limit + 1;
  let endTime: number | undefined;

  while (remaining > 0) {
    const pageLimit = Math.min(remaining, BINANCE_KLINES_MAX_LIMIT);
    const endTimeParam = endTime !== undefined ? `&endTime=${endTime}` : '';
    const url = `${BINANCE_REST_URL}/api/v3/klines?symbol=${symbol}&interval=1m&limit=${pageLimit}${endTimeParam}`;
    const rows = await get<BinanceKlineRow[]>(url);
    if (rows.length === 0) break;

    pages.unshift(rows);
    remaining -= rows.length;
    endTime = rows[0][0] - 1;
  }

  const rows = pages.flat();
  return rows.slice(0, limit).map(row => parseRow(symbol, '1m', row));
}

/**
 * Fetches the last `limit` CLOSED 1h candles for a symbol (ascending). We
 * request limit+1 and drop the last row (the currently open candle). The
 * caller uses these to warm up the closed-candle window backing the chart
 * and live signal detection.
 */
export async function fetchClosedHourCandles(symbol: string, limit = 120): Promise<Candle[]> {
  const url = `${BINANCE_REST_URL}/api/v3/klines?symbol=${symbol}&interval=1h&limit=${limit + 1}`;
  const rows = await get<BinanceKlineRow[]>(url);
  const closed = rows.slice(0, rows.length - 1);
  if (closed.length === 0) {
    throw new Error(`No closed 1h candles available for ${symbol}`);
  }
  return closed.map(row => parseRow(symbol, '1h', row));
}
```

- [ ] **Step 3: Verify compilation and manually confirm pagination against live Binance**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 errors.

Run this manual check (there's no dedicated test file for this network-calling module, consistent with the rest of this codebase — only pure functions get unit tests here):

```bash
cd backend && node --require ts-node/register -e "
const { fetchHistoricalCandles } = require('./src/services/historicalCandles');
fetchHistoricalCandles('BTCUSDT', 1440).then(candles => {
  const times = candles.map(c => c.openTime);
  const ascending = times.every((t, i) => i === 0 || t > times[i - 1]);
  console.log('count:', candles.length, 'ascending:', ascending, 'hasQuoteVolume:', candles.every(c => typeof c.quoteVolume === 'number' && c.quoteVolume >= 0));
});
"
```
Expected: `count: 1440 ascending: true hasQuoteVolume: true`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/binanceWebSocket.ts backend/src/services/historicalCandles.ts
git commit -m "feat: parse quoteVolume from Binance, paginate 1m candle fetch past 1000"
```

---

### Task 4: `Observer` — 24h quote-volume window + `getCurrentPrice()`

**Files:**
- Modify (full rewrite): `backend/src/observers/Observer.ts`
- Modify: `backend/src/observers/Observer.test.ts`

**Interfaces:**
- Consumes: `Queue<T>` (unchanged); `Candle` (Task 1/3, now carries `quoteVolume`).
- Produces: `Observer.preloadQuoteVolume1m(candles: Candle[]): void`, `Observer.get24hQuoteVolume(): number`, `Observer.getCurrentPrice(): number | null`. All other existing `Observer` methods (`constructor`, `preloadClosed1m/1h`, `updateCandle1s/1m/1h`, `getState`, `getChartData`) keep their exact signatures.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/observers/Observer.test.ts` (it already imports `test`, `assert`, `Observer`, `Candle`):

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test --require ts-node/register src/observers/Observer.test.ts`
Expected: FAIL — `observer.preloadQuoteVolume1m is not a function` (and similar for `get24hQuoteVolume`/`getCurrentPrice`).

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

/** 1 quote-volume value per closed 1m candle, covering a rolling 24h window
 * (60 * 24 = 1440 minutes), used for liquidity-based order sizing. */
const QUOTE_VOLUME_WINDOW = 1440;

const EMPTY_SIGNAL: SignalResult = {
  qualifies: false,
  reasons: { bbUpper1m: false, bbUpper1h: false },
};

export class Observer {
  private symbol: string;
  private closed1m: Queue<Candle>;
  private closed1h: Queue<Candle>;
  private quoteVol1m: Queue<number>;
  private quoteVolSum = 0;
  private form1mCandle: Candle | null = null;
  private form1hCandle: Candle | null = null;
  private currentPrice: number | null = null;
  private signal: SignalResult = EMPTY_SIGNAL;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.closed1m = new Queue<Candle>(CHART_HISTORY_CANDLES);
    this.closed1h = new Queue<Candle>(CHART_HISTORY_CANDLES);
    this.quoteVol1m = new Queue<number>(QUOTE_VOLUME_WINDOW);
  }

  preloadClosed1m(candles: Candle[]): void {
    candles.forEach(c => this.closed1m.push(c));
  }

  preloadClosed1h(candles: Candle[]): void {
    candles.forEach(c => this.closed1h.push(c));
  }

  /** Feeds the 24h rolling quote-volume window without touching the chart
   * buffer — callers typically pass a longer history here than to
   * preloadClosed1m (e.g. 1440 candles vs. 200). */
  preloadQuoteVolume1m(candles: Candle[]): void {
    candles.forEach(c => this.pushQuoteVolume(c.quoteVolume ?? 0));
  }

  updateCandle1s(candle: Candle): void {
    this.currentPrice = candle.close;
    this.recompute();
  }

  updateCandle1m(candle: Candle): void {
    if (candle.isClosed) {
      this.closed1m.push(candle);
      this.pushQuoteVolume(candle.quoteVolume ?? 0);
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

  private recompute(): void {
    if (this.currentPrice === null) return;
    this.signal = detectSignal(this.currentPrice, this.closed1m.toArray(), this.closed1h.toArray());
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test --require ts-node/register src/observers/Observer.test.ts`
Expected: PASS — all tests green (the 4 new ones plus the pre-existing `getChartData` ones).

- [ ] **Step 5: Run the signals test suite to confirm no regression**

Run: `cd backend && node --test --require ts-node/register src/utils/signals.test.ts`
Expected: PASS — unchanged, since `recompute()`'s call to `detectSignal` is untouched.

- [ ] **Step 6: Commit**

```bash
git add backend/src/observers/Observer.ts backend/src/observers/Observer.test.ts
git commit -m "feat: add 24h rolling quote-volume window and getCurrentPrice() to Observer"
```

---

### Task 5: `ObserverManager` passthroughs

**Files:**
- Modify: `backend/src/managers/ObserverManager.ts`

**Interfaces:**
- Consumes: `Observer.preloadQuoteVolume1m`, `Observer.get24hQuoteVolume`, `Observer.getCurrentPrice` (Task 4).
- Produces: `ObserverManager.preloadObserverVolume(symbol: string, candles: Candle[]): void`, `ObserverManager.getQuoteVolume24h(symbol: string): number | null`, `ObserverManager.getCurrentPrice(symbol: string): number | null`.

- [ ] **Step 1: Add the three passthrough methods**

In `backend/src/managers/ObserverManager.ts`, add these methods anywhere inside the class (e.g. right after `preloadObserver1h`):

```ts
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
```

- [ ] **Step 2: Verify compilation**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/managers/ObserverManager.ts
git commit -m "feat: expose quote-volume and current-price passthroughs on ObserverManager"
```

---

### Task 6: `OrderManager` (TDD)

**Files:**
- Create: `backend/src/managers/OrderManager.ts`
- Create: `backend/src/managers/OrderManager.test.ts`

**Interfaces:**
- Consumes: `computeOrderSize` (Task 2); `ActiveOrder`, `CompletedOrder`, `OrderStatus` (Task 1).
- Produces: `class OrderManager extends EventEmitter` with `hasActiveOrder(symbol): boolean`, `computeOrderSize(quoteVolume24h: number): number`, `buy(symbol: string, price: number, quoteVolume24h: number): ActiveOrder | null`, `onPriceTick(symbol: string, price: number): void`, `getStatus(): OrderStatus`. Emits `'opened'` with `{ order: ActiveOrder, balance: number }` and `'completed'` with `{ order: CompletedOrder, balance: number, completedCount: number, totalProfitPct: number }`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/managers/OrderManager.test.ts`:

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
  assert.equal(order!.targetPrice, 100.5); // +0.5%
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
  manager.buy('BTCUSDT', 100, HIGH_VOLUME);
  manager.buy('ETHUSDT', 50, HIGH_VOLUME);

  assert.ok(manager.hasActiveOrder('BTCUSDT'));
  assert.ok(manager.hasActiveOrder('ETHUSDT'));
  assert.equal(manager.getStatus().activeOrders.length, 2);
});

test('onPriceTick does nothing for a symbol with no active order', () => {
  const manager = new OrderManager();
  manager.onPriceTick('BTCUSDT', 1000);
  assert.equal(manager.getStatus().activeOrders.length, 0);
});

test('onPriceTick below target leaves the order active', () => {
  const manager = new OrderManager();
  manager.buy('BTCUSDT', 100, HIGH_VOLUME); // target = 100.5
  manager.onPriceTick('BTCUSDT', 100.4);
  assert.ok(manager.hasActiveOrder('BTCUSDT'));
  assert.equal(manager.getStatus().completedCount, 0);
});

test('onPriceTick at or above target completes the order and credits balance', () => {
  const manager = new OrderManager();
  manager.buy('BTCUSDT', 100, HIGH_VOLUME); // spends 10_000, target 100.5
  manager.onPriceTick('BTCUSDT', 100.5);

  assert.equal(manager.hasActiveOrder('BTCUSDT'), false);
  const status = manager.getStatus();
  assert.equal(status.completedCount, 1);
  assert.equal(status.activeOrders.length, 0);
  assert.ok(status.balance > 0); // got usdtReceived back
});

test('totalProfitPct is 0 with no completed orders, and reflects profit/invested once one completes', () => {
  const manager = new OrderManager();
  assert.equal(manager.getStatus().totalProfitPct, 0);

  manager.buy('BTCUSDT', 100, HIGH_VOLUME);
  manager.onPriceTick('BTCUSDT', 100.5);

  const status = manager.getStatus();
  // ~0.5% target minus ~0.2% round-trip fees ≈ +0.3%
  assert.ok(status.totalProfitPct > 0.2 && status.totalProfitPct < 0.4, `expected ~0.3%, got ${status.totalProfitPct}`);
});

test('a symbol can be bought again once its previous order completes', () => {
  const manager = new OrderManager();
  manager.buy('BTCUSDT', 100, HIGH_VOLUME);
  manager.onPriceTick('BTCUSDT', 100.5);

  const second = manager.buy('BTCUSDT', 200, HIGH_VOLUME);
  assert.ok(second !== null);
  assert.ok(manager.hasActiveOrder('BTCUSDT'));
});

test('emits opened and completed events with the expected payload shape', () => {
  const manager = new OrderManager();
  let openedPayload: { order: { symbol: string }; balance: number } | null = null;
  let completedPayload: { order: { symbol: string }; balance: number; completedCount: number; totalProfitPct: number } | null = null;
  manager.on('opened', (payload) => { openedPayload = payload; });
  manager.on('completed', (payload) => { completedPayload = payload; });

  manager.buy('BTCUSDT', 100, HIGH_VOLUME);
  assert.ok(openedPayload !== null);
  assert.equal(openedPayload!.order.symbol, 'BTCUSDT');
  assert.equal(typeof openedPayload!.balance, 'number');

  manager.onPriceTick('BTCUSDT', 100.5);
  assert.ok(completedPayload !== null);
  assert.equal(completedPayload!.order.symbol, 'BTCUSDT');
  assert.equal(typeof completedPayload!.balance, 'number');
  assert.equal(completedPayload!.completedCount, 1);
  assert.equal(typeof completedPayload!.totalProfitPct, 'number');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test --require ts-node/register src/managers/OrderManager.test.ts`
Expected: FAIL — `Cannot find module './OrderManager'`.

- [ ] **Step 3: Implement `backend/src/managers/OrderManager.ts`**

```ts
import { EventEmitter } from 'events';
import { ActiveOrder, CompletedOrder, OrderStatus } from '../types';
import { computeOrderSize, OrderSizeConfig } from '../utils/orderSize';

const INITIAL_BALANCE = 10_000;
const FEE = 0.001;            // 0.1% on buy (asset) and sell (usdt)
const TARGET_MULT = 1.005;    // +0.5% sell target
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
    const targetPrice = price * TARGET_MULT;

    this.balance -= orderSize;
    const order: ActiveOrder = {
      symbol,
      buyPrice: price,
      targetPrice,
      quantity,
      usdtSpent: orderSize,
      openedAt: Date.now(),
    };
    this.activeOrders.set(symbol, order);

    console.log(`[Order] BUY  ${symbol} @ ${price} | size: ${orderSize.toFixed(2)} USDT | qty: ${quantity.toFixed(6)} | target: ${targetPrice.toFixed(8)}`);
    this.emit('opened', { order, balance: this.balance });
    return order;
  }

  onPriceTick(symbol: string, price: number): void {
    const order = this.activeOrders.get(symbol);
    if (!order) return;
    if (price >= order.targetPrice) {
      this.complete(order, price);
    }
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test --require ts-node/register src/managers/OrderManager.test.ts`
Expected: PASS — all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/managers/OrderManager.ts backend/src/managers/OrderManager.test.ts
git commit -m "feat: add OrderManager (multi-order, liquidity-sized, target-only completion)"
```

---

### Task 7: `BotManager` wiring

**Files:**
- Modify (full rewrite): `backend/src/managers/BotManager.ts`

**Interfaces:**
- Consumes: `OrderManager` (Task 6); `ObserverManager.preloadObserverVolume` (Task 5); `fetchHistoricalCandles` (Task 3, now paginating).
- Produces: `BotManager.orderManager: OrderManager` (new public readonly field). `start()`/`stop()` keep their signatures.

- [ ] **Step 1: Rewrite `backend/src/managers/BotManager.ts`**

```ts
import { SymbolManager } from '../services/symbolManager';
import { ObserverManager } from './ObserverManager';
import { OrderManager } from './OrderManager';
import { BinanceWebSocket } from '../services/binanceWebSocket';
import { fetchHistoricalCandles, fetchClosedHourCandles } from '../services/historicalCandles';

/** Chart/detection buffer size — unchanged from before. */
const CHART_PRELOAD_CANDLES = 200;

/** 24h of 1m candles (60 * 24), used to warm up the liquidity-based
 * order-sizing volume window (see observers/Observer.ts). The same fetch
 * also supplies the chart/detection buffer (its most recent 200 candles). */
const VOLUME_PRELOAD_CANDLES = 1440;

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

    this.ws = new BinanceWebSocket(symbols);
    this.ws.on('candle', candle => {
      this.observerManager.updateCandle(candle);
      if (candle.timeframe === '1s') {
        this.orderManager.onPriceTick(candle.symbol, candle.close);
      }
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

- [ ] **Step 2: Verify compilation**

Run: `cd backend && npx tsc --noEmit`
Expected: errors only in `routes/api.ts` and `services/socketServer.ts`/`index.ts` (not yet updated to use `bot.orderManager` — that's Tasks 8-9). No errors in `BotManager.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add backend/src/managers/BotManager.ts
git commit -m "feat: wire OrderManager into BotManager's price-tick loop and preload"
```

---

### Task 8: REST endpoints

**Files:**
- Modify: `backend/src/routes/api.ts`

**Interfaces:**
- Consumes: `bot.orderManager.buy/getStatus/computeOrderSize` (Task 6); `bot.observerManager.getCurrentPrice/getQuoteVolume24h` (Task 5).
- Produces: `POST /api/orders/buy`, `GET /api/orders`, `GET /api/orders/sizes`.

- [ ] **Step 1: Add the three routes**

In `backend/src/routes/api.ts`, insert before the final `return router;`:

```ts
  router.post('/orders/buy', (req: Request, res: Response) => {
    const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol.toUpperCase() : '';
    if (!symbol) {
      res.status(400).json({ error: 'symbol is required' });
      return;
    }

    const price = bot.observerManager.getCurrentPrice(symbol);
    const quoteVolume24h = bot.observerManager.getQuoteVolume24h(symbol);
    if (price === null || quoteVolume24h === null) {
      res.status(404).json({ error: `Symbol ${symbol} not found` });
      return;
    }

    const order = bot.orderManager.buy(symbol, price, quoteVolume24h);
    if (!order) {
      res.status(400).json({ error: `Cannot buy ${symbol}: already active, or order size is 0` });
      return;
    }

    res.json({ data: order });
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
```

- [ ] **Step 2: Verify compilation**

Run: `cd backend && npx tsc --noEmit`
Expected: errors only in `services/socketServer.ts`/`index.ts` (Task 9). No errors in `routes/api.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/api.ts
git commit -m "feat: add REST endpoints for buying, order status, and order-size preview"
```

---

### Task 9: Socket wiring + `index.ts`

**Files:**
- Modify (full rewrite): `backend/src/services/socketServer.ts`
- Modify: `backend/src/index.ts:21`

**Interfaces:**
- Consumes: `OrderManager` events `'opened'`/`'completed'` (Task 6); `OrderOpenedEvent`/`OrderCompletedEvent`/`OrderStatus` (Task 1).
- Produces: socket events `'order:opened'`, `'order:completed'`; `'snapshot'` payload gains `orders: OrderStatus`. `createSocketServer` signature becomes `(httpServer, observerManager, orderManager)`.

- [ ] **Step 1: Rewrite `backend/src/services/socketServer.ts`**

```ts
import { Server as HttpServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { ObserverManager } from '../managers/ObserverManager';
import { OrderManager } from '../managers/OrderManager';
import { ChartClosedEvent, ChartTickEvent, ObserverState, OrderCompletedEvent, OrderOpenedEvent } from '../types';

export function createSocketServer(httpServer: HttpServer, observerManager: ObserverManager, orderManager: OrderManager): void {
  const io = new SocketIO(httpServer, { cors: { origin: '*' } });

  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    socket.emit('snapshot', {
      observers: observerManager.getAllStates(),
      orders: orderManager.getStatus(),
    });

    socket.on('disconnect', () => {
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
  });

  observerManager.on('signal', (state: ObserverState) => {
    io.emit('signal', state);
  });

  observerManager.on('chart:tick', (payload: ChartTickEvent) => {
    io.emit('chart:tick', payload);
  });

  observerManager.on('chart:closed', (payload: ChartClosedEvent) => {
    io.emit('chart:closed', payload);
  });

  orderManager.on('opened', (payload: OrderOpenedEvent) => {
    io.emit('order:opened', payload);
  });

  orderManager.on('completed', (payload: OrderCompletedEvent) => {
    io.emit('order:completed', payload);
  });
}
```

- [ ] **Step 2: Update `backend/src/index.ts`**

Change line 21 from:
```ts
  createSocketServer(httpServer, bot.observerManager);
```
to:
```ts
  createSocketServer(httpServer, bot.observerManager, bot.orderManager);
```

- [ ] **Step 3: Compile and run the full backend test suite**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: `tsc` 0 errors (this is the first time in this plan the whole backend should compile clean). `npm test` — all tests pass, including Tasks 2/4/6's new tests.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/socketServer.ts backend/src/index.ts
git commit -m "feat: forward order:opened/order:completed events, add orders to snapshot"
```

---

### Task 10: Frontend types

**Files:**
- Modify: `frontend/src/types/index.ts`

**Interfaces:**
- Produces: `ActiveOrder`, `CompletedOrder`, `OrderStatus`, `OrderOpenedEvent`, `OrderCompletedEvent` — mirror the backend shapes from Task 1 field-for-field.

- [ ] **Step 1: Append the order types**

Append to the end of `frontend/src/types/index.ts`:

```ts
export interface ActiveOrder {
  symbol: string;
  buyPrice: number;
  targetPrice: number;
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

- [ ] **Step 2: Verify the frontend still compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat: mirror order wire types on the frontend"
```

---

### Task 11: `useOrders()` hook

**Files:**
- Create: `frontend/src/hooks/useOrders.ts`

**Interfaces:**
- Consumes: `getSocket()` (existing `hooks/socket.ts`); `ActiveOrder`, `OrderStatus`, `OrderOpenedEvent`, `OrderCompletedEvent` (Task 10); backend `GET /api/orders` → `{ data: OrderStatus }` (Task 8); socket events `'snapshot'` (payload now includes `orders?: OrderStatus`), `'order:opened'`, `'order:completed'` (Task 9).
- Produces: `useOrders(): OrderStatus` — used by Task 15 (`ChartGrid`) and Task 16 (`OrdersView`).

- [ ] **Step 1: Create `frontend/src/hooks/useOrders.ts`**

```ts
import { useEffect, useState } from 'react';
import { ActiveOrder, OrderCompletedEvent, OrderOpenedEvent, OrderStatus } from '../types';
import { getSocket } from './socket';

const EMPTY_STATUS: OrderStatus = { balance: 0, activeOrders: [], completedCount: 0, totalProfitPct: 0 };

export function useOrders(): OrderStatus {
  const [status, setStatus] = useState<OrderStatus>(EMPTY_STATUS);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/orders')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: { data: OrderStatus }) => {
        if (cancelled) return;
        setStatus(json.data);
      })
      .catch(() => {
        // The socket's 'snapshot' event carries the same data — a failed
        // initial fetch just means the view starts empty until then.
      });

    const socket = getSocket();

    const handleSnapshot = (snapshot: { orders?: OrderStatus }) => {
      if (snapshot.orders) setStatus(snapshot.orders);
    };

    const handleOpened = (event: OrderOpenedEvent) => {
      setStatus(s => ({
        ...s,
        balance: event.balance,
        activeOrders: [...s.activeOrders.filter(o => o.symbol !== event.order.symbol), event.order],
      }));
    };

    const handleCompleted = (event: OrderCompletedEvent) => {
      setStatus(s => ({
        balance: event.balance,
        activeOrders: s.activeOrders.filter((o: ActiveOrder) => o.symbol !== event.order.symbol),
        completedCount: event.completedCount,
        totalProfitPct: event.totalProfitPct,
      }));
    };

    socket.on('snapshot', handleSnapshot);
    socket.on('order:opened', handleOpened);
    socket.on('order:completed', handleCompleted);

    return () => {
      cancelled = true;
      socket.off('snapshot', handleSnapshot);
      socket.off('order:opened', handleOpened);
      socket.off('order:completed', handleCompleted);
    };
  }, []);

  return status;
}
```

- [ ] **Step 2: Verify the frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors (no component consumes this hook yet — fine).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useOrders.ts
git commit -m "feat: add useOrders hook (REST snapshot + live order:opened/completed)"
```

---

### Task 12: `useOrderSizes()` hook

**Files:**
- Create: `frontend/src/hooks/useOrderSizes.ts`

**Interfaces:**
- Consumes: backend `GET /api/orders/sizes?symbols=...` → `{ data: { balance: number, sizes: Record<string, number> } }` (Task 8).
- Produces: `useOrderSizes(symbols: string[]): { balance: number; sizes: Record<string, number> }` — used by Task 15 (`ChartGrid`).

- [ ] **Step 1: Create `frontend/src/hooks/useOrderSizes.ts`**

```ts
import { useEffect, useState } from 'react';

interface OrderSizesState {
  balance: number;
  sizes: Record<string, number>;
}

const EMPTY: OrderSizesState = { balance: 0, sizes: {} };
const POLL_INTERVAL_MS = 5000;

/** Polls the order-size preview for the given symbols — order size only
 * changes on a buy/sell anywhere (affects balance) or a 1m candle close per
 * symbol (affects quoteVolume24h), neither frequent enough to justify a
 * live push; a short poll keeps the footer close enough to current. */
export function useOrderSizes(symbols: string[]): OrderSizesState {
  const key = symbols.slice().sort().join(',');
  const [state, setState] = useState<OrderSizesState>(EMPTY);

  useEffect(() => {
    if (symbols.length === 0) {
      setState(EMPTY);
      return;
    }

    let cancelled = false;

    const fetchSizes = () => {
      fetch(`/api/orders/sizes?symbols=${encodeURIComponent(symbols.join(','))}`)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((json: { data: OrderSizesState }) => {
          if (!cancelled) setState(json.data);
        })
        .catch(() => {
          // Keep showing the last known sizes on a transient failure.
        });
    };

    fetchSizes();
    const interval = setInterval(fetchSizes, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [key]);

  return state;
}
```

- [ ] **Step 2: Verify the frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors. (TypeScript won't flag the `symbols` vs `key` dependency mismatch — there's no lint step in this project; `key` is intentionally used as the effect dependency instead of `symbols` since a new array reference is created on every render even when its contents are unchanged.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useOrderSizes.ts
git commit -m "feat: add useOrderSizes hook (polled order-size preview)"
```

---

### Task 13: `SymbolChart` — accept data as props

**Files:**
- Modify (full rewrite): `frontend/src/components/SymbolChart.tsx`

**Interfaces:**
- Consumes: `ChartCandle`, `ChartSeries` (existing types) instead of calling `useSymbolChartData` itself.
- Produces: `SymbolChart({ candles: ChartCandle[]; series: ChartSeries; loading: boolean; error: string | null }): JSX.Element` — no longer takes `symbol`/`timeframe` props. Used by Task 14's `SymbolChartCard`, which now owns the `useSymbolChartData` call.

This decouples `SymbolChart` from the data-fetching hook so `SymbolChartCard` (Task 14) can read the same `candles` array for its footer's "current price" without opening a second socket subscription for the same symbol/timeframe.

- [ ] **Step 1: Rewrite `frontend/src/components/SymbolChart.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, IChartApi, LineSeries, ISeriesApi, LineData, UTCTimestamp, WhitespaceData } from 'lightweight-charts';
import { ChartCandle, ChartSeries } from '../types';

interface Props {
  candles: ChartCandle[];
  series: ChartSeries;
  loading: boolean;
  error: string | null;
}

/** The data buffer holds 100 candles, but the initial view zooms in to the
 * most recent 20 for readability — the user can still scroll/zoom out. */
const INITIAL_VISIBLE_CANDLES = 20;

function toTime(openTimeMs: number): UTCTimestamp {
  return Math.floor(openTimeMs / 1000) as UTCTimestamp;
}

export function SymbolChart({ candles, series, loading, error }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma99SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const hasSetInitialRangeRef = useRef(false);

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

    const priceFormat = { type: 'price' as const, precision: 6, minMove: 0.000001 };

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceFormat,
    });
    const noPriceLine = { priceLineVisible: false, lastValueVisible: false };
    ma20SeriesRef.current = chart.addSeries(LineSeries, { color: '#ecb619', lineWidth: 2, priceFormat, ...noPriceLine });
    ma99SeriesRef.current = chart.addSeries(LineSeries, { color: '#FFF', lineWidth: 3, priceFormat, ...noPriceLine });
    bbUpperSeriesRef.current = chart.addSeries(LineSeries, { color: '#b385f8', lineWidth: 2, priceFormat, ...noPriceLine });
    bbLowerSeriesRef.current = chart.addSeries(LineSeries, { color: '#d63966', lineWidth: 2, priceFormat, ...noPriceLine });

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
    if (!candleSeriesRef.current || candles.length === 0) {
      // No data yet (or the underlying dataset was just reset, e.g. a
      // symbol/timeframe change upstream) — re-zoom once real data returns.
      hasSetInitialRangeRef.current = false;
      return;
    }

    candleSeriesRef.current.setData(
      candles.map(c => ({ time: toTime(c.openTime), open: c.open, high: c.high, low: c.low, close: c.close }))
    );

    const toLineData = (values: (number | null)[]): (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] =>
      candles.map((c, i) => {
        const time = toTime(c.openTime);
        const value = values[i];
        return value === null ? { time } : { time, value };
      });

    ma20SeriesRef.current?.setData(toLineData(series.ma20));
    ma99SeriesRef.current?.setData(toLineData(series.ma99));
    bbUpperSeriesRef.current?.setData(toLineData(series.bbUpper));
    bbLowerSeriesRef.current?.setData(toLineData(series.bbLower));

    if (!hasSetInitialRangeRef.current && chartRef.current) {
      const total = candles.length;
      const from = Math.max(0, total - INITIAL_VISIBLE_CANDLES);
      chartRef.current.timeScale().setVisibleLogicalRange({ from, to: total - 1 });
      hasSetInitialRangeRef.current = true;
    }
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

- [ ] **Step 2: Verify compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors in `SymbolChartCard.tsx` (it still calls `<SymbolChart symbol={symbol} timeframe={timeframe} />` with the OLD props — that's fixed in Task 14). No errors in `SymbolChart.tsx` itself.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SymbolChart.tsx
git commit -m "refactor: SymbolChart takes candles/series/loading/error as props"
```

---

### Task 14: `SymbolChartCard` — own the data hook, add the footer

**Files:**
- Modify (full rewrite): `frontend/src/components/SymbolChartCard.tsx`

**Interfaces:**
- Consumes: `useSymbolChartData(symbol, timeframe)` (existing, now called here instead of inside `SymbolChart`); `SymbolChart` (Task 13, new props shape); `ActiveOrder` (Task 10).
- Produces: `SymbolChartCard({ symbol, isPinned, onTogglePin, activeOrder, orderSize, onBuy })` — three new props (`activeOrder: ActiveOrder | null`, `orderSize: number`, `onBuy: () => void`) on top of the two that already existed. Used by Task 15's `ChartGrid`.

- [ ] **Step 1: Rewrite `frontend/src/components/SymbolChartCard.tsx`**

```tsx
import { useState } from 'react';
import { ActiveOrder, ChartTimeframe } from '../types';
import { SymbolChart } from './SymbolChart';
import { useSymbolChartData } from '../hooks/useSymbolChartData';

interface Props {
  symbol: string;
  isPinned: boolean;
  onTogglePin: () => void;
  activeOrder: ActiveOrder | null;
  orderSize: number;
  onBuy: () => void;
}

const TIMEFRAMES: ChartTimeframe[] = ['1m', '1h'];
const TARGET_MULT = 1.005;

/** All symbols in this app are USDT pairs (e.g. "BTCUSDT" -> "BTC_USDT"). */
function binanceSpotUrl(symbol: string): string {
  const base = symbol.slice(0, -4);
  return `https://www.binance.com/es-AR/trade/${base}_USDT?type=spot`;
}

function fmtPrice(value: number): string {
  return value.toFixed(6);
}

export function SymbolChartCard({ symbol, isPinned, onTogglePin, activeOrder, orderSize, onBuy }: Props) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1m');
  const { candles, series, loading, error } = useSymbolChartData(symbol, timeframe);

  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : null;
  const targetPrice = currentPrice !== null ? currentPrice * TARGET_MULT : null;

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

      <SymbolChart candles={candles} series={series} loading={loading} error={error} />

      <div className="mt-2 pt-2 border-t border-gray-800 flex items-center justify-between text-xs font-mono">
        <div className="flex flex-col gap-0.5 text-gray-400">
          <span>Price: <span className="text-gray-200">{currentPrice !== null ? fmtPrice(currentPrice) : '—'}</span></span>
          <span>Target: <span className="text-green-400">{targetPrice !== null ? fmtPrice(targetPrice) : '—'}</span></span>
          <span>Size: <span className="text-gray-200">{orderSize.toFixed(2)} USDT</span></span>
        </div>
        {activeOrder ? (
          <div className="text-right text-yellow-400">
            <div>Active</div>
            <div className="text-gray-400">buy {fmtPrice(activeOrder.buyPrice)}</div>
          </div>
        ) : (
          <button
            onClick={onBuy}
            disabled={orderSize <= 0 || currentPrice === null}
            className="px-3 py-1 rounded bg-green-600 text-white text-xs disabled:bg-gray-700 disabled:text-gray-500"
          >
            Buy
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors only in `ChartGrid.tsx` (still renders `<SymbolChartCard symbol={...} isPinned={...} onTogglePin={...} />` without the 3 new required props — fixed in Task 15). No errors in `SymbolChartCard.tsx` itself.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SymbolChartCard.tsx
git commit -m "feat: add price/target/size footer and Buy button to SymbolChartCard"
```

---

### Task 15: `ChartGrid` — wire orders in

**Files:**
- Modify (full rewrite): `frontend/src/components/ChartGrid.tsx`

**Interfaces:**
- Consumes: `useOrders()` (Task 11), `useOrderSizes(symbols)` (Task 12), `SymbolChartCard`'s new props (Task 14).
- Produces: `ChartGrid({ observers: ObserverData[] })` — same public props as before; behavior unchanged except each card now receives live order data.

- [ ] **Step 1: Rewrite `frontend/src/components/ChartGrid.tsx`**

```tsx
import { useState } from 'react';
import { ObserverData } from '../types';
import { SymbolChartCard } from './SymbolChartCard';
import { useOrders } from '../hooks/useOrders';
import { useOrderSizes } from '../hooks/useOrderSizes';

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

  const visible = observers.filter(o => o.qualifies || pinnedSymbols.has(o.symbol));
  const pinned = visible.filter(o => pinnedSymbols.has(o.symbol));
  const unpinned = visible.filter(o => !pinnedSymbols.has(o.symbol));
  const orderedSymbols = [...pinned, ...unpinned];

  const { sizes } = useOrderSizes(orderedSymbols.map(o => o.symbol));

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

  if (visible.length === 0) {
    return <p className="text-gray-500 text-sm">No symbols currently qualify.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {orderedSymbols.map(o => (
        <SymbolChartCard
          key={o.symbol}
          symbol={o.symbol}
          isPinned={pinnedSymbols.has(o.symbol)}
          onTogglePin={() => togglePin(o.symbol)}
          activeOrder={activeOrders.find(order => order.symbol === o.symbol) ?? null}
          orderSize={sizes[o.symbol] ?? 0}
          onBuy={() => buySymbol(o.symbol)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation and build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 0 errors, build succeeds (this is the first point in this plan where the whole frontend should compile clean).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChartGrid.tsx
git commit -m "feat: wire useOrders/useOrderSizes into ChartGrid and its cards"
```

---

### Task 16: `OrdersView` + tabs in `App.tsx`

**Files:**
- Create: `frontend/src/components/OrdersView.tsx`
- Modify (full rewrite): `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useOrders()` (Task 11); `ChartGrid` (Task 15, unchanged public props).
- Produces: `OrdersView(): JSX.Element` — the new main view when the "Active Orders" tab is selected.

- [ ] **Step 1: Create `frontend/src/components/OrdersView.tsx`**

```tsx
import { useOrders } from '../hooks/useOrders';

function fmtPrice(value: number): string {
  return value.toFixed(6);
}

function fmtElapsed(openedAt: number): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - openedAt) / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

export function OrdersView() {
  const { balance, activeOrders, completedCount, totalProfitPct } = useOrders();

  return (
    <div>
      <div className="mb-4 text-sm text-gray-400 font-mono">
        {completedCount} completadas —{' '}
        <span className={totalProfitPct >= 0 ? 'text-green-400' : 'text-red-400'}>
          {totalProfitPct.toFixed(3)}%
        </span>{' '}
        rendimiento — saldo: <span className="text-gray-200">{balance.toFixed(2)} USDT</span>
      </div>

      {activeOrders.length === 0 ? (
        <p className="text-gray-500 text-sm">No active orders.</p>
      ) : (
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
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `frontend/src/App.tsx`**

```tsx
import { useState } from 'react';
import { useSocket } from './hooks/useSocket';
import { ChartGrid } from './components/ChartGrid';
import { OrdersView } from './components/OrdersView';

type Tab = 'charts' | 'orders';

export default function App() {
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
          <p className="text-xs text-gray-500 mt-0.5">Live signal detector — {qualifyingCount} qualifying</p>
        </div>
        <div className={`flex items-center gap-2 text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </header>

      <div className="px-6 pt-4 flex gap-2">
        <button
          onClick={() => setTab('charts')}
          className={`px-3 py-1.5 text-sm rounded ${tab === 'charts' ? 'bg-yellow-400 text-black' : 'bg-gray-900 text-gray-400'}`}
        >
          Charts
        </button>
        <button
          onClick={() => setTab('orders')}
          className={`px-3 py-1.5 text-sm rounded ${tab === 'orders' ? 'bg-yellow-400 text-black' : 'bg-gray-900 text-gray-400'}`}
        >
          Active Orders
        </button>
      </div>

      <main className="px-6 py-6">
        {tab === 'charts' ? <ChartGrid observers={observerList} /> : <OrdersView />}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Verify compilation and build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 0 errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/OrdersView.tsx frontend/src/App.tsx
git commit -m "feat: add tabbed Orders view (active orders, completed count, performance)"
```

---

### Task 17: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: all tests pass — `orderSize.test.ts` (Task 2), `Observer.test.ts` (Task 4, including new quote-volume/current-price tests), `OrderManager.test.ts` (Task 6), plus all pre-existing tests (`indicators.test.ts`, `chartSeries.test.ts`, `signals.test.ts`). 0 failures.

- [ ] **Step 2: Compile both packages**

Run: `cd backend && npx tsc --noEmit && cd ../frontend && npx tsc --noEmit`
Expected: 0 errors in both.

- [ ] **Step 3: Start backend and frontend dev servers, verify in browser**

Use the preview tool to start both `backend` and `frontend` (per `.claude/launch.json`, already configured). Open the frontend preview and confirm:
- The Charts tab is selected by default; the grid renders as before, and each card now shows a footer with Price / Target / Size and either a Buy button or an "Active" indicator.
- Click Buy on a card with a non-zero Size. Confirm: the footer immediately (once the `order:opened` socket event arrives) switches to the "Active" state showing the buy price; the button is gone.
- Switch to the "Active Orders" tab. Confirm the header shows "N completadas — X% rendimiento — saldo: Y USDT" and the just-bought order appears in the table with the correct symbol/buy price/target.
- Check the browser console (`preview_console_logs`) for errors — expect none.
- Check the network tab (`preview_network`) for `POST /api/orders/buy` (expect 200) and `GET /api/orders/sizes?...` (expect periodic 200s, roughly every 5s).
- Full auto-completion (price actually reaching the +0.5% target) may not happen within a short manual session — that behavior is already covered by `OrderManager.test.ts`'s unit tests (Task 6), so this manual check does not need to wait for a real completion; only confirm the *open* flow and the Orders view rendering.

- [ ] **Step 4: Report results to the user**

Summarize: tests passing, both packages compiling clean, and what was observed live in the browser (footer rendering, buy flow, Orders view header and table). Do not claim "done" without having completed Steps 1-3 first.
