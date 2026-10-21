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

import {
  hasRoomEventPower,
  PowerLevelsStateEvent,
  StateEvent,
  StateEventCreateContent,
} from '@matrix-widget-toolkit/api';
import { ROOM_EVENT_DOCUMENT_SNAPSHOT } from '../../model';
import type { StoreType } from '../store';
import { powerLevelsApi } from './powerLevelsApi';

/**
 * A user may edit a board if the room lets them send its snapshots: that is
 * the only way a change becomes durable for everybody. Users without that
 * power ("visitors") see the board read-only, and changes they push over the
 * real-time channel are ignored by every client (see
 * {@link WhiteboardEditPermission}).
 */
export function canEditWhiteboard(
  powerLevels: PowerLevelsStateEvent | undefined,
  createEvent: StateEvent<StateEventCreateContent> | undefined,
  userId: string | undefined,
): boolean {
  if (!userId) {
    return false;
  }
  return hasRoomEventPower(
    powerLevels,
    createEvent,
    userId,
    ROOM_EVENT_DOCUMENT_SNAPSHOT,
  );
}

/** Edit permission of room members, kept up to date from the room state. */
export type WhiteboardEditPermission = {
  /**
   * `true` if the user may edit the board. `false` while the power levels are
   * not loaded yet (fail closed: a dropped real-time update arrives again
   * with the next snapshot).
   */
  canEdit(userId: string): boolean;
  /** `true` once the power levels are loaded. */
  isKnown(): boolean;
  destroy(): void;
};

/**
 * Subscribes to the power levels and the create event of the room in the
 * store, so that the answer follows power level changes.
 */
export function createWhiteboardEditPermission(
  store: StoreType,
): WhiteboardEditPermission {
  const powerLevelsSubscription = store.dispatch(
    powerLevelsApi.endpoints.getPowerLevels.initiate(),
  );
  const createEventSubscription = store.dispatch(
    powerLevelsApi.endpoints.getCreateEvent.initiate(),
  );

  const read = () => {
    const state = store.getState();
    const powerLevels = powerLevelsApi.endpoints.getPowerLevels.select()(state);
    const createEvent = powerLevelsApi.endpoints.getCreateEvent.select()(state);
    return {
      loaded: powerLevels.data !== undefined && createEvent.data !== undefined,
      powerLevels: powerLevels.data?.event?.content,
      createEvent: createEvent.data?.event,
    };
  };

  return {
    canEdit(userId) {
      const { loaded, powerLevels, createEvent } = read();
      return loaded && canEditWhiteboard(powerLevels, createEvent, userId);
    },
    isKnown() {
      return read().loaded;
    },
    destroy() {
      powerLevelsSubscription.unsubscribe();
      createEventSubscription.unsubscribe();
    },
  };
}
