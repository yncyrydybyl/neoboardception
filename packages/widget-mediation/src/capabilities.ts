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

import { isNestedNamespaceType } from './namespace';

/**
 * Capabilities of the Nordeck Matrix Poll widget (exact strings as the widget
 * requests them). Used as the default allow-list.
 */
export const POLL_CAPABILITIES: readonly string[] = Object.freeze([
  'org.matrix.msc2762.send.event:net.nordeck.poll.vote',
  'org.matrix.msc2762.receive.event:net.nordeck.poll.vote',
  'org.matrix.msc2762.send.event:net.nordeck.poll.start',
  'org.matrix.msc2762.receive.event:net.nordeck.poll.start',
  'org.matrix.msc2762.send.state_event:net.nordeck.poll',
  'org.matrix.msc2762.receive.state_event:net.nordeck.poll',
  'org.matrix.msc2762.send.state_event:net.nordeck.poll.settings',
  'org.matrix.msc2762.receive.state_event:net.nordeck.poll.settings',
  'org.matrix.msc2762.send.state_event:net.nordeck.poll.group',
  'org.matrix.msc2762.receive.state_event:net.nordeck.poll.group',
  'org.matrix.msc2762.receive.state_event:m.room.power_levels',
  'org.matrix.msc2762.receive.state_event:m.room.create',
  'org.matrix.msc2762.receive.state_event:m.room.name',
  'org.matrix.msc2762.receive.state_event:m.room.member',
  'io.element.requires_client',
]);

/** Default allow-list: the Poll capabilities. */
export const DEFAULT_ALLOWED_CAPABILITIES = POLL_CAPABILITIES;

/** Event type of widget registrations in room state. */
export const WIDGET_REGISTRATION_EVENT_TYPE = 'im.vector.modular.widgets';

