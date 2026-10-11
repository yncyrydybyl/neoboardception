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
import {
  isPermanentEmbeddedWidgetErrorCode,
  type EmbeddedWidgetConsentRequest,
  type EmbeddedWidgetModalStatus,
  type EmbeddedWidgetPreapproval,
  type EmbeddedWidgetRenderer,
  type EmbeddedWidgetRendererProps,
  type EmbeddedWidgetRuntimeStatus,
} from '@nordeck/matrix-neoboard-react-sdk';
import type {
  CapabilityRequestInfo,
  CapabilitySummary,
  EmbeddedModalRequest,
  EmbeddedWidgetHandle,
  EmbeddedWidgetState,
  OuterWidgetApi,
} from '@nordeck/matrix-widget-mediation';
import { policyMatchKey } from '@nordeck/matrix-widget-mediation/policy';
import loglevel from 'loglevel';
import type { EmbeddedWidgetMountPolicy } from './config';
import { prepareNestedBoardPowerLevels } from './nestedBoard';

type MediationModule = typeof import('@nordeck/matrix-widget-mediation');

/**
 * Capabilities of the board itself. An embedded widget never gets them, even
 * if a deployment widens the allow-list.
 */
export const boardOwnCapabilities: readonly string[] = [
  'org.matrix.msc2762.send.event:net.nordeck.whiteboard*',
  'org.matrix.msc2762.receive.event:net.nordeck.whiteboard*',
  'org.matrix.msc2762.send.state_event:net.nordeck.whiteboard*',
  'org.matrix.msc2762.receive.state_event:net.nordeck.whiteboard*',
];

export type MediationRendererOptions = {
  widgetApiPromise: Promise<WidgetApi>;
  /** Origins widgets may be embedded from (deployment configuration). */
  allowedOrigins: readonly string[];
  /**
   * Origins whose widgets may open modals in the Matrix client
   * (`open_modal` is forwarded under the board's identity), unless the
   * widget's policy sets `modals`. Default: none.
   */
  modalOrigins?: readonly string[];
  /**
   * Operator policy per widget URL (layer 2). Returning `undefined` refuses
   * the widget. Default: the mediation package's default allow-list and
   * local consent for every widget.
   */
  resolvePolicy?: (widgetUrl: string) => EmbeddedWidgetMountPolicy | undefined;
  /**
   * Capability rounds an embedded widget may trigger at the client. `0`
   * when the board requested everything up front (initial union); then
   * capabilities declared in the shell are not requested either.
   */
  maxCapabilityRequests?: number;
  /** Loads the widget host code. Defaults to a lazy `import()`. */
  loadMediation?: () => Promise<MediationModule>;
};

export type MediationRenderer = {
  renderer: EmbeddedWidgetRenderer;
  /** Starts loading the widget host code (no user interaction). */
  preload: () => void;
};

/**
 * Renders embedded widgets with `@nordeck/matrix-widget-mediation`: the board
 * acts as the Matrix client of the embedded widget and forwards its requests
 * through the board's own Widget API.
 *
 * The mediation code is loaded lazily on the first embedded widget element,
 * so boards without embedded widgets do not load it.
 */
