import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { BollingerObserverState, BollingerCandle } from '../types';

const SOCKET_URL = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

interface BollingerStore {
  observers: Map<string, BollingerObserverState>;
  connected: boolean;
}

/**
 * Dedicated socket connection for the Bollinger lab page. Independent from the
 * main bot's useSocket hook so the two views never interfere.
 */
export function useBollingerSocket() {
  const [store, setStore] = useState<BollingerStore>({
    observers: new Map(),
    connected: false,
  });

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setStore(s => ({ ...s, connected: true })));
    socket.on('disconnect', () => setStore(s => ({ ...s, connected: false })));

    socket.on('bollinger:snapshot', (states: BollingerObserverState[]) => {
      const map = new Map(states.map(st => [st.symbol, st]));
      setStore(s => ({ ...s, observers: map }));
    });

    // Live update of the open candle only
    socket.on('bollinger:current', ({ symbol, current }: { symbol: string; current: BollingerCandle | null }) => {
      setStore(s => {
        const existing = s.observers.get(symbol);
        if (!existing) return s;
        const next = new Map(s.observers);
        next.set(symbol, { ...existing, current });
        return { ...s, observers: next };
      });
    });

    // A candle closed: replace the whole state (history + current)
    socket.on('bollinger:closed', ({ symbol, state }: { symbol: string; state: BollingerObserverState }) => {
      setStore(s => {
        const next = new Map(s.observers);
        next.set(symbol, state);
        return { ...s, observers: next };
      });
    });

    return () => { socket.disconnect(); };
  }, []);

  return store;
}
