import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { BollingerObserver } from '../observers/BollingerObserver';
import { SqueezeBreakoutDetector } from '../observers/SqueezeBreakoutDetector';
import { BollingerWebSocket, BollingerTick } from '../services/bollingerWebSocket';
import { fetchBollingerHistory } from '../services/bollingerHistory';
import { BreakoutSignal, DetectorStats, DetectorSnapshot, SymbolSignalCounts } from '../types';

const SIGNALS_FILE = path.join(__dirname, '../../data/bollinger-signals.json');
const PRELOAD_LIMIT = 150;   // 1m candles to warm up MA99 (needs >=99)
const PRELOAD_CHUNK = 25;    // throttle preload to avoid REST rate limits

/**
 * Observe-only squeeze→breakout detector running on the 1m timeframe for ALL
 * tracked symbols. Self-contained, shares no state with the bot. Each closed
 * 1m candle feeds a per-symbol detector that self-labels outcomes
 * (WIN/FAIL/FLAT) so running it live accumulates calibration data with no risk.
 *
 * Events:
 *  - 'signal'   BreakoutSignal   new OPEN signal
 *  - 'resolved' BreakoutSignal   signal resolved (WIN/FAIL/FLAT)
 */
export class BollingerManager extends EventEmitter {
  private observers: Map<string, BollingerObserver> = new Map(); // 1m
  private detectors: Map<string, SqueezeBreakoutDetector> = new Map();
  private symbols: string[];
  private ws: BollingerWebSocket | null = null;
  private signals: BreakoutSignal[] = []; // resolved, persisted

  constructor(symbols: string[] = ['BTCUSDT', 'ETHUSDT']) {
    super();
    this.symbols = symbols;
  }

  async start(symbols?: string[]): Promise<void> {
    if (symbols && symbols.length) this.symbols = symbols;
    this.symbols.forEach(symbol => {
      this.observers.set(symbol, new BollingerObserver(symbol));
      this.detectors.set(symbol, new SqueezeBreakoutDetector(symbol));
    });
    this.loadSignals();
    await this.preload();

    this.ws = new BollingerWebSocket(this.symbols, '1m');
    this.ws.on('tick', (tick: BollingerTick) => this.handleTick(tick));
    this.ws.connect();

    console.log(`[Bollinger] Detector started on 1m for ${this.symbols.length} symbols`);
  }

  getSignals(): DetectorSnapshot {
    const open: BreakoutSignal[] = [];
    this.detectors.forEach(d => { const o = d.getOpen(); if (o) open.push(o); });

    const counts = new Map<string, SymbolSignalCounts>();
    this.symbols.forEach(s => counts.set(s, { symbol: s, open: 0, win: 0, fail: 0, flat: 0, total: 0 }));
    open.forEach(o => { const c = counts.get(o.symbol); if (c) { c.open++; c.total++; } });
    this.signals.forEach(s => {
      const c = counts.get(s.symbol);
      if (!c) return;
      if (s.state === 'WIN') c.win++;
      else if (s.state === 'FAIL') c.fail++;
      else if (s.state === 'FLAT') c.flat++;
      c.total++;
    });

    const perSymbol = Array.from(counts.values())
      .sort((a, b) => b.open - a.open || b.total - a.total || a.symbol.localeCompare(b.symbol));

    return { perSymbol, open, stats: this.computeStats(open.length) };
  }

  stop(): void {
    this.ws?.destroy();
  }

  private handleTick(tick: BollingerTick): void {
    const observer = this.observers.get(tick.symbol);
    const detector = this.detectors.get(tick.symbol);
    if (!observer || !detector) return;

    if (!tick.isClosed) { observer.updateCurrent(tick.candle); return; }

    observer.closeCurrent(tick.candle);
    const state = observer.getState();
    const last = state.history[state.history.length - 1];
    if (!last) return;

    for (const sig of detector.onClosedCandle(last)) {
      if (sig.state === 'OPEN') {
        console.log(`[Detector] OPEN  ${sig.symbol} @ ${sig.entryPrice.toFixed(4)} | squeeze ${sig.squeezeBbw.toFixed(3)}% pos ${sig.position.toFixed(2)}`);
        this.emit('signal', sig);
      } else {
        console.log(`[Detector] ${sig.state}  ${sig.symbol} | net ${sig.outcomePct?.toFixed(3)}% in ${sig.barsHeld}m`);
        this.signals.push(sig);
        this.saveSignals();
        this.emit('resolved', sig);
      }
    }
  }

  private computeStats(openCount: number): DetectorStats {
    const r = this.signals;
    const wins = r.filter(s => s.state === 'WIN').length;
    const fails = r.filter(s => s.state === 'FAIL').length;
    const flats = r.filter(s => s.state === 'FLAT').length;
    const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    return {
      total: r.length + openCount,
      wins, fails, flats, open: openCount,
      winRate: r.length ? wins / r.length : 0,
      avgMfePct: avg(r.map(s => s.mfePct)),
      avgMaePct: avg(r.map(s => s.maePct)),
      avgMinutesToPeak: avg(r.map(s => s.minutesToPeak)),
    };
  }

  private loadSignals(): void {
    try {
      this.signals = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf-8'));
      console.log(`[Detector] Loaded ${this.signals.length} past signals`);
    } catch { this.signals = []; }
  }

  private saveSignals(): void {
    try {
      fs.mkdirSync(path.dirname(SIGNALS_FILE), { recursive: true });
      fs.writeFileSync(SIGNALS_FILE, JSON.stringify(this.signals, null, 2));
    } catch (e) { console.error('[Detector] Failed to persist signals:', e); }
  }

  private async preload(): Promise<void> {
    console.log(`[Bollinger] Preloading 1m history for ${this.symbols.length} symbols...`);
    let ok = 0;
    for (let i = 0; i < this.symbols.length; i += PRELOAD_CHUNK) {
      const chunk = this.symbols.slice(i, i + PRELOAD_CHUNK);
      const results = await Promise.allSettled(
        chunk.map(async symbol => {
          const candles = await fetchBollingerHistory(symbol, '1m', PRELOAD_LIMIT);
          this.observers.get(symbol)?.preload(candles);
        })
      );
      ok += results.filter(r => r.status === 'fulfilled').length;
    }
    console.log(`[Bollinger] Preload done — ${ok}/${this.symbols.length} observers ready`);
  }
}
