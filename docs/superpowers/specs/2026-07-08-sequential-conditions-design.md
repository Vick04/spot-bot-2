# Sequential qualification conditions — design

## Problem

Symbol visibility in the charts grid currently uses a single, stateless, live-recomputed condition (`bbUpper1m || bbUpper1h`, in `backend/src/utils/signals.ts`): a symbol qualifies the instant its live price crosses above either timeframe's Bollinger upper band, and stops qualifying the instant it doesn't. This gives no sense of where a symbol is in a setup — it either flashes in or it doesn't.

This feature replaces that system entirely with a **sticky, per-timeframe, two-step state machine**, evaluated only on candle close, that tracks each symbol's progress through a setup and splits the grid into two sections so a trader can see symbols "starting to qualify" separately from symbols that are "ready."

## State machine

Each symbol tracks **two independent state machines**, one for its 1m candles and one for its 1h candles. Each machine has two sticky booleans: `step1`, `step2`.

On every **closed** candle for a given timeframe, using that candle's own trailing 20-candle window (itself included) to compute Bollinger bands (`bollingerBands()`, already in `backend/src/utils/indicators.ts`) and the SMA-20 middle band as `ma20`:

1. **Reset** (checked first): if `closed >= bbUpper`, set `step1 = false` and `step2 = false` for that timeframe's machine. Nothing else happens on this close.
2. Otherwise, **step 1**: if `step1` is not already true and `closed <= bbLower`, set `step1 = true`.
3. Otherwise, **step 2**: if `step1` is true, `step2` is not already true, and `closed >= ma20`, set `step2 = true`.

Rules:
- The two timeframes' machines are fully independent. A close on the 1m candle only ever reads/writes the 1m machine's `step1`/`step2`; same for 1h. Step 1 achieved on 1m must be followed by step 2 on 1m specifically — it is never satisfied by an 1h close, and vice versa.
- All three checks (reset, step1, step2) use the **same closed candle's own window** — there is no live/per-tick recomputation. Between closes, the state does not change.
< 20 closed candles available for a timeframe → that close is a no-op (matches existing `CLOSED_WINDOW` guard behavior in `signals.ts`, extended from 19 to 20 since the window here includes the just-closed candle).

## Visibility and grouping

A symbol's overall visibility and grid placement is derived from the OR of both machines:

- **Upper div** ("ready"): `m1.step2 || h1.step2`.
- **Lower div** ("watching"): not upper, and `m1.step1 || h1.step1`.
- **Hidden**: neither step is true on either machine. This includes pinned symbols — pinning no longer forces visibility on its own. Pin only affects sort order *within* whichever div a visible symbol already belongs to (unchanged from current behavior: pinned symbols sort first).

The Buy button and footer (price/target/size) work identically in both divs — `step2` is a visual signal only, not a gate on manual buying.

## Backend architecture

### `backend/src/types/index.ts`

Replace:

```ts
export interface SignalReasons {
  bbUpper1m: boolean;
  bbUpper1h: boolean;
}
```

with:

```ts
export interface TimeframeSignal {
  step1: boolean;
  step2: boolean;
}

export interface SignalReasons {
  m1: TimeframeSignal;
  h1: TimeframeSignal;
}
```

`ObserverState.qualifies` becomes `m1.step1 || m1.step2 || h1.step1 || h1.step2` (true whenever the symbol belongs in either div — used by `ObserverManager` for the existing `chart:tick`/`chart:closed` gating and the `signal` event, both of which just need "is this symbol visible at all," not which div).

### `backend/src/utils/signals.ts`

Replace `detectSignal()`'s live-price-based design with a pure, close-only transition function:

