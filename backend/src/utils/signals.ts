import { TimeframeSignal } from '../types';
import { bollingerBands } from './indicators';

interface CandleOC {
  open: number;
  close: number;
}

const WINDOW = 20;

export const EMPTY_TIMEFRAME_SIGNAL: TimeframeSignal = { step1: false, step2: false };

/** Advances one timeframe's sticky step1/step2 state using the trailing
 * WINDOW closed candles (last element is the just-closed candle, itself
 * included in the Bollinger/SMA window). Fewer than WINDOW candles is a
 * no-op — returns prev unchanged.
 *
 * Reset (close >= upper band) is checked first and wins over step1/step2
 * on the same close. Otherwise: step1 sets on close <= lower band (only if
 * not already true); step2 sets on close >= middle band, but only once
 * step1 is already true. */
export function nextTimeframeSignal(closed: CandleOC[], prev: TimeframeSignal): TimeframeSignal {
  if (closed.length < WINDOW) return prev;

  const window = closed.slice(-WINDOW).map(c => c.close);
  const { upper, lower, middle } = bollingerBands(window);
  const lastClose = closed[closed.length - 1].close;

  if (lastClose >= upper) {
    return { step1: false, step2: false };
  }

  let { step1, step2 } = prev;
  if (!step1 && lastClose <= lower) step1 = true;
  if (step1 && !step2 && lastClose >= middle) step2 = true;
  return { step1, step2 };
}
