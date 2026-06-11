export interface CandleData {
  close: number;
  timestamp: number;
}

export interface ObserverData {
  symbol: string;
  candle1s: CandleData | null;
  candle1m: CandleData | null;
  ma99: number | null;
  isReady: boolean;
}

export interface ApiResponse<T> {
  data: T;
}
