import { useOrders } from '../hooks/useOrders';

function fmtPrice(value: number): string {
  return value.toFixed(6);
}

function fmtElapsed(openedAt: number): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - openedAt) / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

export function OrdersView() {
  const { balance, activeOrders, completedCount, totalProfitPct } = useOrders();

  return (
    <div>
      <div className="mb-4 text-sm text-gray-400 font-mono">
        {completedCount} completadas —{' '}
        <span className={totalProfitPct >= 0 ? 'text-green-400' : 'text-red-400'}>
          {totalProfitPct.toFixed(3)}%
        </span>{' '}
        rendimiento — saldo: <span className="text-gray-200">{balance.toFixed(2)} USDT</span>
      </div>

      {activeOrders.length === 0 ? (
        <p className="text-gray-500 text-sm">No active orders.</p>
      ) : (
        <table className="w-full text-xs font-mono text-left">
          <thead className="text-gray-500 border-b border-gray-800">
            <tr>
              <th className="py-1 pr-4">Symbol</th>
              <th className="py-1 pr-4">Buy price</th>
              <th className="py-1 pr-4">Target</th>
              <th className="py-1 pr-4">Open for</th>
            </tr>
          </thead>
          <tbody>
            {activeOrders.map(order => (
              <tr key={order.symbol} className="border-b border-gray-900">
                <td className="py-1 pr-4 text-yellow-400">{order.symbol}</td>
                <td className="py-1 pr-4">{fmtPrice(order.buyPrice)}</td>
                <td className="py-1 pr-4 text-green-400">{fmtPrice(order.targetPrice)}</td>
                <td className="py-1 pr-4 text-gray-400">{fmtElapsed(order.openedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
