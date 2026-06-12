import { OrderStatus, CompletedOrder } from '../types';
import { fmtPrice, fmtUsdt, fmtDuration } from '../utils/format';

const TOGGLE_URL = 'http://localhost:3000/api/orders/toggle';
const FORCE_SELL_URL = 'http://localhost:3000/api/orders/force-sell';
const BOT_RESET_URL = 'http://localhost:3000/api/bot/reset';

interface Props {
  status: OrderStatus;
  history: CompletedOrder[];
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function ToggleButton({ enabled }: { enabled: boolean }) {
  function handleClick() {
    fetch(TOGGLE_URL, { method: 'POST' });
  }

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
        enabled
          ? 'bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30'
          : 'bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30'
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${enabled ? 'bg-red-400 animate-pulse' : 'bg-gray-600'}`} />
      {enabled ? 'Disable OrderManager' : 'Enable OrderManager'}
    </button>
  );
}

function ForceSellButton() {
  function handleClick() {
    fetch(FORCE_SELL_URL, { method: 'POST' });
  }

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors bg-orange-500/20 border border-orange-500/50 text-orange-400 hover:bg-orange-500/30"
    >
      Force Sell
    </button>
  );
}

function ResetBotButton() {
  function handleClick() {
    fetch(BOT_RESET_URL, { method: 'POST' });
  }

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors bg-gray-500/20 border border-gray-500/50 text-gray-300 hover:bg-gray-500/30"
    >
      Reset Bot
    </button>
  );
}

function ActiveOrderCard({ status }: { status: OrderStatus }) {
  const o = status.activeOrder;

  return (
    <div className="rounded-lg border border-gray-700 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wider text-gray-400">Account</h2>
        <div className="flex items-center gap-2">
          {o && <ForceSellButton />}
          <ResetBotButton />
          <ToggleButton enabled={status.enabled} />
        </div>
      </div>

      <div className="flex gap-8">
        <div>
          <p className="text-xs text-gray-500">Balance</p>
          <p className="text-lg font-mono font-semibold text-yellow-400">
            {fmtUsdt(status.balance)} <span className="text-xs text-gray-400">USDT</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Total trades</p>
          <p className="text-lg font-mono font-semibold">{status.totalTrades}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Total profit</p>
          <p className={`text-lg font-mono font-semibold ${status.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {status.totalProfit >= 0 ? '+' : ''}{fmtUsdt(status.totalProfit)} <span className="text-xs text-gray-400">USDT</span>
          </p>
        </div>
      </div>

      {o ? (
        <div className="rounded-lg bg-gray-800 border border-yellow-500/30 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-xs font-semibold text-yellow-400 uppercase tracking-wider">Active position</span>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs font-mono">
            <div className="text-gray-400">Symbol</div>
            <div className="text-yellow-400 font-semibold">{o.symbol}</div>
            <div className="text-gray-400">Buy price</div>
            <div>{fmtPrice(o.buyPrice)}</div>
            <div className="text-gray-400">Target price</div>
            <div className="text-green-400">{fmtPrice(o.targetPrice)}</div>
            <div className="text-gray-400">Quantity</div>
            <div>{o.quantity.toFixed(6)}</div>
            <div className="text-gray-400">USDT spent</div>
            <div>{fmtUsdt(o.usdtSpent)}</div>
            <div className="text-gray-400">Opened at</div>
            <div>{fmtDate(o.openedAt)}</div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-gray-800 border border-gray-700 p-3 text-xs text-gray-500 text-center">
          No active position
        </div>
      )}
    </div>
  );
}

function HistoryTable({ history }: { history: CompletedOrder[] }) {
  const sorted = [...history].reverse();

  return (
    <div className="rounded-lg border border-gray-700">
      <div className="px-4 py-3 border-b border-gray-700">
        <h2 className="text-xs uppercase tracking-wider text-gray-400">Trade history</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-gray-100">
          <thead>
            <tr className="bg-gray-950 text-gray-400 uppercase text-xs tracking-wider">
              <th className="px-3 py-2 text-left">Symbol</th>
              <th className="px-3 py-2 text-right">Buy</th>
              <th className="px-3 py-2 text-right">Sell</th>
              <th className="px-3 py-2 text-right">Spent</th>
              <th className="px-3 py-2 text-right">Received</th>
              <th className="px-3 py-2 text-right">Profit</th>
              <th className="px-3 py-2 text-right">%</th>
              <th className="px-3 py-2 text-right">Duration</th>
              <th className="px-3 py-2 text-right">Closed</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-500 text-sm">
                  No completed trades yet.
                </td>
              </tr>
            ) : (
              sorted.map((o, i) => {
                const bg = i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800';
                const profitColor = o.profit >= 0 ? 'text-green-400' : 'text-red-400';
                return (
                  <tr key={o.closedAt} className={`${bg} hover:bg-gray-700 transition-colors text-xs`}>
                    <td className="px-3 py-1.5 font-mono font-semibold text-yellow-400">{o.symbol}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(o.buyPrice)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(o.sellPrice)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmtUsdt(o.usdtSpent)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmtUsdt(o.usdtReceived)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono ${profitColor}`}>
                      {o.profit >= 0 ? '+' : ''}{fmtUsdt(o.profit)}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono ${profitColor}`}>
                      {o.profitPct.toFixed(3)}%
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-gray-400">{fmtDuration(o.durationMs)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-gray-400">{fmtDate(o.closedAt)}</td>
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

export function OrdersPanel({ status, history }: Props) {
  return (
    <div className="space-y-4">
      <ActiveOrderCard status={status} />
      <HistoryTable history={history} />
    </div>
  );
}
