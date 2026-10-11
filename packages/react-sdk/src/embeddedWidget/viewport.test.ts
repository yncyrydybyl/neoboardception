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

import { describe, expect, it } from 'vitest';
import { calculateVisibleCanvasRect, intersectsRect } from './viewport';

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
