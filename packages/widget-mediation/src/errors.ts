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

import type { EmbeddedWidgetErrorCode } from './types';

const PERMANENT_ERROR_CODES: readonly EmbeddedWidgetErrorCode[] = [
  'invalid-url',
  'origin-not-allowed',
  'same-origin',
];

/**
 * Whether retrying can never help: the URL or the deployment configuration
 * has to change. Hosts should not offer a retry for these.
 */
export function isPermanentEmbeddedWidgetError(
  code: EmbeddedWidgetErrorCode | undefined,
): boolean {
  return code !== undefined && PERMANENT_ERROR_CODES.includes(code);
}
