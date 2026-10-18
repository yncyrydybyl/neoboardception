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

/** What a key does while presenting. */
export type PresentationKeyAction =
  | 'next'
  | 'previous'
  | 'first'
  | 'last'
  | 'toggleOverview'
  | 'closeOverview';

/** Keys handled while presenting (for `useHotkeys` with `useKey`). */
export const presentationHotkeys = [
  'ArrowRight',
  'ArrowDown',
  'PageDown',
  'space',
  'shift+space',
  'ArrowLeft',
  'ArrowUp',
  'PageUp',
  'Home',
  'End',
  'o',
  'Escape',
  'Enter',
];

/**
 * Map a key press to a presentation action, like in Reveal.js:
 * right/down/page down/space go forward, left/up/page up/shift+space go
 * back, Home/End jump to the first/last frame, O and Escape toggle the
 * overview and Enter opens the selected frame from the overview.
 *
 * @param infiniteCanvas - the overview only exists on the infinite canvas
 * @param overview - the overview is shown
 */
export function presentationKeyAction(
  event: Pick<
    KeyboardEvent,
    'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'
  >,
  infiniteCanvas: boolean,
  overview: boolean,
): PresentationKeyAction | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return undefined;
  }

  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
      return 'next';
    case ' ':
      return event.shiftKey ? 'previous' : 'next';
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return 'previous';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'o':
    case 'O':
    case 'Escape':
      return infiniteCanvas ? 'toggleOverview' : undefined;
    case 'Enter':
      return infiniteCanvas && overview ? 'closeOverview' : undefined;
    default:
      return undefined;
  }
}
