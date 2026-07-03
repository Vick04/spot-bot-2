import { SymbolManager } from '../services/symbolManager';
import { ObserverManager } from './ObserverManager';
import { TopSymbolsManager } from './TopSymbolsManager';
import { OrderManager } from './OrderManager';
import { BinanceWebSocket } from '../services/binanceWebSocket';
import { fetchHistoricalCandles, fetchClosedHourCandles } from '../services/historicalCandles';
import { ObserverState } from '../types';
import { evaluateTick } from './tradingPipeline';

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

      evaluateTick(symbol, price, state, this.topSymbolsManager, this.orderManager);
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
    failed.forEach(r => console.error('[Preload] Failed:', (r as PromiseRejectedResult).reason));

    console.log(`[Preload] Done — ${ok}/${symbols.length} observers ready`);

    // Preload closed 1h candles to warm up the 99-close window backing the
    // Step 1 gate, so it works from the start. A failure here must not block
    // trading; the gate simply stays closed for that symbol until its window
    // fills from live 1h closes.
    const hourResults = await Promise.allSettled(
      symbols.map(async symbol => {
        const candles = await fetchClosedHourCandles(symbol);
        this.observerManager.preloadObserverHours(symbol, candles);
      })
    );

    const hourOk = hourResults.filter(r => r.status === 'fulfilled').length;
    hourResults
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .forEach(r => console.error('[Preload] 1h candles failed:', r.reason));

    console.log(`[Preload] Done — ${hourOk}/${symbols.length} symbols' 1h windows loaded`);
  }
}
