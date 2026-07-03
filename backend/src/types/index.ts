export type CandleTimeframe = '1s' | '1m' | '1h';

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
  stopLossPrice: number;
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
