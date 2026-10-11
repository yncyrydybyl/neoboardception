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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimitedError, SendThrottle, TokenBucket } from './rateLimit';

describe('SendThrottle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a burst immediately and spaces out the rest', async () => {
    vi.useFakeTimers();
    const bucket = new TokenBucket({ burst: 2, perSecond: 1 });
    const throttle = new SendThrottle(() => [bucket], 10);
    const sent: number[] = [];
    const run = (n: number) => () => {
      sent.push(n);
      return Promise.resolve(n);
    };
    const all = Promise.all(
      [1, 2, 3].map((n) => throttle.schedule(undefined, run(n))),
    );
    expect(sent).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual([1, 2, 3]);
    await expect(all).resolves.toEqual([1, 2, 3]);
  });

  it('requires a token from every bucket (aggregate budget)', async () => {
    vi.useFakeTimers();
    const own = new TokenBucket({ burst: 5, perSecond: 1 });
    const shared = new TokenBucket({ burst: 1, perSecond: 1 });
    const throttle = new SendThrottle(() => [own, shared], 10);
    const run = vi.fn(() => Promise.resolve());
    void throttle.schedule(undefined, run);
    void throttle.schedule(undefined, run);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('coalesces queued writes with the same key', async () => {
    vi.useFakeTimers();
    const bucket = new TokenBucket({ burst: 1, perSecond: 1 });
    const throttle = new SendThrottle(() => [bucket], 10);
    const sent: string[] = [];
    const run = (v: string) => () => {
      sent.push(v);
      return Promise.resolve(v);
    };
    const p0 = throttle.schedule('k', run('a'));
    const p1 = throttle.schedule('k', run('b'));
    const p2 = throttle.schedule('k', run('c'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual(['a', 'c']);
    await expect(Promise.all([p0, p1, p2])).resolves.toEqual(['a', 'c', 'c']);
  });

  it('fails fast when the queue is full and on stop', async () => {
    const bucket = new TokenBucket({ burst: 0, perSecond: 0.001 });
    const throttle = new SendThrottle(() => [bucket], 1);
    const queued = throttle.schedule(undefined, () => Promise.resolve());
    await expect(
      throttle.schedule(undefined, () => Promise.resolve()),
    ).rejects.toBeInstanceOf(RateLimitedError);
    throttle.stop();
    await expect(queued).rejects.toBeInstanceOf(RateLimitedError);
  });
});
