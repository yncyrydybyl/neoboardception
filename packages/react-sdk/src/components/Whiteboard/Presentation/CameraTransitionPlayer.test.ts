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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Camera, createFlyPath, isSameCamera } from './camera';
import {
  CameraTransitionPlayer,
  CameraTransitionTarget,
  FrameScheduler,
} from './CameraTransitionPlayer';
import { TransitionPlan } from './transitions';

const container = { width: 1600, height: 900 };

/** Manual animation frames: `tick(ms)` advances the clock by one frame. */
function createScheduler() {
  let now = 0;
  let nextHandle = 1;
  const callbacks = new Map<number, (time: number) => void>();
  const scheduler: FrameScheduler = {
    now: () => now,
    request: (callback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel: (handle) => {
      callbacks.delete(handle);
    },
  };
  const tick = (ms = 1000 / 60) => {
    now += ms;
    const pending = [...callbacks.entries()];
    callbacks.clear();
    pending.forEach(([, callback]) => callback(now));
  };
  const runFor = (ms: number, frameMs = 1000 / 60) => {
    for (let t = 0; t < ms; t += frameMs) {
      tick(frameMs);
    }
  };
  return { scheduler, tick, runFor, pending: () => callbacks.size };
}

type MockAnimation = {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
  onfinish: (() => void) | null;
  finish: () => void;
};

function createAnimatedElement() {
  const animations: MockAnimation[] = [];
  const element = {
    animate: vi.fn(
      (keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
        const animation: MockAnimation = {
          keyframes,
          options,
          cancel: vi.fn(),
          onfinish: null,
          finish: () => animation.onfinish?.(),
        };
        animations.push(animation);
        return animation;
      },
    ),
  };
  return { element: element as unknown as Element, animations };
}

describe('CameraTransitionPlayer', () => {
  const from: Camera = { x: 1000, y: 1000, scale: 1 };
  const to: Camera = { x: 9000, y: 6000, scale: 0.5 };
  let target: {
    applyCamera: ReturnType<typeof vi.fn>;
    commitCamera: ReturnType<typeof vi.fn>;
    getOverlayElement: ReturnType<typeof vi.fn>;
    onMovingChange: ReturnType<typeof vi.fn>;
  };
  let frames: ReturnType<typeof createScheduler>;
  let player: CameraTransitionPlayer;

  const flyPlan = (
    a: Camera,
    b: Camera,
    durationMs = 1000,
  ): TransitionPlan => ({
    kind: 'fly',
    path: createFlyPath(a, b, container),
    durationMs,
  });

  beforeEach(() => {
    target = {
      applyCamera: vi.fn(),
      commitCamera: vi.fn(),
      getOverlayElement: vi.fn().mockReturnValue(null),
      onMovingChange: vi.fn(),
    };
    frames = createScheduler();
    player = new CameraTransitionPlayer(
      target as unknown as CameraTransitionTarget,
      frames.scheduler,
    );
  });

  it('jumps and commits once', () => {
    player.play({ kind: 'jump' }, to);

    expect(target.applyCamera).toHaveBeenCalledWith(to);
    expect(target.commitCamera).toHaveBeenCalledTimes(1);
    expect(target.commitCamera).toHaveBeenCalledWith(to);
    expect(target.onMovingChange).not.toHaveBeenCalled();
    expect(player.isRunning()).toBe(false);
  });

  it('flies frame by frame and commits only at the end', () => {
    player.play(flyPlan(from, to), to);

    expect(player.isRunning()).toBe(true);
    expect(target.onMovingChange).toHaveBeenCalledWith(true);

    frames.runFor(500);
    expect(target.applyCamera.mock.calls.length).toBeGreaterThan(25);
    expect(target.commitCamera).not.toHaveBeenCalled();
    const middle = player.getVisibleCamera()!;
    expect(middle.scale).toBeLessThan(to.scale);

    frames.runFor(600);
    expect(target.commitCamera).toHaveBeenCalledTimes(1);
    expect(target.commitCamera).toHaveBeenCalledWith(to);
    expect(target.applyCamera).toHaveBeenLastCalledWith(to);
    expect(target.onMovingChange).toHaveBeenLastCalledWith(false);
    expect(target.onMovingChange).toHaveBeenCalledTimes(2);
    expect(player.isRunning()).toBe(false);
    expect(frames.pending()).toBe(0);
  });

  it('measures the frame rate of a flight', () => {
    player.play(flyPlan(from, to, 1000), to);
    frames.runFor(1100, 1000 / 60);

    const statistics = player.getLastFlyStatistics()!;
    expect(statistics.fps).toBeGreaterThan(55);
    expect(statistics.fps).toBeLessThan(65);
    expect(statistics.maxFrameGapMs).toBeLessThan(20);
  });

  it('redirects a flight from the visible camera without stopping', () => {
    const other: Camera = { x: 2000, y: 9000, scale: 2 };
    player.play(flyPlan(from, to), to);
    frames.runFor(400);
    const visible = player.getVisibleCamera()!;
    target.applyCamera.mockClear();

    player.play(flyPlan(visible, other), other);
    frames.tick();

    // continues where the camera is, no jump back to the start or the old target
    const first = target.applyCamera.mock.calls[0][0] as Camera;
    expect(Math.abs(first.x - visible.x)).toBeLessThan(200);
    expect(target.onMovingChange).toHaveBeenCalledTimes(1);

    frames.runFor(1200);
    expect(target.commitCamera).toHaveBeenCalledTimes(1);
    expect(target.commitCamera).toHaveBeenCalledWith(other);
    expect(target.onMovingChange).toHaveBeenCalledTimes(2);
  });

  it('cancel stores the visible camera', () => {
    player.play(flyPlan(from, to), to);
    frames.runFor(300);
    const visible = player.getVisibleCamera()!;

    player.cancel();

    expect(target.commitCamera).toHaveBeenCalledWith(visible);
    expect(target.onMovingChange).toHaveBeenLastCalledWith(false);
    frames.runFor(2000);
    expect(target.commitCamera).toHaveBeenCalledTimes(1);
  });

  it('destroy stops without committing', () => {
    player.play(flyPlan(from, to), to);
    frames.runFor(300);
    player.destroy();
    frames.runFor(2000);
    expect(target.commitCamera).not.toHaveBeenCalled();
  });

  it('plays an overlay transition: hide, switch the camera, show', () => {
    const { element, animations } = createAnimatedElement();
    target.getOverlayElement.mockReturnValue(element);

    player.play(
      { kind: 'overlay', style: 'fade', direction: 1, outMs: 200, inMs: 300 },
      to,
    );

    expect(animations).toHaveLength(1);
    expect(animations[0].keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(animations[0].options).toMatchObject({
      duration: 200,
      fill: 'forwards',
    });
    expect(target.commitCamera).not.toHaveBeenCalled();
    expect(player.isRunning()).toBe(true);

    animations[0].finish();

    expect(target.applyCamera).toHaveBeenCalledWith(to);
    expect(target.commitCamera).toHaveBeenCalledWith(to);
    expect(animations).toHaveLength(2);
    expect(animations[1].keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(animations[1].options).toMatchObject({ duration: 300 });

    animations[1].finish();
    expect(animations[0].cancel).toHaveBeenCalled();
    expect(player.isRunning()).toBe(false);
    // overlays never hide embedded widgets
    expect(target.onMovingChange).not.toHaveBeenCalled();
  });

  it('skips the hide phase when an overlay transition is interrupted', () => {
    const { element, animations } = createAnimatedElement();
    target.getOverlayElement.mockReturnValue(element);
    const other: Camera = { x: 5, y: 5, scale: 3 };
    const plan: TransitionPlan = {
      kind: 'overlay',
      style: 'slide',
      direction: 1,
      outMs: 200,
      inMs: 300,
    };

    player.play(plan, to);
    player.play(plan, other);

    expect(animations[0].cancel).toHaveBeenCalled();
    // directly the "in" phase of the new target
    expect(target.commitCamera).toHaveBeenCalledWith(other);
    expect(animations[1].keyframes[0]).toMatchObject({ opacity: 0 });

    // the old "out" phase finishing late does nothing
    animations[0].finish();
    expect(target.commitCamera).toHaveBeenCalledTimes(1);
  });

  it('jumps if the element cannot animate', () => {
    player.play(
      { kind: 'overlay', style: 'zoom', direction: 1, outMs: 200, inMs: 300 },
      to,
    );
    expect(target.commitCamera).toHaveBeenCalledWith(to);
    expect(player.isRunning()).toBe(false);
  });

  it('ends a flight that is redirected into an overlay transition', () => {
    player.play(flyPlan(from, to), to);
    frames.runFor(300);
    player.play({ kind: 'jump' }, from);

    expect(target.onMovingChange).toHaveBeenLastCalledWith(false);
    expect(isSameCamera(player.getVisibleCamera()!, from)).toBe(true);
    frames.runFor(2000);
    expect(target.commitCamera).toHaveBeenCalledTimes(1);
  });
});
