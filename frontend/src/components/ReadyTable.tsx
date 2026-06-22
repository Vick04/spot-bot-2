import { ObserverData } from '../types';
import { fmtPrice, fmtTime, getBinanceLink } from '../utils/format';

interface Props { observers: ObserverData[]; }

function Row({ obs, index }: { obs: ObserverData; index: number }) {
  const t = obs.impulseTracking;
  const bg = index % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800';
  return (
    <tr className={`${bg} ring-1 ring-inset ring-green-500 hover:bg-gray-700 transition-colors text-xs`}>
      <td className="px-3 py-1.5 font-mono font-semibold text-yellow-400 whitespace-nowrap">
        <a href={getBinanceLink(obs.symbol)} target="_blank" rel="noopener noreferrer" className="hover:text-yellow-300 underline">
          {obs.symbol}
        </a>
      </td>
      <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(obs.candle1s?.close)}</td>
      <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(obs.candle1m?.close)}</td>
      <td className="px-3 py-1.5 text-right font-mono text-blue-400">{fmtPrice(obs.ma99)}</td>
      <td className="px-3 py-1.5 text-right font-mono text-purple-400">{t.counter}</td>
      <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(t.allowedPrice)}</td>
      <td className="px-3 py-1.5 text-right font-mono text-yellow-400">{fmtTime(t.currentElapsedTime)}</td>
      <td className="px-3 py-1.5 text-right font-mono text-gray-300">{fmtTime(t.averageTime)}</td>
    </tr>
  );
}

export function ReadyTable({ observers }: Props) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Top 25 symbols with <span className="text-green-400">allowed = true</span> and elapsed ≤ 10s.
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
              <th className="px-3 py-3 text-right">Allowed Price</th>
              <th className="px-3 py-3 text-right">Elapsed</th>
              <th className="px-3 py-3 text-right">Avg</th>
            </tr>
          </thead>
          <tbody>
            {observers.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500 text-sm">
                  No symbols ready to buy right now.
                </td>
              </tr>
            ) : (
              observers.map((obs, i) => <Row key={obs.symbol} obs={obs} index={i} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
