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

import { useMemo } from 'react';
import { useObservable } from 'react-use';
import { of } from 'rxjs';
import {
  PresentationSettings,
  PresentationSpeed,
  PresentationTransition,
} from './crdt';
import { useActiveWhiteboardInstance } from './useActiveWhiteboardInstance';

type UsePresentationSettings = {
  settings: PresentationSettings;
  setTransition: (transition: PresentationTransition) => void;
  setSpeed: (speed: PresentationSpeed) => void;
  setFrameTransition: (
    frameElementId: string,
    transition: PresentationTransition | undefined,
  ) => void;
  /** Remove the overrides of all frames. */
  clearFrameTransitions: () => void;
};

/** Presentation settings (transitions) of the active whiteboard. */
export function usePresentationSettings(): UsePresentationSettings {
  const whiteboardInstance = useActiveWhiteboardInstance();

  const observable = useMemo(
    () => whiteboardInstance.observePresentationSettings(),
    [whiteboardInstance],
  );
  const settings = useObservable(
    observable,
    whiteboardInstance.getPresentationSettings(),
  );

  return useMemo(
    () => ({
      settings,
      setTransition: (transition) =>
        whiteboardInstance.setPresentationTransition(transition),
      setSpeed: (speed) => whiteboardInstance.setPresentationSpeed(speed),
      setFrameTransition: (frameElementId, transition) =>
        whiteboardInstance.setFrameTransition(frameElementId, transition),
      clearFrameTransitions: () => whiteboardInstance.clearFrameTransitions(),
    }),
    [settings, whiteboardInstance],
  );
}

type UsePresentationOverview = {
  /** The presentation shows the overview of all frames. */
  overview: boolean;
  /**
   * Show or hide the overview (presenter only).
   *
   * @param frameElementId - if set, the presentation moves to this frame
   */
  setOverview: (overview: boolean, frameElementId?: string) => void;
};

/** Overview state of the presentation on the active whiteboard. */
export function usePresentationOverview(): UsePresentationOverview {
  const whiteboardInstance = useActiveWhiteboardInstance();
  const presentationManager = whiteboardInstance.getPresentationManager();

  const observable = useMemo(
    () => presentationManager?.observeOverview() ?? of(false),
    [presentationManager],
  );
  const overview = useObservable(
    observable,
    presentationManager?.isOverview() ?? false,
  );

  return useMemo(
    () => ({
      overview,
      setOverview: (value, frameElementId) =>
        presentationManager?.setOverview(value, frameElementId),
    }),
    [overview, presentationManager],
  );
}
