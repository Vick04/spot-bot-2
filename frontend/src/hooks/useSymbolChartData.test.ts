import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeChartPoint, VISIBLE_CANDLES } from './useSymbolChartData';
import { ChartCandle, ChartSeries, ChartSeriesPoint } from '../types';

function makeCandle(openTime: number): ChartCandle {
  return { openTime, open: 1, high: 2, low: 0.5, close: 1.5 };
}

function makeSeriesPoint(): ChartSeriesPoint {
  return { ma20: 1, ma99: 1, bbUpper: 2, bbLower: 0 };
}

function emptySeries(): ChartSeries {
  return { ma20: [], ma99: [], bbUpper: [], bbLower: [] };
}

function stateFromCandles(candles: ChartCandle[]): { candles: ChartCandle[]; series: ChartSeries } {
  const series: ChartSeries = {
    ma20: candles.map(() => 1),
    ma99: candles.map(() => 1),
    bbUpper: candles.map(() => 2),
    bbLower: candles.map(() => 0),
  };
  return { candles, series };
}

test('a tick with a newer openTime appends and does not drop the previous point', () => {
  const s = stateFromCandles([makeCandle(1000), makeCandle(2000)]);
  const result = mergeChartPoint(s, { candle: makeCandle(3000), series: makeSeriesPoint() });
  assert.deepEqual(
    result.candles.map(c => c.openTime),
    [1000, 2000, 3000]
  );
});

test('a tick with the same openTime as the last point replaces it', () => {
  const s = stateFromCandles([makeCandle(1000), makeCandle(2000)]);
  const updatedCandle: ChartCandle = { openTime: 2000, open: 1, high: 99, low: 0.5, close: 50 };
  const result = mergeChartPoint(s, { candle: updatedCandle, series: makeSeriesPoint() });
  assert.deepEqual(
    result.candles.map(c => c.openTime),
    [1000, 2000]
  );
  assert.equal(result.candles[1].high, 99);
});

test('a closed event with a newer openTime appends', () => {
  const s = stateFromCandles([makeCandle(1000)]);
  const result = mergeChartPoint(s, { candle: makeCandle(2000), series: makeSeriesPoint() });
  assert.deepEqual(
    result.candles.map(c => c.openTime),
    [1000, 2000]
  );
});

test('a closed event with the same openTime as the last point (tick-then-closed race) replaces it rather than duplicating', () => {
  const s = stateFromCandles([makeCandle(1000), makeCandle(2000)]);
  const closedCandle: ChartCandle = { openTime: 2000, open: 1, high: 5, low: 0.9, close: 4 };
  const result = mergeChartPoint(s, { candle: closedCandle, series: makeSeriesPoint() });
  assert.equal(result.candles.length, 2);
  assert.deepEqual(
    result.candles.map(c => c.openTime),
    [1000, 2000]
  );
  assert.equal(result.candles[1].close, 4);
});

test('the result never exceeds VISIBLE_CANDLES length regardless of how many merges are applied', () => {
  const totalPushed = VISIBLE_CANDLES + 200;
  let s: { candles: ChartCandle[]; series: ChartSeries } = { candles: [], series: emptySeries() };
  for (let i = 0; i < totalPushed; i++) {
    s = mergeChartPoint(s, { candle: makeCandle(i * 1000), series: makeSeriesPoint() });
  }
  assert.equal(s.candles.length, VISIBLE_CANDLES);
  assert.equal(s.series.ma20.length, VISIBLE_CANDLES);
  assert.equal(s.series.ma99.length, VISIBLE_CANDLES);
  assert.equal(s.series.bbUpper.length, VISIBLE_CANDLES);
  assert.equal(s.series.bbLower.length, VISIBLE_CANDLES);
  // Should hold the most recent VISIBLE_CANDLES openTimes.
  const firstKeptIndex = totalPushed - VISIBLE_CANDLES;
  assert.equal(s.candles[0].openTime, firstKeptIndex * 1000);
  assert.equal(s.candles[VISIBLE_CANDLES - 1].openTime, (totalPushed - 1) * 1000);
});

test('regression: close candle T, then tick for T+1 results in [..., T, T+1], not [..., T+1] alone', () => {
  // Simulate a window that already contains candle T as the last (closed) element.
  let s = stateFromCandles([makeCandle(1000), makeCandle(2000)]); // T = 2000

  // First tick for the newly forming T+1 candle arrives.
  const tPlus1First: ChartCandle = { openTime: 3000, open: 10, high: 10, low: 10, close: 10 };
  s = mergeChartPoint(s, { candle: tPlus1First, series: makeSeriesPoint() });

  assert.deepEqual(
    s.candles.map(c => c.openTime),
    [1000, 2000, 3000],
    'candle T (2000) must still be present after the first tick of T+1 arrives'
  );
});
