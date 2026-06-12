import { useState } from 'react';
import { SymbolTable } from './components/SymbolTable';
import { Top25Table } from './components/Top25Table';
import { ReadyTable } from './components/ReadyTable';

type Tab = 'all' | 'top25' | 'ready';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all',   label: 'All Symbols' },
  { id: 'top25', label: 'Top 25'      },
  { id: 'ready', label: 'Ready'       },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('all');

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4">
        <h1 className="text-xl font-bold tracking-tight">
          <span className="text-yellow-400">SPOT</span>
          <span className="text-gray-400 font-light ml-1">BOT v2.0</span>
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">Live market observer</p>
      </header>

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
            </button>
          ))}
        </nav>
      </div>

      <main className="px-6 py-6">
        {tab === 'all'   && <SymbolTable />}
        {tab === 'top25' && <Top25Table />}
        {tab === 'ready' && <ReadyTable />}
      </main>
    </div>
  );
}
