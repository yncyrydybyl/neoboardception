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

// Keep this file free of imports from the state/component tree: it is used by
// the element schema, which is evaluated while the state module is loading.

/** Maximum length of a widget URL stored in the board document. */
export const embeddedWidgetUrlMaxLength = 2048;

/** Maximum length of the optional title stored in the board document. */
export const embeddedWidgetTitleMaxLength = 256;

export type EmbeddedWidgetUrlInvalidReason =
  | 'invalid'
  | 'not-https'
  | 'credentials'
  | 'too-long';

export type EmbeddedWidgetUrlValidationResult =
  | { valid: true; url: URL }
  | { valid: false; reason: EmbeddedWidgetUrlInvalidReason };

/**
 * Structural validation of a widget URL. This is the hard rule that applies
 * everywhere (document schema, insertion, rendering) and cannot be relaxed by
 * configuration:
 *
 * - absolute URL that the browser can parse
 * - `https:` only (no `http:`, `javascript:`, `data:`, `blob:`, ...)
 * - no embedded credentials (`https://user:pass@host`)
 * - at most {@link embeddedWidgetUrlMaxLength} characters
 *
 * Which origins are actually allowed to run is decided separately by an
 * {@link EmbeddedWidgetUrlPolicy}.
 */
export function validateEmbeddedWidgetUrl(
  value: string,
): EmbeddedWidgetUrlValidationResult {
  if (value.length > embeddedWidgetUrlMaxLength) {
    return { valid: false, reason: 'too-long' };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { valid: false, reason: 'invalid' };
  }

  if (url.protocol !== 'https:') {
    return { valid: false, reason: 'not-https' };
  }

  if (url.username !== '' || url.password !== '') {
    return { valid: false, reason: 'credentials' };
  }

  if (url.hostname === '') {
    return { valid: false, reason: 'invalid' };
  }

  return { valid: true, url };
}

/**
 * Deployment-specific allow-list hook. It is evaluated on *every* client
 * before a widget is mounted, because the URL in the board document can be
 * written by any user with edit rights and therefore is untrusted input.
 *
 * Only called for URLs that already passed {@link validateEmbeddedWidgetUrl}.
 */
export type EmbeddedWidgetUrlPolicy = (url: URL) => boolean;

/** Policy that allows nothing. Used when no policy is configured. */
export const denyAllEmbeddedWidgetUrls: EmbeddedWidgetUrlPolicy = () => false;

/**
 * Create a policy that allows URLs whose origin exactly matches one of the
 * given origins (scheme + host + port). Entries that are not valid https
 * origins are ignored.
 *
 * @example createOriginAllowListPolicy(['https://widgets.example.org'])
 */
export function createOriginAllowListPolicy(
  origins: readonly string[],
): EmbeddedWidgetUrlPolicy {
  const allowedOrigins = new Set<string>();

  for (const origin of origins) {
    const result = validateEmbeddedWidgetUrl(origin.trim());
    if (result.valid) {
      allowedOrigins.add(result.url.origin);
    }
  }

  return (url) => allowedOrigins.has(url.origin);
}

export type EmbeddedWidgetUrlCheck =
  | { allowed: true; url: URL }
  | { allowed: false; reason: EmbeddedWidgetUrlInvalidReason | 'policy' };

/**
 * Combine the structural validation with a deployment policy. A throwing
 * policy is treated as "not allowed".
 */
export function checkEmbeddedWidgetUrl(
  value: string,
  policy: EmbeddedWidgetUrlPolicy,
): EmbeddedWidgetUrlCheck {
  const result = validateEmbeddedWidgetUrl(value);
  if (!result.valid) {
    return { allowed: false, reason: result.reason };
  }

  let allowed = false;
  try {
    allowed = policy(result.url) === true;
  } catch {
    allowed = false;
  }

  return allowed
    ? { allowed: true, url: result.url }
    : { allowed: false, reason: 'policy' };
}
