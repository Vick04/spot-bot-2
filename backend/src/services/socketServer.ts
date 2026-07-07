import { Server as HttpServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { ObserverManager } from '../managers/ObserverManager';
import { ObserverState } from '../types';

export function createSocketServer(httpServer: HttpServer, observerManager: ObserverManager): void {
  const io = new SocketIO(httpServer, { cors: { origin: '*' } });

  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    socket.emit('snapshot', { observers: observerManager.getAllStates() });

    socket.on('disconnect', () => {
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
  });

  observerManager.on('signal', (state: ObserverState) => {
    io.emit('signal', state);
  });
}
