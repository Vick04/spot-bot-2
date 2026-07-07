import { SignalReasons } from '../types';
import { bollingerUpper } from './indicators';

export interface SignalResult {
  qualifies: boolean;
  reasons: SignalReasons;
}

interface CandleOC {
  open: number;
  close: number;
}

/** 19 closed candles + the live price = a 20-value Bollinger window. */
const CLOSED_WINDOW = 19;

/** True when the live price exceeds the Bollinger upper band recomputed with
 * the live price standing in as the 20th (most recent) value. */
function bbUpperCondition(price: number, closed: CandleOC[]): boolean {
  if (closed.length < CLOSED_WINDOW) return false;
  const closes = closed.slice(-CLOSED_WINDOW).map(c => c.close);
  return price > bollingerUpper([...closes, price]);
}

export function detectSignal(
  price: number,
  closed1m: CandleOC[],
  closed1h: CandleOC[],
): SignalResult {
  const reasons: SignalReasons = {
    bbUpper1m: bbUpperCondition(price, closed1m),
    bbUpper1h: bbUpperCondition(price, closed1h),
  };

  return {
    qualifies: reasons.bbUpper1m || reasons.bbUpper1h,
    reasons,
  };
}
