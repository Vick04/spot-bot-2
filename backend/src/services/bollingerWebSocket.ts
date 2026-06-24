import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { BINANCE_WS_BASE } from '../config/binance';
import { RawCandle } from '../observers/BollingerObserver';

const RECONNECT_DELAY_MS = 5000;

interface BinanceKlineEvent {
  e: string;
  s: string;
  k: {
    t: number;
    o: string;
    h: string;
    l: string;
    c: string;
    i: string;
    x: boolean; // is this kline closed?
  };
}

export interface BollingerTick {
  symbol: string;
  candle: RawCandle;
  isClosed: boolean;
}

/**
 * Dedicated WebSocket for the Bollinger module: subscribes only to 1h klines
 * for the given symbols. Kept separate from the main bot WebSocket so the two
 * modules never interfere.
 */
export class BollingerWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private symbols: string[];
  private interval: string;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;

  constructor(symbols: string[], interval = '1h') {
    super();
    this.symbols = symbols;
    this.interval = interval;
  }

  connect(): void {
    const streams = this.symbols.map(s => `${s.toLowerCase()}@kline_${this.interval}`);
    const url = `${BINANCE_WS_BASE}/stream?streams=${streams.join('/')}`;
    console.log(`[Bollinger WS] Connecting to ${streams.length} ${this.interval} streams`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => console.log('[Bollinger WS] Connected to Binance'));

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());
        const payload: BinanceKlineEvent = parsed.data ?? parsed;
        if (payload.e === 'kline') this.handleKline(payload);
      } catch (err) {
        console.error('[Bollinger WS] Failed to parse message:', err);
      }
    });

    this.ws.on('error', (err) => console.error('[Bollinger WS] Error:', err.message));

    this.ws.on('close', () => {
      if (!this.isDestroyed) {
        console.log(`[Bollinger WS] Disconnected — reconnecting in ${RECONNECT_DELAY_MS / 1000}s`);
        this.scheduleReconnect();
      }
    });
  }

  private handleKline(event: BinanceKlineEvent): void {
    const k = event.k;
    const tick: BollingerTick = {
      symbol: event.s,
      isClosed: k.x,
      candle: {
        openTime: k.t,
        open:  parseFloat(k.o),
        high:  parseFloat(k.h),
        low:   parseFloat(k.l),
        close: parseFloat(k.c),
      },
    };
    this.emit('tick', tick);
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
