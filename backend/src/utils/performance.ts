import { PerformanceWindows } from '../types';

interface CandleClose {
  close: number;
}

const WINDOWS: { key: keyof PerformanceWindows; hours: number }[] = [
  { key: 'h24', hours: 24 },
  { key: 'h12', hours: 12 },
  { key: 'h6', hours: 6 },
  { key: 'h3', hours: 3 },
  { key: 'h1', hours: 1 },
];

/** Percentage change from N hours ago to the most recent closed 1h candle,
 * for each of the 24/12/6/3/1-hour windows — closed candles only, never a
 * live price. A window is null until the buffer holds more than `hours`
 * candles (need both the current and the N-hours-ago endpoint). */
export function computePerformance(closed1h: CandleClose[]): PerformanceWindows {
  const result = {} as PerformanceWindows;
  const len = closed1h.length;
  for (const { key, hours } of WINDOWS) {
    if (len <= hours) {
      result[key] = null;
      continue;
    }
    const current = closed1h[len - 1].close;
    const past = closed1h[len - 1 - hours].close;
    result[key] = ((current - past) / past) * 100;
  }
  return result;
}
