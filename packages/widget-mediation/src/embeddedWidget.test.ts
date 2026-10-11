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

import { WidgetApi } from 'matrix-widget-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLL_CAPABILITIES } from './capabilities';
import { LOCAL_ECHO_MARKER, mountEmbeddedWidget } from './embeddedWidget';
import { configureMediation } from './outerHub';
import { prerequestCapabilities } from './prerequest';
import { FakeInnerWidget } from './testing/fakeInnerWidget';
import { FakeOuterApi } from './testing/fakeOuterApi';
import type {
  EmbeddedWidgetHandle,
  EmbeddedWidgetState,
  MountEmbeddedWidgetOptions,
  OuterWidgetApi,
} from './types';

const ORIGIN = 'https://poll.example';
const ROOM = '!room:example.org';
const USER = '@alice:example.org';
const params = { userId: USER, roomId: ROOM, theme: 'light' };

// Roughly what the host (a whiteboard) holds after its own handshake.
const HOST_CAPS = [
  'org.matrix.msc2762.send.event:net.example.board.doc',
  'org.matrix.msc2762.receive.event:net.example.board.doc',
  'org.matrix.msc2762.receive.state_event:m.room.power_levels#',
  'org.matrix.msc2762.receive.state_event:m.room.member',
  'org.matrix.msc2762.receive.state_event:m.room.create',
  'org.matrix.msc2762.receive.state_event:m.room.name',
  'io.element.requires_client',
];
const VOTE = 'net.nordeck.poll.vote';
const SEND_VOTE = `org.matrix.msc2762.send.event:${VOTE}`;
const RECEIVE_VOTE = `org.matrix.msc2762.receive.event:${VOTE}`;
const POLL_STATE = 'net.nordeck.poll';

const handles: EmbeddedWidgetHandle[] = [];

/** A fake host whose mediation answers capability requests without delay. */
function makeOuter(caps = HOST_CAPS, capabilityBatchMs = 0) {
  const outer = new FakeOuterApi(caps);
  configureMediation(outer, { capabilityBatchMs });
  return outer;
}

afterEach(() => {
  handles.splice(0).forEach((h) => h.destroy());
  vi.useRealTimers();
});

