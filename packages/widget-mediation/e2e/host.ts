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
 * Level 2: the host widget. Uses the widget-side WidgetApi towards the
 * client and mounts the embedded widget through the mediation package.
 */

import { IWidgetApiRequest, WidgetApi } from 'matrix-widget-api';
import { EmbeddedWidgetState, mountEmbeddedWidget } from '../src';

const q = new URLSearchParams(location.search);
const record = {
  states: [] as EmbeddedWidgetState[],
  warnings: [] as unknown[],
  capabilityRequests: [] as string[][],
};
(window as unknown as { __HOST__: typeof record }).__HOST__ = record;

const api = new WidgetApi(
  q.get('widgetId')!,
  new URL(q.get('parentUrl')!).origin,
);
api.requestCapabilities([
  'org.matrix.msc2762.send.event:net.example.board.doc',
  'org.matrix.msc2762.receive.event:net.example.board.doc',
]);
// Like matrix-widget-toolkit: acknowledge events pushed by the client. The
// mediator observes the same events and forwards them downward.
api.on('action:send_event', (ev: CustomEvent<IWidgetApiRequest>) => {
  ev.preventDefault();
  api.transport.reply(ev.detail, {});
});
api.start();

const inner = q.get('inner')!;
const container = document.createElement('div');
container.style.cssText = 'width:500px;height:300px';
document.body.appendChild(container);

mountEmbeddedWidget({
  container,
  widgetUrl: inner,
  widgetId: 'element-1',
  outerApi: new Promise((resolve) => api.once('ready', () => resolve(api))),
  allowedOrigins: [new URL(inner).origin],
  allowedCapabilities: [
    'org.matrix.msc2762.send.event:net.example.vote',
    'org.matrix.msc2762.receive.event:net.example.vote',
  ],
  allowInsecureLocalhost: true,
  params: { userId: '@alice:example.org', roomId: '!room:example.org' },
  onStateChange: (s) => record.states.push(s),
  onCapabilityRequest: (r) => record.capabilityRequests.push(r.capabilities),
  logger: {
    debug: () => undefined,
    warn: (message, data) => record.warnings.push({ message, data }),
  },
});
