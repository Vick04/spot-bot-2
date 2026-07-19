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

/** Same 26-candle cold-start-confirms-MAX sequence verified in
 * backend/src/utils/zigzag.test.ts: seed at 110, then 25 candles declining
 * by 0.1 each. The confirming candle is index 20 (0-indexed) -- the first 20
 * candles (indices 0-19) do NOT confirm anything yet. */
function coldStartMaxSequence(startAt: number): Candle[] {
  const closes = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  return closes.map((close, i) => closedCandleAt(startAt + i, close));
}

test('zigzag is at its initial empty state before any candle is loaded', () => {
  const observer = new Observer('BTCUSDT');
  const zigzag = observer.getState().zigzag;
  assert.equal(zigzag.direction, null);
  assert.equal(zigzag.lastPivot, null);
});

test('updateCandle1s never changes zigzag or performance state, only currentPrice', () => {
  const observer = new Observer('BTCUSDT');
  const beforeZigzag = observer.getState().zigzag;
  const beforePerf = observer.getState().performance;
  observer.updateCandle1s({ symbol: 'BTCUSDT', timeframe: '1s', openTime: 1, open: 999999, high: 999999, low: 999999, close: 999999, isClosed: true });
  assert.deepEqual(observer.getState().zigzag, beforeZigzag);
  assert.deepEqual(observer.getState().performance, beforePerf);
  assert.equal(observer.getCurrentPrice(), 999999);
});

test('a live (non-closed) 1m candle does not advance the zigzag state', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m([closedCandleAt(0, 110)]);
  const before = observer.getState().zigzag;
  observer.updateCandle1m(formingCandle(1, 50, 50, 50, 50));
  assert.deepEqual(observer.getState().zigzag, before);
});

test('preloadClosed1m replays the zigzag detector so restart reconstructs true state', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m(coldStartMaxSequence(0));

  const zigzag = observer.getState().zigzag;
  assert.equal(zigzag.direction, 'down');
  assert.deepEqual(zigzag.lastPivot, { price: 110, type: 'max' });
});

test('preloadClosed1h does NOT advance the zigzag detector (the configured timeframe is 1m)', () => {
  const observer = new Observer('BTCUSDT');
  const hourCandles = coldStartMaxSequence(0).map(c => ({ ...c, timeframe: '1h' as const }));
  observer.preloadClosed1h(hourCandles);

  const zigzag = observer.getState().zigzag;
  assert.equal(zigzag.direction, null);
  assert.equal(zigzag.lastPivot, null);
});

test('a live closed 1m candle after preload continues the replayed zigzag state', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1m(coldStartMaxSequence(0));
  assert.equal(observer.getState().zigzag.direction, 'down');
  const extremeBefore = observer.getState().zigzag.extremePrice;

  observer.updateCandle1m(closedCandleAt(26, extremeBefore - 1));

  const zigzag = observer.getState().zigzag;
  assert.equal(zigzag.extremePrice, extremeBefore - 1);
  assert.equal(zigzag.barsSinceExtreme, 0);
});

function closedHourAt(openTime: number, close: number): Candle {
  return { symbol: 'BTCUSDT', timeframe: '1h', openTime, open: close, high: close, low: close, close, isClosed: true };
}

test('performance is all-null before any 1h candle is loaded', () => {
  const observer = new Observer('BTCUSDT');
  assert.deepEqual(observer.getState().performance, { h24: null, h12: null, h6: null, h3: null, h1: null });
});

test('preloadClosed1h computes performance from the preloaded buffer', () => {
  const observer = new Observer('BTCUSDT');
  const closes = Array.from({ length: 25 }, (_, i) => closedHourAt(i, 100 + i));
  observer.preloadClosed1h(closes);

  const performance = observer.getState().performance;
  assert.equal(performance.h24, ((124 - 100) / 100) * 100);
  assert.equal(performance.h1, ((124 - 123) / 123) * 100);
});

test('preloadClosed1h with too few candles leaves performance null for all windows', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1h([closedHourAt(0, 100)]);
  assert.deepEqual(observer.getState().performance, { h24: null, h12: null, h6: null, h3: null, h1: null });
});

test('a closed 1h candle recomputes performance on top of the existing buffer', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1h([closedHourAt(0, 100)]);
  assert.equal(observer.getState().performance.h1, null);

  observer.updateCandle1h(closedHourAt(1, 110));

  const performance = observer.getState().performance;
  assert.equal(performance.h1, ((110 - 100) / 100) * 100);
});

test('a non-closed (forming) 1h candle does not recompute performance', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1h([closedHourAt(0, 100), closedHourAt(1, 110)]);
  const before = observer.getState().performance;

  observer.updateCandle1h({ symbol: 'BTCUSDT', timeframe: '1h', openTime: 2, open: 999, high: 999, low: 999, close: 999, isClosed: false });

  assert.deepEqual(observer.getState().performance, before);
});

test('updateCandle1m does not affect performance (1h-buffer-derived only)', () => {
  const observer = new Observer('BTCUSDT');
  observer.preloadClosed1h([closedHourAt(0, 100), closedHourAt(1, 110)]);
  const before = observer.getState().performance;

  observer.updateCandle1m({ symbol: 'BTCUSDT', timeframe: '1m', openTime: 0, open: 500, high: 500, low: 500, close: 500, isClosed: true });

  assert.deepEqual(observer.getState().performance, before);
});
