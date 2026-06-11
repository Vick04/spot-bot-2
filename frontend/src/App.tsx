import { SymbolTable } from './components/SymbolTable';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4">
        <h1 className="text-xl font-bold tracking-tight">
          <span className="text-yellow-400">SPOT</span>
          <span className="text-gray-400 font-light ml-1">BOT v2.0</span>
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">Live market observer</p>
      </header>

      <main className="px-6 py-6">
        <SymbolTable />
      </main>
    </div>
  );
}