async function waitFor(check: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

function mount(
  outer: FakeOuterApi | Promise<FakeOuterApi>,
  overrides: Partial<MountEmbeddedWidgetOptions> = {},
  innerCaps: string[] = [...POLL_CAPABILITIES],
  innerVersions?: string[],
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const states: EmbeddedWidgetState[] = [];
  const handle = mountEmbeddedWidget({
    container,
    widgetUrl: `${ORIGIN}/`,
    widgetId: 'element-1',
    outerApi: outer,
    allowedOrigins: [ORIGIN],
    params,
    echoFallbackMs: 0,
    onStateChange: (s) => states.push(s),
    ...overrides,
  });
  handles.push(handle);
  const inner = handle.iframe
    ? new FakeInnerWidget(handle.iframe, handle.widgetId, {
        capabilities: innerCaps,
        versions: innerVersions,
      })
    : undefined;
  return { handle, inner: inner!, states, container };
}

async function boot(m: ReturnType<typeof mount>) {
  m.inner.load();
  await waitFor(() => ['ready', 'error'].includes(m.handle.getState().status));
  return m;
}

function upwardCalls(outer: FakeOuterApi, action: string) {
  return outer.transport.send.mock.calls.filter((c) => c[0] === action);
}

describe('handshake and capabilities', () => {
  it('goes loading → negotiating → ready and grants the intersection', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer));

    const statuses = m.states.map((s) => s.status);
    expect(statuses[0]).toBe('loading');
    expect(statuses).toContain('negotiating');
    expect(statuses.at(-1)).toBe('ready');
    expect(m.inner.approved).toEqual(
      expect.arrayContaining([...POLL_CAPABILITIES]),
    );
    expect(m.inner.approved).toHaveLength(POLL_CAPABILITIES.length);

    // Upward: one renegotiation with the union of host and Poll caps.
    expect(outer.renegotiations).toHaveLength(1);
    expect(new Set(outer.renegotiations[0])).toEqual(
      new Set([...HOST_CAPS, ...POLL_CAPABILITIES]),
    );
    // Both power_levels spellings are held by the host afterwards.
    expect(outer.approved).toContain(
      'org.matrix.msc2762.receive.state_event:m.room.power_levels',
    );
    expect(outer.approved).toContain(
      'org.matrix.msc2762.receive.state_event:m.room.power_levels#',
    );
  });

  it('advertises the versions toolkit widgets need, without update_state', async () => {
    const m = await boot(mount(makeOuter()));
    expect(m.inner.clientVersions).toEqual(
      expect.arrayContaining([
        'org.matrix.msc2871',
        'org.matrix.msc3869',
        'org.matrix.msc2876',
        'org.matrix.msc2974',
      ]),
    );
    expect(m.inner.clientVersions).not.toContain(
      'org.matrix.msc2762_update_state',
    );
  });

  it('starts the handshake on iframe load (no content_loaded needed)', async () => {
    const m = mount(makeOuter());
    await tick();
    expect(m.inner.received_('capabilities')).toHaveLength(0);
    m.inner.load();
    await waitFor(() => m.inner.received_('capabilities').length === 1);
  });

  it('reports who asks for which capabilities', async () => {
    const outer = makeOuter();
    const onCapabilityRequest = vi.fn();
    const m = await boot(mount(outer, { onCapabilityRequest, name: 'Poll' }));
    expect(onCapabilityRequest).toHaveBeenCalledTimes(1);
    const info = onCapabilityRequest.mock.calls[0][0];
    expect(info).toMatchObject({
      widgetId: m.handle.widgetId,
      name: 'Poll',
      origin: ORIGIN,
      url: `${ORIGIN}/`,
    });
    // Everything is disclosed, also what the host already holds.
    expect(new Set(info.capabilities)).toEqual(new Set(POLL_CAPABILITIES));
    expect(info.inherited).toContain('io.element.requires_client');
    expect(info.inherited).toContain(
      'org.matrix.msc2762.receive.state_event:m.room.member',
    );
    expect(info.upstream).toContain(SEND_VOTE);
    expect(info.upstream).not.toContain('io.element.requires_client');
    await expect(info.settled).resolves.toMatchObject({ timedOut: false });
  });

  it('never forwards capabilities outside the policy', async () => {
    const outer = makeOuter();
    const extra = [
      'org.matrix.msc2762.send.event:net.example.board.doc',
      'org.matrix.msc2762.send.state_event:im.vector.modular.widgets#embedded-element-1',
      'org.matrix.msc2762.timeline:*',
    ];
    const m = await boot(mount(outer, {}, [...POLL_CAPABILITIES, ...extra]));
    expect(outer.requested).not.toContain(extra[1]);
    expect(outer.requested).not.toContain(extra[2]);
    // The host holds the board capability, but it is not in the allow-list.
    expect(m.inner.approved).not.toContain(extra[0]);
    expect(m.inner.approved).not.toContain(extra[1]);
    const state = m.handle.getState();
    expect(
      state.status === 'ready' && state.capabilities.blockedByPolicy,
    ).toEqual(extra);
  });

  it('honours deniedCapabilities for the host namespace', async () => {
    const outer = makeOuter();
    const m = await boot(
      mount(
        outer,
        {
          allowedCapabilities: [
            RECEIVE_VOTE,
            'org.matrix.msc2762.receive.event:net.example.*',
          ],
          allowCapabilityGlobs: true,
          deniedCapabilities: [
            'org.matrix.msc2762.receive.event:net.example.board*',
          ],
        },
        [
          'org.matrix.msc2762.receive.event:net.example.board.doc',
          RECEIVE_VOTE,
        ],
      ),
    );
    expect(m.inner.approved).toEqual([RECEIVE_VOTE]);
  });

  it('negotiates two widgets mounted together in one round', async () => {
    const outer = makeOuter(HOST_CAPS, 20);
    const a = mount(outer, {}, [SEND_VOTE]);
    const b = mount(outer, { widgetId: 'element-2' }, [RECEIVE_VOTE]);
    a.inner.load();
    b.inner.load();
    await waitFor(
      () =>
        a.handle.getState().status === 'ready' &&
        b.handle.getState().status === 'ready',
    );
    expect(outer.updateRequestedCapabilities).toHaveBeenCalledTimes(1);
    expect(a.inner.approved).toEqual([SEND_VOTE]);
    expect(b.inner.approved).toEqual([RECEIVE_VOTE]);
  });

  it('ends in error(denied) when the user grants nothing', async () => {
    const outer = makeOuter();
    outer.decide = () => [];
    const m = await boot(mount(outer, {}, [SEND_VOTE, RECEIVE_VOTE]));
    expect(m.handle.getState()).toMatchObject({
      status: 'error',
      reason: 'denied',
      capabilities: { deniedUpstream: [SEND_VOTE, RECEIVE_VOTE] },
    });
    expect(m.inner.approved).toEqual([]);
  });

  it('does not show the dialog again on reload, but on retry', async () => {
    const outer = makeOuter();
    outer.decide = () => [];
    const m = await boot(mount(outer, {}, [SEND_VOTE]));
    expect(outer.updateRequestedCapabilities).toHaveBeenCalledTimes(1);

    m.handle.reload();
    const inner2 = new FakeInnerWidget(m.handle.iframe!, m.handle.widgetId, {
      capabilities: [SEND_VOTE],
    });
    inner2.load();
    await waitFor(() => m.handle.getState().status === 'error');
    expect(outer.updateRequestedCapabilities).toHaveBeenCalledTimes(1);

    outer.decide = (n) => n;
    m.handle.retryCapabilities();
    const inner3 = new FakeInnerWidget(m.handle.iframe!, m.handle.widgetId, {
      capabilities: [SEND_VOTE],
    });
    inner3.load();
    await waitFor(() => m.handle.getState().status === 'ready');
    expect(outer.updateRequestedCapabilities).toHaveBeenCalledTimes(2);
    expect(inner3.approved).toEqual([SEND_VOTE]);
  });

  it('forwards a runtime renegotiation (MSC2974) upward as a union', async () => {
    const outer = makeOuter();
    const extra = 'org.matrix.msc2762.receive.event:net.example.extra';
    const m = await boot(
      mount(outer, { allowedCapabilities: [SEND_VOTE, extra] }, [SEND_VOTE]),
    );
    const before = outer.renegotiations.length;
    await m.inner.request('org.matrix.msc2974.request_capabilities', {
      capabilities: [SEND_VOTE, extra],
    });
    await waitFor(() => m.inner.approved?.includes(extra) ?? false);
    expect(outer.renegotiations).toHaveLength(before + 1);
    expect(outer.renegotiations.at(-1)).toEqual(
      expect.arrayContaining([...HOST_CAPS, SEND_VOTE, extra]),
    );
    const state = m.handle.getState();
    expect(state.status === 'ready' && state.capabilities.granted).toContain(
      extra,
    );
  });

  it('can start before the outer API is available', async () => {
    const outer = makeOuter();
    let resolveOuter!: (o: FakeOuterApi) => void;
    const m = mount(
      new Promise<FakeOuterApi>((resolve) => (resolveOuter = resolve)),
      {},
      [SEND_VOTE],
    );
    m.inner.load();
    await tick();
    expect(m.handle.getState().status).toBe('negotiating');
    resolveOuter(outer);
    await waitFor(() => m.handle.getState().status === 'ready');
    expect(m.inner.approved).toEqual([SEND_VOTE]);
  });
});

