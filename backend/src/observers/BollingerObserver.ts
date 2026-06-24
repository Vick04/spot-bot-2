import { BollingerCandle, BollingerObserverState } from '../types';
import { sma, bollinger } from '../utils/indicators';

const MA20_PERIOD = 20;
const MA99_PERIOD = 99;
const BB_PERIOD = 20;
const BB_MULT = 2;
const HISTORY_LIMIT = 100; // how many closed candles we expose to the client

/** Raw 1h OHLC candle, without indicators. */
export interface RawCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Tracks one symbol's 1h candles and computes MA20, MA99 and Bollinger Bands.
 *
 * - Closed candles are stored with the indicator values they had at close.
 * - The current (open) candle's indicators are recomputed on every tick using
 *   the last N-1 closed closes plus the live close, exactly how Binance shows
 *   the indicators moving on the forming candle.
 */
export class BollingerObserver {
  private symbol: string;
  private closed: BollingerCandle[] = []; // every closed candle we know about
  private closedCloses: number[] = [];    // parallel array of closes for fast math
  private currentRaw: RawCandle | null = null;

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  /** Load historical closed candles (oldest first) and compute their indicators. */
  preload(rawCandles: RawCandle[]): void {
    for (const raw of rawCandles) {
      this.appendClosed(raw);
    }
  }

  /** Update the currently forming (open) 1h candle. */
  updateCurrent(raw: RawCandle): void {
    this.currentRaw = raw;
  }

  /** Finalize the open candle: move it into the closed history. */
  closeCurrent(raw: RawCandle): void {
    this.appendClosed(raw);
    this.currentRaw = null;
  }

  isReady(): boolean {
    return this.closedCloses.length >= MA99_PERIOD;
  }

  getState(): BollingerObserverState {
    return {
      symbol: this.symbol,
      history: this.closed.slice(-HISTORY_LIMIT),
      current: this.getCurrentCandle(),
      isReady: this.isReady(),
    };
  }

  /** Compute indicators for the live open candle from closed closes + live close. */
  private getCurrentCandle(): BollingerCandle | null {
    if (!this.currentRaw) return null;
    const closes = [...this.closedCloses, this.currentRaw.close];
    return this.buildCandle(this.currentRaw, false, closes);
  }

  private appendClosed(raw: RawCandle): void {
    this.closedCloses.push(raw.close);
    const candle = this.buildCandle(raw, true, this.closedCloses);
    this.closed.push(candle);
  }

  /** Build a BollingerCandle, computing indicators over the given closes array. */
  private buildCandle(raw: RawCandle, isClosed: boolean, closes: number[]): BollingerCandle {
    const ma20 = sma(closes, MA20_PERIOD);
    const ma99 = sma(closes, MA99_PERIOD);
    const bb = bollinger(closes, BB_PERIOD, BB_MULT);

    return {
      symbol: this.symbol,
      openTime: raw.openTime,
      open: raw.open,
      high: raw.high,
      low: raw.low,
      close: raw.close,
      isClosed,
      ma20,
      ma99,
      bbMiddle: bb?.middle ?? null,
      bbUpper: bb?.upper ?? null,
      bbLower: bb?.lower ?? null,
      bbWidth: bb?.width ?? null,
    };
  }
}
