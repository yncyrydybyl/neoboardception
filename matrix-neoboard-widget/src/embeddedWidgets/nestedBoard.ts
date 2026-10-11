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

// NeoBoard inside NeoBoard ("nested board"), both sides:
//
// - the embedded board drops the capabilities an embedded widget never gets,
//   so it does not end up on "missing capabilities";
// - the hosting board prepares the power levels of the embedded board's
//   session type (the embedded board cannot change power levels itself).

import {
  calculateUserPowerLevel,
  hasStateEventPower,
  PowerLevelsStateEvent,
  STATE_EVENT_CREATE,
  STATE_EVENT_POWER_LEVELS,
  StateEvent,
  StateEventCreateContent,
  WidgetApi,
} from '@matrix-widget-toolkit/api';
import { STATE_EVENT_WHITEBOARD_SESSIONS } from '@nordeck/matrix-neoboard-react-sdk';
import type { EventNamespaceMap } from '@nordeck/matrix-widget-mediation/policy';
import { EventTypeRewriter } from '@nordeck/matrix-widget-mediation/policy';
import loglevel from 'loglevel';
import type { WidgetEventCapability } from 'matrix-widget-api';

/**
 * Capabilities an embedded board does not request: the mediator never
 * grants them (power levels, TURN, media up-/download), and the toolkit
 * would otherwise show "missing capabilities". Exact strings, also read by
 * `neoboardception-docs/examples/generate-lifecycle-config.mjs`.
 */
export const EMBEDDED_BOARD_OMITTED_CAPABILITIES: readonly string[] = [
  'org.matrix.msc2762.send.state_event:m.room.power_levels#',
  'town.robin.msc3846.turn_servers',
  'org.matrix.msc4039.upload_file',
  'org.matrix.msc4039.download_file',
];

type Capability = WidgetEventCapability | string;
const raw = (c: Capability) => (typeof c === 'string' ? c : c.raw);

/** The board's capabilities when it runs embedded in another board. */
export function capabilitiesForEmbeddedBoard<T extends Capability>(
  capabilities: readonly T[],
): T[] {
  return capabilities.filter(
    (c) => !EMBEDDED_BOARD_OMITTED_CAPABILITIES.includes(raw(c)),
  );
}

/**
 * The embedded board's session state type in the room, if `namespace`
 * rewrites the board's own events (`undefined` otherwise).
 */
export function nestedSessionsType(
  namespace: EventNamespaceMap | undefined,
): string | undefined {
  if (!namespace) return undefined;
  const rewritten = new EventTypeRewriter(namespace).up(
    STATE_EVENT_WHITEBOARD_SESSIONS,
  );
  return rewritten && rewritten !== STATE_EVENT_WHITEBOARD_SESSIONS
    ? rewritten
    : undefined;
}

const prepared = new Set<string>();

/**
 * Lets every member write their own session state of an embedded board
 * (power level 0 for its session type), like the board does for its own
 * session type when it is created. Without it only moderators of the room
 * get presence and live cursors in the embedded board.
 *
 * Runs only if the namespace rewrites the board's events, the entry is
 * missing, the board holds the capability and the user may change power
 * levels. Once per type and session; failures are logged.
 */
export async function prepareNestedBoardPowerLevels(
  widgetApi: WidgetApi,
  namespace: EventNamespaceMap | undefined,
): Promise<'updated' | 'present' | 'skipped'> {
  const sessionsType = nestedSessionsType(namespace);
  if (!sessionsType || prepared.has(sessionsType)) return 'skipped';
  const userId = widgetApi.widgetParameters.userId;
  if (
    !userId ||
    !widgetApi.hasCapabilities([
      `org.matrix.msc2762.send.state_event:${STATE_EVENT_POWER_LEVELS}#`,
    ])
  ) {
    return 'skipped';
  }
  try {
    const [powerLevels] = await widgetApi.receiveStateEvents(
      STATE_EVENT_POWER_LEVELS,
      { stateKey: '' },
    );
    const [create] = await widgetApi.receiveStateEvents(STATE_EVENT_CREATE, {
      stateKey: '',
    });
    const content = powerLevels?.content as PowerLevelsStateEvent | undefined;
    if (!content) return 'skipped';
    if (content.events?.[sessionsType] !== undefined) {
      prepared.add(sessionsType);
      return 'present';
    }
    const createEvent = create as StateEvent<StateEventCreateContent>;
    if (
      !hasStateEventPower(
        content,
        createEvent,
        userId,
        STATE_EVENT_POWER_LEVELS,
      )
    ) {
      loglevel.debug(
        'Cannot prepare power levels of the embedded board (no permission)',
        { level: calculateUserPowerLevel(content, createEvent, userId) },
      );
      return 'skipped';
    }
    await widgetApi.sendStateEvent(STATE_EVENT_POWER_LEVELS, {
      ...content,
      events: { ...(content.events ?? {}), [sessionsType]: 0 },
    });
    prepared.add(sessionsType);
    return 'updated';
  } catch (error) {
    loglevel.warn(
      'Could not prepare power levels of the embedded board',
      error,
    );
    return 'skipped';
  }
}

/** Test helper. */
export function resetPreparedNestedBoards(): void {
  prepared.clear();
}
