export interface TimeframeSignal {
  step1: boolean;
  step2: boolean;
}

export interface SignalReasons {
  m1: TimeframeSignal;
  h1: TimeframeSignal;
}

export interface ObserverData {
  symbol: string;
  qualifies: boolean;
  reasons: SignalReasons;
}

export interface ApiResponse<T> {
  data: T;
}

export type ChartTimeframe = '1m' | '1h';

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

export interface ChartData {
  symbol: string;
  timeframe: ChartTimeframe;
  candles: ChartCandle[];
  series: ChartSeries;
}

export interface ChartTickEvent {
  symbol: string;
  m1: { candle: ChartCandle; series: ChartSeriesPoint };
  h1: { candle: ChartCandle; series: ChartSeriesPoint };
}

export interface ChartClosedEvent {
  symbol: string;
  timeframe: ChartTimeframe;
  candle: ChartCandle;
  series: ChartSeriesPoint;
}

export interface ActiveOrder {
  symbol: string;
  buyPrice: number;
  targetPrice: number;
  quantity: number;
  usdtSpent: number;
  openedAt: number;
}

export interface CompletedOrder extends ActiveOrder {
  sellPrice: number;
  usdtReceived: number;
  profit: number;
  profitPct: number;
  closedAt: number;
  durationMs: number;
}

export interface OrderStatus {
  balance: number;
  activeOrders: ActiveOrder[];
  completedCount: number;
  totalProfitPct: number;
}

export interface OrderOpenedEvent {
  order: ActiveOrder;
  balance: number;
}

export interface OrderCompletedEvent {
  order: CompletedOrder;
  balance: number;
  completedCount: number;
  totalProfitPct: number;
}
