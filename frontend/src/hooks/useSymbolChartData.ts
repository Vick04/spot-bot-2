import { useEffect, useState } from 'react';
import { ChartCandle, ChartClosedEvent, ChartSeries, ChartSeriesPoint, ChartTickEvent, ChartTimeframe } from '../types';
import { getSocket } from './socket';

interface ChartDataState {
  candles: ChartCandle[];
  series: ChartSeries;
  loading: boolean;
  error: string | null;
}

const EMPTY_SERIES: ChartSeries = { ma20: [], ma99: [], bbUpper: [], bbLower: [] };
const VISIBLE_CANDLES = 100;

/**
 * Merges an incoming chart point (from `chart:tick` or `chart:closed`) into the
 * current candles/series arrays.
 *
 * If the incoming point's openTime matches the last element's openTime, it
 * REPLACES that element (same forming candle being updated, or the
 * tick-then-closed race for the same closing candle). Otherwise, it APPENDS
 * (a new candle has started forming). The result is always capped to
 * VISIBLE_CANDLES.
 */
export function mergeChartPoint(
  s: { candles: ChartCandle[]; series: ChartSeries },
  point: { candle: ChartCandle; series: ChartSeriesPoint }
): { candles: ChartCandle[]; series: ChartSeries } {
  const lastCandle = s.candles[s.candles.length - 1];
  const isReplacingLast = lastCandle !== undefined && lastCandle.openTime === point.candle.openTime;
  const dropLast = <T,>(arr: T[]) => (isReplacingLast ? arr.slice(0, -1) : arr);

  const candles = dropLast(s.candles).concat(point.candle).slice(-VISIBLE_CANDLES);
  const series: ChartSeries = {
    ma20: dropLast(s.series.ma20).concat(point.series.ma20).slice(-VISIBLE_CANDLES),
    ma99: dropLast(s.series.ma99).concat(point.series.ma99).slice(-VISIBLE_CANDLES),
    bbUpper: dropLast(s.series.bbUpper).concat(point.series.bbUpper).slice(-VISIBLE_CANDLES),
    bbLower: dropLast(s.series.bbLower).concat(point.series.bbLower).slice(-VISIBLE_CANDLES),
  };
  return { candles, series };
}

export function useSymbolChartData(symbol: string, timeframe: ChartTimeframe): ChartDataState {
  const [state, setState] = useState<ChartDataState>({
    candles: [],
    series: EMPTY_SERIES,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ candles: [], series: EMPTY_SERIES, loading: true, error: null });

    fetch(`/api/observers/${symbol}/chart?timeframe=${timeframe}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: { data: { candles: ChartCandle[]; series: ChartSeries } }) => {
        if (cancelled) return;
        setState({ candles: json.data.candles, series: json.data.series, loading: false, error: null });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setState(s => ({ ...s, loading: false, error: err.message }));
      });

    const socket = getSocket();

    const handleTick = (event: ChartTickEvent) => {
      if (event.symbol !== symbol) return;
      const point = timeframe === '1m' ? event.m1 : event.h1;

      setState(s => {
        if (s.candles.length === 0) return s;
        return { ...s, ...mergeChartPoint(s, point) };
      });
    };

    const handleClosed = (event: ChartClosedEvent) => {
      if (event.symbol !== symbol || event.timeframe !== timeframe) return;

      // chart:tick may have already placed this exact closing candle as the
      // last element. If so, mergeChartPoint replaces that element in place
      // instead of appending a duplicate openTime.
      setState(s => ({ ...s, ...mergeChartPoint(s, { candle: event.candle, series: event.series }) }));
    };

    socket.on('chart:tick', handleTick);
    socket.on('chart:closed', handleClosed);

    return () => {
      cancelled = true;
      socket.off('chart:tick', handleTick);
      socket.off('chart:closed', handleClosed);
    };
  }, [symbol, timeframe]);

  return state;
}
