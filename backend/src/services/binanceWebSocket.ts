import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Candle, CandleTimeframe } from '../types';
import { BINANCE_WS_BASE } from '../config/binance';
import { CANDLE_TIMEFRAMES } from '../config/constants';

const RECONNECT_DELAY_MS = 5000;

interface BinanceKlineEvent {
  e: string;
  E: number;
  s: string;
  k: {
    t: number;
    o: string;
    h: string;
    l: string;
    c: string;
    q: string;
    i: string;
    x: boolean;
  };
}

export class BinanceWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private symbols: string[];
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;

  constructor(symbols: string[]) {
    super();
    this.symbols = symbols;
  }

  connect(): void {
    const streams = this.symbols.flatMap(symbol =>
      CANDLE_TIMEFRAMES.map(tf => `${symbol.toLowerCase()}@kline_${tf}`)
    );

    const url = `${BINANCE_WS_BASE}/stream?streams=${streams.join('/')}`;
    console.log(`[WS] Connecting to ${streams.length} streams for ${this.symbols.length} symbols`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[WS] Connected to Binance');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());
        const payload: BinanceKlineEvent = parsed.data ?? parsed;
        if (payload.e === 'kline') {
          this.handleKline(payload);
        }
      } catch (err) {
        console.error('[WS] Failed to parse message:', err);
      }
    });

    this.ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
    });

    this.ws.on('close', () => {
      if (!this.isDestroyed) {
        console.log(`[WS] Disconnected — reconnecting in ${RECONNECT_DELAY_MS / 1000}s`);
        this.scheduleReconnect();
      }
    });
  }

  private handleKline(event: BinanceKlineEvent): void {
    const k = event.k;
    const timeframe = k.i as CandleTimeframe;

    const candle: Candle = {
      symbol: event.s,
      timeframe,
      openTime: k.t,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      quoteVolume: parseFloat(k.q),
      isClosed: k.x,
    };

    this.emit('candle', candle);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  destroy(): void {
    this.isDestroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
