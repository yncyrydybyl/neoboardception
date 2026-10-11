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
 * Operator policy for embedded widgets ("layer 2": host widget ↔ embedded
 * widgets). Same schema as the widget lifecycle module of Element Web
 * (`widget_permissions[<url pattern>]` → `capabilities_approved`,
 * `preload_approved`, `identity_approved`), so operators learn one format.
 *
 * Pure: no DOM, no network, no side effects. The host decides where the
 * policy comes from (deployment configuration, never room or document
 * content) and what to do with the decision.
 *
 * Differences to the module, on purpose:
 *
 * - URLs are matched on origin + path, **without query and fragment**, after
 *   URL normalisation (lower-case host, default port, dot segments). The
 *   widget URL in a board is user input; query and fragment only carry
 *   parameters, which the mediator fills in itself.
 * - Patterns must be written in that normalised form; anything else is a
 *   configuration error. `*` is allowed only as the last character.
 * - Most specific rule wins: an exact rule beats every glob, a longer glob
 *   prefix beats a shorter one. The winning rule is used **as a whole**;
 *   fields are not merged across rules.
 * - Unlisted widget URLs are denied (`unlisted: "deny"`, default).
 * - Capability strings are exact; `*` in a capability is an error. Entries on
 *   the mediator's hard deny-list are dropped with a warning.
 * - Any error makes the whole policy invalid (fail closed).
 *
 * Extensions for MatrixRTC calls (both off by default):
 *
 * - `matrixrtc: true` lets this widget hold the call capabilities of the
 *   host's own user and device (see `matrixRtc.ts`), which are otherwise on
 *   the hard deny-list.
 * - `media_permissions: ["camera", "microphone", …]` delegates these
 *   permission-policy features to the widget's iframe.
 */

import { applyCapabilityPolicy, isHardDenied } from './capabilities';
import {
  isMediaPermission,
  matrixRtcCapabilities,
  MEDIA_PERMISSIONS,
  type MatrixRtcContext,
  type MediaPermission,
} from './matrixRtc';
import {
  EventNamespaceMap,
  EventTypeRewriter,
  isNestedNamespaceType,
  validateEventNamespace,
} from './namespace';

/** The event type of an event/to-device capability is in the reserved namespace. */
function isNestedNamespaceCapability(cap: string): boolean {
  const m = /^org\.matrix\.msc(?:2762|3819)\.[a-z_.]+:(.*)$/s.exec(cap);
  return !!m && isNestedNamespaceType(m[1]);
}

// Re-exported so that a host can build its configuration synchronously from
// this entry point without loading the mediator.
export { isHardDenied, POLL_CAPABILITIES } from './capabilities';
export { matrixRtcCapabilities, MEDIA_PERMISSIONS } from './matrixRtc';
export type { MatrixRtcContext, MediaPermission } from './matrixRtc';
export {
  EventTypeRewriter,
  NESTED_NAMESPACE_ROOT,
  validateEventNamespace,
} from './namespace';
export type { EventNamespaceMap } from './namespace';

/** What happens to widget URLs that no rule matches. */
export type UnlistedMode =
  /** Not mounted (default). */
  | 'deny'
  /**
   * Mounted if the host allows the origin; capabilities are bounded by the
   * host's default allow-list and always need local consent.
   */
  | 'consent';

export interface EmbeddedWidgetPolicyRule {
  /** The key as written in `widget_permissions`. */
  readonly pattern: string;
  /** `pattern` without the trailing `*`. */
  readonly prefix: string;
  /** `true` if `pattern` ends with `*` (prefix match). */
  readonly glob: boolean;
  /** Origin of the pattern. */
  readonly origin: string;
  /** Display name chosen by the operator. */
  readonly name?: string;
  /** Skip the host's local consent step for this widget. */
  readonly preloadApproved: boolean;
  /** Allow OpenID (identity) requests of this widget. */
  readonly identityApproved: boolean;
  /** Capability allow-list (exact strings, hard-denied entries removed). */
  readonly capabilitiesApproved: readonly string[];
  /** MatrixRTC call widget (operator opt-in, `matrixrtc`). */
  readonly matrixRtc: boolean;
  /** Permission-policy features for the iframe (`media_permissions`). */
  readonly mediaPermissions: readonly MediaPermission[];
  /**
   * Event type namespace of the widget (`event_namespace`), see
   * `namespace.ts`. `capabilitiesApproved` is written in the rewritten form.
   */
  readonly eventNamespace?: EventNamespaceMap;
}

export interface EmbeddedWidgetPolicy {
  readonly version: 1;
  readonly unlisted: UnlistedMode;
  readonly rules: readonly EmbeddedWidgetPolicyRule[];
}

