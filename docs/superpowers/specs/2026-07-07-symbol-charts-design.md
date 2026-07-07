# Per-symbol candlestick charts with MA20/MA99/Bollinger overlays

## Problem

The client currently shows only a bare list of qualifying symbol names
(`QualifyingList`). We're replacing that with a grid of live candlestick
charts — one per qualifying symbol — each showing the candle's open/close
progression plus MA20, MA99, Bollinger upper ("bbUpper") and Bollinger lower
("bbLower", aka "bbdown") as historical line overlays, exactly like a
TradingView-style chart. Each symbol's chart can be toggled independently
between its 1m and 1h series via a button group.

## Scope

- Charts render **only for symbols currently in the qualifying list** (same
  set `QualifyingList` used) — not for all 175 observed symbols.
- Grid: **max 4 columns**, responsive down to fewer on narrower viewports.
- Each card's 1m/1h toggle is **independent per card** (own local state), not
  a global control.
- `QualifyingList` and its component are **deleted outright** — the chart
  grid becomes the sole main view. No dead code left behind.
- Library: **lightweight-charts** (TradingView's open-source charting
  library, Apache-2.0) — purpose-built for OHLC candles + line overlays, no
  custom candlestick renderer needed.

## Chart content and window

- **Visible window: 100 candles.** MA20/MA99/bbUpper/bbLower are historical
  series computed **per candle**, not single reference lines — each line
  moves together with the price across the whole visible window.
- To have MA99 computable at the very first visible candle, the backend
  retains **200 closed candles per symbol per timeframe** (100 visible + 99
  lookback, with a small margin). The visible chart window is always the
  **last 100** candles of that 200-candle buffer, so every visible point has
  a full preceding 99-candle history available.
- The **in-formation candle** (the currently-open 1m/1h candle) is included
  as the live, moving last point: it updates on every 1s price tick, exactly
  like the existing signal-detection logic.

## Backend

### 1. Bigger rolling buffers (Observer)

`backend/src/observers/Observer.ts` currently keeps only 19 closed candles
per timeframe (`CLOSED_WINDOW = 19`, sized for the live signal-detection
window). This is now **decoupled**: the buffer capacity grows to serve
charting; detection logic is unaffected because `signals.ts`'s
`bbUpperCondition`/`threePositiveCondition` already slice only the *tail*
they need (last 19 / last 2) regardless of total buffer size.

- Rename the Observer's Queue capacity constant to reflect its new purpose:
  `CHART_HISTORY_CANDLES = 200`. `closed1m`/`closed1h` become
  `Queue<Candle>(CHART_HISTORY_CANDLES)`.
- `BotManager`'s `PRELOAD_CANDLES` becomes `200` (was `19`), passed to both
  `fetchHistoricalCandles` and `fetchClosedHourCandles` (both already accept
  a configurable `limit`; Binance's kline endpoint supports limit up to
  1000, so this is a bounded, safe increase — same request count, larger
  `limit` query param).
- The in-formation candle: `Observer` currently tracks only `form1mOpen`/
  `form1hOpen` (a bare number) to feed `detectSignal`. It now retains the
  **whole latest in-formation `Candle`** object per timeframe
  (`form1mCandle: Candle | null`, `form1hCandle: Candle | null`), so the
  chart can render its OHLC. `detectSignal` keeps receiving just
  `formXOpen` (derived as `form1mCandle?.open ?? null`) — no change to
  detection behavior.
- New method `getChartData(timeframe: '1m' | '1h'): ChartCandle[]` — returns
  the 200 closed candles from the relevant Queue, converted to
  `{ openTime, open, high, low, close }`, with the in-formation candle
  appended as the final point using:
  ```
  open  = formCandle.open
  high  = max(formCandle.high, currentPrice)
  low   = min(formCandle.low, currentPrice)
  close = currentPrice
  ```
  `currentPrice` is the same 1s-tick price already driving signal detection
  — one source of truth for "the live price," consistent with existing
  behavior. If there's no in-formation candle yet (`formCandle === null`) or
  no `currentPrice` yet, the forming point is omitted (chart just shows the
  closed candles it has).

### 2. Indicator series computation (new file)

New `backend/src/utils/chartSeries.ts`:

```ts
export interface ChartCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartSeriesPoint {
  ma20: number | null;
  ma99: number | null;
  bbUpper: number | null;
  bbLower: number | null;
}

export interface ChartSeries {
  ma20: (number | null)[];
  ma99: (number | null)[];
  bbUpper: (number | null)[];
  bbLower: (number | null)[];
}

/** For each index i, computes MA20/MA99/bbUpper/bbLower over the trailing
 * window ending at i. null until enough history exists for that window. */
export function computeChartSeries(closes: number[]): ChartSeries;
```

`ChartSeriesPoint` is the single-point form (one value per indicator) used
by the live socket events below; `ChartSeries` is the array form (one array
per indicator, index-aligned with `candles`) used by the REST snapshot.

Reuses `sma()` from `utils/indicators.ts`. Adds a new `bollingerBands(values):
{ middle: number; upper: number; lower: number }` to `indicators.ts` (single
variance computation shared by upper/lower — no duplicated stddev math);
`bollingerUpper()` is refactored to call it internally, keeping its existing
signature and behavior unchanged (still used as-is by `signals.ts` and its
tests).

### 3. REST endpoint

`GET /api/observers/:symbol/chart?timeframe=1m|1h` in `routes/api.ts`:

