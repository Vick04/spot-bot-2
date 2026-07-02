// Usage: npm run emulate -- [--symbols=BTCUSDT,ETHUSDT] [--limit=100000] [--out=path/to/report.md]
//   --symbols= comma-separated symbols to emulate (default: all symbols found in history/)
//   --limit=   max 1m candles per symbol to process (default: all available candles)
//   --out=     output path for the generated report (default: results/emulation-<timestamp>.md)
import fs from 'fs';
import path from 'path';
import { EmulatorEngine } from './EmulatorEngine';
import { formatReport } from './reportWriter';

function parseArgs(argv: string[]): { symbols?: string[]; limit?: number; out?: string } {
  const result: { symbols?: string[]; limit?: number; out?: string } = {};

  for (const arg of argv) {
    if (arg.startsWith('--symbols=')) {
      result.symbols = arg.slice('--symbols='.length).split(',').map(s => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--limit=')) {
      result.limit = Number(arg.slice('--limit='.length));
    } else if (arg.startsWith('--out=')) {
      result.out = arg.slice('--out='.length);
    }
  }

  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const repoRoot = path.join(__dirname, '..', '..', '..');
  const historyDir = path.join(repoRoot, 'history');

  const engine = new EmulatorEngine();
  const startedAt = Date.now();

  const result = await engine.run({
    historyDir,
    symbols: args.symbols,
    limitPerSymbol: args.limit,
  });

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[Emulator] Finished in ${elapsedSec}s`);

  const report = formatReport(result);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOut = path.join(repoRoot, 'results', `emulation-${timestamp}.md`);
  const outPath = args.out ? path.resolve(process.cwd(), args.out) : defaultOut;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, report, 'utf-8');

  console.log(`[Emulator] Report written to ${outPath}`);
}

main().catch(err => {
  console.error('[Emulator] Fatal error:', err);
  process.exit(1);
});
