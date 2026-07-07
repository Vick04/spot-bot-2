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
