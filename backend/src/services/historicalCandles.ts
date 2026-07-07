import https from 'https';
import { Candle, CandleTimeframe } from '../types';
import { BINANCE_REST_URL } from '../config/binance';

// Binance kline response columns
type BinanceKlineRow = [
  number,  // 0 open time
  string,  // 1 open
  string,  // 2 high
  string,  // 3 low
  string,  // 4 close
  ...unknown[]
];

function get<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(body) as T); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function parseRow(symbol: string, timeframe: CandleTimeframe, row: BinanceKlineRow): Candle {
  return {
    symbol,
    timeframe,
    openTime: row[0],
    open:     parseFloat(row[1]),
    high:     parseFloat(row[2]),
    low:      parseFloat(row[3]),
    close:    parseFloat(row[4]),
    isClosed: true,  // historical candles are always closed
  };
}

/**
 * Fetches the last `limit` closed 1m candles for a symbol from Binance REST API.
 * We request limit+1 and drop the last row, which may be the currently open candle.
 */
export async function fetchHistoricalCandles(symbol: string, limit = 99): Promise<Candle[]> {
  const url = `${BINANCE_REST_URL}/api/v3/klines?symbol=${symbol}&interval=1m&limit=${limit + 1}`;
  const rows = await get<BinanceKlineRow[]>(url);
  return rows.slice(0, limit).map(row => parseRow(symbol, '1m', row));
}

/**
 * Fetches the last `limit` CLOSED 1h candles for a symbol (ascending). We
 * request limit+1 and drop the last row (the currently open candle). The
 * caller uses these to warm up the 99-close window backing the Step 1 gate.
 */
export async function fetchClosedHourCandles(symbol: string, limit = 120): Promise<Candle[]> {
  const url = `${BINANCE_REST_URL}/api/v3/klines?symbol=${symbol}&interval=1h&limit=${limit + 1}`;
  const rows = await get<BinanceKlineRow[]>(url);
  const closed = rows.slice(0, rows.length - 1);
  if (closed.length === 0) {
    throw new Error(`No closed 1h candles available for ${symbol}`);
  }
  return closed.map(row => parseRow(symbol, '1h', row));
}
