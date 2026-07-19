import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readSymbolCandles } from './csvCandleSource';

function writeFixture(historyDir: string, symbol: string, timeframe: string, rows: string[]): void {
  const dir = path.join(historyDir, symbol);
  fs.mkdirSync(dir, { recursive: true });
  const content = ['open_time,open,high,low,close,ma20,ma99,bb_up,bb_down,quote_volume', ...rows].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, `${symbol}_${timeframe}.csv`), content, 'utf-8');
}

function tempHistoryDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'csvCandleSource-test-'));
}

test('reads candles from a CSV, skipping the header', () => {
  const dir = tempHistoryDir();
  writeFixture(dir, 'BTCUSDT', '1m', [
    '1000,100,105,95,102,,,,,500',
    '1060,102,106,101,103,,,,,600',
  ]);

  const candles = Array.from(readSymbolCandles(dir, 'BTCUSDT', '1m'));
  assert.equal(candles.length, 2);
  assert.deepEqual(candles[0], { symbol: 'BTCUSDT', timeframe: '1m', openTime: 1000, open: 100, high: 105, low: 95, close: 102, isClosed: true });
  assert.deepEqual(candles[1], { symbol: 'BTCUSDT', timeframe: '1m', openTime: 1060, open: 102, high: 106, low: 101, close: 103, isClosed: true });
});

test('respects the limit parameter', () => {
  const dir = tempHistoryDir();
  writeFixture(dir, 'BTCUSDT', '1m', [
    '1000,100,105,95,102,,,,,500',
    '1060,102,106,101,103,,,,,600',
    '1120,103,107,102,104,,,,,700',
  ]);

  const candles = Array.from(readSymbolCandles(dir, 'BTCUSDT', '1m', 2));
  assert.equal(candles.length, 2);
});

test('skips a malformed row without throwing', () => {
  const dir = tempHistoryDir();
  writeFixture(dir, 'BTCUSDT', '1m', [
    '1000,100,105,95,102,,,,,500',
    'not,a,valid,row',
    '1120,103,107,102,104,,,,,700',
  ]);

  const candles = Array.from(readSymbolCandles(dir, 'BTCUSDT', '1m'));
  assert.equal(candles.length, 2);
  assert.equal(candles[0].openTime, 1000);
  assert.equal(candles[1].openTime, 1120);
});

test('reads across chunk boundaries correctly (large file spanning multiple 1MB reads)', () => {
  const dir = tempHistoryDir();
  const rows = Array.from({ length: 50_000 }, (_, i) => `${1000 + i * 60},100,105,95,102,,,,,500`);
  writeFixture(dir, 'BTCUSDT', '1m', rows);

  const candles = Array.from(readSymbolCandles(dir, 'BTCUSDT', '1m'));
  assert.equal(candles.length, 50_000);
  assert.equal(candles[0].openTime, 1000);
  assert.equal(candles[49_999].openTime, 1000 + 49_999 * 60);
});

test('reads the final line even without a trailing newline', () => {
  const dir = tempHistoryDir();
  const symbolDir = path.join(dir, 'BTCUSDT');
  fs.mkdirSync(symbolDir, { recursive: true });
  fs.writeFileSync(
    path.join(symbolDir, 'BTCUSDT_1m.csv'),
    'open_time,open,high,low,close,ma20,ma99,bb_up,bb_down,quote_volume\n1000,100,105,95,102,,,,,500',
    'utf-8'
  ); // no trailing newline

  const candles = Array.from(readSymbolCandles(dir, 'BTCUSDT', '1m'));
  assert.equal(candles.length, 1);
  assert.equal(candles[0].openTime, 1000);
});