export function createMediationRenderer({
  widgetApiPromise,
  allowedOrigins,
  modalOrigins = [],
  resolvePolicy = () => ({ preapproved: false, identityApproved: false }),
  maxCapabilityRequests,
  loadMediation = () => import('@nordeck/matrix-widget-mediation'),
}: MediationRendererOptions): MediationRenderer {
  let loading: Promise<{ m: MediationModule; widgetApi: WidgetApi }>;
  // Capabilities the user agreed to in this session, per widget URL (origin
  // and path, normalised like the policy; query and fragment only carry
  // parameters). Two widgets on one origin never share a consent.
  const consented = new Map<string, Set<string>>();

  const load = () => {
    loading ??= Promise.all([loadMediation(), widgetApiPromise]).then(
      ([m, widgetApi]) => {
        try {
          m.configureMediation(outerApiOf(widgetApi), {});
        } catch (error) {
          loglevel.warn('Widget mediation was already configured', error);
        }
        return { m, widgetApi };
      },
    );
    return loading;
  };

  const preload = () => {
    load().catch((error) =>
      loglevel.error('Could not load the widget host', error),
    );
  };

  const renderer: EmbeddedWidgetRenderer = (props) => {
    let destroyed = false;
    let handle: EmbeddedWidgetHandle | undefined;
    let viewState = props.viewState;
    let pendingConsent: ((approved: boolean) => void) | undefined;
    let origin: string;
    try {
      origin = new URL(props.widgetUrl).origin;
    } catch {
      origin = '';
    }
    const consentKey = widgetConsentKey(props.widgetUrl);
    const widgetPolicy = resolvePolicy(props.widgetUrl);
    // The operator approved this widget in advance: no local consent, but
    // the board still names the widget (non-blocking notice).
    const preapproved: EmbeddedWidgetPreapproval | undefined =
      widgetPolicy?.preapproved
        ? { origin, name: widgetPolicy.name }
        : undefined;

    // Policy `modals` wins; the origin list is the older `forward` switch.
    // `inline` needs a board that can show the dialog.
    let modals =
      widgetPolicy?.modals ??
      (modalOrigins.includes(origin) ? 'forward' : 'deny');
    if (modals === 'inline' && !props.onModalChange) {
      modals = 'deny';
    }

    /** `inline` modals: the board shows the modal in its own dialog. */
    const onModalRequest = (request: EmbeddedModalRequest) => {
      const show = props.onModalChange;
      if (destroyed || !show) {
        request.cancel();
        return;
      }
      show({
        name: request.name,
        origin: request.origin,
        buttons: request.buttons,
        mount: (container, callbacks) =>
          request.mount(container, {
            onButtonsChange: callbacks.onButtonsChange,
            onStateChange: (state) =>
              callbacks.onStatusChange(modalStatus(state)),
          }),
        clickButton: (id) => request.clickButton(id),
        cancel: () => request.cancel(),
      });
      void request.closed.then(() => !destroyed && show(undefined));
    };

    const status = (s: EmbeddedWidgetRuntimeStatus) => {
      if (!destroyed) {
        props.onStatusChange(s);
      }
    };

    /** Shows the board's consent UI; resolves with the user's answer. */
    const askUser = (request: EmbeddedWidgetConsentRequest) =>
      new Promise<boolean>((resolve) => {
        pendingConsent = (approved) => {
          pendingConsent = undefined;
          if (approved) {
            const set = consented.get(consentKey) ?? new Set<string>();
            request.capabilities.forEach((c) => set.add(c));
            consented.set(consentKey, set);
            status({ state: 'negotiating', origin: request.origin });
          }
          resolve(approved);
        };
        status({
          state: 'consent',
          request,
          respond: (approved) => pendingConsent?.(approved),
        });
      });

    const confirmCapabilities = async (
      request: CapabilityRequestInfo,
    ): Promise<boolean> => {
      if (preapproved) {
        // Only policy-allowed capabilities reach this hook.
        return true;
      }
      const known = consented.get(consentKey);
      if (known && request.capabilities.every((c) => known.has(c))) {
        return true;
      }
      return askUser({
        origin: request.origin,
        url: request.url,
        capabilities: request.capabilities,
        upstream: request.upstream,
      });
    };

    const onStateChange = (state: EmbeddedWidgetState) => {
      switch (state.status) {
        case 'idle':
          return;
        case 'loading':
          status({ state: 'loading' });
          return;
        case 'negotiating':
          if (!pendingConsent) {
            status({
              state: 'negotiating',
              awaitingClient: (state.awaitingCapabilities?.length ?? 0) > 0,
              origin,
              preapproved,
            });
          }
          return;
        case 'ready':
          status({
            state: 'ready',
            preapproved,
            limits: limitsOf(state.capabilities),
          });
          if (widgetPolicy?.eventNamespace) {
            // A NeoBoard inside NeoBoard: let members write their session
            // state of the embedded board (only a moderator can do this).
            void widgetApiPromise.then((widgetApi) =>
              prepareNestedBoardPowerLevels(
                widgetApi,
                widgetPolicy.eventNamespace,
              ),
            );
          }
          return;
        case 'error': {
          const code = state.code ?? state.reason;
          status({
            state: 'error',
            reason: state.reason,
            code,
            message: state.message,
            // A retry cannot fix a refused URL or origin.
            ...(!isPermanentEmbeddedWidgetErrorCode(code) && {
              retry: () =>
                state.reason === 'denied'
                  ? handle?.retryCapabilities()
                  : handle?.reload(),
            }),
          });
          return;
        }
      }
    };

    const mount = async () => {
      const { m, widgetApi } = await load();
      if (destroyed) {
        return;
      }
      if (!widgetPolicy) {
        status({
          state: 'error',
          reason: 'load-failed',
          code: 'policy',
          message: 'This widget is not allowed by the deployment policy',
        });
        return;
      }
      const outerApi = outerApiOf(widgetApi);
      const policy = {
        allowedCapabilities:
          widgetPolicy.allowedCapabilities ?? m.POLL_CAPABILITIES,
        deniedCapabilities: boardOwnCapabilities,
      };
      // With an event namespace, capabilities are checked and requested in
      // the rewritten form (as the client sees them).
      const namespace = new m.EventTypeRewriter(widgetPolicy.eventNamespace);

      // Capabilities declared in the shell: ask the user once (unless the
      // operator pre-approved the widget), then request them from the client
      // while the widget boots.
      const declared = (
        maxCapabilityRequests === 0 ? [] : (props.capabilities ?? [])
      ).flatMap((c) => {
        const r = namespace.upCapability(c);
        return r.ok ? [r.capability] : [];
      });
      if (declared.length > 0) {
        const { allowed } = m.applyCapabilityPolicy(declared, {
          allowed: policy.allowedCapabilities,
          denied: policy.deniedCapabilities,
        });
        const known = consented.get(consentKey);
        const missing = allowed.filter((c) => !known?.has(c));
        if (missing.length > 0) {
          const approved = preapproved
            ? true
            : await askUser({
                origin,
                url: props.widgetUrl.split(/[?#]/)[0],
                capabilities: allowed,
                upstream: allowed.filter((c) => !outerApi.hasCapability?.(c)),
              });
          if (destroyed) {
            return;
          }
          if (approved) {
            m.prerequestCapabilities({
              outerApi,
              capabilities: allowed,
              ...policy,
            }).catch((error) =>
              loglevel.warn('Capability pre-request failed', error),
            );
          }
        }
      }

      const params = widgetApi.widgetParameters;
      handle = m.mountEmbeddedWidget({
        container: props.container,
        widgetUrl: props.widgetUrl,
        widgetId: props.elementId,
        outerApi,
        allowedOrigins,
        params: {
          userId: params.userId ?? '',
          roomId: params.roomId ?? '',
          displayName: params.displayName,
          avatarUrl: params.avatarUrl,
          theme: params.theme,
          clientId: params.clientId,
          clientLanguage: params.clientLanguage,
          baseUrl: params.baseUrl,
          deviceId: params.deviceId,
        },
        ...policy,
        ...(widgetPolicy.eventNamespace
          ? { eventNamespace: widgetPolicy.eventNamespace }
          : {}),
        name: widgetPolicy.name ?? props.title,
        title: props.title,
        modals,
        ...(modals === 'inline' && { onModalRequest }),
        openId: widgetPolicy.identityApproved ? 'forward' : 'deny',
        // Calls: operator opt-in only (policy `matrixrtc`).
        ...(widgetPolicy.matrixRtc && {
          matrixRtc: true,
          onMatrixRtcEvent: (event) => {
            if (destroyed) return;
            // A running call is pinned: never evicted by the live-widget cap.
            if (event.kind === 'always-on-screen') {
              props.setKeepAlive?.(event.value);
            } else if (event.kind === 'hung-up' || event.kind === 'close') {
              props.setKeepAlive?.(false);
            } else if (event.kind === 'joined') {
              props.setKeepAlive?.(true);
            }
          },
        }),
        ...(widgetPolicy.mediaPermissions && {
          mediaPermissions: widgetPolicy.mediaPermissions,
        }),
        ...(maxCapabilityRequests !== undefined && { maxCapabilityRequests }),
        confirmCapabilities,
        onStateChange,
        onEventSent: (event) =>
          !destroyed &&
          props.onActivity({ kind: 'shared-change', eventType: event.type }),
        logger: {
          debug: (message, data) => loglevel.debug(message, data),
          warn: (message, data) => loglevel.warn(message, data),
        },
      });
      handle.setPaused(isPaused(viewState));
    };

    status({ state: 'loading' });
    mount().catch((error) => {
      loglevel.error('Could not mount the embedded widget', error);
      status({
        state: 'error',
        code: 'load-failed',
        message: String(error?.message ?? error),
      });
    });

    return {
      unmount: () => {
        props.setKeepAlive?.(false);
        destroyed = true;
        pendingConsent?.(false);
        handle?.destroy();
        handle = undefined;
      },
      update: (next: EmbeddedWidgetRendererProps['viewState']) => {
        viewState = next;
        handle?.setPaused(isPaused(next));
      },
    };
  };

  return { renderer, preload };
}

function modalStatus(state: EmbeddedWidgetState): EmbeddedWidgetModalStatus {
  switch (state.status) {
    case 'ready':
      return { state: 'ready' };
    case 'error':
      return { state: 'error', code: state.code, message: state.message };
    default:
      return { state: 'loading' };
  }
}

/**
 * Key of the session consent: origin and path of the widget URL, normalised
 * like the policy (query and fragment ignored).
 */
export function widgetConsentKey(widgetUrl: string): string {
  const key = policyMatchKey(widgetUrl);
  if (key !== undefined) return key;
  try {
    const url = new URL(widgetUrl);
    return url.origin + url.pathname;
  } catch {
    return widgetUrl.split(/[?#]/)[0];
  }
}

/** What the widget asked for and cannot get here (policy, hard limits). */
function limitsOf(summary: CapabilitySummary | undefined) {
  return summary
    ? { requested: summary.requested, blocked: summary.blockedByPolicy }
    : undefined;
}

function isPaused(viewState: EmbeddedWidgetRendererProps['viewState']) {
  return !viewState.visible || viewState.gesturing;
}

function outerApiOf(widgetApi: WidgetApi): OuterWidgetApi {
  // The toolkit's implementation exposes the raw matrix-widget-api instance
  // (not part of its public interface). Structurally compatible; typed
  // separately so the host may use another matrix-widget-api version.
  const outer = (widgetApi as WidgetApi & { matrixWidgetApi?: unknown })
    .matrixWidgetApi;
  if (!outer) {
    throw new Error('The widget API does not expose its Matrix widget API');
  }
  return outer as OuterWidgetApi;
}
