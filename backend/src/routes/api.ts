import { Router, Request, Response } from 'express';
import { ObserverManager } from '../managers/ObserverManager';
import { SymbolManager } from '../services/symbolManager';

export function createRouter(observerManager: ObserverManager, symbolManager: SymbolManager): Router {
  const router = Router();

  router.get('/symbols', (_req: Request, res: Response) => {
    res.json({
      symbols: symbolManager.getSymbols(),
      lastUpdated: symbolManager.getLastUpdated(),
    });
  });

  router.get('/observers', (_req: Request, res: Response) => {
    res.json({ data: observerManager.getAllStates() });
  });

  router.get('/observers/:symbol', (req: Request, res: Response) => {
    const symbol = req.params.symbol.toUpperCase();
    const state = observerManager.getObserverState(symbol);
    if (!state) {
      res.status(404).json({ error: `Symbol ${symbol} not found` });
      return;
    }
    res.json({ data: state });
  });

  router.get('/debug/observer/:symbol', (req: Request, res: Response) => {
    const symbol = req.params.symbol.toUpperCase();
    const state = observerManager.getObserverState(symbol);
    if (!state) {
      res.status(404).json({ error: `Symbol ${symbol} not found` });
      return;
    }
    const buffer1m = observerManager.getBuffer1m(symbol);
    res.json({
      data: {
        ...state,
        buffer1m,
      },
    });
  });

  return router;
}
