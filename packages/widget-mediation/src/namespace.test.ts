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

import { WidgetEventCapability } from 'matrix-widget-api';
import { describe, expect, it } from 'vitest';
import { applyCapabilityPolicy, isHardDenied } from './capabilities';
import {
  EventTypeRewriter,
  NESTED_NAMESPACE_ROOT,
  validateEventNamespace,
} from './namespace';

const BOARD = 'net.example.board';
const NS = `${NESTED_NAMESPACE_ROOT}${BOARD}`;
const MAP = { [BOARD]: NS };

describe('validateEventNamespace', () => {
  it('accepts a map into the reserved namespace', () => {
    expect(validateEventNamespace(MAP)).toEqual([]);
    expect(validateEventNamespace({})).toEqual([]);
  });

  it.each([
    [null],
    [[]],
    ['x'],
    [{ [BOARD]: 'net.other.board' }],
    [{ [BOARD]: NESTED_NAMESPACE_ROOT.slice(0, -1) }],
    [{ [BOARD]: `${NESTED_NAMESPACE_ROOT}${NESTED_NAMESPACE_ROOT}x` }],
    [{ 'm.room.member': `${NESTED_NAMESPACE_ROOT}m.room.member` }],
    [{ [`${NESTED_NAMESPACE_ROOT}x`]: `${NESTED_NAMESPACE_ROOT}y` }],
    [{ 'net.neoboardception': `${NESTED_NAMESPACE_ROOT}y` }],
    [{ 'net.example.board*': NS }],
    [{ 'net.example.board#x': NS }],
    [{ [BOARD]: `${NS}#x` }],
    [{ [BOARD]: NS, [`${BOARD}.sessions`]: `${NESTED_NAMESPACE_ROOT}s` }],
    [{ [BOARD]: NS, 'net.other': `${NS}.other` }],
    [{ [BOARD]: NS, 'net.other': NS }],
    [{ [BOARD]: 42 }],
  ])('rejects %j', (map) => {
    expect(validateEventNamespace(map).length).toBeGreaterThan(0);
  });

  it('refuses to construct a rewriter from an invalid map', () => {
    expect(() => new EventTypeRewriter({ [BOARD]: 'net.other' })).toThrow();
    expect(() => new EventTypeRewriter(null as never)).toThrow();
  });

  it('limits the number of entries', () => {
    const big = Object.fromEntries(
      Array.from({ length: 21 }, (_, i) => [
        `net.t${i}`,
        `${NESTED_NAMESPACE_ROOT}t${i}`,
      ]),
    );
    expect(validateEventNamespace(big)).toEqual(['too many entries']);
  });
});

describe('EventTypeRewriter types', () => {
  const ns = new EventTypeRewriter(MAP);

  it('rewrites the key and types below it at a dot boundary', () => {
    expect(ns.up(BOARD)).toBe(NS);
    expect(ns.up(`${BOARD}.sessions`)).toBe(`${NS}.sessions`);
    expect(ns.up(`${BOARD}x`)).toBe(`${BOARD}x`);
    expect(ns.up('m.room.member')).toBe('m.room.member');
  });

  it('maps rewritten types back and hides the host types', () => {
    expect(ns.down(NS)).toBe(BOARD);
    expect(ns.down(`${NS}.document.chunk`)).toBe(`${BOARD}.document.chunk`);
    expect(ns.down(BOARD)).toBeUndefined();
    expect(ns.down(`${BOARD}.sessions`)).toBeUndefined();
    expect(ns.down(`${NESTED_NAMESPACE_ROOT}other`)).toBeUndefined();
    expect(ns.down('m.room.member')).toBe('m.room.member');
    expect(ns.down(`${BOARD}x`)).toBe(`${BOARD}x`);
  });

  it('refuses the reserved namespace in both directions without a map', () => {
    const plain = new EventTypeRewriter();
    expect(plain.active).toBe(false);
    expect(plain.up(NS)).toBeUndefined();
    expect(plain.down(NS)).toBeUndefined();
    expect(plain.up(BOARD)).toBe(BOARD);
    expect(plain.down(BOARD)).toBe(BOARD);
    // A namespaced widget cannot nest a namespace (depth 1).
    expect(ns.up(NS)).toBeUndefined();
    expect(ns.up(`${NESTED_NAMESPACE_ROOT}${NS}`)).toBeUndefined();
  });
});

