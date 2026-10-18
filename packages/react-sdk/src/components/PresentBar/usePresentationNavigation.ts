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

import { useCallback, useMemo } from 'react';
import { isInfiniteCanvasMode } from '../../lib';
import {
  useActiveSlideOrFrame,
  useActiveWhiteboardInstance,
  usePresentationOverview,
  useWhiteboardSlideOrFrameIds,
} from '../../state';

export type PresentationNavigation = {
  /** Index of the shown frame or slide, -1 if none. */
  index: number;
  /** Number of frames or slides. */
  count: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  goToPrevious: () => void;
  goToNext: () => void;
  goToFirst: () => void;
  goToLast: () => void;
  /**
   * Go to a frame or slide by id. In the overview, this only selects the
   * frame.
   */
  goTo: (id: string) => void;
  /** Close the overview and show the frame (infinite canvas only). */
  openFrame: (id: string) => void;
  /** The overview of all frames is shown (infinite canvas only). */
  overview: boolean;
  /** Show or hide the overview (infinite canvas only). */
  toggleOverview: () => void;
};

/**
 * Navigation of the presenter through the frames (infinite canvas) or slides.
 * In the overview, navigation selects frames (everyone sees the selection)
 * until the presenter opens one.
 */
export function usePresentationNavigation(): PresentationNavigation {
  const whiteboardInstance = useActiveWhiteboardInstance();
  const { activeId } = useActiveSlideOrFrame();
  const ids = useWhiteboardSlideOrFrameIds();
  const { overview, setOverview } = usePresentationOverview();

  const index = activeId !== undefined ? ids.indexOf(activeId) : -1;

  const goTo = useCallback(
    (id: string | undefined) => {
      if (id === undefined) {
        return;
      }

      if (isInfiniteCanvasMode()) {
        whiteboardInstance.setActiveFrameElementId(id);
      } else {
        whiteboardInstance.setActiveSlideId(id);
      }
    },
    [whiteboardInstance],
  );

  const openFrame = useCallback(
    (id: string) => {
      if (isInfiniteCanvasMode()) {
        setOverview(false, id);
      }
    },
    [setOverview],
  );

  const toggleOverview = useCallback(() => {
    if (isInfiniteCanvasMode()) {
      setOverview(!overview);
    }
  }, [overview, setOverview]);

  return useMemo(
    () => ({
      index,
      count: ids.length,
      canGoPrevious: index > 0,
      canGoNext: index !== -1 && index < ids.length - 1,
      goToPrevious: () => {
        if (index > 0) {
          goTo(ids[index - 1]);
        }
      },
      goToNext: () => {
        if (index !== -1 && index < ids.length - 1) {
          goTo(ids[index + 1]);
        }
      },
      goToFirst: () => goTo(ids[0]),
      goToLast: () => goTo(ids[ids.length - 1]),
      goTo,
      openFrame,
      overview,
      toggleOverview,
    }),
    [goTo, ids, index, openFrame, overview, toggleOverview],
  );
}
