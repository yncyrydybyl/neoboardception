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

import type { EmbeddedWidgetCapabilityLimits } from './renderer';

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

/** Capabilities that write to the room (other members see the result). */
const WRITE_CAPABILITY = /\.send\./;

/**
 * How well an embedded widget can work on this board:
 *
 * - `full`: every permission it asked for is available here.
 * - `limited`: some permissions are not available here; parts of the widget
 *   may not work.
 * - `unsupported`: the widget cannot do its job here: nothing it asked for
 *   is available, or it asked to write to the room and every one of those
 *   write permissions is unavailable.
 */
export type EmbeddedWidgetSupport = {
  level: 'full' | 'limited' | 'unsupported';
  /** Number of permissions (as the user would count them) asked for. */
  requested: number;
  /** Number of those that are not available here. */
  blocked: number;
  /** The unavailable permissions, verbatim (for details). */
  blockedCapabilities: readonly string[];
};

/**
 * Rates the permissions an embedded widget cannot get on this board (refused
 * by the deployment's policy or the board's hard limits, not by the user).
 * Client hints without meaning for the user are not counted.
 */
export function getEmbeddedWidgetSupport(
  limits: EmbeddedWidgetCapabilityLimits | undefined,
): EmbeddedWidgetSupport {
  const relevant = (list: readonly string[]) => [
    ...new Set(list.filter((c) => !HIDDEN_CAPABILITIES.includes(c))),
  ];
  const requested = relevant(limits?.requested ?? []);
  const blocked = relevant(limits?.blocked ?? []);
  const all = [...new Set([...requested, ...blocked])];
  if (blocked.length === 0) {
    return {
      level: 'full',
      requested: all.length,
      blocked: 0,
      blockedCapabilities: [],
    };
  }
  const writes = all.filter((c) => WRITE_CAPABILITY.test(c));
  const unsupported =
    blocked.length === all.length ||
    (writes.length > 0 && writes.every((c) => blocked.includes(c)));
  return {
    level: unsupported ? 'unsupported' : 'limited',
    requested: all.length,
    blocked: blocked.length,
    blockedCapabilities: blocked,
  };
}
