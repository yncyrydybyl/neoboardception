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

import { WidgetApi } from '@matrix-widget-toolkit/api';
import type {
  EmbeddedWidgetMountHandle,
  EmbeddedWidgetRendererProps,
  EmbeddedWidgetRuntimeStatus,
} from '@nordeck/matrix-neoboard-react-sdk';
import type { MountEmbeddedWidgetOptions } from '@nordeck/matrix-widget-mediation';
import * as mediation from '@nordeck/matrix-widget-mediation';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { loadEmbeddedWidgetConfig } from './config';
import {
  boardOwnCapabilities,
  createMediationRenderer,
  widgetConsentKey,
} from './mediationRenderer';

const POLL = 'https://poll.example.org';
const VOTE = 'org.matrix.msc2762.send.event:net.nordeck.poll.vote';

describe('createMediationRenderer', () => {
  let outer: { hasCapability: Mock };
  let widgetApi: WidgetApi;
  let handle: {
    destroy: Mock;
    setPaused: Mock;
    reload: Mock;
    retryCapabilities: Mock;
  };
  let mountOptions: MountEmbeddedWidgetOptions | undefined;
  let fakeModule: typeof mediation;
  let loadMediation: Mock<() => Promise<typeof mediation>>;
  let statuses: EmbeddedWidgetRuntimeStatus[];
  let onActivity: Mock;

  beforeEach(() => {
    outer = { hasCapability: vi.fn(() => false) };
    widgetApi = {
      matrixWidgetApi: outer,
      widgetParameters: {
        userId: '@user:example.org',
        roomId: '!room:example.org',
        displayName: 'User',
        theme: 'light',
        isOpenedByClient: true,
      },
    } as unknown as WidgetApi;
    handle = {
      destroy: vi.fn(),
      setPaused: vi.fn(),
      reload: vi.fn(),
      retryCapabilities: vi.fn(),
    };
    mountOptions = undefined;
    fakeModule = {
      ...mediation,
      configureMediation: vi.fn(),
      prerequestCapabilities: vi.fn(() =>
        Promise.resolve({ approved: [], denied: [], timedOut: false }),
      ),
      mountEmbeddedWidget: vi.fn((options: MountEmbeddedWidgetOptions) => {
        mountOptions = options;
        return handle as unknown as mediation.EmbeddedWidgetHandle;
      }),
    };
    loadMediation = vi.fn(() => Promise.resolve(fakeModule));
    statuses = [];
    onActivity = vi.fn();
  });

  function create(
    modalOrigins: string[] = [],
    options: Partial<Parameters<typeof createMediationRenderer>[0]> = {},
  ) {
    return createMediationRenderer({
      widgetApiPromise: Promise.resolve(widgetApi),
      allowedOrigins: [POLL],
      modalOrigins,
      loadMediation,
      ...options,
    });
  }

  function mountWidget(
    renderer: ReturnType<typeof create>['renderer'],
    overrides: Partial<EmbeddedWidgetRendererProps> = {},
  ) {
    return renderer({
      container: document.createElement('div'),
      widgetUrl: `${POLL}/poll/`,
      elementId: 'element-1',
      title: 'Poll',
      readOnly: false,
      viewState: { visible: true, gesturing: false, interactive: false },
      onStatusChange: (s) => statuses.push(s),
      exitInteraction: vi.fn(),
      onActivity,
      ...overrides,
    }) as EmbeddedWidgetMountHandle;
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('loads the mediation code lazily and configures it once', async () => {
    const { renderer, preload } = create();
    expect(loadMediation).not.toHaveBeenCalled();

    preload();
    mountWidget(renderer);
    mountWidget(renderer, { elementId: 'element-2' });
    await flush();

    expect(loadMediation).toHaveBeenCalledTimes(1);
    expect(fakeModule.configureMediation).toHaveBeenCalledTimes(1);
    expect(fakeModule.configureMediation).toHaveBeenCalledWith(outer, {});
  });

  it('mounts with the deployment policy and the widget parameters', async () => {
    mountWidget(create().renderer);
    await flush();

    expect(mountOptions).toMatchObject({
      widgetUrl: `${POLL}/poll/`,
      widgetId: 'element-1',
      outerApi: outer,
      allowedOrigins: [POLL],
      deniedCapabilities: boardOwnCapabilities,
      modals: 'deny',
      name: 'Poll',
      params: {
        userId: '@user:example.org',
        roomId: '!room:example.org',
        displayName: 'User',
        theme: 'light',
      },
    });
    expect(handle.setPaused).toHaveBeenCalledWith(false);
  });

  it('adds configured extra capabilities to the allow-list', async () => {
    const MESSAGE = 'org.matrix.msc2762.receive.event:m.room.message#m.text';
    const config = loadEmbeddedWidgetConfig(
      (name) =>
        ({
          REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS: POLL,
          REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES: `${MESSAGE},${VOTE}`,
        })[name] ?? '',
    );
    const { renderer } = createMediationRenderer({
      widgetApiPromise: Promise.resolve(widgetApi),
      allowedOrigins: config.allowedOrigins,
      resolvePolicy: config.resolveMountPolicy,
      loadMediation,
    });
    mountWidget(renderer);
    await flush();

    expect(mountOptions?.allowedCapabilities).toContain(MESSAGE);
    expect(
      mountOptions?.allowedCapabilities?.filter((c) => c === VOTE),
    ).toHaveLength(1);
    expect(mountOptions?.deniedCapabilities).toEqual(boardOwnCapabilities);
  });

  it('forwards modals only for configured origins', async () => {
    mountWidget(create([POLL]).renderer);
    await flush();
    expect(mountOptions?.modals).toBe('forward');
  });

  it('lets the policy choose the modal mode (it wins over the origin list)', async () => {
    const resolvePolicy = () => ({
      preapproved: false,
      identityApproved: false,
      modals: 'deny' as const,
    });
    mountWidget(create([POLL], { resolvePolicy }).renderer, {
      onModalChange: vi.fn(),
    });
    await flush();
    expect(mountOptions?.modals).toBe('deny');
    expect(mountOptions?.onModalRequest).toBeUndefined();
  });

  it('shows inline modals in the board and hides them when they end', async () => {
    const resolvePolicy = () => ({
      preapproved: false,
      identityApproved: false,
      modals: 'inline' as const,
    });
    const onModalChange = vi.fn();
    mountWidget(create([], { resolvePolicy }).renderer, { onModalChange });
    await flush();
    expect(mountOptions?.modals).toBe('inline');

    let close!: () => void;
    const request = {
      widgetId: 'modal_embedded-element-1',
      parentWidgetId: 'embedded-element-1',
      name: 'Create poll',
      origin: POLL,
      url: `${POLL}/create-poll`,
      buttons: [
        { id: 'save', label: 'Save', kind: 'm.primary', disabled: false },
      ],
      closed: new Promise<void>((resolve) => {
        close = resolve;
      }),
      mount: vi.fn(() => vi.fn()),
      clickButton: vi.fn(),
      cancel: vi.fn(),
    };
    mountOptions?.onModalRequest?.(request);
    expect(onModalChange).toHaveBeenCalledTimes(1);
    const modal = onModalChange.mock.calls[0][0];
    expect(modal).toMatchObject({ name: 'Create poll', origin: POLL });

    const onStatusChange = vi.fn();
    const container = document.createElement('div');
    modal.mount(container, { onButtonsChange: vi.fn(), onStatusChange });
    const callbacks = (request.mount.mock.calls[0] as unknown[])[1] as {
      onStateChange: (s: { status: string }) => void;
    };
    callbacks.onStateChange({ status: 'ready' });
    expect(onStatusChange).toHaveBeenCalledWith({ state: 'ready' });
    callbacks.onStateChange({
      status: 'error',
      code: 'navigated',
      message: 'navigated away',
    } as { status: string });
    expect(onStatusChange).toHaveBeenLastCalledWith({
      state: 'error',
      code: 'navigated',
      message: 'navigated away',
    });
    modal.clickButton('save');
    expect(request.clickButton).toHaveBeenCalledWith('save');
    modal.cancel();
    expect(request.cancel).toHaveBeenCalled();

    close();
    await flush();
    expect(onModalChange).toHaveBeenLastCalledWith(undefined);
  });

  it('refuses inline modals when the board cannot show them', async () => {
    const resolvePolicy = () => ({
      preapproved: false,
      identityApproved: false,
      modals: 'inline' as const,
    });
    mountWidget(create([], { resolvePolicy }).renderer);
    await flush();
    expect(mountOptions?.modals).toBe('deny');
  });

  it('asks the user before granting and remembers the answer per widget URL', async () => {
    const { renderer } = create();
    mountWidget(renderer);
    await flush();

    const request = {
      widgetId: 'embedded-x',
      origin: POLL,
      url: `${POLL}/poll/`,
      capabilities: [VOTE],
      inherited: [],
      upstream: [VOTE],
    };
    const answer = mountOptions!.confirmCapabilities!(request);
    await flush();
    const consent = statuses.at(-1);
    expect(consent).toMatchObject({
      state: 'consent',
      request: { origin: POLL, capabilities: [VOTE], upstream: [VOTE] },
    });
    (consent as { respond: (a: boolean) => void }).respond(true);
    await expect(answer).resolves.toBe(true);
    expect(statuses.at(-1)).toEqual({ state: 'negotiating', origin: POLL });

    // A second element with the same widget (other parameters) is not
    // asked again.
    mountWidget(renderer, {
      elementId: 'element-2',
      widgetUrl: `${POLL}/poll/?room=$matrix_room_id#x`,
    });
    await flush();
    await expect(mountOptions!.confirmCapabilities!(request)).resolves.toBe(
      true,
    );

    // Another widget on the same origin is asked again.
    mountWidget(renderer, {
      elementId: 'element-3',
      widgetUrl: `${POLL}/other/`,
    });
    await flush();
    const asked = statuses.length;
    const other = mountOptions!.confirmCapabilities!({
      ...request,
      url: `${POLL}/other/`,
    });
    await flush();
    expect(statuses.length).toBeGreaterThan(asked);
    expect(statuses.at(-1)).toMatchObject({ state: 'consent' });
    (statuses.at(-1) as { respond: (a: boolean) => void }).respond(false);
    await expect(other).resolves.toBe(false);
  });

  it('keys the consent by normalised origin and path', () => {
    expect(
      widgetConsentKey('https://Poll.Example.org:443/a/../poll/?x=1#y'),
    ).toBe('https://poll.example.org/poll/');
    expect(widgetConsentKey('https://poll.example.org/poll/')).not.toBe(
      widgetConsentKey('https://poll.example.org/other/'),
    );
  });

  it('maps a denial to an error with retry', async () => {
    mountWidget(create().renderer);
    await flush();

    mountOptions!.onStateChange!({
      status: 'error',
      reason: 'denied',
      code: 'denied',
      message: 'x',
    });
    const error = statuses.at(-1) as Extract<
      EmbeddedWidgetRuntimeStatus,
      { state: 'error' }
    >;
    expect(error).toMatchObject({
      state: 'error',
      reason: 'denied',
      code: 'denied',
    });
    error.retry?.();
    expect(handle.retryCapabilities).toHaveBeenCalled();
  });

  it('passes the error code and offers no retry for permanent errors', async () => {
    mountWidget(create().renderer);
    await flush();

    mountOptions!.onStateChange!({
      status: 'error',
      reason: 'load-failed',
      code: 'origin-not-allowed',
      message: 'Widget origin https://x.example is not in the allowed origins',
    });
    expect(statuses.at(-1)).toEqual({
      state: 'error',
      reason: 'load-failed',
      code: 'origin-not-allowed',
      message: 'Widget origin https://x.example is not in the allowed origins',
    });

    mountOptions!.onStateChange!({
      status: 'error',
      reason: 'timeout',
      code: 'timeout',
      message: 'The widget did not load in time',
    });
    const error = statuses.at(-1) as Extract<
      EmbeddedWidgetRuntimeStatus,
      { state: 'error' }
    >;
    expect(error).toMatchObject({ code: 'timeout' });
    error.retry?.();
    expect(handle.reload).toHaveBeenCalled();
  });

  it('refuses a widget without a policy with a permanent error', async () => {
    mountWidget(create([], { resolvePolicy: () => undefined }).renderer);
    await flush();
    expect(statuses.at(-1)).toMatchObject({
      state: 'error',
      code: 'policy',
    });
    expect(statuses.at(-1)).not.toHaveProperty('retry');
    expect(fakeModule.mountEmbeddedWidget).not.toHaveBeenCalled();
  });

  it('reports permissions blocked by the policy when ready', async () => {
    mountWidget(create().renderer);
    await flush();
    mountOptions!.onStateChange!({
      status: 'ready',
      capabilities: {
        requested: [VOTE, 'org.matrix.msc2762.timeline:*'],
        granted: [VOTE],
        blockedByPolicy: ['org.matrix.msc2762.timeline:*'],
        deniedLocally: [],
        deniedUpstream: [],
      },
    });
    expect(statuses.at(-1)).toEqual({
      state: 'ready',
      limits: {
        requested: [VOTE, 'org.matrix.msc2762.timeline:*'],
        blocked: ['org.matrix.msc2762.timeline:*'],
      },
    });
  });

  it('reports the client dialog while it is open', async () => {
    mountWidget(create().renderer);
    await flush();
    mountOptions!.onStateChange!({
      status: 'negotiating',
      awaitingCapabilities: [VOTE],
    });
    expect(statuses.at(-1)).toEqual({
      state: 'negotiating',
      awaitingClient: true,
      origin: POLL,
    });
    mountOptions!.onStateChange!({
      status: 'ready',
      capabilities: {
        requested: [],
        granted: [],
        blockedByPolicy: [],
        deniedLocally: [],
        deniedUpstream: [],
      },
    });
    expect(statuses.at(-1)).toEqual({
      state: 'ready',
      limits: { requested: [], blocked: [] },
    });
  });

  it('reports sent events as shared changes', async () => {
    mountWidget(create().renderer);
    await flush();
    mountOptions!.onEventSent!({ type: 'net.nordeck.poll.vote' });
    expect(onActivity).toHaveBeenCalledWith({
      kind: 'shared-change',
      eventType: 'net.nordeck.poll.vote',
    });
  });

  it('pauses while hidden or gesturing and destroys on unmount', async () => {
    const view = mountWidget(create().renderer);
    await flush();

    view.update!({ visible: true, gesturing: true, interactive: false });
    expect(handle.setPaused).toHaveBeenLastCalledWith(true);
    view.update!({ visible: false, gesturing: false, interactive: false });
    expect(handle.setPaused).toHaveBeenLastCalledWith(true);
    view.update!({ visible: true, gesturing: false, interactive: true });
    expect(handle.setPaused).toHaveBeenLastCalledWith(false);

    view.unmount();
    expect(handle.destroy).toHaveBeenCalledTimes(1);
  });

  it('mounts a call widget with the opt-in and pins it while it runs', async () => {
    const setKeepAlive = vi.fn();
    const view = mountWidget(
      create([], {
        resolvePolicy: () => ({
          preapproved: true,
          identityApproved: true,
          matrixRtc: true,
          mediaPermissions: ['camera', 'microphone'],
        }),
      }).renderer,
      { setKeepAlive },
    );
    await flush();
    expect(mountOptions).toMatchObject({
      matrixRtc: true,
      mediaPermissions: ['camera', 'microphone'],
      openId: 'forward',
      updateState: 'auto',
    });

    mountOptions!.onMatrixRtcEvent!({ kind: 'joined' });
    expect(setKeepAlive).toHaveBeenLastCalledWith(true);
    mountOptions!.onMatrixRtcEvent!({ kind: 'always-on-screen', value: false });
    expect(setKeepAlive).toHaveBeenLastCalledWith(false);
    mountOptions!.onMatrixRtcEvent!({ kind: 'always-on-screen', value: true });
    expect(setKeepAlive).toHaveBeenLastCalledWith(true);
    mountOptions!.onMatrixRtcEvent!({ kind: 'hung-up' });
    expect(setKeepAlive).toHaveBeenLastCalledWith(false);

    mountOptions!.onMatrixRtcEvent!({ kind: 'joined' });
    view.unmount();
    expect(setKeepAlive).toHaveBeenLastCalledWith(false);
  });

  it('leaves normal widgets without call options', async () => {
    mountWidget(create().renderer);
    await flush();
    expect(mountOptions?.matrixRtc).toBeUndefined();
    expect(mountOptions?.mediaPermissions).toBeUndefined();
    expect(mountOptions?.onMatrixRtcEvent).toBeUndefined();
  });

  it('does not mount when unmounted before the code loaded', async () => {
    mountWidget(create().renderer).unmount();
    await flush();
    expect(fakeModule.mountEmbeddedWidget).not.toHaveBeenCalled();
  });

  it('asks for declared capabilities and requests them early', async () => {
    mountWidget(create().renderer, { capabilities: [VOTE, 'm.unknown'] });
    await flush();

    const consent = statuses.at(-1) as Extract<
      EmbeddedWidgetRuntimeStatus,
      { state: 'consent' }
    >;
    expect(consent.request.capabilities).toEqual([VOTE]);
    expect(fakeModule.mountEmbeddedWidget).not.toHaveBeenCalled();

    consent.respond(true);
    await flush();
    expect(fakeModule.prerequestCapabilities).toHaveBeenCalledWith(
      expect.objectContaining({ outerApi: outer, capabilities: [VOTE] }),
    );
    expect(fakeModule.mountEmbeddedWidget).toHaveBeenCalled();
  });

  describe('operator policy (layer 2)', () => {
    const request = {
      widgetId: 'embedded-x',
      origin: POLL,
      url: `${POLL}/poll/`,
      capabilities: [VOTE],
      inherited: [VOTE],
      upstream: [],
    };

    it('uses the policy allow-list, name and OpenID setting', async () => {
      const resolvePolicy = vi.fn(() => ({
        allowedCapabilities: [VOTE],
        preapproved: false,
        identityApproved: true,
        name: 'Operator Poll',
      }));
      mountWidget(create([], { resolvePolicy }).renderer);
      await flush();

      expect(resolvePolicy).toHaveBeenCalledWith(`${POLL}/poll/`);
      expect(mountOptions).toMatchObject({
        allowedCapabilities: [VOTE],
        deniedCapabilities: boardOwnCapabilities,
        openId: 'forward',
        name: 'Operator Poll',
      });
      expect(mountOptions?.maxCapabilityRequests).toBeUndefined();
    });

    it('denies OpenID and uses the default allow-list without a policy', async () => {
      mountWidget(create().renderer);
      await flush();
      expect(mountOptions).toMatchObject({
        allowedCapabilities: mediation.POLL_CAPABILITIES,
        openId: 'deny',
      });
    });

    it('pre-approved: no consent panel, a notice that names the widget', async () => {
      const resolvePolicy = () => ({
        allowedCapabilities: [VOTE],
        preapproved: true,
        identityApproved: false,
        name: 'Poll',
      });
      mountWidget(create([], { resolvePolicy }).renderer);
      await flush();

      await expect(mountOptions!.confirmCapabilities!(request)).resolves.toBe(
        true,
      );
      expect(statuses.some((st) => st.state === 'consent')).toBe(false);

      mountOptions!.onStateChange!({
        status: 'negotiating',
        awaitingCapabilities: [VOTE],
      });
      expect(statuses.at(-1)).toEqual({
        state: 'negotiating',
        awaitingClient: true,
        origin: POLL,
        preapproved: { origin: POLL, name: 'Poll' },
      });
      mountOptions!.onStateChange!({
        status: 'ready',
        capabilities: {
          requested: [VOTE],
          granted: [VOTE],
          blockedByPolicy: [],
          deniedLocally: [],
          deniedUpstream: [],
        },
      });
      expect(statuses.at(-1)).toEqual({
        state: 'ready',
        preapproved: { origin: POLL, name: 'Poll' },
        limits: { requested: [VOTE], blocked: [] },
      });
    });

    it('not pre-approved: asks locally, no notice', async () => {
      const resolvePolicy = () => ({
        allowedCapabilities: [VOTE],
        preapproved: false,
        identityApproved: false,
      });
      mountWidget(create([], { resolvePolicy }).renderer);
      await flush();
      void mountOptions!.confirmCapabilities!(request);
      await flush();
      expect(statuses.at(-1)?.state).toBe('consent');
    });

    it('pre-approved declared capabilities are requested without asking', async () => {
      const resolvePolicy = () => ({
        allowedCapabilities: [VOTE],
        preapproved: true,
        identityApproved: false,
      });
      mountWidget(create([], { resolvePolicy }).renderer, {
        capabilities: [VOTE],
      });
      await flush();
      expect(statuses.some((st) => st.state === 'consent')).toBe(false);
      expect(fakeModule.prerequestCapabilities).toHaveBeenCalledWith(
        expect.objectContaining({ capabilities: [VOTE] }),
      );
      expect(fakeModule.mountEmbeddedWidget).toHaveBeenCalled();
    });

    it('refuses a widget the policy does not allow', async () => {
      mountWidget(create([], { resolvePolicy: () => undefined }).renderer);
      await flush();
      expect(fakeModule.mountEmbeddedWidget).not.toHaveBeenCalled();
      expect(statuses.at(-1)).toMatchObject({
        state: 'error',
        reason: 'load-failed',
      });
    });

    it('initial union: no capability rounds, no early request', async () => {
      mountWidget(create([], { maxCapabilityRequests: 0 }).renderer, {
        capabilities: [VOTE],
      });
      await flush();
      expect(fakeModule.prerequestCapabilities).not.toHaveBeenCalled();
      expect(mountOptions?.maxCapabilityRequests).toBe(0);
    });
  });

  describe('event namespace (board inside board)', () => {
    const NS = {
      'net.nordeck.whiteboard':
        'net.neoboardception.nested.net.nordeck.whiteboard',
    };
    const NESTED_STATE =
      'org.matrix.msc2762.send.state_event:net.neoboardception.nested.net.nordeck.whiteboard';

    it('passes the namespace and checks declared capabilities in the rewritten form', async () => {
      mountWidget(
        create([], {
          resolvePolicy: () => ({
            preapproved: true,
            identityApproved: false,
            allowedCapabilities: [NESTED_STATE],
            eventNamespace: NS,
          }),
        }).renderer,
        {
          capabilities: [
            'org.matrix.msc2762.send.state_event:net.nordeck.whiteboard',
          ],
        },
      );
      await flush();
      expect(mountOptions?.eventNamespace).toEqual(NS);
      expect(mountOptions?.deniedCapabilities).toEqual(boardOwnCapabilities);
      expect(fakeModule.prerequestCapabilities).toHaveBeenCalledWith(
        expect.objectContaining({ capabilities: [NESTED_STATE] }),
      );
    });

    it('does not pass a namespace for ordinary widgets', async () => {
      mountWidget(create().renderer);
      await flush();
      expect(mountOptions).not.toHaveProperty('eventNamespace');
    });
  });
});
