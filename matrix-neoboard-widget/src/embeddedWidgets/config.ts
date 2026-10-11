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

import { getEnvironment } from '@matrix-widget-toolkit/mui';
import { isEmbeddedBoard } from '@nordeck/matrix-neoboard-react-sdk';
import {
  decideEmbeddedWidget,
  decodeEmbeddedWidgetPolicy,
  EmbeddedWidgetPolicy,
  EventNamespaceMap,
  isHardDenied,
  type MatrixRtcContext,
  policyInitialCapabilities,
  policyOrigins,
  POLL_CAPABILITIES,
} from '@nordeck/matrix-widget-mediation/policy';
import loglevel from 'loglevel';
import type { WidgetEventCapability } from 'matrix-widget-api';
import { boardOwnCapabilities } from './mediationRenderer';

/** Reads one configuration value. */
export type ReadEnvironment = (name: string) => string;

/**
 * Runtime configuration (`window.__ENVIRONMENT__`, e.g. from the container's
 * env script) wins over build-time values. Build-time values are read from
 * `import.meta.env` because the toolkit's `process.env` fallback is empty in
 * a Vite build.
 */
export const readEnvironment: ReadEnvironment = (name) =>
  getEnvironment(name, '') ||
  String((import.meta.env as Record<string, unknown>)[name] ?? '');

/** What the renderer applies to one embedded widget. */
export type EmbeddedWidgetMountPolicy = {
  /**
   * Capability allow-list for the mediator. `undefined`: the mediation
   * package's default (the Poll capabilities).
   */
  allowedCapabilities?: readonly string[];
  /** Skip the board's local consent step (operator pre-approval). */
  preapproved: boolean;
  /** Forward OpenID requests of this widget to the client. */
  identityApproved: boolean;
  /** Name from the operator's configuration. */
  name?: string;
  /**
   * MatrixRTC call widget (policy `matrixrtc: true`). Only with a policy;
   * off by default.
   */
  matrixRtc?: boolean;
  /** Permission-policy features for the iframe (policy `media_permissions`). */
  mediaPermissions?: readonly string[];
  /**
   * Event type namespace of the widget (policy `event_namespace`), e.g. for
   * a NeoBoard inside NeoBoard. `allowedCapabilities` are in the rewritten
   * form.
   */
  eventNamespace?: EventNamespaceMap;
};

export type EmbeddedWidgetConfigSource =
  /** Nothing configured: embedding is off. */
  | 'none'
  /** Only `REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS` (compatibility). */
  | 'origins'
  /** A valid `REACT_APP_EMBEDDED_WIDGET_POLICY`. */
  | 'policy'
  /** The policy is invalid: embedding is off (fail closed). */
  | 'invalid';

export type EmbeddedWidgetConfig = {
  source: EmbeddedWidgetConfigSource;
  /** Origins embedded widgets may come from. Empty: embedding is off. */
  allowedOrigins: readonly string[];
  /** Subset of `allowedOrigins` whose widgets may open client modals. */
  modalOrigins: readonly string[];
  /** URL check for the board element (placeholder, insertion, mount). */
  isUrlAllowed: (url: URL) => boolean;
  /** Per-widget mount policy; `undefined` means "do not mount". */
  resolveMountPolicy: (
    widgetUrl: string,
  ) => EmbeddedWidgetMountPolicy | undefined;
  /**
   * Capabilities to add to the board's initial capability request ("initial
   * union"). Empty unless `REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION=true`.
   */
  initialCapabilities: readonly string[];
  /**
   * The initial union for the board's user, device and room: like
   * `initialCapabilities`, plus the call capabilities of `matrixrtc` rules
   * (they depend on the user and device).
   */
  initialCapabilitiesFor: (context: MatrixRtcContext) => readonly string[];
  /**
   * Capability rounds an embedded widget may trigger at the client. `0` with
   * the initial union, otherwise the mediation default.
   */
  maxCapabilityRequests?: number;
  /**
   * Deployment-wide capability allow-list from
   * `REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES` (Poll defaults plus the
   * listed entries). `undefined` when not set. Without a policy it is the
   * allow-list of every widget; with a policy it is an upper bound.
   */
  capabilityAllowList?: readonly string[];
  /**
   * Embedded widgets running at the same time per client
   * (`REACT_APP_EMBEDDED_WIDGET_MAX_LIVE`, 1–20). `undefined`: the board's
   * default.
   */
  maxLiveWidgets?: number;
  errors: readonly string[];
  warnings: readonly string[];
};

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** Valid https origins of a comma-separated list, normalised. */
function parseOrigins(value: string, warnings: string[], name: string) {
  const origins: string[] = [];
  for (const entry of parseList(value)) {
    let url: URL | undefined;
    try {
      url = new URL(entry);
    } catch {
      url = undefined;
    }
    if (!url || url.protocol !== 'https:' || url.username || url.password) {
      warnings.push(`${name}: "${entry}" is not an https origin; ignored`);
    } else if (!origins.includes(url.origin)) {
      origins.push(url.origin);
    }
  }
  return origins;
}

