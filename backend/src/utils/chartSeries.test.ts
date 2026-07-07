import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeChartSeries } from './chartSeries';
import { sma, bollingerBands } from './indicators';

test('ma20/bbUpper/bbLower are null before 20 closes have accumulated', () => {
  const closes = Array.from({ length: 19 }, (_, i) => 100 + i);
  const series = computeChartSeries(closes);
  assert.equal(series.ma20[18], null);
  assert.equal(series.bbUpper[18], null);
  assert.equal(series.bbLower[18], null);
});

test('ma99 is null before 99 closes have accumulated', () => {
  const closes = Array.from({ length: 98 }, (_, i) => 100 + i);
  const series = computeChartSeries(closes);
  assert.equal(series.ma99[97], null);
});

test('ma20/bbUpper/bbLower match the indicators.ts oracle once 20 closes are available', () => {
  const closes = Array.from({ length: 25 }, (_, i) => 100 + i * (i % 3 === 0 ? 2 : 1));
  const series = computeChartSeries(closes);

  for (let i = 19; i < closes.length; i++) {
    const window = closes.slice(i - 19, i + 1);
    const expectedBands = bollingerBands(window);
    assert.equal(series.ma20[i], sma(window));
    assert.equal(series.bbUpper[i], expectedBands.upper);
    assert.equal(series.bbLower[i], expectedBands.lower);
  }
});

test('ma99 matches the indicators.ts oracle once 99 closes are available', () => {
  const closes = Array.from({ length: 105 }, (_, i) => 100 + Math.sin(i) * 5);
  const series = computeChartSeries(closes);

  for (let i = 98; i < closes.length; i++) {
    const window = closes.slice(i - 98, i + 1);
    assert.equal(series.ma99[i], sma(window));
  }
});

test('output arrays are index-aligned and the same length as the input', () => {
  const closes = Array.from({ length: 150 }, (_, i) => 100 + i);
  const series = computeChartSeries(closes);
  assert.equal(series.ma20.length, closes.length);
  assert.equal(series.ma99.length, closes.length);
  assert.equal(series.bbUpper.length, closes.length);
  assert.equal(series.bbLower.length, closes.length);
});
