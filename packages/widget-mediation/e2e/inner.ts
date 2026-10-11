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
 * Level 3: the embedded widget, a plain matrix-widget-api widget on its own
 * origin. Sends a vote, waits for the echo, reads it back, and tries to post
 * under the host's widget id (which the mediator must drop).
 */

import { IRoomEvent, IWidgetApiRequest, WidgetApi } from 'matrix-widget-api';

const q = new URLSearchParams(location.search);
const VOTE = 'net.example.vote';
const record = {
  echoed: [] as string[],
  sent: '' as string,
  read: [] as IRoomEvent[],
  error: '' as string,
};
(window as unknown as { __INNER__: typeof record }).__INNER__ = record;

const api = new WidgetApi(
  q.get('widgetId')!,
  new URL(q.get('parentUrl')!).origin,
);
api.requestCapabilityToSendEvent(VOTE);
api.requestCapabilityToReceiveEvent(VOTE);
api.on('action:send_event', (ev: CustomEvent<IWidgetApiRequest>) => {
  ev.preventDefault();
  api.transport.reply(ev.detail, {});
  record.echoed.push((ev.detail.data as unknown as IRoomEvent).event_id);
});
api.once('ready', async () => {
  try {
    // Negative test: a to-widget request under the host's id.
    window.parent.postMessage(
      {
        api: 'toWidget',
        widgetId: 'host-widget',
        requestId: 'spoof-1',
        action: 'send_event',
        data: { type: 'net.example.board.doc', content: {} },
      },
      '*',
    );
    const r = await api.sendRoomEvent(VOTE, { answer: 1 });
    record.sent = r.event_id ?? '';
    record.read = await api.readRoomEvents(VOTE, 10);
  } catch (e) {
    record.error = String(e);
  }
});
api.start();
