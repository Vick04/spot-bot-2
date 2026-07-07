import { useState } from 'react';
import { ChartTimeframe } from '../types';
import { SymbolChart } from './SymbolChart';

interface Props {
  symbol: string;
}

const TIMEFRAMES: ChartTimeframe[] = ['1m', '1h'];

/** All symbols in this app are USDT pairs (e.g. "BTCUSDT" -> "BTC_USDT"). */
function binanceSpotUrl(symbol: string): string {
  const base = symbol.slice(0, -4);
  return `https://www.binance.com/es-AR/trade/${base}_USDT?type=spot`;
}

export function SymbolChartCard({ symbol }: Props) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1m');

  return (
    <div className="rounded border border-gray-800 bg-gray-900 p-3">
      <div className="flex items-center justify-between mb-2">
        <a
          href={binanceSpotUrl(symbol)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-sm text-yellow-400 hover:underline"
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
      <SymbolChart symbol={symbol} timeframe={timeframe} />
    </div>
  );
}
