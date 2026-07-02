import { ObserverManager } from '../managers/ObserverManager';
import { OrderManager } from '../managers/OrderManager';
import { TopSymbolsManager } from '../managers/TopSymbolsManager';
import { evaluateTick } from '../managers/tradingPipeline';
import { CompletedOrder } from '../types';
import { listHistorySymbols, streamMergedCandles } from './csvCandleSource';

const INITIAL_BALANCE = 10_000;

export interface EmulationResult {
  initialBalance: number;
  finalBalance: number;
  orders: CompletedOrder[];
  discardedOrder: boolean;
}

export interface EmulatorRunOptions {
  historyDir: string;
  symbols?: string[];
  limitPerSymbol?: number;
}

export class EmulatorEngine {
  async run(options: EmulatorRunOptions): Promise<EmulationResult> {
    const symbols = options.symbols ?? listHistorySymbols(options.historyDir);

    const simClock = { time: 0 };
    const clock = () => simClock.time;

    const observerManager = new ObserverManager({ mode: 'emulation', clock });
    const orderManager = new OrderManager(clock);
    const topSymbolsManager = new TopSymbolsManager();

    orderManager.setEnabled(true);
    observerManager.createObservers(symbols);

    const orders: CompletedOrder[] = [];
    orderManager.on('sell', (completed: CompletedOrder) => orders.push(completed));

    observerManager.on('hit', ({ symbol, counter }: { symbol: string; counter: number }) => {
      topSymbolsManager.registerHit(symbol, counter);
    });

    let candleCount = 0;

    for await (const candle of streamMergedCandles(options.historyDir, symbols, options.limitPerSymbol)) {
      simClock.time = candle.openTime;

      observerManager.updateCandle(candle);
      const state = observerManager.getObserverState(candle.symbol);
      if (state) {
        evaluateTick(candle.symbol, candle.high, state, topSymbolsManager, orderManager);
      }

      candleCount++;
      if (candleCount % 1_000_000 === 0) {
        console.log(`[Emulator] Processed ${candleCount.toLocaleString()} candles...`);
      }
    }

    const discardedOrder = orderManager.hasActiveOrder();
    if (discardedOrder) {
      orderManager.cancelActiveOrder();
    }

    console.log(`[Emulator] Done — ${candleCount.toLocaleString()} candles, ${orders.length} orders, discarded final order: ${discardedOrder}`);

    return {
      initialBalance: INITIAL_BALANCE,
      finalBalance: orderManager.getBalance(),
      orders,
      discardedOrder,
    };
  }
}