describe('prerequestCapabilities', () => {
  it('asks once up front (policy applied) and mounts without a second dialog', async () => {
    const outer = makeOuter();
    const r = await prerequestCapabilities({
      outerApi: outer,
      capabilities: [...POLL_CAPABILITIES, 'org.matrix.msc2762.timeline:*'],
    });
    expect(r.denied).toEqual([]);
    expect(outer.requested).not.toContain('org.matrix.msc2762.timeline:*');
    await boot(mount(outer));
    expect(outer.updateRequestedCapabilities).toHaveBeenCalledTimes(1);
  });
});

describe('URL and loading', () => {
  it('refuses origins outside the deployment allow-list', () => {
    const m = mount(makeOuter(), {
      widgetUrl: 'https://other.example/',
    });
    expect(m.handle.iframe).toBeUndefined();
    expect(m.handle.getState()).toMatchObject({
      status: 'error',
      reason: 'load-failed',
    });
    expect(m.container.querySelector('iframe')).toBeNull();
  });

  it('refuses plain http', () => {
    const m = mount(makeOuter(), {
      widgetUrl: 'http://poll.example/',
      allowedOrigins: ['http://poll.example'],
    });
    expect(m.handle.getState()).toMatchObject({ reason: 'load-failed' });
  });

  it('builds the iframe with its own widget id and a safe sandbox', () => {
    const m = mount(makeOuter());
    const iframe = m.handle.iframe!;
    const src = new URL(iframe.src);
    expect(src.searchParams.get('widgetId')).toBe('embedded-element-1');
    expect(iframe.src).not.toContain('host-widget-id');
    const sandbox = iframe.getAttribute('sandbox')!.split(' ');
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).toContain('allow-same-origin');
    expect(sandbox.some((t) => t.startsWith('allow-top-navigation'))).toBe(
      false,
    );
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('drops allow-top-navigation from sandbox extras', () => {
    const m = mount(makeOuter(), {
      sandboxExtras: ['allow-top-navigation', 'allow-modals'],
    });
    const sandbox = m.handle.iframe!.getAttribute('sandbox')!;
    expect(sandbox).toContain('allow-modals');
    expect(sandbox).not.toContain('allow-top-navigation');
  });

  it('times out when the iframe never loads', async () => {
    const m = mount(makeOuter(), { loadTimeoutMs: 20 });
    await waitFor(() => m.handle.getState().status === 'error');
    expect(m.handle.getState()).toMatchObject({ reason: 'timeout' });
  });

  it('destroy removes the iframe and stops delivery', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer));
    m.handle.destroy();
    expect(m.container.querySelector('iframe')).toBeNull();
    const before = m.inner.received.length;
    outer.toWidget('send_event', voteEvent('$x'));
    await tick();
    expect(m.inner.received.length).toBe(before);
    // The widget id is free again.
    const again = mount(outer);
    expect(again.handle.iframe).toBeDefined();
  });
});

