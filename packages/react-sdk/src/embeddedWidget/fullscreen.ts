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

import { useEffect, useState } from 'react';

/** Attribute of the element an embedded widget is mounted into. */
export const embeddedWidgetMountAttribute = 'data-embedded-widget-mount';

/**
 * Whether the given fullscreen element belongs to an embedded widget, i.e.
 * an embedded widget (its iframe, as seen from the board) is in fullscreen
 * and not the board itself.
 */
export function isEmbeddedWidgetFullscreenElement(
  element: Element | null | undefined,
): boolean {
  return (
    element instanceof Element &&
    element.closest(`[${embeddedWidgetMountAttribute}]`) !== null
  );
}

/**
 * Whether `document.fullscreenElement` is inside `container`.
 *
 * If a widget requests fullscreen inside its own iframe, the browser makes
 * that iframe the fullscreen element of the board's document. The board must
 * then keep the iframe visible and interactive, independent of where the
 * board's camera is: a hidden (`visibility: hidden`) or click-through
 * (`pointer-events: none`) fullscreen iframe leaves the user with a frozen
 * screen that only Escape ends.
 */
export function useIsFullscreenWithin(container: Element | null): boolean {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!container) {
      setFullscreen(false);
      return;
    }

    const update = () => {
      const element = document.fullscreenElement;
      setFullscreen(element instanceof Node && container.contains(element));
    };

    update();
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, [container]);

  return fullscreen;
}
