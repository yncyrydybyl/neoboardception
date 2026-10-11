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
 * Prefix of the widget id a board gets when it runs embedded in another
 * board (the widget mediation derives `embedded-<element id>`).
 */
export const EMBEDDED_WIDGET_ID_PREFIX = 'embedded-';

/**
 * Whether this board runs as an embedded widget inside another board. An
 * embedded board:
 *
 * - shows only its own whiteboard (state key = its widget id), never another
 *   board in the room;
 * - uses the session/WebRTC transport (MatrixRTC is not delegated to
 *   embedded widgets);
 * - does not embed widgets itself (nesting depth 1).
 */
export function isEmbeddedBoard(
  location: Pick<Location, 'search' | 'hash'> = window.location,
): boolean {
  const ids = [new URLSearchParams(location.search).get('widgetId')];
  const q = location.hash.indexOf('?');
  if (q >= 0) {
    ids.push(
      new URLSearchParams(location.hash.slice(q + 1)).get('matrix_widget_id'),
    );
  }
  return ids.some((id) => !!id && id.startsWith(EMBEDDED_WIDGET_ID_PREFIX));
}
