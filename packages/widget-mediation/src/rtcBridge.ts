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
  IRtcTransportsResult,
  ISendDelayedEventDetails,
  ISendEventDetails,
} from 'matrix-widget-api';
import { UpdateDelayedEventAction } from 'matrix-widget-api';
import { RateLimit, RateLimitedError, TokenBucket } from './rateLimit';
import type { MediationLogger, OuterWidgetApi } from './types';

const ACTION_SEND_EVENT = 'send_event';
const ACTION_UPDATE_DELAYED_EVENT = 'org.matrix.msc4157.update_delayed_event';
const ACTION_GET_RTC_TRANSPORTS = 'org.matrix.msc4515.get_rtc_transports';

/**
 * Default budget of a call widget's MatrixRTC traffic (delayed-event
 * keep-alives, to-device keys, membership with delay). Separate from the
 * room-event budget: a call restarts its delayed leave event every few
 * seconds and must not starve, and a board widget must not be able to use
 * this path at all.
 */
export const DEFAULT_RTC_RATE_LIMIT: RateLimit = { burst: 20, perSecond: 2 };

/** Delay ids remembered per widget (oldest dropped first). */
const MAX_OWNED_DELAY_IDS = 64;

export interface RtcBridgeOptions {
  outer: () => Promise<OuterWidgetApi>;
  /** The host's room; the only room a call widget may act in. */
  roomId: string;
  rateLimit?: RateLimit;
  logger?: MediationLogger;
}

/**
 * Forwards the MatrixRTC parts of the Widget API of one call widget through
 * the host's outer API: delayed events (MSC4157), sticky events (MSC4407)
 * and RTC transports (MSC4515). To-device messages share the mediator's
 * general to-device path (`EmbeddedWidget.sendToDevice`). Capability
 * checks happen before (ClientWidgetApi with the widget's grants); this
 * class adds what the client cannot know about embedded widgets:
 *
 * - the host's room only (no `room_id` for other rooms);
 * - a delayed event can only be updated by the widget that scheduled it;
 * - a separate rate limit.
 */
export class RtcBridge {
  private readonly bucket: TokenBucket;
  private readonly ownedDelayIds = new Set<string>();
  private stopped = false;

  constructor(private readonly o: RtcBridgeOptions) {
    this.bucket = new TokenBucket(o.rateLimit ?? DEFAULT_RTC_RATE_LIMIT);
  }

  stop(): void {
    this.stopped = true;
    this.ownedDelayIds.clear();
  }

  /**
   * Stops the bridge and sends every delayed event this widget scheduled
   * now (MSC4157 `send`). Used when the widget is torn down: a delayed event
   * of a call is its "when I am gone" action (the leave of its membership),
   * which would otherwise only apply after the delay. Errors are ignored
   * (the event may already have been sent or cancelled).
   */
  async flush(): Promise<void> {
    const ids = [...this.ownedDelayIds];
    this.stop();
    if (ids.length === 0) return;
    let outer: OuterWidgetApi;
    try {
      outer = await this.o.outer();
    } catch {
      return;
    }
    await Promise.all(
      ids.map((delayId) =>
        outer.transport
          .send(ACTION_UPDATE_DELAYED_EVENT, {
            action: UpdateDelayedEventAction.Send,
            delay_id: delayId,
          })
          .catch((e: unknown) =>
            this.o.logger?.debug(
              'delayed event not sent on teardown',
              String(e),
            ),
          ),
      ),
    );
  }

  /** Delay ids this widget scheduled and may still update. */
  get delayIds(): string[] {
    return [...this.ownedDelayIds];
  }

  private async outer(): Promise<OuterWidgetApi> {
    if (this.stopped) throw new Error('Embedded widget stopped');
    if (!this.bucket.available()) {
      throw new RateLimitedError('Too many requests, slow down');
    }
    this.bucket.take();
    return this.o.outer();
  }

  private checkRoom(roomId: string | null | undefined) {
    if (roomId && roomId !== this.o.roomId) {
      throw new Error('Embedded widgets may only act in the host room');
    }
  }

  private remember(delayId: string) {
    this.ownedDelayIds.add(delayId);
    if (this.ownedDelayIds.size > MAX_OWNED_DELAY_IDS) {
      const oldest = this.ownedDelayIds.values().next().value;
      if (oldest !== undefined) this.ownedDelayIds.delete(oldest);
    }
  }

  async sendDelayedEvent(
    delay: number,
    eventType: string,
    content: unknown,
    stateKey: string | null | undefined,
    roomId: string | null | undefined,
    stickyDurationMs?: number,
  ): Promise<ISendDelayedEventDetails> {
    this.checkRoom(roomId);
    if (!Number.isFinite(delay) || delay < 0) {
      throw new Error('Invalid delay');
    }
    const outer = await this.outer();
    const isState = stateKey !== null && stateKey !== undefined;
    const r = (await outer.transport.send(ACTION_SEND_EVENT, {
      type: eventType,
      content,
      ...(isState ? { state_key: stateKey } : {}),
      delay,
      ...(stickyDurationMs !== undefined
        ? { sticky_duration_ms: stickyDurationMs }
        : {}),
    })) as { room_id?: string; delay_id?: string };
    if (typeof r?.delay_id !== 'string' || r.delay_id === '') {
      throw new Error('The client did not schedule the delayed event');
    }
    if (!this.stopped) this.remember(r.delay_id);
    return { roomId: r.room_id ?? this.o.roomId, delayId: r.delay_id };
  }

  async sendStickyEvent(
    stickyDurationMs: number,
    eventType: string,
    content: unknown,
    roomId: string | null | undefined,
  ): Promise<ISendEventDetails> {
    this.checkRoom(roomId);
    const outer = await this.outer();
    const r = (await outer.transport.send(ACTION_SEND_EVENT, {
      type: eventType,
      content,
      sticky_duration_ms: stickyDurationMs,
    })) as { room_id?: string; event_id?: string };
    return { roomId: r?.room_id ?? this.o.roomId, eventId: r?.event_id ?? '' };
  }

  async updateDelayedEvent(
    delayId: string,
    action: UpdateDelayedEventAction,
  ): Promise<void> {
    if (!this.ownedDelayIds.has(delayId)) {
      // Never let one widget cancel, send or prolong another widget's (or
      // the host's) scheduled event.
      throw new Error('Unknown delayed event');
    }
    const outer = await this.outer();
    await outer.transport.send(ACTION_UPDATE_DELAYED_EVENT, {
      action,
      delay_id: delayId,
    });
    if (action !== UpdateDelayedEventAction.Restart) {
      this.ownedDelayIds.delete(delayId);
    }
  }

  async getRtcTransports(): Promise<IRtcTransportsResult> {
    const outer = await this.outer();
    const r = (await outer.transport.send(ACTION_GET_RTC_TRANSPORTS, {})) as {
      rtc_transports?: unknown;
    };
    const list = Array.isArray(r?.rtc_transports) ? r.rtc_transports : [];
    return {
      rtc_transports: list.filter(
        (t): t is IRtcTransportsResult['rtc_transports'][number] =>
          !!t && typeof t === 'object' && typeof t.type === 'string',
      ),
    };
  }
}