export type EmbeddedWidgetPolicyParseResult =
  | { ok: true; policy: EmbeddedWidgetPolicy; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

/** Limits that keep a broken or hostile file from hurting the host. */
export const POLICY_LIMITS = Object.freeze({
  rules: 100,
  capabilitiesPerRule: 200,
  stringLength: 512,
});

const TOP_LEVEL_KEYS = new Set([
  '$comment',
  'version',
  'unlisted',
  'widget_permissions',
]);
const RULE_KEYS = new Set([
  '$comment',
  'name',
  'preload_approved',
  'identity_approved',
  'capabilities_approved',
  'matrixrtc',
  'media_permissions',
  'event_namespace',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Normalised match key of a widget URL: origin + path, without query and
 * fragment. `undefined` for URLs that are not absolute `https:` URLs or that
 * carry credentials.
 */
export function policyMatchKey(url: string | URL): string | undefined {
  let parsed: URL;
  try {
    parsed = typeof url === 'string' ? new URL(url) : new URL(url.href);
  } catch {
    return undefined;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname === '' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    return undefined;
  }
  return parsed.origin + parsed.pathname;
}

function parsePattern(
  pattern: string,
): { prefix: string; glob: boolean; origin: string } | string {
  if (pattern.length > POLICY_LIMITS.stringLength) {
    return 'pattern is too long';
  }
  const glob = pattern.endsWith('*');
  const prefix = glob ? pattern.slice(0, -1) : pattern;
  if (prefix.includes('*')) {
    return '"*" is only allowed as the last character';
  }
  if (/[?#]/.test(prefix)) {
    return 'query and fragment are not matched; remove "?…" / "#…"';
  }
  let parsed: URL;
  try {
    parsed = new URL(prefix);
  } catch {
    return 'not an absolute URL';
  }
  if (parsed.protocol !== 'https:') return 'https only';
  if (parsed.username !== '' || parsed.password !== '') {
    return 'credentials are not allowed';
  }
  const normalised = parsed.origin + parsed.pathname;
  if (normalised !== prefix) {
    // Covers a missing "/" after the host (which would let
    // `https://host*` match `https://host.attacker.example/`), upper-case
    // hosts, default ports, dot segments and unencoded characters.
    return `not in normalised form, write "${normalised}${glob ? '*' : ''}"`;
  }
  return { prefix, glob, origin: parsed.origin };
}

function parseRule(
  pattern: string,
  value: unknown,
  errors: string[],
  warnings: string[],
): EmbeddedWidgetPolicyRule | undefined {
  const where = `widget_permissions["${pattern}"]`;
  const parsedPattern = parsePattern(pattern);
  if (typeof parsedPattern === 'string') {
    errors.push(`${where}: ${parsedPattern}`);
    return undefined;
  }
  if (!isPlainObject(value)) {
    errors.push(`${where}: must be an object`);
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!RULE_KEYS.has(key)) warnings.push(`${where}: unknown field "${key}"`);
  }

  const bool = (key: string): boolean => {
    const v = value[key];
    if (v === undefined) return false;
    if (typeof v !== 'boolean') {
      errors.push(`${where}.${key}: must be true or false`);
      return false;
    }
    return v;
  };
  const preloadApproved = bool('preload_approved');
  const identityApproved = bool('identity_approved');
  const matrixRtc = bool('matrixrtc');

  const mediaPermissions: MediaPermission[] = [];
  const rawMedia = value.media_permissions;
  if (rawMedia !== undefined) {
    if (!Array.isArray(rawMedia)) {
      errors.push(`${where}.media_permissions: must be an array`);
    } else {
      for (const feature of rawMedia) {
        if (!isMediaPermission(feature)) {
          errors.push(
            `${where}.media_permissions: ${JSON.stringify(feature)} is not one of ${MEDIA_PERMISSIONS.join(', ')}`,
          );
        } else if (!mediaPermissions.includes(feature)) {
          mediaPermissions.push(feature);
        }
      }
    }
  }
  if (
    matrixRtc &&
    !mediaPermissions.includes('camera') &&
    !mediaPermissions.includes('microphone')
  ) {
    warnings.push(
      `${where}: matrixrtc without "camera" or "microphone" in media_permissions; the call cannot capture media`,
    );
  }

  let name: string | undefined;
  if (value.name !== undefined) {
    if (
      typeof value.name !== 'string' ||
      value.name.trim() === '' ||
      value.name.length > POLICY_LIMITS.stringLength
    ) {
      errors.push(`${where}.name: must be a non-empty string`);
    } else {
      name = value.name.trim();
    }
  }

  const capabilities: string[] = [];
  const rawCaps = value.capabilities_approved;
  if (rawCaps !== undefined) {
    if (!Array.isArray(rawCaps)) {
      errors.push(`${where}.capabilities_approved: must be an array`);
    } else if (rawCaps.length > POLICY_LIMITS.capabilitiesPerRule) {
      errors.push(`${where}.capabilities_approved: too many entries`);
    } else {
      for (const cap of rawCaps) {
        if (
          typeof cap !== 'string' ||
          cap === '' ||
          cap.length > POLICY_LIMITS.stringLength ||
          cap.trim() !== cap
        ) {
          errors.push(
            `${where}.capabilities_approved: ${JSON.stringify(cap)} is not a capability string`,
          );
        } else if (cap.includes('*')) {
          errors.push(
            `${where}.capabilities_approved: "${cap}": globs are not allowed, use exact strings`,
          );
        } else if (isHardDenied(cap)) {
          warnings.push(
            `${where}.capabilities_approved: "${cap}" is never granted to embedded widgets (hard deny-list); ignored`,
          );
        } else if (!capabilities.includes(cap)) {
          capabilities.push(cap);
        }
      }
    }
  }

  let eventNamespace: EventNamespaceMap | undefined;
  const nsCheck = (ns: EventTypeRewriter) => {
    for (const cap of capabilities) {
      if (isNestedNamespaceCapability(cap) && ns.downCapability(cap) === cap) {
        warnings.push(
          `${where}.capabilities_approved: "${cap}" is in the reserved namespace but not produced by this rule's event_namespace; never requested`,
        );
      }
    }
  };
  if (value.event_namespace === undefined) {
    nsCheck(new EventTypeRewriter());
  } else {
    const nsErrors = validateEventNamespace(value.event_namespace);
    if (nsErrors.length > 0) {
      nsErrors.forEach((e) => errors.push(`${where}.event_namespace: ${e}`));
    } else {
      eventNamespace = Object.freeze({
        ...(value.event_namespace as Record<string, string>),
      });
      const ns = new EventTypeRewriter(eventNamespace);
      nsCheck(ns);
      for (const cap of capabilities) {
        const r = ns.upCapability(cap);
        if (r.ok && r.capability !== cap) {
          errors.push(
            `${where}.capabilities_approved: "${cap}" lies in a rewritten namespace; write the rewritten form "${r.capability}"`,
          );
        }
      }
    }
  }

  return {
    pattern,
    prefix: parsedPattern.prefix,
    glob: parsedPattern.glob,
    origin: parsedPattern.origin,
    name,
    preloadApproved,
    identityApproved,
    capabilitiesApproved: Object.freeze(capabilities),
    matrixRtc,
    mediaPermissions: Object.freeze(mediaPermissions),
    ...(eventNamespace ? { eventNamespace } : {}),
  };
}

/**
 * Validates a policy object (already parsed JSON). Fails closed: any error
 * yields `ok: false`, and the host must then treat embedding as disabled.
 * Unknown fields are tolerated with a warning (the module's schema is loose,
 * so the same file stays valid for both).
 */
export function parseEmbeddedWidgetPolicy(
  input: unknown,
): EmbeddedWidgetPolicyParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['policy must be a JSON object'], warnings };
  }
  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(key)) warnings.push(`unknown field "${key}"`);
  }
  if (input.version !== undefined && input.version !== 1) {
    errors.push('version: only 1 is supported');
  }
  let unlisted: UnlistedMode = 'deny';
  if (input.unlisted !== undefined) {
    if (input.unlisted === 'deny' || input.unlisted === 'consent') {
      unlisted = input.unlisted;
    } else {
      errors.push('unlisted: must be "deny" or "consent"');
    }
  }
  const permissions = input.widget_permissions;
  const rules: EmbeddedWidgetPolicyRule[] = [];
  if (!isPlainObject(permissions)) {
    errors.push('widget_permissions: must be an object');
  } else {
    const entries = Object.entries(permissions);
    if (entries.length > POLICY_LIMITS.rules) {
      errors.push('widget_permissions: too many rules');
    } else {
      for (const [pattern, value] of entries) {
        const rule = parseRule(pattern, value, errors, warnings);
        if (rule) rules.push(rule);
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors, warnings };
  return {
    ok: true,
    policy: Object.freeze({
      version: 1,
      unlisted,
      rules: Object.freeze(rules),
    }),
    warnings,
  };
}

/**
 * Decodes and validates a policy given as text: JSON, or `base64:` followed
 * by base64-encoded UTF-8 JSON (for environments that cannot carry quotes).
 */
export function decodeEmbeddedWidgetPolicy(
  text: string,
): EmbeddedWidgetPolicyParseResult {
  let json = text.trim();
  if (json.startsWith('base64:')) {
    try {
      const binary = atob(json.slice('base64:'.length).trim());
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return { ok: false, errors: ['invalid base64'], warnings: [] };
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      errors: [`invalid JSON: ${(e as Error).message}`],
      warnings: [],
    };
  }
  return parseEmbeddedWidgetPolicy(parsed);
}

/**
 * The rule for a widget URL: an exact rule if there is one, otherwise the
 * glob rule with the longest prefix. `undefined` if none matches.
 */
export function findPolicyRule(
  policy: EmbeddedWidgetPolicy,
  url: string | URL,
): EmbeddedWidgetPolicyRule | undefined {
  const key = policyMatchKey(url);
  if (key === undefined) return undefined;
  let best: EmbeddedWidgetPolicyRule | undefined;
  for (const rule of policy.rules) {
    if (!rule.glob) {
      if (rule.prefix === key) return rule;
    } else if (
      key.startsWith(rule.prefix) &&
      (!best || rule.prefix.length > best.prefix.length)
    ) {
      best = rule;
    }
  }
  return best;
}

/** Origins named by the policy's rules (sorted, unique). */
export function policyOrigins(policy: EmbeddedWidgetPolicy): string[] {
  return [...new Set(policy.rules.map((r) => r.origin))].sort();
}

export type EmbeddedWidgetPolicyDecision =
  | { allowed: false; reason: 'invalid-url' | 'unlisted' }
  | {
      allowed: true;
      /** The matching rule; `undefined` for an unlisted URL in consent mode. */
      rule?: EmbeddedWidgetPolicyRule;
      /** `preapproved`: no local consent step. */
      consent: 'preapproved' | 'ask';
      name?: string;
      /**
       * Capability allow-list for the mediator; `undefined` = the host's
       * default allow-list (unlisted URL in consent mode).
       */
      allowedCapabilities?: readonly string[];
      identityApproved: boolean;
      /** MatrixRTC call widget (operator opt-in). */
      matrixRtc: boolean;
      /** Permission-policy features for the iframe. */
      mediaPermissions: readonly MediaPermission[];
      /** Event type namespace for the mediator (`eventNamespace`). */
      eventNamespace?: EventNamespaceMap;
    };

export interface DecideOptions {
  /**
   * Extra denials (exact or `prefix*`), e.g. the host's own event types.
   * Removed from `allowedCapabilities`.
   */
  deniedCapabilities?: readonly string[];
}

function filterCapabilities(
  capabilities: readonly string[],
  denied: readonly string[],
): string[] {
  return applyCapabilityPolicy(capabilities, {
    allowed: capabilities,
    denied,
  }).allowed;
}

/** What the policy says about one embedded widget URL. */
export function decideEmbeddedWidget(
  policy: EmbeddedWidgetPolicy,
  url: string | URL,
  { deniedCapabilities = [] }: DecideOptions = {},
): EmbeddedWidgetPolicyDecision {
  if (policyMatchKey(url) === undefined) {
    return { allowed: false, reason: 'invalid-url' };
  }
  const rule = findPolicyRule(policy, url);
  if (!rule) {
    return policy.unlisted === 'consent'
      ? {
          allowed: true,
          consent: 'ask',
          identityApproved: false,
          matrixRtc: false,
          mediaPermissions: [],
        }
      : { allowed: false, reason: 'unlisted' };
  }
  return {
    allowed: true,
    rule,
    consent: rule.preloadApproved ? 'preapproved' : 'ask',
    name: rule.name,
    allowedCapabilities: filterCapabilities(
      rule.capabilitiesApproved,
      deniedCapabilities,
    ),
    identityApproved: rule.identityApproved,
    matrixRtc: rule.matrixRtc,
    mediaPermissions: rule.mediaPermissions,
    ...(rule.eventNamespace ? { eventNamespace: rule.eventNamespace } : {}),
  };
}

export interface InitialCapabilitiesOptions extends DecideOptions {
  /**
   * The host's user, device and room. Only with it do rules with
   * `matrixrtc` contribute their call capabilities (they are specific to the
   * user and device).
   */
  matrixRtc?: MatrixRtcContext;
}

/**
 * Union of the capabilities of all rules (after hard and extra denials), in
 * rule order. For a host that adds them to its initial capability request.
 */
export function policyInitialCapabilities(
  policy: EmbeddedWidgetPolicy,
  { deniedCapabilities = [], matrixRtc }: InitialCapabilitiesOptions = {},
): string[] {
  const all = new Set<string>();
  for (const rule of policy.rules) {
    for (const cap of filterCapabilities(
      rule.capabilitiesApproved,
      deniedCapabilities,
    )) {
      all.add(cap);
    }
    if (rule.matrixRtc && matrixRtc) {
      const rtc = matrixRtcCapabilities(matrixRtc);
      applyCapabilityPolicy(rtc, {
        allowed: rtc,
        denied: deniedCapabilities,
        lifted: rtc,
      }).allowed.forEach((cap) => all.add(cap));
    }
  }
  return [...all];
}
