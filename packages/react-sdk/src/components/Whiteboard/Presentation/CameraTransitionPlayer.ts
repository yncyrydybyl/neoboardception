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

import { Camera, easeInOutCubic } from './camera';
import { overlayKeyframes, TransitionPlan } from './transitions';

/** What the player drives. */
export type CameraTransitionTarget = {
  /**
   * Show the camera right now, without a React render (e.g. by writing the
   * SVG viewBox). Called once per animation frame while flying.
   */
  applyCamera(camera: Camera): void;
  /**
   * Store the final camera (e.g. in the scale context). Called once at the
   * end of a transition; not called for intermediate cameras.
   */
  commitCamera(camera: Camera): void;
  /** Element that overlay transitions (fade, slide, zoom) animate. */
  getOverlayElement(): Element | null;
  /**
   * The camera starts or stops moving continuously (fly). Called with
   * `true` once at the start and with `false` once at the very end, also if
   * the flight was redirected in between.
   */
  onMovingChange?(moving: boolean): void;
};

/** Frame scheduling, replaceable in tests. */
export type FrameScheduler = {
  now(): number;
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
};

export const browserFrameScheduler: FrameScheduler = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** Statistics of the last finished fly, for diagnostics. */
export type FlyStatistics = {
  durationMs: number;
  frames: number;
  /** Average frames per second over the flight. */
  fps: number;
  /** Longest gap between two animation frames in ms. */
  maxFrameGapMs: number;
};

/**
 * Plays presentation transitions on the canvas.
 *
 * - `fly` moves the camera on every animation frame through
 *   {@link CameraTransitionTarget.applyCamera} and commits once at the end,
 *   so React does not render during the flight.
 * - overlay transitions animate opacity/transform of one element with the
 *   Web Animations API and switch the camera while the view is hidden.
 * - a new transition replaces a running one and starts from the camera that
 *   is visible right now, so quick navigation never jumps back.
 */
export class CameraTransitionPlayer {
  private visibleCamera: Camera | undefined;
  private frameHandle: number | undefined;
  private animations: Animation[] = [];
  private moving = false;
  /** Increments on every play/cancel to ignore callbacks of old runs. */
  private run = 0;
  /** Phase of the running overlay transition. */
  private overlayPhase: 'out' | 'in' | undefined;
  private lastFlyStatistics: FlyStatistics | undefined;

  constructor(
    private readonly target: CameraTransitionTarget,
    private readonly scheduler: FrameScheduler = browserFrameScheduler,
  ) {}

  /** Whether a transition is running. */
  isRunning(): boolean {
    return this.frameHandle !== undefined || this.overlayPhase !== undefined;
  }

  /** The camera shown right now, if a transition runs or ran. */
  getVisibleCamera(): Camera | undefined {
    return this.visibleCamera;
  }

  getLastFlyStatistics(): FlyStatistics | undefined {
    return this.lastFlyStatistics;
  }

  /**
   * Play a transition to the target camera.
   *
   * @param plan - what to do, see {@link planTransition}
   * @param to - final camera
   */
  play(plan: TransitionPlan, to: Camera): void {
    const interruptedOverlay = this.overlayPhase !== undefined;
    const run = this.stopRunning();

    switch (plan.kind) {
      case 'jump':
        this.finish(to);
        return;

      case 'fly':
        this.fly(run, plan.path.at.bind(plan.path), plan.durationMs, to);
        return;

      case 'overlay':
        this.overlay(run, plan, to, interruptedOverlay);
        return;
    }
  }

  /**
   * Stop a running transition where it is and store the visible camera,
   * e.g. when the user takes over the view.
   */
  cancel(): void {
    const wasRunning = this.isRunning();
    this.stopRunning();

    if (wasRunning && this.visibleCamera) {
      this.target.commitCamera(this.visibleCamera);
    }

    this.setMoving(false);
  }

  /** Stop everything without committing; for unmounting. */
  destroy(): void {
    this.stopRunning();
    this.moving = false;
  }

  private stopRunning(): number {
    this.run += 1;

    if (this.frameHandle !== undefined) {
      this.scheduler.cancel(this.frameHandle);
      this.frameHandle = undefined;
    }

    this.animations.forEach((a) => a.cancel());
    this.animations = [];
    this.overlayPhase = undefined;

    return this.run;
  }

  private finish(to: Camera) {
    this.visibleCamera = to;
    this.target.applyCamera(to);
    this.target.commitCamera(to);
    this.setMoving(false);
  }

  private setMoving(moving: boolean) {
    if (this.moving !== moving) {
      this.moving = moving;
      this.target.onMovingChange?.(moving);
    }
  }

  private fly(
    run: number,
    at: (fraction: number) => Camera,
    durationMs: number,
    to: Camera,
  ) {
    this.setMoving(true);

    const start = this.scheduler.now();
    let frames = 0;
    let lastTime = start;
    let maxGap = 0;

    const step = (time: number) => {
      if (run !== this.run) {
        return;
      }

      const now = Math.max(time, this.scheduler.now());
      frames += 1;
      maxGap = Math.max(maxGap, now - lastTime);
      lastTime = now;

      const progress = (now - start) / durationMs;

      if (progress >= 1) {
        this.frameHandle = undefined;
        const elapsed = Math.max(now - start, 1);
        this.lastFlyStatistics = {
          durationMs: elapsed,
          frames,
          fps: (frames * 1000) / elapsed,
          maxFrameGapMs: maxGap,
        };
        this.finish(to);
        return;
      }

      const camera = at(easeInOutCubic(progress));
      this.visibleCamera = camera;
      this.target.applyCamera(camera);
      this.frameHandle = this.scheduler.request(step);
    };

    this.frameHandle = this.scheduler.request(step);
  }

  private overlay(
    run: number,
    plan: Extract<TransitionPlan, { kind: 'overlay' }>,
    to: Camera,
    skipOutPhase: boolean,
  ) {
    // a flight that was redirected into an overlay transition ends here
    this.setMoving(false);

    const element = this.target.getOverlayElement();

    if (!element || typeof element.animate !== 'function') {
      this.finish(to);
      return;
    }

    const playIn = () => {
      if (run !== this.run) {
        return;
      }

      // switch the camera while the view is hidden
      this.visibleCamera = to;
      this.target.applyCamera(to);
      this.target.commitCamera(to);

      this.overlayPhase = 'in';
      const animationIn = element.animate(
        overlayKeyframes(plan.style, 'in', plan.direction),
        { duration: plan.inMs, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
      this.animations.push(animationIn);
      animationIn.onfinish = () => {
        if (run !== this.run) {
          return;
        }
        this.animations.forEach((a) => a.cancel());
        this.animations = [];
        this.overlayPhase = undefined;
      };
    };

    if (skipOutPhase) {
      playIn();
      return;
    }

    this.overlayPhase = 'out';
    const animationOut = element.animate(
      overlayKeyframes(plan.style, 'out', plan.direction),
      {
        duration: plan.outMs,
        easing: 'cubic-bezier(0.55, 0, 1, 0.45)',
        // keep the view hidden until the "in" phase takes over
        fill: 'forwards',
      },
    );
    this.animations.push(animationOut);
    animationOut.onfinish = playIn;
  }
}
