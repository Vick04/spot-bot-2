import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { ObserverData, SymbolHits } from '../types';

const SOCKET_URL = 'http://localhost:3000';

interface SocketStore {
  observers: Map<string, ObserverData>;
  top25: SymbolHits[];
  connected: boolean;
}

export function useSocket() {
  const [store, setStore] = useState<SocketStore>({
    observers: new Map(),
    top25: [],
    connected: false,
  });

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStore(s => ({ ...s, connected: true }));
    });

    socket.on('disconnect', () => {
      setStore(s => ({ ...s, connected: false }));
    });

    // Full snapshot on connect
    socket.on('snapshot', ({ observers, top25 }: { observers: ObserverData[]; top25: SymbolHits[] }) => {
      const map = new Map(observers.map(o => [o.symbol, o]));
      setStore(s => ({ ...s, observers: map, top25 }));
    });

    // Incremental candle update — only the changed symbol
    socket.on('candle', ({ symbol, state }: { symbol: string; state: ObserverData }) => {
      setStore(s => {
        const next = new Map(s.observers);
        next.set(symbol, state);
        return { ...s, observers: next };
      });
    });

    // Top25 update on new hit
    socket.on('top25', (top25: SymbolHits[]) => {
      setStore(s => ({ ...s, top25 }));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return store;
}
