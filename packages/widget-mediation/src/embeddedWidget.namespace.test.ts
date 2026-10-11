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

// Event type namespaces ("type rewrite") end to end through the mediator:
// fake client (outer API) ↔ mediator ↔ fake embedded widget.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountEmbeddedWidget } from './embeddedWidget';
import { NESTED_NAMESPACE_ROOT } from './namespace';
import { configureMediation } from './outerHub';
import { FakeInnerWidget } from './testing/fakeInnerWidget';
import { FakeOuterApi } from './testing/fakeOuterApi';
import type {
  EmbeddedWidgetHandle,
  EmbeddedWidgetState,
  MountEmbeddedWidgetOptions,
} from './types';

const ORIGIN = 'https://board.example';
const ROOM = '!room:example.org';
const USER = '@alice:example.org';
const BOARD = 'net.example.board';
const NS = `${NESTED_NAMESPACE_ROOT}${BOARD}`;
const MAP = { [BOARD]: NS };
const SELF = 'embedded-element-1';

const HOST_CAPS = [
  `org.matrix.msc2762.send.state_event:${BOARD}`,
  `org.matrix.msc2762.receive.state_event:${BOARD}`,
  `org.matrix.msc2762.send.event:${BOARD}.doc`,
  `org.matrix.msc2762.receive.event:${BOARD}.doc`,
  `org.matrix.msc3819.send.to_device:${BOARD}.sig`,
  `org.matrix.msc3819.receive.to_device:${BOARD}.sig`,
  'org.matrix.msc2762.receive.state_event:m.room.power_levels#',
  'io.element.requires_client',
];
const BOARD_DENY = [
  `org.matrix.msc2762.send.event:${BOARD}*`,
  `org.matrix.msc2762.receive.event:${BOARD}*`,
  `org.matrix.msc2762.send.state_event:${BOARD}*`,
  `org.matrix.msc2762.receive.state_event:${BOARD}*`,
];
// What the inner board requests (its own, original strings).
const INNER_CAPS = [
  `org.matrix.msc2762.send.state_event:${BOARD}`,
  `org.matrix.msc2762.receive.state_event:${BOARD}`,
  `org.matrix.msc2762.send.event:${BOARD}.doc`,
  `org.matrix.msc2762.receive.event:${BOARD}.doc`,
  `org.matrix.msc2762.send.state_event:${BOARD}.sessions#${USER}`,
  `org.matrix.msc2762.receive.state_event:${BOARD}.sessions`,
  `org.matrix.msc3819.send.to_device:${BOARD}.sig`,
  `org.matrix.msc3819.receive.to_device:${BOARD}.sig`,
  'org.matrix.msc2762.receive.state_event:m.room.power_levels#',
  'org.matrix.msc2762.send.state_event:m.room.power_levels#',
  'io.element.requires_client',
];
const up = (c: string) => c.replace(/:net\.example\.board(?=$|[.#])/, `:${NS}`);
// Policy in the rewritten form (what the client sees).
const ALLOWED = INNER_CAPS.filter((c) => !c.includes('power_levels#'))
  .map(up)
  .concat(['org.matrix.msc2762.receive.state_event:m.room.power_levels#']);

const handles: EmbeddedWidgetHandle[] = [];
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

function makeOuter() {
  const outer = new FakeOuterApi(HOST_CAPS);
  configureMediation(outer, { capabilityBatchMs: 0 });
  outer.handlers['send_to_device'] = () => ({});
  return outer;
}

async function mountBoard(
  outer: FakeOuterApi,
  overrides: Partial<MountEmbeddedWidgetOptions> = {},
  innerCaps = INNER_CAPS,
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
    params: { userId: USER, roomId: ROOM },
    echoFallbackMs: 0,
    allowedCapabilities: ALLOWED,
    deniedCapabilities: BOARD_DENY,
    eventNamespace: MAP,
    onStateChange: (s) => states.push(s),
    ...overrides,
  });
  handles.push(handle);
  const inner = handle.iframe
    ? new FakeInnerWidget(handle.iframe, handle.widgetId, {
        capabilities: innerCaps,
      })
    : undefined;
  if (inner) {
    inner.load();
    await waitFor(() => ['ready', 'error'].includes(handle.getState().status));
  }
  return { handle, inner: inner!, states };
}

function upward(outer: FakeOuterApi, action: string) {
  return outer.transport.send.mock.calls
    .filter((c) => c[0] === action)
    .map((c) => c[1]);
}

function ev(type: string, extra: Record<string, unknown> = {}) {
  return {
    type,
    event_id: `$${Math.random().toString(36).slice(2)}`,
    room_id: ROOM,
    sender: USER,
    origin_server_ts: 1,
    content: {},
    ...extra,
  };
}

describe('capabilities with a namespace', () => {
  it('requests the rewritten form upward and grants the original strings', async () => {
    const outer = makeOuter();
    const m = await mountBoard(outer);
    expect(m.handle.getState().status).toBe('ready');

    const asked = outer.renegotiations.flat();
    expect(asked).toEqual(
      expect.arrayContaining([
        `org.matrix.msc2762.send.state_event:${NS}`,
        `org.matrix.msc2762.send.state_event:${NS}.sessions#${USER}`,
        `org.matrix.msc3819.send.to_device:${NS}.sig`,
      ]),
    );
    // The board's own namespace is never requested on the inner's behalf
    // (the host holds it for itself, from its own initial request).
    const added = outer.requestCapabilities.mock.calls.flat(2);
    expect(added.some((c) => /:net\.example\.board(?=$|[.#])/.test(c))).toBe(
      false,
    );

    // The widget sees its own strings in notify_capabilities.
    expect(new Set(m.inner.approved)).toEqual(
      new Set(
        INNER_CAPS.filter(
          (c) =>
            !c.startsWith(
              'org.matrix.msc2762.send.state_event:m.room.power_levels',
            ),
        ),
      ),
    );
    const state = m.handle.getState();
    expect(
      state.status === 'ready' && state.capabilities.blockedByPolicy,
    ).toEqual(['org.matrix.msc2762.send.state_event:m.room.power_levels#']);
  });

  it('does not grant the original namespace from the host without a rewrite', async () => {
    const outer = makeOuter();
    const m = await mountBoard(outer, {
      eventNamespace: undefined,
      allowedCapabilities: INNER_CAPS,
    });
    // Only the non-board capabilities pass; to-device stays hard denied.
    expect(m.inner.approved).toEqual(
      expect.not.arrayContaining([
        `org.matrix.msc2762.send.state_event:${BOARD}`,
        `org.matrix.msc3819.send.to_device:${BOARD}.sig`,
      ]),
    );
  });

  it('refuses capabilities that name the reserved namespace directly', async () => {
    const outer = makeOuter();
    const direct = [
      `org.matrix.msc2762.send.state_event:${NS}`,
      `org.matrix.msc3819.send.to_device:${NS}.sig`,
      'io.element.requires_client',
    ];
    const m = await mountBoard(
      outer,
      { allowedCapabilities: [...ALLOWED, ...direct] },
      direct,
    );
    expect(m.inner.approved).toEqual(['io.element.requires_client']);
    const s = m.handle.getState();
    expect(s.status === 'ready' && s.capabilities.blockedByPolicy).toEqual(
      expect.arrayContaining(direct.slice(0, 2)),
    );
  });

  it('refuses an invalid namespace map (fail closed)', async () => {
    const outer = makeOuter();
    const m = await mountBoard(outer, {
      eventNamespace: { [BOARD]: 'net.other.board' },
    });
    expect(m.handle.iframe).toBeUndefined();
    expect(m.handle.getState()).toMatchObject({
      status: 'error',
      reason: 'load-failed',
    });
  });
});

describe('forwarding with a namespace', () => {
  it('rewrites sent events and state, keeping state keys and content', async () => {
    const outer = makeOuter();
    const sent: Array<{ type: string; stateKey?: string }> = [];
    const m = await mountBoard(outer, { onEventSent: (e) => sent.push(e) });
    const r = await m.inner.request('send_event', {
      type: BOARD,
      state_key: SELF,
      content: { documentId: '$doc' },
    });
    expect(r.error).toBeUndefined();
    await m.inner.request('send_event', {
      type: `${BOARD}.doc`,
      content: { type: BOARD, data: 'x' },
    });
    expect(upward(outer, 'send_event')).toEqual([
      { type: NS, state_key: SELF, content: { documentId: '$doc' } },
      // Content is not rewritten.
      { type: `${NS}.doc`, content: { type: BOARD, data: 'x' } },
    ]);
    expect(sent.map((e) => e.type)).toEqual([NS, `${NS}.doc`]);
  });

  it('never sends power levels, even with the namespace', async () => {
    const outer = makeOuter();
    const m = await mountBoard(outer);
    const r = await m.inner.request('send_event', {
      type: 'm.room.power_levels',
      state_key: '',
      content: { events: { [BOARD]: 0 } },
    });
    expect(r.error).toBeDefined();
    expect(upward(outer, 'send_event')).toHaveLength(0);
  });

  it('delivers rewritten events under the original type and drops host events', async () => {
    const outer = makeOuter();
    const m = await mountBoard(outer);
    outer.toWidget('send_event', ev(`${NS}.doc`, { event_id: '$inner' }));
    outer.toWidget('send_event', ev(`${BOARD}.doc`, { event_id: '$host' }));
    outer.toWidget(
      'send_event',
      ev(NS, { event_id: '$state', state_key: SELF }),
    );
    outer.toWidget(
      'send_event',
      ev(BOARD, { event_id: '$hoststate', state_key: 'host-widget' }),
    );
    await tick();
    const got = m.inner
      .received_('send_event')
      .map((x) => [x.data.event_id, x.data.type]);
    expect(got).toEqual([
      ['$inner', `${BOARD}.doc`],
      ['$state', BOARD],
    ]);
  });

  it('local echo uses the original type', async () => {
    const outer = makeOuter();
    const m = await mountBoard(outer, { echoFallbackMs: 20 });
    const r = await m.inner.request('send_event', {
      type: `${BOARD}.doc`,
      content: {},
    });
    await waitFor(() => m.inner.received_('send_event').length === 1);
    expect(m.inner.received_('send_event')[0].data).toMatchObject({
      type: `${BOARD}.doc`,
      event_id: r.event_id,
    });
  });

  it('rewrites read_events filters and results (state and timeline)', async () => {
    const outer = makeOuter();
    outer.handlers['org.matrix.msc2876.read_events'] = (d) =>
      d.type === NS
        ? {
            events: [
              ev(NS, { state_key: SELF }),
              ev(BOARD, { state_key: 'host-widget' }),
            ],
          }
        : d.type === 'm.room.power_levels'
          ? {
              events: [
                ev('m.room.power_levels', {
                  state_key: '',
                  content: {
                    state_default: 50,
                    events: { [`${BOARD}.sessions`]: 0, [`${NS}.sessions`]: 0 },
                  },
                }),
              ],
            }
          : { events: [ev(`${NS}.doc`), ev(`${BOARD}.doc`)] };
    const m = await mountBoard(outer);

    const state = await m.inner.request('org.matrix.msc2876.read_events', {
      type: BOARD,
      state_key: true,
    });
    expect(
      (state.events as Array<{ type: string; state_key: string }>).map((e) => [
        e.type,
        e.state_key,
      ]),
    ).toEqual([[BOARD, SELF]]);

    const timeline = await m.inner.request('org.matrix.msc2876.read_events', {
      type: `${BOARD}.doc`,
      limit: 10,
    });
    expect(
      (timeline.events as Array<{ type: string }>).map((e) => e.type),
    ).toEqual([`${BOARD}.doc`]);

    const pl = await m.inner.request('org.matrix.msc2876.read_events', {
      type: 'm.room.power_levels',
      state_key: '',
    });
    expect((pl.events as Array<{ content: unknown }>)[0].content).toEqual({
      state_default: 50,
      events: { [`${BOARD}.sessions`]: 0 },
    });

    expect(upward(outer, 'org.matrix.msc2876.read_events')).toEqual([
      { type: NS, state_key: true },
      { type: `${NS}.doc`, limit: 10 },
      { type: 'm.room.power_levels', state_key: '' },
    ]);
  });

  it('refuses reads of the reserved namespace', async () => {
    const outer = makeOuter();
    const m = await mountBoard(outer);
    const r = await m.inner.request('org.matrix.msc2876.read_events', {
      type: NS,
      state_key: true,
    });
    expect(r.error).toBeDefined();
    expect(upward(outer, 'org.matrix.msc2876.read_events')).toHaveLength(0);
  });

  it('rewrites read_relations filter and chunk', async () => {
    const outer = makeOuter();
    outer.handlers['org.matrix.msc3869.read_relations'] = () => ({
      chunk: [ev(`${NS}.doc`), ev(`${BOARD}.doc`)],
      next_batch: 'n1',
    });
    const m = await mountBoard(outer);
    const r = await m.inner.request('org.matrix.msc3869.read_relations', {
      event_id: '$create',
      rel_type: 'm.reference',
      event_type: `${BOARD}.doc`,
      limit: 50,
    });
    expect((r.chunk as Array<{ type: string }>).map((e) => e.type)).toEqual([
      `${BOARD}.doc`,
    ]);
    expect(upward(outer, 'org.matrix.msc3869.read_relations')[0]).toMatchObject(
      { event_id: '$create', event_type: `${NS}.doc` },
    );
  });
});

describe('to-device with a namespace', () => {
  it('forwards rewritten to-device messages up and back down', async () => {
    const outer = makeOuter();
    const m = await mountBoard(outer);
    const messages = { '@bob:example.org': { '*': { sessionId: 's1' } } };
    const r = await m.inner.request('send_to_device', {
      type: `${BOARD}.sig`,
      encrypted: false,
      messages,
    });
    expect(r.error).toBeUndefined();
    expect(upward(outer, 'send_to_device')).toEqual([
      { type: `${NS}.sig`, encrypted: false, messages },
    ]);

    outer.toWidget('send_to_device', {
      type: `${NS}.sig`,
      sender: '@bob:example.org',
      encrypted: false,
      content: { sessionId: 's2' },
    });
    // The host's own signalling never reaches the embedded board.
    outer.toWidget('send_to_device', {
      type: `${BOARD}.sig`,
      sender: '@bob:example.org',
      encrypted: false,
      content: { sessionId: 'host' },
    });
    await tick();
    expect(m.inner.received_('send_to_device').map((x) => x.data)).toEqual([
      {
        type: `${BOARD}.sig`,
        sender: '@bob:example.org',
        encrypted: false,
        content: { sessionId: 's2' },
      },
    ]);
  });

  it('blocks to-device for widgets without a namespace', async () => {
    const outer = makeOuter();
    const m = await mountBoard(outer, {
      eventNamespace: undefined,
      allowedCapabilities: [
        ...INNER_CAPS,
        `org.matrix.msc3819.send.to_device:${BOARD}.sig`,
      ],
      deniedCapabilities: [],
    });
    const r = await m.inner.request('send_to_device', {
      type: `${BOARD}.sig`,
      encrypted: false,
      messages: { '@bob:example.org': { '*': {} } },
    });
    expect(r.error).toBeDefined();
    outer.toWidget('send_to_device', {
      type: `${BOARD}.sig`,
      sender: '@bob:example.org',
      content: {},
    });
    await tick();
    expect(m.inner.received_('send_to_device')).toHaveLength(0);
    expect(upward(outer, 'send_to_device')).toHaveLength(0);
  });

  it('rejects a malformed message map', async () => {
    const outer = makeOuter();
    const m = await mountBoard(outer);
    const r = await m.inner.request('send_to_device', {
      type: `${BOARD}.sig`,
      encrypted: false,
      messages: { '@bob:example.org': 'x' },
    });
    expect(r.error).toBeDefined();
    expect(upward(outer, 'send_to_device')).toHaveLength(0);
  });
});
