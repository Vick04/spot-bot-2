import { SymbolManager } from '../services/symbolManager';
import { ObserverManager } from './ObserverManager';
import { TopSymbolsManager } from './TopSymbolsManager';
import { OrderManager } from './OrderManager';
import { BinanceWebSocket } from '../services/binanceWebSocket';
import { fetchHistoricalCandles } from '../services/historicalCandles';
import { ObserverState } from '../types';

export class BotManager {
  readonly symbolManager: SymbolManager;
  readonly observerManager: ObserverManager;
  readonly topSymbolsManager: TopSymbolsManager;
  readonly orderManager: OrderManager;
  private ws: BinanceWebSocket | null = null;

  constructor() {
    this.symbolManager = new SymbolManager();
    this.observerManager = new ObserverManager();
    this.topSymbolsManager = new TopSymbolsManager();
    this.orderManager = new OrderManager();
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

      // Check buy condition: symbol must be readyToBuy and in top 25
      if (!this.orderManager.hasActiveOrder() && state.impulseTracking.readyToBuy) {
        const inTop25 = this.topSymbolsManager.getTop25Symbols().includes(symbol);
        if (inTop25) {
          this.orderManager.buy(symbol, price);
        }
      }
    });

    this.ws = new BinanceWebSocket(symbols);
    this.ws.on('candle', candle => this.observerManager.updateCandle(candle));
    this.ws.connect();
  }

  getReadySymbols(): ObserverState[] {
    return this.topSymbolsManager
      .getTop25Symbols()
      .map(symbol => this.observerManager.getObserverState(symbol))
      .filter((state): state is ObserverState => state !== null && state.impulseTracking.readyToBuy);
  }

  stop(): void {
    this.ws?.destroy();
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
