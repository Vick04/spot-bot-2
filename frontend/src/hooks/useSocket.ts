import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { ObserverData } from '../types';

const SOCKET_URL = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

interface SocketStore {
  observers: Map<string, ObserverData>;
  connected: boolean;
}

export function useSocket() {
  const [store, setStore] = useState<SocketStore>({
    observers: new Map(),
    connected: false,
  });

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setStore(s => ({ ...s, connected: true })));
    socket.on('disconnect', () => setStore(s => ({ ...s, connected: false })));

    socket.on('snapshot', ({ observers }: { observers: ObserverData[] }) => {
      setStore(s => ({ ...s, observers: new Map(observers.map(o => [o.symbol, o])) }));
    });

    socket.on('signal', (state: ObserverData) => {
      setStore(s => {
        const next = new Map(s.observers);
        next.set(state.symbol, state);
        return { ...s, observers: next };
      });
    });

    return () => { socket.disconnect(); };
  }, []);

  return store;
}
