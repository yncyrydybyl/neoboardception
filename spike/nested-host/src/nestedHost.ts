/*
 * NeoBoardception spike — nested widget host ("Vermittler").
 *
 * NeoBoard is itself a widget (outer WidgetApi towards Element). This module
 * makes NeoBoard the *client* for one inner widget iframe:
 *
 *   Element  ──(outer WidgetApi, NeoBoard's own widgetId)──  NeoBoard
 *   NeoBoard ──(ClientWidgetApi + ForwardingDriver)────────  inner widget
 *
 * Capability requests of the inner widget are forwarded upward as an MSC2974
 * renegotiation of NeoBoard's OWN capabilities (union of NeoBoard's caps and
 * the inner caps). Element therefore only ever sees NeoBoard.
 *
 * Spike quality: no CRDT element, a fixed overlay, one inner widget.
 * The inner widget only ever talks to NeoBoard, never to the outer client.
 */

import {
  Capability,
  ClientWidgetApi,
  EventDirection,
  IRoomEvent,
  ISendEventDetails,
  IWidgetApiRequest,
  Widget,
  WidgetDriver,
  WidgetEventCapability,
} from 'matrix-widget-api';

/**
 * The subset of the (widget-side) matrix-widget-api `WidgetApi` that NeoBoard
 * owns towards Element. Typed structurally so that the toolkit's pinned
 * matrix-widget-api version and ours do not have to be identical.
 */
export interface OuterWidgetApi {
  requestCapabilities(caps: string[]): void;
  updateRequestedCapabilities(): Promise<void>;
  sendRoomEvent(
    eventType: string,
    content: unknown,
    roomId?: string,
  ): Promise<{ room_id: string; event_id: string }>;
  sendStateEvent(
    eventType: string,
    stateKey: string,
    content: unknown,
    roomId?: string,
  ): Promise<{ room_id: string; event_id: string }>;
  readRoomEvents(
    eventType: string,
    limit?: number,
    msgtype?: string,
    roomIds?: string[],
    since?: string,
  ): Promise<IRoomEvent[]>;
  readStateEvents(
    eventType: string,
    limit?: number,
    stateKey?: string,
    roomIds?: string[],
  ): Promise<IRoomEvent[]>;
  on(
    event: string,
    listener: (ev: CustomEvent<IWidgetApiRequest>) => void,
  ): unknown;
  off(
    event: string,
    listener: (ev: CustomEvent<IWidgetApiRequest>) => void,
  ): unknown;
}

export type NestedHostLog = (msg: string, data?: unknown) => void;

export interface NestedHostOptions {
  outer: OuterWidgetApi;
  /** NeoBoard's own approved capabilities after the initial handshake. */
  outerInitiallyApproved: string[];
  roomId: string;
  userId: string;
  innerWidgetUrl: string;
  innerWidgetId?: string;
  theme?: string;
  log?: NestedHostLog;
  /**
   * Capabilities the inner widget may never get, even if NeoBoard holds them
   * (NeoBoard's own document/session namespace). Prevents the inner widget
   * from silently piggybacking on NeoBoard's existing grants.
   */
  denyPrefixes?: string[];
}

const NOTIFY_TIMEOUT_MS = 5 * 60 * 1000; // a human reads the dialog

/**
 * Driver for the inner widget: every decision is delegated upward to Element
 * through NeoBoard's outer WidgetApi.
 */
