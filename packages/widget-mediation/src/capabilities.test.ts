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

import { describe, expect, it } from 'vitest';
import {
  applyCapabilityPolicy,
  capabilityCoveredBy,
  capabilityImpliedBy,
  isHardDenied,
  isValidGlob,
  POLL_CAPABILITIES,
} from './capabilities';

const PL_ANY = 'org.matrix.msc2762.receive.state_event:m.room.power_levels';
const PL_EMPTY = `${PL_ANY}#`;

describe('capabilityCoveredBy', () => {
  it('matches exact strings', () => {
    expect(capabilityCoveredBy(PL_ANY, PL_ANY)).toBe(true);
  });

  it('treats a key-less event capability as covering keyed ones', () => {
    expect(capabilityCoveredBy(PL_EMPTY, PL_ANY)).toBe(true);
    expect(
      capabilityCoveredBy(
        'org.matrix.msc2762.receive.state_event:m.room.member#@a:example.org',
        'org.matrix.msc2762.receive.state_event:m.room.member',
      ),
    ).toBe(true);
  });

  it('never treats a keyed capability as covering the broader one', () => {
    expect(capabilityCoveredBy(PL_ANY, PL_EMPTY)).toBe(false);
  });

  it('does not confuse event types sharing a prefix', () => {
    expect(
      capabilityCoveredBy(
        'org.matrix.msc2762.send.state_event:net.nordeck.poll.group',
        'org.matrix.msc2762.send.state_event:net.nordeck.poll',
      ),
    ).toBe(false);
  });

  it('matches exactly by default and treats * as glob only on opt-in', () => {
    const cap = 'org.matrix.msc2762.receive.event:net.example.x';
    expect(
      capabilityCoveredBy(
        cap,
        'org.matrix.msc2762.receive.event:net.example.*',
      ),
    ).toBe(false);
    expect(
      capabilityCoveredBy(
        cap,
        'org.matrix.msc2762.receive.event:net.example.*',
        {
          globs: true,
        },
      ),
    ).toBe(true);
  });

  it('only accepts globs anchored at a boundary and never for send', () => {
    expect(isValidGlob('org.matrix.msc2762.receive.event:net.example.*')).toBe(
      true,
    );
    expect(isValidGlob('org.matrix.msc2762.receive.state_event:x#*')).toBe(
      true,
    );
    expect(isValidGlob('org.matrix.msc2762.receive.event:net.poll*')).toBe(
      false,
    );
    expect(isValidGlob('org.matrix.msc2762.*:net.example.x')).toBe(false);
    expect(isValidGlob('org.matrix.msc2762.send.event:net.example.*')).toBe(
      false,
    );
    expect(
      capabilityCoveredBy(
        'org.matrix.msc2762.send.event:net.example.x',
        'org.matrix.msc2762.send.event:net.example.*',
        { globs: true },
      ),
    ).toBe(false);
  });

  it('treats * literally in granted capabilities', () => {
    expect(
      capabilityImpliedBy(
        'org.matrix.msc2762.timeline:!a:example.org',
        'org.matrix.msc2762.timeline:*',
      ),
    ).toBe(false);
  });
});

describe('applyCapabilityPolicy', () => {
  const policy = {
    allowed: POLL_CAPABILITIES,
    denied: [] as string[],
  };

  it('allows exactly what Poll requests', () => {
    const r = applyCapabilityPolicy(POLL_CAPABILITIES, policy);
    expect(r.allowed).toEqual([...POLL_CAPABILITIES]);
    expect(r.blocked).toEqual([]);
  });

  it('blocks everything outside the allow-list', () => {
    const r = applyCapabilityPolicy(
      [
        'org.matrix.msc2762.send.event:net.nordeck.whiteboard.document.snapshot',
        'org.matrix.msc2762.timeline:*',
        'org.matrix.msc2931.navigate',
        'org.matrix.msc2762.send.event:net.nordeck.poll.vote',
      ],
      policy,
    );
    expect(r.allowed).toEqual([
      'org.matrix.msc2762.send.event:net.nordeck.poll.vote',
    ]);
    expect(r.blocked).toHaveLength(3);
  });

  it('applies the deny-list after the allow-list', () => {
    const r = applyCapabilityPolicy(POLL_CAPABILITIES, {
      ...policy,
      denied: ['org.matrix.msc2762.receive.state_event:m.room.member'],
    });
    expect(r.blocked).toEqual([
      'org.matrix.msc2762.receive.state_event:m.room.member',
    ]);
  });

  it.each([
    'org.matrix.msc2762.send.state_event:im.vector.modular.widgets#embedded-1',
    'org.matrix.msc2762.receive.state_event:im.vector.modular.widgets',
    'org.matrix.msc2762.send.state_event:io.element.widgets.layout',
    'org.matrix.msc2762.send.event:m.room.redaction',
    'org.matrix.msc2762.send.state_event:m.room.power_levels',
    'org.matrix.msc2762.send.state_event:m.room.join_rules',
    'org.matrix.msc2762.send.state_event:m.room.member#@a:example.org',
    'org.matrix.msc2762.timeline:*',
    'org.matrix.msc2762.timeline:!other:example.org',
    'org.matrix.msc3819.send.to_device:m.custom',
    'org.matrix.msc2931.navigate',
    'org.matrix.msc4039.upload_file',
    'm.turn_server',
    'org.matrix.msc4157.send.delayed_event',
    'org.matrix.msc4407.send.sticky_event',
    'org.matrix.msc2762.send.event:org.matrix.msc4143.rtc.member',
    // Capabilities Element Call requests (MatrixRTC unstable names).
    'org.matrix.msc2762.send.state_event:org.matrix.msc3401.call.member#@a:example.org',
    'org.matrix.msc2762.receive.state_event:org.matrix.msc3401.call.member',
    'org.matrix.msc2762.receive.state_event:org.matrix.msc3401.call',
    'org.matrix.msc2762.send.event:io.element.call.encryption_keys',
    'org.matrix.msc2762.send.event:org.matrix.msc4075.rtc.notification',
    'org.matrix.msc2762.send.event:org.matrix.msc4310.rtc.decline',
    'org.matrix.msc2762.receive.event:m.rtc.member',
  ])('hard-denies %s, whatever the allow-list says', (cap) => {
    expect(isHardDenied(cap)).toBe(true);
    expect(
      applyCapabilityPolicy([cap], { allowed: [cap], denied: [] }).blocked,
    ).toEqual([cap]);
  });

  it('does not hard-deny reading room state Poll needs', () => {
    for (const cap of POLL_CAPABILITIES) expect(isHardDenied(cap)).toBe(false);
  });

  it('allows a narrower keyed request but not a broader one', () => {
    const narrow = applyCapabilityPolicy([PL_EMPTY], policy);
    expect(narrow.allowed).toEqual([PL_EMPTY]);
    const broad = applyCapabilityPolicy([PL_ANY], {
      ...policy,
      allowed: [PL_EMPTY],
    });
    expect(broad.blocked).toEqual([PL_ANY]);
  });
});
