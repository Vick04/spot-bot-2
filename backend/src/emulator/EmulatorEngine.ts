import { ObserverManager } from '../managers/ObserverManager';
import { OrderManager } from '../managers/OrderManager';
import { TopSymbolsManager } from '../managers/TopSymbolsManager';
import { evaluateTick } from '../managers/tradingPipeline';
import { Candle, CompletedOrder } from '../types';
import { listHistorySymbols, readSymbolHourCandles, streamMergedCandles } from './csvCandleSource';
import { HourCandleCursor } from './hourCandleCursor';

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

    // Feeds the Step 1 gate: as the 1m clock advances, surface each symbol's
    // 1h candles once their hour has closed. Missing/unreadable 1h files fall
    // back to an empty stream (gate stays closed for that symbol).
    const hourCursor = new HourCandleCursor((symbol: string) =>
      safeHourCandles(options.historyDir, symbol)
    );

    let candleCount = 0;

    for await (const candle of streamMergedCandles(options.historyDir, symbols, options.limitPerSymbol)) {
      simClock.time = candle.openTime;

      for (const hourCandle of hourCursor.advanceClosed(candle.symbol, candle.openTime)) {
        observerManager.updateCandle(hourCandle);
      }

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

/** Reads a symbol's 1h candles, yielding nothing if the file is missing/unreadable. */
function* safeHourCandles(historyDir: string, symbol: string): Generator<Candle> {
  try {
    const iterator = readSymbolHourCandles(historyDir, symbol);
    let result = iterator.next();
    while (!result.done) {
      yield result.value;
      result = iterator.next();
    }
  } catch (err) {
    console.warn(`[Emulator] No 1h candles for ${symbol}:`, (err as Error).message);
  }
}
