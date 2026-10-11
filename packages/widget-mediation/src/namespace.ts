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

/**
 * Event type namespaces for embedded widgets ("type rewrite").
 *
 * An embedded widget that uses the same event types as its host (for
 * example a whiteboard inside a whiteboard) would read and write the host's
 * data. With a namespace map the mediator rewrites the widget's event types
 * on the way up and back on the way down, so the widget works on its own
 * copy of the types and never sees or touches the host's events:
 *
 * ```
 * { "net.example.board": "net.neoboardception.nested.net.example.board" }
 * ```
 *
 * - A key covers the type itself and every type below it at a `.` boundary
 *   (`net.example.board` covers `net.example.board.sessions`, not
 *   `net.example.boardx`).
 * - Every target lies below {@link NESTED_NAMESPACE_ROOT}. Embedded widgets
 *   can never address that namespace directly (with or without a map), so
 *   a namespaced widget cannot nest a further namespace: the depth is
 *   limited to one.
 * - Capabilities are rewritten as strings (event, state event with
 *   `#state_key`/`#msgtype` suffix, to-device). Event content is not
 *   rewritten, except the `events` map of `m.room.power_levels` on the way
 *   down, so the widget sees the levels that apply to its own types.
 *
 * Pure: no DOM, no network.
 */

/** All rewrite targets live below this prefix (reserved for the mediator). */
export const NESTED_NAMESPACE_ROOT = 'net.neoboardception.nested.';

/** Namespace map: original type prefix → rewritten type prefix. */
export type EventNamespaceMap = Readonly<Record<string, string>>;

/** Limit of entries in one namespace map. */
export const MAX_NAMESPACE_ENTRIES = 20;

const TYPE_TOKEN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
const EVENT_CAPABILITY_HEAD =
  /^(org\.matrix\.msc2762\.(?:send|receive)\.(?:event|state_event):)(.*)$/s;
const TO_DEVICE_CAPABILITY_HEAD =
  /^(org\.matrix\.msc3819\.(?:send|receive)\.to_device:)(.*)$/s;

/** `type` is `prefix` or lies below it at a `.` boundary. */
function inNamespace(type: string, prefix: string): boolean {
  return type === prefix || type.startsWith(`${prefix}.`);
}

/** The type lies in the reserved namespace of rewritten types. */
export function isNestedNamespaceType(type: string): boolean {
  return type.startsWith(NESTED_NAMESPACE_ROOT);
}

/**
 * Validates a namespace map. Returns a list of errors (empty when valid).
 *
 * - keys and targets are dotted type names (`[A-Za-z0-9_-]` segments);
 * - keys are not in the spec namespace (`m.`) and not in the reserved one;
 * - targets lie below {@link NESTED_NAMESPACE_ROOT} exactly once (a target
 *   that nests the root again is refused, so namespaces cannot be stacked);
 * - keys do not overlap each other, targets do not overlap each other.
 */
export function validateEventNamespace(map: unknown): string[] {
  const errors: string[] = [];
  if (
    typeof map !== 'object' ||
    map === null ||
    Array.isArray(map) ||
    Object.getPrototypeOf(map) !== Object.prototype
  ) {
    return ['must be an object of "type prefix": "rewritten prefix"'];
  }
  const entries = Object.entries(map as Record<string, unknown>);
  if (entries.length > MAX_NAMESPACE_ENTRIES) {
    return ['too many entries'];
  }
  const keys: string[] = [];
  const targets: string[] = [];
  for (const [key, target] of entries) {
    if (!TYPE_TOKEN.test(key) || key.length > 255) {
      errors.push(`"${key}": not a dotted event type prefix`);
      continue;
    }
    if (key === 'm' || key.startsWith('m.')) {
      errors.push(`"${key}": spec event types (m.*) cannot be rewritten`);
      continue;
    }
    if (
      isNestedNamespaceType(`${key}.`) ||
      inNamespace(NESTED_NAMESPACE_ROOT.slice(0, -1), key)
    ) {
      errors.push(`"${key}": lies in the reserved namespace`);
      continue;
    }
    if (typeof target !== 'string' || !TYPE_TOKEN.test(target)) {
      errors.push(`"${key}": target is not a dotted event type prefix`);
      continue;
    }
    if (
      !isNestedNamespaceType(target) ||
      target.length <= NESTED_NAMESPACE_ROOT.length ||
      target.length > 255
    ) {
      errors.push(
        `"${key}": target must start with "${NESTED_NAMESPACE_ROOT}"`,
      );
      continue;
    }
    if (isNestedNamespaceType(target.slice(NESTED_NAMESPACE_ROOT.length))) {
      errors.push(`"${key}": nested rewrite targets are not allowed`);
      continue;
    }
    keys.push(key);
    targets.push(target);
  }
  const overlaps = (list: string[], what: string) => {
    for (const a of list) {
      for (const b of list) {
        if (a !== b && inNamespace(b, a)) {
          errors.push(`${what} "${a}" and "${b}" overlap`);
        }
      }
    }
  };
  overlaps(keys, 'keys');
  overlaps(targets, 'targets');
  if (new Set(targets).size !== targets.length) {
    errors.push('two keys have the same target');
  }
  return errors;
}

