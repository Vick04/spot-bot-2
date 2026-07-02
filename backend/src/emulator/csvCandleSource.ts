import fs from 'fs';
import path from 'path';
import { Candle } from '../types';

const READ_CHUNK_BYTES = 1 << 20; // 1MB

export function listHistorySymbols(historyDir: string): string[] {
  return fs
    .readdirSync(historyDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

interface SymbolCursor {
  symbol: string;
  iterator: Iterator<Candle>;
  next: Candle | null;
}

function parseCandleLine(symbol: string, line: string): Candle | null {
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

  return { symbol, timeframe: '1m', openTime, open, high, low, close, isClosed: true };
}

/**
 * Reads a symbol's 1m CSV via synchronous, fixed-size buffered reads —
 * never loads the full file into memory, and avoids the per-line promise
 * overhead of readline/async generators (significant at ~81M total rows).
 */
function* readSymbolCandles(historyDir: string, symbol: string, limit?: number): Generator<Candle> {
  const filePath = path.join(historyDir, symbol, `${symbol}_1m.csv`);
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

        const candle = parseCandleLine(symbol, line);
        if (candle === null) continue;

        yield candle;
        count++;
      }
    }

    // Final line if the file doesn't end with a trailing newline
    if (leftover && !isHeader && !(limit !== undefined && count >= limit)) {
      const candle = parseCandleLine(symbol, leftover);
      if (candle !== null) yield candle;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Merges each symbol's 1m candle stream into a single ascending-openTime
 * stream, without loading any file fully into memory. Uses a simple O(n)
 * linear scan per step over the (small, <=175) set of active cursors —
 * a heap is unnecessary at this fan-in size. Synchronous generator (no
 * async/await) since the underlying reads are synchronous; `for await`
 * over a sync generator still works for callers that iterate this way.
 */
export function* streamMergedCandles(
  historyDir: string,
  symbols: string[],
  limitPerSymbol?: number
): Generator<Candle> {
  const cursors: SymbolCursor[] = [];

  for (const symbol of symbols) {
    const iterator = readSymbolCandles(historyDir, symbol, limitPerSymbol)[Symbol.iterator]();
    const first = iterator.next();
    if (!first.done) {
      cursors.push({ symbol, iterator, next: first.value });
    }
  }

  while (cursors.length > 0) {
    let minIndex = 0;
    for (let i = 1; i < cursors.length; i++) {
      if (cursors[i].next!.openTime < cursors[minIndex].next!.openTime) {
        minIndex = i;
      }
    }

    const cursor = cursors[minIndex];
    yield cursor.next!;

    const result = cursor.iterator.next();
    if (result.done) {
      cursors.splice(minIndex, 1);
    } else {
      cursor.next = result.value;
    }
  }
}
