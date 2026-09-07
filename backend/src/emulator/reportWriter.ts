import { EmulatorResult } from './EmulatorEngine';

function fmtPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function fmtPrice(value: number): string {
  return value.toFixed(6);
}

function fmtDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (h === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

function fmtTime(ms: number): string {
  return new Date(ms).toISOString();
}

function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const date = d.toISOString().split('T')[0];
  const time = d.toISOString().split('T')[1].substring(0, 8);
  return `${date} ${time}`;
}

export function formatReport(result: EmulatorResult): string {
  const { options, trades, pivots } = result;
  const wins = trades.filter(t => t.profitPct > 0).length;
  const losses = trades.filter(t => t.profitPct <= 0).length;
  const winRatePct = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const avgProfitPct = trades.length > 0 ? trades.reduce((sum, t) => sum + t.profitPct, 0) / trades.length : 0;
  const avgDurationMs = trades.length > 0 ? trades.reduce((sum, t) => sum + t.durationMs, 0) / trades.length : 0;
  const totalReturnPct = ((result.finalBalance - result.initialBalance) / result.initialBalance) * 100;

  const lines: string[] = [];
  lines.push(`# Emulation Report — ${options.symbols.join(', ')}`);
  lines.push('');
  lines.push('## Configuration');
  lines.push(`- Timeframe: ${options.timeframe}`);
  lines.push(`- Deviation: ${options.zigzagConfig.deviationPct}%`);
  lines.push(`- Min bars between pivots: ${options.zigzagConfig.minBarsBetweenPivots}`);
  lines.push(`- Price source: ${options.zigzagConfig.priceSource}`);
  lines.push(`- Candles processed: ${result.candlesProcessed.toLocaleString()}`);
  lines.push(`- Period: ${result.firstCandleTime !== null ? fmtTime(result.firstCandleTime) : '—'} — ${result.lastCandleTime !== null ? fmtTime(result.lastCandleTime) : '—'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Initial balance: ${fmtPrice(result.initialBalance)} USDT`);
  lines.push(`- Final balance: ${fmtPrice(result.finalBalance)} USDT`);
  lines.push(`- Total return: ${fmtPct(totalReturnPct)}`);
  lines.push(`- Completed trades: ${trades.length}`);
  lines.push(`- Win rate: ${winRatePct.toFixed(1)}% (${wins} wins / ${losses} losses)`);
  lines.push(`- Average profit per trade: ${trades.length > 0 ? fmtPct(avgProfitPct) : '—'}`);
  lines.push(`- Average trade duration: ${trades.length > 0 ? fmtDuration(avgDurationMs) : '—'}`);
  lines.push(`- Max drawdown: -${result.maxDrawdownPct.toFixed(2)}%`);
  lines.push(`- Discarded (still open at end of data): ${result.discardedOpenOrders}`);
  lines.push('');
  lines.push('## Trades');
  lines.push('');

  if (trades.length === 0) {
    lines.push('_No completed trades._');
  } else {
    lines.push('| # | Buy Pivot Time | Buy Pivot Price | Buy Time | Buy Price | Slippage | Sell Pivot Time | Sell Pivot Price | Sell Time | Sell Price | Slippage | Profit % | Duration |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    trades.forEach((t, i) => {
      lines.push(`| ${i + 1} | ${fmtTime(t.buyPivotTime)} | ${fmtPrice(t.buyPivotPrice)} | ${fmtTime(t.buyTime)} | ${fmtPrice(t.buyPrice)} | ${fmtPct(t.buySlippagePct)} | ${fmtTime(t.sellPivotTime)} | ${fmtPrice(t.sellPivotPrice)} | ${fmtTime(t.sellTime)} | ${fmtPrice(t.sellPrice)} | ${fmtPct(t.sellSlippagePct)} | ${fmtPct(t.profitPct)} | ${fmtDuration(t.durationMs)} |`);
    });
  }

  lines.push('');
  lines.push('## Detected Pivots');
  lines.push('');

  if (pivots.length === 0) {
    lines.push('_No pivots detected._');
  } else {
    lines.push('| # | Symbol | Type | Price | Date & Time |');
    lines.push('|---|---|---|---|---|');
    pivots.forEach((p, i) => {
      lines.push(`| ${i + 1} | ${p.symbol} | ${p.type === 'min' ? '📉 MIN' : '📈 MAX'} | ${fmtPrice(p.price)} | ${fmtDateTime(p.time)} |`);
    });
  }

  return lines.join('\n') + '\n';
}
