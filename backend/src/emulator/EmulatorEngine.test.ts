import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EmulatorEngine } from './EmulatorEngine';
import { DEFAULT_ZIGZAG_CONFIG } from '../utils/zigzag';

function writeFixture(historyDir: string, symbol: string, timeframe: string, closes: number[]): void {
  const dir = path.join(historyDir, symbol);
  fs.mkdirSync(dir, { recursive: true });
  const rows = closes.map((close, i) => `${i * 60000},${close},${close},${close},${close},,,,,100`);
  const content = ['open_time,open,high,low,close,ma20,ma99,bb_up,bb_down,quote_volume', ...rows].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, `${symbol}_${timeframe}.csv`), content, 'utf-8');
}

function tempHistoryDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'EmulatorEngine-test-'));
}

/** 81-candle sequence, independently verified against the real ZigZag
 * algorithm (backend/src/utils/zigzag.ts) via a throwaway script before
 * writing this test: confirms MAX(110) at index 20 (no active order yet,
 * sellAtPrice no-ops), MIN(107) at index 51 (triggers a BUY at that
 * candle's own close, 109.1 -- NOT the stale pivot price 107), MAX(109.5)
 * at index 76 (triggers a SELL at that candle's own close, 107.4 -- NOT
 * the stale pivot price 109.5), completing exactly one round-trip trade. */
function buildCloses(): number[] {
  const seq1 = [110, ...Array.from({ length: 25 }, (_, k) => +(110 - 0.1 * (k + 1)).toFixed(2))];
  const continued = Array.from({ length: 5 }, (_, k) => +(107.5 - 0.1 * (k + 1)).toFixed(2));
  const rise = Array.from({ length: 25 }, (_, k) => +(107.0 + 0.1 * (k + 1)).toFixed(2));
  const declineB = Array.from({ length: 25 }, (_, k) => +(109.5 - 0.1 * (k + 1)).toFixed(2));
  return [...seq1, ...continued, ...rise, ...declineB];
}

test('runs a full sequence, executing at current price (not the stale pivot price), completing one round trip', () => {
  const dir = tempHistoryDir();
  const closes = buildCloses();
  writeFixture(dir, 'BTCUSDT', '1m', closes);

  const engine = new EmulatorEngine();
  const result = engine.run({
    historyDir: dir,
    symbols: ['BTCUSDT'],
    timeframe: '1m',
    zigzagConfig: DEFAULT_ZIGZAG_CONFIG,
  });

  assert.equal(result.candlesProcessed, 81);
  assert.equal(result.firstCandleTime, 0);
  assert.equal(result.lastCandleTime, 80 * 60000);
  assert.equal(result.initialBalance, 10_000);
  assert.equal(result.discardedOpenOrders, 0);
  assert.equal(result.trades.length, 1);

  const trade = result.trades[0];
  assert.equal(trade.symbol, 'BTCUSDT');
  assert.equal(trade.buyPivotPrice, 107.0); // min pivot price (the actual low)
  assert.equal(trade.buyPivotTime, 30 * 60000); // when the min occurred
  assert.equal(trade.buyPrice, 109.1); // execution price at the MIN pivot's confirmation candle
  assert.equal(trade.buyTime, 51 * 60000); // when the order was placed
  assert.ok(Math.abs(trade.buySlippagePct - 1.96) < 0.1, `expected buySlippagePct ~1.96, got ${trade.buySlippagePct}`); // (109.1 - 107.0) / 107.0 * 100

  assert.equal(trade.sellPivotPrice, 109.5); // max pivot price (the actual high after the min)
  assert.equal(trade.sellPivotTime, 55 * 60000); // when the max occurred (candle 55)
  assert.equal(trade.sellPrice, 107.4); // execution price at the MAX pivot's confirmation candle
  assert.equal(trade.sellTime, 76 * 60000); // when the order was placed
  assert.ok(Math.abs(trade.sellSlippagePct - (-1.92)) < 0.1, `expected sellSlippagePct ~-1.92, got ${trade.sellSlippagePct}`); // (107.4 - 109.5) / 109.5 * 100

  assert.equal(trade.durationMs, 25 * 60000);
  assert.ok(trade.profitPct < 0, `expected a loss (price dropped from buy to sell), got ${trade.profitPct}`);

  assert.ok(result.finalBalance < result.initialBalance);
  assert.ok(result.maxDrawdownPct > 0);
});

test('an order still open at the end of the data is discarded, not counted as a trade', () => {
  const dir = tempHistoryDir();
  const closes = buildCloses().slice(0, 60); // stops well after the BUY (idx51) but before the SELL (idx76)
  writeFixture(dir, 'BTCUSDT', '1m', closes);

  const engine = new EmulatorEngine();
  const result = engine.run({
    historyDir: dir,
    symbols: ['BTCUSDT'],
    timeframe: '1m',
    zigzagConfig: DEFAULT_ZIGZAG_CONFIG,
  });

  assert.equal(result.candlesProcessed, 60);
  assert.equal(result.trades.length, 0);
  assert.equal(result.discardedOpenOrders, 1);
  assert.ok(result.finalBalance < result.initialBalance); // balance deducted by the open buy, not refunded
});

test('a custom zigzagConfig changes ZigZag behavior (proves the option reaches Observer)', () => {
  const dir = tempHistoryDir();
  const decline = Array.from({ length: 15 }, (_, k) => +(110 - 0.2 * (k + 1)).toFixed(2));
  const rise = Array.from({ length: 15 }, (_, k) => +(107 + 0.2 * (k + 1)).toFixed(2));
  const closes = [110, ...decline, ...rise]; // 31 candles
  writeFixture(dir, 'BTCUSDT', '1m', closes);

  const engine = new EmulatorEngine();

  const withDefault = engine.run({
    historyDir: dir, symbols: ['BTCUSDT'], timeframe: '1m', zigzagConfig: DEFAULT_ZIGZAG_CONFIG,
  });
  // Default minBarsBetweenPivots=20: only the first MAX confirms (idx20)
  // within these 31 candles -- nothing to sell yet, so no position ever opens.
  assert.equal(withDefault.trades.length, 0);
  assert.equal(withDefault.discardedOpenOrders, 0);

  const withCustom = engine.run({
    historyDir: dir, symbols: ['BTCUSDT'], timeframe: '1m',
    zigzagConfig: { deviationPct: 1, minBarsBetweenPivots: 2, priceSource: 'close' },
  });
  // With a much smaller bar-gap requirement, BOTH a MAX (idx6) and a
  // subsequent MIN (idx21, opening a position) confirm within the same 31
  // candles -- the position never gets a chance to close, so it's discarded.
  assert.equal(withCustom.trades.length, 0);
  assert.equal(withCustom.discardedOpenOrders, 1);
});

test('respects limitPerSymbol', () => {
  const dir = tempHistoryDir();
  writeFixture(dir, 'BTCUSDT', '1m', buildCloses());

  const engine = new EmulatorEngine();
  const result = engine.run({
    historyDir: dir,
    symbols: ['BTCUSDT'],
    timeframe: '1m',
    zigzagConfig: DEFAULT_ZIGZAG_CONFIG,
    limitPerSymbol: 10,
  });

  assert.equal(result.candlesProcessed, 10);
});
