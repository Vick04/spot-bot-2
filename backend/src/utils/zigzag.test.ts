import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextZigZagState, EMPTY_ZIGZAG_STATE, DEFAULT_ZIGZAG_CONFIG } from './zigzag';

function closeCandle(close: number) {
  return { high: close, low: close, close };
}

test('the very first candle seeds both pending candidates, direction stays null', () => {
  const state = nextZigZagState(closeCandle(110), EMPTY_ZIGZAG_STATE);
  assert.equal(state.direction, null);
  assert.equal(state.pendingHigh, 110);
  assert.equal(state.pendingLow, 110);
  assert.equal(state.lastPivot, null);
});

test('cold start confirms a MAX pivot once the price retraces >= 1% AND >= 20 bars have passed since the peak', () => {
  const closes = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  let state = EMPTY_ZIGZAG_STATE;
  closes.forEach(c => { state = nextZigZagState(closeCandle(c), state); });

  assert.equal(state.direction, 'down');
  assert.deepEqual(state.lastPivot, { price: 110, type: 'max' });
});

test('cold start confirms a MIN pivot symmetrically', () => {
  const closes = [90, ...Array.from({ length: 25 }, (_, k) => +(90 + 0.1 * (k + 1)).toFixed(2))];
  let state = EMPTY_ZIGZAG_STATE;
  closes.forEach(c => { state = nextZigZagState(closeCandle(c), state); });

  assert.equal(state.direction, 'up');
  assert.deepEqual(state.lastPivot, { price: 90, type: 'min' });
});

test('no confirmation before 20 bars even once the 1% deviation is already exceeded', () => {
  const closes = [110, ...Array.from({ length: 15 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  let state = EMPTY_ZIGZAG_STATE;
  closes.forEach(c => { state = nextZigZagState(closeCandle(c), state); });

  // After 16 candles (15 bars since the peak), deviation is already 1.364% --
  // past the 1% threshold -- but bars (15) < minBarsBetweenPivots (20), so no
  // pivot yet.
  assert.equal(state.direction, null);
  assert.equal(state.lastPivot, null);
  assert.equal(state.pendingHighBars, 15);
});

test('a new extreme mid-decline resets the bar counter, delaying confirmation and using the new extreme', () => {
  const declinePart = Array.from({ length: 10 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2));
  const bounce = [111]; // a new high -- resets pendingHighBars to 0
  const declinePart2 = Array.from({ length: 25 }, (_, k) => +(111 - 0.1 * (k + 1)).toFixed(2));
  const closes = [110, ...declinePart, ...bounce, ...declinePart2];

  let state = EMPTY_ZIGZAG_STATE;
  closes.forEach(c => { state = nextZigZagState(closeCandle(c), state); });

  // Confirms using 111 (the post-bounce high), not the original 110.
  assert.deepEqual(state.lastPivot, { price: 111, type: 'max' });
});

test('normal operation (post-cold-start) extends the extreme without confirming while price keeps making new lows', () => {
  const closes = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  let state = EMPTY_ZIGZAG_STATE;
  closes.forEach(c => { state = nextZigZagState(closeCandle(c), state); });
  assert.equal(state.direction, 'down'); // cold start confirmed a MAX, direction flipped

  const extended = nextZigZagState(closeCandle(state.extremePrice - 1), state);
  assert.equal(extended.direction, 'down');
  assert.deepEqual(extended.lastPivot, state.lastPivot);
  assert.equal(extended.extremePrice, state.extremePrice - 1);
  assert.equal(extended.barsSinceExtreme, 0);
});

test('normal operation confirms the next pivot and flips direction again', () => {
  const closes = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  let state = EMPTY_ZIGZAG_STATE;
  closes.forEach(c => { state = nextZigZagState(closeCandle(c), state); });
  // state.direction === 'down', state.extremePrice === 107.5 (last close)

  const continued = Array.from({ length: 5 }, (_, k) => +(107.5 - 0.1 * (k + 1)).toFixed(2)); // 5 more new lows
  const rise = Array.from({ length: 25 }, (_, k) => +(107.0 + 0.1 * (k + 1)).toFixed(2)); // then a rise
  [...continued, ...rise].forEach(c => { state = nextZigZagState(closeCandle(c), state); });

  assert.equal(state.direction, 'up');
  assert.deepEqual(state.lastPivot, { price: 107, type: 'min' });
});

test('lastPivot is sticky -- a candle that neither extends nor confirms leaves it unchanged', () => {
  const closes = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  let state = EMPTY_ZIGZAG_STATE;
  closes.forEach(c => { state = nextZigZagState(closeCandle(c), state); });
  const pivotBefore = state.lastPivot;

  const after = nextZigZagState(closeCandle(state.extremePrice), state); // exactly at the extreme: not a new low, not enough retrace
  assert.equal(after.lastPivot, pivotBefore); // same object reference, not just equal value
});

test('highLow price source uses the candle high/low, ignoring a constant close', () => {
  const config = { ...DEFAULT_ZIGZAG_CONFIG, priceSource: 'highLow' as const };
  const seed = { high: 110, low: 108, close: 109 };
  const rest = Array.from({ length: 25 }, (_, k) => ({ high: 110, low: +(110 - 0.1 * (k + 1)).toFixed(2), close: 109 }));

  let state = EMPTY_ZIGZAG_STATE;
  [seed, ...rest].forEach(c => { state = nextZigZagState(c, state, config); });

  // Every close was a constant 109 -- confirmation only happens because
  // highLow mode reads high/low, proving `close` was ignored.
  assert.equal(state.direction, 'down');
  assert.deepEqual(state.lastPivot, { price: 110, type: 'max' });
});
