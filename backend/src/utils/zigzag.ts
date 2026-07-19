import { Pivot, ZigZagState } from '../types';

interface ZigZagCandle {
  high: number;
  low: number;
  close: number;
}

export interface ZigZagConfig {
  deviationPct: number;
  minBarsBetweenPivots: number;
  priceSource: 'close' | 'highLow';
}

export const DEFAULT_ZIGZAG_CONFIG: ZigZagConfig = {
  deviationPct: 1,
  minBarsBetweenPivots: 20,
  priceSource: 'close',
};

export const EMPTY_ZIGZAG_STATE: ZigZagState = {
  direction: null,
  pendingHigh: -Infinity,
  pendingHighBars: 0,
  pendingLow: Infinity,
  pendingLowBars: 0,
  extremePrice: 0,
  barsSinceExtreme: 0,
  lastPivot: null,
};

function priceHigh(c: ZigZagCandle, config: ZigZagConfig): number {
  return config.priceSource === 'close' ? c.close : c.high;
}

function priceLow(c: ZigZagCandle, config: ZigZagConfig): number {
  return config.priceSource === 'close' ? c.close : c.low;
}

/** Advances the ZigZag pivot detector by one closed candle. Confirms a
 * sticky pivot (never repaints, never reverts) once price retraces >=
 * config.deviationPct% from the running extreme AND at least
 * config.minBarsBetweenPivots candles have passed since that extreme was
 * last extended. See docs/superpowers/specs/2026-07-09-zigzag-auto-trading-design.md
 * for the full cold-start/normal-operation walkthrough. */
export function nextZigZagState(
  candle: ZigZagCandle,
  prev: ZigZagState,
  config: ZigZagConfig = DEFAULT_ZIGZAG_CONFIG
): ZigZagState {
  const high = priceHigh(candle, config);
  const low = priceLow(candle, config);

  if (prev.direction === null) {
    if (prev.pendingHigh === -Infinity) {
      return { ...prev, pendingHigh: high, pendingLow: low };
    }

    let { pendingHigh, pendingHighBars, pendingLow, pendingLowBars } = prev;
    if (high > pendingHigh) { pendingHigh = high; pendingHighBars = 0; } else { pendingHighBars += 1; }
    if (low < pendingLow) { pendingLow = low; pendingLowBars = 0; } else { pendingLowBars += 1; }

    if ((pendingHigh - low) / pendingHigh * 100 >= config.deviationPct && pendingHighBars >= config.minBarsBetweenPivots) {
      const pivot: Pivot = { price: pendingHigh, type: 'max' };
      return { direction: 'down', pendingHigh, pendingHighBars, pendingLow, pendingLowBars, extremePrice: low, barsSinceExtreme: 0, lastPivot: pivot };
    }
    if ((high - pendingLow) / pendingLow * 100 >= config.deviationPct && pendingLowBars >= config.minBarsBetweenPivots) {
      const pivot: Pivot = { price: pendingLow, type: 'min' };
      return { direction: 'up', pendingHigh, pendingHighBars, pendingLow, pendingLowBars, extremePrice: high, barsSinceExtreme: 0, lastPivot: pivot };
    }
    return { ...prev, pendingHigh, pendingHighBars, pendingLow, pendingLowBars };
  }

  if (prev.direction === 'up') {
    if (high > prev.extremePrice) {
      return { ...prev, extremePrice: high, barsSinceExtreme: 0 };
    }
    if ((prev.extremePrice - low) / prev.extremePrice * 100 >= config.deviationPct && prev.barsSinceExtreme >= config.minBarsBetweenPivots) {
      const pivot: Pivot = { price: prev.extremePrice, type: 'max' };
      return { ...prev, direction: 'down', extremePrice: low, barsSinceExtreme: 0, lastPivot: pivot };
    }
    return { ...prev, barsSinceExtreme: prev.barsSinceExtreme + 1 };
  }

  // prev.direction === 'down'
  if (low < prev.extremePrice) {
    return { ...prev, extremePrice: low, barsSinceExtreme: 0 };
  }
  if ((high - prev.extremePrice) / prev.extremePrice * 100 >= config.deviationPct && prev.barsSinceExtreme >= config.minBarsBetweenPivots) {
    const pivot: Pivot = { price: prev.extremePrice, type: 'min' };
    return { ...prev, direction: 'up', extremePrice: high, barsSinceExtreme: 0, lastPivot: pivot };
  }
  return { ...prev, barsSinceExtreme: prev.barsSinceExtreme + 1 };
}
