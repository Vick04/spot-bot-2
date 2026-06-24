import { useBollingerSocket } from '../hooks/useBollingerSocket';
import { BollingerCurrentCandle } from '../components/BollingerCurrentCandle';
import { BollingerHistoryTable } from '../components/BollingerHistoryTable';

export function BollingerPage() {
  const { observers } = useBollingerSocket();
  const states = Array.from(observers.values());

  if (states.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        Loading Bollinger observers…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <p className="text-xs text-gray-500">
        Isolated 1h observer for BTC &amp; ETH — MA20, MA99 and Bollinger Bands (20, 2)
        recomputed live on each tick. Does not affect the trading bot.
      </p>

      {states.map(state => (
        <div key={state.symbol} className="space-y-4">
          <BollingerCurrentCandle symbol={state.symbol} current={state.current} isReady={state.isReady} />
          <BollingerHistoryTable history={state.history} />
        </div>
      ))}
    </div>
  );
}
