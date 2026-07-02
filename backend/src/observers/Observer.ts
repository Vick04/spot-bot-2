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
  private ma99Sum = 0;

  constructor(symbol: string, options?: { mode?: 'live' | 'emulation'; clock?: () => number }) {
    this.symbol = symbol;
    this.queue1m = new Queue<Candle>(MA_PERIOD);
    this.impulseTracker = new ImpulseTracker(options?.clock);
    this.mode = options?.mode ?? 'live';
  }

  preload(candles: Candle[]): void {
    for (const candle of candles) {
      this.pushToMA99Queue(candle);
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
      this.pushToMA99Queue(candle);
    }
  }

  isReady(): boolean {
    return this.queue1m.isFull();
  }

  /**
   * O(1) — maintained as a running sum (updated in pushToMA99Queue) instead
   * of rebuilding the 99-candle array on every call. This function is on the
   * hot path: it runs multiple times per candle across Observer/ObserverManager,
   * and the emulator drives ~81M candles per full run.
   */
  calculateMA99(): number | null {
    if (!this.queue1m.isFull()) return null;
    return this.ma99Sum / MA_PERIOD;
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

  private pushToMA99Queue(candle: Candle): void {
    const evicted = this.queue1m.push(candle);
    this.ma99Sum += candle.close;
    if (evicted !== undefined) {
      this.ma99Sum -= evicted.close;
    }
  }
}

function toCandleData(candle: Candle): CandleData {
  return {
    close: candle.close,
    timestamp: candle.openTime,
  };
}
