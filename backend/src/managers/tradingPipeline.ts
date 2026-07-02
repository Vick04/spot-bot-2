import { ObserverState } from '../types';
import { TopSymbolsManager } from './TopSymbolsManager';
import { OrderManager } from './OrderManager';

/**
 * Core buy/sell decision rule, shared between the live bot (driven by 1s
 * ticks) and the emulator (driven by closed 1m candles). Both callers pass
 * in whichever price they consider "current" for their timeframe.
 */
export function evaluateTick(
  symbol: string,
  price: number,
  state: ObserverState,
  topSymbolsManager: TopSymbolsManager,
  orderManager: OrderManager
): void {
  // Check sell condition first
  orderManager.onPriceTick(symbol, price);

  // Check buy condition: symbol must be readyToBuy and in top 25
  if (!orderManager.hasActiveOrder() && state.impulseTracking.readyToBuy) {
    const inTop25 = topSymbolsManager.getTop25Symbols().includes(symbol);
    if (inTop25) {
      orderManager.buy(symbol, price);
    }
  }
}
