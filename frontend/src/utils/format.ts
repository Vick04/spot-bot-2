const EU = 'de-DE';

/** Symbol price with 7 decimal places. E.g. 65.432,1234567 */
export function fmtPrice(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString(EU, { minimumFractionDigits: 7, maximumFractionDigits: 7 });
}

/** USDT amount (balance, profit, spent, received) with 2 decimal places. E.g. 10.000,12 */
export function fmtUsdt(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString(EU, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Elapsed time as Xh Xm Xs — hours and minutes omitted when zero. */
export function fmtTime(ms: number | null | undefined): string {
  if (ms == null) return '—';

  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);

  return parts.join(' ');
}

/** Duration alias — same format as fmtTime. */
export function fmtDuration(ms: number): string {
  return fmtTime(ms);
}

/** Date and time format: "01/06 15:30:45" (DD/MM HH:MM:SS) */
export function fmtDateTime(ts: number): string {
  const date = new Date(ts);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${day}/${month} ${hours}:${minutes}:${seconds}`;
}

/** Generate Binance spot trading link for a symbol. E.g. BTCUSDT -> https://www.binance.com/es-AR/trade/BTC_USDT?type=spot */
export function getBinanceLink(symbol: string): string {
  const pair = symbol.replace('USDT', '').concat('_USDT');
  return `https://www.binance.com/es-AR/trade/${pair}?type=spot`;
}
