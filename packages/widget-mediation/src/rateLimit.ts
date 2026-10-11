/*
 * Copyright 2026 Nordeck IT + Consulting GmbH
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export interface RateLimit {
  /** Events that may be sent at once. */
  burst: number;
  /** Sustained events per second. */
  perSecond: number;
}

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly limit: RateLimit,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = limit.burst;
    this.last = now();
  }

  private refill() {
    const t = this.now();
    this.tokens = Math.min(
      this.limit.burst,
      this.tokens + ((t - this.last) / 1000) * this.limit.perSecond,
    );
    this.last = t;
  }

  available(): boolean {
    this.refill();
    return this.tokens >= 1;
  }

  take(): void {
    this.refill();
    this.tokens -= 1;
  }

  /** Milliseconds until one token is available. */
  msUntilAvailable(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    if (this.limit.perSecond <= 0) return Number.POSITIVE_INFINITY;
    return Math.ceil(((1 - this.tokens) / this.limit.perSecond) * 1000);
  }
}

export class RateLimitedError extends Error {}

interface QueueItem {
  key: string | undefined;
  run: () => Promise<unknown>;
  waiters: Array<{
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
  }>;
}

/**
 * FIFO send queue gated by one or more token buckets (all must have a
 * token). Queued state writes with the same key are coalesced: the last
 * content wins and every caller receives the result of the single send.
 */
export class SendThrottle {
  private readonly queue: QueueItem[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly buckets: () => TokenBucket[],
    private readonly maxQueue: number,
  ) {}

  schedule<T>(key: string | undefined, run: () => Promise<T>): Promise<T> {
    if (this.stopped) {
      return Promise.reject(new RateLimitedError('Embedded widget stopped'));
    }
    return new Promise<T>((resolve, reject) => {
      const waiter = {
        resolve: resolve as (v: unknown) => void,
        reject,
      };
      const existing =
        key === undefined ? undefined : this.queue.find((q) => q.key === key);
      if (existing) {
        existing.run = run;
        existing.waiters.push(waiter);
        return;
      }
      if (this.queue.length >= this.maxQueue) {
        reject(new RateLimitedError('Too many events, slow down'));
        return;
      }
      this.queue.push({ key, run, waiters: [waiter] });
      this.pump();
    });
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    const items = this.queue.splice(0);
    items.forEach((i) =>
      i.waiters.forEach((w) =>
        w.reject(new RateLimitedError('Embedded widget stopped')),
      ),
    );
  }

  private pump() {
    if (this.timer !== undefined || this.stopped) return;
    while (this.queue.length > 0) {
      const buckets = this.buckets();
      const wait = Math.max(0, ...buckets.map((b) => b.msUntilAvailable()));
      if (wait > 0) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.pump();
        }, wait);
        return;
      }
      buckets.forEach((b) => b.take());
      const item = this.queue.shift()!;
      item
        .run()
        .then(
          (v) => item.waiters.forEach((w) => w.resolve(v)),
          (e) => item.waiters.forEach((w) => w.reject(e)),
        )
        .catch(() => undefined);
    }
  }
}
