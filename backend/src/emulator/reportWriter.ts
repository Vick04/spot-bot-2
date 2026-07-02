import { EmulationResult } from './EmulatorEngine';

function formatDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

export function formatReport(result: EmulationResult): string {
  const { initialBalance, finalBalance, orders, discardedOrder } = result;

  const returnPct = ((finalBalance - initialBalance) / initialBalance) * 100;
  const wins = orders.filter(o => o.profit > 0).length;
  const losses = orders.length - wins;
  const winRate = orders.length > 0 ? (wins / orders.length) * 100 : 0;

  const lines: string[] = [];
  lines.push('# Reporte de emulación — 12 meses');
  lines.push('');
  lines.push('| Métrica | Valor |');
  lines.push('|---|---|');
  lines.push(`| Saldo inicial | ${initialBalance.toFixed(2)} USDT |`);
  lines.push(`| Saldo final | ${finalBalance.toFixed(2)} USDT |`);
  lines.push(`| Rendimiento | ${returnPct.toFixed(2)}% |`);
  lines.push(`| Win rate | ${winRate.toFixed(1)}% (${wins}W/${losses}L) |`);
  lines.push(`| Órdenes ejecutadas | ${orders.length} |`);
  lines.push('');
  lines.push('| Símbolo | Rendimiento % | Fecha inicio | Fecha fin |');
  lines.push('|---|---|---|---|');

  for (const order of orders) {
    lines.push(`| ${order.symbol} | ${order.profitPct.toFixed(3)}% | ${formatDate(order.openedAt)} | ${formatDate(order.closedAt)} |`);
  }

  if (discardedOrder) {
    lines.push('');
    lines.push('_Orden final inconclusa: descartada (saldo restaurado al valor previo a esa compra, no incluida en la tabla)._');
  }

  return lines.join('\n') + '\n';
}
