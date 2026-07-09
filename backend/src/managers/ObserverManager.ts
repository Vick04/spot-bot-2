import { EventEmitter } from 'events';
import { Observer } from '../observers/Observer';
import {
  Candle,
  ChartCandle,
  ChartData,
  ChartSeries,
  ChartSeriesPoint,
  ChartTimeframe,
  ObserverState,
} from '../types';
import { computeChartSeries } from '../utils/chartSeries';

/** REST/initial chart snapshots and the sliding client-side window both use
 * the last 100 candles; the Observer buffer (200 candles) holds more so
 * MA99 has a full lookback at the first visible point. */
const CHART_VISIBLE_CANDLES = 100;

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

    const before = observer.getState();

    if (candle.timeframe === '1s') {
      observer.updateCandle1s(candle);
    } else if (candle.timeframe === '1m') {
      observer.updateCandle1m(candle);
    } else if (candle.timeframe === '1h') {
      observer.updateCandle1h(candle);
    }

    const state = observer.getState();
    // Compare all four step booleans, not just `qualifies` (which is their
    // OR): qualifies can stay true across a step1->step2 transition (step2
    // only ever sets while step1 is already true), so gating on it alone
    // misses the "Watching" -> "Ready" update the frontend depends on.
    const reasonsChanged =
      state.reasons.m1.step1 !== before.reasons.m1.step1 ||
      state.reasons.m1.step2 !== before.reasons.m1.step2 ||
      state.reasons.h1.step1 !== before.reasons.h1.step1 ||
      state.reasons.h1.step2 !== before.reasons.h1.step2;
    if (reasonsChanged) {
      this.emit('signal', state);
    }

    if (state.qualifies) {
      const m1 = this.getLatestChartPoint(candle.symbol, '1m');
      const h1 = this.getLatestChartPoint(candle.symbol, '1h');

      if (!candle.isClosed && m1 && h1) {
        this.emit('chart:tick', { symbol: candle.symbol, m1, h1 });
      }

      if (candle.isClosed && (candle.timeframe === '1m' || candle.timeframe === '1h')) {
        const point = candle.timeframe === '1m' ? m1 : h1;
        if (point) {
          this.emit('chart:closed', {
            symbol: candle.symbol,
            timeframe: candle.timeframe,
            candle: point.candle,
            series: point.series,
          });
        }
      }
    }
  }

  getAllStates(): ObserverState[] {
    return Array.from(this.observers.values()).map(obs => obs.getState());
  }

  getObserverState(symbol: string): ObserverState | null {
    return this.observers.get(symbol)?.getState() ?? null;
  }

  getQualifyingSymbols(): string[] {
    return this.getAllStates().filter(s => s.qualifies).map(s => s.symbol);
  }

  /** Last 100 candles + index-aligned indicator series for `symbol`/`timeframe`.
   * Computes indicators over the FULL buffer first (so MA99 has its 99-candle
   * lookback), then slices both candles and series to the visible window. */
  getChartData(symbol: string, timeframe: ChartTimeframe): ChartData | null {
    const observer = this.observers.get(symbol);
    if (!observer) return null;

    const allCandles = observer.getChartData(timeframe);
    const fullSeries = computeChartSeries(allCandles.map(c => c.close));

    const candles = allCandles.slice(-CHART_VISIBLE_CANDLES);
    const series: ChartSeries = {
      ma20: fullSeries.ma20.slice(-CHART_VISIBLE_CANDLES),
      ma99: fullSeries.ma99.slice(-CHART_VISIBLE_CANDLES),
      bbUpper: fullSeries.bbUpper.slice(-CHART_VISIBLE_CANDLES),
      bbLower: fullSeries.bbLower.slice(-CHART_VISIBLE_CANDLES),
    };

    return { symbol, timeframe, candles, series };
  }

  private getLatestChartPoint(
    symbol: string,
    timeframe: ChartTimeframe
  ): { candle: ChartCandle; series: ChartSeriesPoint } | null {
    const data = this.getChartData(symbol, timeframe);
    if (!data || data.candles.length === 0) return null;

    const lastIndex = data.candles.length - 1;
    return {
      candle: data.candles[lastIndex],
      series: {
        ma20: data.series.ma20[lastIndex],
        ma99: data.series.ma99[lastIndex],
        bbUpper: data.series.bbUpper[lastIndex],
        bbLower: data.series.bbLower[lastIndex],
      },
    };
  }

  preloadObserver1m(symbol: string, candles: Candle[]): void {
    this.observers.get(symbol)?.preloadClosed1m(candles);
  }

  preloadObserver1h(symbol: string, candles: Candle[]): void {
    this.observers.get(symbol)?.preloadClosed1h(candles);
  }

  preloadObserverVolume(symbol: string, candles: Candle[]): void {
    this.observers.get(symbol)?.preloadQuoteVolume1m(candles);
  }

  getQuoteVolume24h(symbol: string): number | null {
    const observer = this.observers.get(symbol);
    return observer ? observer.get24hQuoteVolume() : null;
  }

  getCurrentPrice(symbol: string): number | null {
    const observer = this.observers.get(symbol);
    return observer ? observer.getCurrentPrice() : null;
  }

  getSymbols(): string[] {
    return Array.from(this.observers.keys());
  }
}
