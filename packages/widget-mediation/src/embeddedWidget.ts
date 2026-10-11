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
  IOpenIDCredentials,
  IOpenIDUpdate,
  IReadEventRelationsResult,
  IRoomEvent,
  ISendEventDetails,
  IWidgetApiRequest,
  SimpleObservable,
} from 'matrix-widget-api';
import {
  ClientWidgetApi,
  MatrixApiVersion,
  OpenIDRequestState,
  UnstableApiVersion,
  Widget,
  WidgetApiFromWidgetAction,
} from 'matrix-widget-api';
import {
  applyCapabilityPolicy,
  DEFAULT_ALLOWED_CAPABILITIES,
  isHardDenied,
  isNamespacedToDevice,
} from './capabilities';
import { DriverHost, ForwardingDriver } from './driver';
import {
  ALWAYS_ON_SCREEN_CAPABILITY,
  buildAllowAttribute,
  CALL_HOST_ACTIONS,
  CALL_TO_DEVICE_TYPES,
  MATRIXRTC_API_VERSIONS,
  matrixRtcCapabilities,
  matrixRtcLocalCapabilities,
  type MatrixRtcHostEvent,
} from './matrixRtc';
import { registerWithMessageGuard } from './messageGuard';
import { EventTypeRewriter } from './namespace';
import { acquireHub, HubMember, OuterHub } from './outerHub';
import { RateLimit, SendThrottle, TokenBucket } from './rateLimit';
import { DEFAULT_RTC_RATE_LIMIT, RtcBridge } from './rtcBridge';
import type {
  CapabilityRequestInfo,
  CapabilityRequestResult,
  CapabilitySummary,
  EmbeddedWidgetHandle,
  EmbeddedWidgetState,
  MountEmbeddedWidgetOptions,
  ToDeviceMessage,
} from './types';
import {
  buildWidgetUrl,
  deriveEmbeddedWidgetId,
  displayUrl,
  validateWidgetUrl,
  WidgetUrlError,
} from './url';

const DEFAULTS = {
  loadTimeoutMs: 30_000,
  echoFallbackMs: 5_000,
  rateLimit: { burst: 5, perSecond: 1 / 3 } as RateLimit,
  toDeviceRateLimit: { burst: 10, perSecond: 1 } as RateLimit,
  maxQueuedSends: 20,
  maxCapabilityRequests: 3,
  maxTimelineReadLimit: 1000,
};

/** Marks an event the mediator synthesised (not from the server). */
export const LOCAL_ECHO_MARKER = 'local_echo';

/** Sandbox tokens; never `allow-top-navigation*`. */
const BASE_SANDBOX = [
  'allow-scripts',
  'allow-forms',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-downloads',
];

const MAX_DELIVERED_IDS = 500;
const MAX_PAUSED_EVENTS = 200;
const MIN_RETRY_INTERVAL_MS = 10_000;
const MAX_TO_DEVICE_WAIT_MS = 10_000;
const MAX_TO_DEVICE_RECIPIENTS = 500;

const ACTION_READ_EVENTS = 'org.matrix.msc2876.read_events';
const ACTION_READ_RELATIONS = 'org.matrix.msc3869.read_relations';

function supportedVersions(updateState: boolean, rtc: boolean): string[] {
  return [
    MatrixApiVersion.Prerelease1,
    MatrixApiVersion.Prerelease2,
    UnstableApiVersion.MSC2762,
    UnstableApiVersion.MSC2871,
    UnstableApiVersion.MSC2873,
    UnstableApiVersion.MSC2876,
    UnstableApiVersion.MSC2974,
    UnstableApiVersion.MSC3869,
    ...(updateState ? [UnstableApiVersion.MSC2762_UPDATE_STATE] : []),
    ...(rtc ? MATRIXRTC_API_VERSIONS : []),
  ];
}

function normaliseOrigin(origin: string): string | undefined {
  try {
    return new URL(origin).origin;
  } catch {
    return undefined;
  }
}

interface ReadEventsRequest {
  type?: string;
  msgtype?: string;
  state_key?: string | boolean;
  limit?: number;
  since?: string;
  room_ids?: string[] | string;
}

/**
 * Mounts an embedded widget into `container` and plays the client side of
 * the Widget API for it, forwarding upward through the host's outer API.
 */
export function mountEmbeddedWidget(
  options: MountEmbeddedWidgetOptions,
): EmbeddedWidgetHandle {
  return new EmbeddedWidget(options);
}

class EmbeddedWidget implements EmbeddedWidgetHandle, HubMember, DriverHost {
  readonly widgetId: string;
  readonly roomId: string;
  private state: EmbeddedWidgetState = { status: 'idle' };
  private url: URL | undefined;
  private _iframe: HTMLIFrameElement | undefined;
  private client: ClientWidgetApi | undefined;
  private hub: OuterHub | undefined;
  private readonly hubReady: Promise<OuterHub>;
  private abort = new AbortController();
  private teardown: Array<() => void> = [];
  private throttle: SendThrottle | undefined;
  private readonly bucket: TokenBucket;
  private readonly toDeviceBucket: TokenBucket;
  /** Event type namespace of this widget (see `namespace.ts`). */
  private readonly ns: EventTypeRewriter;
  private nsError: string | undefined;
  private destroyed = false;
  private handshakeDone = false;
  private deniedError = false;
  private retryDenied = false;
  private lastRetry = 0;
  private upstreamRequests = 0;
  private validating = false;
  private summary = emptySummary();
  private readonly allowedOrigins: Set<string>;
  private allowedSoFar = new Set<string>();
  private readonly delivered = new Set<string>();
  private readonly echoTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private paused = false;
  private pausedEvents: Array<() => void> = [];
  private pausedOverflow = false;
  /** MatrixRTC opt-in: exact capability strings exempt from the hard deny-list. */
  private readonly rtcCapabilities: readonly string[];
  private _rtc: RtcBridge | undefined;

