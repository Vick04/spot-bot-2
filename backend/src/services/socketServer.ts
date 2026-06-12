import { Server as HttpServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { ObserverManager } from '../managers/ObserverManager';
import { TopSymbolsManager } from '../managers/TopSymbolsManager';

export function createSocketServer(
  httpServer: HttpServer,
  observerManager: ObserverManager,
  topSymbolsManager: TopSymbolsManager,
): void {
  const io = new SocketIO(httpServer, {
    cors: { origin: '*' },
  });

  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    // Send full snapshot on connect so the client renders immediately
    socket.emit('snapshot', {
      observers: observerManager.getAllStates(),
      top25: topSymbolsManager.getTop25(),
    });

    socket.on('disconnect', () => {
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
  });

  // Push every 1s candle update to all connected clients
  observerManager.on('candle', ({ symbol, state }) => {
    io.emit('candle', { symbol, state });
  });

  // Push top25 update whenever a hit is registered
  observerManager.on('hit', () => {
    io.emit('top25', topSymbolsManager.getTop25());
  });
}
