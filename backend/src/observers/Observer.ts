import { Candle, ChartCandle, ChartTimeframe, ObserverState, SignalReasons, TimeframeSignal } from '../types';
import { Queue } from '../utils/Queue';
import { nextTimeframeSignal, EMPTY_TIMEFRAME_SIGNAL } from '../utils/signals';

/** 200 closed candles per timeframe: enough for a 100-candle visible chart
 * window with a full 99-candle MA99 lookback at the first visible point,
 * plus margin. Also backs signal detection, which only reads the tail (last
 * 20 — see utils/signals.ts) regardless of total buffer size, so this size
 * increase does not change detection behavior. */
const CHART_HISTORY_CANDLES = 200;

/** 1 quote-volume value per closed 1m candle, covering a rolling 24h window
 * (60 * 24 = 1440 minutes), used for liquidity-based order sizing. */
const QUOTE_VOLUME_WINDOW = 1440;

export class Observer {
  private symbol: string;
  private closed1m: Queue<Candle>;
  private closed1h: Queue<Candle>;
  private quoteVol1m: Queue<number>;
  private quoteVolSum = 0;
  private form1mCandle: Candle | null = null;
  private form1hCandle: Candle | null = null;
  private currentPrice: number | null = null;
  private m1Signal: TimeframeSignal = EMPTY_TIMEFRAME_SIGNAL;
  private h1Signal: TimeframeSignal = EMPTY_TIMEFRAME_SIGNAL;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.closed1m = new Queue<Candle>(CHART_HISTORY_CANDLES);
    this.closed1h = new Queue<Candle>(CHART_HISTORY_CANDLES);
    this.quoteVol1m = new Queue<number>(QUOTE_VOLUME_WINDOW);
  }

  /** Pushes each candle into the chart buffer AND replays it through the
   * 1m state machine in order, so a freshly started observer (fed ~200
   * historical candles) reconstructs the same step1/step2 state a
   * continuously-running observer would have reached — not a blank slate. */
  preloadClosed1m(candles: Candle[]): void {
    candles.forEach(c => {
      this.closed1m.push(c);
      this.m1Signal = nextTimeframeSignal(this.closed1m.toArray(), this.m1Signal);
    });
  }

  /** Same replay behavior as preloadClosed1m, for the 1h state machine. */
  preloadClosed1h(candles: Candle[]): void {
    candles.forEach(c => {
      this.closed1h.push(c);
      this.h1Signal = nextTimeframeSignal(this.closed1h.toArray(), this.h1Signal);
    });
  }

  /** Feeds the 24h rolling quote-volume window without touching the chart
   * buffer — callers typically pass a longer history here than to
   * preloadClosed1m (e.g. 1440 candles vs. 200). */
  preloadQuoteVolume1m(candles: Candle[]): void {
    candles.forEach(c => this.pushQuoteVolume(c.quoteVolume ?? 0));
  }

  updateCandle1s(candle: Candle): void {
    this.currentPrice = candle.close;
  }

  updateCandle1m(candle: Candle): void {
    if (candle.isClosed) {
      this.closed1m.push(candle);
      this.pushQuoteVolume(candle.quoteVolume ?? 0);
      this.form1mCandle = null;
      this.m1Signal = nextTimeframeSignal(this.closed1m.toArray(), this.m1Signal);
    } else {
      this.form1mCandle = candle;
    }
  }

  updateCandle1h(candle: Candle): void {
    if (candle.isClosed) {
      this.closed1h.push(candle);
      this.form1hCandle = null;
      this.h1Signal = nextTimeframeSignal(this.closed1h.toArray(), this.h1Signal);
    } else {
      this.form1hCandle = candle;
    }
  }

  getState(): ObserverState {
    const reasons: SignalReasons = { m1: this.m1Signal, h1: this.h1Signal };
    const qualifies = reasons.m1.step1 || reasons.m1.step2 || reasons.h1.step1 || reasons.h1.step2;
    return { symbol: this.symbol, qualifies, reasons };
  }

  /** Sum of the last (up to) 1440 closed 1m candles' quote volume. Below a
   * full window, this underestimates the true 24h volume — self-corrects
   * as live data accumulates. */
  get24hQuoteVolume(): number {
    return this.quoteVolSum;
  }

  getCurrentPrice(): number | null {
    return this.currentPrice;
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

  private pushQuoteVolume(value: number): void {
    const evicted = this.quoteVol1m.push(value);
    this.quoteVolSum += value;
    if (evicted !== undefined) {
      this.quoteVolSum -= evicted;
    }
  }
}
