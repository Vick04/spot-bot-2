export type PivotType = 'min' | 'max';

export interface Pivot {
  price: number;
  type: PivotType;
}

export interface ZigZagState {
  direction: 'up' | 'down' | null;
  pendingHigh: number;
  pendingHighBars: number;
  pendingLow: number;
  pendingLowBars: number;
  extremePrice: number;
  barsSinceExtreme: number;
  lastPivot: Pivot | null;
}

export interface PerformanceWindows {
  h24: number | null;
  h12: number | null;
  h6: number | null;
  h3: number | null;
  h1: number | null;
}

export interface ObserverData {
  symbol: string;
  performance: PerformanceWindows;
  zigzag: ZigZagState;
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
