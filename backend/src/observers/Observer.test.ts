import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Observer } from './Observer';
import { Candle } from '../types';

function closedCandle(openTime: number, open: number, high: number, low: number, close: number): Candle {
  return { symbol: 'BTCUSDT', timeframe: '1m', openTime, open, high, low, close, isClosed: true };
}

function formingCandle(openTime: number, open: number, high: number, low: number, close: number): Candle {
  return { symbol: 'BTCUSDT', timeframe: '1m', openTime, open, high, low, close, isClosed: false };
}

test('getChartData returns closed candles as-is when there is no forming candle yet', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m([closedCandle(1, 100, 105, 95, 102)]);

  const data = observer.getChartData('1m');
  assert.deepEqual(data, [{ openTime: 1, open: 100, high: 105, low: 95, close: 102 }]);
});

test('getChartData appends the forming candle with high/low widened by the live price', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m([closedCandle(1, 100, 105, 95, 102)]);
  observer.updateCandle1m(formingCandle(2, 103, 106, 101, 103));
  observer.updateCandle1s({ symbol: 'BTCUSDT', timeframe: '1s', openTime: 3, open: 110, high: 110, low: 110, close: 110, isClosed: true });

  const data = observer.getChartData('1m');
  assert.equal(data.length, 2);
  assert.deepEqual(data[1], { openTime: 2, open: 103, high: 110, low: 101, close: 110 });
});

test('getChartData omits the forming point when there is no live price yet', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m([closedCandle(1, 100, 105, 95, 102)]);
  observer.updateCandle1m(formingCandle(2, 103, 106, 101, 103));

  const data = observer.getChartData('1m');
  assert.equal(data.length, 1);
});

test('getChartData returns the 1h buffer independently from the 1m buffer', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m([closedCandle(1, 100, 105, 95, 102)]);
  observer.preloadClosed1h([
    { symbol: 'BTCUSDT', timeframe: '1h', openTime: 10, open: 200, high: 210, low: 190, close: 205, isClosed: true },
  ]);

  assert.equal(observer.getChartData('1m').length, 1);
  assert.equal(observer.getChartData('1m')[0].open, 100);
  assert.equal(observer.getChartData('1h').length, 1);
  assert.equal(observer.getChartData('1h')[0].open, 200);
});

test('get24hQuoteVolume sums preloaded quote volumes', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadQuoteVolume1m([
    { symbol: 'BTCUSDT', timeframe: '1m', openTime: 1, open: 1, high: 1, low: 1, close: 1, isClosed: true, quoteVolume: 100 },
    { symbol: 'BTCUSDT', timeframe: '1m', openTime: 2, open: 1, high: 1, low: 1, close: 1, isClosed: true, quoteVolume: 250 },
  ]);
  assert.equal(observer.get24hQuoteVolume(), 350);
});

test('get24hQuoteVolume treats a missing quoteVolume as 0', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadQuoteVolume1m([
    { symbol: 'BTCUSDT', timeframe: '1m', openTime: 1, open: 1, high: 1, low: 1, close: 1, isClosed: true },
  ]);
  assert.equal(observer.get24hQuoteVolume(), 0);
});

test('a closed 1m candle updates the rolling quote-volume window in real time', () => {
  const observer = new Observer('BTCUSDT');
  observer.updateCandle1m({ symbol: 'BTCUSDT', timeframe: '1m', openTime: 1, open: 1, high: 1, low: 1, close: 1, isClosed: true, quoteVolume: 500 });
  assert.equal(observer.get24hQuoteVolume(), 500);
});

test('getCurrentPrice reflects the latest 1s close, null before any tick', () => {
  const observer = new Observer('BTCUSDT');
  assert.equal(observer.getCurrentPrice(), null);
  observer.updateCandle1s({ symbol: 'BTCUSDT', timeframe: '1s', openTime: 1, open: 10, high: 10, low: 10, close: 12.5, isClosed: true });
  assert.equal(observer.getCurrentPrice(), 12.5);
});

function closedCandleAt(openTime: number, close: number): Candle {
  return { symbol: 'BTCUSDT', timeframe: '1m', openTime, open: close, high: close, low: close, close, isClosed: true };
}

/** 20-candle window: 10 closes at 90, 9 closes at 100, then `last`, with
 * ascending openTime starting at `startAt`. Mirrors the window shape used
 * in signals.test.ts (see that file's comment for why a two-cluster shape
 * is needed): last=70 crosses step1 (<= lower) without reset; a further
 * single close of 100 right after crosses step2 (>= middle) without reset
 * (verified with a throwaway script computing bollingerBands() over the
 * resulting sliding windows). */
function stepWindow(startAt: number, last: number): Candle[] {
  const closes = Array(10).fill(90).concat(Array(9).fill(100)).concat([last]);
  return closes.map((close, i) => closedCandleAt(startAt + i, close));
}

test('updateCandle1s never changes signal state, only currentPrice', () => {
  const observer = new Observer('BTCUSDT');
  const before = observer.getState().reasons;
  observer.updateCandle1s({ symbol: 'BTCUSDT', timeframe: '1s', openTime: 1, open: 999999, high: 999999, low: 999999, close: 999999, isClosed: true });
  assert.deepEqual(observer.getState().reasons, before);
  assert.equal(observer.getCurrentPrice(), 999999);
});

test('a live (non-closed) 1m candle does not advance the 1m state machine', () => {
  const observer = new Observer('BTCUSDT');
  const candles19 = Array.from({ length: 19 }, (_, i) => closedCandleAt(i, 100 + i));
  observer.preloadClosed1m(candles19);
  const before = observer.getState().reasons.m1;
  observer.updateCandle1m(formingCandle(20, 50, 50, 50, 50));
  assert.deepEqual(observer.getState().reasons.m1, before);
});

test('preloadClosed1m replays the state machine so restart reconstructs true state (reaches step1)', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m(stepWindow(0, 70));
  const reasons = observer.getState().reasons;
  assert.equal(reasons.m1.step1, true);
  assert.equal(reasons.m1.step2, false);
  assert.equal(reasons.h1.step1, false);
  assert.equal(observer.getState().qualifies, true);
});

test('preloadClosed1h replays independently from preloadClosed1m', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1h(stepWindow(0, 70));
  const reasons = observer.getState().reasons;
  assert.equal(reasons.h1.step1, true);
  assert.equal(reasons.m1.step1, false);
});

test('a live closed 1m candle after preload continues the replayed state (reaches step2)', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m(stepWindow(0, 70));
  assert.equal(observer.getState().reasons.m1.step1, true);

  // One more close (openTime 20, close 100) slides the 20-window forward
  // by one and crosses the middle band without crossing the upper band.
  observer.updateCandle1m(closedCandleAt(20, 100));

  const reasons = observer.getState().reasons;
  assert.equal(reasons.m1.step1, true);
  assert.equal(reasons.m1.step2, true);
});
