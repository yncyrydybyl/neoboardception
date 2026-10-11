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

import { runTemplate } from 'matrix-widget-api';
import type { EmbeddedWidgetParams } from './types';

/**
 * Widget parameters every matrix-widget-toolkit widget needs (query or
 * fragment). Missing ones are appended to the fragment as template variables
 * so the toolkit never shows its "repair registration" dialog.
 */
export const TOOLKIT_PARAMETERS = [
  'theme',
  'matrix_user_id',
  'matrix_display_name',
  'matrix_avatar_url',
  'matrix_room_id',
  'matrix_client_id',
  'matrix_client_language',
  'matrix_device_id',
  'matrix_base_url',
] as const;

const DEFAULT_PARAMETER_TEMPLATES: ReadonlyArray<[string, string]> = [
  ['theme', '$org.matrix.msc2873.client_theme'],
  ['matrix_user_id', '$matrix_user_id'],
  ['matrix_display_name', '$matrix_display_name'],
  ['matrix_avatar_url', '$matrix_avatar_url'],
  ['matrix_room_id', '$matrix_room_id'],
  ['matrix_client_id', '$org.matrix.msc2873.client_id'],
  ['matrix_client_language', '$org.matrix.msc2873.client_language'],
  ['matrix_device_id', '$org.matrix.msc3819.matrix_device_id'],
  ['matrix_base_url', '$org.matrix.msc4039.matrix_base_url'],
];

/** Query parameters set by the host; a template must not define them. */
const HOST_PARAMETERS = ['widgetId', 'parentUrl'];

/**
 * Why a widget URL was refused. `same-origin`: the widget would share the
 * host's origin. Everything else is `invalid`.
 */
export type WidgetUrlErrorCode = 'invalid' | 'same-origin';

export class WidgetUrlError extends Error {
  constructor(
    message: string,
    readonly code: WidgetUrlErrorCode = 'invalid',
  ) {
    super(message);
    this.name = 'WidgetUrlError';
  }
}

export interface ValidateUrlOptions {
  hostOrigin: string;
  allowInsecureLocalhost?: boolean;
}

/**
 * Parses and checks an embedded widget URL: `https:` only (optionally
 * `http://localhost` for development), no credentials, and never the host's
 * own origin (an iframe with `allow-scripts allow-same-origin` on the host's
 * origin could remove its own sandbox and script the host).
 */
export function validateWidgetUrl(
  widgetUrl: string,
  { hostOrigin, allowInsecureLocalhost = false }: ValidateUrlOptions,
): URL {
  let url: URL;
  try {
    url = new URL(widgetUrl);
  } catch {
    throw new WidgetUrlError('Invalid widget URL');
  }
  const isLocalhost =
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowInsecureLocalhost && isLocalhost)) {
    throw new WidgetUrlError('Embedded widgets must be served over https');
  }
  if (url.username || url.password) {
    throw new WidgetUrlError('Widget URLs must not contain credentials');
  }
  if (url.origin === hostOrigin) {
    throw new WidgetUrlError(
      'Embedded widgets must not share the origin of the host widget',
      'same-origin',
    );
  }
  return url;
}

/**
 * Derives the embedded widget's own widget id from the caller's stable id.
 * It never equals or contains the host widget id and never starts with
 * `modal_` (the toolkit would switch to modal mode).
 */
export function deriveEmbeddedWidgetId(
  id: string,
  hostWidgetId?: string | null,
): string {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 128);
  if (!safe) throw new WidgetUrlError('Embedded widget id must not be empty');
  const derived = `embedded-${safe}`;
  if (hostWidgetId && derived.includes(hostWidgetId)) {
    throw new WidgetUrlError(
      'Embedded widget id must not contain the host widget id',
    );
  }
  return derived;
}

/**
 * Widget id of a modal opened by an embedded widget and shown by the host
 * (`inline` modals): `modal_` + the embedded widget's id, like the outer
 * client does for its own modals. matrix-widget-toolkit widgets switch to
 * modal mode (and wait for `widget_config`) only for this prefix.
 */
export function deriveModalWidgetId(embeddedWidgetId: string): string {
  return `modal_${embeddedWidgetId}`;
}

