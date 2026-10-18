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
  defaultPresentationSettings,
  PresentationSettings,
} from '../../../state';
import { flyTiming } from './camera';
import {
  overlayKeyframes,
  overlayTiming,
  planTransition,
  resolveOverviewTransition,
  resolveTransition,
  speedFactor,
} from './transitions';

const container = { width: 1600, height: 900 };
const settings: PresentationSettings = {
  transition: 'slide',
  speed: 'normal',
  frameTransitions: { 'frame-2': 'zoom', 'frame-3': 'none' },
};

describe('resolveTransition', () => {
  it('uses the transition of the presentation', () => {
    expect(resolveTransition(settings, 'frame-1', false)).toBe('slide');
    expect(resolveTransition(settings, undefined, false)).toBe('slide');
  });

  it('uses the override of the target frame', () => {
    expect(resolveTransition(settings, 'frame-2', false)).toBe('zoom');
    expect(resolveTransition(settings, 'frame-3', false)).toBe('none');
  });

  it('uses fly by default', () => {
    expect(resolveTransition(defaultPresentationSettings, 'x', false)).toBe(
      'fly',
    );
  });

  it.each([
    ['fly', 'fade'],
    ['slide', 'fade'],
    ['zoom', 'fade'],
    ['fade', 'fade'],
    ['none', 'none'],
  ] as const)(
    'falls back from %s to %s with reduced motion',
    (transition, expected) => {
      expect(
        resolveTransition(
          { ...defaultPresentationSettings, transition },
          'frame-1',
          true,
        ),
      ).toBe(expected);
    },
  );
});

describe('resolveOverviewTransition', () => {
  it('flies to the overview', () => {
    expect(resolveOverviewTransition(settings, false)).toBe('fly');
  });

  it('fades with reduced motion', () => {
    expect(resolveOverviewTransition(settings, true)).toBe('fade');
  });

  it('jumps if the presentation uses no transition', () => {
    expect(
      resolveOverviewTransition({ ...settings, transition: 'none' }, false),
    ).toBe('none');
  });
});

describe('speedFactor', () => {
  it('is slower for slow and faster for fast', () => {
    expect(speedFactor('slow')).toBeGreaterThan(1);
    expect(speedFactor('normal')).toBe(1);
    expect(speedFactor('fast')).toBeLessThan(1);
  });
});

describe('planTransition', () => {
  const from = { x: 1000, y: 1000, scale: 1 };
  const to = { x: 9000, y: 6000, scale: 0.5 };

  it('jumps for none, instant navigation and an unchanged camera', () => {
    const base = { from, to, container, speed: 'normal' as const };
    expect(planTransition({ ...base, transition: 'none' })).toEqual({
      kind: 'jump',
    });
    expect(
      planTransition({ ...base, transition: 'fly', instant: true }),
    ).toEqual({ kind: 'jump' });
    expect(
      planTransition({ ...base, transition: 'fade', to: { ...from } }),
    ).toEqual({ kind: 'jump' });
  });

  it('jumps without a measured container', () => {
    expect(
      planTransition({
        transition: 'fly',
        from,
        to,
        container: { width: 0, height: 0 },
        speed: 'normal',
      }),
    ).toEqual({ kind: 'jump' });
  });

  it('flies along a path with a bounded duration', () => {
    const plan = planTransition({
      transition: 'fly',
      from,
      to,
      container,
      speed: 'normal',
    });
    expect(plan.kind).toBe('fly');
    const fly = plan as Extract<typeof plan, { kind: 'fly' }>;
    expect(fly.durationMs).toBeGreaterThanOrEqual(flyTiming.minMs);
    expect(fly.durationMs).toBeLessThanOrEqual(flyTiming.maxMs);
    expect(fly.path.at(1)).toEqual(to);
  });

  it('scales the duration with the speed', () => {
    const duration = (speed: 'slow' | 'normal' | 'fast') => {
      const plan = planTransition({
        transition: 'fly',
        from,
        to,
        container,
        speed,
      });
      return plan.kind === 'fly' ? plan.durationMs : 0;
    };
    expect(duration('slow')).toBeGreaterThan(duration('normal'));
    expect(duration('fast')).toBeLessThan(duration('normal'));
  });

  it.each(['fade', 'slide', 'zoom'] as const)(
    'plays the %s overlay in two phases',
    (transition) => {
      expect(
        planTransition({
          transition,
          from,
          to,
          container,
          speed: 'fast',
          direction: -1,
        }),
      ).toEqual({
        kind: 'overlay',
        style: transition,
        direction: -1,
        outMs: overlayTiming[transition].outMs * speedFactor('fast'),
        inMs: overlayTiming[transition].inMs * speedFactor('fast'),
      });
    },
  );
});

describe('overlayKeyframes', () => {
  it.each(['fade', 'slide', 'zoom'] as const)(
    '%s only animates opacity and transform',
    (style) => {
      for (const phase of ['out', 'in'] as const) {
        const frames = overlayKeyframes(style, phase, 1);
        expect(frames).toHaveLength(2);
        for (const frame of frames) {
          expect(
            Object.keys(frame).every((k) =>
              ['opacity', 'transform'].includes(k),
            ),
          ).toBe(true);
        }
        // hides the old view, shows the new one
        expect(frames[phase === 'out' ? 1 : 0].opacity).toBe(0);
        expect(frames[phase === 'out' ? 0 : 1].opacity).toBe(1);
      }
    },
  );

  it('slides forward to the left and backward to the right', () => {
    expect(overlayKeyframes('slide', 'out', 1)[1].transform).toBe(
      'translateX(-30%)',
    );
    expect(overlayKeyframes('slide', 'in', 1)[0].transform).toBe(
      'translateX(30%)',
    );
    expect(overlayKeyframes('slide', 'out', -1)[1].transform).toBe(
      'translateX(30%)',
    );
  });

  it('zooms into the old view when moving forward', () => {
    expect(overlayKeyframes('zoom', 'out', 1)[1].transform).toBe('scale(1.35)');
    expect(overlayKeyframes('zoom', 'in', 1)[0].transform).toBe('scale(0.7)');
    expect(overlayKeyframes('zoom', 'out', -1)[1].transform).toBe('scale(0.7)');
  });
});
