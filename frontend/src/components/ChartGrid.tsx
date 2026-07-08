import { useState } from 'react';
import { ObserverData } from '../types';
import { SymbolChartCard } from './SymbolChartCard';
import { useOrders } from '../hooks/useOrders';
import { useOrderSizes } from '../hooks/useOrderSizes';

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

  const visible = observers.filter(o => o.qualifies || pinnedSymbols.has(o.symbol));
  const pinned = visible.filter(o => pinnedSymbols.has(o.symbol));
  const unpinned = visible.filter(o => !pinnedSymbols.has(o.symbol));
  const orderedSymbols = [...pinned, ...unpinned];

  const { sizes } = useOrderSizes(orderedSymbols.map(o => o.symbol));

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

  if (visible.length === 0) {
    return <p className="text-gray-500 text-sm">No symbols currently qualify.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {orderedSymbols.map(o => (
        <SymbolChartCard
          key={o.symbol}
          symbol={o.symbol}
          isPinned={pinnedSymbols.has(o.symbol)}
          onTogglePin={() => togglePin(o.symbol)}
          activeOrder={activeOrders.find(order => order.symbol === o.symbol) ?? null}
          orderSize={sizes[o.symbol] ?? 0}
          onBuy={() => buySymbol(o.symbol)}
        />
      ))}
    </div>
  );
}
