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
  IOpenIDCredentials,
  IRoomEvent,
  IWidgetApiRequest,
} from 'matrix-widget-api';
import type { MatrixRtcHostEvent } from './matrixRtc';
import type { RateLimit } from './rateLimit';

/**
 * The part of the widget-side `WidgetApi` (matrix-widget-api) that the host
 * widget owns towards its own client (e.g. Element). Typed structurally so
 * that the host may use a different matrix-widget-api version than this
 * package. A toolkit widget passes `widgetApi.matrixWidgetApi`.
 */
export interface OuterWidgetApi {
  readonly transport: OuterTransport;
  on(
    event: string,
    listener: (ev: CustomEvent<IWidgetApiRequest>) => void,
  ): unknown;
  off(
    event: string,
    listener: (ev: CustomEvent<IWidgetApiRequest>) => void,
  ): unknown;
  /** Adds capabilities to the list that the next (re)negotiation asks for. */
  requestCapabilities(capabilities: string[]): void;
  /** Sends an MSC2974 renegotiation with *all* capabilities requested so far. */
  updateRequestedCapabilities(): Promise<void>;
  /** Whether the outer client approved a capability (initial handshake). */
  hasCapability?(capability: string): boolean;
  /**
   * Asks the outer client for an OpenID token of the user (only used with
   * `openId: 'forward'`).
   */
  requestOpenIDConnectToken?(): Promise<IOpenIDCredentials>;
}

export interface OuterTransport {
  /** Widget id of the host widget (never handed to an embedded widget). */
  readonly widgetId?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(action: any, data: any): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reply(request: any, responseData: any): void;
}

/**
 * Parameters of the host widget, used to fill the embedded widget's URL
 * template. Same shape as the toolkit's `widgetApi.widgetParameters`.
 */
export interface EmbeddedWidgetParams {
  userId: string;
  roomId: string;
  displayName?: string;
  avatarUrl?: string;
  theme?: string;
  clientId?: string;
  clientLanguage?: string;
  baseUrl?: string;
  deviceId?: string;
}

export type EmbeddedWidgetErrorReason = 'denied' | 'load-failed' | 'timeout';

export type EmbeddedWidgetState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'negotiating';
      /** Capabilities currently waiting for the user's decision upstream. */
      awaitingCapabilities?: string[];
    }
  | {
      status: 'ready';
      capabilities: CapabilitySummary;
    }
  | {
      status: 'error';
      reason: EmbeddedWidgetErrorReason;
      message: string;
      capabilities?: CapabilitySummary;
    };

export interface CapabilitySummary {
  /** Everything the embedded widget asked for (cumulative). */
  requested: string[];
  /** What the embedded widget got (policy-allowed ∩ approved upstream). */
  granted: string[];
  /** Refused by policy: not allow-listed, configured or hard denied. */
  blockedByPolicy: string[];
  /** Refused by the local consent hook (`confirmCapabilities`). */
  deniedLocally: string[];
  /** Policy-allowed, but not approved by the outer client / user. */
  deniedUpstream: string[];
}

export interface CapabilityRequestInfo {
  /** The embedded widget's own (derived) widget id. */
  widgetId: string;
  /** Display name passed in the options, if any. */
  name?: string;
  /** Origin of the embedded widget, e.g. `https://poll.example`. */
  origin: string;
  /** URL without query and fragment (no user parameters). */
  url: string;
  /**
   * Every policy-allowed capability the widget asked for in this round,
   * including those the host already holds. All of them are disclosed so the
   * UI can name the widget: holding a grant upstream is not consent to hand
   * it to a third-party origin.
   */
  capabilities: string[];
  /** Subset the host already holds (no dialog from the outer client). */
  inherited: string[];
  /** Subset that needs the outer client's approval (its dialog). */
  upstream: string[];
}

export interface CapabilityRequestEvent extends CapabilityRequestInfo {
  /** Resolves when the request is answered (or not answered in time). */
  settled: Promise<CapabilityRequestResult>;
}

export interface CapabilityRequestResult {
  approved: string[];
  denied: string[];
  /** `true` if the outer client did not answer (timeout or failure). */
  timedOut: boolean;
}

/** How room state changes are delivered to the embedded widget. */
export type UpdateStateMode =
  /**
   * Never send `update_state`; every state change is delivered as
   * `send_event` and `update_state` is not advertised. Required for
   * matrix-widget-toolkit widgets (they reject `update_state`).
   */
  | 'never'
  /**
   * Advertise MSC2762 `update_state`; use it for widgets that announce
   * support for it and fall back to `send_event` otherwise.
   */
  | 'auto';

