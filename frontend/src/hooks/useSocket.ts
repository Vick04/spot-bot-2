import { useEffect, useState } from 'react';
import { ObserverData } from '../types';
import { getSocket } from './socket';

interface SocketStore {
  observers: Map<string, ObserverData>;
  connected: boolean;
}

export function useSocket() {
  const [store, setStore] = useState<SocketStore>({
    observers: new Map(),
    connected: false,
  });

  useEffect(() => {
    const socket = getSocket();

    const handleConnect = () => setStore(s => ({ ...s, connected: true }));
    const handleDisconnect = () => setStore(s => ({ ...s, connected: false }));
    const handleSnapshot = ({ observers }: { observers: ObserverData[] }) => {
      setStore(s => ({ ...s, observers: new Map(observers.map(o => [o.symbol, o])) }));
    };
    const handleSignal = (state: ObserverData) => {
      setStore(s => {
        const next = new Map(s.observers);
        next.set(state.symbol, state);
        return { ...s, observers: next };
      });
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('snapshot', handleSnapshot);
    socket.on('signal', handleSignal);

    if (socket.connected) handleConnect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('snapshot', handleSnapshot);
      socket.off('signal', handleSignal);
    };
  }, []);

  return store;
}