const EVENT_CAPABILITY =
  /^org\.matrix\.msc2762\.(send|receive)\.(event|state_event):([^#]*)(?:#(.*))?$/;

export interface ParsedEventCapability {
  direction: 'send' | 'receive';
  kind: 'event' | 'state_event';
  eventType: string;
  /** State key (state events) or msgtype (room events); undefined = any. */
  key: string | undefined;
}

export function parseEventCapability(
  capability: string,
): ParsedEventCapability | undefined {
  const m = EVENT_CAPABILITY.exec(capability);
  if (!m) return undefined;
  return {
    direction: m[1] as 'send' | 'receive',
    kind: m[2] as 'event' | 'state_event',
    eventType: m[3],
    key: m[4],
  };
}

/**
 * Non-event capabilities an embedded widget never gets: other rooms,
 * to-device, navigation, media, TURN, delayed/sticky events, MatrixRTC.
 */
const HARD_DENIED_PREFIXES = [
  'org.matrix.msc2762.timeline:',
  'org.matrix.msc3819.',
  'org.matrix.msc2931.navigate',
  'org.matrix.msc4039.',
  'm.turn_server',
  'town.robin.msc3846.',
  'org.matrix.msc4157.',
  'org.matrix.msc4407.',
  'org.matrix.msc4515.',
  'org.matrix.msc4533.',
];

/** Event types an embedded widget may neither send nor receive. */
const HARD_DENIED_EVENT_TYPES = [
  WIDGET_REGISTRATION_EVENT_TYPE,
  'io.element.widgets.layout',
];
// MatrixRTC / calls in their stable and unstable names (MSC3401 call
// membership, MSC4075 notifications, MSC4310 decline, Element Call keys).
const HARD_DENIED_EVENT_TYPE_PREFIXES = [
  'org.matrix.msc4143.',
  'org.matrix.msc3401.call',
  'org.matrix.msc4075.',
  'org.matrix.msc4310.',
  'io.element.call.',
  'm.call.',
  'm.rtc.',
];

/** Event types an embedded widget may never send (room integrity/admin). */
const HARD_DENIED_SEND_TYPES = [
  'm.room.redaction',
  'm.room.create',
  'm.room.member',
  'm.room.power_levels',
  'm.room.join_rules',
  'm.room.history_visibility',
  'm.room.guest_access',
  'm.room.server_acl',
  'm.room.tombstone',
  'm.room.encryption',
  'm.room.canonical_alias',
  'm.room.aliases',
  'm.room.name',
  'm.room.topic',
  'm.room.avatar',
  'm.room.pinned_events',
  'm.room.third_party_invite',
  'm.space.child',
  'm.space.parent',
];

/**
 * Capabilities no configuration can grant to an embedded widget: widget
 * registrations and layout (both directions), room-admin state and
 * redactions (send), other rooms (`timeline:`), to-device, navigation,
 * media, TURN, delayed/sticky events and MatrixRTC.
 */
export function isHardDenied(capability: string): boolean {
  if (isNamespacedToDevice(capability)) return false;
  if (HARD_DENIED_PREFIXES.some((p) => capability.startsWith(p))) return true;
  const parsed = parseEventCapability(capability);
  if (!parsed) return false;
  const t = parsed.eventType;
  if (
    HARD_DENIED_EVENT_TYPES.includes(t) ||
    HARD_DENIED_EVENT_TYPE_PREFIXES.some((p) => t.startsWith(p))
  ) {
    return true;
  }
  return parsed.direction === 'send' && HARD_DENIED_SEND_TYPES.includes(t);
}

const TO_DEVICE_CAPABILITY =
  /^org\.matrix\.msc3819\.(send|receive)\.to_device:(.+)$/s;

/**
 * To-device capabilities for a rewritten type (see `namespace.ts`). The
 * only to-device capabilities an embedded widget can get: the mediator
 * produces them by rewriting, a widget can never request the reserved
 * namespace directly.
 */
export function isNamespacedToDevice(capability: string): boolean {
  const m = TO_DEVICE_CAPABILITY.exec(capability);
  return !!m && isNestedNamespaceType(m[2]);
}

const EVENT_CAPABILITY_PREFIX = 'org.matrix.msc2762.';

/**
 * Whether `pattern` is an acceptable glob: a single trailing `*` directly
 * after a `.` or `#` boundary, and never for `send` capabilities.
 */
export function isValidGlob(pattern: string): boolean {
  return (
    pattern.indexOf('*') === pattern.length - 1 &&
    ['.', '#'].includes(pattern.charAt(pattern.length - 2)) &&
    !pattern.startsWith('org.matrix.msc2762.send.')
  );
}

/**
 * Whether `capability` is allowed by an allow-list entry `pattern`.
 *
 * - exact match (default);
 * - an event capability without suffix covers the same capability narrowed
 *   to a state key or msgtype (`…state_event:m.room.member` covers
 *   `…state_event:m.room.member#@alice:example.org`); never the other way
 *   round, the key-less form is broader;
 * - with `globs`, a valid glob (see {@link isValidGlob}) matches by prefix.
 */
export function capabilityCoveredBy(
  capability: string,
  pattern: string,
  { globs = false }: { globs?: boolean } = {},
): boolean {
  if (
    globs &&
    pattern.endsWith('*') &&
    isValidGlob(pattern) &&
    capability.startsWith(pattern.slice(0, -1))
  ) {
    return true;
  }
  return capabilityImpliedBy(capability, pattern);
}

/**
 * Exact or key-narrowing match without glob semantics, for capability
 * strings granted by a client (`*` is literal there, `#*` is the key `*`).
 */
export function capabilityImpliedBy(
  capability: string,
  granted: string,
): boolean {
  if (capability === granted) return true;
  return (
    granted.startsWith(EVENT_CAPABILITY_PREFIX) &&
    !granted.includes('#') &&
    capability.startsWith(`${granted}#`)
  );
}

/** Deny-list matching: prefix globs anywhere are fine (denying more is safe). */
function deniedBy(capability: string, pattern: string): boolean {
  if (pattern.endsWith('*')) {
    return capability.startsWith(pattern.slice(0, -1));
  }
  return capabilityImpliedBy(capability, pattern);
}

export interface CapabilityPolicy {
  /** Allow-list (exact strings; globs only with `globs`). */
  allowed: readonly string[];
  /** Additional denials, e.g. the host's own namespace (`prefix*` allowed). */
  denied: readonly string[];
  globs?: boolean;
  /**
   * Exact capability strings exempt from the hard deny-list (MatrixRTC
   * opt-in of the operator, see `matrixRtc.ts`). They still have to be on
   * the allow-list and must not be denied by configuration.
   */
  lifted?: readonly string[];
}

export interface PolicyDecision {
  allowed: string[];
  blocked: string[];
}

/**
 * Applies the local policy. A capability passes if it is covered by the
 * allow-list, not denied by configuration and not hard-denied. Only passing
 * capabilities are ever requested from the outer client, in the exact form
 * the embedded widget requested, so the request upstream is never broader
 * than the allow-list.
 */
export function applyCapabilityPolicy(
  requested: Iterable<string>,
  policy: CapabilityPolicy,
): PolicyDecision {
  const allowed: string[] = [];
  const blocked: string[] = [];
  for (const cap of new Set(requested)) {
    const ok =
      policy.allowed.some((p) =>
        capabilityCoveredBy(cap, p, { globs: policy.globs }),
      ) &&
      !policy.denied.some((p) => deniedBy(cap, p)) &&
      (!isHardDenied(cap) || (policy.lifted?.includes(cap) ?? false));
    (ok ? allowed : blocked).push(cap);
  }
  return { allowed, blocked };
}
