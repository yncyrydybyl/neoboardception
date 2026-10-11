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
import { groupCapabilities } from './describeCapabilities';

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
