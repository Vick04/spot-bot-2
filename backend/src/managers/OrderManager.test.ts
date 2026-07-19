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
