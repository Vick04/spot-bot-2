import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReport } from './reportWriter';
import { EmulatorResult } from './EmulatorEngine';
import { DEFAULT_ZIGZAG_CONFIG } from '../utils/zigzag';

function baseResult(overrides: Partial<EmulatorResult> = {}): EmulatorResult {
  return {
    options: { historyDir: 'history', symbols: ['BTCUSDT'], timeframe: '1m', zigzagConfig: DEFAULT_ZIGZAG_CONFIG },
    candlesProcessed: 100,
    firstCandleTime: 0,
    lastCandleTime: 6_000_000,
    initialBalance: 10_000,
    finalBalance: 10_000,
    trades: [],
    discardedOpenOrders: 0,
    maxDrawdownPct: 0,
    ...overrides,
  };
}

test('includes the configuration section with exact zigzag parameters', () => {
  const report = formatReport(baseResult());
  assert.ok(report.includes('Timeframe: 1m'));
  assert.ok(report.includes('Deviation: 1%'));
  assert.ok(report.includes('Min bars between pivots: 20'));
  assert.ok(report.includes('Price source: close'));
  assert.ok(report.includes('Candles processed: 100'));
});

test('reports zero trades with a placeholder instead of an empty table', () => {
  const report = formatReport(baseResult());
  assert.ok(report.includes('Completed trades: 0'));
  assert.ok(report.includes('_No completed trades._'));
});

test('computes win rate, average profit, and total return from the trades array', () => {
  const report = formatReport(baseResult({
    finalBalance: 11_000,
    trades: [
      { symbol: 'BTCUSDT', buyPrice: 100, buyTime: 0, sellPrice: 105, sellTime: 60_000, profitPct: 4.9, durationMs: 60_000 },
      { symbol: 'BTCUSDT', buyPrice: 100, buyTime: 120_000, sellPrice: 95, sellTime: 180_000, profitPct: -5.1, durationMs: 60_000 },
    ],
  }));

  assert.ok(report.includes('Completed trades: 2'));
  assert.ok(report.includes('Win rate: 50.0% (1 wins / 1 losses)'));
  assert.ok(report.includes('Total return: +10.00%'));
});

test('renders one table row per trade with formatted price/time/duration', () => {
  const report = formatReport(baseResult({
    trades: [
      { symbol: 'BTCUSDT', buyPrice: 61234.5, buyTime: 0, sellPrice: 62000, sellTime: 3_600_000, profitPct: 1.25, durationMs: 3_600_000 },
    ],
  }));

  assert.ok(report.includes('61234.500000'));
  assert.ok(report.includes('62000.000000'));
  assert.ok(report.includes('+1.25%'));
  assert.ok(report.includes('1h'));
});

test('shows the discarded-open-orders count', () => {
  const report = formatReport(baseResult({ discardedOpenOrders: 1 }));
  assert.ok(report.includes('Discarded (still open at end of data): 1'));
});