```ts
export interface TimeframeSignal {
  step1: boolean;
  step2: boolean;
}

interface CandleOC {
  open: number;
  close: number;
}

const WINDOW = 20;

export const EMPTY_TIMEFRAME_SIGNAL: TimeframeSignal = { step1: false, step2: false };

/** Advances one timeframe's sticky state machine using the trailing WINDOW
 * closed candles (last element is the just-closed candle). Fewer than WINDOW
 * candles is a no-op — returns prev unchanged. */
export function nextTimeframeSignal(closed: CandleOC[], prev: TimeframeSignal): TimeframeSignal {
  if (closed.length < WINDOW) return prev;

  const window = closed.slice(-WINDOW).map(c => c.close);
  const { upper, lower, middle } = bollingerBands(window);
  const lastClose = closed[closed.length - 1].close;

  if (lastClose >= upper) {
    return { step1: false, step2: false };
  }

  let { step1, step2 } = prev;
  if (!step1 && lastClose <= lower) step1 = true;
  if (step1 && !step2 && lastClose >= middle) step2 = true;
  return { step1, step2 };
}
```

`detectSignal()` and the old `bbUpperCondition()`/`CLOSED_WINDOW` are removed — there is no more live-price entry point into signal detection.

### `backend/src/observers/Observer.ts`

- Replace the single `signal: SignalResult` field with `m1Signal: TimeframeSignal` and `h1Signal: TimeframeSignal`, both initialized to `EMPTY_TIMEFRAME_SIGNAL`.
- `updateCandle1s()` no longer touches signal state at all (signal state is close-only) — it only updates `currentPrice`.
- `updateCandle1m()`: when `candle.isClosed`, after pushing to `closed1m` and updating quote volume, call `this.m1Signal = nextTimeframeSignal(this.closed1m.toArray(), this.m1Signal)`. The non-closed branch (`form1mCandle = candle`) is unchanged and does not touch `m1Signal`.
- `updateCandle1h()`: mirrors the above for `h1Signal`/`closed1h`, called only in the `isClosed` branch.
- `getState()` builds the new shape:
  ```ts
  getState(): ObserverState {
    const reasons: SignalReasons = { m1: this.m1Signal, h1: this.h1Signal };
    const qualifies = reasons.m1.step1 || reasons.m1.step2 || reasons.h1.step1 || reasons.h1.step2;
    return { symbol: this.symbol, qualifies, reasons };
  }
  ```
- Remove the now-unused `recompute()` method and the `SignalResult`/`EMPTY_SIGNAL` import.

### Startup replay

`Observer.preloadClosed1m()`/`preloadClosed1h()` currently just `push()` each historical candle into the buffer with no signal side effects (signal used to be purely live-price-driven, so this was fine). Under the new close-only design, if these methods don't also run the state machine, an observer's `m1Signal`/`h1Signal` would sit at `{false, false}` after every restart regardless of true market state, until enough new closes happen to catch up — this is exactly the "reconstruct from history" gap the user confirmed must not happen.

Fix: change `preloadClosed1m`/`preloadClosed1h` to replay the state machine as they push, using the **same growing window** semantics as live closes (i.e. call `nextTimeframeSignal` after each push, exactly as `updateCandle1m`/`updateCandle1h` do for a live close):

```ts
preloadClosed1m(candles: Candle[]): void {
  candles.forEach(c => {
    this.closed1m.push(c);
    this.m1Signal = nextTimeframeSignal(this.closed1m.toArray(), this.m1Signal);
  });
}
```

(same pattern for `preloadClosed1h`/`h1Signal`). Since `nextTimeframeSignal` already no-ops below `WINDOW` candles, this is safe to call unconditionally from the first preloaded candle. Because `BotManager.preloadObservers()` already feeds these methods candles in ascending chronological order (oldest first) sourced from `fetchHistoricalCandles`/`fetchClosedHourCandles`, replaying sequentially through the same transition function used for live closes reconstructs the exact state a continuously-running observer would have reached — no separate "replay mode" or duplicate logic is needed, `preloadClosed1m`/`1h` simply stop being signal-inert.

`preloadQuoteVolume1m()` is untouched — it doesn't interact with signal state.

