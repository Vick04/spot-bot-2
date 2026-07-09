import { useState } from 'react';
import { ObserverData } from '../types';
import { SymbolChartCard } from './SymbolChartCard';
import { useOrders } from '../hooks/useOrders';
import { useOrderSizes } from '../hooks/useOrderSizes';
import { groupObservers, PerformanceWindow } from './chartGrouping';

interface Props {
  observers: ObserverData[];
}

const SORT_OPTIONS: { value: PerformanceWindow | ''; label: string }[] = [
  { value: '', label: 'Sin ordenar' },
  { value: 'h24', label: '24h' },
  { value: 'h12', label: '12h' },
  { value: 'h6', label: '6h' },
  { value: 'h3', label: '3h' },
  { value: 'h1', label: '1h' },
];

export function ChartGrid({ observers }: Props) {
  const [pinnedSymbols, setPinnedSymbols] = useState<Set<string>>(new Set());
  const [sortWindow, setSortWindow] = useState<PerformanceWindow | null>(null);
  const { activeOrders } = useOrders();

  const togglePin = (symbol: string) => {
    setPinnedSymbols(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  };

  const { ready, watching } = groupObservers(observers, pinnedSymbols, sortWindow);
  const allVisible = [...ready, ...watching];

  const { sizes } = useOrderSizes(allVisible.map(o => o.symbol));

  const buySymbol = (symbol: string) => {
    fetch('/api/orders/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    }).catch(() => {
      // The order:opened socket event (via useOrders) is the source of
      // truth; a failed request just means nothing changes.
    });
  };

  const renderGrid = (group: ObserverData[], isReadyGroup: boolean) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {group.map(o => (
        <SymbolChartCard
          key={o.symbol}
          symbol={o.symbol}
          isPinned={pinnedSymbols.has(o.symbol)}
          onTogglePin={() => togglePin(o.symbol)}
          isReady={isReadyGroup}
          performance={o.performance}
          activeOrder={activeOrders.find(order => order.symbol === o.symbol) ?? null}
          orderSize={sizes[o.symbol] ?? 0}
          onBuy={() => buySymbol(o.symbol)}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
        <label htmlFor="sort-window">Ordenar por rendimiento:</label>
        <select
          id="sort-window"
          value={sortWindow ?? ''}
          onChange={e => setSortWindow(e.target.value === '' ? null : (e.target.value as PerformanceWindow))}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200"
        >
          {SORT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {allVisible.length === 0 ? (
        <p className="text-gray-500 text-sm">No symbols currently qualify.</p>
      ) : (
        <>
          {ready.length > 0 && (
            <section>
              <h2 className="text-sm font-mono text-green-400 mb-2">Ready</h2>
              {renderGrid(ready, true)}
            </section>
          )}
          {watching.length > 0 && (
            <section>
              <h2 className="text-sm font-mono text-gray-400 mb-2">Watching</h2>
              {renderGrid(watching, false)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
