import { useState } from 'react';
import { useSocket } from './hooks/useSocket';
import { ChartGrid } from './components/ChartGrid';
import { OrdersView } from './components/OrdersView';

type Tab = 'charts' | 'orders';

export default function App() {
  const { observers, connected } = useSocket();
  const [tab, setTab] = useState<Tab>('charts');
  const observerList = Array.from(observers.values());

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            <span className="text-yellow-400">SPOT</span>
            <span className="text-gray-400 font-light ml-1">BOT</span>
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">ZigZag auto-trader</p>
        </div>
        <div className={`flex items-center gap-2 text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </header>

      <div className="px-6 pt-4 flex gap-2">
        <button
          onClick={() => setTab('charts')}
          className={`px-3 py-1.5 text-sm rounded ${tab === 'charts' ? 'bg-yellow-400 text-black' : 'bg-gray-900 text-gray-400'}`}
        >
          Charts
        </button>
        <button
          onClick={() => setTab('orders')}
          className={`px-3 py-1.5 text-sm rounded ${tab === 'orders' ? 'bg-yellow-400 text-black' : 'bg-gray-900 text-gray-400'}`}
        >
          Active Orders
        </button>
      </div>

      <main className="px-6 py-6">
        {tab === 'charts' ? <ChartGrid observers={observerList} /> : <OrdersView />}
      </main>
    </div>
  );
}
