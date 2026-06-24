import { useState } from 'react';
import { useSocket } from './hooks/useSocket';
import { SymbolTable } from './components/SymbolTable';
import { Top25Table } from './components/Top25Table';
import { ReadyTable } from './components/ReadyTable';
import { OrdersPanel } from './components/OrdersPanel';
import { BollingerPage } from './pages/BollingerPage';

type Page = 'bot' | 'bollinger';
type Tab = 'all' | 'top25' | 'ready' | 'orders';

const PAGES: { id: Page; label: string }[] = [
  { id: 'bot',       label: 'Trading Bot'   },
  { id: 'bollinger', label: 'Bollinger Lab' },
];

const TABS: { id: Tab; label: string }[] = [
  { id: 'all',    label: 'All Symbols' },
  { id: 'top25',  label: 'Top 25'      },
  { id: 'ready',  label: 'Ready'       },
  { id: 'orders', label: 'Orders'      },
];

export default function App() {
  const [page, setPage] = useState<Page>('bot');
  const [tab, setTab] = useState<Tab>('all');
  const { observers, top25, orderStatus, orderHistory, connected } = useSocket();

  const observerList = Array.from(observers.values());
  const readyList = observerList.filter(o => o.impulseTracking.readyToBuy);
  const top25WithData = top25.map(entry => ({
    ...entry,
    obs: observers.get(entry.symbol) ?? null,
  }));

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-yellow-400">SPOT</span>
              <span className="text-gray-400 font-light ml-1">BOT v2.0</span>
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">Live market observer</p>
          </div>
          <nav className="flex gap-1">
            {PAGES.map(p => (
              <button
                key={p.id}
                onClick={() => setPage(p.id)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  page === p.id
                    ? 'bg-yellow-400/10 text-yellow-400'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </nav>
        </div>
        <div className={`flex items-center gap-2 text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </header>

      {page === 'bot' && (
        <div className="border-b border-gray-800 px-6">
          <nav className="flex gap-1">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-yellow-400 text-yellow-400'
                    : 'border-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                {t.label}
                {t.id === 'ready' && readyList.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded text-xs bg-green-500 text-black font-bold">
                    {readyList.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      )}

      <main className="px-6 py-6">
        {page === 'bollinger' ? (
          <BollingerPage />
        ) : (
          <>
            {tab === 'all'    && <SymbolTable observers={observerList} />}
            {tab === 'top25'  && <Top25Table entries={top25WithData} />}
            {tab === 'ready'  && <ReadyTable observers={readyList} />}
            {tab === 'orders' && <OrdersPanel status={orderStatus} history={orderHistory} observers={observers} />}
          </>
        )}
      </main>
    </div>
  );
}
