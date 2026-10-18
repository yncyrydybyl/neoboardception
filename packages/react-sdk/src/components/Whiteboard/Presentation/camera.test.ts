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
import {
  boundingRect,
  Camera,
  cameraForRect,
  cameraForTranslation,
  clampCamera,
  createFlyPath,
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  flyDuration,
  flyTiming,
  formatViewBox,
  isSameCamera,
  translationForCamera,
  viewBoxForCamera,
} from './camera';

const container = { width: 1600, height: 900 };
const board = { width: 19200, height: 10800 };

describe('cameraForRect', () => {
  it('centers the rect and fits it into the container', () => {
    expect(
      cameraForRect({ x: 100, y: 200, width: 1600, height: 900 }, container),
    ).toEqual({ x: 900, y: 650, scale: 1 });
  });

  it('uses the limiting side of the rect', () => {
    // tall rect: height limits
    expect(
      cameraForRect({ x: 0, y: 0, width: 400, height: 1800 }, container).scale,
    ).toBeCloseTo(0.5);
    // wide rect: width limits
    expect(
      cameraForRect({ x: 0, y: 0, width: 3200, height: 100 }, container).scale,
    ).toBeCloseTo(0.5);
  });

  it('keeps padding free on every side', () => {
    const camera = cameraForRect(
      { x: 0, y: 0, width: 1600, height: 900 },
      container,
      0.1,
    );
    expect(camera.scale).toBeCloseTo(0.8);
  });

  it('does not divide by zero for empty rects', () => {
    expect(
      Number.isFinite(
        cameraForRect({ x: 5, y: 5, width: 0, height: 0 }, container).scale,
      ),
    ).toBe(true);
  });
});

describe('boundingRect', () => {
  it('returns undefined without rects', () => {
    expect(boundingRect([])).toBeUndefined();
  });

  it('encloses all rects', () => {
    expect(
      boundingRect([
        { x: 10, y: 20, width: 100, height: 100 },
        { x: -50, y: 300, width: 10, height: 10 },
      ]),
    ).toEqual({ x: -50, y: 20, width: 160, height: 290 });
  });
});

describe('viewBox and translation', () => {
  it('computes the viewBox of a camera', () => {
    const viewBox = viewBoxForCamera({ x: 1000, y: 500, scale: 2 }, container);
    expect(viewBox).toEqual({ minX: 600, minY: 275, width: 800, height: 450 });
    expect(formatViewBox(viewBox)).toBe('600 275 800 450');
  });

  it('matches the viewBox formula of the canvas', () => {
    // SvgCanvas: minX = (W - width / scale) / 2 - translation.x / scale
    const camera: Camera = { x: 4321, y: 1234, scale: 0.37 };
    const translation = translationForCamera(camera, board);
    const minX =
      (board.width - container.width / camera.scale) / 2 -
      translation.x / camera.scale;
    const minY =
      (board.height - container.height / camera.scale) / 2 -
      translation.y / camera.scale;
    const viewBox = viewBoxForCamera(camera, container);
    expect(viewBox.minX).toBeCloseTo(minX, 6);
    expect(viewBox.minY).toBeCloseTo(minY, 6);
  });

  it('converts between translation and camera', () => {
    const camera: Camera = { x: 1234, y: 5678, scale: 0.42 };
    expect(
      cameraForTranslation(
        translationForCamera(camera, board),
        camera.scale,
        board,
      ),
    ).toEqual({
      x: expect.closeTo(1234, 6),
      y: expect.closeTo(5678, 6),
      scale: 0.42,
    });
  });
});

describe('clampCamera', () => {
  it('keeps a camera inside the board unchanged', () => {
    const camera = { x: 9600, y: 5400, scale: 1 };
    expect(isSameCamera(clampCamera(camera, container, board), camera)).toBe(
      true,
    );
  });

  it('pulls a camera at the board edge back inside', () => {
    const clamped = clampCamera({ x: 10, y: 10, scale: 1 }, container, board);
    // the viewport may not show anything left/above the board
    expect(clamped.x).toBeCloseTo(container.width / 2);
    expect(clamped.y).toBeCloseTo(container.height / 2);
  });
});

