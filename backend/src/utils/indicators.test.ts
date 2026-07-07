import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, bollingerUpper } from './indicators';

// Real window from history/BTCUSDT/BTCUSDT_1h.csv (row i=200): the 99 closes
// ending at that candle, and the indicators the generator (download-history.js)
// wrote for that row. Validates our formula matches the precomputed CSV data.
const CLOSES_99 = [
  108125.63, 108270.82, 108053.46, 108029.97, 108078.06, 108085.23, 108112.21, 108148.57, 108125.99, 108193.23,
  108058, 108101.99, 108090.08, 108010, 108141.78, 108096.75, 108090, 108188.47, 108198.12, 108206.99,
  108218.25, 108060.02, 108050.49, 107989.11, 108003.35, 108121.98, 108040.31, 108005.27, 107850.01, 107990.93,
  108076.01, 108232.99, 108772.17, 108933.25, 108905.99, 108856.92, 108919.22, 108463.99, 108538.46, 108665.47,
  109208.25, 109228.73, 109203.84, 108823.07, 109019.13, 109364.52, 109389.47, 109128.73, 109079.99, 108774.5,
  109061.08, 109011.7, 108849.06, 108664.14, 108642.01, 108346.85, 108536.84, 108223.14, 108292.59, 107976.91,
  107943.15, 108024.53, 108056.68, 107886.85, 108166.95, 108019.23, 108262.94, 108299.99, 107705.03, 107766.2,
  107901.52, 108019.24, 108210.94, 108299.72, 108484.61, 108262.36, 108469.99, 108832.77, 108756.37, 108949.19,
  109034.61, 108376, 108268.35, 108439.37, 108991, 109147.56, 108771.88, 108630.54, 108889.9, 108917.01,
  108922.98, 108940.39, 108780.76, 108611.53, 108376.41, 108553.61, 108778.1, 108840.01, 108714.39,
];

const EXPECTED_MA20 = 108746.6794999999;
const EXPECTED_MA99 = 108446.7348484849;
const EXPECTED_BB_UP = 109224.5393113034;

function approx(actual: number, expected: number, rel = 1e-9): void {
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= Math.abs(expected) * rel, `expected ~${expected}, got ${actual} (diff ${diff})`);
}

test('sma over 99 closes matches CSV ma99', () => {
  approx(sma(CLOSES_99), EXPECTED_MA99);
});

test('sma over last 20 closes matches CSV ma20', () => {
  approx(sma(CLOSES_99.slice(-20)), EXPECTED_MA20);
});

test('bollingerUpper over last 20 closes matches CSV bb_up', () => {
  approx(bollingerUpper(CLOSES_99.slice(-20)), EXPECTED_BB_UP);
});
