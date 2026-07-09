import { ObserverData, PerformanceWindows } from '../types';

export type PerformanceWindow = keyof PerformanceWindows;

function isReady(o: ObserverData): boolean {
  return o.reasons.m1.step2 || o.reasons.h1.step2;
}

function isWatching(o: ObserverData): boolean {
  return o.reasons.m1.step1 || o.reasons.h1.step1;
}

/** Descending by performance[sortWindow]; null sorts last. Stable for ties
 * (Array.prototype.sort is stable per spec since ES2019). */
function sortByPerformance(group: ObserverData[], sortWindow: PerformanceWindow): ObserverData[] {
  return [...group].sort((a, b) => {
    const aVal = a.performance[sortWindow];
    const bVal = b.performance[sortWindow];
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return bVal - aVal;
  });
}

function orderByPin(
  group: ObserverData[],
  pinnedSymbols: Set<string>,
  sortWindow: PerformanceWindow | null
): ObserverData[] {
  const pinned = group.filter(o => pinnedSymbols.has(o.symbol));
  const unpinned = group.filter(o => !pinnedSymbols.has(o.symbol));
  if (sortWindow === null) {
    return [...pinned, ...unpinned];
  }
  return [...sortByPerformance(pinned, sortWindow), ...sortByPerformance(unpinned, sortWindow)];
}

/** Splits observers into "ready" (m1 or h1 reached step2) and "watching"
 * (step1 reached on some track, but step2 on none) — symbols with neither
 * step on either track are dropped entirely, pin status notwithstanding.
 * Within each returned group, pinned symbols sort first; within the pinned
 * and unpinned partitions, `sortWindow` (if given) sorts descending by that
 * performance window, with null values last — otherwise the incoming
 * relative order is preserved. */
export function groupObservers(
  observers: ObserverData[],
  pinnedSymbols: Set<string>,
  sortWindow: PerformanceWindow | null = null
): { ready: ObserverData[]; watching: ObserverData[] } {
  const ready = observers.filter(isReady);
  const watching = observers.filter(o => !isReady(o) && isWatching(o));
  return {
    ready: orderByPin(ready, pinnedSymbols, sortWindow),
    watching: orderByPin(watching, pinnedSymbols, sortWindow),
  };
}
