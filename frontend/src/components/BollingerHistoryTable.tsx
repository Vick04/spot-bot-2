import { BollingerCandle } from '../types';
import { fmtPrice, fmtDateTime } from '../utils/format';

interface Props {
  history: BollingerCandle[];
}

export function BollingerHistoryTable({ history }: Props) {
  // Newest first
  const sorted = [...history].reverse();

  return (
    <div className="rounded-lg border border-gray-700">
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wider text-gray-400">Closed 1h candles</h2>
        <span className="text-xs text-gray-500">{history.length} candles</span>
      </div>
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="w-full text-gray-100">
          <thead className="sticky top-0">
            <tr className="bg-gray-950 text-gray-400 uppercase text-xs tracking-wider">
              <th className="px-3 py-2 text-left">Open time</th>
              <th className="px-3 py-2 text-right">Open</th>
              <th className="px-3 py-2 text-right">High</th>
              <th className="px-3 py-2 text-right">Low</th>
              <th className="px-3 py-2 text-right">Close</th>
              <th className="px-3 py-2 text-right">MA20</th>
              <th className="px-3 py-2 text-right">MA99</th>
              <th className="px-3 py-2 text-right">BB Upper</th>
              <th className="px-3 py-2 text-right">BB Lower</th>
              <th className="px-3 py-2 text-right">BB Width</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-500 text-sm">
                  No history yet.
                </td>
              </tr>
            ) : (
              sorted.map((c, i) => {
                const bg = i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800';
                const closeColor = c.close >= c.open ? 'text-green-400' : 'text-red-400';
                return (
                  <tr key={c.openTime} className={`${bg} hover:bg-gray-700 transition-colors text-xs`}>
                    <td className="px-3 py-1.5 font-mono text-gray-400">{fmtDateTime(c.openTime)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(c.open)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-green-400/70">{fmtPrice(c.high)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-red-400/70">{fmtPrice(c.low)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono font-semibold ${closeColor}`}>{fmtPrice(c.close)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-yellow-400">{fmtPrice(c.ma20)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-blue-400">{fmtPrice(c.ma99)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-purple-400">{fmtPrice(c.bbUpper)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-purple-400">{fmtPrice(c.bbLower)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-pink-400">{c.bbWidth != null ? `${c.bbWidth.toFixed(3)}%` : '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
