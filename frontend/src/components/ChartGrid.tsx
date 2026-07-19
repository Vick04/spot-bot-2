import { ObserverData } from '../types';
import { SymbolChartCard } from './SymbolChartCard';
import { useOrders } from '../hooks/useOrders';
import { useOrderSizes } from '../hooks/useOrderSizes';

interface Props {
  observers: ObserverData[];
}

/** Mirrors backend/src/managers/BotManager.ts's ZIGZAG_ENABLED_SYMBOLS --
 * that constant is the source of truth; keep both in sync by hand. */
const ZIGZAG_ENABLED_SYMBOLS = new Set(['BTCUSDT']);

export function ChartGrid({ observers }: Props) {
  const { activeOrders } = useOrders();

  const enabled = observers.filter(o => ZIGZAG_ENABLED_SYMBOLS.has(o.symbol));
  const { sizes } = useOrderSizes(enabled.map(o => o.symbol));

  if (enabled.length === 0) {
    return <p className="text-gray-500 text-sm">No ZigZag-enabled symbols yet.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {enabled.map(o => (
        <SymbolChartCard
          key={o.symbol}
          symbol={o.symbol}
          zigzag={o.zigzag}
          performance={o.performance}
          activeOrder={activeOrders.find(order => order.symbol === o.symbol) ?? null}
          orderSize={sizes[o.symbol] ?? 0}
        />
      ))}
    </div>
  );
}
