import { Candle, ChartCandle, ChartTimeframe, ObserverState, PerformanceWindows, ZigZagState } from '../types';
import { Queue } from '../utils/Queue';
import { computePerformance } from '../utils/performance';
import { nextZigZagState, EMPTY_ZIGZAG_STATE } from '../utils/zigzag';

/** 200 closed candles per timeframe: enough for a 100-candle visible chart
 * window with a full 99-candle MA99 lookback at the first visible point,
 * plus margin. Also comfortably covers the 24h performance window (24
 * hourly candles) and the ZigZag detector's 20-bar minimum gap. */
const CHART_HISTORY_CANDLES = 200;

/** 1 quote-volume value per closed 1m candle, covering a rolling 24h window
 * (60 * 24 = 1440 minutes), used for liquidity-based order sizing. */
const QUOTE_VOLUME_WINDOW = 1440;

/** Which closed-candle buffer drives the ZigZag pivot detector -- a single
 * global choice (unlike the old per-timeframe step1/step2 system). To be
 * calibrated against real BTC history via the emulator (separate
 * sub-project) before changing this. */
const ZIGZAG_TIMEFRAME: ChartTimeframe = '1m';

export class Observer {
  private symbol: string;
  private closed1m: Queue<Candle>;
  private closed1h: Queue<Candle>;
  private quoteVol1m: Queue<number>;
  private quoteVolSum = 0;
  private form1mCandle: Candle | null = null;
  private form1hCandle: Candle | null = null;
  private currentPrice: number | null = null;
  private performance: PerformanceWindows = computePerformance([]);
  private zigzag: ZigZagState = EMPTY_ZIGZAG_STATE;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.closed1m = new Queue<Candle>(CHART_HISTORY_CANDLES);
    this.closed1h = new Queue<Candle>(CHART_HISTORY_CANDLES);
    this.quoteVol1m = new Queue<number>(QUOTE_VOLUME_WINDOW);
  }

  /** Pushes each candle into the 1m chart buffer. If ZIGZAG_TIMEFRAME is
   * '1m', also replays nextZigZagState() candle-by-candle so a freshly
   * started observer reconstructs true pivot state instead of starting
   * cold -- same replay discipline the old step1/step2 system used. */
  preloadClosed1m(candles: Candle[]): void {
    candles.forEach(c => {
      this.closed1m.push(c);
      if (ZIGZAG_TIMEFRAME === '1m') {
        this.zigzag = nextZigZagState(c, this.zigzag);
      }
    });
  }

  /** Same replay discipline as preloadClosed1m, for the 1h buffer -- only
   * advances the ZigZag detector if ZIGZAG_TIMEFRAME is '1h'. Always
   * recomputes performance once at the end (performance has no stickiness
   * or history dependency beyond "what's the buffer right now", unlike
   * ZigZag, so it doesn't need a per-candle recompute during replay). */
  preloadClosed1h(candles: Candle[]): void {
    candles.forEach(c => {
      this.closed1h.push(c);
      if (ZIGZAG_TIMEFRAME === '1h') {
        this.zigzag = nextZigZagState(c, this.zigzag);
      }
    });
    this.performance = computePerformance(this.closed1h.toArray());
  }

  /** Feeds the 24h rolling quote-volume window without touching the chart
   * buffer -- callers typically pass a longer history here than to
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
      if (ZIGZAG_TIMEFRAME === '1m') {
        this.zigzag = nextZigZagState(candle, this.zigzag);
      }
    } else {
      this.form1mCandle = candle;
    }
  }

  updateCandle1h(candle: Candle): void {
    if (candle.isClosed) {
      this.closed1h.push(candle);
      this.form1hCandle = null;
      this.performance = computePerformance(this.closed1h.toArray());
      if (ZIGZAG_TIMEFRAME === '1h') {
        this.zigzag = nextZigZagState(candle, this.zigzag);
      }
    } else {
      this.form1hCandle = candle;
    }
  }

  getState(): ObserverState {
    return { symbol: this.symbol, performance: this.performance, zigzag: this.zigzag };
  }

  /** Sum of the last (up to) 1440 closed 1m candles' quote volume. Below a
   * full window, this underestimates the true 24h volume -- self-corrects
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
