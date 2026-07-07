import { useSocket } from './hooks/useSocket';
import { ChartGrid } from './components/ChartGrid';

export default function App() {
  const { observers, connected } = useSocket();
  const observerList = Array.from(observers.values());
  const qualifyingCount = observerList.filter(o => o.qualifies).length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            <span className="text-yellow-400">SPOT</span>
            <span className="text-gray-400 font-light ml-1">BOT</span>
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Live signal detector — {qualifyingCount} qualifying</p>
        </div>
        <div className={`flex items-center gap-2 text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </header>

      <main className="px-6 py-6">
        <ChartGrid observers={observerList} />
      </main>
    </div>
  );
}
