import { Candle, CandleData, ObserverState } from '../types';
import { Queue } from '../utils/Queue';

const MA_PERIOD = 99;

export class Observer {
  private symbol: string;
  private queue1m: Queue<Candle>;
  private lastCandle1s: Candle | null = null;
  private lastCandle1m: Candle | null = null;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.queue1m = new Queue<Candle>(MA_PERIOD);
  }

  preload(candles: Candle[]): void {
    for (const candle of candles) {
      this.queue1m.push(candle);
    }
  }

  updateCandle1s(candle: Candle): void {
    this.lastCandle1s = candle;
  }

  updateCandle1m(candle: Candle): void {
    this.lastCandle1m = candle;
    this.queue1m.push(candle);
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

  getState(): ObserverState {
    return {
      symbol: this.symbol,
      candle1s: this.lastCandle1s ? toCandleData(this.lastCandle1s) : null,
      candle1m: this.lastCandle1m ? toCandleData(this.lastCandle1m) : null,
      ma99: this.calculateMA99(),
      isReady: this.isReady(),
    };
  }
}

function toCandleData(candle: Candle): CandleData {
  return {
    close: candle.close,
    timestamp: candle.openTime,
  };
}
