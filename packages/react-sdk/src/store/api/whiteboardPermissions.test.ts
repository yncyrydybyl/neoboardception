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

import { MockedWidgetApi, mockWidgetApi } from '@matrix-widget-toolkit/testing';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mockPowerLevelsEvent,
  mockRoomVersion11CreateEvent,
} from '../../lib/testUtils/matrixTestUtils';
import { createStore } from '../store';
import {
  canEditWhiteboard,
  createWhiteboardEditPermission,
} from './whiteboardPermissions';

/** Conference visitor room: moderators edit, visitors (PL 0) only view. */
const conferencePowerLevels = {
  users: { '@moderator:example.com': 50, '@admin:example.com': 100 },
  users_default: 0,
  events_default: 50,
  state_default: 50,
  events: {
    'm.room.message': 0,
    'net.nordeck.whiteboard.sessions': 0,
    'net.nordeck.whiteboard.document.snapshot': 50,
    'net.nordeck.whiteboard.document.chunk': 50,
    'net.nordeck.whiteboard.document.create': 50,
  },
};

describe('canEditWhiteboard', () => {
  it('allows users who may send snapshots', () => {
    expect(
      canEditWhiteboard(
        conferencePowerLevels,
        undefined,
        '@moderator:example.com',
      ),
    ).toBe(true);
    expect(
      canEditWhiteboard(conferencePowerLevels, undefined, '@admin:example.com'),
    ).toBe(true);
  });

  it('denies visitors and unknown users', () => {
    expect(
      canEditWhiteboard(
        conferencePowerLevels,
        undefined,
        '@visitor:example.com',
      ),
    ).toBe(false);
    expect(canEditWhiteboard(conferencePowerLevels, undefined, '')).toBe(false);
    expect(canEditWhiteboard(conferencePowerLevels, undefined, undefined)).toBe(
      false,
    );
  });

  it('follows events_default when the snapshot event is not listed', () => {
    expect(
      canEditWhiteboard(
        { users_default: 0, events_default: 0 },
        undefined,
        '@anyone:example.com',
      ),
    ).toBe(true);
  });
});

describe('createWhiteboardEditPermission', () => {
  let widgetApi: MockedWidgetApi;

  beforeEach(() => {
    widgetApi = mockWidgetApi();
  });

  afterEach(() => widgetApi.stop());

  it('is unknown and denies until the power levels are loaded', () => {
    const store = createStore({ widgetApi });
    const permission = createWhiteboardEditPermission(store);

    expect(permission.isKnown()).toBe(false);
    expect(permission.canEdit('@moderator:example.com')).toBe(false);

    permission.destroy();
  });

  it('answers from the room power levels and follows changes', async () => {
    widgetApi.mockSendStateEvent(mockRoomVersion11CreateEvent());
    widgetApi.mockSendStateEvent(
      mockPowerLevelsEvent({ content: conferencePowerLevels }),
    );
    const store = createStore({ widgetApi });
    const permission = createWhiteboardEditPermission(store);

    await waitFor(() => expect(permission.isKnown()).toBe(true));
    expect(permission.canEdit('@moderator:example.com')).toBe(true);
    expect(permission.canEdit('@visitor:example.com')).toBe(false);

    widgetApi.mockSendStateEvent(
      mockPowerLevelsEvent({
        content: {
          ...conferencePowerLevels,
          users: {
            ...conferencePowerLevels.users,
            '@visitor:example.com': 50,
          },
        },
      }),
    );

    await waitFor(() =>
      expect(permission.canEdit('@visitor:example.com')).toBe(true),
    );

    permission.destroy();
  });
});