export class ForwardingDriver extends WidgetDriver {
  /** Capabilities Element has confirmed for NeoBoard (cumulative). */
  readonly outerApproved: Set<string>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: NestedHostOptions) {
    super();
    this.outerApproved = new Set(o.outerInitiallyApproved);
  }

  private log(msg: string, data?: unknown) {
    this.o.log?.(msg, data);
  }

  async validateCapabilities(
    requested: Set<Capability>,
  ): Promise<Set<Capability>> {
    // Serialise: a second request must not race the first notify_capabilities.
    const run = this.queue.then(() => this.validateInternal(requested));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async validateInternal(
    requested: Set<Capability>,
  ): Promise<Set<Capability>> {
    const deny = this.o.denyPrefixes ?? [];
    const wanted = [...requested].filter(
      (c) => !deny.some((p) => c.includes(p)),
    );
    const denied = [...requested].filter((c) => !wanted.includes(c));
    if (denied.length)
      this.log('inner caps denied locally (namespace guard)', denied);

    const missing = wanted.filter((c) => !this.outerApproved.has(c));
    this.log('inner widget requests caps', {
      requested: [...requested],
      missingUpstream: missing,
    });

    if (missing.length > 0) {
      // Union: matrix-widget-api keeps NeoBoard's initial requested caps in
      // `requestedCapabilities`; adding the inner ones and calling
      // updateRequestedCapabilities() sends the union as MSC2974 renegotiation.
      const notified = new Promise<string[]>((resolve, reject) => {
        const t = setTimeout(() => {
          this.o.outer.off('action:notify_capabilities', h);
          reject(new Error('timeout waiting for notify_capabilities'));
        }, NOTIFY_TIMEOUT_MS);
        const h = (ev: CustomEvent<IWidgetApiRequest>) => {
          clearTimeout(t);
          this.o.outer.off('action:notify_capabilities', h);
          const data = ev.detail.data as {
            approved?: string[];
            requested?: string[];
          };
          this.log('outer notify_capabilities (from Element)', data);
          resolve(data.approved ?? []);
        };
        this.o.outer.on('action:notify_capabilities', h);
      });
      this.o.outer.requestCapabilities(missing);
      this.log(
        '→ Element: MSC2974 renegotiate (union of NeoBoard + inner caps)',
      );
      await this.o.outer.updateRequestedCapabilities();
      try {
        const approved = await notified;
        approved.forEach((c) => this.outerApproved.add(c));
      } catch (e) {
        this.log('renegotiation failed', String(e));
      }
    }
    const result = new Set(wanted.filter((c) => this.outerApproved.has(c)));
    this.log('inner caps granted (intersection)', [...result]);
    return result;
  }

  async sendEvent(
    eventType: string,
    content: unknown,
    stateKey: string | null = null,
    roomId: string | null = null,
  ): Promise<ISendEventDetails> {
    // Only pass room_id upward for a *foreign* room: Element requires the
    // timeline capability for any explicit room_id, even NeoBoard's own room.
    const r = roomId && roomId !== this.o.roomId ? roomId : undefined;
    let res: { room_id: string; event_id: string };
    try {
      res =
        stateKey !== null && stateKey !== undefined
          ? await this.o.outer.sendStateEvent(eventType, stateKey, content, r)
          : await this.o.outer.sendRoomEvent(eventType, content, r);
    } catch (e) {
      this.log('upward send failed', {
        eventType,
        error: String((e as Error)?.message ?? e),
      });
      throw e;
    }
    this.log('forwarded send upward', {
      eventType,
      stateKey,
      event_id: res.event_id,
    });
    return { roomId: res.room_id, eventId: res.event_id };
  }

  async readRoomTimeline(
    roomId: string,
    eventType: string,
    msgtype: string | undefined,
    _stateKey: string | undefined,
    limit: number,
    since: string | undefined,
  ): Promise<IRoomEvent[]> {
    return this.o.outer.readRoomEvents(
      eventType,
      limit || 50,
      msgtype,
      [roomId],
      since,
    );
  }

  async readRoomState(
    roomId: string,
    eventType: string,
    stateKey: string | undefined,
  ): Promise<IRoomEvent[]> {
    return this.o.outer.readStateEvents(eventType, 50, stateKey, [roomId]);
  }

  getKnownRooms(): string[] {
    return [this.o.roomId];
  }
}

export interface NestedHostHandle {
  iframe: HTMLIFrameElement;
  client: ClientWidgetApi;
  driver: ForwardingDriver;
  destroy(): void;
}