function presentKeys(url: URL): Set<string> {
  const keys = new Set<string>(url.searchParams.keys());
  const q = url.hash.indexOf('?');
  if (q >= 0) {
    new URLSearchParams(url.hash.slice(q + 1)).forEach((_v, k) => keys.add(k));
  }
  return keys;
}

/**
 * Removes `widgetId`/`parentUrl` from a fragment query: the toolkit lets
 * fragment parameters override the query, so a template could otherwise
 * replace the values set by the host.
 */
function stripHostParameters(hash: string): string {
  const q = hash.indexOf('?');
  if (q < 0) return hash;
  const kept = hash
    .slice(q + 1)
    .split('&')
    .filter((pair) => {
      const key = decodeURIComponent(pair.split('=')[0] ?? '');
      return pair !== '' && !HOST_PARAMETERS.includes(key);
    });
  return kept.length > 0
    ? `${hash.slice(0, q)}?${kept.join('&')}`
    : hash.slice(0, q);
}

export interface BuildWidgetUrlOptions {
  widgetUrl: URL;
  widgetId: string;
  params: EmbeddedWidgetParams;
  /** Origin the embedded widget talks to (the host's origin). */
  parentOrigin: string;
  data?: Record<string, unknown>;
  /**
   * Toolkit parameters to supply (data minimisation). Default: all. Values
   * of parameters not listed are left empty, also in custom templates.
   */
  parameters?: readonly string[];
}

/**
 * Builds the final iframe URL:
 * 1. append missing toolkit parameters (as template variables) to the fragment,
 * 2. fill all template variables from the host's parameters,
 * 3. set `widgetId` (the derived id) and `parentUrl` (the host origin only, so
 *    the host's own widget id and URL are not disclosed) in the query.
 */
export function buildWidgetUrl({
  widgetUrl,
  widgetId,
  params,
  parentOrigin,
  data,
  parameters = TOOLKIT_PARAMETERS,
}: BuildWidgetUrlOptions): string {
  const supply = (key: string, value: string | undefined) =>
    parameters.includes(key) ? value : undefined;
  // Work on the serialised string: mutating `searchParams` would
  // percent-encode the `$` of template variables before they are filled.
  const present = presentKeys(widgetUrl);
  const missing = DEFAULT_PARAMETER_TEMPLATES.filter(
    ([k]) => !present.has(k) && parameters.includes(k),
  );
  let hash = stripHostParameters(widgetUrl.hash.replace(/^#/, ''));
  if (missing.length > 0) {
    const extra = missing.map(([k, v]) => `${k}=${v}`).join('&');
    hash = !hash
      ? `/?${extra}`
      : hash.includes('?')
        ? `${hash}${hash.endsWith('?') || hash.endsWith('&') ? '' : '&'}${extra}`
        : `${hash}?${extra}`;
  }
  let template = `${widgetUrl.origin}${widgetUrl.pathname}${widgetUrl.search}${
    hash ? `#${hash}` : ''
  }`;
  // Variables of parameters that are not supplied become empty.
  for (const [key, variable] of DEFAULT_PARAMETER_TEMPLATES) {
    if (!parameters.includes(key)) template = template.split(variable).join('');
  }

  const filled = runTemplate(
    template,
    {
      id: widgetId,
      creatorUserId: params.userId,
      type: 'm.custom',
      url: '',
      data,
    },
    {
      widgetRoomId: supply('matrix_room_id', params.roomId),
      currentUserId: supply('matrix_user_id', params.userId) ?? '',
      userDisplayName: supply('matrix_display_name', params.displayName),
      userHttpAvatarUrl: supply('matrix_avatar_url', params.avatarUrl),
      clientId: supply('matrix_client_id', params.clientId),
      clientTheme: supply('theme', params.theme),
      clientLanguage: supply('matrix_client_language', params.clientLanguage),
      deviceId: supply('matrix_device_id', params.deviceId),
      baseUrl: supply('matrix_base_url', params.baseUrl),
    },
  );

  const result = new URL(filled);
  // `set` replaces any value a template tried to supply for these.
  result.searchParams.set('widgetId', widgetId);
  result.searchParams.set('parentUrl', `${parentOrigin}/`);
  return result.toString();
}

/** Origin + path, without query and fragment (safe to show and log). */
export function displayUrl(url: URL): string {
  return `${url.origin}${url.pathname}`;
}
