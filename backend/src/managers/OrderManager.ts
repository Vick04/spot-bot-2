import { EventEmitter } from 'events';
import { ActiveOrder, CompletedOrder, OrderStatus } from '../types';

const INITIAL_BALANCE = 10_000;
const FEE = 0.001;           // 0.1% applied on buy (asset) and sell (usdt)
const TARGET_MULT = 1.005;   // +0.5% sell target

export class OrderManager extends EventEmitter {
  private balance: number = INITIAL_BALANCE;
  private activeOrder: ActiveOrder | null = null;
  private history: CompletedOrder[] = [];

  hasActiveOrder(): boolean {
    return this.activeOrder !== null;
  }

  buy(symbol: string, price: number): void {
    if (this.activeOrder !== null) return;
    if (this.balance <= 0) return;

    const usdtSpent = this.balance;
    const rawQuantity = usdtSpent / price;
    const quantity = rawQuantity * (1 - FEE);   // buy fee deducted from asset received
    const targetPrice = price * TARGET_MULT;

    this.balance = 0;
    this.activeOrder = { symbol, buyPrice: price, quantity, targetPrice, usdtSpent, openedAt: Date.now() };

    console.log(`[Order] BUY  ${symbol} @ ${price} | qty: ${quantity.toFixed(6)} | target: ${targetPrice.toFixed(8)}`);
    this.emit('buy', this.activeOrder);
  }

  onPriceTick(symbol: string, price: number): void {
    if (!this.activeOrder) return;
    if (this.activeOrder.symbol !== symbol) return;
    if (price < this.activeOrder.targetPrice) return;

    this.sell(price);
  }

  getBalance(): number { return this.balance; }
  getActiveOrder(): ActiveOrder | null { return this.activeOrder; }
  getHistory(): CompletedOrder[] { return this.history; }

  getStatus(): OrderStatus {
    return {
      balance: this.balance,
      activeOrder: this.activeOrder,
      totalTrades: this.history.length,
      totalProfit: this.history.reduce((sum, o) => sum + o.profit, 0),
    };
  }

  private sell(price: number): void {
    const order = this.activeOrder!;
    const rawUsdt = order.quantity * price;
    const usdtReceived = rawUsdt * (1 - FEE);   // sell fee deducted from usdt received
    const profit = usdtReceived - order.usdtSpent;
    const profitPct = (profit / order.usdtSpent) * 100;
    const closedAt = Date.now();

    const completed: CompletedOrder = {
      symbol: order.symbol,
      buyPrice: order.buyPrice,
      sellPrice: price,
      quantity: order.quantity,
      usdtSpent: order.usdtSpent,
      usdtReceived,
      profit,
      profitPct,
      openedAt: order.openedAt,
      closedAt,
      durationMs: closedAt - order.openedAt,
    };

    this.history.push(completed);
    this.balance = usdtReceived;
    this.activeOrder = null;

    console.log(`[Order] SELL ${completed.symbol} @ ${price} | profit: ${profit.toFixed(4)} USDT (${profitPct.toFixed(3)}%) | balance: ${this.balance.toFixed(4)}`);
    this.emit('sell', completed);
  }
}
