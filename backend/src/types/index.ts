export type CandleTimeframe = '1s' | '1m';

export interface Candle {
  symbol: string;
  timeframe: CandleTimeframe;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  isClosed: boolean;
}

export interface CandleData {
  close: number;
  timestamp: number;
}

export interface ImpulseTrackingSnapshot {
  floor: number | undefined;
  allowed: boolean;
  reached: boolean;
  counter: number;
  ma99AtFloorSet: number | undefined;
  allowedActivatedAt: number | null;
  currentElapsedTime: number | null;
  timings: number[];
  averageTime: number | null;
  readyToBuy: boolean;
}

export interface ActiveOrder {
  symbol: string;
  buyPrice: number;
  quantity: number;
  targetPrice: number;
  usdtSpent: number;
  openedAt: number;
}

export interface CompletedOrder {
  symbol: string;
  buyPrice: number;
  sellPrice: number;
  quantity: number;
  usdtSpent: number;
  usdtReceived: number;
  profit: number;
  profitPct: number;
  openedAt: number;
  closedAt: number;
  durationMs: number;
}

export interface OrderStatus {
  enabled: boolean;
  balance: number;
  activeOrder: ActiveOrder | null;
  totalTrades: number;
  totalProfit: number;
}

export interface ObserverState {
  symbol: string;
  candle1s: CandleData | null;
  candle1m: CandleData | null;
  ma99: number | null;
  isReady: boolean;
  impulseTracking: ImpulseTrackingSnapshot;
}

// ---------------------------------------------------------------------------
// Bollinger module (isolated 1h observer — does not affect the bot above)
// ---------------------------------------------------------------------------

/** A 1h candle enriched with its indicator values at that point in time. */
export interface BollingerCandle {
  symbol: string;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  isClosed: boolean;
  ma20: number | null;
  ma99: number | null;
  bbMiddle: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  bbWidth: number | null;
}

/** Full state of one Bollinger observer: closed history + live open candle. */
export interface BollingerObserverState {
  symbol: string;
  history: BollingerCandle[];       // closed 1h candles with indicators
  current: BollingerCandle | null;  // currently open 1h candle, recomputed live
  isReady: boolean;
}

// ---------------------------------------------------------------------------
// Squeeze→breakout detector (observe-only, 1m timeframe)
// ---------------------------------------------------------------------------

export type SignalState = 'OPEN' | 'WIN' | 'FAIL' | 'FLAT';

/** One detected squeeze→breakout signal, self-labeled with its outcome. */
export interface BreakoutSignal {
  id: string;
  symbol: string;
  state: SignalState;
  // entry context
  entryTime: number;
  entryPrice: number;
  squeezeBbw: number;       // lowest bbWidth in the squeeze before the break
  entryBbw: number;
  bbUpperAtEntry: number;
  ma20: number;
  ma99: number;
  ma20Slope: number;        // ma20 - ma20[-slopeLookback]
  position: number;         // (close-mid)/(upper-mid) at entry; >0 = upper half
  target: number;           // entryPrice * (1 + targetPct)
  // evolution
  peakBbw: number;
  minutesToPeak: number;
  mfePct: number;           // max favorable excursion %
  maePct: number;           // max adverse excursion %
  // resolution
  exitTime: number | null;
  exitPrice: number | null;
  outcomePct: number | null;
  barsHeld: number;
}

export interface DetectorStats {
  total: number;
  wins: number;
  fails: number;
  flats: number;
  open: number;
  winRate: number;          // wins / resolved
  avgMfePct: number;
  avgMaePct: number;
  avgMinutesToPeak: number;
}

/** Per-symbol signal tally for the detector dashboard table. */
export interface SymbolSignalCounts {
  symbol: string;
  open: number;
  win: number;
  fail: number;
  flat: number;
  total: number;
}

export interface DetectorSnapshot {
  perSymbol: SymbolSignalCounts[];
  open: BreakoutSignal[];
  stats: DetectorStats;
}
