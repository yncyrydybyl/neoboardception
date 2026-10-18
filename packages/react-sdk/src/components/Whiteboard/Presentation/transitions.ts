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

import type {
  PresentationSettings,
  PresentationSpeed,
  PresentationTransition,
} from '../../../state';
import {
  Camera,
  createFlyPath,
  flyDuration,
  FlyPath,
  isSameCamera,
  Size,
} from './camera';

/** Transitions that change the view with opacity and a CSS transform. */
export type OverlayTransition = 'fade' | 'slide' | 'zoom';

/** What the canvas does to get from one camera to the next. */
export type TransitionPlan =
  | { kind: 'jump' }
  | { kind: 'fly'; path: FlyPath; durationMs: number }
  | {
      kind: 'overlay';
      style: OverlayTransition;
      /** 1: forward in the frame order, -1: backward. */
      direction: 1 | -1;
      /** Duration of the phase that hides the old view. */
      outMs: number;
      /** Duration of the phase that shows the new view. */
      inMs: number;
    };

const speedFactors: Record<PresentationSpeed, number> = {
  slow: 1.6,
  normal: 1,
  fast: 0.6,
};

/** Duration multiplier for a speed setting. */
export function speedFactor(speed: PresentationSpeed): number {
  return speedFactors[speed] ?? 1;
}

/** Phase durations of the overlay transitions at normal speed (ms). */
export const overlayTiming: Record<
  OverlayTransition,
  { outMs: number; inMs: number }
> = {
  fade: { outMs: 220, inMs: 320 },
  slide: { outMs: 260, inMs: 380 },
  zoom: { outMs: 260, inMs: 380 },
};

/**
 * The transition that applies when the presentation moves to a frame: the
 * override of the target frame, else the transition of the presentation.
 * With reduced motion every moving transition becomes a fade.
 */
export function resolveTransition(
  settings: PresentationSettings,
  targetFrameId: string | undefined,
  prefersReducedMotion: boolean,
): PresentationTransition {
  const transition =
    (targetFrameId !== undefined
      ? settings.frameTransitions[targetFrameId]
      : undefined) ?? settings.transition;

  if (prefersReducedMotion && transition !== 'none' && transition !== 'fade') {
    return 'fade';
  }

  return transition;
}

/**
 * The transition used to open or close the overview: the camera flies
 * (Prezi's zoom out), unless the presentation uses no transition at all or
 * the user prefers reduced motion.
 */
export function resolveOverviewTransition(
  settings: PresentationSettings,
  prefersReducedMotion: boolean,
): PresentationTransition {
  if (settings.transition === 'none') {
    return 'none';
  }

  return prefersReducedMotion ? 'fade' : 'fly';
}

export type PlanTransitionOptions = {
  transition: PresentationTransition;
  from: Camera;
  to: Camera;
  container: Size;
  speed: PresentationSpeed;
  direction?: 1 | -1;
  /** Skip the animation, e.g. for late joiners or resizes. */
  instant?: boolean;
};

export function planTransition({
  transition,
  from,
  to,
  container,
  speed,
  direction = 1,
  instant = false,
}: PlanTransitionOptions): TransitionPlan {
  if (
    instant ||
    transition === 'none' ||
    container.width <= 0 ||
    container.height <= 0 ||
    isSameCamera(from, to)
  ) {
    return { kind: 'jump' };
  }

  const factor = speedFactor(speed);

  if (transition === 'fly') {
    const path = createFlyPath(from, to, container);
    const durationMs = flyDuration(path.length, factor);

    if (durationMs <= 0) {
      return { kind: 'jump' };
    }

    return { kind: 'fly', path, durationMs };
  }

  const timing = overlayTiming[transition];

  return {
    kind: 'overlay',
    style: transition,
    direction,
    outMs: timing.outMs * factor,
    inMs: timing.inMs * factor,
  };
}

/**
 * Keyframes of an overlay transition phase (opacity and transform only, so
 * the browser can run them on the compositor).
 */
export function overlayKeyframes(
  style: OverlayTransition,
  phase: 'out' | 'in',
  direction: 1 | -1,
): Keyframe[] {
  switch (style) {
    case 'fade':
      return phase === 'out'
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [{ opacity: 0 }, { opacity: 1 }];

    case 'slide': {
      // forward: the old view leaves to the left, the new one comes from the right
      const offset = 30 * direction;
      return phase === 'out'
        ? [
            { opacity: 1, transform: 'translateX(0)' },
            { opacity: 0, transform: `translateX(${-offset}%)` },
          ]
        : [
            { opacity: 0, transform: `translateX(${offset}%)` },
            { opacity: 1, transform: 'translateX(0)' },
          ];
    }

    case 'zoom': {
      // forward: dive into the old view, the new one grows from the distance
      const outScale = direction === 1 ? 1.35 : 0.7;
      const inScale = direction === 1 ? 0.7 : 1.35;
      return phase === 'out'
        ? [
            { opacity: 1, transform: 'scale(1)' },
            { opacity: 0, transform: `scale(${outScale})` },
          ]
        : [
            { opacity: 0, transform: `scale(${inScale})` },
            { opacity: 1, transform: 'scale(1)' },
          ];
    }
  }
}