function voteEvent(eventId: string, overrides: Record<string, unknown> = {}) {
  return {
    type: VOTE,
    sender: USER,
    event_id: eventId,
    room_id: ROOM,
    origin_server_ts: 1,
    content: { answerId: '1' },
    unsigned: {},
    ...overrides,
  };
}

describe('forwarding', () => {
  it('sends events upward without room_id for the own room', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer));
    const r = await m.inner.request('send_event', {
      type: VOTE,
      content: { answerId: '1' },
    });
    expect(r).toMatchObject({ room_id: ROOM, event_id: expect.any(String) });
    expect(upwardCalls(outer, 'send_event')).toEqual([
      ['send_event', { type: VOTE, content: { answerId: '1' } }],
    ]);
  });

  it('reports sent events without content via onEventSent', async () => {
    const outer = makeOuter();
    const onEventSent = vi.fn();
    const m = await boot(mount(outer, { onEventSent }));
    const r = await m.inner.request('send_event', {
      type: POLL_STATE,
      state_key: 'uuid-1',
      content: { title: 'secret' },
    });
    expect(onEventSent).toHaveBeenCalledTimes(1);
    expect(onEventSent).toHaveBeenCalledWith({
      type: POLL_STATE,
      stateKey: 'uuid-1',
      eventId: r.event_id,
    });
  });

  it('sends state events with their state key', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer));
    await m.inner.request('send_event', {
      type: POLL_STATE,
      state_key: 'uuid-1',
      content: { title: 'x' },
    });
    expect(upwardCalls(outer, 'send_event')[0][1]).toEqual({
      type: POLL_STATE,
      state_key: 'uuid-1',
      content: { title: 'x' },
    });
  });

  it('rejects sends outside the granted capabilities without going upward', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer));
    const r1 = await m.inner.request('send_event', {
      type: 'net.example.board.doc',
      content: {},
    });
    const r2 = await m.inner.request('send_event', {
      type: 'im.vector.modular.widgets',
      state_key: 'embedded-element-1',
      content: { url: 'https://evil.example' },
    });
    expect(r1.error).toBeDefined();
    expect(r2.error).toBeDefined();
    expect(upwardCalls(outer, 'send_event')).toHaveLength(0);
  });

  it('delivers events from the outer client, filtered by the inner caps', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer));
    const ev = outer.toWidget('send_event', voteEvent('$own-echo'));
    outer.toWidget('send_event', {
      ...voteEvent('$board'),
      type: 'net.example.board.doc',
    });
    outer.toWidget(
      'send_event',
      voteEvent('$other-room', { room_id: '!other:x' }),
    );
    await tick();
    const delivered = m.inner
      .received_('send_event')
      .map((x) => x.data.event_id);
    expect(delivered).toEqual(['$own-echo']);
    // The host keeps handling its own copy.
    expect(ev.defaultPrevented).toBe(false);
  });

  it("echoes the widget's own events back (outer echo)", async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer));
    const r = await m.inner.request('send_event', { type: VOTE, content: {} });
    outer.toWidget('send_event', voteEvent(r.event_id as string));
    await tick();
    expect(m.inner.received_('send_event').map((x) => x.data.event_id)).toEqual(
      [r.event_id],
    );
  });

  it('falls back to a local echo once, if the outer client does not echo', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer, { echoFallbackMs: 20 }));
    const r = await m.inner.request('send_event', {
      type: VOTE,
      content: { answerId: '2' },
    });
    await waitFor(() => m.inner.received_('send_event').length === 1);
    expect(m.inner.received_('send_event')[0].data).toMatchObject({
      type: VOTE,
      event_id: r.event_id,
      room_id: ROOM,
      sender: USER,
      content: { answerId: '2' },
      unsigned: { [LOCAL_ECHO_MARKER]: true },
    });
    // A late echo from the outer client is not delivered twice.
    outer.toWidget('send_event', voteEvent(r.event_id as string));
    await tick(30);
    expect(m.inner.received_('send_event')).toHaveLength(1);
  });

  it('forwards read_events upward without room_ids and filters the result', async () => {
    const outer = makeOuter();
    outer.handlers['org.matrix.msc2876.read_events'] = () => ({
      events: [
        { type: POLL_STATE, state_key: 'a', room_id: ROOM, content: {} },
        { type: 'net.example.board.doc', room_id: ROOM, content: {} },
        { type: POLL_STATE, state_key: 'b', room_id: '!other:x', content: {} },
      ],
    });
    const m = await boot(mount(outer));
    const r = await m.inner.request('org.matrix.msc2876.read_events', {
      type: POLL_STATE,
      state_key: true,
      limit: Number.MAX_SAFE_INTEGER,
    });
    expect(upwardCalls(outer, 'org.matrix.msc2876.read_events')).toEqual([
      [
        'org.matrix.msc2876.read_events',
        { type: POLL_STATE, state_key: true, limit: Number.MAX_SAFE_INTEGER },
      ],
    ]);
    expect(r.events).toEqual([
      { type: POLL_STATE, state_key: 'a', room_id: ROOM, content: {} },
    ]);
  });

  it('treats an explicit own room in room_ids like no room_ids', async () => {
    const outer = makeOuter();
    outer.handlers['org.matrix.msc2876.read_events'] = () => ({
      events: [
        { type: POLL_STATE, state_key: 'a', room_id: ROOM, content: {} },
      ],
    });
    const m = await boot(mount(outer));
    const r = await m.inner.request('org.matrix.msc2876.read_events', {
      type: POLL_STATE,
      state_key: true,
      room_ids: [ROOM],
    });
    expect(r.error).toBeUndefined();
    expect(upwardCalls(outer, 'org.matrix.msc2876.read_events')).toEqual([
      ['org.matrix.msc2876.read_events', { type: POLL_STATE, state_key: true }],
    ]);
    expect(r.events).toHaveLength(1);
    // A foreign room next to the own one is still refused.
    const r2 = await m.inner.request('org.matrix.msc2876.read_events', {
      type: POLL_STATE,
      state_key: true,
      room_ids: [ROOM, '!other:x'],
    });
    expect(r2.error).toBeDefined();
  });

  it('rejects reads outside the caps without going upward', async () => {
    const outer = makeOuter();
    outer.handlers['org.matrix.msc2876.read_events'] = () => ({ events: [] });
    const m = await boot(mount(outer));
    const r = await m.inner.request('org.matrix.msc2876.read_events', {
      type: 'net.example.board.doc',
    });
    const r2 = await m.inner.request('org.matrix.msc2876.read_events', {
      type: VOTE,
      room_ids: ['!other:x'],
    });
    expect(r.error).toBeDefined();
    expect(r2.error).toBeDefined();
    expect(upwardCalls(outer, 'org.matrix.msc2876.read_events')).toHaveLength(
      0,
    );
  });

  it('coalesces identical concurrent reads', async () => {
    const outer = makeOuter();
    let release!: () => void;
    outer.handlers['org.matrix.msc2876.read_events'] = () =>
      new Promise((resolve) => (release = () => resolve({ events: [] })));
    const a = await boot(mount(outer));
    const b = await boot(mount(outer, { widgetId: 'element-2' }));
    const req = { type: POLL_STATE, state_key: true };
    const p = Promise.all([
      a.inner.request('org.matrix.msc2876.read_events', req),
      b.inner.request('org.matrix.msc2876.read_events', req),
    ]);
    await tick();
    release();
    await p;
    expect(upwardCalls(outer, 'org.matrix.msc2876.read_events')).toHaveLength(
      1,
    );
  });

  it('does not read room state upward for widgets without update_state', async () => {
    const outer = makeOuter();
    outer.handlers['org.matrix.msc2876.read_events'] = () => ({ events: [] });
    await boot(mount(outer));
    await tick();
    expect(upwardCalls(outer, 'org.matrix.msc2876.read_events')).toHaveLength(
      0,
    );
  });

  it('forwards read_relations and filters the chunk', async () => {
    const outer = makeOuter();
    outer.handlers['org.matrix.msc3869.read_relations'] = () => ({
      chunk: [
        voteEvent('$v1'),
        { ...voteEvent('$b'), type: 'net.example.board.doc' },
      ],
      next_batch: 'n',
    });
    const m = await boot(mount(outer));
    const r = await m.inner.request('org.matrix.msc3869.read_relations', {
      event_id: '$start',
      rel_type: 'm.reference',
      event_type: VOTE,
      limit: 50,
    });
    expect(
      upwardCalls(outer, 'org.matrix.msc3869.read_relations')[0][1],
    ).toEqual({
      event_id: '$start',
      room_id: undefined,
      rel_type: 'm.reference',
      event_type: VOTE,
      from: undefined,
      to: undefined,
      limit: 50,
      direction: undefined,
    });
    expect((r.chunk as { event_id: string }[]).map((e) => e.event_id)).toEqual([
      '$v1',
    ]);
    expect(r.next_batch).toBe('n');
  });

  it('forwards theme changes', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer));
    const ev = outer.toWidget('theme_change', { name: 'dark' });
    await tick();
    expect(m.inner.received_('theme_change')[0].data).toEqual({ name: 'dark' });
    expect(ev.defaultPrevented).toBe(false);
  });

  it('converts update_state into send_event for toolkit widgets', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer));
    outer.toWidget('update_state', {
      state: [
        {
          type: POLL_STATE,
          state_key: 'a',
          room_id: ROOM,
          event_id: '$s1',
          sender: USER,
          content: {},
        },
      ],
    });
    await tick();
    expect(m.inner.received_('update_state')).toHaveLength(0);
    expect(m.inner.received_('send_event').map((x) => x.data.event_id)).toEqual(
      ['$s1'],
    );
  });

  it('uses update_state for widgets that support it in auto mode', async () => {
    const outer = makeOuter();
    outer.handlers['org.matrix.msc2876.read_events'] = () => ({ events: [] });
    const m = await boot(
      mount(
        outer,
        { updateState: 'auto' },
        [...POLL_CAPABILITIES],
        ['0.0.2', 'org.matrix.msc2871', 'org.matrix.msc2762_update_state'],
      ),
    );
    expect(m.inner.clientVersions).toContain('org.matrix.msc2762_update_state');
    outer.toWidget('update_state', {
      state: [
        {
          type: POLL_STATE,
          state_key: 'a',
          room_id: ROOM,
          event_id: '$s1',
          sender: USER,
          content: {},
        },
      ],
    });
    await waitFor(() => m.inner.received_('update_state').length > 0);
  });

  it('buffers events while paused and delivers them on resume', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer));
    m.handle.setPaused(true);
    outer.toWidget('send_event', voteEvent('$p1'));
    await tick();
    expect(m.inner.received_('send_event')).toHaveLength(0);
    m.handle.setPaused(false);
    await tick();
    expect(m.inner.received_('send_event')).toHaveLength(1);
  });
});

