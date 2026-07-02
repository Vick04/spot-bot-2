import { Candle, CandleData, ObserverState } from '../types';
import { Queue } from '../utils/Queue';
import { ImpulseTracker } from './ImpulseTracker';

const MA_PERIOD = 99;

export class Observer {
  private symbol: string;
  private queue1m: Queue<Candle>;
  private impulseTracker: ImpulseTracker;
  private lastCandle1s: Candle | null = null;
  private lastCandle1m: Candle | null = null;
  private mode: 'live' | 'emulation';

  constructor(symbol: string, options?: { mode?: 'live' | 'emulation'; clock?: () => number }) {
    this.symbol = symbol;
    this.queue1m = new Queue<Candle>(MA_PERIOD);
    this.impulseTracker = new ImpulseTracker(options?.clock);
    this.mode = options?.mode ?? 'live';
  }

  preload(candles: Candle[]): void {
    for (const candle of candles) {
      this.queue1m.push(candle);
    }
  }

  updateCandle1s(candle: Candle): void {
    this.lastCandle1s = candle;

    const ma99 = this.calculateMA99();
    if (ma99 !== null) {
      this.impulseTracker.process(candle.close, ma99);
    }
  }

  updateCandle1m(candle: Candle): void {
    this.lastCandle1m = candle;

    if (this.mode === 'emulation' && candle.isClosed) {
      const ma99 = this.calculateMA99();
      if (ma99 !== null) {
        this.impulseTracker.process(candle.high, ma99);
      }
    }

    // Only closed 1m candles feed the MA99 queue
    if (candle.isClosed) {
      this.queue1m.push(candle);
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
