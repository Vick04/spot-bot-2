import { SymbolManager } from '../services/symbolManager';
import { ObserverManager } from './ObserverManager';
import { TopSymbolsManager } from './TopSymbolsManager';
import { OrderManager } from './OrderManager';
import { BollingerManager } from './BollingerManager';
import { BinanceWebSocket } from '../services/binanceWebSocket';
import { fetchHistoricalCandles } from '../services/historicalCandles';
import { ObserverState } from '../types';

export class BotManager {
  readonly symbolManager: SymbolManager;
  readonly observerManager: ObserverManager;
  readonly topSymbolsManager: TopSymbolsManager;
  readonly orderManager: OrderManager;
  readonly bollingerManager: BollingerManager;
  private ws: BinanceWebSocket | null = null;

  constructor() {
    this.symbolManager = new SymbolManager();
    this.observerManager = new ObserverManager();
    this.topSymbolsManager = new TopSymbolsManager();
    this.orderManager = new OrderManager();
    this.bollingerManager = new BollingerManager();
  }

  async start(): Promise<void> {
    await this.symbolManager.load();

    const symbols = this.symbolManager.getSymbols();
    this.observerManager.createObservers(symbols);
    await this.preloadObservers(symbols);

    this.observerManager.on('hit', ({ symbol, counter }: { symbol: string; counter: number }) => {
      this.topSymbolsManager.registerHit(symbol, counter);
    });

    this.observerManager.on('candle', ({ symbol, timeframe, state }: { symbol: string; timeframe: string; state: ObserverState }) => {
      if (timeframe !== '1s') return;

      const price = state.candle1s?.close;
      if (price == null) return;

      // Check sell condition first
      this.orderManager.onPriceTick(symbol, price);

      // Check buy condition: symbol must be readyToBuy, in top 25, and not blocked
      if (!this.orderManager.hasActiveOrder() && state.impulseTracking.readyToBuy) {
        const inTop25 = this.topSymbolsManager.getTop25Symbols().includes(symbol);
        if (inTop25) {
          const observer = this.observerManager.getObserver(symbol);
          const ma20 = observer?.calculateMA20() ?? null;
          const ma99 = observer?.calculateMA99() ?? null;

          if (ma20 !== null && ma99 !== null && this.orderManager.canBuySymbol(symbol, ma20, ma99)) {
            this.orderManager.buy(symbol, price);
          }
        }
      }
    });

    this.orderManager.on('sell', (completed) => {
      const observer = this.observerManager.getObserver(completed.symbol);

      if (observer) {
        // Block symbol - will unblock when ma20 < ma99
        this.orderManager.blockSymbol(completed.symbol, 0);
        // Reset impulse tracker so floor becomes undefined again
        observer.resetImpulseTracker();
      }
    });

    this.ws = new BinanceWebSocket(symbols);
    this.ws.on('candle', candle => this.observerManager.updateCandle(candle));
    this.ws.connect();

    // Independent Bollinger module — runs in parallel, shares no state with the bot
    await this.bollingerManager.start();
  }

  resetBot(): void {
    this.observerManager.resetAllImpulseTrackers();
    this.topSymbolsManager.reset();
    this.orderManager.reset();
    console.log('[Bot] Reset — impulse trackers, top25 and order state cleared');
    this.observerManager.emit('reset');
  }

  forceSell(): void {
    const order = this.orderManager.getActiveOrder();
    if (!order) return;
    const state = this.observerManager.getObserverState(order.symbol);
    const price = state?.candle1s?.close;
    if (price == null) return;
    this.orderManager.forceSell(price);
  }

  getReadySymbols(): ObserverState[] {
    return this.topSymbolsManager
      .getTop25Symbols()
      .map(symbol => this.observerManager.getObserverState(symbol))
      .filter((state): state is ObserverState => state !== null && state.impulseTracking.readyToBuy);
  }

  stop(): void {
    this.ws?.destroy();
    this.bollingerManager.stop();
    this.symbolManager.destroy();
  }

  private async preloadObservers(symbols: string[]): Promise<void> {
    console.log(`[Preload] Fetching historical 1m candles for ${symbols.length} symbols...`);

    const results = await Promise.allSettled(
      symbols.map(async symbol => {
        const candles = await fetchHistoricalCandles(symbol);
        this.observerManager.preloadObserver(symbol, candles);
      })
    );

    const ok = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected');
    failed.forEach(r => console.error('[Preload] Failed:', (r as PromiseRejectedResult).reason));

    console.log(`[Preload] Done — ${ok}/${symbols.length} observers ready`);
  }
}
