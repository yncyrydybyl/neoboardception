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
 * Pure camera math for presentation transitions on the infinite canvas.
 *
 * A camera is the canvas point in the middle of the viewport plus the scale
 * (screen pixels per canvas unit). It maps 1:1 to the scale context state
 * (`translation = (boardSize / 2 - center) * scale`) and to the SVG viewBox.
 */

export type Camera = {
  /** Canvas x coordinate shown in the middle of the viewport. */
  x: number;
  /** Canvas y coordinate shown in the middle of the viewport. */
  y: number;
  /** Screen pixels per canvas unit. */
  scale: number;
};

export type Size = { width: number; height: number };

export type Rect = { x: number; y: number; width: number; height: number };

export type ViewBox = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

/**
 * The camera that shows the rectangle as large as possible in the
 * container, centered.
 *
 * @param padding - fraction of the container kept free on each side
 */
export function cameraForRect(
  rect: Rect,
  container: Size,
  padding = 0,
): Camera {
  const availableWidth = container.width * (1 - 2 * padding);
  const availableHeight = container.height * (1 - 2 * padding);

  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    scale: Math.min(
      availableWidth / Math.max(rect.width, 1),
      availableHeight / Math.max(rect.height, 1),
    ),
  };
}

/** Bounding rectangle of all rectangles, undefined for an empty list. */
export function boundingRect(rects: Rect[]): Rect | undefined {
  if (rects.length === 0) {
    return undefined;
  }

  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The SVG viewBox that shows what the camera sees in the container. */
export function viewBoxForCamera(camera: Camera, container: Size): ViewBox {
  const width = container.width / camera.scale;
  const height = container.height / camera.scale;

  return {
    minX: camera.x - width / 2,
    minY: camera.y - height / 2,
    width,
    height,
  };
}

export function formatViewBox({ minX, minY, width, height }: ViewBox): string {
  return `${minX} ${minY} ${width} ${height}`;
}

/** Translation of the scale context for a camera. */
export function translationForCamera(
  camera: Camera,
  board: Size,
): { x: number; y: number } {
  return {
    x: (board.width / 2 - camera.x) * camera.scale,
    y: (board.height / 2 - camera.y) * camera.scale,
  };
}

/** Camera for a translation and scale of the scale context. */
export function cameraForTranslation(
  translation: { x: number; y: number },
  scale: number,
  board: Size,
): Camera {
  return {
    x: board.width / 2 - translation.x / scale,
    y: board.height / 2 - translation.y / scale,
    scale,
  };
}

function clampValue(value: number, lower: number, upper: number): number {
  // same order as lodash/clamp, which the scale context uses
  return Math.max(Math.min(value, upper), lower);
}

/**
 * Keep the camera inside the board, exactly like the scale context does
 * with its translation. The final camera of a transition must equal what
 * the scale context stores, otherwise the view would jump at the end.
 */
export function clampCamera(
  camera: Camera,
  container: Size,
  board: Size,
): Camera {
  const translation = translationForCamera(camera, board);
  const limitX = (board.width / 2) * camera.scale - container.width / 2;
  const limitY = (board.height / 2) * camera.scale - container.height / 2;

  return cameraForTranslation(
    {
      x: clampValue(translation.x, -limitX, limitX),
      y: clampValue(translation.y, -limitY, limitY),
    },
    camera.scale,
    board,
  );
}

export function isSameCamera(a: Camera, b: Camera, epsilon = 1e-6): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon * Math.max(1, Math.abs(a.x)) &&
    Math.abs(a.y - b.y) <= epsilon * Math.max(1, Math.abs(a.y)) &&
    Math.abs(a.scale - b.scale) <= epsilon * Math.max(1, a.scale)
  );
}