/** Result of rewriting a capability upward. */
export type CapabilityRewrite =
  | { ok: true; capability: string }
  /** The capability names the reserved namespace directly. */
  | { ok: false };

/**
 * Rewrites event types of one embedded widget. With an empty map it only
 * enforces the reserved namespace (every embedded widget gets one).
 */
export class EventTypeRewriter {
  private readonly entries: ReadonlyArray<readonly [string, string]>;

  constructor(map: EventNamespaceMap = {}) {
    const errors = validateEventNamespace(map);
    if (errors.length > 0) {
      throw new Error(`Invalid event namespace: ${errors.join('; ')}`);
    }
    this.entries = Object.freeze(
      Object.entries(map).map(([k, v]) => Object.freeze([k, v] as const)),
    );
  }

  /** Whether any type is rewritten. */
  get active(): boolean {
    return this.entries.length > 0;
  }

  /** The original prefixes (keys). */
  get originals(): string[] {
    return this.entries.map(([k]) => k);
  }

  /**
   * Type as the client sees it. `undefined` if the widget may not use the
   * type at all (it names the reserved namespace).
   */
  up(type: string): string | undefined {
    if (isNestedNamespaceType(type)) return undefined;
    for (const [key, target] of this.entries) {
      if (inNamespace(type, key)) return target + type.slice(key.length);
    }
    return type;
  }

  /**
   * Type as the widget sees it. `undefined` if the event must not reach the
   * widget: the host's own types (the map's keys) and other namespaces.
   */
  down(type: string): string | undefined {
    if (isNestedNamespaceType(type)) {
      for (const [key, target] of this.entries) {
        if (inNamespace(type, target)) return key + type.slice(target.length);
      }
      return undefined;
    }
    for (const [key] of this.entries) {
      if (inNamespace(type, key)) return undefined;
    }
    return type;
  }

  /**
   * Rewrites the event type inside a capability string (room event, state
   * event incl. `#key` suffix, to-device). Other capabilities pass
   * unchanged. Matching works on the raw string: keys contain neither `#`
   * nor `\`, so a key followed by `#` ends the type, and an escaped `\#`
   * further on stays part of the type, as matrix-widget-api parses it.
   */
  upCapability(capability: string): CapabilityRewrite {
    const event = EVENT_CAPABILITY_HEAD.exec(capability);
    const toDevice = event ? null : TO_DEVICE_CAPABILITY_HEAD.exec(capability);
    const m = event ?? toDevice;
    if (!m) return { ok: true, capability };
    const [, head, rest] = m;
    if (isNestedNamespaceType(rest)) return { ok: false };
    for (const [key, target] of this.entries) {
      const next = rest.charAt(key.length);
      if (
        rest.startsWith(key) &&
        (next === '' || next === '.' || (event !== null && next === '#'))
      ) {
        return { ok: true, capability: head + target + rest.slice(key.length) };
      }
    }
    return { ok: true, capability };
  }

  /** Inverse of {@link upCapability} for a rewritten capability. */
  downCapability(capability: string): string {
    const m =
      EVENT_CAPABILITY_HEAD.exec(capability) ??
      TO_DEVICE_CAPABILITY_HEAD.exec(capability);
    if (!m) return capability;
    const [, head, rest] = m;
    for (const [key, target] of this.entries) {
      const next = rest.charAt(target.length);
      if (
        rest.startsWith(target) &&
        (next === '' || next === '.' || next === '#')
      ) {
        return head + key + rest.slice(target.length);
      }
    }
    return capability;
  }

  /**
   * An event from the client, as the widget sees it, or `undefined` if it
   * must not reach the widget. Returns the same object when nothing changes.
   */
  downEvent<T extends { type: string; content?: unknown }>(
    event: T,
  ): T | undefined {
    const type = this.down(event.type);
    if (type === undefined) return undefined;
    let content = event.content;
    if (this.active && type === 'm.room.power_levels') {
      content = this.downPowerLevels(content);
    }
    if (type === event.type && content === event.content) return event;
    return { ...event, type, content };
  }

  /**
   * `events` of a power levels content as the widget sees it: rewritten
   * types under their original name, the host's own types left out (they
   * do not apply to the widget).
   */
  private downPowerLevels(content: unknown): unknown {
    const c = content as { events?: unknown } | undefined;
    if (!c || typeof c.events !== 'object' || c.events === null) {
      return content;
    }
    const events: Record<string, unknown> = {};
    for (const [type, level] of Object.entries(c.events)) {
      const local = this.down(type);
      if (local !== undefined) events[local] = level;
    }
    return { ...c, events };
  }
}
