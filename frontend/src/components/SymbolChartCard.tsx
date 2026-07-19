import { useState } from 'react';
import { ActiveOrder, ChartTimeframe, PerformanceWindows, ZigZagState } from '../types';
import { SymbolChart } from './SymbolChart';
import { useSymbolChartData } from '../hooks/useSymbolChartData';

interface Props {
  symbol: string;
  zigzag: ZigZagState;
  performance: PerformanceWindows;
  activeOrder: ActiveOrder | null;
  orderSize: number;
}

const TIMEFRAMES: ChartTimeframe[] = ['1m', '1h'];

const PERFORMANCE_WINDOWS: { key: keyof PerformanceWindows; label: string }[] = [
  { key: 'h24', label: '24h' },
  { key: 'h12', label: '12h' },
  { key: 'h6', label: '6h' },
  { key: 'h3', label: '3h' },
  { key: 'h1', label: '1h' },
];

/** All symbols in this app are USDT pairs (e.g. "BTCUSDT" -> "BTC_USDT"). */
function binanceSpotUrl(symbol: string): string {
  const base = symbol.slice(0, -4);
  return `https://www.binance.com/es-AR/trade/${base}_USDT?type=spot`;
}

function fmtPrice(value: number): string {
  return value.toFixed(6);
}

function fmtPerf(value: number | null): string {
  if (value === null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function perfColor(value: number | null): string {
  if (value === null) return 'text-gray-500';
  return value >= 0 ? 'text-green-400' : 'text-red-400';
}

function fmtZigZag(zigzag: ZigZagState): string {
  const arrow = zigzag.direction === 'up' ? '↑' : zigzag.direction === 'down' ? '↓' : '—';
  const last = zigzag.lastPivot ? `${zigzag.lastPivot.type.toUpperCase()} @ ${fmtPrice(zigzag.lastPivot.price)}` : 'no pivot yet';
  return `${arrow} ${last}`;
}

export function SymbolChartCard({ symbol, zigzag, performance, activeOrder, orderSize }: Props) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1m');
  const { candles, series, loading, error } = useSymbolChartData(symbol, timeframe);

  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : null;

  return (
    <div className="rounded border border-gray-800 bg-gray-900 p-3">
      <div className="flex items-center justify-between mb-2">
        <a
          href={binanceSpotUrl(symbol)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-sm text-yellow-400 hover:underline truncate"
        >
          {symbol}
        </a>
        <div className="flex rounded overflow-hidden border border-gray-700">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-0.5 text-xs ${
                timeframe === tf ? 'bg-yellow-400 text-black' : 'bg-gray-800 text-gray-400'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-2 text-xs font-mono text-gray-300">
        ZigZag: {fmtZigZag(zigzag)}
      </div>

      <div className="flex items-center justify-between mb-2 text-[10px] font-mono">
        {PERFORMANCE_WINDOWS.map(({ key, label }) => (
          <div key={key} className="flex flex-col items-center gap-0.5">
            <span className="text-gray-500">{label}</span>
            <span className={perfColor(performance[key])}>{fmtPerf(performance[key])}</span>
          </div>
        ))}
      </div>

      <SymbolChart candles={candles} series={series} loading={loading} error={error} />

      <div className="mt-2 pt-2 border-t border-gray-800 flex items-center justify-between text-xs font-mono">
        <div className="flex flex-col gap-0.5 text-gray-400">
          <span>Price: <span className="text-gray-200">{currentPrice !== null ? fmtPrice(currentPrice) : '—'}</span></span>
          <span>Size: <span className="text-gray-200">{orderSize.toFixed(2)} USDT</span></span>
        </div>
        {activeOrder && (
          <div className="text-right text-yellow-400">
            <div>Active</div>
            <div className="text-gray-400">buy {fmtPrice(activeOrder.buyPrice)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
