import { ObserverData } from '../types';

function isReady(o: ObserverData): boolean {
  return o.reasons.m1.step2 || o.reasons.h1.step2;
}

function isWatching(o: ObserverData): boolean {
  return o.reasons.m1.step1 || o.reasons.h1.step1;
}

function orderByPin(group: ObserverData[], pinnedSymbols: Set<string>): ObserverData[] {
  const pinned = group.filter(o => pinnedSymbols.has(o.symbol));
  const unpinned = group.filter(o => !pinnedSymbols.has(o.symbol));
  return [...pinned, ...unpinned];
}

/** Splits observers into "ready" (m1 or h1 reached step2) and "watching"
 * (step1 reached on some track, but step2 on none) — symbols with neither
 * step on either track are dropped entirely, pin status notwithstanding.
 * Within each returned group, pinned symbols sort first. */
export function groupObservers(
  observers: ObserverData[],
  pinnedSymbols: Set<string>
): { ready: ObserverData[]; watching: ObserverData[] } {
  const ready = observers.filter(isReady);
  const watching = observers.filter(o => !isReady(o) && isWatching(o));
  return {
    ready: orderByPin(ready, pinnedSymbols),
    watching: orderByPin(watching, pinnedSymbols),
  };
}
