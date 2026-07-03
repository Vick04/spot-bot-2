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

const MA99_PERIOD = 99;
const MA20_PERIOD = 20;

/**
 * 1h entry gate: given the last up-to-99 closed 1h closes (ascending), the gate
 * is open when the most recent close sits above both its MA99 and MA20 and below
 * its upper Bollinger band. Requires a full 99-close window; otherwise closed.
 */
export function hourGateOpen(closes: number[]): boolean {
  if (closes.length < MA99_PERIOD) return false;

  const window99 = closes.slice(-MA99_PERIOD);
  const window20 = closes.slice(-MA20_PERIOD);
  const last = window99[window99.length - 1];

  const ma99 = sma(window99);
  const ma20 = sma(window20);
  const bbUpper = bollingerUpper(window20);

  return last > ma99 && last > ma20 && last < bbUpper;
}
