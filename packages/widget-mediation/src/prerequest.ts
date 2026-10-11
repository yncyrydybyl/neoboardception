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

import {
  applyCapabilityPolicy,
  DEFAULT_ALLOWED_CAPABILITIES,
} from './capabilities';
import { acquireHub } from './outerHub';
import type { CapabilityRequestResult, OuterWidgetApi } from './types';

export interface PrerequestCapabilitiesOptions {
  outerApi: OuterWidgetApi;
  /** Capabilities the embedded widgets of the document are known to need. */
  capabilities: readonly string[];
  allowedCapabilities?: readonly string[];
  allowCapabilityGlobs?: boolean;
  deniedCapabilities?: readonly string[];
}

/**
 * Asks the outer client for the capabilities of embedded widgets *before*
 * their iframes boot (e.g. when a document with embedded widgets loads), so
 * the user's decision overlaps with loading. Applies the same policy as
 * {@link mountEmbeddedWidget}; widgets mounted later reuse the result.
 * Only call it for widgets that are actually on the document: the host's
 * requested list only grows during a session.
 */
export function prerequestCapabilities(
  options: PrerequestCapabilitiesOptions,
): Promise<CapabilityRequestResult> {
  const { allowed } = applyCapabilityPolicy(options.capabilities, {
    allowed: options.allowedCapabilities ?? DEFAULT_ALLOWED_CAPABILITIES,
    denied: options.deniedCapabilities ?? [],
    globs: options.allowCapabilityGlobs,
  });
  return acquireHub(options.outerApi).broker.ensure(allowed);
}
