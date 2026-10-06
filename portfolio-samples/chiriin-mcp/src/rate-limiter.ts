import { type Clock, systemClock } from './clock.js';

/**
 * FIFO sliding-window limiter: at most `limit` acquisitions in any `windowMs` window.
 *
 * GSI's survey calculation API documents a hard limit of 10 requests per 10 seconds
 * per IP address, and the other endpoints ask clients not to overload them, so every
 * upstream host gets one of these.
 */
export class SlidingWindowLimiter {
  private readonly stamps: number[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock = systemClock,
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer');
    if (!(windowMs > 0)) throw new RangeError('windowMs must be positive');
  }

  acquire(): Promise<void> {
    const turn = this.tail.then(() => this.waitForSlot());
    // Keep the chain alive even if a waiter throws (it never should).
    this.tail = turn.catch(() => undefined);
    return turn;
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      while (this.stamps.length > 0 && now - (this.stamps[0] ?? now) >= this.windowMs) this.stamps.shift();
      if (this.stamps.length < this.limit) {
        this.stamps.push(now);
        return;
      }
      const oldest = this.stamps[0] ?? now;
      await this.clock.sleep(Math.max(1, this.windowMs - (now - oldest)));
    }
  }
}
