import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HourCandleCursor } from './hourCandleCursor';
import { Candle } from '../types';

const HOUR = 3_600_000;

function hourCandle(symbol: string, openTime: number, open: number, close: number): Candle {
  return { symbol, timeframe: '1h', openTime, open, high: Math.max(open, close), low: Math.min(open, close), close, isClosed: true };
}

function factoryFrom(candlesBySymbol: Record<string, Candle[]>) {
  return (symbol: string) => (candlesBySymbol[symbol] ?? [])[Symbol.iterator]();
}

test('returns nothing until the first candle has closed', () => {
  const c0 = hourCandle('BTCUSDT', 0, 100, 90);
  const cursor = new HourCandleCursor(factoryFrom({ BTCUSDT: [c0] }));

  assert.deepEqual(cursor.advanceClosed('BTCUSDT', HOUR - 1), []);
  assert.deepEqual(cursor.advanceClosed('BTCUSDT', HOUR), [c0]);
});

test('does not return the same candle twice', () => {
  const c0 = hourCandle('BTCUSDT', 0, 100, 90);
  const cursor = new HourCandleCursor(factoryFrom({ BTCUSDT: [c0] }));

  assert.deepEqual(cursor.advanceClosed('BTCUSDT', HOUR), [c0]);
  assert.deepEqual(cursor.advanceClosed('BTCUSDT', HOUR * 5), []);
});

test('returns multiple candles that closed since the last call, in order', () => {
  const c0 = hourCandle('BTCUSDT', 0, 100, 90);
  const c1 = hourCandle('BTCUSDT', HOUR, 90, 95);
  const c2 = hourCandle('BTCUSDT', HOUR * 2, 95, 80);
  const cursor = new HourCandleCursor(factoryFrom({ BTCUSDT: [c0, c1, c2] }));

  assert.deepEqual(cursor.advanceClosed('BTCUSDT', HOUR * 3), [c0, c1, c2]);
});

test('tracks cursors independently per symbol', () => {
  const b0 = hourCandle('BTCUSDT', 0, 100, 90);
  const e0 = hourCandle('ETHUSDT', 0, 50, 60);
  const cursor = new HourCandleCursor(factoryFrom({ BTCUSDT: [b0], ETHUSDT: [e0] }));

  assert.deepEqual(cursor.advanceClosed('BTCUSDT', HOUR), [b0]);
  assert.deepEqual(cursor.advanceClosed('ETHUSDT', HOUR), [e0]);
});

test('unknown symbol yields nothing', () => {
  const cursor = new HourCandleCursor(factoryFrom({}));
  assert.deepEqual(cursor.advanceClosed('NOPEUSDT', HOUR * 10), []);
});