describe('modals', () => {
  it('routes the modal result back to the widget that opened it', async () => {
    const outer = makeOuter();
    outer.handlers['open_modal'] = () => ({});
    const a = await boot(mount(outer, { modals: 'forward' }));
    const b = await boot(
      mount(outer, { widgetId: 'element-2', modals: 'forward' }),
    );
    const data = {
      type: 'm.custom',
      url: `${ORIGIN}/create-poll#/?x=1`,
      name: 'Create poll',
      buttons: [],
      data: {},
    };
    expect(await b.inner.request('open_modal', data)).toEqual({});
    expect(upwardCalls(outer, 'open_modal')).toEqual([['open_modal', data]]);

    const ev = outer.toWidget('close_modal', { poll: { title: 'Q' } });
    await tick();
    expect(ev.defaultPrevented).toBe(true);
    expect(outer.transport.reply).toHaveBeenCalledWith(ev.detail, {});
    expect(b.inner.received_('close_modal')[0].data).toEqual({
      poll: { title: 'Q' },
    });
    expect(a.inner.received_('close_modal')).toHaveLength(0);
  });

  it("leaves close_modal of the host's own modal alone", async () => {
    const outer = makeOuter();
    await boot(mount(outer));
    const ev = outer.toWidget('close_modal', {});
    expect(ev.defaultPrevented).toBe(false);
  });

  it('refuses modal URLs of another origin and a second modal', async () => {
    const outer = makeOuter();
    outer.handlers['open_modal'] = () => ({});
    const m = await boot(mount(outer, { modals: 'forward' }));
    const r = await m.inner.request('open_modal', {
      url: 'https://evil.example/',
      name: 'x',
    });
    expect(r.error).toBeDefined();
    await m.inner.request('open_modal', { url: `${ORIGIN}/m`, name: 'x' });
    const second = await m.inner.request('open_modal', {
      url: `${ORIGIN}/m`,
      name: 'x',
    });
    expect(second.error).toBeDefined();
    expect(upwardCalls(outer, 'open_modal')).toHaveLength(1);
  });

  it('denies modals by default', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer));
    const r = await m.inner.request('open_modal', { url: `${ORIGIN}/m` });
    expect(r.error).toBeDefined();
    expect(upwardCalls(outer, 'open_modal')).toHaveLength(0);
  });
});

