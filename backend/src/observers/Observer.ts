import { Candle, CandleData, ObserverState } from '../types';
import { Queue } from '../utils/Queue';
import { ImpulseTracker } from './ImpulseTracker';
import { hourGateOpen } from '../utils/indicators';

const MA_PERIOD = 99;
const HOUR_WINDOW = 99;

export class Observer {
  private symbol: string;
  private queue1m: Queue<Candle>;
  private impulseTracker: ImpulseTracker;
  private lastCandle1s: Candle | null = null;
  private lastCandle1m: Candle | null = null;
  private hourCloses: Queue<number>;
  private mode: 'live' | 'emulation';
  private ma99Sum = 0;

  constructor(symbol: string, options?: { mode?: 'live' | 'emulation'; clock?: () => number }) {
    this.symbol = symbol;
    this.queue1m = new Queue<Candle>(MA_PERIOD);
    this.hourCloses = new Queue<number>(HOUR_WINDOW);
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
      this.impulseTracker.process(candle.close, ma99, this.hourGateOpen());
    }
  }

  updateCandle1m(candle: Candle): void {
    this.lastCandle1m = candle;

    if (this.mode === 'emulation' && candle.isClosed) {
      const ma99 = this.calculateMA99();
      if (ma99 !== null) {
        this.impulseTracker.process(candle.high, ma99, this.hourGateOpen());
      }
    }

    // Only closed 1m candles feed the MA99 queue
    if (candle.isClosed) {
      this.pushToMA99Queue(candle);
    }
  }

  /** Feed a closed 1h candle's close into the rolling window used by the Step 1 gate. */
  updateCandle1h(candle: Candle): void {
    if (candle.isClosed) {
      this.hourCloses.push(candle.close);
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

  /** True when the last closed 1h candle's indicators open the Step 1 gate. */
  private hourGateOpen(): boolean {
    return hourGateOpen(this.hourCloses.toArray());
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
