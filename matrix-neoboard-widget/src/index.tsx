/*
 * Copyright 2022 Nordeck IT + Consulting GmbH
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

import {
  extractWidgetParameters,
  WidgetApiImpl,
} from '@matrix-widget-toolkit/api';
import { getEnvironment, getNonce } from '@matrix-widget-toolkit/mui';
import {
  createStore,
  createWhiteboardManager,
  isEmbeddedBoard,
} from '@nordeck/matrix-neoboard-react-sdk';
import log from 'loglevel';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppContainer } from './AppContainer';
import {
  getEmbeddedWidgetConfig,
  withInitialCapabilities,
} from './embeddedWidgets/config';
import { capabilitiesForEmbeddedBoard } from './embeddedWidgets/nestedBoard';
import './i18n';
import './logger';
import { widgetCapabilities } from './widgetCapabilities';

declare global {
  let __webpack_nonce__: string | undefined;
}

// Initialize webpack nonce to make sure that all style tags created by webpack
// include a nonce that suites our CSP.
__webpack_nonce__ = getNonce();

const version = getEnvironment('REACT_APP_VERSION');
const revision = getEnvironment('REACT_APP_REVISION');
if (version) {
  console.log(
    `You are running version "${version}" (${revision}) of the matrix-neoboard-widget!`,
  );
}

if (process.env.NODE_ENV === 'development') {
  log.setDefaultLevel('debug');
}

// Optional "initial union": the capabilities of all embedded widgets in the
// operator policy are part of the first request, so the client asks once.
// Must be known synchronously, before the handshake starts.
// Call capabilities (operator opt-in `matrixrtc`) are specific to the
// user and device, which the widget URL carries.
const initialCapabilities = (() => {
  const config = getEmbeddedWidgetConfig();
  try {
    const { userId, deviceId, roomId } = extractWidgetParameters();
    return config.initialCapabilitiesFor({
      userId: userId ?? '',
      deviceId,
      roomId: roomId ?? '',
    });
  } catch {
    return config.initialCapabilities;
  }
})();
const widgetApiPromise = WidgetApiImpl.create({
  capabilities: withInitialCapabilities(
    // Embedded in another board: without the capabilities embedded widgets
    // never get (see nestedBoard.ts).
    isEmbeddedBoard()
      ? capabilitiesForEmbeddedBoard(widgetCapabilities)
      : widgetCapabilities,
    initialCapabilities,
  ),
});

// NeoBoardception spike: compiled in only when the build sets
// REACT_APP_NBC_SPIKE_INNER_ORIGINS (comma-separated allow-list of inner widget
// origins); otherwise this branch and the spike code are dropped from the bundle.
if (import.meta.env.REACT_APP_NBC_SPIKE_INNER_ORIGINS) {
  import('../../spike/nested-host/src/mountSpike')
    .then(({ maybeMountNeoBoardceptionSpike }) =>
      maybeMountNeoBoardceptionSpike(
        widgetApiPromise,
        String(import.meta.env.REACT_APP_NBC_SPIKE_INNER_ORIGINS).split(','),
      ),
    )
    .catch((e) => console.error('[nbc-spike] failed', e));
}

const store = createStore({ widgetApi: widgetApiPromise });
const whiteboardManager = createWhiteboardManager(
  store,
  widgetApiPromise,
  false,
);

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
  <React.StrictMode>
    <AppContainer
      widgetApiPromise={widgetApiPromise}
      store={store}
      whiteboardManager={whiteboardManager}
    />
  </React.StrictMode>,
);
