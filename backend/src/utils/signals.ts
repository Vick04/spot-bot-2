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

/** True when the in-formation candle and the 2 closed candles before it are all positive. */
function threePositiveCondition(price: number, formOpen: number | null, closed: CandleOC[]): boolean {
  if (formOpen === null || closed.length < 2) return false;
  if (!(price > formOpen)) return false;
  const [prev2, prev1] = closed.slice(-2);
  return prev1.close > prev1.open && prev2.close > prev2.open;
}

export function detectSignal(
  price: number,
  closed1m: CandleOC[],
  form1mOpen: number | null,
  closed1h: CandleOC[],
  form1hOpen: number | null,
): SignalResult {
  const reasons: SignalReasons = {
    bbUpper1m: bbUpperCondition(price, closed1m),
    bbUpper1h: bbUpperCondition(price, closed1h),
    threePositive1m: threePositiveCondition(price, form1mOpen, closed1m),
    threePositive1h: threePositiveCondition(price, form1hOpen, closed1h),
  };

  return {
    qualifies: reasons.bbUpper1m || reasons.bbUpper1h || reasons.threePositive1m || reasons.threePositive1h,
    reasons,
  };
}
