import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObserverManager } from './ObserverManager';
import { Candle, ObserverState } from '../types';

function closedCandleAt(openTime: number, close: number): Candle {
  return { symbol: 'BTCUSDT', timeframe: '1m', openTime, open: close, high: close, low: close, close, isClosed: true };
}

/** Same 20-candle window shape as Observer.test.ts's stepWindow: 10 closes
 * at 90, 9 closes at 100, then `last`, with ascending openTime starting at
 * `startAt`. last=70 crosses step1 (<= lower) without reset; a further
 * single close of 100 right after crosses step2 (>= middle) without reset. */
function stepWindow(startAt: number, last: number): Candle[] {
  const closes = Array(10).fill(90).concat(Array(9).fill(100)).concat([last]);
  return closes.map((close, i) => closedCandleAt(startAt + i, close));
}

function listenSignals(manager: ObserverManager): ObserverState[] {
  const signals: ObserverState[] = [];
  manager.on('signal', (state: ObserverState) => signals.push(state));
  return signals;
}

test('a candle close that sets step1 from nothing emits signal', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');
  const signals = listenSignals(manager);

  // Preload the first 19 candles (below the 20-candle window threshold, so
  // the state machine is a no-op) via individual updateCandle calls so the
  // final close goes through updateCandle() (and thus the emit gate).
  const window = stepWindow(0, 70);
  window.slice(0, -1).forEach(c => manager.updateCandle(c));
  assert.equal(signals.length, 0);

  const last = window[window.length - 1];
  manager.updateCandle(last);

  const state = manager.getObserverState('BTCUSDT')!;
  assert.equal(state.reasons.m1.step1, true);
  assert.equal(state.reasons.m1.step2, false);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].reasons.m1.step1, true);
});

test('a candle close that advances step1->step2 (qualifies unchanged) still emits signal', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');

  // Reach step1=true, step2=false first (qualifies already true at this point).
  const window = stepWindow(0, 70);
  window.forEach(c => manager.updateCandle(c));

  const beforeState = manager.getObserverState('BTCUSDT')!;
  assert.equal(beforeState.reasons.m1.step1, true);
  assert.equal(beforeState.reasons.m1.step2, false);
  assert.equal(beforeState.qualifies, true);

  const signals = listenSignals(manager);

  // One more close (openTime 20, close 100) slides the window forward by
  // one and crosses the middle band without crossing the upper band,
  // setting step2 while qualifies stays true throughout.
  manager.updateCandle(closedCandleAt(20, 100));

  const afterState = manager.getObserverState('BTCUSDT')!;
  assert.equal(afterState.reasons.m1.step1, true);
  assert.equal(afterState.reasons.m1.step2, true);
  assert.equal(afterState.qualifies, true);
  assert.equal(afterState.qualifies, beforeState.qualifies); // qualifies did NOT change...

  // ...yet signal must still fire, because reasons changed.
  assert.equal(signals.length, 1);
  assert.equal(signals[0].reasons.m1.step2, true);
});

test('a candle close where nothing changes does not emit signal', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');

  // Reach step1=true, step2=true so the state machine is settled.
  const window = stepWindow(0, 70);
  window.forEach(c => manager.updateCandle(c));
  manager.updateCandle(closedCandleAt(20, 100));

  const settled = manager.getObserverState('BTCUSDT')!;
  assert.equal(settled.reasons.m1.step1, true);
  assert.equal(settled.reasons.m1.step2, true);

  const signals = listenSignals(manager);

  // Another close inside the band (doesn't touch upper, lower, or middle
  // relative to step1/step2's already-true state) leaves reasons unchanged.
  manager.updateCandle(closedCandleAt(21, 100));

  const after = manager.getObserverState('BTCUSDT')!;
  assert.deepEqual(after.reasons, settled.reasons);
  assert.equal(signals.length, 0);
});

test('a closed 1h candle emits signal even when reasons and step state are unchanged', () => {
  const manager = new ObserverManager();
  manager.createObserver('BTCUSDT');
  const signals = listenSignals(manager);

  // A single 1h close: reasons stay {false,false} (below the 20-candle
  // signals window), but performance is recomputed from the 1h buffer on
  // every 1h close, so the broadcast must still fire.
  manager.updateCandle({ symbol: 'BTCUSDT', timeframe: '1h', openTime: 0, open: 100, high: 100, low: 100, close: 100, isClosed: true });

  assert.equal(signals.length, 1);
  assert.deepEqual(signals[0].reasons, { m1: { step1: false, step2: false }, h1: { step1: false, step2: false } });
});

test('a second closed 1h candle also emits, not just the first', () => {
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
