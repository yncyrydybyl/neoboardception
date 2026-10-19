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
import { YMap } from '../y';
import {
  defaultPresentationSettings,
  generateClearFrameTransitions,
  generateSetFrameTransition,
  generateSetPresentationSpeed,
  generateSetPresentationTransition,
  getPresentationSettings,
  isPresentationSpeed,
  isPresentationTransition,
} from './presentation';
import {
  createWhiteboardDocument,
  isValidWhiteboardDocument,
  isValidWhiteboardDocumentSnapshot,
  WhiteboardDocumentVersion,
} from './whiteboardDocument';

describe('presentation settings in the board document', () => {
  it('uses the defaults for a board without settings', () => {
    const document = createWhiteboardDocument(WhiteboardDocumentVersion.v1);

    expect(getPresentationSettings(document.getData())).toEqual(
      defaultPresentationSettings,
    );
    expect(defaultPresentationSettings).toEqual({
      transition: 'fly',
      speed: 'normal',
      frameTransitions: {},
    });
  });

  it('stores transition, speed and frame overrides', () => {
    const document = createWhiteboardDocument(WhiteboardDocumentVersion.v1);

    document.performChange(generateSetPresentationTransition('slide'));
    document.performChange(generateSetPresentationSpeed('fast'));
    document.performChange(generateSetFrameTransition('frame-1', 'zoom'));
    document.performChange(generateSetFrameTransition('frame-2', 'none'));

    expect(getPresentationSettings(document.getData())).toEqual({
      transition: 'slide',
      speed: 'fast',
      frameTransitions: { 'frame-1': 'zoom', 'frame-2': 'none' },
    });
  });

  it('removes a frame override', () => {
    const document = createWhiteboardDocument(WhiteboardDocumentVersion.v1);
    document.performChange(generateSetFrameTransition('frame-1', 'zoom'));

    document.performChange(generateSetFrameTransition('frame-1', undefined));

    expect(
      getPresentationSettings(document.getData()).frameTransitions,
    ).toEqual({});
  });

  it('removing an override without settings does not create them', () => {
    const document = createWhiteboardDocument(WhiteboardDocumentVersion.v1);

    document.performChange(generateSetFrameTransition('frame-1', undefined));

    expect(document.getData().toJSON()).not.toHaveProperty('presentation');
  });

  it('removes the overrides of all frames and keeps the other settings', () => {
    const document = createWhiteboardDocument(WhiteboardDocumentVersion.v1);
    document.performChange(generateSetPresentationTransition('slide'));
    document.performChange(generateSetPresentationSpeed('fast'));
    document.performChange(generateSetFrameTransition('frame-1', 'zoom'));
    document.performChange(generateSetFrameTransition('frame-2', 'none'));
    document.performChange((doc) => {
      // an override that this client does not understand
      const map = (doc as unknown as YMap<unknown>).get(
        'presentation',
      ) as YMap<unknown>;
      map.set('frame:frame-3', 'warp');
    });

    document.performChange(generateClearFrameTransitions());

    expect(getPresentationSettings(document.getData())).toEqual({
      transition: 'slide',
      speed: 'fast',
      frameTransitions: {},
    });
    expect(document.getData().toJSON()).toMatchObject({
      presentation: { transition: 'slide', speed: 'fast' },
    });
    expect(
      Object.keys(
        (document.getData().toJSON() as unknown as { presentation: object })
          .presentation,
      ),
    ).toEqual(['transition', 'speed']);
  });

  it('removing all overrides without settings does not create them', () => {
    const document = createWhiteboardDocument(WhiteboardDocumentVersion.v1);

    document.performChange(generateClearFrameTransitions());

    expect(document.getData().toJSON()).not.toHaveProperty('presentation');
  });

  it('falls back to the defaults for invalid values (e.g. from newer clients)', () => {
    const document = createWhiteboardDocument(WhiteboardDocumentVersion.v1);
    document.performChange((doc) => {
      const map = new YMap<unknown>();
      map.set('transition', 'cube');
      map.set('speed', 42);
      map.set('frame:frame-1', 'warp');
      map.set('frame:frame-2', 'fade');
      map.set('unknown', 'x');
      (doc as unknown as YMap<unknown>).set('presentation', map);
    });

    expect(getPresentationSettings(document.getData())).toEqual({
      transition: 'fly',
      speed: 'normal',
      frameTransitions: { 'frame-2': 'fade' },
    });
  });

  it('ignores a presentation key that is not a map', () => {
    const document = createWhiteboardDocument(WhiteboardDocumentVersion.v1);
    document.performChange((doc) => {
      (doc as unknown as YMap<unknown>).set('presentation', 'fly');
    });

    expect(getPresentationSettings(document.getData())).toEqual(
      defaultPresentationSettings,
    );
  });

  it.each([WhiteboardDocumentVersion.v0, WhiteboardDocumentVersion.v1])(
    'keeps documents of version %s valid (older clients accept them)',
    (version) => {
      const document = createWhiteboardDocument(version);
      document.performChange(generateSetPresentationTransition('zoom'));
      document.performChange(generateSetFrameTransition('frame-1', 'fade'));

      expect(isValidWhiteboardDocument(document)).toBe(true);
      expect(isValidWhiteboardDocumentSnapshot(document.store())).toBe(true);
    },
  );

  it('merges concurrent changes of different frames', () => {
    const a = createWhiteboardDocument(WhiteboardDocumentVersion.v1);
    a.performChange(generateSetPresentationTransition('fly'));
    const b = createWhiteboardDocument(WhiteboardDocumentVersion.v1);
    b.mergeFrom(a.store());

    a.performChange(generateSetFrameTransition('frame-1', 'zoom'));
    b.performChange(generateSetFrameTransition('frame-2', 'slide'));
    a.mergeFrom(b.store());
    b.mergeFrom(a.store());

    const expected = { 'frame-1': 'zoom', 'frame-2': 'slide' };
    expect(getPresentationSettings(a.getData()).frameTransitions).toEqual(
      expected,
    );
    expect(getPresentationSettings(b.getData()).frameTransitions).toEqual(
      expected,
    );
  });

  it('changes made with undoable: false are not undone', () => {
    const document = createWhiteboardDocument(WhiteboardDocumentVersion.v1);
    document.performChange(generateSetPresentationTransition('fade'), {
      undoable: false,
    });

    document.getUndoManager().undo();

    expect(getPresentationSettings(document.getData()).transition).toBe('fade');
  });

  it('validates transitions and speeds', () => {
    expect(isPresentationTransition('fly')).toBe(true);
    expect(isPresentationTransition('none')).toBe(true);
    expect(isPresentationTransition('cube')).toBe(false);
    expect(isPresentationTransition(undefined)).toBe(false);
    expect(isPresentationSpeed('slow')).toBe(true);
    expect(isPresentationSpeed('ludicrous')).toBe(false);
  });
});