describe('easing', () => {
  it.each([easeInOutCubic, easeInCubic, easeOutCubic])(
    'maps 0 to 0 and 1 to 1 and is monotonic (%#)',
    (ease) => {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      let last = -1;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const v = ease(t);
        expect(v).toBeGreaterThanOrEqual(last);
        last = v;
      }
    },
  );

  it('clamps the input', () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });

  it('is symmetric for ease-in-out', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1);
  });
});

describe('createFlyPath', () => {
  const from: Camera = { x: 1000, y: 1000, scale: 1 };

  it('starts and ends at the given cameras', () => {
    const to: Camera = { x: 9000, y: 4000, scale: 0.5 };
    const path = createFlyPath(from, to, container);
    expect(isSameCamera(path.at(0), from, 1e-9)).toBe(true);
    expect(path.at(1)).toEqual(to);
  });

  it('zooms out in the middle of a long flight', () => {
    const to: Camera = { x: 15000, y: 1000, scale: 1 };
    const path = createFlyPath(from, to, container);
    const middle = path.at(0.5);
    expect(middle.scale).toBeLessThan(0.2);
    expect(middle.x).toBeCloseTo(8000, 0);
  });

  it('pans along the straight line between the centers', () => {
    const to: Camera = { x: 5000, y: 3000, scale: 2 };
    const path = createFlyPath(from, to, container);
    for (const f of [0.1, 0.3, 0.6, 0.9]) {
      const c = path.at(f);
      // (c - from) is parallel to (to - from)
      const cross = (c.x - 1000) * (3000 - 1000) - (c.y - 1000) * (5000 - 1000);
      expect(Math.abs(cross)).toBeLessThan(1e-6 * 4000 * 4000);
    }
  });

  it('moves monotonically towards the target', () => {
    const to: Camera = { x: 12000, y: 7000, scale: 0.3 };
    const path = createFlyPath(from, to, container);
    let lastDistance = Infinity;
    for (let f = 0; f <= 1.0001; f += 0.02) {
      const c = path.at(f);
      const d = Math.hypot(to.x - c.x, to.y - c.y);
      expect(d).toBeLessThanOrEqual(lastDistance + 1e-6);
      lastDistance = d;
    }
  });

  it('is longer for longer distances', () => {
    const near = createFlyPath(from, { x: 3000, y: 1000, scale: 1 }, container);
    const far = createFlyPath(from, { x: 18000, y: 1000, scale: 1 }, container);
    expect(far.length).toBeGreaterThan(near.length);
    expect(near.length).toBeGreaterThan(0);
  });

  it('handles a pure zoom without moving', () => {
    const to: Camera = { x: 1000, y: 1000, scale: 4 };
    const path = createFlyPath(from, to, container);
    expect(path.length).toBeCloseTo(Math.log(4) / Math.SQRT2);
    const middle = path.at(0.5);
    expect(middle.x).toBe(1000);
    expect(middle.scale).toBeCloseTo(2); // geometric middle
    expect(path.at(1)).toEqual(to);
  });

  it('has length 0 for the same camera', () => {
    expect(createFlyPath(from, { ...from }, container).length).toBe(0);
  });

  it('never produces invalid cameras', () => {
    const to: Camera = { x: -5000, y: 9000, scale: 0.05 };
    const path = createFlyPath({ x: 18000, y: 200, scale: 3 }, to, container);
    for (let f = 0; f <= 1; f += 0.01) {
      const c = path.at(f);
      expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
      expect(c.scale).toBeGreaterThan(0);
    }
  });
});

describe('flyDuration', () => {
  it('is 0 for an empty path', () => {
    expect(flyDuration(0)).toBe(0);
  });

  it('scales with the path length within bounds', () => {
    expect(flyDuration(0.01)).toBe(flyTiming.minMs);
    expect(flyDuration(1.5)).toBeCloseTo(1.5 * flyTiming.msPerUnit);
    expect(flyDuration(100)).toBe(flyTiming.maxMs);
  });

  it('applies the speed factor', () => {
    expect(flyDuration(1.5, 2)).toBeCloseTo(3 * flyTiming.msPerUnit);
    expect(flyDuration(100, 0.5)).toBe(flyTiming.maxMs / 2);
  });
});
