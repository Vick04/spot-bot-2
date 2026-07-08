import { SymbolManager } from '../services/symbolManager';
import { ObserverManager } from './ObserverManager';
import { OrderManager } from './OrderManager';
import { BinanceWebSocket } from '../services/binanceWebSocket';
import { fetchHistoricalCandles, fetchClosedHourCandles } from '../services/historicalCandles';

/** Chart/detection buffer size — unchanged from before. */
const CHART_PRELOAD_CANDLES = 200;

/** 24h of 1m candles (60 * 24), used to warm up the liquidity-based
 * order-sizing volume window (see observers/Observer.ts). The same fetch
 * also supplies the chart/detection buffer (its most recent 200 candles). */
const VOLUME_PRELOAD_CANDLES = 1440;

export class BotManager {
  readonly symbolManager: SymbolManager;
  readonly observerManager: ObserverManager;
  readonly orderManager: OrderManager;
  private ws: BinanceWebSocket | null = null;

  constructor() {
    this.symbolManager = new SymbolManager();
    this.observerManager = new ObserverManager();
    this.orderManager = new OrderManager();
  }

  async start(): Promise<void> {
    await this.symbolManager.load();

    const symbols = this.symbolManager.getSymbols();
    this.observerManager.createObservers(symbols);
    await this.preloadObservers(symbols);

    this.ws = new BinanceWebSocket(symbols);
    this.ws.on('candle', candle => {
      this.observerManager.updateCandle(candle);
      if (candle.timeframe === '1s') {
        this.orderManager.onPriceTick(candle.symbol, candle.close);
      }
    });
    this.ws.connect();
  }

  stop(): void {
    this.ws?.destroy();
    this.symbolManager.destroy();
  }

  private async preloadObservers(symbols: string[]): Promise<void> {
    console.log(`[Preload] Fetching historical 1m candles for ${symbols.length} symbols...`);

    const results = await Promise.allSettled(
      symbols.map(async symbol => {
        const candles = await fetchHistoricalCandles(symbol, VOLUME_PRELOAD_CANDLES);
        this.observerManager.preloadObserver1m(symbol, candles.slice(-CHART_PRELOAD_CANDLES));
        this.observerManager.preloadObserverVolume(symbol, candles);
      })
    );

    const ok = results.filter(r => r.status === 'fulfilled').length;
    results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .forEach(r => console.error('[Preload] 1m candles failed:', r.reason));

    console.log(`[Preload] Done — ${ok}/${symbols.length} observers' 1m/volume windows loaded`);

    const hourResults = await Promise.allSettled(
      symbols.map(async symbol => {
        const candles = await fetchClosedHourCandles(symbol, CHART_PRELOAD_CANDLES);
        this.observerManager.preloadObserver1h(symbol, candles);
      })
    );

    const hourOk = hourResults.filter(r => r.status === 'fulfilled').length;
    hourResults
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .forEach(r => console.error('[Preload] 1h candles failed:', r.reason));

    console.log(`[Preload] Done — ${hourOk}/${symbols.length} symbols' 1h windows loaded`);
  }
}