describe('EventTypeRewriter capabilities', () => {
  const ns = new EventTypeRewriter(MAP);
  const up = (c: string) => {
    const r = ns.upCapability(c);
    return r.ok ? r.capability : null;
  };

  it.each([
    [
      `org.matrix.msc2762.send.event:${BOARD}.doc`,
      `org.matrix.msc2762.send.event:${NS}.doc`,
    ],
    [
      `org.matrix.msc2762.receive.event:${BOARD}`,
      `org.matrix.msc2762.receive.event:${NS}`,
    ],
    [
      `org.matrix.msc2762.send.state_event:${BOARD}`,
      `org.matrix.msc2762.send.state_event:${NS}`,
    ],
    [
      `org.matrix.msc2762.send.state_event:${BOARD}#embedded-1`,
      `org.matrix.msc2762.send.state_event:${NS}#embedded-1`,
    ],
    [
      `org.matrix.msc2762.send.state_event:${BOARD}.sessions#@alice:example.org`,
      `org.matrix.msc2762.send.state_event:${NS}.sessions#@alice:example.org`,
    ],
    // state key with dots and '#': only the type part is touched
    [
      `org.matrix.msc2762.receive.state_event:${BOARD}#a.b#c`,
      `org.matrix.msc2762.receive.state_event:${NS}#a.b#c`,
    ],
    // escaped '#' inside the type stays part of the type
    [
      `org.matrix.msc2762.receive.state_event:${BOARD}.x\\#y#key`,
      `org.matrix.msc2762.receive.state_event:${NS}.x\\#y#key`,
    ],
    [
      `org.matrix.msc3819.send.to_device:${BOARD}.signaling`,
      `org.matrix.msc3819.send.to_device:${NS}.signaling`,
    ],
    [
      `org.matrix.msc3819.receive.to_device:${BOARD}`,
      `org.matrix.msc3819.receive.to_device:${NS}`,
    ],
    // not in the namespace
    [
      `org.matrix.msc2762.send.event:${BOARD}x`,
      `org.matrix.msc2762.send.event:${BOARD}x`,
    ],
    [
      `org.matrix.msc3819.send.to_device:${BOARD}#x`,
      `org.matrix.msc3819.send.to_device:${BOARD}#x`,
    ],
    [
      'org.matrix.msc2762.receive.state_event:m.room.member',
      'org.matrix.msc2762.receive.state_event:m.room.member',
    ],
    ['io.element.requires_client', 'io.element.requires_client'],
    ['org.matrix.msc2762.timeline:*', 'org.matrix.msc2762.timeline:*'],
  ])('%s → %s and back', (original, upward) => {
    expect(up(original)).toBe(upward);
    expect(ns.downCapability(upward)).toBe(original);
  });

  it('keeps the parse of matrix-widget-api (type and state key)', () => {
    const original = `org.matrix.msc2762.send.state_event:${BOARD}.x\\#y#key`;
    const upward = up(original)!;
    const [a] = WidgetEventCapability.findEventCapabilities([original]);
    const [b] = WidgetEventCapability.findEventCapabilities([upward]);
    expect(a.eventType).toBe(`${BOARD}.x#y`);
    expect(b.eventType).toBe(`${NS}.x#y`);
    expect(b.keyStr).toBe(a.keyStr);
    expect(b.kind).toBe(a.kind);
  });

  it('refuses capabilities naming the reserved namespace directly', () => {
    for (const rw of [ns, new EventTypeRewriter()]) {
      for (const c of [
        `org.matrix.msc2762.send.event:${NS}`,
        `org.matrix.msc2762.receive.state_event:${NS}#x`,
        `org.matrix.msc3819.send.to_device:${NS}`,
        `org.matrix.msc2762.send.event:${NESTED_NAMESPACE_ROOT}anything`,
      ]) {
        expect(rw.upCapability(c)).toEqual({ ok: false });
      }
    }
  });
});

describe('EventTypeRewriter events', () => {
  const ns = new EventTypeRewriter(MAP);

  it('renames rewritten events and drops host events', () => {
    const ev = { type: `${NS}.doc`, content: { a: 1 }, event_id: '$1' };
    expect(ns.downEvent(ev)).toEqual({ ...ev, type: `${BOARD}.doc` });
    expect(ns.downEvent({ type: `${BOARD}.doc`, content: {} })).toBe(undefined);
    const other = { type: 'net.nordeck.poll', content: {} };
    expect(ns.downEvent(other)).toBe(other);
  });

  it('rewrites the events map of power levels for the widget', () => {
    const pl = {
      type: 'm.room.power_levels',
      state_key: '',
      content: {
        users: { '@a:x': 100 },
        state_default: 50,
        events: {
          'm.room.name': 50,
          [`${BOARD}.sessions`]: 0,
          [`${NS}.sessions`]: 10,
          [`${NESTED_NAMESPACE_ROOT}other`]: 0,
        },
      },
    };
    expect(ns.downEvent(pl)?.content).toEqual({
      users: { '@a:x': 100 },
      state_default: 50,
      events: { 'm.room.name': 50, [`${BOARD}.sessions`]: 10 },
    });
    // Without a map, power levels pass unchanged.
    expect(new EventTypeRewriter().downEvent(pl)).toBe(pl);
  });
});

describe('policy order with a namespace', () => {
  const ns = new EventTypeRewriter(MAP);
  const boardDeny = [
    `org.matrix.msc2762.send.state_event:${BOARD}*`,
    `org.matrix.msc2762.receive.state_event:${BOARD}*`,
    `org.matrix.msc2762.send.event:${BOARD}*`,
    `org.matrix.msc2762.receive.event:${BOARD}*`,
  ];

  it('checks the rewritten form: namespaced passes, the original never goes up', () => {
    const original = `org.matrix.msc2762.send.state_event:${BOARD}`;
    const r = ns.upCapability(original);
    expect(r.ok && r.capability).toBe(
      `org.matrix.msc2762.send.state_event:${NS}`,
    );
    const capability = (r as { capability: string }).capability;
    expect(
      applyCapabilityPolicy([capability], {
        allowed: [capability],
        denied: boardDeny,
      }).allowed,
    ).toEqual([capability]);
    // Without the rewrite the board's own namespace stays denied.
    expect(
      applyCapabilityPolicy([original], {
        allowed: [original],
        denied: boardDeny,
      }).blocked,
    ).toEqual([original]);
  });

  it('allows to-device only for rewritten types', () => {
    expect(isHardDenied(`org.matrix.msc3819.send.to_device:${NS}.sig`)).toBe(
      false,
    );
    expect(isHardDenied(`org.matrix.msc3819.receive.to_device:${NS}`)).toBe(
      false,
    );
    expect(isHardDenied(`org.matrix.msc3819.send.to_device:${BOARD}`)).toBe(
      true,
    );
    expect(
      isHardDenied('org.matrix.msc3819.send.to_device:m.call.invite'),
    ).toBe(true);
    // Rewriting never escapes the hard deny-list of event types.
    expect(
      isHardDenied('org.matrix.msc2762.send.state_event:m.room.power_levels'),
    ).toBe(true);
  });
});
