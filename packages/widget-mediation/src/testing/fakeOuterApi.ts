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

import { EventEmitter } from 'events';
import type { IWidgetApiRequest } from 'matrix-widget-api';
import { vi } from 'vitest';
import type { OuterWidgetApi } from '../types';

type Handler = (data: Record<string, unknown>) => unknown;

/**
 * Stand-in for the host widget's outer WidgetApi plus the client above it
 * (Element). Capability decisions are made by `decide`, mimicking the user
 * in Element's dialog.
 */
export class FakeOuterApi extends EventEmitter implements OuterWidgetApi {
  readonly requested: string[];
  readonly approved: Set<string>;
  /** Full capability lists sent with each MSC2974 renegotiation. */
  readonly renegotiations: string[][] = [];
  decide: (newly: string[]) => string[] = (newly) => newly;
  /** Delay before the "user" answers (ms). */
  answerDelayMs = 0;
  /** Do not answer renegotiations at all. */
  silent = false;
  readonly handlers: Record<string, Handler> = {};
  private seq = 0;

  readonly transport = {
    widgetId: 'host-widget-id',
    send: vi.fn(async (action: string, data: Record<string, unknown>) => {
      const handler = this.handlers[action];
      if (!handler) throw new Error(`unexpected upward action ${action}`);
      return handler(data);
    }),
    reply: vi.fn(),
  };

  constructor(initial: string[] = []) {
    super();
    this.requested = [...initial];
    this.approved = new Set(initial);
    this.initialApproved = [...initial];
    this.handlers['send_event'] = (d) => ({
      room_id: (d.room_id as string) ?? '!room:example.org',
      event_id: `$event${++this.seq}`,
    });
  }

  requestCapabilities = vi.fn((caps: string[]) => {
    this.requested.push(...caps);
  });

  updateRequestedCapabilities = vi.fn(async () => {
    const all = [...this.requested];
    this.renegotiations.push(all);
    if (this.silent) return;
    const newly = all.filter((c) => !this.approved.has(c));
    setTimeout(() => {
      this.decide(newly).forEach((c) => this.approved.add(c));
      this.toWidget('notify_capabilities', {
        requested: newly,
        approved: [...this.approved],
      });
    }, this.answerDelayMs);
  });

  /** Only reflects the initial handshake, like matrix-widget-api. */
  hasCapability = (cap: string) => this.initialApproved.includes(cap);
  private readonly initialApproved: string[];

  /** Simulates a to-widget request from the client (Element). */
  toWidget(action: string, data: unknown): CustomEvent<IWidgetApiRequest> {
    const ev = new CustomEvent<IWidgetApiRequest>(`action:${action}`, {
      detail: {
        api: 'toWidget',
        widgetId: 'host-widget-id',
        requestId: `req-${++this.seq}`,
        action,
        data,
      } as unknown as IWidgetApiRequest,
      cancelable: true,
    });
    this.emit(`action:${action}`, ev);
    return ev;
  }
}
