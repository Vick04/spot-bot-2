import { ObserverManager } from '../managers/ObserverManager';
import { OrderManager } from '../managers/OrderManager';
import { ChartTimeframe, CompletedOrder, PivotEvent } from '../types';
import { ZigZagConfig } from '../utils/zigzag';
import { OrderSizeConfig } from '../utils/orderSize';
import { readSymbolCandles } from './csvCandleSource';

export interface EmulatorOptions {
  historyDir: string;
  symbols: string[];
  timeframe: ChartTimeframe;
  zigzagConfig: ZigZagConfig;
  limitPerSymbol?: number;
}

export interface EmulatorTrade {
  symbol: string;
  buyPrice: number;
  buyTime: number;
  buyPivotPrice: number;
  buyPivotTime: number;
  sellPrice: number;
  sellTime: number;
  sellPivotPrice: number;
  sellPivotTime: number;
  profitPct: number;
  durationMs: number;
  buySlippagePct: number;
  sellSlippagePct: number;
}

export interface EmulatorResult {
  options: EmulatorOptions;
  candlesProcessed: number;
  firstCandleTime: number | null;
  lastCandleTime: number | null;
  initialBalance: number;
  finalBalance: number;
  trades: EmulatorTrade[];
  discardedOpenOrders: number;
  maxDrawdownPct: number;
}

/** No liquidity data is fed during emulation (see design spec) -- this
 * config makes computeOrderSize() always resolve to the full balance
 * (min(balance, huge, Infinity) === balance), i.e. true all-in compounding
 * sizing, through the existing unmodified formula. */
const ALL_IN_ORDER_SIZE_CONFIG: OrderSizeConfig = { factor: Number.MAX_SAFE_INTEGER, maxUsdt: Infinity };
const ALL_IN_QUOTE_VOLUME = 1; // nonzero placeholder; see ALL_IN_ORDER_SIZE_CONFIG

interface PivotInfo {
  price: number;
  time: number;
}

export class EmulatorEngine {
  run(options: EmulatorOptions): EmulatorResult {
    const simClock = { time: 0 };
    const clock = () => simClock.time;

    const observerManager = new ObserverManager();
    const orderManager = new OrderManager(clock, ALL_IN_ORDER_SIZE_CONFIG);
    observerManager.createObservers(options.symbols, options.zigzagConfig, options.timeframe);

    const initialBalance = orderManager.getStatus().balance;
    let peakBalance = initialBalance;
    let maxDrawdownPct = 0;
    const trades: EmulatorTrade[] = [];
    const lastPivots = new Map<string, PivotInfo>(); // Track last min/max pivot per symbol

    const timeframeMs = options.timeframe === '1m' ? 60000 : 3600000;

    observerManager.on('pivot', (pivot: PivotEvent) => {
      const currentPrice = observerManager.getCurrentPrice(pivot.symbol);
      if (currentPrice === null) return;

      // Calculate when the pivot extremum actually occurred using barsSinceExtreme from the event
      // barsSinceExtreme is the counter incremented each candle after the extremum is set
      // When barsSinceExtreme=N, the extremum was set N+1 candles ago (not N)
      const pivotTime = simClock.time - ((pivot.barsSinceExtreme + 1) * timeframeMs);

      // Store pivot info for later use in trade record
      const pivotInfo: PivotInfo = { price: pivot.price, time: pivotTime };
      lastPivots.set(`${pivot.symbol}_${pivot.type}`, pivotInfo);

      if (pivot.type === 'min') {
        orderManager.buy(pivot.symbol, currentPrice, ALL_IN_QUOTE_VOLUME);
      } else {
        orderManager.sellAtPrice(pivot.symbol, currentPrice);
      }
    });

    orderManager.on('completed', ({ order }: { order: CompletedOrder }) => {
      const buyPivot = lastPivots.get(`${order.symbol}_min`);
      const sellPivot = lastPivots.get(`${order.symbol}_max`);

      if (!buyPivot || !sellPivot) {
        console.warn(`[EmulatorEngine] Missing pivot info for ${order.symbol}`);
        return;
      }

      const buySlippagePct = ((order.buyPrice - buyPivot.price) / buyPivot.price) * 100;
      const sellSlippagePct = ((order.sellPrice - sellPivot.price) / sellPivot.price) * 100;

      trades.push({
        symbol: order.symbol,
        buyPrice: order.buyPrice,
        buyTime: order.openedAt,
        buyPivotPrice: buyPivot.price,
        buyPivotTime: buyPivot.time,
        sellPrice: order.sellPrice,
        sellTime: order.closedAt,
        sellPivotPrice: sellPivot.price,
        sellPivotTime: sellPivot.time,
        profitPct: order.profitPct,
        durationMs: order.durationMs,
        buySlippagePct,
        sellSlippagePct,
      });

      const balance = orderManager.getStatus().balance;
      if (balance > peakBalance) peakBalance = balance;
      const drawdownPct = peakBalance > 0 ? ((peakBalance - balance) / peakBalance) * 100 : 0;
      if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;
    });

    let candlesProcessed = 0;
    let firstCandleTime: number | null = null;
    let lastCandleTime: number | null = null;

    for (const symbol of options.symbols) {
      for (const candle of readSymbolCandles(options.historyDir, symbol, options.timeframe, options.limitPerSymbol)) {
        simClock.time = candle.openTime;
        if (firstCandleTime === null) firstCandleTime = candle.openTime;
        lastCandleTime = candle.openTime;

        // Synthetic 1s tick BEFORE the real candle update, so
        // getCurrentPrice() already reflects this candle's own close by the
        // time the 'pivot' handler (fired synchronously from the
        // updateCandle() call below, if this candle confirms a pivot) runs
        // -- otherwise it would still see the PREVIOUS candle's close. The
        // CSV has no real tick data, so "current price" is approximated as
        // this candle's own close. See design spec.
        observerManager.updateCandle({
          symbol: candle.symbol,
          timeframe: '1s',
          openTime: candle.openTime,
          open: candle.close,
          high: candle.close,
          low: candle.close,
          close: candle.close,
          isClosed: true,
        });

        observerManager.updateCandle(candle);

        candlesProcessed++;
      }
    }

    const discardedOpenOrders = orderManager.getStatus().activeOrders.length;

    return {
      options,
      candlesProcessed,
      firstCandleTime,
      lastCandleTime,
      initialBalance,
      finalBalance: orderManager.getStatus().balance,
      trades,
      discardedOpenOrders,
      maxDrawdownPct,
    };
  }
}
