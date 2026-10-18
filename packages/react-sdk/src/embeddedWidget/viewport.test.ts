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

import { act, renderHook } from '@testing-library/react';
import { createElement, PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SvgCameraContext,
  SvgScaleContext,
  SvgScaleContextType,
  ViewportChangeSource,
} from '../components/Whiteboard/SvgScaleContext/context';
import {
  calculateVisibleCanvasRect,
  gestureEndDelayMs,
  intersectsRect,
  useEmbeddedWidgetViewport,
} from './viewport';

describe('calculateVisibleCanvasRect', () => {
  it('should derive the visible rect from center, scale and container', () => {
    expect(
      calculateVisibleCanvasRect({ x: 1000, y: 500 }, 2, 800, 600),
    ).toEqual({ offsetX: 800, offsetY: 350, width: 400, height: 300 });
  });

  it.each([
    [0, 800, 600],
    [1, 0, 600],
    [1, 800, 0],
  ])('should return undefined for scale %s and size %sx%s', (s, w, h) => {
    expect(calculateVisibleCanvasRect({ x: 0, y: 0 }, s, w, h)).toBeUndefined();
  });
});

describe('intersectsRect', () => {
  const viewport = { offsetX: 100, offsetY: 100, width: 200, height: 200 };

  it.each([
    [{ offsetX: 150, offsetY: 150, width: 10, height: 10 }, true],
    [{ offsetX: 0, offsetY: 0, width: 101, height: 101 }, true],
    [{ offsetX: 0, offsetY: 0, width: 100, height: 100 }, false],
    [{ offsetX: 300, offsetY: 150, width: 10, height: 10 }, false],
    [{ offsetX: 0, offsetY: 0, width: 1000, height: 1000 }, true],
  ])('%j -> %s', (rect, expected) => {
    expect(intersectsRect(rect, viewport)).toBe(expected);
  });
});

describe('useEmbeddedWidgetViewport', () => {
  type Props = {
    x: number;
    source: ViewportChangeSource;
    cameraMoving: boolean;
  };
  const element = { offsetX: 900, offsetY: 400, width: 200, height: 200 };

  let props: Props;

  function wrapper({ children }: PropsWithChildren) {
    const scale = {
      scale: 1,
      viewportCanvasCenter: { x: props.x, y: 500 },
      containerDimensions: { width: 800, height: 600 },
      viewportChangeSource: props.source,
    } as unknown as SvgScaleContextType;
    return createElement(
      SvgScaleContext.Provider,
      { value: scale },
      createElement(
        SvgCameraContext.Provider,
        {
          value: {
            cameraMoving: props.cameraMoving,
            setCameraMoving: () => {},
          },
        },
        children,
      ),
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(initial: Props) {
    props = initial;
    const view = renderHook(() => useEmbeddedWidgetViewport(element), {
      wrapper,
    });
    return {
      result: view.result,
      rerender: (next: Props) => {
        props = next;
        view.rerender();
      },
    };
  }

  it('treats a pan by the user as a gesture until it settles', () => {
    const { result, rerender } = setup({
      x: 1000,
      source: 'user',
      cameraMoving: false,
    });
    expect(result.current).toEqual({ visible: true, gesturing: false });

    rerender({ x: 1010, source: 'user', cameraMoving: false });
    expect(result.current.gesturing).toBe(true);

    act(() => vi.advanceTimersByTime(gestureEndDelayMs + 1));
    expect(result.current.gesturing).toBe(false);
  });

  it('hides the widget exactly while the camera flies', () => {
    const { result, rerender } = setup({
      x: 1000,
      source: 'user',
      cameraMoving: false,
    });

    rerender({ x: 1000, source: 'user', cameraMoving: true });
    expect(result.current.gesturing).toBe(true);

    // the flight ends: the camera commits its final viewport
    rerender({ x: 1050, source: 'camera', cameraMoving: false });
    expect(result.current).toEqual({ visible: true, gesturing: false });
  });

  it('does not start the gesture delay for a jump of the camera (fade, slide, zoom)', () => {
    const { result, rerender } = setup({
      x: 3000,
      source: 'user',
      cameraMoving: false,
    });
    expect(result.current.visible).toBe(false);

    rerender({ x: 1000, source: 'camera', cameraMoving: false });

    expect(result.current).toEqual({ visible: true, gesturing: false });
  });
});
