import { Candle } from '../types';

const HOUR_MS = 3_600_000;

type HourCandleSource = (symbol: string) => Iterator<Candle>;

interface SymbolState {
  iterator: Iterator<Candle>;
  next: Candle | null;
}

/**
 * Per-symbol cursor over a symbol's ascending-openTime 1h candle stream.
 * On each `advanceClosed(symbol, upToTime)` call it yields, in order, the 1h
 * candles whose close (openTime + 1h) is at or before `upToTime` and that
 * haven't been returned yet. Callers advance it with monotonically increasing
 * timestamps (the emulator's simulated clock), so a candle is only surfaced
 * once its hour has fully elapsed — mirroring "last closed 1h candle" in live.
 */
export class HourCandleCursor {
  private source: HourCandleSource;
  private states = new Map<string, SymbolState>();

  constructor(source: HourCandleSource) {
    this.source = source;
  }

  advanceClosed(symbol: string, upToTime: number): Candle[] {
    const state = this.stateFor(symbol);
    const closed: Candle[] = [];

    while (state.next !== null && state.next.openTime + HOUR_MS <= upToTime) {
      closed.push(state.next);
      const result = state.iterator.next();
      state.next = result.done ? null : result.value;
    }

    return closed;
  }

  private stateFor(symbol: string): SymbolState {
    let state = this.states.get(symbol);
    if (state === undefined) {
      const iterator = this.source(symbol);
      const first = iterator.next();
      state = { iterator, next: first.done ? null : first.value };
      this.states.set(symbol, state);
    }
    return state;
  }
}
