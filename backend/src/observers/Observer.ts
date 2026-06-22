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
    const prevMa20 = this.getPreviousMA20();
    const prevBBUpper = this.getPreviousBBUpper();

    if (ma99 !== null && ma20 !== null && prevMa20 !== null && prevBBUpper !== null) {
      this.impulseTracker.process(candle.close, ma20, ma99, prevBBUpper, prevMa20);
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

  getPreviousMA20(): number | null {
    if (!this.previousCandle1m) return null;
    const candles = this.queue20.toArray();
    if (candles.length < MA20_PERIOD) return null;
    const prevCandles = candles.slice(0, -1);
    const sum = prevCandles.reduce((acc, c) => acc + c.close, 0);
    return sum / (MA20_PERIOD - 1);
  }

  calculateBBUpper(): { ma20: number; upper: number } | null {
    if (!this.queue20.isFull()) return null;
    const candles = this.queue20.toArray();
    const closes = candles.map(c => c.close);
    const ma20 = closes.reduce((a, b) => a + b, 0) / MA20_PERIOD;
    const variance = closes.reduce((acc, close) => acc + Math.pow(close - ma20, 2), 0) / BB_PERIOD;
    const stddev = Math.sqrt(variance);
    const upper = ma20 + BB_STDDEV * stddev;
    return { ma20, upper };
  }

  getPreviousBBUpper(): number | null {
    if (!this.previousCandle1m) return null;
    const candles = this.queue20.toArray();
    if (candles.length < MA20_PERIOD) return null;
    const prevCandles = candles.slice(0, -1);
    if (prevCandles.length < MA20_PERIOD - 1) return null;
    const closes = prevCandles.map(c => c.close);
    const ma20 = closes.reduce((a, b) => a + b, 0) / (MA20_PERIOD - 1);
    const variance = closes.reduce((acc, close) => acc + Math.pow(close - ma20, 2), 0) / (BB_PERIOD - 1);
    const stddev = Math.sqrt(variance);
    const upper = ma20 + BB_STDDEV * stddev;
    return upper;
  }

  resetImpulseTracker(): void {
    this.impulseTracker.resetAll();
  }

  getBuffer1m(): Candle[] {
    return this.queue1m.toArray();
  }

  getPrevMa20(): number | null {
    return this.getPreviousMA20();
  }

  getState(): ObserverState {
    const bb = this.calculateBBUpper();
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