function originOf(widgetUrl: string): string | undefined {
  try {
    return new URL(widgetUrl).origin;
  } catch {
    return undefined;
  }
}

/** Maximum of `REACT_APP_EMBEDDED_WIDGET_MAX_LIVE`. */
export const MAX_LIVE_WIDGETS_LIMIT = 20;

function parseMaxLive(value: string, warnings: string[]): number | undefined {
  const v = value.trim();
  if (v === '') return undefined;
  const n = Number(v);
  if (Number.isInteger(n) && n >= 1 && n <= MAX_LIVE_WIDGETS_LIMIT) return n;
  warnings.push(
    `REACT_APP_EMBEDDED_WIDGET_MAX_LIVE: expected a whole number from 1 to ${MAX_LIVE_WIDGETS_LIMIT}, got "${value}"; using the default`,
  );
  return undefined;
}

/**
 * Exact capability strings of `REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES`.
 * Globs and entries on the hard deny-list are dropped with a warning.
 */
function parseCapabilities(value: string, warnings: string[]): string[] {
  const name = 'REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES';
  const capabilities: string[] = [];
  for (const entry of parseList(value)) {
    if (entry.includes('*')) {
      warnings.push(
        `${name}: "${entry}": globs are not allowed, use exact strings; ignored`,
      );
    } else if (isHardDenied(entry)) {
      warnings.push(
        `${name}: "${entry}" is never granted to embedded widgets (hard deny-list); ignored`,
      );
    } else if (!capabilities.includes(entry)) {
      capabilities.push(entry);
    }
  }
  return capabilities;
}

function parseFlag(value: string, name: string, warnings: string[]): boolean {
  const v = value.trim().toLowerCase();
  if (v === '' || v === 'false') return false;
  if (v === 'true') return true;
  warnings.push(`${name}: expected "true" or "false", got "${value}"`);
  return false;
}

/**
 * Builds the embedded widget configuration from deployment settings. Pure
 * (apart from `read`), so it can run synchronously before the board's
 * capability request.
 *
 * - `REACT_APP_EMBEDDED_WIDGET_POLICY`: operator policy, same schema as
 *   Element's widget lifecycle module. JSON or `base64:<JSON>`. When set,
 *   it decides which widget URLs run and with which capabilities; an
 *   invalid policy turns embedding off.
 * - `REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS`: without a policy, the
 *   origin allow-list (compatibility). With a policy, an upper bound: only
 *   policy origins that are also listed here are allowed.
 * - `REACT_APP_EMBEDDED_WIDGET_MODAL_ORIGINS`: subset of the allowed origins
 *   whose widgets may open client modals.
 * - `REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION=true`: add the capabilities of
 *   all policy rules to the board's initial capability request.
 * - `REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES`: capabilities in
 *   addition to the Poll defaults. Without a policy, every allowed widget
 *   gets the defaults plus these. With a policy, an upper bound (like the
 *   origin list): a rule keeps only capabilities that are Poll defaults or
 *   listed here; it never adds capabilities to a rule or to unlisted
 *   widgets. The hard deny-list and the board's own events always win.
 * - `REACT_APP_EMBEDDED_WIDGET_MAX_LIVE`: widgets running at the same time
 *   per client (1–20), independent of the rest.
 */
