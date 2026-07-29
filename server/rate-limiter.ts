export type SlidingWindowRateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
};

export class SlidingWindowRateLimiter {
  private windowStartMs: number;
  private count = 0;
  private lastSeenMs: number;
  private readonly windowMs: number;
  private readonly limit: number;

  constructor(windowMs: number, limit: number, now = Date.now()) {
    this.windowMs = windowMs;
    this.limit = limit;
    this.windowStartMs = now;
    this.lastSeenMs = now;
  }

  allow(now = Date.now()): SlidingWindowRateLimitResult {
    this.lastSeenMs = now;

    if (now - this.windowStartMs >= this.windowMs) {
      this.windowStartMs = now;
      this.count = 0;
    }

    if (this.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAtMs: this.windowStartMs + this.windowMs,
      };
    }

    this.count += 1;
    return {
      allowed: true,
      remaining: this.limit - this.count,
      resetAtMs: this.windowStartMs + this.windowMs,
    };
  }

  isStale(now = Date.now()) {
    return now - this.lastSeenMs > this.windowMs * 4;
  }
}