describe('OpenID', () => {
  const token = {
    access_token: 'token',
    expires_in: 3600,
    matrix_server_name: 'example.org',
    token_type: 'Bearer',
  };

  function withOpenId(outer: FakeOuterApi, impl: () => Promise<unknown>) {
    const fn = vi.fn(impl);
    (outer as unknown as Record<string, unknown>).requestOpenIDConnectToken =
      fn;
    return fn;
  }

  it('blocks OpenID by default without asking the outer client', async () => {
    const outer = makeOuter();
    const request = withOpenId(outer, () => Promise.resolve(token));
    const m = await boot(mount(outer));
    expect(await m.inner.request('get_openid')).toEqual({ state: 'blocked' });
    expect(request).not.toHaveBeenCalled();
  });

  it("forwards with openId: 'forward' (pending first, then the token)", async () => {
    const outer = makeOuter();
    const request = withOpenId(outer, () => Promise.resolve(token));
    const m = await boot(mount(outer, { openId: 'forward' }));
    expect(await m.inner.request('get_openid')).toEqual({ state: 'request' });
    await waitFor(() => m.inner.received_('openid_credentials').length > 0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(m.inner.received_('openid_credentials')[0].data).toMatchObject({
      state: 'allowed',
      ...token,
    });
  });

  it('answers blocked when the outer client refuses', async () => {
    const outer = makeOuter();
    withOpenId(outer, () => Promise.reject(new Error('declined')));
    const m = await boot(mount(outer, { openId: 'forward' }));
    expect(await m.inner.request('get_openid')).toEqual({ state: 'request' });
    await waitFor(() => m.inner.received_('openid_credentials').length > 0);
    const data = m.inner.received_('openid_credentials')[0].data;
    expect(data.state).toBe('blocked');
    expect(data.access_token).toBeUndefined();
  });

  it('answers blocked when the host cannot request tokens', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer, { openId: 'forward' }));
    await m.inner.request('get_openid');
    await waitFor(() => m.inner.received_('openid_credentials').length > 0);
    expect(m.inner.received_('openid_credentials')[0].data.state).toBe(
      'blocked',
    );
  });
});