export type ModalMode = 'forward' | 'deny';

/** Whether OpenID requests of the embedded widget reach the outer client. */
export type OpenIdMode = 'forward' | 'deny';

/** Metadata of an event an embedded widget sent (no content). */
export interface SentEventInfo {
  type: string;
  /** Set for state events. */
  stateKey?: string;
  eventId?: string;
}

export interface MediationLogger {
  debug(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
}

export interface MountEmbeddedWidgetOptions {
  /** Element the iframe is appended to. */
  container: HTMLElement;
  /** https URL (template) of the embedded widget. `$matrix_*` vars are filled. */
  widgetUrl: string;
  /**
   * Stable id of the embedding (e.g. the board element id). The embedded
   * widget gets a widget id *derived* from it, never the host's widget id.
   */
  widgetId: string;
  /**
   * The host widget's own API towards its client. May be a promise so the
   * iframe can start loading while the host's own handshake is still running.
   */
  outerApi: OuterWidgetApi | Promise<OuterWidgetApi>;
  /**
   * Origins embedded widgets may be loaded from (e.g.
   * `['https://poll.example']`). Required. This must come from the
   * deployment's configuration, never from room or board content: the
   * embedded widget acts with the host widget's grants.
   */
  allowedOrigins: readonly string[];
  /** Host widget parameters used to fill the URL template. */
  params: EmbeddedWidgetParams;
  /**
   * Allow-list: capabilities the embedded widget may get at most (exact
   * strings). Defaults to {@link POLL_CAPABILITIES}. A hard deny-list
   * (widget registrations, room-admin state, redactions, other rooms,
   * to-device, media, TURN, delayed/sticky events, MatrixRTC) always wins.
   */
  allowedCapabilities?: readonly string[];
  /** Treat `….*`/`…#*` suffixes in the allow-list as globs (not for `send`). */
  allowCapabilityGlobs?: boolean;
  /**
   * Additional denials, e.g. the host widget's own namespace (exact or
   * `prefix*`). Evaluated after the allow-list.
   */
  deniedCapabilities?: readonly string[];
  /**
   * Local consent before anything is granted or requested upstream.
   * Resolve with the capabilities the user agreed to (or `true`/`false` for
   * all/none). Without it, policy-allowed capabilities proceed and are only
   * reported through `onCapabilityRequest`.
   */
  confirmCapabilities?: (
    request: CapabilityRequestInfo,
  ) => Promise<boolean | readonly string[]>;
  /**
   * Max. capability rounds that need the outer client's dialog, per mounted
   * widget (reloads included). Default 3.
   */
  maxCapabilityRequests?: number;
  /**
   * Toolkit URL parameters supplied to the widget (`theme`,
   * `matrix_user_id`, …). Default: all of them (toolkit widgets need all).
   * Parameters not listed are left empty.
   */
  urlParameters?: readonly string[];
  /** Human readable name shown by the UI when capabilities are requested. */
  name?: string;
  /** Additional values for `$key` template variables (like widget `data`). */
  data?: Record<string, unknown>;
  /** Default `'never'` (matrix-widget-toolkit compatible). */
  updateState?: UpdateStateMode;
  /**
   * Forward `open_modal` to the outer client. Default `'deny'`. Forwarding
   * opens a top-level modal of the outer client under the host's identity;
   * only the embedded widget's own origin is accepted as modal URL.
   */
  modals?: ModalMode;
  /**
   * Forward OpenID requests (`get_openid`) to the outer client. Default
   * `'deny'`. The token identifies the **user** to the embedded widget's
   * backend; the outer client asks (or remembers) under the host's
   * identity. Enable only for operator-trusted widgets that need it.
   */
  openId?: OpenIdMode;
  /**
   * Keep `allow-same-origin` in the iframe sandbox. Default `true`; most
   * widgets need storage and module scripts. The widget must never share the
   * host's origin (enforced).
   */
  sandboxSameOrigin?: boolean;
  /** Extra sandbox tokens. `allow-top-navigation*` are always dropped. */
  sandboxExtras?: readonly string[];
  /** Permissions policy (`allow` attribute). Default: none. */
  allow?: string;
  /**
   * Media features delegated to the widget (`camera`, `microphone`,
   * `display-capture`, `autoplay`, `encrypted-media`, `clipboard-*`).
   * Builds the `allow` attribute from known features only and wins over
   * `allow`. The host's own frame must have them, too.
   */
  mediaPermissions?: readonly string[];
  /**
   * MatrixRTC call widget (e.g. Element Call). **Operator opt-in only**,
   * default `false`. Lifts the hard deny-list for exactly the call
   * capabilities of the host's own user and device
   * (`matrixRtcCapabilities`), forwards to-device messages, delayed and
   * sticky events and RTC transports, grants `m.always_on_screen` locally,
   * acknowledges the call's host actions and never pauses event delivery.
   * Requires `params.deviceId`.
   */
  matrixRtc?: boolean;
  /** Budget of the MatrixRTC traffic. Default 20 burst, 2 per second. */
  rtcRateLimit?: RateLimit;
  /**
   * Host actions of a MatrixRTC widget (joined, hung up, always on screen,
   * …). A host should keep a widget alive (never evict or unmount it) while
   * it asked to be always on screen.
   */
  onMatrixRtcEvent?: (event: MatrixRtcHostEvent) => void;
  /** Accessible title of the iframe. */
  title?: string;
  /** Milliseconds to wait for the iframe `load` event. Default 30000. */
  loadTimeoutMs?: number;
  /**
   * If the outer client does not echo an event the embedded widget sent
   * within this time, a local echo is delivered (toolkit widgets wait for the
   * echo). `0` disables. Default 5000.
   */
  echoFallbackMs?: number;
  /** Send budget of this embedded widget. Default 5 burst, 1 per 3 s. */
  rateLimit?: RateLimit;
  /**
   * Event type namespace (see `namespace.ts`): original type prefix →
   * rewritten prefix below `net.neoboardception.nested.`. The widget's
   * event types are rewritten on the way up and back on the way down, so
   * it works on its own copy of the types. Capabilities in
   * `allowedCapabilities` and `deniedCapabilities` are matched in the
   * rewritten form. Also enables to-device messages for rewritten types.
   * Off by default. An invalid map refuses the widget (`load-failed`).
   */
  eventNamespace?: Readonly<Record<string, string>>;
  /** To-device budget (namespaced widgets only). Default 10 burst, 1/s. */
  toDeviceRateLimit?: RateLimit;
  /** Max. queued sends before failing fast. Default 20. */
  maxQueuedSends?: number;
  /** Upper bound for `limit` of timeline reads. Default 1000. */
  maxTimelineReadLimit?: number;
  /** Allow `http://localhost` URLs (development only). Default `false`. */
  allowInsecureLocalhost?: boolean;
  onStateChange?: (state: EmbeddedWidgetState) => void;
  /** Called for every capability round (who asks for what). */
  onCapabilityRequest?: (request: CapabilityRequestEvent) => void;
  /**
   * Called after the outer client accepted an event the embedded widget
   * sent, i.e. a change to shared room state or timeline that other room
   * members can see. Receives no event content.
   */
  onEventSent?: (event: SentEventInfo) => void;
  logger?: MediationLogger;
}

export interface EmbeddedWidgetHandle {
  /** The embedded widget's own widget id. */
  readonly widgetId: string;
  /** The iframe, or `undefined` if the URL was refused. */
  readonly iframe: HTMLIFrameElement | undefined;
  getState(): EmbeddedWidgetState;
  /** Tear down the iframe and start again (e.g. after an error). */
  reload(): void;
  /**
   * Reload and ask the outer client again for capabilities that were
   * denied earlier in this session. Use only for an explicit user action.
   */
  retryCapabilities(): void;
  /**
   * Stop delivering room events while the widget is hidden. Events are
   * buffered (bounded) and delivered on resume; if the buffer overflowed
   * the widget is reloaded on resume to resynchronise. No effect for
   * MatrixRTC widgets: a running call keeps receiving everything.
   */
  setPaused(paused: boolean): void;
  /** Remove the iframe and all listeners. Idempotent. */
  destroy(): void;
}

/** A to-device message as the client delivers it (`send_to_device`). */
export interface ToDeviceMessage {
  type: string;
  sender: string;
  content: Record<string, unknown>;
  encrypted?: boolean;
}

/** A room event as delivered by the Widget API. */
export type RoomEvent = IRoomEvent;

/** Settings shared by all embedded widgets of one host widget. */
export interface MediationConfig {
  /**
   * Max. time to wait for the user's decision upstream. Default 300000 (a
   * human reads a dialog).
   */
  capabilityTimeoutMs?: number;
  /** Merge capability requests arriving within this window. Default 50 ms. */
  capabilityBatchMs?: number;
  /**
   * Send budget shared by all embedded widgets, so the host's own writes
   * keep their share of the homeserver rate limit. Default 8 burst, 1 per 2 s.
   */
  aggregateRateLimit?: RateLimit;
  logger?: MediationLogger;
}