  constructor(private readonly o: MountEmbeddedWidgetOptions) {
    this.roomId = o.params.roomId;
    this.rtcCapabilities = o.matrixRtc
      ? matrixRtcCapabilities({
          userId: o.params.userId,
          deviceId: o.params.deviceId,
          roomId: o.params.roomId,
        })
      : [];
    this.allowedOrigins = new Set(
      o.allowedOrigins.map(normaliseOrigin).filter((x): x is string => !!x),
    );
    const syncOuter = isPromiseLike(o.outerApi) ? undefined : o.outerApi;
    this.widgetId = deriveEmbeddedWidgetId(
      o.widgetId,
      syncOuter?.transport.widgetId,
    );
    this.bucket = new TokenBucket(o.rateLimit ?? DEFAULTS.rateLimit);
    this.toDeviceBucket = new TokenBucket(
      o.toDeviceRateLimit ??
        (o.matrixRtc ? DEFAULT_RTC_RATE_LIMIT : DEFAULTS.toDeviceRateLimit),
    );
    let ns: EventTypeRewriter;
    try {
      ns = new EventTypeRewriter(o.eventNamespace);
    } catch (e) {
      // Fail closed: an invalid map never mounts the widget.
      this.nsError = (e as Error).message;
      ns = new EventTypeRewriter();
    }
    this.ns = ns;

    this.hubReady = Promise.resolve(o.outerApi).then((outer) => {
      if (
        outer.transport.widgetId &&
        this.widgetId.includes(outer.transport.widgetId)
      ) {
        throw new WidgetUrlError('Embedded widget id leaks the host id');
      }
      const hub = acquireHub(outer);
      if (!this.destroyed) {
        this.hub = hub;
        hub.add(this);
      }
      return hub;
    });
    this.hubReady.catch((e) =>
      this.fail('load-failed', String(e?.message ?? e)),
    );

    this.start();
  }

  get iframe(): HTMLIFrameElement | undefined {
    return this._iframe;
  }

  /** MatrixRTC forwarding of the current iframe (opt-in widgets only). */
  get rtc(): RtcBridge | undefined {
    return this._rtc;
  }

  getState(): EmbeddedWidgetState {
    return this.state;
  }

  // ---------------------------------------------------------------- lifecycle

  private setState(state: EmbeddedWidgetState) {
    if (this.destroyed) return;
    this.state = state;
    this.o.onStateChange?.(state);
  }

  private fail(reason: 'denied' | 'load-failed' | 'timeout', message: string) {
    this.setState({
      status: 'error',
      reason,
      message,
      capabilities: this.summaryCopy(),
    });
  }

