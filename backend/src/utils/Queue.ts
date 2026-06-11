/**
 * Fixed-capacity FIFO queue. Once full, each new item evicts the oldest.
 */
export class Queue<T> {
  private items: T[] = [];
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      this.items.shift();
    }
  }

  isFull(): boolean {
    return this.items.length === this.capacity;
  }

  size(): number {
    return this.items.length;
  }

  toArray(): T[] {
    return this.items.slice();
  }
}
