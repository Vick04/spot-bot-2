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
