import { Router, Request, Response } from 'express';
import { BotManager } from '../managers/BotManager';

export function createRouter(bot: BotManager): Router {
  const router = Router();

  router.get('/symbols', (_req: Request, res: Response) => {
    res.json({
      symbols: bot.symbolManager.getSymbols(),
      lastUpdated: bot.symbolManager.getLastUpdated(),
    });
  });

  router.get('/observers', (_req: Request, res: Response) => {
    res.json({ data: bot.observerManager.getAllStates() });
  });

  router.get('/observers/:symbol', (req: Request, res: Response) => {
    const symbol = req.params.symbol.toUpperCase();
    const state = bot.observerManager.getObserverState(symbol);
    if (!state) {
      res.status(404).json({ error: `Symbol ${symbol} not found` });
      return;
    }
    res.json({ data: state });
  });

  router.get('/observers/:symbol/chart', (req: Request, res: Response) => {
    const symbol = req.params.symbol.toUpperCase();
    const timeframe = req.query.timeframe;

    if (timeframe !== '1m' && timeframe !== '1h') {
      res.status(400).json({ error: `timeframe must be '1m' or '1h'` });
      return;
    }

    const data = bot.observerManager.getChartData(symbol, timeframe);
    if (!data) {
      res.status(404).json({ error: `Symbol ${symbol} not found` });
      return;
    }

    res.json({ data });
  });

  router.get('/qualifying', (_req: Request, res: Response) => {
    res.json({ data: bot.observerManager.getQualifyingSymbols() });
  });

  router.post('/orders/buy', (req: Request, res: Response) => {
    const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol.toUpperCase() : '';
    if (!symbol) {
      res.status(400).json({ error: 'symbol is required' });
      return;
    }

    const price = bot.observerManager.getCurrentPrice(symbol);
    const quoteVolume24h = bot.observerManager.getQuoteVolume24h(symbol);
    if (price === null || quoteVolume24h === null) {
      res.status(404).json({ error: `Symbol ${symbol} not found` });
      return;
    }

    const order = bot.orderManager.buy(symbol, price, quoteVolume24h);
    if (!order) {
      res.status(400).json({ error: `Cannot buy ${symbol}: already active, or order size is 0` });
      return;
    }

    res.json({ data: order });
  });

  router.get('/orders', (_req: Request, res: Response) => {
    res.json({ data: bot.orderManager.getStatus() });
  });

  router.get('/orders/sizes', (req: Request, res: Response) => {
    const symbolsParam = typeof req.query.symbols === 'string' ? req.query.symbols : '';
    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

    const sizes: Record<string, number> = {};
    for (const symbol of symbols) {
      const quoteVolume24h = bot.observerManager.getQuoteVolume24h(symbol);
      sizes[symbol] = quoteVolume24h === null ? 0 : bot.orderManager.computeOrderSize(quoteVolume24h);
    }

    res.json({ data: { balance: bot.orderManager.getStatus().balance, sizes } });
  });

  return router;
}
