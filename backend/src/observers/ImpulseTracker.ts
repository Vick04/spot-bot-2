import { ImpulseTrackingSnapshot } from '../types';

const REACHED_MULT = 1.003;  // +0.3%
const READY_TO_BUY_WINDOW_MS = 10_000;

export class ImpulseTracker {
  private inPosition = false;
  private allowed = false;
  private reached = false;
  private counter = 0;
  private allowedPrice: number | undefined = undefined;
  private allowedActivatedAt: number | null = null;
  private timings: number[] = [];
  private averageTime: number | null = null;

  process(close: number, ma20: number, ma99: number, prevBBUpper: number, prevMa20: number): void {
    // Step 1: inPosition — ma20 > ma99
    this.inPosition = ma20 > ma99;

    if (!this.inPosition) {
      this.allowed = false;
      this.reached = false;
      this.allowedPrice = undefined;
      this.allowedActivatedAt = null;
      return;
    }

    // Step 2: allowed — inPosition is true AND price > prevBBUpper
    if (!this.allowed && close > prevBBUpper) {
      this.allowed = true;
      this.allowedPrice = close;
      this.allowedActivatedAt = Date.now();
    }

    // Step 3: reached — price > allowedPrice * 1.003
    if (!this.reached && this.allowedPrice !== undefined && close >= this.allowedPrice * REACHED_MULT) {
      this.reached = true;

      if (this.allowedActivatedAt !== null) {
        const elapsed = Date.now() - this.allowedActivatedAt;
        this.timings.push(elapsed);
        this.averageTime = this.timings.reduce((a, b) => a + b, 0) / this.timings.length;
      }

      this.counter++;
      this.reset();
    }

    // Reset allowed/reached if price goes below prevMa20
    if ((this.allowed || this.reached) && close < prevMa20) {
      this.allowed = false;
      this.reached = false;
      this.allowedPrice = undefined;
      this.allowedActivatedAt = null;
    }
  }

  get currentElapsedTime(): number | null {
    if (!this.allowed || this.allowedActivatedAt === null) return null;
    return Date.now() - this.allowedActivatedAt;
  }

  get readyToBuy(): boolean {
    const elapsed = this.currentElapsedTime;
    return elapsed !== null && elapsed <= READY_TO_BUY_WINDOW_MS;
  }

  getSnapshot(): ImpulseTrackingSnapshot {
    return {
      inPosition: this.inPosition,
      allowed: this.allowed,
      reached: this.reached,
      counter: this.counter,
      allowedPrice: this.allowedPrice,
      allowedActivatedAt: this.allowedActivatedAt,
      currentElapsedTime: this.currentElapsedTime,
      timings: this.timings,
      averageTime: this.averageTime,
      readyToBuy: this.readyToBuy,
    };
  }

  resetAll(): void {
    this.inPosition = false;
    this.allowed = false;
    this.reached = false;
    this.counter = 0;
    this.allowedPrice = undefined;
    this.allowedActivatedAt = null;
    this.timings = [];
    this.averageTime = null;
  }

  private reset(): void {
    this.allowed = false;
    this.reached = false;
    this.allowedPrice = undefined;
    this.allowedActivatedAt = null;
  }
}
