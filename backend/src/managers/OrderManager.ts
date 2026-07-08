import { EventEmitter } from 'events';
import { ActiveOrder, CompletedOrder, OrderStatus } from '../types';
import { computeOrderSize, OrderSizeConfig } from '../utils/orderSize';

const INITIAL_BALANCE = 10_000;
const FEE = 0.001;            // 0.1% on buy (asset) and sell (usdt)
const TARGET_PCT = 0.005;     // +0.5% sell target (added, not multiplied, to avoid FP drift e.g. 100*1.005 !== 100.5)
const ORDER_SIZE_CONFIG: OrderSizeConfig = { factor: 0.0001, maxUsdt: 10_000 };

export class OrderManager extends EventEmitter {
  private balance: number = INITIAL_BALANCE;
  private activeOrders: Map<string, ActiveOrder> = new Map();
  private completedOrders: CompletedOrder[] = [];

  hasActiveOrder(symbol: string): boolean {
    return this.activeOrders.has(symbol);
  }

  computeOrderSize(quoteVolume24h: number): number {
    return computeOrderSize(this.balance, quoteVolume24h, ORDER_SIZE_CONFIG);
  }

  buy(symbol: string, price: number, quoteVolume24h: number): ActiveOrder | null {
    if (this.activeOrders.has(symbol)) return null;

    const orderSize = this.computeOrderSize(quoteVolume24h);
    if (orderSize <= 0) return null;

    const rawQuantity = orderSize / price;
    const quantity = rawQuantity * (1 - FEE);
    const targetPrice = price + price * TARGET_PCT;

    this.balance -= orderSize;
    const order: ActiveOrder = {
      symbol,
      buyPrice: price,
      targetPrice,
      quantity,
      usdtSpent: orderSize,
      openedAt: Date.now(),
    };
    this.activeOrders.set(symbol, order);

    console.log(`[Order] BUY  ${symbol} @ ${price} | size: ${orderSize.toFixed(2)} USDT | qty: ${quantity.toFixed(6)} | target: ${targetPrice.toFixed(8)}`);
    this.emit('opened', { order, balance: this.balance });
    return order;
  }

  onPriceTick(symbol: string, price: number): void {
    const order = this.activeOrders.get(symbol);
    if (!order) return;
    if (price >= order.targetPrice) {
      this.complete(order, price);
    }
  }

  getStatus(): OrderStatus {
    return {
      balance: this.balance,
      activeOrders: Array.from(this.activeOrders.values()),
      completedCount: this.completedOrders.length,
      totalProfitPct: this.getTotalProfitPct(),
    };
  }

  private complete(order: ActiveOrder, price: number): void {
    const rawUsdt = order.quantity * price;
    const usdtReceived = rawUsdt * (1 - FEE);
    const profit = usdtReceived - order.usdtSpent;
    const profitPct = (profit / order.usdtSpent) * 100;
    const closedAt = Date.now();

    const completed: CompletedOrder = {
      ...order,
      sellPrice: price,
      usdtReceived,
      profit,
      profitPct,
      closedAt,
      durationMs: closedAt - order.openedAt,
    };

    this.activeOrders.delete(order.symbol);
    this.completedOrders.push(completed);
    this.balance += usdtReceived;

    console.log(`[Order] SELL ${completed.symbol} @ ${price} | profit: ${profit.toFixed(4)} USDT (${profitPct.toFixed(3)}%) | balance: ${this.balance.toFixed(4)}`);
    this.emit('completed', {
      order: completed,
      balance: this.balance,
      completedCount: this.completedOrders.length,
      totalProfitPct: this.getTotalProfitPct(),
    });
  }

  private getTotalProfitPct(): number {
    if (this.completedOrders.length === 0) return 0;
    const totalProfit = this.completedOrders.reduce((sum, o) => sum + o.profit, 0);
    const totalInvested = this.completedOrders.reduce((sum, o) => sum + o.usdtSpent, 0);
    return totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
  }
}
