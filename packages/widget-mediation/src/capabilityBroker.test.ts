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

import { describe, expect, it, vi } from 'vitest';
import { CapabilityBroker } from './capabilityBroker';
import { FakeOuterApi } from './testing/fakeOuterApi';

const HOST = ['org.matrix.msc2762.send.event:net.example.host'];
const A = 'org.matrix.msc2762.send.event:net.example.a';
const B = 'org.matrix.msc2762.receive.event:net.example.b';
const C = 'org.matrix.msc2762.receive.state_event:net.example.c';

function setup(outer = new FakeOuterApi(HOST), timeoutMs = 1000) {
  const broker = new CapabilityBroker(outer, { timeoutMs, batchWindowMs: 5 });
  outer.on('action:notify_capabilities', (ev: CustomEvent) =>
    broker.handleNotify((ev.detail.data as { approved: string[] }).approved),
  );
  return { outer, broker };
}

describe('CapabilityBroker', () => {
  it('does not renegotiate for capabilities the host already holds', async () => {
    const { outer, broker } = setup();
    const r = await broker.ensure(HOST);
    expect(r).toEqual({ approved: HOST, denied: [], timedOut: false });
    expect(outer.updateRequestedCapabilities).not.toHaveBeenCalled();
  });

  it('renegotiates the union of host and embedded capabilities', async () => {
    const { outer, broker } = setup();
    const r = await broker.ensure([A, ...HOST]);
    expect(outer.requestCapabilities).toHaveBeenCalledWith([A]);
    expect(outer.renegotiations).toEqual([[...HOST, A]]);
    expect(r.approved).toEqual([A, ...HOST]);
  });

  it('returns the intersection with what the user approved', async () => {
    const { outer, broker } = setup();
    outer.decide = (newly) => newly.filter((c) => c !== B);
    const r = await broker.ensure([A, B]);
    expect(r).toEqual({ approved: [A], denied: [B], timedOut: false });
  });

  it('batches concurrent requests into one renegotiation', async () => {
    const { outer, broker } = setup();
    const onRequest = vi.fn();
    const [r1, r2] = await Promise.all([
      broker.ensure([A], { onRequest }),
      broker.ensure([B], { onRequest }),
    ]);
    expect(outer.updateRequestedCapabilities).toHaveBeenCalledTimes(1);
    expect(outer.renegotiations[0]).toEqual([...HOST, A, B]);
    expect(onRequest.mock.calls.map((c) => c[0])).toEqual([[A], [B]]);
    expect(r1.approved).toEqual([A]);
    expect(r2.approved).toEqual([B]);
  });

  it('serialises: never two renegotiations in flight', async () => {
    const { outer, broker } = setup();
    outer.answerDelayMs = 30;
    let inFlight = 0;
    let maxInFlight = 0;
    const orig = outer.updateRequestedCapabilities.getMockImplementation()!;
    outer.updateRequestedCapabilities.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      outer.once('action:notify_capabilities', () => inFlight--);
      return orig();
    });
    const p1 = broker.ensure([A]);
    await new Promise((resolve) => setTimeout(resolve, 15)); // first one is in flight
    const p2 = broker.ensure([B]);
    const p3 = broker.ensure([C]);
    const results = await Promise.all([p1, p2, p3]);
    expect(maxInFlight).toBe(1);
    // p2 and p3 were queued while p1 was in flight: one more round for both.
    expect(outer.updateRequestedCapabilities).toHaveBeenCalledTimes(2);
    expect(outer.renegotiations[1]).toEqual([...HOST, A, B, C]);
    expect(results.every((r) => r.denied.length === 0)).toBe(true);
  });

  it('caches denials for the session unless retrying', async () => {
    const { outer, broker } = setup();
    outer.decide = () => [];
    expect((await broker.ensure([A])).denied).toEqual([A]);
    expect((await broker.ensure([A])).denied).toEqual([A]);
    expect(outer.updateRequestedCapabilities).toHaveBeenCalledTimes(1);

    outer.decide = (n) => n;
    const r = await broker.ensure([A], { retryDenied: true });
    expect(r.approved).toEqual([A]);
    expect(outer.updateRequestedCapabilities).toHaveBeenCalledTimes(2);
    // Requested once only; the renegotiation still carries the full union.
    expect(outer.requestCapabilities).toHaveBeenCalledTimes(1);
  });

  it('times out without caching a denial', async () => {
    const { outer, broker } = setup(new FakeOuterApi(HOST), 20);
    outer.silent = true;
    const r = await broker.ensure([A]);
    expect(r).toEqual({ approved: [], denied: [A], timedOut: true });
    outer.silent = false;
    expect((await broker.ensure([A])).approved).toEqual([A]);
  });

  it('settles and cleans up when the renegotiation fails', async () => {
    const { outer, broker } = setup();
    outer.updateRequestedCapabilities.mockRejectedValueOnce(
      new Error('Request timed out'),
    );
    const r = await broker.ensure([A]);
    expect(r).toEqual({ approved: [], denied: [A], timedOut: true });
    // The next attempt works (no stuck queue, no cached denial).
    expect((await broker.ensure([A])).approved).toEqual([A]);
  });

  it('accepts a keyed capability covered by a broader approved one', async () => {
    const any = 'org.matrix.msc2762.receive.state_event:m.room.power_levels';
    const { outer, broker } = setup(new FakeOuterApi([any]));
    expect((await broker.ensure([`${any}#`])).approved).toEqual([`${any}#`]);
    expect(outer.updateRequestedCapabilities).not.toHaveBeenCalled();
  });

  it('asks for the broader power_levels string when only the keyed one is held', async () => {
    const any = 'org.matrix.msc2762.receive.state_event:m.room.power_levels';
    const { outer, broker } = setup(new FakeOuterApi([`${any}#`]));
    expect((await broker.ensure([any])).approved).toEqual([any]);
    expect(outer.renegotiations).toEqual([[`${any}#`, any]]);
  });

  it('resolves pending requests on dispose', async () => {
    const { outer, broker } = setup();
    outer.silent = true;
    const p = broker.ensure([A]);
    broker.dispose();
    expect((await p).approved).toEqual([]);
  });
});
