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
