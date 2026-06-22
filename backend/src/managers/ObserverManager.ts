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

    const counterBefore = observer.getState().impulseTracking.counter;

    if (candle.timeframe === '1s') {
      observer.updateCandle1s(candle);
    } else if (candle.timeframe === '1m') {
      observer.updateCandle1m(candle);
    }

    const state = observer.getState();

    if (state.impulseTracking.counter > counterBefore) {
      this.emit('hit', { symbol: candle.symbol, counter: state.impulseTracking.counter });
    }

    this.emit('candle', { symbol: candle.symbol, timeframe: candle.timeframe, state });
  }

  getAllStates(): ObserverState[] {
    return Array.from(this.observers.values()).map(obs => obs.getState());
  }

  getObserver(symbol: string): Observer | null {
    return this.observers.get(symbol) ?? null;
  }

  getObserverState(symbol: string): ObserverState | null {
    return this.observers.get(symbol)?.getState() ?? null;
  }

  getBuffer1m(symbol: string): Candle[] {
    return this.observers.get(symbol)?.getBuffer1m() ?? [];
  }

  preloadObserver(symbol: string, candles: Candle[]): void {
    this.observers.get(symbol)?.preload(candles);
  }

  resetAllImpulseTrackers(): void {
    this.observers.forEach(obs => obs.resetImpulseTracker());
  }

  getSymbols(): string[] {
    return Array.from(this.observers.keys());
  }
}