### `backend/src/managers/ObserverManager.ts`, `BotManager.ts`, `routes/api.ts`, `services/socketServer.ts`

No structural changes expected — all consume `ObserverState`/`SignalReasons` opaquely (`getState()`, `qualifies`, pass-through to sockets/REST) and don't reference `bbUpper1m`/`bbUpper1h` by name. `qualifies`'s new meaning ("visible in either div") is exactly what these call sites already need it for (chart tick/closed gating, `signal` event, `getQualifyingSymbols()`).

### Tests

- `backend/src/utils/signals.test.ts`: full rewrite. New cases: step1 sets on `close <= lower` with a full window; step2 requires step1 already true; step2 sets on `close >= middle`; reset (`close >= upper`) clears both regardless of prior state; reset takes priority even if step1/step2 conditions would also match the same candle; below-`WINDOW`-candles is a no-op that returns `prev` unchanged (including when `prev` already has `step1`/`step2` true, to confirm it doesn't reset); 1m and 1h use fully independent `prev`/window inputs (no cross-timeframe coupling) since `nextTimeframeSignal` only takes one timeframe's candles at a time.
- `backend/src/observers/Observer.test.ts`: add cases confirming `preloadClosed1m`/`1h` reconstruct non-trivial state (e.g. preload a sequence that ends mid-step1, or already at step2, and assert `getState().reasons` matches), and that `updateCandle1s` no longer affects `getState().reasons` (only `getCurrentPrice()`).

## Frontend architecture

### `frontend/src/types/index.ts`

Mirror the backend exactly:

```ts
export interface TimeframeSignal {
  step1: boolean;
  step2: boolean;
}

export interface SignalReasons {
  m1: TimeframeSignal;
  h1: TimeframeSignal;
}
```

(`ObserverData.qualifies`/`reasons` field names unchanged, just the `reasons` shape.)

### `frontend/src/components/ChartGrid.tsx`

Replace the single `visible`/`orderedSymbols` computation with two groups:

```ts
const isReady = (o: ObserverData) => o.reasons.m1.step2 || o.reasons.h1.step2;
const isWatching = (o: ObserverData) => o.reasons.m1.step1 || o.reasons.h1.step1;

const ready = observers.filter(isReady);
const watching = observers.filter(o => !isReady(o) && isWatching(o));

function order(group: ObserverData[]): ObserverData[] {
  const pinned = group.filter(o => pinnedSymbols.has(o.symbol));
  const unpinned = group.filter(o => !pinnedSymbols.has(o.symbol));
  return [...pinned, ...unpinned];
}

const orderedReady = order(ready);
const orderedWatching = order(watching);
```

`useOrderSizes` is called once with the combined symbol list (`[...orderedReady, ...orderedWatching].map(o => o.symbol)`) since order sizing doesn't depend on div placement.

Render two labeled sections, each its own 4-column grid (same Tailwind classes as today), in a single component: a "Ready" section first (only rendered if `orderedReady.length > 0`), then a "Watching" section (only if `orderedWatching.length > 0`). If both are empty, render the existing "No symbols currently qualify." message. `SymbolChartCard` gets one new prop, `isReady: boolean`, passed as `isReady(o)` for cards in the ready section and `false` for cards in the watching section.

### `frontend/src/components/SymbolChartCard.tsx`

Add `isReady: boolean` to `Props`. When true, render a small green "READY" badge next to the symbol name/ticker (adjacent to the existing pin icon and symbol link, inside the existing header flex row) — purely visual, does not affect the footer/Buy button logic below it, which is untouched.

## Out of scope

- No changes to `OrderManager`, `OrdersView`, order sizing, or the Buy flow's mechanics — `step2`/`isReady` is display-only.
- No persistence of `step1`/`step2` across backend restarts beyond the replay-from-preloaded-history mechanism already described (no database, no snapshot file).
- No change to the 20-candle `WINDOW` size, timeframes offered (1m/1h only), or `bollingerBands()`'s population-stddev math.
