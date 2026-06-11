export const CANDLE_TIMEFRAMES = ['1s', '1m'] as const;
export type CandleTimeframe = typeof CANDLE_TIMEFRAMES[number];

export const BINANCE_TIMEFRAME_MAP: Record<CandleTimeframe, string> = {
  '1s': '1s',
  '1m': '1m',
};