  private start() {
    this.setState({ status: 'loading' });
    const hostOrigin = window.location.origin;
    const allowed = this.allowedOrigins;
    try {
      if (this.nsError) throw new WidgetUrlError(this.nsError);
      this.url = validateWidgetUrl(this.o.widgetUrl, {
        hostOrigin,
        allowInsecureLocalhost: this.o.allowInsecureLocalhost,
      });
      if (!allowed.has(this.url.origin)) {
        throw new WidgetUrlError(
          `Widget origin ${this.url.origin} is not in the allowed origins`,
        );
      }
    } catch (e) {
      this.fail('load-failed', (e as Error).message);
      return;
    }
    const url = this.url;
    if (sameSite(url.hostname, window.location.hostname)) {
      this.o.logger?.warn(
        'embedded widget is same-site with the host; prefer a separate site',
        url.origin,
      );
    }
    const signal = this.abort.signal;
    const sameOrigin = this.o.sandboxSameOrigin ?? true;

    const iframe = document.createElement('iframe');
    iframe.title = this.o.title ?? this.o.name ?? 'Embedded widget';
    iframe.setAttribute(
      'sandbox',
      [
        ...BASE_SANDBOX,
        ...(sameOrigin ? ['allow-same-origin'] : []),
        ...(this.o.sandboxExtras ?? []).filter(
          (t) =>
            !t.startsWith('allow-top-navigation') &&
            (sameOrigin || t !== 'allow-same-origin'),
        ),
      ].join(' '),
    );
    // Fill the container; the host sizes the container.
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    iframe.style.display = 'block';
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute(
      'allow',
      this.o.mediaPermissions
        ? buildAllowAttribute(this.o.mediaPermissions)
        : (this.o.allow ?? ''),
    );
    iframe.src = buildWidgetUrl({
      widgetUrl: url,
      widgetId: this.widgetId,
      params: this.o.params,
      parentOrigin: hostOrigin,
      data: this.o.data,
      parameters: this.o.urlParameters,
    });
    this.o.container.appendChild(iframe);
    this._iframe = iframe;
    const contentWindow = iframe.contentWindow;
    if (!contentWindow) {
      this.fail('load-failed', 'The iframe has no window');
      return;
    }

    this.teardown.push(
      registerWithMessageGuard(
        window,
        this.widgetId,
        { window: contentWindow, origin: sameOrigin ? url.origin : 'null' },
        {
          onBlocked: (reason, widgetId) =>
            this.o.logger?.warn('blocked postMessage', { reason, widgetId }),
        },
      ),
    );

    // Registered before ClientWidgetApi's own listener. A second `load` means
    // the frame navigated; its new origin cannot be confirmed, so stop.
    let loads = 0;
    const loadTimer = setTimeout(
      () => this.fail('timeout', 'The widget did not load in time'),
      this.o.loadTimeoutMs ?? DEFAULTS.loadTimeoutMs,
    );
    iframe.addEventListener(
      'load',
      () => {
        clearTimeout(loadTimer);
        if (++loads > 1) {
          this.stopCurrent();
          this.fail('load-failed', 'The widget navigated away');
          return;
        }
        if (this.state.status === 'loading') {
          this.setState({ status: 'negotiating' });
        }
      },
      { signal },
    );
    iframe.addEventListener(
      'error',
      () => this.fail('load-failed', 'The widget failed to load'),
      { signal },
    );

    const widget = new Widget({
      id: this.widgetId,
      creatorUserId: this.o.params.userId,
      type: 'm.custom',
      url: url.toString(),
      waitForIframeLoad: true,
    });
    const client = new ClientWidgetApi(
      widget,
      iframe,
      new ForwardingDriver(this),
    );
    // An opaque (sandboxed) origin can only be addressed with '*'.
    if (!sameOrigin) client.transport.targetOrigin = '*';
    this.client = client;
    client.setViewedRoomId(this.roomId);

    const on = (action: string, handler: (req: IWidgetApiRequest) => void) =>
      client.on(`action:${action}`, (ev: CustomEvent<IWidgetApiRequest>) => {
        ev.preventDefault();
        handler(ev.detail);
      });
    on(WidgetApiFromWidgetAction.SupportedApiVersions, (req) =>
      client.transport.reply(req, {
        supported_versions: supportedVersions(
          this.o.updateState === 'auto',
          !!this.o.matrixRtc,
        ),
      }),
    );
    on(WidgetApiFromWidgetAction.ContentLoaded, (req) =>
      client.transport.reply(req, {}),
    );
    on(ACTION_READ_EVENTS, (req) => void this.handleReadEvents(req));
    on(
      WidgetApiFromWidgetAction.OpenModalWidget,
      (req) => void this.handleOpenModal(req),
    );

    if (this.o.matrixRtc) {
      const hubReady = this.hubReady;
      const rtc = new RtcBridge({
        outer: () => hubReady.then((hub) => hub.outer),
        roomId: this.roomId,
        rateLimit: this.o.rtcRateLimit,
        logger: this.o.logger,
      });
      this._rtc = rtc;
      this.registerCallHostActions(client, on);
      this.teardown.push(() => {
        this._rtc = undefined;
        // The widget disappears without saying goodbye: what it scheduled
        // for "when I am gone" (the delayed leave of a call membership)
        // applies now, not after the delay.
        void rtc.flush();
      });
    }

    client.on('ready', () => {
      this.handshakeDone = true;
      if (!this.deniedError) {
        this.setState({ status: 'ready', capabilities: this.summaryCopy() });
      }
    });
    client.on('error:preparing', (e: unknown) => {
      const msg = String((e as Error)?.message ?? e);
      this.fail(/timed out/i.test(msg) ? 'timeout' : 'load-failed', msg);
    });

    this.throttle = new SendThrottle(
      () =>
        this.hub ? [this.bucket, this.hub.aggregateBucket] : [this.bucket],
      this.o.maxQueuedSends ?? DEFAULTS.maxQueuedSends,
    );
    const throttle = this.throttle;

    this.teardown.push(() => {
      clearTimeout(loadTimer);
      throttle.stop();
      client.stop();
      client.removeAllListeners();
      // Blank first so the out-of-process frame stops work promptly.
      iframe.src = 'about:blank';
      iframe.remove();
    });
  }

  private stopCurrent() {
    this.abort.abort();
    this.abort = new AbortController();
    this.teardown
      .splice(0)
      .reverse()
      .forEach((fn) => fn());
    this.echoTimers.forEach((t) => clearTimeout(t));
    this.echoTimers.clear();
    this.delivered.clear();
    this.client = undefined;
    this._iframe = undefined;
    this.throttle = undefined;
    this.handshakeDone = false;
    this.deniedError = false;
    this.summary = emptySummary();
    this.allowedSoFar.clear();
    this.pausedEvents = [];
    this.pausedOverflow = false;
  }

  reload(): void {
    if (this.destroyed) return;
    this.stopCurrent();
    this.start();
  }

  retryCapabilities(): void {
    this.retryDenied = true;
    this.reload();
  }

