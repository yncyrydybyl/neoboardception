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

import { WidgetApi, WidgetParameter } from '@matrix-widget-toolkit/api';
import {
  MuiThemeProvider,
  MuiWidgetApiProvider,
} from '@matrix-widget-toolkit/mui';
import {
  App,
  ConnectionStateDialog,
  ConnectionStateProvider,
  DraggableStyles,
  EmbeddedWidgetProvider,
  FontsLoadedContextProvider,
  GuidedTourProvider,
  LayoutStateProvider,
  PageLoader,
  Snackbar,
  SnackbarProvider,
  SnapshotLoadStateDialog,
  StoreType,
  WhiteboardHotkeysProvider,
  WhiteboardManager,
  WhiteboardManagerProvider,
} from '@nordeck/matrix-neoboard-react-sdk';
import { Suspense, useMemo } from 'react';
import { Provider } from 'react-redux';
import { getEmbeddedWidgetConfig } from './embeddedWidgets/config';
import { createMediationRenderer } from './embeddedWidgets/mediationRenderer';

// Deployment configuration of embedded widgets (origin allow-list or
// operator policy). Embedding is disabled when no origin is allowed.
const embeddedWidgetConfig = getEmbeddedWidgetConfig();

export const AppContainer = ({
  store,
  whiteboardManager,
  widgetApiPromise,
}: {
  widgetApiPromise: Promise<WidgetApi>;
  store: StoreType;
  whiteboardManager: WhiteboardManager;
}) => {
  const embeddedWidgetHost = useMemo(
    () =>
      embeddedWidgetConfig.allowedOrigins.length > 0
        ? createMediationRenderer({
            widgetApiPromise,
            allowedOrigins: embeddedWidgetConfig.allowedOrigins,
            modalOrigins: embeddedWidgetConfig.modalOrigins,
            resolvePolicy: embeddedWidgetConfig.resolveMountPolicy,
            maxCapabilityRequests: embeddedWidgetConfig.maxCapabilityRequests,
          })
        : undefined,
    [widgetApiPromise],
  );

  return (
    <Provider store={store}>
      <WhiteboardManagerProvider whiteboardManager={whiteboardManager}>
        <MuiThemeProvider>
          {/* Only apply styles inside the MuiThemeProvider as the nonce is
              otherwise missing */}
          <DraggableStyles />

          <Suspense fallback={<PageLoader />}>
            <MuiWidgetApiProvider
              widgetApiPromise={widgetApiPromise}
              widgetRegistration={{
                name: 'NeoBoard',
                // "pad" suffix to get a custom icon
                type: 'net.nordeck.whiteboard:pad',
                requiredParameters: [WidgetParameter.DeviceId],
              }}
            >
              <FontsLoadedContextProvider>
                <LayoutStateProvider>
                  <WhiteboardHotkeysProvider>
                    <GuidedTourProvider>
                      <SnackbarProvider>
                        <Snackbar />
                        <ConnectionStateProvider>
                          <ConnectionStateDialog />
                          <SnapshotLoadStateDialog />
                          <EmbeddedWidgetProvider
                            renderer={embeddedWidgetHost?.renderer}
                            preload={embeddedWidgetHost?.preload}
                            isUrlAllowed={embeddedWidgetConfig.isUrlAllowed}
                            maxLiveWidgets={embeddedWidgetConfig.maxLiveWidgets}
                            insertionEnabled={
                              embeddedWidgetConfig.allowedOrigins.length > 0
                            }
                          >
                            <App />
                          </EmbeddedWidgetProvider>
                        </ConnectionStateProvider>
                      </SnackbarProvider>
                    </GuidedTourProvider>
                  </WhiteboardHotkeysProvider>
                </LayoutStateProvider>
              </FontsLoadedContextProvider>
            </MuiWidgetApiProvider>
          </Suspense>
        </MuiThemeProvider>
      </WhiteboardManagerProvider>
    </Provider>
  );
};
