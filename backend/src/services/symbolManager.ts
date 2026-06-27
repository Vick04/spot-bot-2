import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import { EventEmitter } from 'events';
import { BINANCE_REST_URL, EXCHANGE_INFO_ENDPOINT, SYMBOLS_UPDATE_INTERVAL_MS } from '../config/binance';

const SYMBOLS_FILE = path.join(__dirname, '../../data/symbols.json');

interface SymbolsFile {
  symbols: string[];
  lastUpdated: string;
}

interface ExchangeInfoSymbol {
  symbol: string;
  status: string;
  quoteAsset: string;
}

interface ExchangeInfo {
  symbols: ExchangeInfoSymbol[];
}

export class SymbolManager extends EventEmitter {
  private symbols: string[] = [];
  private lastUpdated: string = '';
  private updateTimer: NodeJS.Timeout | null = null;

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(SYMBOLS_FILE, 'utf-8');
      const data: SymbolsFile = JSON.parse(raw);
      this.symbols = data.symbols;
      this.lastUpdated = data.lastUpdated;
      console.log(`[SymbolManager] Loaded ${this.symbols.length} symbols from file`);
    } catch {
      console.warn('[SymbolManager] symbols.json not found or invalid — using defaults');
      this.symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
      this.lastUpdated = new Date().toISOString();
      await this.save();
    }

    this.scheduleUpdate();
  }

  getSymbols(): string[] {
    return this.symbols;
  }

  getLastUpdated(): string {
    return this.lastUpdated;
  }

  private scheduleUpdate(): void {
    this.updateTimer = setInterval(async () => {
      await this.fetchFromBinance();
    }, SYMBOLS_UPDATE_INTERVAL_MS);
  }

  private async fetchFromBinance(): Promise<void> {
    console.log('[SymbolManager] Fetching symbols from Binance...');
    try {
      const data = await this.get<ExchangeInfo>(`${BINANCE_REST_URL}${EXCHANGE_INFO_ENDPOINT}`);
      const tradingUsdtSymbols = data.symbols
        .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
        .map(s => s.symbol);

      this.symbols = tradingUsdtSymbols;
      this.lastUpdated = new Date().toISOString();
      await this.save();

      console.log(`[SymbolManager] Updated to ${this.symbols.length} symbols`);
      this.emit('updated', this.symbols);
    } catch (err) {
      console.error('[SymbolManager] Failed to fetch from Binance — keeping existing symbols:', err);
    }
  }

  private save(): Promise<void> {
    const data: SymbolsFile = { symbols: this.symbols, lastUpdated: this.lastUpdated };
    return fs.writeFile(SYMBOLS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  private get<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let body = '';
        res.on('data', chunk => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  destroy(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }
}
