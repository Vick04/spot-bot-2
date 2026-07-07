import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, IChartApi, LineSeries, ISeriesApi, LineData, UTCTimestamp, WhitespaceData } from 'lightweight-charts';
import { ChartTimeframe } from '../types';
import { useSymbolChartData } from '../hooks/useSymbolChartData';

interface Props {
  symbol: string;
  timeframe: ChartTimeframe;
}

/** The data buffer holds 100 candles, but the initial view zooms in to the
 * most recent 20 for readability — the user can still scroll/zoom out. */
const INITIAL_VISIBLE_CANDLES = 20;

function toTime(openTimeMs: number): UTCTimestamp {
  return Math.floor(openTimeMs / 1000) as UTCTimestamp;
}

export function SymbolChart({ symbol, timeframe }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma99SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const hasSetInitialRangeRef = useRef(false);

  const { candles, series, loading, error } = useSymbolChartData(symbol, timeframe);

  // A genuinely new dataset (symbol or timeframe change) should re-zoom to
  // the most recent INITIAL_VISIBLE_CANDLES, same as a fresh mount.
  useEffect(() => {
    hasSetInitialRangeRef.current = false;
  }, [symbol, timeframe]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 220,
      layout: { background: { color: 'transparent' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      timeScale: { timeVisible: true },
    });
    chartRef.current = chart;

    // 6 decimal places on the price axis — most of these symbols trade at
    // sub-$1 prices where the default 2-decimal format loses precision.
    const priceFormat = { type: 'price' as const, precision: 6, minMove: 0.000001 };

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceFormat,
    });
    // priceLineVisible/lastValueVisible off: these draw a dashed straight
    // line + value label at the series' latest value, which doesn't follow
    // history — out of place alongside the historical overlay lines.
    const noPriceLine = { priceLineVisible: false, lastValueVisible: false };
    ma20SeriesRef.current = chart.addSeries(LineSeries, { color: '#ecb619', lineWidth: 2, priceFormat, ...noPriceLine });
    ma99SeriesRef.current = chart.addSeries(LineSeries, { color: '#FFF', lineWidth: 3, priceFormat, ...noPriceLine });
    bbUpperSeriesRef.current = chart.addSeries(LineSeries, { color: '#b385f8', lineWidth: 2, priceFormat, ...noPriceLine });
    bbLowerSeriesRef.current = chart.addSeries(LineSeries, { color: '#d63966', lineWidth: 2, priceFormat, ...noPriceLine });

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

    if (!hasSetInitialRangeRef.current && chartRef.current) {
      const total = candles.length;
      const from = Math.max(0, total - INITIAL_VISIBLE_CANDLES);
      chartRef.current.timeScale().setVisibleLogicalRange({ from, to: total - 1 });
      hasSetInitialRangeRef.current = true;
    }
  }, [candles, series]);

  return (
    <div>
      {loading && <p className="text-gray-500 text-xs px-1 py-1">Loading chart...</p>}
      {error && <p className="text-red-400 text-xs px-1 py-1">Error: {error}</p>}
      <div ref={containerRef} />
    </div>
  );
}
