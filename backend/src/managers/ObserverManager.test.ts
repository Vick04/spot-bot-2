import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObserverManager } from './ObserverManager';
import { Candle, ObserverState } from '../types';

function closedCandleAt(openTime: number, close: number): Candle {
  return { symbol: 'BTCUSDT', timeframe: '1m', openTime, open: close, high: close, low: close, close, isClosed: true };
}

/** Same 26-candle cold-start-confirms-MAX sequence verified in
 * backend/src/utils/zigzag.test.ts and backend/src/observers/Observer.test.ts:
 * seed at 110, then 25 candles declining by 0.1 each. The confirming candle
 * is index 20 (0-indexed) -- indices 0-19 do NOT confirm anything yet. */
function coldStartMaxSequence(startAt: number): Candle[] {
  const closes = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  return closes.map((close, i) => closedCandleAt(startAt + i, close));
}

function listenSignals(manager: ObserverManager): ObserverState[] {
  const signals: ObserverState[] = [];
  manager.on('signal', (state: ObserverState) => signals.push(state));
  return signals;
}

function listenPivots(manager: ObserverManager): Array<{ symbol: string; type: string; price: number }> {
  const pivots: Array<{ symbol: string; type: string; price: number }> = [];
  manager.on('pivot', (p: { symbol: string; type: string; price: number }) => pivots.push(p));
  return pivots;
}

test('candles before confirmation emit neither signal nor pivot', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');
  const signals = listenSignals(manager);
  const pivots = listenPivots(manager);

  const sequence = coldStartMaxSequence(0);
  sequence.slice(0, 20).forEach(c => manager.updateCandle(c)); // up to (not including) the confirming candle

  assert.equal(signals.length, 0);
  assert.equal(pivots.length, 0);
});

test('the candle that confirms a pivot emits both signal and pivot', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');

  const sequence = coldStartMaxSequence(0);
  sequence.slice(0, 20).forEach(c => manager.updateCandle(c));

  const signals = listenSignals(manager);
  const pivots = listenPivots(manager);

  manager.updateCandle(sequence[20]); // the confirming candle

  assert.equal(signals.length, 1);
  assert.deepEqual(signals[0].zigzag.lastPivot, { price: 110, type: 'max' });

  assert.equal(pivots.length, 1);
  assert.deepEqual(pivots[0], { symbol: 'BTCUSDT', type: 'max', price: 110 });
});

test('a further candle that does not confirm a new pivot emits neither event again', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');
  coldStartMaxSequence(0).forEach(c => manager.updateCandle(c)); // full sequence, already confirmed

  const signals = listenSignals(manager);
  const pivots = listenPivots(manager);

  const state = manager.getObserverState('BTCUSDT')!;
  manager.updateCandle(closedCandleAt(26, state.zigzag.extremePrice)); // exactly at the extreme -- extends, doesn't confirm

  assert.equal(signals.length, 0);
  assert.equal(pivots.length, 0);
});

test('a closed 1h candle emits signal even when zigzag does not change (performance-only update)', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');
  const signals = listenSignals(manager);

  manager.updateCandle({ symbol: 'BTCUSDT', timeframe: '1h', openTime: 0, open: 100, high: 100, low: 100, close: 100, isClosed: true });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].zigzag.direction, null); // 1h close doesn't touch zigzag (configured timeframe is 1m)
});

test('a second closed 1h candle also emits, carrying the updated performance', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');
  manager.updateCandle({ symbol: 'BTCUSDT', timeframe: '1h', openTime: 0, open: 100, high: 100, low: 100, close: 100, isClosed: true });

  const signals = listenSignals(manager);
  manager.updateCandle({ symbol: 'BTCUSDT', timeframe: '1h', openTime: 1, open: 110, high: 110, low: 110, close: 110, isClosed: true });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].performance.h1, ((110 - 100) / 100) * 100);
});

test('a non-closed (forming) 1h candle does not emit on its own', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');
  const signals = listenSignals(manager);

  manager.updateCandle({ symbol: 'BTCUSDT', timeframe: '1h', openTime: 0, open: 100, high: 100, low: 100, close: 100, isClosed: false });

  assert.equal(signals.length, 0);
});

test('chart:closed fires even for a symbol that has never confirmed a pivot (no qualification gate anymore)', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');

  const chartClosedEvents: unknown[] = [];
  manager.on('chart:closed', payload => chartClosedEvents.push(payload));

  // A single closed 1m candle: nowhere near enough history for any zigzag
  // pivot, yet chart:closed must still fire -- charts are no longer gated
  // on a qualification concept this feature removed entirely.
  manager.updateCandle(closedCandleAt(0, 100));

  assert.equal(chartClosedEvents.length, 1);
});
