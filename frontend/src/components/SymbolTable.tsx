import { useState, useMemo } from 'react';
import { ObserverData } from '../types';
import { fmtPrice, fmtTime, getBinanceLink } from '../utils/format';

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

type SortKey = 'symbol' | 'close1s' | 'close1m' | 'ma99' | 'hits' | 'floor' | 'allowed' | 'reached' | 'elapsed' | 'avg';
type SortDir = 'asc' | 'desc';

function getValue(obs: ObserverData, key: SortKey): string | number {
  const t = obs.impulseTracking;
  switch (key) {
    case 'symbol':  return obs.symbol;
    case 'close1s': return obs.candle1s?.close     ?? -Infinity;
    case 'close1m': return obs.candle1m?.close     ?? -Infinity;
    case 'ma99':    return obs.ma99                ?? -Infinity;
    case 'hits':    return t.counter;
    case 'floor':   return t.floor                 ?? -Infinity;
    case 'allowed': return t.allowed ? 1 : 0;
    case 'reached': return t.reached ? 1 : 0;
    case 'elapsed': return t.currentElapsedTime    ?? -Infinity;
    case 'avg':     return t.averageTime           ?? -Infinity;
  }
}

function sortObservers(list: ObserverData[], key: SortKey, dir: SortDir): ObserverData[] {
  return [...list].sort((a, b) => {
    const av = getValue(a, key);
    const bv = getValue(b, key);
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Header cell
// ---------------------------------------------------------------------------

interface ThProps {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  align?: 'left' | 'right' | 'center';
  onSort: (key: SortKey) => void;
}

function Th({ label, sortKey, current, dir, align = 'right', onSort }: ThProps) {
  const active = current === sortKey;
  const arrow = active ? (dir === 'asc' ? ' ↑' : ' ↓') : '';
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`px-3 py-3 text-${align} uppercase text-xs tracking-wider cursor-pointer select-none whitespace-nowrap
        ${active ? 'text-white' : 'text-gray-400'} hover:text-gray-200 transition-colors`}
    >
      {label}{arrow}
    </th>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function Row({ obs, index }: { obs: ObserverData; index: number }) {
  const t = obs.impulseTracking;
  const bg = index % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800';
  const dimmed = !obs.isReady ? 'opacity-40' : '';
  const highlight = t.readyToBuy ? 'ring-1 ring-inset ring-green-500' : '';

  return (
    <tr className={`${bg} ${dimmed} ${highlight} hover:bg-gray-700 transition-colors text-xs`}>
      <td className="px-3 py-1.5 font-mono font-semibold text-yellow-400 whitespace-nowrap">
        <a href={getBinanceLink(obs.symbol)} target="_blank" rel="noopener noreferrer" className="hover:text-yellow-300 underline">
          {obs.symbol}
        </a>
      </td>
      <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(obs.candle1s?.close)}</td>
      <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(obs.candle1m?.close)}</td>
      <td className="px-3 py-1.5 text-right font-mono text-blue-400">{fmtPrice(obs.ma99)}</td>
      <td className="px-3 py-1.5 text-right font-mono text-purple-400">{t.counter}</td>
      <td className="px-3 py-1.5 text-right font-mono">{fmtPrice(t.floor)}</td>
      <td className={`px-3 py-1.5 text-center font-mono ${t.allowed ? 'text-green-400' : 'text-gray-600'}`}>
        {t.allowed ? '✓' : '✗'}
      </td>
      <td className={`px-3 py-1.5 text-center font-mono ${t.reached ? 'text-green-400' : 'text-gray-600'}`}>
        {t.reached ? '✓' : '✗'}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-yellow-400">{fmtTime(t.currentElapsedTime)}</td>
      <td className="px-3 py-1.5 text-right font-mono text-gray-300">{fmtTime(t.averageTime)}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

interface Props { observers: ObserverData[]; }

export function SymbolTable({ observers }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('symbol');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted = useMemo(
    () => sortObservers(observers, sortKey, sortDir),
    [observers, sortKey, sortDir],
  );

  const th = { current: sortKey, dir: sortDir, onSort: handleSort };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-gray-100">
        <thead>
          <tr className="bg-gray-950">
            <Th label="Symbol"   sortKey="symbol"  align="left"   {...th} />
            <Th label="Close 1s" sortKey="close1s"                {...th} />
            <Th label="Close 1m" sortKey="close1m"                {...th} />
            <Th label="MA99"     sortKey="ma99"                   {...th} />
            <Th label="Hits"     sortKey="hits"                   {...th} />
            <Th label="Floor"    sortKey="floor"                  {...th} />
            <Th label="Allowed"  sortKey="allowed" align="center" {...th} />
            <Th label="Reached"  sortKey="reached" align="center" {...th} />
            <Th label="Elapsed"  sortKey="elapsed"                {...th} />
            <Th label="Avg"      sortKey="avg"                    {...th} />
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={10} className="px-4 py-8 text-center text-gray-500 text-sm">
                Waiting for data...
              </td>
            </tr>
          ) : (
            sorted.map((obs, i) => <Row key={obs.symbol} obs={obs} index={i} />)
          )}
        </tbody>
      </table>
    </div>
  );
}
