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

export interface SignalReasons {
  bbUpper1m: boolean;
  bbUpper1h: boolean;
  threePositive1m: boolean;
  threePositive1h: boolean;
}

export interface ObserverState {
  symbol: string;
  qualifies: boolean;
  reasons: SignalReasons;
}
