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

import type { WidgetApi } from '@matrix-widget-toolkit/api';
import { NESTED_NAMESPACE_ROOT } from '@nordeck/matrix-widget-mediation';
import { afterEach, describe, expect, it, Mock, vi } from 'vitest';
import { widgetCapabilities } from '../widgetCapabilities';
import {
  capabilitiesForEmbeddedBoard,
  EMBEDDED_BOARD_OMITTED_CAPABILITIES,
  nestedSessionsType,
  prepareNestedBoardPowerLevels,
  resetPreparedNestedBoards,
} from './nestedBoard';

const NS = {
  'net.nordeck.whiteboard': `${NESTED_NAMESPACE_ROOT}net.nordeck.whiteboard`,
};
const SESSIONS = `${NESTED_NAMESPACE_ROOT}net.nordeck.whiteboard.sessions`;
const PL_SEND = 'org.matrix.msc2762.send.state_event:m.room.power_levels#';

afterEach(() => resetPreparedNestedBoards());

describe('capabilitiesForEmbeddedBoard', () => {
  it('drops exactly the capabilities an embedded widget never gets', () => {
    const raw = (c: unknown) =>
      typeof c === 'string' ? c : (c as { raw: string }).raw;
    const all = widgetCapabilities.map(raw);
    const reduced = capabilitiesForEmbeddedBoard(widgetCapabilities).map(raw);
    // Every omitted entry exists in the board's list (no stale strings).
    for (const c of EMBEDDED_BOARD_OMITTED_CAPABILITIES) {
      expect(all).toContain(c);
      expect(reduced).not.toContain(c);
    }
    expect(reduced).toHaveLength(
      all.length - EMBEDDED_BOARD_OMITTED_CAPABILITIES.length,
    );
  });
});

describe('nestedSessionsType', () => {
  it('is the rewritten session type, or undefined without a rewrite', () => {
    expect(nestedSessionsType(NS)).toBe(SESSIONS);
    expect(nestedSessionsType(undefined)).toBeUndefined();
    expect(
      nestedSessionsType({ 'net.other': `${NESTED_NAMESPACE_ROOT}net.other` }),
    ).toBeUndefined();
  });
});

describe('prepareNestedBoardPowerLevels', () => {
  type FakeApi = WidgetApi & { sendStateEvent: Mock; hasCapabilities: Mock };

  function setup(level: number, events: Record<string, number> = {}) {
    const powerLevels = {
      type: 'm.room.power_levels',
      state_key: '',
      sender: '@user-id:example.com',
      event_id: '$pl',
      room_id: '!room-id:example.com',
      origin_server_ts: 0,
      content: {
        users: { '@user-id:example.com': level },
        state_default: 50,
        events: { 'm.room.power_levels': 100, ...events },
      },
    };
    return {
      widgetParameters: { userId: '@user-id:example.com' },
      hasCapabilities: vi.fn((caps: unknown[]) =>
        caps.every((c) => c === PL_SEND),
      ),
      receiveStateEvents: vi.fn(async (type: string) =>
        type === 'm.room.power_levels' ? [powerLevels] : [],
      ),
      sendStateEvent: vi.fn(async () => ({})),
    } as unknown as FakeApi;
  }

  it('sets level 0 for the embedded session type as a room admin', async () => {
    const widgetApi = setup(100, { 'net.nordeck.whiteboard.sessions': 0 });
    await expect(prepareNestedBoardPowerLevels(widgetApi, NS)).resolves.toBe(
      'updated',
    );
    expect(widgetApi.sendStateEvent).toHaveBeenCalledWith(
      'm.room.power_levels',
      expect.objectContaining({
        events: {
          'm.room.power_levels': 100,
          'net.nordeck.whiteboard.sessions': 0,
          [SESSIONS]: 0,
        },
      }),
    );
    // Once per session.
    await expect(prepareNestedBoardPowerLevels(widgetApi, NS)).resolves.toBe(
      'skipped',
    );
  });

  it('does nothing without permission, without a namespace or when present', async () => {
    const member = setup(0);
    await expect(prepareNestedBoardPowerLevels(member, NS)).resolves.toBe(
      'skipped',
    );
    await expect(
      prepareNestedBoardPowerLevels(setup(100), undefined),
    ).resolves.toBe('skipped');
    const present = setup(100, { [SESSIONS]: 0 });
    await expect(prepareNestedBoardPowerLevels(present, NS)).resolves.toBe(
      'present',
    );
    for (const api of [member, present]) {
      expect(api.sendStateEvent).not.toHaveBeenCalled();
    }
  });

  it('does nothing if the board does not hold the power levels capability', async () => {
    const widgetApi = setup(100);
    widgetApi.hasCapabilities.mockReturnValue(false);
    await expect(prepareNestedBoardPowerLevels(widgetApi, NS)).resolves.toBe(
      'skipped',
    );
    expect(widgetApi.sendStateEvent).not.toHaveBeenCalled();
  });
});
