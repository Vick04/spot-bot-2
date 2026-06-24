import https from 'https';
import { BINANCE_REST_URL } from '../config/binance';
import { RawCandle } from '../observers/BollingerObserver';

// Binance kline response columns (only the first 5 are used here)
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

function parseRow(row: BinanceKlineRow): RawCandle {
  return {
    openTime: row[0],
    open:  parseFloat(row[1]),
    high:  parseFloat(row[2]),
    low:   parseFloat(row[3]),
    close: parseFloat(row[4]),
  };
}

/**
 * Fetches closed candles for a symbol at the given interval. We request more
 * than we display so the oldest shown candle still has a valid MA99 (which
 * needs 99 prior closes). The last row from Binance is the currently open
 * candle and is dropped.
 */
export async function fetchBollingerHistory(symbol: string, interval = '1h', limit = 300): Promise<RawCandle[]> {
  const url = `${BINANCE_REST_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const rows = await get<BinanceKlineRow[]>(url);
  // Drop the last row (open/unconfirmed candle)
  return rows.slice(0, -1).map(parseRow);
}

/** Back-compat alias for the 1h history fetch. */
export function fetchBollinger1hHistory(symbol: string, limit = 300): Promise<RawCandle[]> {
  return fetchBollingerHistory(symbol, '1h', limit);
}
