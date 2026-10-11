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

const EVENT_CAPABILITY =
  /^org\.matrix\.msc2762\.(send|receive)\.(event|state_event):([^#]*)(?:#(.*))?$/;

/** Capabilities without meaning for the user (client hints). */
const HIDDEN_CAPABILITIES = ['io.element.requires_client'];

export type CapabilityGroups = {
  /** The widget reads the room's member list (personal data). */
  readsMembers: boolean;
  /** Event types the widget reads (without `m.room.member`). */
  read: string[];
  /** Event types the widget writes; other room members see these. */
  write: string[];
  /** Capabilities that are not about room events, verbatim. */
  other: string[];
};

/**
 * Groups Widget API capability strings into what a user can judge: which
 * room data a widget reads, which it writes, and whether it reads the member
 * list. Event types are listed once per group, without state keys.
 */
export function groupCapabilities(
  capabilities: readonly string[],
): CapabilityGroups {
  const read = new Set<string>();
  const write = new Set<string>();
  const other = new Set<string>();
  let readsMembers = false;

  for (const capability of capabilities) {
    if (HIDDEN_CAPABILITIES.includes(capability)) {
      continue;
    }
    const match = EVENT_CAPABILITY.exec(capability);
    if (!match) {
      other.add(capability);
      continue;
    }
    const [, direction, , eventType] = match;
    if (direction === 'send') {
      write.add(eventType);
    } else if (eventType === 'm.room.member') {
      readsMembers = true;
    } else {
      read.add(eventType);
    }
  }

  return {
    readsMembers,
    read: [...read].sort(),
    write: [...write].sort(),
    other: [...other].sort(),
  };
}