export function loadEmbeddedWidgetConfig(
  read: ReadEnvironment,
): EmbeddedWidgetConfig {
  const errors: string[] = [];
  const warnings: string[] = [];
  const envOrigins = parseOrigins(
    read('REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS'),
    warnings,
    'REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS',
  );
  const initialUnion = parseFlag(
    read('REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION'),
    'REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION',
    warnings,
  );
  const policyText = read('REACT_APP_EMBEDDED_WIDGET_POLICY').trim();
  const maxLiveWidgets = parseMaxLive(
    read('REACT_APP_EMBEDDED_WIDGET_MAX_LIVE'),
    warnings,
  );
  const envCapabilities = parseCapabilities(
    read('REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES'),
    warnings,
  );
  const capabilityAllowList =
    envCapabilities.length > 0
      ? [...new Set([...POLL_CAPABILITIES, ...envCapabilities])]
      : undefined;
  /** Applies the deployment-wide upper bound (with a policy). */
  const capCapabilities = (capabilities: readonly string[]) =>
    capabilityAllowList
      ? capabilities.filter((c) => capabilityAllowList.includes(c))
      : [...capabilities];

  let source: EmbeddedWidgetConfigSource;
  let policy: EmbeddedWidgetPolicy | undefined;
  let allowedOrigins: string[];

  if (policyText === '') {
    source = envOrigins.length > 0 ? 'origins' : 'none';
    allowedOrigins = envOrigins;
    if (initialUnion) {
      warnings.push(
        'REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION needs REACT_APP_EMBEDDED_WIDGET_POLICY; ignored',
      );
    }
  } else {
    const result = decodeEmbeddedWidgetPolicy(policyText);
    warnings.push(
      ...result.warnings.map((w) => `REACT_APP_EMBEDDED_WIDGET_POLICY: ${w}`),
    );
    if (!result.ok) {
      source = 'invalid';
      allowedOrigins = [];
      errors.push(
        ...result.errors.map((e) => `REACT_APP_EMBEDDED_WIDGET_POLICY: ${e}`),
        'Embedded widgets are disabled because the policy is invalid',
      );
    } else {
      source = 'policy';
      policy = result.policy;
      const candidates = policyOrigins(policy);
      if (policy.unlisted === 'consent') {
        envOrigins
          .filter((o) => !candidates.includes(o))
          .forEach((o) => candidates.push(o));
      }
      if (envOrigins.length > 0) {
        candidates
          .filter((o) => !envOrigins.includes(o))
          .forEach((o) =>
            warnings.push(
              `${o} is in the policy but not in REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS; not allowed`,
            ),
          );
        allowedOrigins = candidates.filter((o) => envOrigins.includes(o));
      } else {
        allowedOrigins = candidates;
      }
      if (capabilityAllowList) {
        policyInitialCapabilities(policy, {
          deniedCapabilities: boardOwnCapabilities,
        })
          .filter((c) => !capabilityAllowList.includes(c))
          .forEach((c) =>
            warnings.push(
              `"${c}" is in the policy but neither a Poll default nor in REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES; not granted`,
            ),
          );
      }
    }
  }

  const modalOrigins = parseOrigins(
    read('REACT_APP_EMBEDDED_WIDGET_MODAL_ORIGINS'),
    warnings,
    'REACT_APP_EMBEDDED_WIDGET_MODAL_ORIGINS',
  ).filter((origin) => allowedOrigins.includes(origin));

  const resolveMountPolicy = (
    widgetUrl: string,
  ): EmbeddedWidgetMountPolicy | undefined => {
    const origin = originOf(widgetUrl);
    if (!origin || !allowedOrigins.includes(origin)) return undefined;
    if (!policy) {
      // Compatibility: origin allow-list, default capabilities (plus the
      // deployment's extra capabilities), consent.
      return capabilityAllowList
        ? {
            allowedCapabilities: capabilityAllowList,
            preapproved: false,
            identityApproved: false,
          }
        : { preapproved: false, identityApproved: false };
    }
    const decision = decideEmbeddedWidget(policy, widgetUrl, {
      deniedCapabilities: boardOwnCapabilities,
    });
    if (!decision.allowed) return undefined;
    return {
      // An unlisted widget (consent mode) keeps the mediation default; the
      // deployment list never widens it.
      allowedCapabilities:
        decision.allowedCapabilities &&
        capCapabilities(decision.allowedCapabilities),
      preapproved: decision.consent === 'preapproved',
      identityApproved: decision.identityApproved,
      name: decision.name,
      ...(decision.matrixRtc && { matrixRtc: true }),
      ...(decision.mediaPermissions.length > 0 && {
        mediaPermissions: decision.mediaPermissions,
      }),
      ...(decision.eventNamespace
        ? { eventNamespace: decision.eventNamespace }
        : {}),
    };
  };

  let initialCapabilities: string[] = [];
  let initialCapabilitiesFor: EmbeddedWidgetConfig['initialCapabilitiesFor'] =
    () => initialCapabilities;
  if (initialUnion && policy) {
    const current = {
      ...policy,
      rules: policy.rules.filter((r) => allowedOrigins.includes(r.origin)),
    };
    const base = policyInitialCapabilities(current, {
      deniedCapabilities: boardOwnCapabilities,
    });
    initialCapabilities = capCapabilities(base);
    initialCapabilitiesFor = (context) => {
      // Call capabilities are governed by the policy's opt-in alone; the
      // deployment-wide list bounds `capabilities_approved` only.
      const rtc = policyInitialCapabilities(current, {
        deniedCapabilities: boardOwnCapabilities,
        matrixRtc: context,
      }).filter((c) => !base.includes(c));
      return [...initialCapabilities, ...rtc];
    };
  }

  return {
    source,
    allowedOrigins,
    modalOrigins,
    isUrlAllowed: (url) => resolveMountPolicy(url.href) !== undefined,
    resolveMountPolicy,
    initialCapabilities,
    initialCapabilitiesFor,
    maxCapabilityRequests: initialUnion && policy ? 0 : undefined,
    capabilityAllowList,
    maxLiveWidgets,
    errors,
    warnings,
  };
}

let cached: EmbeddedWidgetConfig | undefined;

/**
 * The deployment's embedded widget configuration, read once. Logs
 * configuration errors and warnings on first use.
 */
export function getEmbeddedWidgetConfig(): EmbeddedWidgetConfig {
  if (!cached) {
    // Nesting depth 1: a board embedded in another board never embeds
    // widgets itself, whatever the deployment configures.
    cached = isEmbeddedBoard()
      ? loadEmbeddedWidgetConfig(() => '')
      : loadEmbeddedWidgetConfig(readEnvironment);
    cached.errors.forEach((e) => loglevel.error(`[embedded widgets] ${e}`));
    cached.warnings.forEach((w) => loglevel.warn(`[embedded widgets] ${w}`));
  }
  return cached;
}

type InitialCapability = WidgetEventCapability | string;

/**
 * The board's own capabilities plus the initial union (without duplicates).
 * Capabilities the board requests itself keep their position.
 */
export function withInitialCapabilities<T extends InitialCapability>(
  own: readonly T[],
  extra: readonly string[],
): Array<T | string> {
  const raw = new Set(own.map((c) => (typeof c === 'string' ? c : c.raw)));
  return [...own, ...extra.filter((c) => !raw.has(c))];
}
