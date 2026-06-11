export type CandleTimeframe = '1s' | '1m';

export interface Candle {
  symbol: string;
  timeframe: CandleTimeframe;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
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

export interface ObserverState {
  symbol: string;
  candle1s: CandleData | null;
  candle1m: CandleData | null;
  ma99: number | null;
  isReady: boolean;
  impulseTracking: ImpulseTrackingSnapshot;
}
