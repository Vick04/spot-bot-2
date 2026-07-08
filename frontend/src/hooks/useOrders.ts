import { useEffect, useState } from 'react';
import { ActiveOrder, OrderCompletedEvent, OrderOpenedEvent, OrderStatus } from '../types';
import { getSocket } from './socket';

const EMPTY_STATUS: OrderStatus = { balance: 0, activeOrders: [], completedCount: 0, totalProfitPct: 0 };

export function useOrders(): OrderStatus {
  const [status, setStatus] = useState<OrderStatus>(EMPTY_STATUS);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/orders')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: { data: OrderStatus }) => {
        if (cancelled) return;
        setStatus(json.data);
      })
      .catch(() => {
        // The socket's 'snapshot' event carries the same data — a failed
        // initial fetch just means the view starts empty until then.
      });

    const socket = getSocket();

    const handleSnapshot = (snapshot: { orders?: OrderStatus }) => {
      if (snapshot.orders) setStatus(snapshot.orders);
    };

    const handleOpened = (event: OrderOpenedEvent) => {
      setStatus(s => ({
        ...s,
        balance: event.balance,
        activeOrders: [...s.activeOrders.filter(o => o.symbol !== event.order.symbol), event.order],
      }));
    };

    const handleCompleted = (event: OrderCompletedEvent) => {
      setStatus(s => ({
        balance: event.balance,
        activeOrders: s.activeOrders.filter((o: ActiveOrder) => o.symbol !== event.order.symbol),
        completedCount: event.completedCount,
        totalProfitPct: event.totalProfitPct,
      }));
    };

    socket.on('snapshot', handleSnapshot);
    socket.on('order:opened', handleOpened);
    socket.on('order:completed', handleCompleted);

    return () => {
      cancelled = true;
      socket.off('snapshot', handleSnapshot);
      socket.off('order:opened', handleOpened);
      socket.off('order:completed', handleCompleted);
    };
  }, []);

  return status;
}
