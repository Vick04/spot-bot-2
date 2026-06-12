import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { ObserverData, SymbolHits, OrderStatus, CompletedOrder } from '../types';

const SOCKET_URL = 'http://localhost:3000';

interface SocketStore {
  observers: Map<string, ObserverData>;
  top25: SymbolHits[];
  orderStatus: OrderStatus;
  orderHistory: CompletedOrder[];
  connected: boolean;
}

const DEFAULT_ORDER_STATUS: OrderStatus = {
  enabled: false,
  balance: 0,
  activeOrder: null,
  totalTrades: 0,
  totalProfit: 0,
};

export function useSocket() {
  const [store, setStore] = useState<SocketStore>({
    observers: new Map(),
    top25: [],
    orderStatus: DEFAULT_ORDER_STATUS,
    orderHistory: [],
    connected: false,
  });

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setStore(s => ({ ...s, connected: true })));
    socket.on('disconnect', () => setStore(s => ({ ...s, connected: false })));

    socket.on('snapshot', ({ observers, top25, orderStatus, orderHistory }: {
      observers: ObserverData[];
      top25: SymbolHits[];
      orderStatus: OrderStatus;
      orderHistory: CompletedOrder[];
    }) => {
      const map = new Map(observers.map(o => [o.symbol, o]));
      setStore(s => ({ ...s, observers: map, top25, orderStatus, orderHistory }));
    });

    socket.on('candle', ({ symbol, state }: { symbol: string; state: ObserverData }) => {
      setStore(s => {
        const next = new Map(s.observers);
        next.set(symbol, state);
        return { ...s, observers: next };
      });
    });

    socket.on('top25', (top25: SymbolHits[]) => {
      setStore(s => ({ ...s, top25 }));
    });

    socket.on('order:status', (orderStatus: OrderStatus) => {
      setStore(s => ({ ...s, orderStatus }));
    });

    socket.on('order:history', (orderHistory: CompletedOrder[]) => {
      setStore(s => ({ ...s, orderHistory }));
    });

    return () => { socket.disconnect(); };
  }, []);

  return store;
}
