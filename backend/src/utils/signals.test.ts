import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTimeframeSignal, EMPTY_TIMEFRAME_SIGNAL } from './signals';

function candle(close: number) {
  return { open: close, close };
}

/** 20-candle window: 10 closes at 90, 9 closes at 100, then `last`. Two
 * clusters give the band enough width that `last` can land strictly
 * between the middle and upper bands (unlike a flat baseline + single
 * outlier, where any deviation large enough to cross the middle band also
 * breaches the upper band, making step2-without-reset unreachable). Exact
 * band values for each `last` used below were verified with a throwaway
 * script computing bollingerBands() over these exact arrays:
 *   last=70  -> step1 crosses (<= lower), step2 doesn't, no reset
 *   last=90  -> inside the band (no step1, no step2, no reset)
 *   last=100 -> step2 crosses (>= middle), no reset
 *   last=108 -> step2 crosses AND reset crosses (>= upper) simultaneously
 *   last=110 -> reset crosses (>= upper) */
function window(last: number): { open: number; close: number }[] {
  return Array(10).fill(90).concat(Array(9).fill(100)).concat([last]).map(candle);
}

test('below WINDOW candles is a no-op, returns prev unchanged', () => {
  const nineteen = window(70).slice(0, 19);
  const prev = { step1: true, step2: true };
  const result = nextTimeframeSignal(nineteen, prev);
  assert.deepEqual(result, prev);
});

test('step1 sets when the closed candle is <= the lower band, from empty state', () => {
  const result = nextTimeframeSignal(window(70), EMPTY_TIMEFRAME_SIGNAL);
  assert.equal(result.step1, true);
  assert.equal(result.step2, false);
});

test('step1 does not set when the closed candle sits inside the band', () => {
  const result = nextTimeframeSignal(window(90), EMPTY_TIMEFRAME_SIGNAL);
  assert.equal(result.step1, false);
});

test('step2 requires step1 already true — a mid-band close with step1 false stays false', () => {
  const result = nextTimeframeSignal(window(100), { step1: false, step2: false });
  assert.equal(result.step2, false);
});

test('step2 sets when step1 is true and the closed candle is >= the middle band', () => {
  const result = nextTimeframeSignal(window(100), { step1: true, step2: false });
  assert.equal(result.step1, true);
  assert.equal(result.step2, true);
});

test('step2 does not set when step1 is true but the close stays below the middle band', () => {
  const result = nextTimeframeSignal(window(90), { step1: true, step2: false });
  assert.equal(result.step2, false);
});

test('reset clears both steps when the closed candle is >= the upper band', () => {
  const result = nextTimeframeSignal(window(110), { step1: true, step2: true });
  assert.deepEqual(result, { step1: false, step2: false });
});

test('reset wins even if the same close would also satisfy the step2 condition', () => {
  // last=108 crosses both the middle band (step2-eligible) and the upper
  // band (reset-eligible) at once — reset must take priority.
  const result = nextTimeframeSignal(window(108), { step1: true, step2: false });
  assert.deepEqual(result, { step1: false, step2: false });
});

test('once step2 is true, further mid-band closes leave state unchanged', () => {
  const result = nextTimeframeSignal(window(90), { step1: true, step2: true });
  assert.deepEqual(result, { step1: true, step2: true });
});

test('after reset, a subsequent drop can re-enter step1 independently', () => {
  const resetResult = nextTimeframeSignal(window(110), { step1: true, step2: true });
  assert.deepEqual(resetResult, { step1: false, step2: false });
  const reentered = nextTimeframeSignal(window(70), resetResult);
  assert.equal(reentered.step1, true);
});
