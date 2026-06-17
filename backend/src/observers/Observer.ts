import { Candle, CandleData, ObserverState } from '../types';
import { Queue } from '../utils/Queue';
import { ImpulseTracker } from './ImpulseTracker';
import { evaluateContextValidators } from './ContextValidator';
import { BB_PERIOD } from '../utils/bollingerBands';

const MA_PERIOD = 99;
const CONTEXT_CANDLES = BB_PERIOD + 1; // 21 closed candles needed

export class Observer {
  private symbol: string;
  private queue1m: Queue<Candle>;
  private queue1hClosed: Queue<Candle>;
  private queue1dClosed: Queue<Candle>;
  private impulseTracker: ImpulseTracker;
  private lastCandle1s: Candle | null = null;
  private lastCandle1m: Candle | null = null;
  private lastCandle1h: Candle | null = null;
  private lastCandle1d: Candle | null = null;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.queue1m = new Queue<Candle>(MA_PERIOD);
    this.queue1hClosed = new Queue<Candle>(CONTEXT_CANDLES);
    this.queue1dClosed = new Queue<Candle>(CONTEXT_CANDLES);
    this.impulseTracker = new ImpulseTracker();
  }

  preload(candles: Candle[]): void {
    for (const candle of candles) {
      this.queue1m.push(candle);
    }
  }

  preload1h(candles: Candle[]): void {
    for (const candle of candles) {
      if (candle.isClosed) {
        this.queue1hClosed.push(candle);
      } else {
        this.lastCandle1h = candle;
      }
    }
  }

  preload1d(candles: Candle[]): void {
    for (const candle of candles) {
      if (candle.isClosed) {
        this.queue1dClosed.push(candle);
      } else {
        this.lastCandle1d = candle;
      }
    }
  }

  updateCandle1s(candle: Candle): void {
    this.lastCandle1s = candle;

    const ma99 = this.calculateMA99();
    if (ma99 !== null) {
      const context = evaluateContextValidators(
        this.queue1hClosed.toArray(),
        this.lastCandle1h,
        this.queue1dClosed.toArray(),
        this.lastCandle1d,
        candle.close,
      );
      this.impulseTracker.process(candle.close, ma99, context);
    }
  }

  updateCandle1m(candle: Candle): void {
    this.lastCandle1m = candle;
    if (candle.isClosed) {
      this.queue1m.push(candle);
    }
  }

  updateCandle1h(candle: Candle): void {
    this.lastCandle1h = candle;
    if (candle.isClosed) {
      this.queue1hClosed.push(candle);
    }
  }

  updateCandle1d(candle: Candle): void {
    this.lastCandle1d = candle;
    if (candle.isClosed) {
      this.queue1dClosed.push(candle);
    }
  }

  isReady(): boolean {
    return this.queue1m.isFull();
  }

  calculateMA99(): number | null {
    if (!this.queue1m.isFull()) return null;
    const candles = this.queue1m.toArray();
    const sum = candles.reduce((acc, c) => acc + c.close, 0);
    return sum / MA_PERIOD;
  }

  resetImpulseTracker(): void {
    this.impulseTracker.resetAll();
  }

  getBuffer1m(): Candle[] {
    return this.queue1m.toArray();
  }

  getState(): ObserverState {
    return {
      symbol: this.symbol,
      candle1s: this.lastCandle1s ? toCandleData(this.lastCandle1s) : null,
      candle1m: this.lastCandle1m ? toCandleData(this.lastCandle1m) : null,
      candle1h: this.lastCandle1h ? toCandleData(this.lastCandle1h) : null,
      candle1d: this.lastCandle1d ? toCandleData(this.lastCandle1d) : null,
      ma99: this.calculateMA99(),
      isReady: this.isReady(),
      impulseTracking: this.impulseTracker.getSnapshot(),
    };
  }
}

function toCandleData(candle: Candle): CandleData {
  return {
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    timestamp: candle.openTime,
    isClosed: candle.isClosed,
  };
}
