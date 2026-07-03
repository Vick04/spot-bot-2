import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrderManager } from './OrderManager';

function enabledManager(): OrderManager {
  const om = new OrderManager(() => 0);
  om.setEnabled(true);
  return om;
}

// The stop-loss percentage (STOP_LOSS_MULT) is a strategy knob that gets tuned,
// so these tests exercise the mechanism relative to the order's own
// stopLossPrice rather than hard-coding a percentage.

test('sells when price reaches the stop loss price', () => {
  const om = enabledManager();
  om.buy('BTCUSDT', 100);
  const stop = om.getActiveOrder()!.stopLossPrice;

  om.onPriceTick('BTCUSDT', stop);
  assert.equal(om.hasActiveOrder(), false);
  assert.equal(om.getHistory().length, 1);
  assert.equal(om.getHistory()[0].sellPrice, stop);
});

test('sells when price drops below the stop loss price', () => {
  const om = enabledManager();
  om.buy('BTCUSDT', 100);
  const stop = om.getActiveOrder()!.stopLossPrice;

  om.onPriceTick('BTCUSDT', stop / 2);
  assert.equal(om.hasActiveOrder(), false);
});

test('holds when price is just above the stop and below the target', () => {
  const om = enabledManager();
  om.buy('BTCUSDT', 100);
  const order = om.getActiveOrder()!;
  const midpoint = (order.stopLossPrice + order.targetPrice) / 2;

  om.onPriceTick('BTCUSDT', midpoint);
  assert.equal(om.hasActiveOrder(), true);
  assert.equal(om.getHistory().length, 0);
});

test('takes profit at the target', () => {
  const om = enabledManager();
  om.buy('BTCUSDT', 100);
  const target = om.getActiveOrder()!.targetPrice;

  om.onPriceTick('BTCUSDT', target);
  assert.equal(om.hasActiveOrder(), false);
  assert.equal(om.getHistory()[0].sellPrice, target);
});

test('stop loss only triggers for the active order symbol', () => {
  const om = enabledManager();
  om.buy('BTCUSDT', 100);

  om.onPriceTick('ETHUSDT', 0); // different symbol → ignored
  assert.equal(om.hasActiveOrder(), true);
});
