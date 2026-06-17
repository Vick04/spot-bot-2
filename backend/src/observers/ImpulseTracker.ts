import { ImpulseTrackingSnapshot } from '../types';
import { ContextValidatorResult } from './ContextValidator';

const ALLOWED_THRESHOLD = 1.008;  // +0.8%
const REACHED_THRESHOLD = 1.013;  // +1.3%
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
  private lastContext: ContextValidatorResult = { valid: false, valid1h: false, valid1d: false };

  process(close: number, ma99: number, context: ContextValidatorResult): void {
    this.lastContext = context;

    // Step 1: set floor — both context validators must be true
    if (this.floor === undefined) {
      if (context.valid) {
        this.floor = close;
        this.ma99AtFloorSet = ma99;
        this.allowed = false;
        this.reached = false;
      }
      return;
    }

    // Step 2: update floor to lower low
    if (close < this.floor) {
      this.floor = close;
      this.allowed = false;
      this.reached = false;
      return;
    }

    // Step 3: allow — price recovers +0.8% from floor
    if (!this.allowed && close >= this.floor * ALLOWED_THRESHOLD) {
      this.allowed = true;
      this.allowedActivatedAt = Date.now();
    }

    // Step 4: reached — price hits +1.3% from floor
    if (!this.reached && close >= this.floor * REACHED_THRESHOLD) {
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
      contextValid: this.lastContext.valid,
      contextValid1h: this.lastContext.valid1h,
      contextValid1d: this.lastContext.valid1d,
    };
  }

  /** Full reset including counter and timings history. */
  resetAll(): void {
    this.floor = undefined;
    this.allowed = false;
    this.reached = false;
    this.counter = 0;
    this.ma99AtFloorSet = undefined;
    this.allowedActivatedAt = null;
    this.timings = [];
    this.averageTime = null;
    this.lastContext = { valid: false, valid1h: false, valid1d: false };
  }

  private reset(): void {
    this.floor = undefined;
    this.allowed = false;
    this.reached = false;
    this.ma99AtFloorSet = undefined;
    this.allowedActivatedAt = null;
    // timings and averageTime persist across cycles
  }
}