- 400 if `timeframe` is missing or not `1m`/`1h`.
- 404 if the symbol is unknown (same pattern as the existing
  `/observers/:symbol` route).
- 200 body: `{ data: { symbol, timeframe, candles: ChartCandle[], series: ChartSeries } }`
  where `candles`/`series` are the **last 100** points (sliced from the
  200-candle buffer + live forming candle) — `series` arrays are the same
  length as `candles` and index-aligned.

### 4. Live socket updates (qualifying symbols only)

To avoid pushing chart data for all 175 symbols on every 1s tick,
`ObserverManager.updateCandle()` gates chart events on the symbol's
**current** qualification state (not just on qualification flips, unlike the
existing `'signal'` event):

- `'chart:tick'` — emitted after every update for a symbol that is
  currently qualifying, carrying the freshest point for **both**
  timeframes in one payload (the frontend picks whichever it's displaying):
  ```ts
  { symbol: string;
    m1: { candle: ChartCandle; series: ChartSeriesPoint };
    h1: { candle: ChartCandle; series: ChartSeriesPoint } }
  ```
  This is the **live-updating last point only** (the in-formation candle) —
  the frontend replaces its locally-held last point with this, it does not
  append.
- `'chart:closed'` — emitted when a 1m or 1h candle **closes** for a
  currently-qualifying symbol:
  ```ts
  { symbol: string; timeframe: '1m' | '1h'; candle: ChartCandle; series: ChartSeriesPoint }
  ```
  The frontend appends this as the new last point and drops its oldest
  point, keeping the 100-candle sliding window.

This mirrors the current/closed event pattern already proven in this
codebase's earlier Bollinger-observer work.

## Frontend

### Types (`frontend/src/types/index.ts`)

Add `ChartTimeframe = '1m' | '1h'`, `ChartCandle`, `ChartSeries` mirroring
the backend wire shapes exactly (field-for-field, same as the existing
`SignalReasons`/`ObserverData` mirroring convention).

### Components

- **`ChartGrid.tsx`** — replaces `QualifyingList.tsx` (deleted) as the main
  view in `App.tsx`. Takes the qualifying `ObserverData[]`, renders a CSS
  grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`) of
  one `SymbolChartCard` per qualifying symbol, keyed by symbol.
- **`SymbolChartCard.tsx`** — local `useState<ChartTimeframe>('1m')`; header
  with the symbol name + a 2-button group ("1m" / "1h") that sets the local
  timeframe; renders `<SymbolChart symbol={symbol} timeframe={timeframe} />`
  below.
- **`SymbolChart.tsx`** — wraps a `lightweight-charts` instance in a
  `useRef` div: one candlestick series + 4 line series (MA20, MA99, bbUpper,
  bbLower — visually distinguished by color, dashed for the Bollinger
  bands). Consumes `useSymbolChartData(symbol, timeframe)` and calls
  `.setData()` on full refresh (symbol/timeframe change) or `.update()` for
  incremental live points. Disposes the chart instance on unmount.
- **`useSymbolChartData(symbol, timeframe)`** hook (`frontend/src/hooks/`):
  - On mount and whenever `symbol`/`timeframe` changes: fetches
    `GET /api/observers/${symbol}/chart?timeframe=${timeframe}`, resets
    local state to the returned 100-point series.
  - Subscribes to the shared socket's `'chart:tick'`/`'chart:closed'`
    events, filtering for this `symbol` (and, for `'chart:tick'`, picking
    the `m1`/`h1` branch matching the active `timeframe`).
  - `'chart:tick'` → replaces the last point in local state.
  - `'chart:closed'` (matching timeframe) → appends the new point, drops
    the oldest, keeping exactly 100 points.
  - Unsubscribes on cleanup (unmount or symbol/timeframe change).
  - Returns `{ candles, series, loading, error }`.

### `App.tsx`

Replaces `<QualifyingList observers={observerList} />` with
`<ChartGrid observers={observerList} />`. Header/connection-status area is
unchanged.

## Testing

- **`backend/src/utils/chartSeries.test.ts`** (new): verifies
  `computeChartSeries()` — nulls before each window fills (index < 19 →
  bbUpper/bbLower null, index < 98 → ma99 null), correct values once filled
  (using `sma()`/`bollingerUpper()`/the new `bollingerBands()` as the
  oracle, same technique already used in `signals.test.ts` and
  `indicators.test.ts`), and array-length/index-alignment with the input.
- **`backend/src/utils/indicators.test.ts`**: add cases for the new
  `bollingerBands()` (upper/middle/lower all correct, matching existing
  `bollingerUpper` expectations for the upper value).
- **`backend/src/observers/Observer.test.ts`** (new): covers
  `getChartData()` — closed-candle passthrough, forming-candle high/low
  widened correctly by `currentPrice`, and the "no forming candle yet"
  omission case.
- **Frontend**: no automated component tests exist in this codebase for any
  UI piece (verified by manual browser check per established project
  convention) — verification here is manual, via the dev-server preview:
  confirm the grid renders, charts draw candles + all 4 overlay lines, the
  1m/1h toggle works independently per card, and live ticks visibly move
  the last candle without a full redraw.

## Out of scope

- No historical zoom/pan controls beyond what lightweight-charts provides
  by default.
- No persistence of chart state across reloads (always starts from the
  100-candle REST snapshot).
- No charts for non-qualifying symbols.
- No backtesting/emulator integration (unrelated to this feature).