  setPaused(paused: boolean): void {
    // A running call must keep receiving keys and membership changes.
    if (this.o.matrixRtc) return;
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) return;
    if (this.pausedOverflow) {
      this.reload();
      return;
    }
    const queued = this.pausedEvents.splice(0);
    queued.forEach((fn) => fn());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.stopCurrent();
    this.hub?.remove(this);
    this.state = { status: 'idle' };
    this.destroyed = true;
  }

  // ------------------------------------------------------------ capabilities

  /**
   * Decides what the embedded widget gets, for the initial handshake and for
   * MSC2974 renegotiations:
   * 1. policy (allow-list, configured and hard deny-lists);
   * 2. disclosure and local consent: every allowed capability is reported
   *    via `onCapabilityRequest`, also those the host already holds, and
   *    `confirmCapabilities` may refuse them;
   * 3. outer client: missing ones are requested as a union renegotiation
   *    (batched, serialised, denials cached), within a per-widget budget;
   * 4. result: exactly the requested strings that are approved upstream.
   */
  async validateCapabilities(
    requested: Set<Capability>,
  ): Promise<Set<Capability>> {
    const signal = this.abort.signal;
    const hub = await this.hubReady;
    const initial = !this.handshakeDone;
    if (this.validating) {
      // At most one pending capability round per widget.
      this.o.logger?.warn('capability request ignored: one is pending');
      return new Set();
    }
    this.validating = true;
    try {
      return await this.validateInternal(hub, requested, initial, signal);
    } finally {
      this.validating = false;
    }
  }

  private async validateInternal(
    hub: OuterHub,
    requested: Set<Capability>,
    initial: boolean,
    signal: AbortSignal,
  ): Promise<Set<Capability>> {
    const rtcLocal = this.o.matrixRtc
      ? matrixRtcLocalCapabilities({ roomId: this.roomId })
      : [];
    // Rewrite first (event type namespace), then apply the policy to the
    // capabilities as the client will see them. Everything below works on
    // the rewritten form; the widget gets its own strings back at the end.
    const { upward, forbidden, originalsOf } = this.rewriteRequested(requested);
    const policyResult = applyCapabilityPolicy(upward, {
      allowed: [
        ...(this.o.allowedCapabilities ?? DEFAULT_ALLOWED_CAPABILITIES),
        ...this.rtcCapabilities,
        ...rtcLocal,
      ],
      denied: this.o.deniedCapabilities ?? [],
      globs: this.o.allowCapabilityGlobs,
      lifted: [...this.rtcCapabilities, ...rtcLocal],
    });
    const allowed = policyResult.allowed;
    const blocked = [...forbidden, ...policyResult.blocked];
    if (blocked.length > 0) {
      this.o.logger?.warn('capabilities blocked by policy', blocked);
    }
    [...forbidden, ...upward].forEach((c) => this.summary.requested.add(c));
    blocked.forEach((c) => this.summary.blockedByPolicy.add(c));

    const info = (caps: string[]): CapabilityRequestInfo => ({
      widgetId: this.widgetId,
      name: this.o.name,
      origin: this.url!.origin,
      url: displayUrl(this.url!),
      capabilities: caps,
      inherited: caps.filter(
        (c) => rtcLocal.includes(c) || hub.broker.isApproved(c),
      ),
      upstream: caps.filter(
        (c) => !rtcLocal.includes(c) && !hub.broker.isApproved(c),
      ),
    });

    let consented = allowed;
    if (allowed.length > 0 && this.o.confirmCapabilities) {
      let answer: boolean | readonly string[] = false;
      try {
        answer = await this.o.confirmCapabilities(info(allowed));
      } catch (e) {
        this.o.logger?.warn('local consent failed', String(e));
      }
      if (signal.aborted) return new Set();
      consented =
        answer === true
          ? allowed
          : answer === false
            ? []
            : allowed.filter((c) => answer.includes(c));
      allowed
        .filter((c) => !consented.includes(c))
        .forEach((c) => this.summary.deniedLocally.add(c));
    }

    // A renegotiation by a running widget counts as an explicit retry (the
    // toolkit only does this from its "Retry" button), rate limited.
    let retryDenied = this.retryDenied;
    this.retryDenied = false;
    if (!initial && Date.now() - this.lastRetry >= MIN_RETRY_INTERVAL_MS) {
      retryDenied = true;
      this.lastRetry = Date.now();
    }

    const request = info(consented);
    // Local capabilities are the mediator's to give, never the client's.
    let toAsk = consented.filter((c) => !rtcLocal.includes(c));
    if (request.upstream.length > 0) {
      const max =
        this.o.maxCapabilityRequests ?? DEFAULTS.maxCapabilityRequests;
      if (this.upstreamRequests >= max) {
        this.o.logger?.warn('capability request budget exhausted');
        toAsk = request.inherited.filter((c) => !rtcLocal.includes(c));
      } else {
        this.upstreamRequests++;
      }
    }

    let settle!: (r: CapabilityRequestResult) => void;
    const settled = new Promise<CapabilityRequestResult>((resolve) => {
      settle = resolve;
    });
    if (consented.length > 0) {
      this.o.onCapabilityRequest?.({ ...request, settled });
    }
    const result = await hub.broker.ensure(toAsk, {
      retryDenied,
      signal,
      onRequest: (capabilities) => {
        if (!signal.aborted && !this.handshakeDone) {
          this.setState({
            status: 'negotiating',
            awaitingCapabilities: capabilities,
          });
        }
      },
    });
    settle({
      approved: result.approved,
      denied: consented.filter((c) => !result.approved.includes(c)),
      timedOut: result.timedOut,
    });
    if (signal.aborted) return new Set();

    const granted = consented.filter(
      (c) => rtcLocal.includes(c) || hub.broker.isApproved(c),
    );
    granted.forEach((c) => this.summary.granted.add(c));
    consented.forEach((c) => this.allowedSoFar.add(c));
    this.summary.deniedUpstream = new Set(
      [...this.allowedSoFar].filter((c) => !this.summary.granted.has(c)),
    );

    if (initial) {
      this.deniedError = requested.size > 0 && granted.length === 0;
      if (this.deniedError) {
        this.fail('denied', 'The requested permissions were not granted');
      } else {
        this.setState({ status: 'negotiating' });
      }
    } else if (this.state.status === 'ready' || this.deniedError) {
      this.deniedError = this.summary.granted.size === 0;
      if (!this.deniedError) {
        this.setState({ status: 'ready', capabilities: this.summaryCopy() });
      }
    }
    return new Set(granted.flatMap((c) => originalsOf.get(c) ?? []));
  }

  /**
   * Upward form of the requested capabilities. Capabilities naming the
   * reserved namespace directly are `forbidden` (any widget, with or
   * without a namespace map), which limits nesting to one level.
   */
  private rewriteRequested(requested: Iterable<string>) {
    const upward: string[] = [];
    const forbidden: string[] = [];
    const originalsOf = new Map<string, string[]>();
    for (const cap of requested) {
      const r = this.ns.upCapability(cap);
      if (!r.ok) {
        forbidden.push(cap);
        continue;
      }
      const list = originalsOf.get(r.capability);
      if (list) list.push(cap);
      else {
        originalsOf.set(r.capability, [cap]);
        upward.push(r.capability);
      }
    }
    return { upward, forbidden, originalsOf };
  }

  /** Upward event type; throws for the reserved namespace. */
  private upType(eventType: string): string {
    const t = this.ns.up(eventType);
    if (t === undefined) {
      throw new Error('Embedded widgets may not use this event type');
    }
    return t;
  }

  /** Events from the client as the widget sees them (filtered, renamed). */
  private downEvents(events: IRoomEvent[]): IRoomEvent[] {
    return events.flatMap((e) => {
      if (!e || typeof e.type !== 'string') return [];
      const d = this.ns.downEvent(e);
      return d ? [d] : [];
    });
  }

  private summaryCopy(): CapabilitySummary {
    return {
      requested: [...this.summary.requested],
      granted: [...this.summary.granted],
      blockedByPolicy: [...this.summary.blockedByPolicy],
      deniedLocally: [...this.summary.deniedLocally],
      deniedUpstream: [...this.summary.deniedUpstream],
    };
  }

  // ------------------------------------------------------------- upward I/O

  /** Only pass a room id upward for a *foreign* room (own room is implicit). */
  private upwardRoom(roomId: string | null | undefined): string | undefined {
    return roomId && roomId !== this.roomId ? roomId : undefined;
  }

  async sendEvent(
    localType: string,
    content: unknown,
    stateKey: string | null,
    roomId: string | null,
  ): Promise<ISendEventDetails> {
    const hub = await this.hubReady;
    // The widget's type as the client sees it (namespace rewrite).
    const eventType = this.upType(localType);
    const kind =
      stateKey !== null && stateKey !== undefined ? 'state_event' : 'event';
    const exact =
      kind === 'state_event'
        ? `org.matrix.msc2762.send.state_event:${eventType}#${stateKey}`
        : `org.matrix.msc2762.send.event:${eventType}`;
    if (
      isHardDenied(`org.matrix.msc2762.send.${kind}:${eventType}`) &&
      !this.rtcCapabilities.includes(exact)
    ) {
      // Defence in depth: such capabilities are never granted anyway.
      throw new Error('Embedded widgets may not send this event type');
    }
    const throttle = this.throttle;
    if (!throttle) throw new Error('Embedded widget stopped');
    const room = this.upwardRoom(roomId);
    const isState = stateKey !== null && stateKey !== undefined;
    const key = isState
      ? JSON.stringify([eventType, stateKey, room])
      : undefined;

    // Queued writes to the same state key are coalesced (last one wins);
    // every caller then receives the result of that single send.
    const { res, sent } = await throttle.schedule(key, async () => {
      const sentContent = content;
      const r = (await hub.outer.transport.send(
        WidgetApiFromWidgetAction.SendEvent,
        {
          type: eventType,
          content: sentContent,
          ...(isState ? { state_key: stateKey } : {}),
          ...(room ? { room_id: room } : {}),
        },
      )) as { room_id?: string; event_id?: string };
      return { res: r, sent: sentContent };
    });

    const resultRoom = res.room_id ?? roomId ?? this.roomId;
    try {
      this.o.onEventSent?.({
        type: eventType,
        ...(isState ? { stateKey: stateKey as string } : {}),
        ...(res.event_id ? { eventId: res.event_id } : {}),
      });
    } catch (e) {
      this.o.logger?.warn('onEventSent failed', String(e));
    }
    if (res.event_id) {
      this.scheduleEchoFallback({
        type: eventType,
        content: sent,
        sender: this.o.params.userId,
        event_id: res.event_id,
        room_id: resultRoom,
        origin_server_ts: Date.now(),
        unsigned: { [LOCAL_ECHO_MARKER]: true },
        ...(isState ? { state_key: stateKey as string } : {}),
      } as IRoomEvent);
    }
    return { roomId: resultRoom, eventId: res.event_id ?? '' };
  }

  // ------------------------------- to-device (namespaced or MatrixRTC)

  /**
   * Upward type of a to-device message, or `undefined` if this widget may
   * not use it: event types in this widget's namespace (the rewritten type
   * lies in the reserved namespace), and the call types of a MatrixRTC
   * widget (unchanged, see `matrixRtc.ts`).
   */
  private toDeviceType(localType: string): string | undefined {
    if (this._rtc && CALL_TO_DEVICE_TYPES.includes(localType)) {
      return localType;
    }
    const t = this.ns.active ? this.ns.up(localType) : undefined;
    return t && isNamespacedToDeviceType(t) ? t : undefined;
  }

  /**
   * To-device messages: only the types of {@link toDeviceType}. Everything
   * else stays blocked, like the capabilities. Own budget, separate from
   * room events, because signalling and key exchange come in short bursts.
   */
  async sendToDevice(
    localType: string,
    encrypted: boolean,
    contentMap: Record<string, Record<string, object>>,
  ): Promise<void> {
    const hub = await this.hubReady;
    const eventType = this.toDeviceType(localType);
    if (!eventType) {
      throw new Error('Embedded widgets may not send to-device messages');
    }
    if (!isContentMap(contentMap)) {
      throw new Error('Invalid to-device message map');
    }
    const recipients = Object.values(contentMap).reduce(
      (n, devices) => n + Object.keys(devices).length,
      0,
    );
    if (recipients > MAX_TO_DEVICE_RECIPIENTS) {
      throw new Error('Too many to-device recipients');
    }
    // Wait for a token (signalling must not be dropped), bounded.
    const wait = this.toDeviceBucket.msUntilAvailable();
    if (wait > MAX_TO_DEVICE_WAIT_MS) {
      throw new Error('To-device rate limit exceeded');
    }
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (!this.throttle) throw new Error('Embedded widget stopped');
    this.toDeviceBucket.take();
    await hub.outer.transport.send(WidgetApiFromWidgetAction.SendToDevice, {
      type: eventType,
      encrypted,
      messages: contentMap,
    });
  }

  deliverToDevice(raw: ToDeviceMessage): void {
    if (!raw || typeof raw.type !== 'string') return;
    let type: string | undefined;
    if (this._rtc && CALL_TO_DEVICE_TYPES.includes(raw.type)) {
      type = raw.type;
    } else if (this.ns.active && isNamespacedToDeviceType(raw.type)) {
      type = this.ns.down(raw.type);
    }
    if (type === undefined || typeof raw.sender !== 'string') return;
    const message = {
      type,
      sender: raw.sender,
      content: raw.content,
    };
    this.whenActive(() => {
      this.client
        ?.feedToDevice(message, raw.encrypted === true)
        .catch(() => undefined);
    });
  }

  async readEventRelations(
    eventId: string,
    roomId: string | undefined,
    relationType: string | undefined,
    eventType: string | undefined,
    from: string | undefined,
    to: string | undefined,
    limit: number | undefined,
    direction: 'f' | 'b' | undefined,
  ): Promise<IReadEventRelationsResult> {
    const hub = await this.hubReady;
    const r = await hub.readUpward<{
      chunk?: IRoomEvent[];
      prev_batch?: string;
      next_batch?: string;
    }>(ACTION_READ_RELATIONS, {
      event_id: eventId,
      room_id: this.upwardRoom(roomId),
      rel_type: relationType,
      event_type: eventType === undefined ? undefined : this.upType(eventType),
      from,
      to,
      limit,
      direction,
    });
    // ClientWidgetApi filters the chunk by the embedded widget's own caps.
    return {
      chunk: Array.isArray(r?.chunk) ? this.downEvents(r.chunk) : [],
      prevBatch: r?.prev_batch,
      nextBatch: r?.next_batch,
    };
  }

  /**
   * Only used by ClientWidgetApi to push initial room state via
   * `update_state`. Skipped (no upward round trip) unless the embedded
   * widget actually uses `update_state`.
   */
  async readRoomState(
    roomId: string,
    eventType: string,
    stateKey: string | undefined,
  ): Promise<IRoomEvent[]> {
    if (!(await this.usesUpdateState())) return [];
    return this.readUpward(roomId, {
      type: eventType,
      state_key: stateKey ?? true,
    });
  }

  async readRoomTimeline(
    roomId: string,
    eventType: string,
    msgtype: string | undefined,
    _stateKey: string | undefined,
    limit: number,
    since: string | undefined,
  ): Promise<IRoomEvent[]> {
    return this.readUpward(roomId, {
      type: eventType,
      msgtype,
      limit: limit || undefined,
      since,
    });
  }

  private async readUpward(
    roomId: string,
    data: ReadEventsRequest,
  ): Promise<IRoomEvent[]> {
    const hub = await this.hubReady;
    const room = this.upwardRoom(roomId);
    const type = data.type === undefined ? undefined : this.upType(data.type);
    const r = await hub.readUpward<{ events?: IRoomEvent[] }>(
      ACTION_READ_EVENTS,
      { ...data, type, ...(room ? { room_ids: [room] } : {}) },
    );
    return Array.isArray(r?.events) ? this.downEvents(r.events) : [];
  }

  private async usesUpdateState(): Promise<boolean> {
    if (this.o.updateState !== 'auto' || !this.client) return false;
    const versions = await this.client.getWidgetVersions();
    return versions.includes(UnstableApiVersion.MSC2762_UPDATE_STATE);
  }

  /**
   * `read_events` (MSC2876) is handled here instead of by ClientWidgetApi:
   * its default path loses the difference between "all state keys" and a
   * timeline read for widgets without `update_state`. Checked against the
   * embedded widget's caps, forwarded without `room_ids` for the host's own
   * room, and filtered again before replying.
   */
  private async handleReadEvents(req: IWidgetApiRequest) {
    const client = this.client;
    if (!client) return;
    const data = (req.data ?? {}) as ReadEventsRequest;
    const error = (message: string) =>
      client.transport.reply(req, { error: { message } });
    if (typeof data.type !== 'string' || !data.type) {
      return error('Invalid request - missing event type');
    }
    if (this.ns.up(data.type) === undefined) {
      return error('Cannot read events of this type');
    }
    if (data.limit !== undefined && (!data.limit || data.limit < 0)) {
      return error('Invalid request - limit out of range');
    }
    let rooms: string[];
    if (data.room_ids === undefined) {
      rooms = [this.roomId];
    } else if (data.room_ids === '*') {
      rooms = [this.roomId].filter((r) => client.canUseRoomTimeline(r));
    } else if (Array.isArray(data.room_ids)) {
      rooms = [...new Set(data.room_ids)];
      // Naming the host's own room explicitly is the same as omitting
      // `room_ids` (matrix-js-sdk's RoomWidgetClient always does this); only
      // other rooms need a `timeline:` capability, which is never granted.
      const denied = rooms.find(
        (r) => r !== this.roomId && !client.canUseRoomTimeline(r),
      );
      if (denied) return error(`Unable to access room timeline: ${denied}`);
    } else {
      return error('Invalid request - room_ids');
    }

    const isState = data.state_key !== undefined;
    const stateKey =
      data.state_key === true || data.state_key === undefined
        ? null
        : String(data.state_key);
    if (isState && !client.canReceiveStateEvent(data.type, stateKey)) {
      return error('Cannot read state events of this type');
    }
    if (!isState && !client.canReceiveRoomEvent(data.type, data.msgtype)) {
      return error('Cannot read room events of this type');
    }

    const upward: ReadEventsRequest = {
      type: data.type,
      ...(data.msgtype !== undefined ? { msgtype: data.msgtype } : {}),
      ...(isState ? { state_key: data.state_key } : {}),
      ...(data.limit !== undefined
        ? {
            limit: isState
              ? data.limit
              : Math.min(
                  data.limit,
                  this.o.maxTimelineReadLimit ?? DEFAULTS.maxTimelineReadLimit,
                ),
          }
        : {}),
      ...(data.since !== undefined ? { since: data.since } : {}),
    };
    try {
      const results = await Promise.all(
        rooms.map((r) => this.readUpward(r, upward)),
      );
      const events = results.flat().filter((e) => {
        if (e.room_id && !rooms.includes(e.room_id)) return false;
        return e.state_key !== undefined && e.state_key !== null
          ? client.canReceiveStateEvent(e.type, e.state_key)
          : client.canReceiveRoomEvent(
              e.type,
              (e.content as { msgtype?: string })?.msgtype,
            );
      });
      client.transport.reply(req, { events });
    } catch (e) {
      error(String((e as Error)?.message ?? 'Error reading events'));
    }
  }

  /**
   * OpenID (`get_openid`): blocked unless `openId: 'forward'`. Forwarded
   * requests answer "pending" first, because the outer client may show a
   * dialog that takes longer than the embedded widget's request timeout.
   */
  askOpenID(observer: SimpleObservable<IOpenIDUpdate>): void {
    const block = () => observer.update({ state: OpenIDRequestState.Blocked });
    if ((this.o.openId ?? 'deny') !== 'forward' || this.destroyed) {
      this.o.logger?.debug('blocked OpenID request', this.widgetId);
      return block();
    }
    observer.update({ state: OpenIDRequestState.PendingUserConfirmation });
    void this.forwardOpenID().then((token) =>
      observer.update(
        token
          ? { state: OpenIDRequestState.Allowed, token }
          : { state: OpenIDRequestState.Blocked },
      ),
    );
  }

  private async forwardOpenID(): Promise<IOpenIDCredentials | undefined> {
    try {
      const outer = await this.o.outerApi;
      if (!outer.requestOpenIDConnectToken) {
        throw new Error('The host cannot request OpenID tokens');
      }
      const credentials = await outer.requestOpenIDConnectToken();
      const { access_token, expires_in, matrix_server_name, token_type } =
        credentials ?? {};
      if (this.destroyed || !access_token) return undefined;
      this.o.logger?.debug('forwarded OpenID token', this.widgetId);
      return { access_token, expires_in, matrix_server_name, token_type };
    } catch (e) {
      this.o.logger?.warn(
        'OpenID request failed',
        String((e as Error)?.message ?? e),
      );
      return undefined;
    }
  }

  private async handleOpenModal(req: IWidgetApiRequest) {
    const client = this.client;
    if (!client) return;
    const error = (message: string) =>
      client.transport.reply(req, { error: { message } });
    if ((this.o.modals ?? 'deny') === 'deny') {
      return error('Modals are not available for embedded widgets');
    }
    const data = (req.data ?? {}) as { url?: unknown };
    let modalUrl: URL;
    try {
      modalUrl = new URL(String(data.url));
    } catch {
      return error('Invalid modal URL');
    }
    if (
      modalUrl.origin !== this.url?.origin ||
      !this.allowedOrigins.has(modalUrl.origin)
    ) {
      return error('Modal URL must have the origin of the embedded widget');
    }
    try {
      const hub = await this.hubReady;
      await hub.openModal(this, req.data);
      client.transport.reply(req, {});
    } catch (e) {
      error(String((e as Error)?.message ?? 'Unable to open modal'));
    }
  }

  // ---------------------------------------------------------- downward I/O

  private whenActive(fn: () => void) {
    if (!this.paused) return fn();
    if (this.pausedEvents.length >= MAX_PAUSED_EVENTS) {
      this.pausedOverflow = true;
      return;
    }
    this.pausedEvents.push(fn);
  }

  private markDelivered(eventId: string | undefined): boolean {
    if (!eventId) return true;
    if (this.delivered.has(eventId)) return false;
    this.delivered.add(eventId);
    if (this.delivered.size > MAX_DELIVERED_IDS) {
      const oldest = this.delivered.values().next().value;
      if (oldest !== undefined) this.delivered.delete(oldest);
    }
    const timer = this.echoTimers.get(eventId);
    if (timer) {
      clearTimeout(timer);
      this.echoTimers.delete(eventId);
    }
    return true;
  }

  deliverEvent(raw: IRoomEvent): void {
    if (!isRoomEvent(raw)) return;
    const event = this.ns.downEvent(raw);
    if (!event) return;
    this.whenActive(() => {
      const client = this.client;
      if (!client || !this.markDelivered(event.event_id)) return;
      client.feedEvent(event).catch(() => undefined);
      if (
        this.o.updateState === 'auto' &&
        event.state_key !== undefined &&
        event.state_key !== null
      ) {
        client.feedStateUpdate(event).catch(() => undefined);
      }
    });
  }

  deliverStateUpdate(events: IRoomEvent[]): void {
    this.whenActive(() => {
      const client = this.client;
      if (!client) return;
      void this.feedStateUpdates(
        client,
        this.downEvents(events.filter(isRoomEvent)),
      );
    });
  }

  private async feedStateUpdates(
    client: ClientWidgetApi,
    events: IRoomEvent[],
  ) {
    const uses = await this.usesUpdateState();
    for (const e of events) {
      if (uses) client.feedStateUpdate(e).catch(() => undefined);
      else if (this.markDelivered(e.event_id)) {
        client.feedEvent(e).catch(() => undefined);
      }
    }
  }

  /**
   * Element Call's host actions: acknowledged locally and reported to the
   * host, never forwarded to the outer client (it would apply them to its
   * own calls). `set_always_on_screen` needs the locally granted
   * `m.always_on_screen` capability.
   */
  private registerCallHostActions(
    client: ClientWidgetApi,
    on: (action: string, handler: (req: IWidgetApiRequest) => void) => void,
  ) {
    const report = (event: MatrixRtcHostEvent) => {
      try {
        this.o.onMatrixRtcEvent?.(event);
      } catch (e) {
        this.o.logger?.warn('onMatrixRtcEvent failed', String(e));
      }
    };
    const ack =
      (toEvent: (data: Record<string, unknown>) => MatrixRtcHostEvent) =>
      (req: IWidgetApiRequest) => {
        client.transport.reply(req, {});
        report(toEvent((req.data ?? {}) as Record<string, unknown>));
      };
    on(
      CALL_HOST_ACTIONS.join,
      ack(() => ({ kind: 'joined' })),
    );
    on(
      CALL_HOST_ACTIONS.hangup,
      ack(() => ({ kind: 'hung-up' })),
    );
    on(
      CALL_HOST_ACTIONS.close,
      ack(() => ({ kind: 'close' })),
    );
    on(
      CALL_HOST_ACTIONS.deviceMute,
      ack((d) => ({
        kind: 'device-mute',
        ...(typeof d.audio_enabled === 'boolean'
          ? { audio: d.audio_enabled }
          : {}),
        ...(typeof d.video_enabled === 'boolean'
          ? { video: d.video_enabled }
          : {}),
      })),
    );
    on(
      CALL_HOST_ACTIONS.tileLayout,
      ack(() => ({ kind: 'layout', layout: 'tile' })),
    );
    on(
      CALL_HOST_ACTIONS.spotlightLayout,
      ack(() => ({ kind: 'layout', layout: 'spotlight' })),
    );
    on(WidgetApiFromWidgetAction.UpdateAlwaysOnScreen, (req) => {
      if (!client.hasCapability(ALWAYS_ON_SCREEN_CAPABILITY)) {
        client.transport.reply(req, {
          error: { message: 'Widget does not have permission for this action' },
        });
        return;
      }
      const value = (req.data as { value?: unknown })?.value === true;
      client.transport.reply(req, {});
      report({ kind: 'always-on-screen', value });
    });
  }

  deliverTheme(theme: unknown): void {
    // Only forward the known key, never arbitrary objects.
    const name = (theme as { name?: unknown } | undefined)?.name;
    if (typeof name !== 'string') return;
    this.client?.updateTheme({ name }).catch(() => undefined);
  }

  deliverLanguage(language: string): void {
    this.client?.updateLanguage(language).catch(() => undefined);
  }

  deliverModalClose(data: unknown): void {
    this.client?.notifyModalWidgetClose(data as never).catch(() => undefined);
  }

  /**
   * matrix-widget-toolkit's `sendRoomEvent`/`sendStateEvent` resolve only
   * when the event comes back via `send_event`. The outer client normally
   * echoes it; if not, deliver a local echo after `echoFallbackMs`.
   */
  private scheduleEchoFallback(event: IRoomEvent) {
    const ms = this.o.echoFallbackMs ?? DEFAULTS.echoFallbackMs;
    if (ms <= 0 || this.delivered.has(event.event_id)) return;
    clearTimeout(this.echoTimers.get(event.event_id));
    this.echoTimers.set(
      event.event_id,
      setTimeout(() => {
        this.echoTimers.delete(event.event_id);
        this.deliverEvent(event);
      }, ms),
    );
  }
}

