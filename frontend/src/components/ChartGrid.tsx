import { useState } from 'react';
import { ObserverData } from '../types';
import { SymbolChartCard } from './SymbolChartCard';
import { useOrders } from '../hooks/useOrders';
import { useOrderSizes } from '../hooks/useOrderSizes';
import { groupObservers } from './chartGrouping';

interface Props {
  observers: ObserverData[];
}

export function ChartGrid({ observers }: Props) {
  const [pinnedSymbols, setPinnedSymbols] = useState<Set<string>>(new Set());
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

  const { ready, watching } = groupObservers(observers, pinnedSymbols);
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

  if (allVisible.length === 0) {
    return <p className="text-gray-500 text-sm">No symbols currently qualify.</p>;
  }

  const renderGrid = (group: ObserverData[], isReadyGroup: boolean) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {group.map(o => (
        <SymbolChartCard
          key={o.symbol}
          symbol={o.symbol}
          isPinned={pinnedSymbols.has(o.symbol)}
          onTogglePin={() => togglePin(o.symbol)}
          isReady={isReadyGroup}
          activeOrder={activeOrders.find(order => order.symbol === o.symbol) ?? null}
          orderSize={sizes[o.symbol] ?? 0}
          onBuy={() => buySymbol(o.symbol)}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
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
    </div>
  );
}
