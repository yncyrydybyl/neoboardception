/*
 * Copyright 2024 Nordeck IT + Consulting GmbH
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

import React, { useCallback } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { isInfiniteCanvasMode } from '../../../lib';
import { useActiveElements, usePresentationMode } from '../../../state';
import { usePresentationNavigation } from '../../PresentBar/usePresentationNavigation';
import { presentationHotkeys, presentationKeyAction } from './presentationKeys';

export const PresentationShortcuts: React.FC = function () {
  const { state } = usePresentationMode();
  const navigation = usePresentationNavigation();
  const { activeElementIds } = useActiveElements();

  const handleHotkey = useCallback(
    (event: KeyboardEvent) => {
      const action = presentationKeyAction(
        event,
        isInfiniteCanvasMode(),
        navigation.overview,
      );

      switch (action) {
        case 'next':
          navigation.goToNext();
          break;
        case 'previous':
          navigation.goToPrevious();
          break;
        case 'first':
          navigation.goToFirst();
          break;
        case 'last':
          navigation.goToLast();
          break;
        case 'toggleOverview':
          navigation.toggleOverview();
          break;
        case 'closeOverview':
          if (navigation.overview) {
            navigation.toggleOverview();
          }
          break;
        default:
          return;
      }

      event.preventDefault();
    },
    [navigation],
  );

  useHotkeys(presentationHotkeys, handleHotkey, {
    enabled: state.type === 'presenting' && activeElementIds.length === 0,
    useKey: true,
  });

  return null;
};
