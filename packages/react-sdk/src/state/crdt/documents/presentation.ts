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

import { ChangeFn } from '../types';
import { SharedMap, YMap } from '../y';
import type { WhiteboardDocument } from './whiteboardDocument';

/**
 * How the view moves from one frame to the next while presenting.
 *
 * - `fly`: the camera zooms out, pans and zooms in along a smooth path
 *   (like Prezi).
 * - `fade`: the view fades out and fades in on the next frame.
 * - `slide`: the view slides out to the side and the next frame slides in.
 * - `zoom`: the view zooms into the current frame while it fades out and
 *   the next frame zooms in from a distance.
 * - `none`: the view jumps to the next frame.
 */
export type PresentationTransition = 'fly' | 'fade' | 'slide' | 'zoom' | 'none';

export const presentationTransitions: PresentationTransition[] = [
  'fly',
  'fade',
  'slide',
  'zoom',
  'none',
];

/** How fast transitions play. */
export type PresentationSpeed = 'slow' | 'normal' | 'fast';

export const presentationSpeeds: PresentationSpeed[] = [
  'slow',
  'normal',
  'fast',
];

/**
 * Presentation settings of a board. They are part of the board document,
 * so everyone who watches a presentation sees the same transitions.
 */
export type PresentationSettings = {
  /** Transition used when the presentation moves to a frame. */
  transition: PresentationTransition;
  /** Playback speed of all transitions. */
  speed: PresentationSpeed;
  /**
   * Transitions that override {@link transition} when the presentation
   * moves *to* the frame with this id (like `data-transition` on a slide
   * in Reveal.js).
   */
  frameTransitions: Record<string, PresentationTransition>;
};

export const defaultPresentationSettings: PresentationSettings = {
  transition: 'fly',
  speed: 'normal',
  frameTransitions: {},
};

/**
 * The settings are stored in a shared map under the `presentation` key of the
 * board document.
 *
 * The key is optional: boards created before this feature (and boards that
 * never changed the settings) do not have it and use
 * {@link defaultPresentationSettings}. Older clients ignore the key because
 * the document schema allows unknown keys, so no document version change is
 * needed.
 *
 * Per frame overrides are stored as `frame:<frameId>` keys in the same map,
 * so the map only contains primitive values and concurrent edits of
 * different frames never conflict.
 */
export const presentationDocumentKey = 'presentation';

const frameKeyPrefix = 'frame:';

export function isPresentationTransition(
  value: unknown,
): value is PresentationTransition {
  return (
    typeof value === 'string' &&
    (presentationTransitions as string[]).includes(value)
  );
}

export function isPresentationSpeed(
  value: unknown,
): value is PresentationSpeed {
  return (
    typeof value === 'string' &&
    (presentationSpeeds as string[]).includes(value)
  );
}

function getPresentationMap(
  doc: SharedMap<WhiteboardDocument>,
): YMap<unknown> | undefined {
  const value = (doc as unknown as YMap<unknown>).get(presentationDocumentKey);
  return value instanceof YMap ? value : undefined;
}

/**
 * Read the presentation settings from the document. Missing or invalid
 * values (e.g. written by a newer client) fall back to the defaults, so a
 * broken value never blocks a presentation.
 */
export function getPresentationSettings(
  doc: SharedMap<WhiteboardDocument>,
): PresentationSettings {
  const map = getPresentationMap(doc);

  if (!map) {
    return defaultPresentationSettings;
  }

  const transition = map.get('transition');
  const speed = map.get('speed');
  const frameTransitions: Record<string, PresentationTransition> = {};

  map.forEach((value, key) => {
    if (key.startsWith(frameKeyPrefix) && isPresentationTransition(value)) {
      frameTransitions[key.slice(frameKeyPrefix.length)] = value;
    }
  });

  return {
    transition: isPresentationTransition(transition)
      ? transition
      : defaultPresentationSettings.transition,
    speed: isPresentationSpeed(speed)
      ? speed
      : defaultPresentationSettings.speed,
    frameTransitions,
  };
}

function ensurePresentationMap(
  doc: SharedMap<WhiteboardDocument>,
): YMap<unknown> {
  const existing = getPresentationMap(doc);

  if (existing) {
    return existing;
  }

  const map = new YMap<unknown>();
  (doc as unknown as YMap<unknown>).set(presentationDocumentKey, map);
  return map;
}

/** Set the transition of the presentation. */
export function generateSetPresentationTransition(
  transition: PresentationTransition,
): ChangeFn<WhiteboardDocument> {
  return (doc) => {
    ensurePresentationMap(doc).set('transition', transition);
  };
}

/** Set the playback speed of the transitions. */
export function generateSetPresentationSpeed(
  speed: PresentationSpeed,
): ChangeFn<WhiteboardDocument> {
  return (doc) => {
    ensurePresentationMap(doc).set('speed', speed);
  };
}

/**
 * Set the transition used when the presentation moves to a frame.
 * `undefined` removes the override, the frame then uses the transition of
 * the presentation.
 */
export function generateSetFrameTransition(
  frameId: string,
  transition: PresentationTransition | undefined,
): ChangeFn<WhiteboardDocument> {
  return (doc) => {
    const key = frameKeyPrefix + frameId;

    if (transition === undefined) {
      getPresentationMap(doc)?.delete(key);
    } else {
      ensurePresentationMap(doc).set(key, transition);
    }
  };
}
