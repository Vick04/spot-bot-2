export interface OrderSizeConfig {
  factor: number;
  maxUsdt: number;
}

/** orderSize = min(availableBalance, quoteVolume24h * factor, maxUsdt), floored at 0. */
export function computeOrderSize(availableBalance: number, quoteVolume24h: number, config: OrderSizeConfig): number {
  return Math.max(0, Math.min(availableBalance, quoteVolume24h * config.factor, config.maxUsdt));
}
