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
  calculateFittedElementSize,
  clampElementPosition,
  Point,
  Size,
} from '../state';
import {
  defaultEmbeddedWidgetSize,
  EmbeddedWidgetElement,
  embeddedWidgetElementType,
} from './element';
import { validateEmbeddedWidgetUrl } from './urlPolicy';

export type CreateEmbeddedWidgetElementOptions = {
  widgetUrl: string;
  title?: string;
  /** Optional declared capabilities (see {@link EmbeddedWidgetElement}). */
  capabilities?: string[];
  /** Center of the new element in canvas coordinates. */
  center: Point;
  /** Size of the whiteboard canvas. */
  whiteboardSize: Size;
  size?: Size;
};

/**
 * Build the shell of a new embedded widget element, centred on the given
 * position and fitted into the whiteboard.
 *
 * @throws if the URL does not pass {@link validateEmbeddedWidgetUrl}
 */
export function createEmbeddedWidgetElement({
  widgetUrl,
  title,
  capabilities,
  center,
  whiteboardSize,
  size = defaultEmbeddedWidgetSize,
}: CreateEmbeddedWidgetElementOptions): EmbeddedWidgetElement {
  const trimmedUrl = widgetUrl.trim();
  if (!validateEmbeddedWidgetUrl(trimmedUrl).valid) {
    throw new Error('Invalid embedded widget URL');
  }

  const fittedSize = calculateFittedElementSize(size, whiteboardSize);
  const position = clampElementPosition(
    {
      x: Math.round(center.x - fittedSize.width / 2),
      y: Math.round(center.y - fittedSize.height / 2),
    },
    fittedSize,
    whiteboardSize,
  );

  const trimmedTitle = title?.trim();

  return {
    type: embeddedWidgetElementType,
    position,
    width: fittedSize.width,
    height: fittedSize.height,
    widgetUrl: trimmedUrl,
    ...(trimmedTitle ? { title: trimmedTitle } : {}),
    ...(capabilities && capabilities.length > 0
      ? { capabilities: Array.from(new Set(capabilities)) }
      : {}),
  };
}
