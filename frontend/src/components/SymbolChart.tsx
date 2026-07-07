import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, LineSeries, ISeriesApi, LineData, UTCTimestamp, WhitespaceData } from 'lightweight-charts';
import { ChartTimeframe } from '../types';
import { useSymbolChartData } from '../hooks/useSymbolChartData';

interface Props {
  symbol: string;
  timeframe: ChartTimeframe;
}

function toTime(openTimeMs: number): UTCTimestamp {
  return Math.floor(openTimeMs / 1000) as UTCTimestamp;
}

export function SymbolChart({ symbol, timeframe }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma99SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const { candles, series, loading, error } = useSymbolChartData(symbol, timeframe);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 220,
      layout: { background: { color: 'transparent' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      timeScale: { timeVisible: true },
    });

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    ma20SeriesRef.current = chart.addSeries(LineSeries, { color: '#ecb619', lineWidth: 2 });
    ma99SeriesRef.current = chart.addSeries(LineSeries, { color: '#FFF', lineWidth: 3 });
    bbUpperSeriesRef.current = chart.addSeries(LineSeries, { color: '#b385f8', lineWidth: 2 });
    bbLowerSeriesRef.current = chart.addSeries(LineSeries, { color: '#d63966', lineWidth: 2 });

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;

    candleSeriesRef.current.setData(
      candles.map(c => ({ time: toTime(c.openTime), open: c.open, high: c.high, low: c.low, close: c.close }))
    );

    // Points with no computed value become whitespace (a gap) instead of
    // being filtered out — filtering would make lightweight-charts draw a
    // straight line connecting the nearest valid points across the gap.
    const toLineData = (values: (number | null)[]): (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] =>
      candles.map((c, i) => {
        const time = toTime(c.openTime);
        const value = values[i];
        return value === null ? { time } : { time, value };
      });

    ma20SeriesRef.current?.setData(toLineData(series.ma20));
    ma99SeriesRef.current?.setData(toLineData(series.ma99));
    bbUpperSeriesRef.current?.setData(toLineData(series.bbUpper));
    bbLowerSeriesRef.current?.setData(toLineData(series.bbLower));
  }, [candles, series]);

  return (
    <div>
      {loading && <p className="text-gray-500 text-xs px-1 py-1">Loading chart...</p>}
      {error && <p className="text-red-400 text-xs px-1 py-1">Error: {error}</p>}
      <div ref={containerRef} />
    </div>
  );
}
