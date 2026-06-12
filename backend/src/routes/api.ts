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

  router.get('/top25', (_req: Request, res: Response) => {
    res.json({ data: bot.topSymbolsManager.getTop25() });
  });

  router.get('/ready', (_req: Request, res: Response) => {
    res.json({ data: bot.getReadySymbols() });
  });

  router.get('/orders/status', (_req: Request, res: Response) => {
    res.json({ data: bot.orderManager.getStatus() });
  });

  router.get('/orders/history', (_req: Request, res: Response) => {
    res.json({ data: bot.orderManager.getHistory() });
  });

  router.post('/orders/toggle', (_req: Request, res: Response) => {
    const next = !bot.orderManager.isEnabled();
    bot.orderManager.setEnabled(next);
    res.json({ data: bot.orderManager.getStatus() });
  });

  router.get('/debug/observer/:symbol', (req: Request, res: Response) => {
    const symbol = req.params.symbol.toUpperCase();
    const state = bot.observerManager.getObserverState(symbol);
    if (!state) {
      res.status(404).json({ error: `Symbol ${symbol} not found` });
      return;
    }
    res.json({
      data: {
        ...state,
        buffer1m: bot.observerManager.getBuffer1m(symbol),
      },
    });
  });

  return router;
}
