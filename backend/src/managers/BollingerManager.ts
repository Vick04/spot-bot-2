import { EventEmitter } from 'events';
import { BollingerObserver } from '../observers/BollingerObserver';
import { BollingerWebSocket, BollingerTick } from '../services/bollingerWebSocket';
import { fetchBollinger1hHistory } from '../services/bollingerHistory';
import { BollingerObserverState } from '../types';

/**
 * Self-contained manager for the 1h Bollinger observers. Runs in parallel with
 * the main bot but shares nothing with it — its own observers, own WebSocket,
 * own events. Currently watches BTC and ETH.
 *
 * Events:
 *  - 'current' { symbol, current }        emitted on every live tick
 *  - 'closed'  { symbol, state }          emitted when a 1h candle closes
 */
export class BollingerManager extends EventEmitter {
  private observers: Map<string, BollingerObserver> = new Map();
  private symbols: string[];
  private ws: BollingerWebSocket | null = null;

  constructor(symbols: string[] = ['BTCUSDT', 'ETHUSDT']) {
    super();
    this.symbols = symbols;
  }

  async start(): Promise<void> {
    this.symbols.forEach(symbol => this.observers.set(symbol, new BollingerObserver(symbol)));
    await this.preload();

    this.ws = new BollingerWebSocket(this.symbols);
    this.ws.on('tick', (tick: BollingerTick) => this.handleTick(tick));
    this.ws.connect();

    console.log(`[Bollinger] Started for ${this.symbols.join(', ')}`);
  }

  getSnapshot(): BollingerObserverState[] {
    return Array.from(this.observers.values()).map(obs => obs.getState());
  }

  getState(symbol: string): BollingerObserverState | null {
    return this.observers.get(symbol)?.getState() ?? null;
  }

  stop(): void {
    this.ws?.destroy();
  }

  private handleTick(tick: BollingerTick): void {
    const observer = this.observers.get(tick.symbol);
    if (!observer) return;

    if (tick.isClosed) {
      observer.closeCurrent(tick.candle);
      this.emit('closed', { symbol: tick.symbol, state: observer.getState() });
    } else {
      observer.updateCurrent(tick.candle);
      this.emit('current', { symbol: tick.symbol, current: observer.getState().current });
    }
  }

  private async preload(): Promise<void> {
    console.log(`[Bollinger] Fetching 1h history for ${this.symbols.length} symbols...`);

    const results = await Promise.allSettled(
      this.symbols.map(async symbol => {
        const candles = await fetchBollinger1hHistory(symbol);
        this.observers.get(symbol)?.preload(candles);
      })
    );

    const ok = results.filter(r => r.status === 'fulfilled').length;
    results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .forEach(r => console.error('[Bollinger] Preload failed:', r.reason));

    console.log(`[Bollinger] Preload done — ${ok}/${this.symbols.length} observers ready`);
  }
}
