const BB_PERIOD = 20;
const BB_MULT = 2;

export function calculateMA(closes: number[], period: number): number {
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function calculateBBUpper(closes: number[]): number {
  const ma = closes.reduce((a, b) => a + b, 0) / closes.length;
  const variance = closes.reduce((sum, c) => sum + (c - ma) ** 2, 0) / closes.length;
  return ma + BB_MULT * Math.sqrt(variance);
}

// Requires exactly BB_PERIOD closes
export function bbUpperFromPeriod(closes: number[]): number {
  return calculateBBUpper(closes.slice(-BB_PERIOD));
}

export { BB_PERIOD };
