/**
 * Technical indicator helpers.
 * All functions compute the indicator value for the LAST element of `closes`,
 * matching how Binance renders the most recent candle on its chart.
 *
 * Bollinger Bands use population standard deviation (divide by period), which
 * is what Binance/TradingView use for BOLL(20, 2).
 */

export interface BollingerBands {
  middle: number;
  upper: number;
  lower: number;
  width: number; // upper - lower
}

/** Simple Moving Average over the last `period` closes. */
export function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((acc, v) => acc + v, 0) / period;
}

/** Bollinger Bands over the last `period` closes with `mult` standard deviations. */
export function bollinger(closes: number[], period: number, mult: number): BollingerBands | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((acc, v) => acc + v, 0) / period;
  const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
  const stddev = Math.sqrt(variance);
  const upper = mean + mult * stddev;
  const lower = mean - mult * stddev;
  return { middle: mean, upper, lower, width: upper - lower };
}
