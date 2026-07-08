import { useEffect, useState } from 'react';

interface OrderSizesState {
  balance: number;
  sizes: Record<string, number>;
}

const EMPTY: OrderSizesState = { balance: 0, sizes: {} };
const POLL_INTERVAL_MS = 5000;

/** Polls the order-size preview for the given symbols — order size only
 * changes on a buy/sell anywhere (affects balance) or a 1m candle close per
 * symbol (affects quoteVolume24h), neither frequent enough to justify a
 * live push; a short poll keeps the footer close enough to current. */
export function useOrderSizes(symbols: string[]): OrderSizesState {
  const key = symbols.slice().sort().join(',');
  const [state, setState] = useState<OrderSizesState>(EMPTY);

  useEffect(() => {
    if (symbols.length === 0) {
      setState(EMPTY);
      return;
    }

    let cancelled = false;

    const fetchSizes = () => {
      fetch(`/api/orders/sizes?symbols=${encodeURIComponent(symbols.join(','))}`)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((json: { data: OrderSizesState }) => {
          if (!cancelled) setState(json.data);
        })
        .catch(() => {
          // Keep showing the last known sizes on a transient failure.
        });
    };

    fetchSizes();
    const interval = setInterval(fetchSizes, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [key]);

  return state;
}
