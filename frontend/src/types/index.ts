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

export interface ObserverData {
  symbol: string;
  candle1s: CandleData | null;
  candle1m: CandleData | null;
  ma99: number | null;
  isReady: boolean;
  impulseTracking: ImpulseTrackingSnapshot;
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

export interface SymbolHits {
  symbol: string;
  hits: number;
}


export interface ApiResponse<T> {
  data: T;
}

// ---------------------------------------------------------------------------
// Bollinger module
// ---------------------------------------------------------------------------

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

export interface BollingerObserverState {
  symbol: string;
  history: BollingerCandle[];
  current: BollingerCandle | null;
  isReady: boolean;
}

// Squeeze→breakout detector (1m, all symbols)
export type SignalState = 'OPEN' | 'WIN' | 'FAIL' | 'FLAT';

export interface BreakoutSignal {
  id: string;
  symbol: string;
  state: SignalState;
  entryTime: number;
  entryPrice: number;
  squeezeBbw: number;
  position: number;
  target: number;
  mfePct: number;
  maePct: number;
  outcomePct: number | null;
  barsHeld: number;
}

export interface SymbolSignalCounts {
  symbol: string;
  open: number;
  win: number;
  fail: number;
  flat: number;
  total: number;
  blocked: boolean;
}

export interface DetectorStats {
  total: number;
  wins: number;
  fails: number;
  flats: number;
  open: number;
  winRate: number;
  avgMfePct: number;
  avgMaePct: number;
  avgMinutesToPeak: number;
}

export interface DetectorSnapshot {
  perSymbol: SymbolSignalCounts[];
  open: BreakoutSignal[];
  stats: DetectorStats;
}
