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

import { useContext, useEffect, useRef, useState } from 'react';
import {
  SvgCameraContext,
  SvgScaleContext,
} from '../components/Whiteboard/SvgScaleContext/context';
import { infiniteCanvasMode } from '../components/Whiteboard/constants';
import { BoundingRect, Point } from '../state';

/** Time without viewport changes after which a pan/zoom gesture is over. */
export const gestureEndDelayMs = 150;

/**
 * Visible part of the canvas in canvas coordinates, derived from the scale
 * context. Returns undefined if it cannot be determined.
 */
export function calculateVisibleCanvasRect(
  viewportCanvasCenter: Point,
  scale: number,
  containerWidth: number,
  containerHeight: number,
): BoundingRect | undefined {
  if (!(scale > 0) || containerWidth <= 0 || containerHeight <= 0) {
    return undefined;
  }

  const width = containerWidth / scale;
  const height = containerHeight / scale;
  return {
    offsetX: viewportCanvasCenter.x - width / 2,
    offsetY: viewportCanvasCenter.y - height / 2,
    width,
    height,
  };
}

export function intersectsRect(a: BoundingRect, b: BoundingRect): boolean {
  return (
    a.offsetX < b.offsetX + b.width &&
    a.offsetX + a.width > b.offsetX &&
    a.offsetY < b.offsetY + b.height &&
    a.offsetY + a.height > b.offsetY
  );
}

/**
 * Viewport-derived view state for an element: whether it intersects the
 * visible canvas and whether a pan/zoom gesture is in progress (any viewport
 * change within the last {@link gestureEndDelayMs} ms).
 *
 * Presentation transitions are not gestures: while the camera flies
 * (`cameraMoving`) the element counts as gesturing for exactly the duration
 * of the flight, and the camera's final viewport change does not start the
 * gesture delay. So a widget is hidden once per flight and shown again
 * right when the camera arrives, without flicker; fades and slides do not
 * hide it at all.
 *
 * Outside of an infinite canvas (slides mode) the whole slide is visible and
 * the viewport does not change by gestures.
 */
export function useEmbeddedWidgetViewport(elementRect: BoundingRect): {
  visible: boolean;
  gesturing: boolean;
} {
  const scaleContext = useContext(SvgScaleContext);
  const [gesturing, setGesturing] = useState(false);
  const firstRef = useRef(true);

  const scale = scaleContext?.scale;
  const center = scaleContext?.viewportCanvasCenter;
  const { cameraMoving } = useContext(SvgCameraContext);
  const cameraChange = scaleContext?.viewportChangeSource === 'camera';
  const containerWidth = scaleContext?.containerDimensions.width ?? 0;
  const containerHeight = scaleContext?.containerDimensions.height ?? 0;
  const enabled = infiniteCanvasMode && scaleContext !== undefined;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    // ignore the initial viewport
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    // presentation transitions are handled by `cameraMoving`
    if (cameraChange) {
      setGesturing(false);
      return;
    }

    setGesturing(true);
    const timer = setTimeout(() => setGesturing(false), gestureEndDelayMs);
    return () => clearTimeout(timer);
  }, [enabled, scale, center?.x, center?.y, cameraChange]);

  if (!enabled || scale === undefined || center === undefined) {
    return { visible: true, gesturing: false };
  }

  const visibleRect = calculateVisibleCanvasRect(
    center,
    scale,
    containerWidth,
    containerHeight,
  );

  return {
    visible: visibleRect ? intersectsRect(elementRect, visibleRect) : true,
    gesturing: gesturing || cameraMoving,
  };
}
