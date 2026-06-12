import { SymbolManager } from '../services/symbolManager';
import { ObserverManager } from './ObserverManager';
import { TopSymbolsManager } from './TopSymbolsManager';
import { BinanceWebSocket } from '../services/binanceWebSocket';
import { fetchHistoricalCandles } from '../services/historicalCandles';
import { ObserverState } from '../types';

export class BotManager {
  readonly symbolManager: SymbolManager;
  readonly observerManager: ObserverManager;
  readonly topSymbolsManager: TopSymbolsManager;
  private ws: BinanceWebSocket | null = null;

  constructor() {
    this.symbolManager = new SymbolManager();
    this.observerManager = new ObserverManager();
    this.topSymbolsManager = new TopSymbolsManager();
  }

  async start(): Promise<void> {
    await this.symbolManager.load();

    const symbols = this.symbolManager.getSymbols();
    this.observerManager.createObservers(symbols);

    await this.preloadObservers(symbols);

    this.observerManager.on('hit', ({ symbol, counter }: { symbol: string; counter: number }) => {
      this.topSymbolsManager.registerHit(symbol, counter);
    });

    this.ws = new BinanceWebSocket(symbols);
    this.ws.on('candle', candle => this.observerManager.updateCandle(candle));
    this.ws.connect();
  }

  /**
   * Returns the top 25 symbols (by hits) that currently have
   * allowed = true and elapsed <= 10s (readyToBuy).
   */
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
