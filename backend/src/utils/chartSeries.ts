import { ChartSeries } from '../types';
import { sma, bollingerBands } from './indicators';

const MA20_WINDOW = 20;
const MA99_WINDOW = 99;

/** For each index i, computes MA20/MA99/bbUpper/bbLower over the trailing
 * window ending at i (inclusive). null until enough history exists for
 * that window. Output arrays are the same length as `closes`, index-aligned. */
export function computeChartSeries(closes: number[]): ChartSeries {
  const n = closes.length;
  const ma20: (number | null)[] = new Array(n).fill(null);
  const ma99: (number | null)[] = new Array(n).fill(null);
  const bbUpper: (number | null)[] = new Array(n).fill(null);
  const bbLower: (number | null)[] = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (i + 1 >= MA20_WINDOW) {
      const window20 = closes.slice(i + 1 - MA20_WINDOW, i + 1);
      const bands = bollingerBands(window20);
      ma20[i] = bands.middle;
      bbUpper[i] = bands.upper;
      bbLower[i] = bands.lower;
    }
    if (i + 1 >= MA99_WINDOW) {
      ma99[i] = sma(closes.slice(i + 1 - MA99_WINDOW, i + 1));
    }
  }

  return { ma20, ma99, bbUpper, bbLower };
}
