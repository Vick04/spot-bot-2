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

/** Upper Bollinger band: sma(last20) + 2 * populationStdDev(last20). */
export function bollingerUpper(last20: number[]): number {
  const mean = sma(last20);
  let variance = 0;
  for (const v of last20) {
    const d = v - mean;
    variance += d * d;
  }
  variance /= last20.length;
  return mean + 2 * Math.sqrt(variance);
}
