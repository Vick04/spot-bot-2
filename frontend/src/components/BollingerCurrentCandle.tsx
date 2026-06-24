import { BollingerCandle } from '../types';
import { fmtPrice, fmtDateTime, getBinanceLink } from '../utils/format';

interface Props {
  symbol: string;
  current: BollingerCandle | null;
  isReady: boolean;
}

function Field({ label, value, color = '' }: { label: string; value: string; color?: string }) {
  return (
    <>
      <div className="text-gray-400">{label}</div>
      <div className={`font-mono ${color}`}>{value}</div>
    </>
  );
}

export function BollingerCurrentCandle({ symbol, current, isReady }: Props) {
  const changePct = current ? ((current.close - current.open) / current.open) * 100 : 0;
  const changeColor = changePct >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <div className="rounded-lg border border-yellow-500/30 bg-gray-800 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          <a
            href={getBinanceLink(symbol)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold text-yellow-400 hover:text-yellow-300 underline"
          >
            {symbol}
          </a>
          <span className="text-xs text-gray-500 uppercase tracking-wider">1h · live</span>
        </div>
        {!isReady && <span className="text-xs text-red-400">warming up…</span>}
      </div>

      {current ? (
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
          <Field label="Open time" value={fmtDateTime(current.openTime)} color="text-gray-300" />
          <Field label="Change" value={`${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`} color={changeColor} />
          <Field label="Open" value={fmtPrice(current.open)} color="text-gray-300" />
          <Field label="Close" value={fmtPrice(current.close)} color="text-white font-semibold" />
          <Field label="High" value={fmtPrice(current.high)} color="text-green-400" />
          <Field label="Low" value={fmtPrice(current.low)} color="text-red-400" />

          <div className="col-span-2 border-t border-gray-700 my-1" />

          <Field label="MA20" value={fmtPrice(current.ma20)} color="text-yellow-400" />
          <Field label="MA99" value={fmtPrice(current.ma99)} color="text-blue-400" />
          <Field label="BB Upper" value={fmtPrice(current.bbUpper)} color="text-purple-400" />
          <Field label="BB Middle" value={fmtPrice(current.bbMiddle)} color="text-gray-300" />
          <Field label="BB Lower" value={fmtPrice(current.bbLower)} color="text-purple-400" />
          <Field label="BB Width" value={fmtPrice(current.bbWidth)} color="text-pink-400" />
        </div>
      ) : (
        <div className="text-xs text-gray-500 text-center py-4">Waiting for live candle…</div>
      )}
    </div>
  );
}
