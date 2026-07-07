/**
 * Indicator helpers matching scripts/download-history.js exactly, so values
 * computed live are identical to the precomputed columns in the history CSVs.
 * Bollinger uses the POPULATION standard deviation (divide by N, not N-1).
 */

/** Simple moving average over the given closes (caller passes the exact window). */
export function sma(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export interface BollingerBands {
  middle: number;
  upper: number;
  lower: number;
}

/** Bollinger bands: sma(values) ± 2 * populationStdDev(values). */
export function bollingerBands(values: number[]): BollingerBands {
  const mean = sma(values);
  let variance = 0;
  for (const v of values) {
    const d = v - mean;
    variance += d * d;
  }
  variance /= values.length;
  const stddev = Math.sqrt(variance);
  return { middle: mean, upper: mean + 2 * stddev, lower: mean - 2 * stddev };
}

/** Upper Bollinger band: sma(last20) + 2 * populationStdDev(last20). */
export function bollingerUpper(last20: number[]): number {
  return bollingerBands(last20).upper;
}
