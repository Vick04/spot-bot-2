import { Candle, ObserverState } from '../types';
import { Queue } from '../utils/Queue';
import { detectSignal, SignalResult } from '../utils/signals';

/** 19 closed candles + the live price = a 20-value Bollinger window (see utils/signals.ts). */
const CLOSED_WINDOW = 19;

const EMPTY_SIGNAL: SignalResult = {
  qualifies: false,
  reasons: { bbUpper1m: false, bbUpper1h: false, threePositive1m: false, threePositive1h: false },
};

export class Observer {
  private symbol: string;
  private closed1m: Queue<Candle>;
  private closed1h: Queue<Candle>;
  private form1mOpen: number | null = null;
  private form1hOpen: number | null = null;
  private currentPrice: number | null = null;
  private signal: SignalResult = EMPTY_SIGNAL;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.closed1m = new Queue<Candle>(CLOSED_WINDOW);
    this.closed1h = new Queue<Candle>(CLOSED_WINDOW);
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
      this.form1mOpen = null;
    } else {
      this.form1mOpen = candle.open;
    }
    this.recompute();
  }

  updateCandle1h(candle: Candle): void {
    if (candle.isClosed) {
      this.closed1h.push(candle);
      this.form1hOpen = null;
    } else {
      this.form1hOpen = candle.open;
    }
    this.recompute();
  }

  getState(): ObserverState {
    return { symbol: this.symbol, qualifies: this.signal.qualifies, reasons: this.signal.reasons };
  }

  private recompute(): void {
    if (this.currentPrice === null) return;
    this.signal = detectSignal(
      this.currentPrice,
      this.closed1m.toArray(),
      this.form1mOpen,
      this.closed1h.toArray(),
      this.form1hOpen,
    );
  }
}
