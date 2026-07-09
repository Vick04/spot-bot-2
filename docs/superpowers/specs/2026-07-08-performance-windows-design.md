# Per-symbol performance windows + sort — design

## Problem

Symbol cards show price/target/order-size but nothing about recent momentum. Traders want to see, at a glance, how each symbol has performed over the last 24h/12h/6h/3h/1h, and be able to sort the grid by that performance to surface the strongest movers first.

## Calculation

For each window `N ∈ {24, 12, 6, 3, 1}` (hours), performance is a percentage change computed from **closed 1h candles only** (consistent with this app's existing close-only signal design, not the live 1s tick):

```
perf(N) = (lastClosed1hClose - close1hCandleFromNHoursAgo) / close1hCandleFromNHoursAgo * 100
```

Where `lastClosed1hClose` is the most recent element of the observer's `closed1h` buffer, and "N hours ago" is the element `N` positions before it in that same buffer (index `length - 1 - N`).

If the buffer doesn't yet have `N + 1` candles (e.g. shortly after backend startup for a low-history symbol, or in the minutes before the first hourly close), that window's value is `null`.

## Backend architecture

### `backend/src/utils/performance.ts` (new file)

A pure function, no side effects, mirroring the style of `backend/src/utils/signals.ts`:

```ts
export interface PerformanceWindows {
  h24: number | null;
  h12: number | null;
  h6: number | null;
  h3: number | null;
  h1: number | null;
}

const WINDOWS: { key: keyof PerformanceWindows; hours: number }[] = [
  { key: 'h24', hours: 24 },
  { key: 'h12', hours: 12 },
  { key: 'h6', hours: 6 },
  { key: 'h3', hours: 3 },
  { key: 'h1', hours: 1 },
];

export function computePerformance(closed1h: { close: number }[]): PerformanceWindows {
  const result = {} as PerformanceWindows;
  for (const { key, hours } of WINDOWS) {
    const len = closed1h.length;
    if (len <= hours) {
      result[key] = null;
      continue;
    }
    const current = closed1h[len - 1].close;
    const past = closed1h[len - 1 - hours].close;
    result[key] = ((current - past) / past) * 100;
  }
  return result;
}
```

### `backend/src/types/index.ts`

Add `PerformanceWindows` (same shape as above) and add `performance: PerformanceWindows` to `ObserverState`.

### `backend/src/observers/Observer.ts`

- New private field `performance: PerformanceWindows`, initialized via `computePerformance([])` (all `null`).
- Recomputed in exactly two places, both using the full `closed1h` buffer after it's updated:
  - At the end of `preloadClosed1h()` (once, after the loop — not per-candle like the step1/step2 replay, since performance has no stickiness or history dependency beyond "what's the buffer right now").
  - In the `isClosed` branch of `updateCandle1h()`, after pushing the new candle.
- `getState()` includes `performance: this.performance`.

### `backend/src/managers/ObserverManager.ts`

`updateCandle()`'s emit gate (already comparing individual `reasons` booleans per the prior fix) gets one more OR clause: also emit `'signal'` when `candle.timeframe === '1h' && candle.isClosed` — performance always changes (or stays exactly the same only in the edge case of a flat market, which is fine to still emit for) on every 1h close, so this is unconditional on that trigger rather than a deep-equal check on the five floats.

### No REST endpoint changes

`ObserverState` already flows through the existing `/api/observers` snapshot route and the `signal`/initial-snapshot socket events — `performance` rides along for free once it's part of the type.

## Frontend architecture

### `frontend/src/types/index.ts`

Mirror `PerformanceWindows` exactly; add `performance: PerformanceWindows` to `ObserverData`.

### `frontend/src/components/SymbolChartCard.tsx`

New compact row inserted between the existing header (`<div className="flex items-center justify-between mb-2">`) and the chart (`<SymbolChart .../>`). Five labeled values, ordered 24h → 1h:

```
24h        12h        6h        3h        1h
+3.42%     -1.05%     +0.80%    —         +0.12%
```

Formatting: `value === null ? '—' : \`${value >= 0 ? '+' : ''}${value.toFixed(2)}%\``, colored `text-green-400` (positive), `text-red-400` (negative), `text-gray-500` (null). Each value has a small gray label above/beside it (`24h`, `12h`, etc.) at the same visual weight as the existing timeframe toggle labels.

### `frontend/src/components/chartGrouping.ts`

`groupObservers()` gains an optional third parameter:

```ts
export type PerformanceWindow = keyof PerformanceWindows; // 'h24' | 'h12' | 'h6' | 'h3' | 'h1'

export function groupObservers(
  observers: ObserverData[],
  pinnedSymbols: Set<string>,
  sortWindow: PerformanceWindow | null = null
): { ready: ObserverData[]; watching: ObserverData[] }
```

`orderByPin()` (internal) keeps its existing pinned-first partition, then within each partition:
- `sortWindow === null`: unchanged — preserve the incoming relative order (no sort), exactly today's behavior.
- `sortWindow` set: sort descending by `observer.performance[sortWindow]`, treating `null` as sorting last (e.g. compare with `(a, b) => (b.performance[sortWindow] ?? -Infinity) - (a.performance[sortWindow] ?? -Infinity)`).

This is a backward-compatible signature change — existing callers omitting the third argument behave identically to before.

### `frontend/src/components/ChartGrid.tsx`

- New `useState<PerformanceWindow | null>(null)` for the selected sort window.
- A `<select>` above the two sections (Ready/Watching), options: "Sin ordenar" (value `""`/null) and 24h/12h/6h/3h/1h. On change, updates the state and re-renders; `groupObservers(observers, pinnedSymbols, sortWindow)` picks it up automatically since `ready`/`watching` are recomputed on every render.
- One selector affects both sections identically (per the confirmed design — no per-section selector).

## Out of scope

- No historical performance charting/graph — only the five point-in-time percentages.
- No persistence of the selected sort window across reloads (resets to "Sin ordenar" like pin state does).
- No change to the Ready/Watching membership rules (step1/step2) — this is purely an additional display + sort axis layered on the existing grouping.
- No new socket event type — reuses the existing `signal` event, just broadens when it fires.
