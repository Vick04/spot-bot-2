import { BollingerCandle, BreakoutSignal } from '../types';

/**
 * Observe-only squeeze→breakout detector for the 1m timeframe.
 *
 * It does NOT trade. On each closed 1m candle it runs a state machine:
 *   ARMED (recent squeeze) → OPEN (upward break w/ trend+direction) → WIN/FAIL/FLAT
 * Each signal self-labels its outcome (target hit = WIN, fell back below the
 * middle band = FAIL = a failed breakout, timeout = FLAT), so running it live
 * accumulates labeled wins AND failures with no risk, to calibrate thresholds.
 *
 * Thresholds come from analysis of 5 BTC 1h breakouts seen on the 1m timeframe.
 */
export interface DetectorParams {
  squeezeMaxBbw: number;     // bbWidth below this = "loaded" (squeeze)
  squeezeLookback: number;   // breakout must follow a squeeze within N bars
  trendSlopeLookback: number;// ma20 must be rising vs N bars ago
  minPosition: number;       // (close-mid)/(upper-mid) must exceed this (direction)
  targetPct: number;         // profit target, e.g. 0.003 = +0.3%
  maxHold: number;           // max bars to hold before FLAT (0 = no timeout)
  maxOpensPerHour: number;   // max OPENs allowed per 1h candle (0 = no limit)
  stopPct: number;           // adverse % from entry that triggers FAIL (0 = no stop)
}

export const DEFAULT_PARAMS: DetectorParams = {
  squeezeMaxBbw: 0.5,
  squeezeLookback: 1,
  trendSlopeLookback: 3,
  minPosition: 0.45,
  targetPct: 0.003,
  maxHold: 0,
  maxOpensPerHour: 0,
  stopPct: 0,
};

const HOUR_MS = 3600000;

let seq = 0;

export class SqueezeBreakoutDetector {
  private symbol: string;
  private p: DetectorParams;
  private candles: BollingerCandle[] = []; // closed 1m candles with indicators
  private open: BreakoutSignal | null = null;
  private resolved: BreakoutSignal[] = [];
  private hourBucket = -1;     // current 1h bucket (openTime / HOUR_MS)
  private opensThisHour = 0;
  private blockedUntilSqueeze = false; // after a WIN, no OPEN until a fresh squeeze appears

  constructor(symbol: string, params: DetectorParams = DEFAULT_PARAMS) {
    this.symbol = symbol;
    this.p = params;
  }

  getOpen(): BreakoutSignal | null { return this.open; }
  getResolved(): BreakoutSignal[] { return this.resolved; }
  isBlocked(): boolean { return this.blockedUntilSqueeze; }

  /** Feed the latest CLOSED 1m candle (already carries indicators). */
  onClosedCandle(c: BollingerCandle): BreakoutSignal[] {
    const emitted: BreakoutSignal[] = [];
    if (c.ma20 == null || c.ma99 == null || c.bbUpper == null || c.bbMiddle == null || c.bbWidth == null) {
      return emitted; // indicators not ready (warming up)
    }
    this.candles.push(c);
    if (this.candles.length > 200) this.candles.shift();

    // reset the per-1h-candle open counter when entering a new hour bucket
    const bucket = Math.floor(c.openTime / HOUR_MS);
    if (bucket !== this.hourBucket) { this.hourBucket = bucket; this.opensThisHour = 0; }

    // a fresh squeeze candle clears the post-WIN block
    if (c.bbWidth != null && c.bbWidth < this.p.squeezeMaxBbw) this.blockedUntilSqueeze = false;

    if (this.open) {
      const done = this.updateOpen(c);
      if (done) emitted.push(done);
      return emitted; // one signal at a time per symbol
    }

    if (this.blockedUntilSqueeze) return emitted;          // wait for a fresh squeeze after a WIN

    if (this.p.maxOpensPerHour > 0 && this.opensThisHour >= this.p.maxOpensPerHour) {
      return emitted; // hit the per-hour open limit
    }

    const sig = this.tryEnter(c);
    if (sig) { this.open = sig; this.opensThisHour++; emitted.push(sig); }
    return emitted;
  }

  private position(c: BollingerCandle): number {
    const span = (c.bbUpper! - c.bbMiddle!);
    return span !== 0 ? (c.close - c.bbMiddle!) / span : 0;
  }

  private tryEnter(c: BollingerCandle): BreakoutSignal | null {
    const n = this.candles.length;
    if (n < this.p.trendSlopeLookback + 2) return null;

    const prev = this.candles[n - 2];
    if (prev.bbUpper == null || prev.ma20 == null) return null;

    // recent squeeze within lookback (exclude current bar)
    const lb = this.candles.slice(Math.max(0, n - 1 - this.p.squeezeLookback), n - 1);
    const squeezeVals = lb.map(x => x.bbWidth).filter((v): v is number => v != null);
    const recentSqueeze = squeezeVals.some(v => v < this.p.squeezeMaxBbw);
    if (!recentSqueeze) return null;

    const ma20Past = this.candles[n - 1 - this.p.trendSlopeLookback].ma20;
    if (ma20Past == null) return null;
    const slope = c.ma20! - ma20Past;

    const breakout = c.close > prev.bbUpper;        // directional: above prior upper band
    const trend = c.ma20! > c.ma99! && slope > 0;   // MA20>MA99 and rising
    const pos = this.position(c);
    const direction = pos > this.p.minPosition;     // riding the upper band

    if (!(breakout && trend && direction)) return null;

    return {
      id: `${this.symbol}-${++seq}`,
      symbol: this.symbol,
      state: 'OPEN',
      entryTime: c.openTime,
      entryPrice: c.close,
      squeezeBbw: Math.min(...squeezeVals),
      entryBbw: c.bbWidth!,
      bbUpperAtEntry: c.bbUpper!,
      ma20: c.ma20!,
      ma99: c.ma99!,
      ma20Slope: slope,
      position: pos,
      target: c.close * (1 + this.p.targetPct),
      peakBbw: c.bbWidth!,
      minutesToPeak: 0,
      mfePct: 0,
      maePct: 0,
      exitTime: null,
      exitPrice: null,
      outcomePct: null,
      barsHeld: 0,
    };
  }

  /** Update the open signal with a new closed candle; returns it if resolved. */
  private updateOpen(c: BollingerCandle): BreakoutSignal | null {
    const s = this.open!;
    s.barsHeld++;

    const favor = (c.high - s.entryPrice) / s.entryPrice * 100;
    const adverse = (c.low - s.entryPrice) / s.entryPrice * 100;
    if (favor > s.mfePct) s.mfePct = favor;
    if (adverse < s.maePct) s.maePct = adverse;
    if (c.bbWidth != null && c.bbWidth > s.peakBbw) {
      s.peakBbw = c.bbWidth;
      s.minutesToPeak = s.barsHeld;
    }

    const resolve = (state: BreakoutSignal['state']) => {
      s.state = state;
      s.exitTime = c.openTime;
      s.exitPrice = c.close;
      s.outcomePct = (c.close - s.entryPrice) / s.entryPrice * 100;
      this.resolved.push(s);
      this.open = null;
      // after a WIN, block new OPENs until a fresh squeeze candle appears
      if (state === 'WIN') this.blockedUntilSqueeze = true;
      return s;
    };

    if (c.high >= s.target) return resolve('WIN');
    if (this.p.stopPct > 0 && c.close <= s.entryPrice * (1 - this.p.stopPct / 100)) return resolve('FAIL');
    if (this.p.maxHold > 0 && s.barsHeld >= this.p.maxHold) return resolve('FLAT');
    return null;
  }
}
