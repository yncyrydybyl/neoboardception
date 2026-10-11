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
import {
  getEmbeddedWidgetSupport,
  groupCapabilities,
} from './describeCapabilities';

describe('groupCapabilities', () => {
  it('groups read and write event types and flags the member list', () => {
    expect(
      groupCapabilities([
        'org.matrix.msc2762.send.event:net.example.vote',
        'org.matrix.msc2762.receive.event:net.example.vote',
        'org.matrix.msc2762.send.state_event:net.example.poll',
        'org.matrix.msc2762.receive.state_event:net.example.poll#key',
        'org.matrix.msc2762.receive.state_event:m.room.member',
        'org.matrix.msc2762.receive.state_event:m.room.name',
        'io.element.requires_client',
        'org.matrix.msc4039.upload_file',
      ]),
    ).toEqual({
      readsMembers: true,
      read: ['m.room.name', 'net.example.poll', 'net.example.vote'],
      write: ['net.example.poll', 'net.example.vote'],
      other: ['org.matrix.msc4039.upload_file'],
    });
  });

  it('returns empty groups for no capabilities', () => {
    expect(groupCapabilities([])).toEqual({
      readsMembers: false,
      read: [],
      write: [],
      other: [],
    });
  });
});

describe('getEmbeddedWidgetSupport', () => {
  const SEND_VOTE = 'org.matrix.msc2762.send.event:net.example.vote';
  const READ_VOTE = 'org.matrix.msc2762.receive.event:net.example.vote';
  const SEND_STATE = 'org.matrix.msc2762.send.state_event:net.example.poll';
  const TO_DEVICE = 'org.matrix.msc3819.send.to_device:net.example.signal';

  it('is full without limits or blocked permissions', () => {
    expect(getEmbeddedWidgetSupport(undefined)).toEqual({
      level: 'full',
      requested: 0,
      blocked: 0,
      blockedCapabilities: [],
    });
    expect(
      getEmbeddedWidgetSupport({ requested: [SEND_VOTE], blocked: [] }),
    ).toMatchObject({ level: 'full', requested: 1, blocked: 0 });
  });

  it('is limited while some write permission remains', () => {
    expect(
      getEmbeddedWidgetSupport({
        requested: [SEND_VOTE, READ_VOTE, TO_DEVICE],
        blocked: [TO_DEVICE],
      }),
    ).toEqual({
      level: 'limited',
      requested: 3,
      blocked: 1,
      blockedCapabilities: [TO_DEVICE],
    });
  });

  it('is unsupported when every write permission is blocked', () => {
    expect(
      getEmbeddedWidgetSupport({
        requested: [SEND_VOTE, SEND_STATE, READ_VOTE],
        blocked: [SEND_VOTE, SEND_STATE],
      }),
    ).toMatchObject({ level: 'unsupported', requested: 3, blocked: 2 });
  });

  it('is unsupported when everything is blocked', () => {
    expect(
      getEmbeddedWidgetSupport({
        requested: [READ_VOTE],
        blocked: [READ_VOTE],
      }),
    ).toMatchObject({ level: 'unsupported', requested: 1, blocked: 1 });
  });

  it('ignores client hints and counts blocked entries as requested', () => {
    expect(
      getEmbeddedWidgetSupport({
        requested: ['io.element.requires_client', SEND_VOTE],
        blocked: ['io.element.requires_client', READ_VOTE],
      }),
    ).toMatchObject({ level: 'limited', requested: 2, blocked: 1 });
  });
});
