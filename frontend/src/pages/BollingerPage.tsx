import { useState } from 'react';
import { useBollingerSocket } from '../hooks/useBollingerSocket';
import { getBinanceLink } from '../utils/format';

type Filter = 'all' | 'active';

function StatCard({ label, value, color = '' }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg bg-gray-800 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-mono font-semibold ${color}`}>{value}</p>
    </div>
  );
}

export function BollingerPage() {
  const { snapshot, connected } = useBollingerSocket();
  const [filter, setFilter] = useState<Filter>('active');
  const { perSymbol, stats } = snapshot;

  const rows = filter === 'active' ? perSymbol.filter(s => s.total > 0) : perSymbol;
  const winRatePct = (stats.winRate * 100).toFixed(1);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-gray-500">
          1m squeeze→breakout detector · observe-only · {perSymbol.length} symbols ·{' '}
          <span className={connected ? 'text-green-400' : 'text-red-400'}>{connected ? 'live' : 'offline'}</span>
        </p>
        <div className="flex gap-1 text-xs">
          <button
            onClick={() => setFilter('active')}
            className={`px-3 py-1 rounded ${filter === 'active' ? 'bg-yellow-400/10 text-yellow-400' : 'text-gray-400 hover:text-gray-200'}`}
          >Active</button>
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded ${filter === 'all' ? 'bg-yellow-400/10 text-yellow-400' : 'text-gray-400 hover:text-gray-200'}`}
          >All</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard label="Open" value={String(stats.open)} color="text-yellow-400" />
        <StatCard label="Win" value={String(stats.wins)} color="text-green-400" />
        <StatCard label="Fail" value={String(stats.fails)} color="text-red-400" />
        <StatCard label="Flat" value={String(stats.flats)} color="text-gray-300" />
        <StatCard label="Win rate" value={stats.total ? `${winRatePct}%` : '—'} />
      </div>

      <div className="rounded-lg border border-gray-700">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-gray-100">
            <thead className="sticky top-0">
              <tr className="bg-gray-950 text-gray-400 uppercase text-xs tracking-wider">
                <th className="px-3 py-2 text-left">Symbol</th>
                <th className="px-3 py-2 text-center">Buy</th>
                <th className="px-3 py-2 text-right">Open</th>
                <th className="px-3 py-2 text-right">Win</th>
                <th className="px-3 py-2 text-right">Fail</th>
                <th className="px-3 py-2 text-right">Flat</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500 text-sm">
                    No signals yet — detector is warming up and watching.
                  </td>
                </tr>
              ) : (
                rows.map((s, i) => {
                  const bg = i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800';
                  const highlight = s.open > 0 ? 'ring-1 ring-inset ring-yellow-500/50' : '';
                  const buy = s.open > 0
                    ? { label: 'holding', cls: 'text-yellow-400' }
                    : s.blocked
                      ? { label: '🔒 blocked', cls: 'text-red-400' }
                      : { label: 'ready', cls: 'text-green-400' };
                  return (
                    <tr key={s.symbol} className={`${bg} ${highlight} hover:bg-gray-700 transition-colors text-xs`}>
                      <td className="px-3 py-1.5 font-mono font-semibold text-yellow-400">
                        <a href={getBinanceLink(s.symbol)} target="_blank" rel="noopener noreferrer" className="hover:text-yellow-300 underline">
                          {s.symbol}
                        </a>
                      </td>
                      <td className={`px-3 py-1.5 text-center font-mono ${buy.cls}`}>{buy.label}</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${s.open > 0 ? 'text-yellow-400 font-semibold' : 'text-gray-600'}`}>{s.open || '·'}</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${s.win > 0 ? 'text-green-400' : 'text-gray-600'}`}>{s.win || '·'}</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${s.fail > 0 ? 'text-red-400' : 'text-gray-600'}`}>{s.fail || '·'}</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${s.flat > 0 ? 'text-gray-300' : 'text-gray-600'}`}>{s.flat || '·'}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-gray-400">{s.total}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
