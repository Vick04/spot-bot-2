import { Server as HttpServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { ObserverManager } from '../managers/ObserverManager';
import { TopSymbolsManager } from '../managers/TopSymbolsManager';
import { OrderManager } from '../managers/OrderManager';
import { BollingerManager } from '../managers/BollingerManager';
import { ActiveOrder, CompletedOrder } from '../types';

export function createSocketServer(
  httpServer: HttpServer,
  observerManager: ObserverManager,
  topSymbolsManager: TopSymbolsManager,
  orderManager: OrderManager,
  bollingerManager: BollingerManager,
): void {
  const io = new SocketIO(httpServer, { cors: { origin: '*' } });

  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    socket.emit('snapshot', {
      observers: observerManager.getAllStates(),
      top25: topSymbolsManager.getTop25(),
      orderStatus: orderManager.getStatus(),
      orderHistory: orderManager.getHistory(),
    });

    socket.emit('detector:snapshot', bollingerManager.getSignals());

    socket.on('disconnect', () => {
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
  });

  observerManager.on('reset', () => {
    io.emit('snapshot', {
      observers: observerManager.getAllStates(),
      top25: topSymbolsManager.getTop25(),
      orderStatus: orderManager.getStatus(),
      orderHistory: orderManager.getHistory(),
    });
  });

  observerManager.on('candle', ({ symbol, state }) => {
    io.emit('candle', { symbol, state });
  });

  observerManager.on('hit', () => {
    io.emit('top25', topSymbolsManager.getTop25());
  });

  orderManager.on('toggle', () => {
    io.emit('order:status', orderManager.getStatus());
  });

  orderManager.on('buy', (order: ActiveOrder) => {
    io.emit('order:status', orderManager.getStatus());
    io.emit('order:buy', order);
  });

  orderManager.on('sell', (completed: CompletedOrder) => {
    io.emit('order:status', orderManager.getStatus());
    io.emit('order:sell', completed);
    io.emit('order:history', orderManager.getHistory());
  });

  // Bollinger 1m detector — isolated event channel
  bollingerManager.on('signal', () => {
    io.emit('detector:snapshot', bollingerManager.getSignals());
  });

  bollingerManager.on('resolved', () => {
    io.emit('detector:snapshot', bollingerManager.getSignals());
  });
}
