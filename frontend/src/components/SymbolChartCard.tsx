import { useState } from 'react';
import { ChartTimeframe } from '../types';
import { SymbolChart } from './SymbolChart';

interface Props {
  symbol: string;
}

const TIMEFRAMES: ChartTimeframe[] = ['1m', '1h'];

export function SymbolChartCard({ symbol }: Props) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1m');

  return (
    <div className="rounded border border-gray-800 bg-gray-900 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-sm text-yellow-400">{symbol}</span>
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
