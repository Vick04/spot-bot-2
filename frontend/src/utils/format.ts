const EU = 'de-DE';

/** Price with up to 2 decimal places, European separators. E.g. 65.432,12 */
export function fmtPrice(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString(EU, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** USDT amount with exactly 2 decimal places. E.g. 10.000,12 */
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
