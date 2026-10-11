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

/*
 * Level 1: a minimal stand-in for the Matrix client (Element). It frames the
 * host widget and plays the client side with matrix-widget-api's own
 * ClientWidgetApi, which also handles MSC2974 renegotiation. The "user"
 * approves every capability; events sent are echoed back.
 */

import {
  ClientWidgetApi,
  IRoomEvent,
  ISendEventDetails,
  Widget,
  WidgetDriver,
} from 'matrix-widget-api';

const ROOM = '!room:example.org';
const USER = '@alice:example.org';

const record = {
  capabilityRounds: [] as string[][],
  sent: [] as IRoomEvent[],
};
(window as unknown as { __CLIENT__: typeof record }).__CLIENT__ = record;

let seq = 0;

class Driver extends WidgetDriver {
  async validateCapabilities(requested: Set<string>): Promise<Set<string>> {
    record.capabilityRounds.push([...requested]);
    return requested;
  }

  async sendEvent(
    eventType: string,
    content: unknown,
    stateKey: string | null = null,
  ): Promise<ISendEventDetails> {
    const event = {
      type: eventType,
      content,
      sender: USER,
      event_id: `$e${++seq}`,
      room_id: ROOM,
      origin_server_ts: Date.now(),
      unsigned: {},
      ...(stateKey !== null ? { state_key: stateKey } : {}),
    } as IRoomEvent;
    record.sent.push(event);
    // Echo after the reply, like a homeserver round trip.
    setTimeout(() => void client.feedEvent(event), 20);
    return { roomId: ROOM, eventId: event.event_id };
  }

  async readRoomTimeline(
    _roomId: string,
    eventType: string,
  ): Promise<IRoomEvent[]> {
    return record.sent.filter((e) => e.type === eventType);
  }

  getKnownRooms(): string[] {
    return [ROOM];
  }
}

const hostUrl = new URLSearchParams(location.search).get('host')!;
const widget = new Widget({
  id: 'host-widget',
  creatorUserId: USER,
  type: 'm.custom',
  url: `${hostUrl}?inner=${encodeURIComponent(
    new URLSearchParams(location.search).get('inner')!,
  )}&widgetId=$matrix_widget_id&parentUrl=${encodeURIComponent(location.href)}`,
  waitForIframeLoad: true,
});
const iframe = document.createElement('iframe');
iframe.src = widget.getCompleteUrl({
  currentUserId: USER,
  widgetRoomId: ROOM,
});
iframe.style.cssText = 'width:600px;height:400px';
document.body.appendChild(iframe);
const client = new ClientWidgetApi(widget, iframe, new Driver());
client.setViewedRoomId(ROOM);
