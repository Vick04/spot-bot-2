import { ImpulseTrackingSnapshot } from '../types';

const ALLOWED_THRESHOLD = 1.004;  // +0.4%
const REACHED_THRESHOLD = 1.007;  // +0.7%
const READY_TO_BUY_WINDOW_MS = 10_000;

export class ImpulseTracker {
  private floor: number | undefined = undefined;
  private allowed = false;
  private reached = false;
  private counter = 0;
  private ma99AtFloorSet: number | undefined = undefined;
  private allowedActivatedAt: number | null = null;
  private timings: number[] = [];
  private averageTime: number | null = null;

  process(close: number, ma20: number, ma99: number): void {
    // Step 1: set floor — price > ma20
    if (this.floor === undefined && close > ma20) {
      this.floor = close;
      this.ma99AtFloorSet = ma99;
      this.allowed = false;
      this.reached = false;
      return; // Return early since floor just set, no need to process steps 3-4 yet
    }

    // Step 2: update floor to higher high
    if (this.floor !== undefined && close > this.floor) {
      this.floor = close;
      this.allowed = false;
      this.reached = false;
      // Continue processing steps 3-4 since price moved higher
    }

    // Step 3: allow — price recovers +0.4% from floor
    if (this.floor !== undefined && !this.allowed && close >= this.floor * ALLOWED_THRESHOLD) {
      this.allowed = true;
      this.allowedActivatedAt = Date.now();
    }

    // Step 4: reached — price hits +0.7% from floor
    if (this.floor !== undefined && !this.reached && close >= this.floor * REACHED_THRESHOLD) {
      this.reached = true;

      if (this.allowedActivatedAt !== null) {
        const elapsed = Date.now() - this.allowedActivatedAt;
        this.timings.push(elapsed);
        this.averageTime = this.timings.reduce((a, b) => a + b, 0) / this.timings.length;
      }

      this.counter++;
      this.reset();
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
      floor: this.floor,
      allowed: this.allowed,
      reached: this.reached,
      counter: this.counter,
      ma99AtFloorSet: this.ma99AtFloorSet,
      allowedActivatedAt: this.allowedActivatedAt,
      currentElapsedTime: this.currentElapsedTime,
      timings: this.timings,
      averageTime: this.averageTime,
      readyToBuy: this.readyToBuy,
    };
  }

  resetAll(): void {
    this.floor = undefined;
    this.allowed = false;
    this.reached = false;
    this.counter = 0;
    this.ma99AtFloorSet = undefined;
    this.allowedActivatedAt = null;
    this.timings = [];
    this.averageTime = null;
  }

  private reset(): void {
    this.floor = undefined;
    this.allowed = false;
    this.reached = false;
    this.ma99AtFloorSet = undefined;
    this.allowedActivatedAt = null;
  }
}