describe('security defaults', () => {
  it('never grants hard-denied capabilities, even if allow-listed', async () => {
    const outer = makeOuter();
    const pl = 'org.matrix.msc2762.send.state_event:m.room.power_levels';
    const redact = 'org.matrix.msc2762.send.event:m.room.redaction';
    const m = await boot(
      mount(outer, { allowedCapabilities: [pl, redact, SEND_VOTE] }, [
        pl,
        redact,
        SEND_VOTE,
      ]),
    );
    expect(m.inner.approved).toEqual([SEND_VOTE]);
    expect(outer.requested).not.toContain(pl);
    expect(outer.requested).not.toContain(redact);
  });

  it('lets the local consent hook refuse before anything goes upstream', async () => {
    const outer = makeOuter();
    const confirmCapabilities = vi.fn(async () => [RECEIVE_VOTE]);
    const m = await boot(
      mount(outer, { confirmCapabilities }, [SEND_VOTE, RECEIVE_VOTE]),
    );
    expect(confirmCapabilities).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: ORIGIN,
        capabilities: [SEND_VOTE, RECEIVE_VOTE],
      }),
    );
    expect(m.inner.approved).toEqual([RECEIVE_VOTE]);
    expect(outer.requested).not.toContain(SEND_VOTE);
    const state = m.handle.getState();
    expect(
      state.status === 'ready' && state.capabilities.deniedLocally,
    ).toEqual([SEND_VOTE]);
  });

  it('does not hand inherited grants over without local consent', async () => {
    const outer = makeOuter();
    const member = 'org.matrix.msc2762.receive.state_event:m.room.member';
    const m = await boot(
      mount(outer, { confirmCapabilities: async () => false }, [member]),
    );
    expect(m.inner.approved).toEqual([]);
    expect(m.handle.getState()).toMatchObject({ reason: 'denied' });
  });

  it('limits upstream capability rounds per widget', async () => {
    const outer = makeOuter();
    outer.decide = () => [];
    const extra = 'org.matrix.msc2762.receive.event:net.example.extra';
    const m = await boot(
      mount(
        outer,
        { maxCapabilityRequests: 1, allowedCapabilities: [SEND_VOTE, extra] },
        [SEND_VOTE],
      ),
    );
    expect(outer.updateRequestedCapabilities).toHaveBeenCalledTimes(1);
    m.handle.retryCapabilities();
    const inner2 = new FakeInnerWidget(m.handle.iframe!, m.handle.widgetId, {
      capabilities: [SEND_VOTE, extra],
    });
    inner2.load();
    await waitFor(() => m.handle.getState().status === 'error');
    expect(outer.updateRequestedCapabilities).toHaveBeenCalledTimes(1);
  });

  it('stops when the frame navigates (second load)', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer));
    m.inner.load();
    expect(m.handle.getState()).toMatchObject({
      status: 'error',
      reason: 'load-failed',
    });
    expect(m.container.querySelector('iframe')).toBeNull();
  });

  it('refuses an embedded widget on the host origin', () => {
    const host = window.location.origin;
    const m = mount(makeOuter(), {
      widgetUrl: `${host}/poll/`,
      allowedOrigins: [host],
      allowInsecureLocalhost: true,
    });
    expect(m.handle.getState()).toMatchObject({ reason: 'load-failed' });
    expect(m.handle.iframe).toBeUndefined();
  });

  it('clamps timeline read limits, not state reads', async () => {
    const outer = makeOuter();
    outer.handlers['org.matrix.msc2876.read_events'] = () => ({ events: [] });
    const m = await boot(mount(outer, { maxTimelineReadLimit: 100 }));
    await m.inner.request('org.matrix.msc2876.read_events', {
      type: VOTE,
      limit: Number.MAX_SAFE_INTEGER,
    });
    await m.inner.request('org.matrix.msc2876.read_events', {
      type: POLL_STATE,
      state_key: true,
      limit: Number.MAX_SAFE_INTEGER,
    });
    const limits = upwardCalls(outer, 'org.matrix.msc2876.read_events').map(
      (c) => (c[1] as { limit: number }).limit,
    );
    expect(limits).toEqual([100, Number.MAX_SAFE_INTEGER]);
  });

  it('validates what comes down from the outer client', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer));
    outer.toWidget('send_event', { type: VOTE, content: {} });
    outer.toWidget('theme_change', { name: 'dark', injected: { a: 1 } });
    outer.toWidget('theme_change', { other: 1 });
    outer.toWidget('update_state', { state: 'nope' });
    await tick();
    expect(m.inner.received_('send_event')).toHaveLength(0);
    expect(m.inner.received_('theme_change').map((x) => x.data)).toEqual([
      { name: 'dark' },
    ]);
  });

  it('cannot be reconfigured once mounted', async () => {
    const outer = makeOuter();
    await boot(mount(outer));
    expect(() => configureMediation(outer, {})).toThrow();
  });
});

