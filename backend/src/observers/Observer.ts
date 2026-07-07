import { Candle, ChartCandle, ChartTimeframe, ObserverState } from '../types';
import { Queue } from '../utils/Queue';
import { detectSignal, SignalResult } from '../utils/signals';

/** 200 closed candles per timeframe: enough for a 100-candle visible chart
 * window with a full 99-candle MA99 lookback at the first visible point,
 * plus margin. Also backs live signal detection, which only reads the tail
 * (last 19/2 — see utils/signals.ts) regardless of total buffer size, so
 * this size increase does not change detection behavior. */
const CHART_HISTORY_CANDLES = 200;

const EMPTY_SIGNAL: SignalResult = {
  qualifies: false,
  reasons: { bbUpper1m: false, bbUpper1h: false, threePositive1m: false, threePositive1h: false },
};

export class Observer {
  private symbol: string;
  private closed1m: Queue<Candle>;
  private closed1h: Queue<Candle>;
  private form1mCandle: Candle | null = null;
  private form1hCandle: Candle | null = null;
  private currentPrice: number | null = null;
  private signal: SignalResult = EMPTY_SIGNAL;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.closed1m = new Queue<Candle>(CHART_HISTORY_CANDLES);
    this.closed1h = new Queue<Candle>(CHART_HISTORY_CANDLES);
  }

  preloadClosed1m(candles: Candle[]): void {
    candles.forEach(c => this.closed1m.push(c));
  }

  preloadClosed1h(candles: Candle[]): void {
    candles.forEach(c => this.closed1h.push(c));
  }

  updateCandle1s(candle: Candle): void {
    this.currentPrice = candle.close;
    this.recompute();
  }

  updateCandle1m(candle: Candle): void {
    if (candle.isClosed) {
      this.closed1m.push(candle);
      this.form1mCandle = null;
    } else {
      this.form1mCandle = candle;
    }
    this.recompute();
  }

  updateCandle1h(candle: Candle): void {
    if (candle.isClosed) {
      this.closed1h.push(candle);
      this.form1hCandle = null;
    } else {
      this.form1hCandle = candle;
    }
    this.recompute();
  }

  getState(): ObserverState {
    return { symbol: this.symbol, qualifies: this.signal.qualifies, reasons: this.signal.reasons };
  }

  /** Closed candles for `timeframe` plus the live in-formation candle (if
   * any), as plain OHLC points. The forming candle's high/low are widened
   * by the current live price so the chart never shows a contradictory bar. */
  getChartData(timeframe: ChartTimeframe): ChartCandle[] {
    const closed = timeframe === '1m' ? this.closed1m.toArray() : this.closed1h.toArray();
    const formCandle = timeframe === '1m' ? this.form1mCandle : this.form1hCandle;

    const candles: ChartCandle[] = closed.map(c => ({
      openTime: c.openTime,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    if (formCandle !== null && this.currentPrice !== null) {
      candles.push({
        openTime: formCandle.openTime,
        open: formCandle.open,
        high: Math.max(formCandle.high, this.currentPrice),
        low: Math.min(formCandle.low, this.currentPrice),
        close: this.currentPrice,
      });
    }

    return candles;
  }

  private recompute(): void {
    if (this.currentPrice === null) return;
    this.signal = detectSignal(
      this.currentPrice,
      this.closed1m.toArray(),
      this.form1mCandle?.open ?? null,
      this.closed1h.toArray(),
      this.form1hCandle?.open ?? null,
    );
  }
}
