import { SymbolHits, ObserverData, ApiResponse } from '../types';
import { useApi } from '../hooks/useApi';

const TOP25_URL = 'http://localhost:3000/api/top25';
const OBSERVERS_URL = 'http://localhost:3000/api/observers';
const REFETCH_INTERVAL_MS = 2000;

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toFixed(8);
}

function fmtTime(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return `${(ms / 1000).toFixed(2)}s`;
}

export function Top25Table() {
  const { data: top25Data, loading: l1, error: e1 } =
    useApi<ApiResponse<SymbolHits[]>>(TOP25_URL, REFETCH_INTERVAL_MS);

  const { data: observersData, loading: l2, error: e2 } =
    useApi<ApiResponse<ObserverData[]>>(OBSERVERS_URL, REFETCH_INTERVAL_MS);

  if (l1 || l2) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;
  }

  if (e1 || e2) {
    return <div className="flex items-center justify-center h-64 text-red-400">Error: {e1 ?? e2}</div>;
  }

  const top25 = top25Data?.data ?? [];
  const observerMap = new Map<string, ObserverData>(
    (observersData?.data ?? []).map(o => [o.symbol, o])
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-gray-100">
        <thead>
          <tr className="bg-gray-950 text-gray-400 uppercase text-xs tracking-wider">
            <th className="px-3 py-3 text-center w-10">#</th>
            <th className="px-3 py-3 text-left">Symbol</th>
            <th className="px-3 py-3 text-right">Hits</th>
            <th className="px-3 py-3 text-right">Close 1s</th>
            <th className="px-3 py-3 text-right">MA99</th>
            <th className="px-3 py-3 text-right">Floor</th>
            <th className="px-3 py-3 text-center">Allowed</th>
            <th className="px-3 py-3 text-center">Reached</th>
            <th className="px-3 py-3 text-right">Elapsed</th>
            <th className="px-3 py-3 text-right">Avg</th>
          </tr>
        </thead>
        <tbody>
          {top25.length === 0 ? (
            <tr>
              <td colSpan={10} className="px-4 py-8 text-center text-gray-500 text-sm">
                No hits registered yet...
              </td>
            </tr>
          ) : (
            top25.map((entry, i) => {
              const obs = observerMap.get(entry.symbol);
              const t = obs?.impulseTracking;
              const bg = i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800';
              const highlight = t?.readyToBuy ? 'ring-1 ring-inset ring-green-500' : '';

              return (
                <tr key={entry.symbol} className={`${bg} ${highlight} hover:bg-gray-700 transition-colors text-xs`}>
                  <td className="px-3 py-1.5 text-center text-gray-500 font-mono">{i + 1}</td>
                  <td className="px-3 py-1.5 font-mono font-semibold text-yellow-400 whitespace-nowrap">
                    {entry.symbol}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-purple-400">{entry.hits}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(obs?.candle1s?.close)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-blue-400">{fmtPrice(obs?.ma99)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(t?.floor)}</td>
                  <td className={`px-3 py-1.5 text-center font-mono ${t?.allowed ? 'text-green-400' : 'text-gray-600'}`}>
                    {t ? (t.allowed ? '✓' : '✗') : '—'}
                  </td>
                  <td className={`px-3 py-1.5 text-center font-mono ${t?.reached ? 'text-green-400' : 'text-gray-600'}`}>
                    {t ? (t.reached ? '✓' : '✗') : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-yellow-400">{fmtTime(t?.currentElapsedTime)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-gray-300">{fmtTime(t?.averageTime)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
