import { ObserverData, ApiResponse } from '../types';
import { useApi } from '../hooks/useApi';

const API_URL = 'http://localhost:3000/api/observers';
const REFETCH_INTERVAL_MS = 2000;

function fmt(value: number | null | undefined, decimals: number): string {
  if (value == null) return '—';
  return value.toFixed(decimals);
}

function Row({ obs, index }: { obs: ObserverData; index: number }) {
  const bg = index % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800';
  const dimmed = !obs.isReady ? 'opacity-50' : '';
  return (
    <tr className={`${bg} ${dimmed} hover:bg-gray-700 transition-colors`}>
      <td className="px-4 py-2 font-mono font-semibold text-yellow-400">{obs.symbol}</td>
      <td className="px-4 py-2 text-right font-mono">{fmt(obs.candle1s?.close, 8)}</td>
      <td className="px-4 py-2 text-right font-mono">{fmt(obs.candle1m?.close, 8)}</td>
      <td className="px-4 py-2 text-right font-mono text-blue-400">{fmt(obs.ma99, 8)}</td>
    </tr>
  );
}

export function SymbolTable() {
  const { data, loading, error } = useApi<ApiResponse<ObserverData[]>>(API_URL, REFETCH_INTERVAL_MS);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Connecting to backend...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400">
        Error: {error}
      </div>
    );
  }

  const observers = data?.data ?? [];

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-sm text-gray-100">
        <thead>
          <tr className="bg-gray-950 text-gray-400 uppercase text-xs tracking-wider">
            <th className="px-4 py-3 text-left">Symbol</th>
            <th className="px-4 py-3 text-right">Close 1s</th>
            <th className="px-4 py-3 text-right">Close 1m</th>
            <th className="px-4 py-3 text-right">MA99</th>
          </tr>
        </thead>
        <tbody>
          {observers.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                Waiting for data...
              </td>
            </tr>
          ) : (
            observers.map((obs, i) => <Row key={obs.symbol} obs={obs} index={i} />)
          )}
        </tbody>
      </table>
    </div>
  );
}
