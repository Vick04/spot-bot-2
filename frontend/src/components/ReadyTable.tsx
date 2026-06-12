import { ObserverData, ApiResponse } from '../types';
import { useApi } from '../hooks/useApi';

const READY_URL = 'http://localhost:3000/api/ready';
const REFETCH_INTERVAL_MS = 2000;

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toFixed(8);
}

function fmtTime(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return `${(ms / 1000).toFixed(2)}s`;
}

function Row({ obs, index }: { obs: ObserverData; index: number }) {
  const t = obs.impulseTracking;
  const bg = index % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800';

  return (
    <tr className={`${bg} ring-1 ring-inset ring-green-500 hover:bg-gray-700 transition-colors text-xs`}>
      <td className="px-3 py-1.5 font-mono font-semibold text-yellow-400 whitespace-nowrap">
        {obs.symbol}
      </td>
      <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(obs.candle1s?.close)}</td>
      <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(obs.candle1m?.close)}</td>
      <td className="px-3 py-1.5 text-right font-mono text-blue-400">{fmtPrice(obs.ma99)}</td>
      <td className="px-3 py-1.5 text-right font-mono text-purple-400">{t.counter}</td>
      <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(t.floor)}</td>
      <td className="px-3 py-1.5 text-right font-mono text-yellow-400">{fmtTime(t.currentElapsedTime)}</td>
      <td className="px-3 py-1.5 text-right font-mono text-gray-300">{fmtTime(t.averageTime)}</td>
    </tr>
  );
}

export function ReadyTable() {
  const { data, loading, error } = useApi<ApiResponse<ObserverData[]>>(READY_URL, REFETCH_INTERVAL_MS);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;
  }

  if (error) {
    return <div className="flex items-center justify-center h-64 text-red-400">Error: {error}</div>;
  }

  const ready = data?.data ?? [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Top 25 symbols with <span className="text-green-400">allowed = true</span> and elapsed ≤ 10s.
        Refreshes every 2s.
      </p>
      <div className="overflow-x-auto rounded-lg border border-green-900">
        <table className="w-full text-gray-100">
          <thead>
            <tr className="bg-gray-950 text-gray-400 uppercase text-xs tracking-wider">
              <th className="px-3 py-3 text-left">Symbol</th>
              <th className="px-3 py-3 text-right">Close 1s</th>
              <th className="px-3 py-3 text-right">Close 1m</th>
              <th className="px-3 py-3 text-right">MA99</th>
              <th className="px-3 py-3 text-right">Hits</th>
              <th className="px-3 py-3 text-right">Floor</th>
              <th className="px-3 py-3 text-right">Elapsed</th>
              <th className="px-3 py-3 text-right">Avg</th>
            </tr>
          </thead>
          <tbody>
            {ready.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500 text-sm">
                  No symbols ready to buy right now.
                </td>
              </tr>
            ) : (
              ready.map((obs, i) => <Row key={obs.symbol} obs={obs} index={i} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
