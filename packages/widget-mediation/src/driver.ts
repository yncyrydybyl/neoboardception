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

import type {
  Capability,
  IOpenIDUpdate,
  IReadEventRelationsResult,
  IRoomEvent,
  IRtcTransportsResult,
  ISendDelayedEventDetails,
  ISendEventDetails,
  SimpleObservable,
} from 'matrix-widget-api';
import { UpdateDelayedEventAction, WidgetDriver } from 'matrix-widget-api';
import type { RtcBridge } from './rtcBridge';

/** What the driver delegates to (implemented by the embedded widget). */
export interface DriverHost {
  validateCapabilities(requested: Set<Capability>): Promise<Set<Capability>>;
  sendEvent(
    eventType: string,
    content: unknown,
    stateKey: string | null,
    roomId: string | null,
  ): Promise<ISendEventDetails>;
  readEventRelations(
    eventId: string,
    roomId: string | undefined,
    relationType: string | undefined,
    eventType: string | undefined,
    from: string | undefined,
    to: string | undefined,
    limit: number | undefined,
    direction: 'f' | 'b' | undefined,
  ): Promise<IReadEventRelationsResult>;
  readRoomState(
    roomId: string,
    eventType: string,
    stateKey: string | undefined,
  ): Promise<IRoomEvent[]>;
  readRoomTimeline(
    roomId: string,
    eventType: string,
    msgtype: string | undefined,
    stateKey: string | undefined,
    limit: number,
    since: string | undefined,
  ): Promise<IRoomEvent[]>;
  /** To-device messages (only for namespaced types, see `namespace.ts`). */
  sendToDevice(
    eventType: string,
    encrypted: boolean,
    contentMap: Record<string, Record<string, object>>,
  ): Promise<void>;
  /** OpenID requests (blocked unless the host forwards them). */
  askOpenID(observer: SimpleObservable<IOpenIDUpdate>): void;
  readonly roomId: string;
  /**
   * MatrixRTC forwarding (delayed/sticky events, to-device, RTC transports).
   * Only set for widgets the operator opted in; otherwise these keep the
   * library default (rejected).
   */
  readonly rtc?: RtcBridge;
}

function notAvailable(): never {
  throw new Error('Not available for embedded widgets');
}

/**
 * `WidgetDriver` for an embedded widget: every decision is delegated to the
 * mediator, which forwards upward through the host's outer WidgetApi.
 * Everything not overridden keeps the library default (rejected or no-op):
 * navigation, media, TURN, user directory. To-device, delayed and sticky
 * events and RTC transports are only forwarded for MatrixRTC widgets
 * (`host.rtc`). OpenID is blocked unless the host enables forwarding.
 */
export class ForwardingDriver extends WidgetDriver {
  constructor(private readonly host: DriverHost) {
    super();
  }

  validateCapabilities(requested: Set<Capability>): Promise<Set<Capability>> {
    return this.host.validateCapabilities(requested);
  }

  sendEvent(
    eventType: string,
    content: unknown,
    stateKey: string | null = null,
    roomId: string | null = null,
  ): Promise<ISendEventDetails> {
    return this.host.sendEvent(eventType, content, stateKey, roomId);
  }

  readEventRelations(
    eventId: string,
    roomId?: string,
    relationType?: string,
    eventType?: string,
    from?: string,
    to?: string,
    limit?: number,
    direction?: 'f' | 'b',
  ): Promise<IReadEventRelationsResult> {
    return this.host.readEventRelations(
      eventId,
      roomId,
      relationType,
      eventType,
      from,
      to,
      limit,
      direction,
    );
  }

  readRoomState(
    roomId: string,
    eventType: string,
    stateKey: string | undefined,
  ): Promise<IRoomEvent[]> {
    return this.host.readRoomState(roomId, eventType, stateKey);
  }

  readRoomTimeline(
    roomId: string,
    eventType: string,
    msgtype: string | undefined,
    stateKey: string | undefined,
    limit: number,
    since: string | undefined,
  ): Promise<IRoomEvent[]> {
    return this.host.readRoomTimeline(
      roomId,
      eventType,
      msgtype,
      stateKey,
      limit,
      since,
    );
  }

  sendToDevice(
    eventType: string,
    encrypted: boolean,
    contentMap: Record<string, Record<string, object>>,
  ): Promise<void> {
    return this.host.sendToDevice(eventType, encrypted, contentMap);
  }

  askOpenID(observer: SimpleObservable<IOpenIDUpdate>): void {
    this.host.askOpenID(observer);
  }

  getKnownRooms(): string[] {
    return [this.host.roomId];
  }

  // ------------------------------------------------ MatrixRTC (opt-in only)

  private get rtc(): RtcBridge {
    return this.host.rtc ?? notAvailable();
  }

  sendDelayedEvent(
    delay: number,
    eventType: string,
    content: unknown,
    stateKey: string | null = null,
    roomId: string | null = null,
  ): Promise<ISendDelayedEventDetails> {
    return this.rtc.sendDelayedEvent(
      delay,
      eventType,
      content,
      stateKey,
      roomId,
    );
  }

  sendStickyEvent(
    stickyDurationMs: number,
    eventType: string,
    content: unknown,
    roomId: string | null = null,
  ): Promise<ISendEventDetails> {
    return this.rtc.sendStickyEvent(
      stickyDurationMs,
      eventType,
      content,
      roomId,
    );
  }

  sendDelayedStickyEvent(
    delay: number,
    stickyDurationMs: number,
    eventType: string,
    content: unknown,
    roomId: string | null = null,
  ): Promise<ISendDelayedEventDetails> {
    return this.rtc.sendDelayedEvent(
      delay,
      eventType,
      content,
      null,
      roomId,
      stickyDurationMs,
    );
  }

  cancelScheduledDelayedEvent(delayId: string): Promise<void> {
    return this.rtc.updateDelayedEvent(
      delayId,
      UpdateDelayedEventAction.Cancel,
    );
  }

  restartScheduledDelayedEvent(delayId: string): Promise<void> {
    return this.rtc.updateDelayedEvent(
      delayId,
      UpdateDelayedEventAction.Restart,
    );
  }

  sendScheduledDelayedEvent(delayId: string): Promise<void> {
    return this.rtc.updateDelayedEvent(delayId, UpdateDelayedEventAction.Send);
  }

  getRtcTransports(): Promise<IRtcTransportsResult> {
    return this.rtc.getRtcTransports();
  }

  /**
   * Sticky state is not readable through the host's Widget API; sticky
   * events still reach the widget live through the normal event feed.
   */
  async readStickyEvents(): Promise<IRoomEvent[]> {
    return [];
  }
}
