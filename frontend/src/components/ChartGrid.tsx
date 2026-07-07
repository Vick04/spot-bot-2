import { ObserverData } from '../types';
import { SymbolChartCard } from './SymbolChartCard';

interface Props {
  observers: ObserverData[];
}

export function ChartGrid({ observers }: Props) {
  const qualifying = observers.filter(o => o.qualifies);

  if (qualifying.length === 0) {
    return <p className="text-gray-500 text-sm">No symbols currently qualify.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {qualifying.map(o => (
        <SymbolChartCard key={o.symbol} symbol={o.symbol} />
      ))}
    </div>
  );
}
