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
