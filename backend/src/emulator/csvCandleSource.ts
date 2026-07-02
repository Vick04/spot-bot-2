import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { Candle } from '../types';

export function listHistorySymbols(historyDir: string): string[] {
  return fs
    .readdirSync(historyDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

interface SymbolCursor {
  symbol: string;
  iterator: AsyncIterator<Candle>;
  next: Candle | null;
}

async function* readSymbolCandles(historyDir: string, symbol: string, limit?: number): AsyncGenerator<Candle> {
  const filePath = path.join(historyDir, symbol, `${symbol}_1m.csv`);
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let isHeader = true;
  let count = 0;

  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    if (!line) continue;
    if (limit !== undefined && count >= limit) break;

    const [openTimeStr, openStr, highStr, lowStr, closeStr] = line.split(',');

    const openTime = Number(openTimeStr);
    const open = Number(openStr);
    const high = Number(highStr);
    const low = Number(lowStr);
    const close = Number(closeStr);

    if (Number.isNaN(openTime) || Number.isNaN(open) || Number.isNaN(high) || Number.isNaN(low) || Number.isNaN(close)) {
      console.warn(`[csvCandleSource] Skipping malformed row for ${symbol}: ${line}`);
      continue;
    }

    yield {
      symbol,
      timeframe: '1m',
      openTime,
      open,
      high,
      low,
      close,
      isClosed: true,
    };

    count++;
  }

  rl.close();
  fileStream.close();
}

/**
 * Merges each symbol's 1m candle stream into a single ascending-openTime
 * stream, without loading any file fully into memory. Uses a simple O(n)
 * linear scan per step over the (small, <=175) set of active cursors —
 * a heap is unnecessary at this fan-in size.
 */
export async function* streamMergedCandles(
  historyDir: string,
  symbols: string[],
  limitPerSymbol?: number
): AsyncGenerator<Candle> {
  const cursors: SymbolCursor[] = [];

  for (const symbol of symbols) {
    const iterator = readSymbolCandles(historyDir, symbol, limitPerSymbol)[Symbol.asyncIterator]();
    const first = await iterator.next();
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

    const result = await cursor.iterator.next();
    if (result.done) {
      cursors.splice(minIndex, 1);
    } else {
      cursor.next = result.value;
    }
  }
}
