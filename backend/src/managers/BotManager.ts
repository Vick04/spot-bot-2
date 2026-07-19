import { SymbolManager } from '../services/symbolManager';
import { ObserverManager } from './ObserverManager';
import { OrderManager } from './OrderManager';
import { BinanceWebSocket } from '../services/binanceWebSocket';
import { fetchHistoricalCandles, fetchClosedHourCandles } from '../services/historicalCandles';
import { PivotEvent } from '../types';

/** Chart/detection buffer size -- unchanged from before. */
const CHART_PRELOAD_CANDLES = 200;

/** 24h of 1m candles (60 * 24), used to warm up the liquidity-based
 * order-sizing volume window (see observers/Observer.ts). The same fetch
 * also supplies the chart/detection buffer (its most recent 200 candles). */
const VOLUME_PRELOAD_CANDLES = 1440;

/** Symbols the ZigZag auto-trader is allowed to act on. The Observer
 * computes ZigZag state for every symbol (cheap, generic) -- this set is
 * what turns that state into actual buy/sell calls. Mirrored on the
 * frontend in ChartGrid.tsx; keep both in sync by hand. */
const ZIGZAG_ENABLED_SYMBOLS = new Set(['BTCUSDT']);

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

    this.observerManager.on('pivot', (pivot: PivotEvent) => {
      if (!ZIGZAG_ENABLED_SYMBOLS.has(pivot.symbol)) return;

      // A pivot only confirms after price has already retraced >=1% and
      // >=20 candles have passed since pivot.price's historical extreme, so
      // pivot.price is stale by the time this fires -- trading at it would
      // book a look-ahead-bias edge that's unreachable in live trading.
      // Execute at the current market price instead; pivot.price remains
      // available for logging/display only.
      const currentPrice = this.observerManager.getCurrentPrice(pivot.symbol);
      if (currentPrice === null) return;

      if (pivot.type === 'min') {
        const quoteVolume24h = this.observerManager.getQuoteVolume24h(pivot.symbol) ?? 0;
        this.orderManager.buy(pivot.symbol, currentPrice, quoteVolume24h);
      } else {
        this.orderManager.sellAtPrice(pivot.symbol, currentPrice);
      }
    });

    this.ws = new BinanceWebSocket(symbols);
    this.ws.on('candle', candle => {
      this.observerManager.updateCandle(candle);
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
