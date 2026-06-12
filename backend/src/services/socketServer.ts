import { Server as HttpServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { ObserverManager } from '../managers/ObserverManager';
import { TopSymbolsManager } from '../managers/TopSymbolsManager';
import { OrderManager } from '../managers/OrderManager';
import { ActiveOrder, CompletedOrder } from '../types';

export function createSocketServer(
  httpServer: HttpServer,
  observerManager: ObserverManager,
  topSymbolsManager: TopSymbolsManager,
  orderManager: OrderManager,
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

    socket.on('disconnect', () => {
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
  });

  observerManager.on('candle', ({ symbol, state }) => {
    io.emit('candle', { symbol, state });
  });

  observerManager.on('hit', () => {
    io.emit('top25', topSymbolsManager.getTop25());
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
}
