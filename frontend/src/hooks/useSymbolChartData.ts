import { useEffect, useState } from 'react';
import { ChartCandle, ChartClosedEvent, ChartSeries, ChartTickEvent, ChartTimeframe } from '../types';
import { getSocket } from './socket';

interface ChartDataState {
  candles: ChartCandle[];
  series: ChartSeries;
  loading: boolean;
  error: string | null;
}

const EMPTY_SERIES: ChartSeries = { ma20: [], ma99: [], bbUpper: [], bbLower: [] };
const VISIBLE_CANDLES = 100;

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
        const candles = s.candles.slice(0, -1).concat(point.candle);
        const series: ChartSeries = {
          ma20: s.series.ma20.slice(0, -1).concat(point.series.ma20),
          ma99: s.series.ma99.slice(0, -1).concat(point.series.ma99),
          bbUpper: s.series.bbUpper.slice(0, -1).concat(point.series.bbUpper),
          bbLower: s.series.bbLower.slice(0, -1).concat(point.series.bbLower),
        };
        return { ...s, candles, series };
      });
    };

    const handleClosed = (event: ChartClosedEvent) => {
      if (event.symbol !== symbol || event.timeframe !== timeframe) return;

      setState(s => {
        // chart:tick may have already placed this exact closing candle as the
        // last element (see ObserverManager.updateCandle, which emits
        // chart:tick then chart:closed for the same candle). If so, replace
        // that element in place instead of appending a duplicate openTime.
        const lastCandle = s.candles[s.candles.length - 1];
        const isReplacingLast = lastCandle !== undefined && lastCandle.openTime === event.candle.openTime;
        const dropLast = <T,>(arr: T[]) => (isReplacingLast ? arr.slice(0, -1) : arr);

        const candles = dropLast(s.candles).concat(event.candle).slice(-VISIBLE_CANDLES);
        const series: ChartSeries = {
          ma20: dropLast(s.series.ma20).concat(event.series.ma20).slice(-VISIBLE_CANDLES),
          ma99: dropLast(s.series.ma99).concat(event.series.ma99).slice(-VISIBLE_CANDLES),
          bbUpper: dropLast(s.series.bbUpper).concat(event.series.bbUpper).slice(-VISIBLE_CANDLES),
          bbLower: dropLast(s.series.bbLower).concat(event.series.bbLower).slice(-VISIBLE_CANDLES),
        };
        return { ...s, candles, series };
      });
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
