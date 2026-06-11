import { ObserverData, ApiResponse, ImpulseTrackingSnapshot } from '../types';
import { useApi } from '../hooks/useApi';

const API_URL = 'http://localhost:3000/api/observers';
const REFETCH_INTERVAL_MS = 2000;

function fmtPrice(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toFixed(8);
}

function fmtTime(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return `${(ms / 1000).toFixed(2)}s`;
}

function Flag({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={active ? 'text-green-400 font-semibold' : 'text-gray-600'}>
      {active ? '✓' : '✗'} {label}
    </span>
  );
}

function ImpulseCell({ t }: { t: ImpulseTrackingSnapshot }) {
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <div className="flex gap-3">
        <Flag active={t.allowed} label="allowed" />
        <Flag active={t.readyToBuy} label="ready" />
      </div>
      <div className="text-gray-400">
        floor: <span className="text-gray-200">{fmtPrice(t.floor)}</span>
        {t.currentElapsedTime != null && (
          <span className="ml-2 text-yellow-400">{fmtTime(t.currentElapsedTime)}</span>
        )}
      </div>
      <div className="text-gray-400">
        avg: <span className="text-gray-200">{fmtTime(t.averageTime)}</span>
      </div>
    </div>
  );
}

function Row({ obs, index }: { obs: ObserverData; index: number }) {
  const bg = index % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800';
  const dimmed = !obs.isReady ? 'opacity-40' : '';
  const highlight = obs.impulseTracking.readyToBuy ? 'ring-1 ring-inset ring-green-500' : '';

  return (
    <tr className={`${bg} ${dimmed} ${highlight} hover:bg-gray-700 transition-colors`}>
      <td className="px-4 py-2 font-mono font-semibold text-yellow-400 whitespace-nowrap">
        {obs.symbol}
      </td>
      <td className="px-4 py-2 text-right font-mono">{fmtPrice(obs.candle1s?.close)}</td>
      <td className="px-4 py-2 text-right font-mono">{fmtPrice(obs.candle1m?.close)}</td>
      <td className="px-4 py-2 text-right font-mono text-blue-400">{fmtPrice(obs.ma99)}</td>
      <td className="px-4 py-2 text-right font-mono text-purple-400">
        {obs.impulseTracking.counter}
      </td>
      <td className="px-4 py-3 min-w-[200px]">
        <ImpulseCell t={obs.impulseTracking} />
      </td>
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
            <th className="px-4 py-3 text-right">Hits</th>
            <th className="px-4 py-3 text-left">Impulse</th>
          </tr>
        </thead>
        <tbody>
          {observers.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
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
