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
import { presentationKeyAction } from './presentationKeys';

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe('presentationKeyAction', () => {
  it.each(['ArrowRight', 'ArrowDown', 'PageDown', ' '])(
    '%j goes to the next frame',
    (k) => {
      expect(presentationKeyAction(key(k), true, false)).toBe('next');
    },
  );

  it.each(['ArrowLeft', 'ArrowUp', 'PageUp'])(
    '%j goes to the previous frame',
    (k) => {
      expect(presentationKeyAction(key(k), true, false)).toBe('previous');
    },
  );

  it('shift+space goes back', () => {
    expect(
      presentationKeyAction(key(' ', { shiftKey: true }), true, false),
    ).toBe('previous');
  });

  it('Home and End jump to the first and last frame', () => {
    expect(presentationKeyAction(key('Home'), true, false)).toBe('first');
    expect(presentationKeyAction(key('End'), false, false)).toBe('last');
  });

  it.each(['o', 'O', 'Escape'])('%j toggles the overview', (k) => {
    expect(presentationKeyAction(key(k), true, false)).toBe('toggleOverview');
    expect(presentationKeyAction(key(k), true, true)).toBe('toggleOverview');
  });

  it('has no overview in the slide mode', () => {
    expect(presentationKeyAction(key('o'), false, false)).toBeUndefined();
    expect(presentationKeyAction(key('Escape'), false, false)).toBeUndefined();
  });

  it('Enter opens the selected frame only in the overview', () => {
    expect(presentationKeyAction(key('Enter'), true, true)).toBe(
      'closeOverview',
    );
    expect(presentationKeyAction(key('Enter'), true, false)).toBeUndefined();
  });

  it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }])(
    'ignores keys with modifiers %j',
    (mods) => {
      expect(
        presentationKeyAction(key('ArrowRight', mods), true, false),
      ).toBeUndefined();
    },
  );

  it('ignores other keys', () => {
    expect(presentationKeyAction(key('x'), true, false)).toBeUndefined();
  });
});