/** Cubic ease-in-out, maps [0, 1] to [0, 1]. */
export function easeInOutCubic(t: number): number {
  const x = clampValue(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Cubic ease-out, maps [0, 1] to [0, 1]. */
export function easeOutCubic(t: number): number {
  const x = clampValue(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
}

/** Cubic ease-in, maps [0, 1] to [0, 1]. */
export function easeInCubic(t: number): number {
  const x = clampValue(t, 0, 1);
  return x * x * x;
}

export type FlyPath = {
  /**
   * Length of the path in the perceptual metric of van Wijk and Nuij.
   * 0 if start and end are the same.
   */
  length: number;
  /** Camera at a fraction of the path, 0 = start, 1 = end. */
  at(fraction: number): Camera;
};

/**
 * The recommended zoom/pan trade-off of van Wijk and Nuij (√2). Larger
 * values zoom out further on long distances.
 */
export const defaultRho = Math.SQRT2;

/**
 * Smooth and efficient zooming and panning between two cameras, after
 * J. J. van Wijk and W. A. A. Nuij, "Smooth and efficient zooming and
 * panning", IEEE InfoVis 2003. On long distances the camera zooms out,
 * pans and zooms in; on short ones it mostly pans; the perceived speed is
 * constant along the path.
 *
 * @param container - viewport size in pixels; only its width is used to
 *                    measure the visible width of a camera
 */
export function createFlyPath(
  from: Camera,
  to: Camera,
  container: Size,
  rho = defaultRho,
): FlyPath {
  const viewportWidth = Math.max(container.width, 1);
  // visible width in canvas units
  const w0 = viewportWidth / from.scale;
  const w1 = viewportWidth / to.scale;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const u1 = Math.hypot(dx, dy);
  const rho2 = rho * rho;
  const rho4 = rho2 * rho2;

  const cameraAt = (u: number, w: number): Camera => ({
    x: u1 === 0 ? from.x : from.x + (dx * u) / u1,
    y: u1 === 0 ? from.y : from.y + (dy * u) / u1,
    scale: viewportWidth / w,
  });

  // Nearly the same center: the path is a pure zoom.
  if (u1 < 1e-6 * Math.max(w0, w1)) {
    const length = Math.abs(Math.log(w1 / w0)) / rho;

    return {
      length,
      at: (fraction) => {
        const f = clampValue(fraction, 0, 1);
        if (f >= 1) {
          return { ...to };
        }
        // geometric interpolation of the visible width
        const w = w0 * Math.pow(w1 / w0, f);
        return {
          x: from.x + dx * f,
          y: from.y + dy * f,
          scale: viewportWidth / w,
        };
      },
    };
  }

  const b0 = (w1 * w1 - w0 * w0 + rho4 * u1 * u1) / (2 * w0 * rho2 * u1);
  const b1 = (w1 * w1 - w0 * w0 - rho4 * u1 * u1) / (2 * w1 * rho2 * u1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const length = (r1 - r0) / rho;
  const coshR0 = Math.cosh(r0);
  const sinhR0 = Math.sinh(r0);

  return {
    length,
    at: (fraction) => {
      const f = clampValue(fraction, 0, 1);
      if (f >= 1) {
        return { ...to };
      }
      const s = f * length;
      const u = (w0 / rho2) * (coshR0 * Math.tanh(rho * s + r0) - sinhR0);
      const w = (w0 * coshR0) / Math.cosh(rho * s + r0);
      return cameraAt(u, w);
    },
  };
}

/** Timing of the `fly` transition at normal speed. */
export const flyTiming = {
  /** Milliseconds per unit of path length. */
  msPerUnit: 650,
  minMs: 550,
  maxMs: 2200,
};

/**
 * Duration of a fly along a path: proportional to the perceived distance,
 * bounded so short hops still read as motion and long trips do not drag.
 *
 * @param speedFactor - multiplier of the duration (slow > 1 > fast)
 */
export function flyDuration(pathLength: number, speedFactor = 1): number {
  if (!(pathLength > 1e-6)) {
    return 0;
  }

  return (
    clampValue(
      pathLength * flyTiming.msPerUnit,
      flyTiming.minMs,
      flyTiming.maxMs,
    ) * speedFactor
  );
}
