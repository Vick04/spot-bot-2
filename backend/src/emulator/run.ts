// Usage: npm run emulate -- [--symbol=BTCUSDT] [--timeframe=1m] [--deviation=1] [--minBars=20] [--priceSource=close] [--limit=100000] [--out=path/to/report.md]
//   --symbol=       symbol to emulate, must have history/<SYMBOL>/<SYMBOL>_<timeframe>.csv (default: BTCUSDT)
//   --timeframe=    '1m' or '1h' -- which CSV to read and which buffer drives the ZigZag detector (default: 1m)
//   --deviation=    ZigZag deviationPct (default: 1)
//   --minBars=      ZigZag minBarsBetweenPivots (default: 20)
//   --priceSource=  'close' or 'highLow' (default: close)
//   --limit=        max candles to process, for quick smoke runs (default: all available)
//   --out=          output path for the generated report (default: results/emulation-<timestamp>.md)
import fs from 'fs';
import path from 'path';
import { EmulatorEngine } from './EmulatorEngine';
import { formatReport } from './reportWriter';
import { ChartTimeframe } from '../types';
import { ZigZagConfig, DEFAULT_ZIGZAG_CONFIG } from '../utils/zigzag';

interface CliArgs {
  symbol: string;
  timeframe: ChartTimeframe;
  zigzagConfig: ZigZagConfig;
  limit?: number;
  out?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = {
    symbol: 'BTCUSDT',
    timeframe: '1m',
    zigzagConfig: { ...DEFAULT_ZIGZAG_CONFIG },
  };

  for (const arg of argv) {
    if (arg.startsWith('--symbol=')) {
      result.symbol = arg.slice('--symbol='.length).trim().toUpperCase();
    } else if (arg.startsWith('--timeframe=')) {
      const value = arg.slice('--timeframe='.length).trim();
      if (value !== '1m' && value !== '1h') {
        throw new Error(`--timeframe must be '1m' or '1h', got '${value}'`);
      }
      result.timeframe = value;
    } else if (arg.startsWith('--deviation=')) {
      result.zigzagConfig.deviationPct = Number(arg.slice('--deviation='.length));
    } else if (arg.startsWith('--minBars=')) {
      result.zigzagConfig.minBarsBetweenPivots = Number(arg.slice('--minBars='.length));
    } else if (arg.startsWith('--priceSource=')) {
      const value = arg.slice('--priceSource='.length).trim();
      if (value !== 'close' && value !== 'highLow') {
        throw new Error(`--priceSource must be 'close' or 'highLow', got '${value}'`);
      }
      result.zigzagConfig.priceSource = value;
    } else if (arg.startsWith('--limit=')) {
      result.limit = Number(arg.slice('--limit='.length));
    } else if (arg.startsWith('--out=')) {
      result.out = arg.slice('--out='.length);
    }
  }

  return result;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.join(__dirname, '..', '..', '..');
  const historyDir = path.join(repoRoot, 'history');

  const engine = new EmulatorEngine();
  const startedAt = Date.now();
  const result = engine.run({
    historyDir,
    symbols: [args.symbol],
    timeframe: args.timeframe,
    zigzagConfig: args.zigzagConfig,
    limitPerSymbol: args.limit,
  });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[Emulator] Finished in ${elapsedSec}s — ${result.candlesProcessed.toLocaleString()} candles, ${result.trades.length} trades, ${result.discardedOpenOrders} discarded`);

  const report = formatReport(result);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOut = path.join(repoRoot, 'results', `emulation-${timestamp}.md`);
  const outPath = args.out ? path.resolve(process.cwd(), args.out) : defaultOut;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, report, 'utf-8');
  console.log(`[Emulator] Report written to ${outPath}`);
}

try {
  main();
} catch (err) {
  console.error('[Emulator] Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
}
