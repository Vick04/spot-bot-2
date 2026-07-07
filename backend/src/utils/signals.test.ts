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

  const result = detectSignal(price, CLOSED_19, []);
  assert.equal(result.reasons.bbUpper1m, true);
  assert.equal(result.qualifies, true);
});

test('bbUpper1m is false when live price sits inside the recomputed live band', () => {
  const price = 100.001; // near the bottom of an increasing sequence's band
  const result = detectSignal(price, CLOSED_19, []);
  assert.equal(result.reasons.bbUpper1m, false);
});

test('the live band recomputes per tick — same closed candles, different price flips the result', () => {
  const low = detectSignal(100.001, CLOSED_19, []);
  const high = detectSignal(500, CLOSED_19, []);
  assert.equal(low.reasons.bbUpper1m, false);
  assert.equal(high.reasons.bbUpper1m, true);
});

test('bbUpper1m is false with fewer than 19 closed candles, regardless of price', () => {
  const result = detectSignal(1_000_000, CLOSED_18, []);
  assert.equal(result.reasons.bbUpper1m, false);
});

test('bbUpper1h mirrors bbUpper1m independently using the 1h series', () => {
  const result = detectSignal(100.001, [], CLOSED_19);
  assert.equal(result.reasons.bbUpper1m, false);
  assert.equal(result.reasons.bbUpper1h, false);

  const result2 = detectSignal(500, [], CLOSED_19);
  assert.equal(result2.reasons.bbUpper1h, true);
});

test('qualifies is the OR of both reasons — false when neither holds, true when exactly one holds', () => {
  const none = detectSignal(100.001, CLOSED_19, CLOSED_19);
  assert.equal(none.qualifies, false);

  const onlyOne = detectSignal(500, CLOSED_19, []);
  assert.equal(onlyOne.reasons.bbUpper1m, true);
  assert.equal(onlyOne.reasons.bbUpper1h, false);
  assert.equal(onlyOne.qualifies, true);
});
