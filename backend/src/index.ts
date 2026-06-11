import express from 'express';
import cors from 'cors';
import { SymbolManager } from './services/symbolManager';
import { ObserverManager } from './managers/ObserverManager';
import { BinanceWebSocket } from './services/binanceWebSocket';
import { fetchHistoricalCandles } from './services/historicalCandles';
import { createRouter } from './routes/api';

const PORT = process.env.PORT ?? 3000;

async function preloadAllObservers(symbols: string[], observerManager: ObserverManager): Promise<void> {
  console.log(`[Preload] Fetching historical 1m candles for ${symbols.length} symbols...`);

  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const candles = await fetchHistoricalCandles(symbol);
      observerManager.preloadObserver(symbol, candles);
      return { symbol, count: candles.length };
    })
  );

  let ok = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      ok++;
    } else {
      console.error(`[Preload] Failed:`, result.reason);
    }
  }

  console.log(`[Preload] Done — ${ok}/${symbols.length} observers ready`);
}

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const symbolManager = new SymbolManager();
  await symbolManager.load();

  const symbols = symbolManager.getSymbols();
  const observerManager = new ObserverManager();
  observerManager.createObservers(symbols);

  await preloadAllObservers(symbols, observerManager);

  const ws = new BinanceWebSocket(symbols);
  ws.on('candle', candle => observerManager.updateCandle(candle));
  ws.connect();

  app.use('/api', createRouter(observerManager, symbolManager));

  app.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
  });

  process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down...');
    ws.destroy();
    symbolManager.destroy();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[Fatal]', err);
  process.exit(1);
});
