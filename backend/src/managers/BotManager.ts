import { SymbolManager } from '../services/symbolManager';
import { ObserverManager } from './ObserverManager';
import { TopSymbolsManager } from './TopSymbolsManager';
import { OrderManager } from './OrderManager';
import { BinanceWebSocket } from '../services/binanceWebSocket';
import { fetchHistoricalCandles, fetchHistoricalCandles1h, fetchHistoricalCandles1d } from '../services/historicalCandles';
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
    await Promise.all([
      this.preloadObservers(symbols),
      this.preloadObservers1h(symbols),
      this.preloadObservers1d(symbols),
    ]);

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
    failed.forEach(r => console.error('[Preload 1m] Failed:', (r as PromiseRejectedResult).reason));

    console.log(`[Preload 1m] Done — ${ok}/${symbols.length} observers ready`);
  }

  private async preloadObservers1h(symbols: string[]): Promise<void> {
    console.log(`[Preload] Fetching historical 1h candles for ${symbols.length} symbols...`);

    const results = await Promise.allSettled(
      symbols.map(async symbol => {
        const candles = await fetchHistoricalCandles1h(symbol);
        this.observerManager.preloadObserver1h(symbol, candles);
      })
    );

    const ok = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected');
    failed.forEach(r => console.error('[Preload 1h] Failed:', (r as PromiseRejectedResult).reason));

    console.log(`[Preload 1h] Done — ${ok}/${symbols.length} observers ready`);
  }

  private async preloadObservers1d(symbols: string[]): Promise<void> {
    console.log(`[Preload] Fetching historical 1d candles for ${symbols.length} symbols...`);

    const results = await Promise.allSettled(
      symbols.map(async symbol => {
        const candles = await fetchHistoricalCandles1d(symbol);
        this.observerManager.preloadObserver1d(symbol, candles);
      })
    );

    const ok = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected');
    failed.forEach(r => console.error('[Preload 1d] Failed:', (r as PromiseRejectedResult).reason));

    console.log(`[Preload 1d] Done — ${ok}/${symbols.length} observers ready`);
  }
}
