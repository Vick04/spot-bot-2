import { ObserverData } from '../types';

interface Props {
  observers: ObserverData[];
}

export function QualifyingList({ observers }: Props) {
  const qualifying = observers.filter(o => o.qualifies);

  if (qualifying.length === 0) {
    return <p className="text-gray-500 text-sm">No symbols currently qualify.</p>;
  }

  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
      {qualifying.map(o => (
        <li
          key={o.symbol}
          className="px-3 py-2 rounded bg-gray-900 border border-gray-800 font-mono text-sm text-yellow-400 text-center"
        >
          {o.symbol}
        </li>
      ))}
    </ul>
  );
}
