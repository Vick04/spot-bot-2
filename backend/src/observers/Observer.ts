import { Candle, CandleData, ObserverState } from '../types';
import { Queue } from '../utils/Queue';
import { ImpulseTracker } from './ImpulseTracker';

const MA_PERIOD = 99;
const MA20_PERIOD = 20;
const BB_PERIOD = 20;
const BB_STDDEV = 2;

export class Observer {
  private symbol: string;
  private queue1m: Queue<Candle>;
  private queue20: Queue<Candle>;
  private impulseTracker: ImpulseTracker;
  private lastCandle1s: Candle | null = null;
  private lastCandle1m: Candle | null = null;
  private previousCandle1m: Candle | null = null;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.queue1m = new Queue<Candle>(MA_PERIOD);
    this.queue20 = new Queue<Candle>(MA20_PERIOD);
    this.impulseTracker = new ImpulseTracker();
  }

  preload(candles: Candle[]): void {
    for (const candle of candles) {
      this.queue1m.push(candle);
      this.queue20.push(candle);
    }
  }

  updateCandle1s(candle: Candle): void {
    this.lastCandle1s = candle;

    const ma99 = this.calculateMA99();
    const ma20 = this.calculateMA20();

    if (ma99 !== null && ma20 !== null) {
      this.impulseTracker.process(candle.close, ma20, ma99);
    }
  }

  updateCandle1m(candle: Candle): void {
    this.previousCandle1m = this.lastCandle1m;
    this.lastCandle1m = candle;
    if (candle.isClosed) {
      this.queue1m.push(candle);
      this.queue20.push(candle);
    }
  }

  isReady(): boolean {
    return this.queue1m.isFull() && this.queue20.isFull();
  }

  calculateMA99(): number | null {
    if (!this.queue1m.isFull()) return null;
    const candles = this.queue1m.toArray();
    const sum = candles.reduce((acc, c) => acc + c.close, 0);
    return sum / MA_PERIOD;
  }

  calculateMA20(): number | null {
    if (!this.queue20.isFull()) return null;
    const candles = this.queue20.toArray();
    const sum = candles.reduce((acc, c) => acc + c.close, 0);
    return sum / MA20_PERIOD;
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
      ma99: this.calculateMA99(),
      isReady: this.isReady(),
      impulseTracking: this.impulseTracker.getSnapshot(),
    };
  }
}

function toCandleData(candle: Candle): CandleData {
  return {
    close: candle.close,
    timestamp: candle.openTime,
  };
}