describe('message guard', () => {
  function spyOnBubble() {
    const seen: unknown[] = [];
    const l = (e: MessageEvent) => seen.push(e.data);
    window.addEventListener('message', l);
    return { seen, stop: () => window.removeEventListener('message', l) };
  }

  it('drops messages with the inner widget id from a wrong origin or source', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer));
    const spy = spyOnBubble();
    void m.inner.request(
      'send_event',
      { type: VOTE, content: {} },
      {
        origin: 'https://evil.example',
      },
    );
    void m.inner.request(
      'send_event',
      { type: VOTE, content: {} },
      {
        source: null,
      },
    );
    await tick();
    spy.stop();
    expect(spy.seen).toHaveLength(0);
    expect(upwardCalls(outer, 'send_event')).toHaveLength(0);
  });

  it('drops messages an embedded widget sends under another widget id', async () => {
    const outer = makeOuter();
    const m = await boot(mount(outer));
    const spy = spyOnBubble();
    // A message under the host widget's id from an embedded widget.
    m.inner.post({
      api: 'toWidget',
      widgetId: 'host-widget-id',
      requestId: 'x',
      action: 'send_event',
      data: {},
    });
    await tick();
    spy.stop();
    expect(spy.seen).toHaveLength(0);
  });

  it('lets several embedded widgets talk at the same time', async () => {
    const outer = makeOuter();
    const a = await boot(mount(outer));
    const b = await boot(mount(outer, { widgetId: 'element-2' }));
    const [ra, rb] = await Promise.all([
      a.inner.request('send_event', { type: VOTE, content: {} }),
      b.inner.request('send_event', { type: VOTE, content: {} }),
    ]);
    expect(ra.event_id).toBeDefined();
    expect(rb.event_id).toBeDefined();
  });
});

describe('types', () => {
  it('accepts a matrix-widget-api WidgetApi as outer API', () => {
    const api: OuterWidgetApi = new WidgetApi('host', 'https://client.example');
    expect(api.transport.widgetId).toBe('host');
  });
});
