import { EventEmitter } from 'events';
import { Observer } from '../observers/Observer';
import { Candle, ObserverState } from '../types';

export class ObserverManager extends EventEmitter {
  private observers: Map<string, Observer> = new Map();

  createObserver(symbol: string): void {
    if (!this.observers.has(symbol)) {
      this.observers.set(symbol, new Observer(symbol));
    }
  }

  createObservers(symbols: string[]): void {
    symbols.forEach(symbol => this.createObserver(symbol));
  }

  updateCandle(candle: Candle): void {
    const observer = this.observers.get(candle.symbol);
    if (!observer) return;

    if (candle.timeframe === '1s') {
      observer.updateCandle1s(candle);
    } else if (candle.timeframe === '1m') {
      observer.updateCandle1m(candle);
    }

    this.emit('candle', {
      symbol: candle.symbol,
      timeframe: candle.timeframe,
      state: observer.getState(),
    });
  }

  getAllStates(): ObserverState[] {
    return Array.from(this.observers.values()).map(obs => obs.getState());
  }

  getObserverState(symbol: string): ObserverState | null {
    return this.observers.get(symbol)?.getState() ?? null;
  }

  preloadObserver(symbol: string, candles: Candle[]): void {
    this.observers.get(symbol)?.preload(candles);
  }

  getSymbols(): string[] {
    return Array.from(this.observers.keys());
  }
}
