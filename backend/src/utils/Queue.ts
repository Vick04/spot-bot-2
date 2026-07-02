/**
 * Fixed-capacity FIFO queue. Once full, each new item evicts the oldest.
 */
export class Queue<T> {
  private items: T[] = [];
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  /** Pushes an item; returns the evicted item if one was pushed out, else undefined. */
  push(item: T): T | undefined {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      return this.items.shift();
    }
    return undefined;
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
