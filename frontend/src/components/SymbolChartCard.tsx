import { useState } from 'react';
import { ActiveOrder, ChartTimeframe } from '../types';
import { SymbolChart } from './SymbolChart';
import { useSymbolChartData } from '../hooks/useSymbolChartData';

interface Props {
  symbol: string;
  isPinned: boolean;
  onTogglePin: () => void;
  activeOrder: ActiveOrder | null;
  orderSize: number;
  onBuy: () => void;
}

const TIMEFRAMES: ChartTimeframe[] = ['1m', '1h'];
const TARGET_MULT = 1.005;

/** All symbols in this app are USDT pairs (e.g. "BTCUSDT" -> "BTC_USDT"). */
function binanceSpotUrl(symbol: string): string {
  const base = symbol.slice(0, -4);
  return `https://www.binance.com/es-AR/trade/${base}_USDT?type=spot`;
}

function fmtPrice(value: number): string {
  return value.toFixed(6);
}

export function SymbolChartCard({ symbol, isPinned, onTogglePin, activeOrder, orderSize, onBuy }: Props) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1m');
  const { candles, series, loading, error } = useSymbolChartData(symbol, timeframe);

  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : null;
  const targetPrice = currentPrice !== null ? currentPrice * TARGET_MULT : null;

  return (
    <div className="rounded border border-gray-800 bg-gray-900 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={onTogglePin}
            aria-label={isPinned ? `Unpin ${symbol}` : `Pin ${symbol}`}
            aria-pressed={isPinned}
            className={`shrink-0 p-0.5 rounded ${isPinned ? 'text-yellow-400' : 'text-gray-600 hover:text-gray-400'}`}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
            </svg>
          </button>
          <a
            href={binanceSpotUrl(symbol)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-sm text-yellow-400 hover:underline truncate"
          >
            {symbol}
          </a>
        </div>
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

      <SymbolChart candles={candles} series={series} loading={loading} error={error} />

      <div className="mt-2 pt-2 border-t border-gray-800 flex items-center justify-between text-xs font-mono">
        <div className="flex flex-col gap-0.5 text-gray-400">
          <span>Price: <span className="text-gray-200">{currentPrice !== null ? fmtPrice(currentPrice) : '—'}</span></span>
          <span>Target: <span className="text-green-400">{targetPrice !== null ? fmtPrice(targetPrice) : '—'}</span></span>
          <span>Size: <span className="text-gray-200">{orderSize.toFixed(2)} USDT</span></span>
        </div>
        {activeOrder ? (
          <div className="text-right text-yellow-400">
            <div>Active</div>
            <div className="text-gray-400">buy {fmtPrice(activeOrder.buyPrice)}</div>
          </div>
        ) : (
          <button
            onClick={onBuy}
            disabled={orderSize <= 0 || currentPrice === null}
            className="px-3 py-1 rounded bg-green-600 text-white text-xs disabled:bg-gray-700 disabled:text-gray-500"
          >
            Buy
          </button>
        )}
      </div>
    </div>
  );
}
