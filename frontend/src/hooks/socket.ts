import { io, Socket } from 'socket.io-client';

const SOCKET_URL = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

let socket: Socket | null = null;

/** Returns the single shared socket connection, creating it on first use.
 * All hooks that need live server events attach/detach their own listeners
 * to this one connection rather than opening their own. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, { transports: ['websocket'] });
  }
  return socket;
}
