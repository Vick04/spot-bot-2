import { Candle } from '../types';
import { BB_PERIOD, bbUpperFromPeriod, calculateMA } from '../utils/bollingerBands';

// Need BB_PERIOD + 1 closed candles to compare two consecutive BBUpper values
const MIN_CLOSED = BB_PERIOD + 1;
const HIGH_THRESHOLD = 0.97;

function validateTimeframe(
  closedCandles: Candle[],
  currentCandle: Candle | null,
  currentPrice: number,
): boolean {
  if (closedCandles.length < MIN_CLOSED || !currentCandle) return false;

  const closes = closedCandles.map(c => c.close);
  const lastClosed = closedCandles[closedCandles.length - 1];

  // Two consecutive BBUpper values to determine rising trend
  const bbUpperCurrent = bbUpperFromPeriod(closes);                          // last 20
  const bbUpperPrev    = bbUpperFromPeriod(closes.slice(0, closes.length - 1)); // 20 before last

  const ma20 = calculateMA(closes, BB_PERIOD);

  // Sub-condition 1: last closed candle must touch BBUpper, open above MA20,
  //                  be a green candle, and BBUpper must be rising
  const bbTouched   = lastClosed.close > bbUpperCurrent || lastClosed.high > bbUpperCurrent;
  const openAboveMA = lastClosed.open > ma20;
  const greenCandle = lastClosed.close > lastClosed.open;
  const bbRising    = bbUpperCurrent > bbUpperPrev;

  if (!bbTouched || !openAboveMA || !greenCandle || !bbRising) return false;

  // Sub-condition 2: current price must be above last closed candle's close
  if (currentPrice <= lastClosed.close) return false;

  // Sub-condition 3: current price must be >= 97% of current candle's high
  if (currentPrice < currentCandle.high * HIGH_THRESHOLD) return false;

  return true;
}

export interface ContextValidatorResult {
  valid: boolean;
  valid1h: boolean;
  valid1d: boolean;
}

export function evaluateContextValidators(
  closedCandles1h: Candle[],
  currentCandle1h: Candle | null,
  closedCandles1d: Candle[],
  currentCandle1d: Candle | null,
  currentPrice: number,
): ContextValidatorResult {
  const valid1h = validateTimeframe(closedCandles1h, currentCandle1h, currentPrice);
  const valid1d = validateTimeframe(closedCandles1d, currentCandle1d, currentPrice);
  return { valid: valid1h && valid1d, valid1h, valid1d };
}
