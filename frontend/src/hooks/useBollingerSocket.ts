import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { DetectorSnapshot } from '../types';

const SOCKET_URL = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

const EMPTY: DetectorSnapshot = {
  perSymbol: [],
  open: [],
  stats: { total: 0, wins: 0, fails: 0, flats: 0, open: 0, winRate: 0, avgMfePct: 0, avgMaePct: 0, avgMinutesToPeak: 0 },
};

/**
 * Dedicated socket for the 1m squeeze→breakout detector dashboard. Independent
 * from the main bot's useSocket hook.
 */
export function useBollingerSocket() {
  const [snapshot, setSnapshot] = useState<DetectorSnapshot>(EMPTY);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('detector:snapshot', (snap: DetectorSnapshot) => setSnapshot(snap));

    return () => { socket.disconnect(); };
  }, []);

  return { snapshot, connected };
}
