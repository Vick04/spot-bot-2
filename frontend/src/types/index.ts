export interface SignalReasons {
  bbUpper1m: boolean;
  bbUpper1h: boolean;
  threePositive1m: boolean;
  threePositive1h: boolean;
}

export interface ObserverData {
  symbol: string;
  qualifies: boolean;
  reasons: SignalReasons;
}

export interface ApiResponse<T> {
  data: T;
}