function emptySummary() {
  return {
    requested: new Set<string>(),
    granted: new Set<string>(),
    blockedByPolicy: new Set<string>(),
    deniedLocally: new Set<string>(),
    deniedUpstream: new Set<string>(),
  };
}

function isNamespacedToDeviceType(type: string): boolean {
  return isNamespacedToDevice(`org.matrix.msc3819.send.to_device:${type}`);
}

function isContentMap(
  map: unknown,
): map is Record<string, Record<string, object>> {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
  return Object.values(map).every(
    (devices) =>
      !!devices &&
      typeof devices === 'object' &&
      !Array.isArray(devices) &&
      Object.values(devices).every((c) => !!c && typeof c === 'object'),
  );
}

function isRoomEvent(e: unknown): e is IRoomEvent {
  const ev = e as Partial<IRoomEvent> | undefined;
  return (
    !!ev &&
    typeof ev.type === 'string' &&
    typeof ev.event_id === 'string' &&
    typeof ev.room_id === 'string' &&
    typeof ev.sender === 'string'
  );
}

/**
 * Rough same-site check (last two host labels). Only used for a warning;
 * a public-suffix-aware check belongs to the deployment.
 */
function sameSite(a: string, b: string): boolean {
  const site = (h: string) => h.split('.').slice(-2).join('.');
  return a !== b && site(a) === site(b);
}

function isPromiseLike<T>(v: T | Promise<T>): v is Promise<T> {
  return typeof (v as { then?: unknown })?.then === 'function';
}
