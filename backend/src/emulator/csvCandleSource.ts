import fs from 'fs';
import path from 'path';
import { Candle, ChartTimeframe } from '../types';

const READ_CHUNK_BYTES = 1 << 20; // 1MB

function parseCandleLine(symbol: string, timeframe: ChartTimeframe, line: string): Candle | null {
  const [openTimeStr, openStr, highStr, lowStr, closeStr] = line.split(',');
  const openTime = Number(openTimeStr);
  const open = Number(openStr);
  const high = Number(highStr);
  const low = Number(lowStr);
  const close = Number(closeStr);

  if (Number.isNaN(openTime) || Number.isNaN(open) || Number.isNaN(high) || Number.isNaN(low) || Number.isNaN(close)) {
    console.warn(`[csvCandleSource] Skipping malformed row for ${symbol}: ${line}`);
    return null;
  }

  return { symbol, timeframe, openTime, open, high, low, close, isClosed: true };
}

/**
 * Reads a symbol's CSV via synchronous, fixed-size buffered reads -- never
 * loads the full file into memory. Expects the same column layout as
 * history/<SYMBOL>/<SYMBOL>_<timeframe>.csv: a header row followed by
 * `open_time,open,high,low,close,...` (any trailing columns, e.g.
 * quote_volume, are ignored -- the emulator uses all-in order sizing, not
 * liquidity-based sizing, so quote volume isn't needed).
 */
export function* readSymbolCandles(
  historyDir: string,
  symbol: string,
  timeframe: ChartTimeframe,
  limit?: number
): Generator<Candle> {
  const filePath = path.join(historyDir, symbol, `${symbol}_${timeframe}.csv`);
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(READ_CHUNK_BYTES);
  let leftover = '';
  let isHeader = true;
  let count = 0;

  try {
    let bytesRead: number;
    while ((bytesRead = fs.readSync(fd, buffer, 0, READ_CHUNK_BYTES, null)) > 0) {
      const chunk = leftover + buffer.toString('utf-8', 0, bytesRead);
      const lines = chunk.split('\n');
      leftover = lines.pop() ?? '';

      for (const line of lines) {
        if (isHeader) {
          isHeader = false;
          continue;
        }
        if (!line) continue;
        if (limit !== undefined && count >= limit) return;

        const candle = parseCandleLine(symbol, timeframe, line);
        if (candle === null) continue;

        yield candle;
        count++;
      }
    }

    if (leftover && !isHeader && !(limit !== undefined && count >= limit)) {
      const candle = parseCandleLine(symbol, timeframe, leftover);
      if (candle !== null) yield candle;
    }
  } finally {
    fs.closeSync(fd);
  }
}