/** Mount the inner widget into `container` and wire both directions. */
export function mountNestedWidget(
  container: HTMLElement,
  o: NestedHostOptions,
): NestedHostHandle {
  const widgetId = o.innerWidgetId ?? 'neoboardception-inner';
  const widget = new Widget({
    id: widgetId,
    creatorUserId: o.userId,
    type: 'm.custom',
    url: o.innerWidgetUrl,
    waitForIframeLoad: true,
  });
  const url = new URL(
    widget.getCompleteUrl({
      widgetRoomId: o.roomId,
      currentUserId: o.userId,
      clientTheme: o.theme,
    }),
  );
  url.searchParams.set('widgetId', widgetId);
  // Only our origin: the inner widget needs it as postMessage target and must
  // not learn NeoBoard's own widgetId or URL parameters.
  url.searchParams.set('parentUrl', window.location.origin + '/');

  const iframe = document.createElement('iframe');
  iframe.title = 'NeoBoardception inner widget';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  iframe.style.cssText = 'border:0;width:100%;height:100%;background:#fff';
  iframe.src = url.toString();
  container.appendChild(iframe);

  // Source guard (capture phase, registered before the transports' bubble
  // listeners): accept host-bound messages only from the inner iframe and
  // widget-bound messages only from our parent window, instead of relying on
  // the transport to validate the sender.
  const guard = (ev: MessageEvent) => {
    const d = ev.data as { api?: string; widgetId?: string } | null;
    if (!d || typeof d !== 'object' || !d.api) return;
    const fromInner = ev.source === iframe.contentWindow;
    const fromParent = ev.source === window.parent;
    // Messages carrying the inner widgetId (its requests and its responses)
    // must come from the inner iframe; everything else (Element's requests
    // to NeoBoard and Element's responses) must come from the parent.
    const bad = d.widgetId === widgetId ? !fromInner : !fromParent;
    if (bad) {
      ev.stopImmediatePropagation();
      o.log?.('blocked spoofed postMessage', {
        api: d.api,
        widgetId: d.widgetId,
      });
    }
  };
  window.addEventListener('message', guard, true);

  const driver = new ForwardingDriver(o);
  const client = new ClientWidgetApi(widget, iframe, driver);
  client.setViewedRoomId(o.roomId);
  client.on('ready', () => o.log?.('inner widget ready'));
  client.on('error:preparing', (e: unknown) =>
    o.log?.('inner preparing error', String(e)),
  );

  // Downward: events Element pushes to NeoBoard → inner widget, filtered by
  // the inner widget's own approved caps (ClientWidgetApi.feedEvent checks
  // canReceiveRoomEvent/canReceiveStateEvent against the inner grants).
  const onSendEvent = (ev: CustomEvent<IWidgetApiRequest>) => {
    const raw = ev.detail.data as unknown as IRoomEvent;
    if (!raw?.type) return;
    client.feedEvent(raw).catch(() => undefined);
  };
  const onTheme = (ev: CustomEvent<IWidgetApiRequest>) => {
    client.updateTheme(ev.detail.data as never).catch(() => undefined);
  };
  const onStateUpdate = (ev: CustomEvent<IWidgetApiRequest>) => {
    const state = (ev.detail.data as { state?: IRoomEvent[] }).state ?? [];
    state.forEach((s) => client.feedStateUpdate(s).catch(() => undefined));
  };
  o.outer.on('action:send_event', onSendEvent);
  o.outer.on('action:theme_change', onTheme);
  o.outer.on('action:update_state', onStateUpdate);

  return {
    iframe,
    client,
    driver,
    destroy() {
      window.removeEventListener('message', guard, true);
      o.outer.off('action:send_event', onSendEvent);
      o.outer.off('action:theme_change', onTheme);
      o.outer.off('action:update_state', onStateUpdate);
      client.stop();
      iframe.remove();
    },
  };
}

/** Helper for docs/tests: the caps the inner test widget is expected to use. */
export const pingCaps = {
  send: WidgetEventCapability.forRoomEvent(
    EventDirection.Send,
    'net.neoboardception.ping',
  ).raw,
  receive: WidgetEventCapability.forRoomEvent(
    EventDirection.Receive,
    'net.neoboardception.ping',
  ).raw,
};
