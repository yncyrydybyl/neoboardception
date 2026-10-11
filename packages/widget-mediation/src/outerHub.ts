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

import type { IRoomEvent, IWidgetApiRequest } from 'matrix-widget-api';
import {
  WidgetApiFromWidgetAction,
  WidgetApiToWidgetAction,
} from 'matrix-widget-api';
import { approvedFromNotify, CapabilityBroker } from './capabilityBroker';
import { RateLimit, TokenBucket } from './rateLimit';
import type { MediationConfig, OuterWidgetApi, ToDeviceMessage } from './types';

/** What the hub needs from one mounted embedded widget. */
export interface HubMember {
  readonly widgetId: string;
  deliverEvent(event: IRoomEvent): void;
  deliverStateUpdate(events: IRoomEvent[]): void;
  deliverTheme(theme: unknown): void;
  deliverLanguage(language: string): void;
  deliverModalClose(data: unknown): void;
  /** To-device message for the host (members only take namespaced ones). */
  deliverToDevice(message: ToDeviceMessage): void;
}

const DEFAULT_CONFIG = {
  capabilityTimeoutMs: 300_000,
  capabilityBatchMs: 50,
  aggregateRateLimit: { burst: 8, perSecond: 1 / 2 } as RateLimit,
};

type Listener = (ev: CustomEvent<IWidgetApiRequest>) => void;

/**
 * Shared state for all embedded widgets of one host widget (one outer
 * WidgetApi): capability broker, outer event fan-out, modal routing,
 * coalesced reads and the aggregate send budget.
 */
export class OuterHub {
  readonly broker: CapabilityBroker;
  /** Budget shared by all embedded widgets; the host's own sends are untouched. */
  readonly aggregateBucket: TokenBucket;
  private readonly members = new Set<HubMember>();
  private readonly inflightReads = new Map<string, Promise<unknown>>();
  private modalOwner: HubMember | 'orphaned' | undefined;
  private readonly listeners: Array<[string, Listener]>;

  constructor(
    readonly outer: OuterWidgetApi,
    config: MediationConfig = {},
  ) {
    this.broker = new CapabilityBroker(outer, {
      timeoutMs:
        config.capabilityTimeoutMs ?? DEFAULT_CONFIG.capabilityTimeoutMs,
      batchWindowMs:
        config.capabilityBatchMs ?? DEFAULT_CONFIG.capabilityBatchMs,
      logger: config.logger,
    });
    this.aggregateBucket = new TokenBucket(
      config.aggregateRateLimit ?? DEFAULT_CONFIG.aggregateRateLimit,
    );

    // Observe only: the host widget keeps answering these requests itself,
    // except close_modal for modals opened by an embedded widget.
    this.listeners = [
      [WidgetApiToWidgetAction.SendEvent, (ev) => this.onSendEvent(ev)],
      [WidgetApiToWidgetAction.UpdateState, (ev) => this.onUpdateState(ev)],
      [WidgetApiToWidgetAction.ThemeChange, (ev) => this.onTheme(ev)],
      [WidgetApiToWidgetAction.LanguageChange, (ev) => this.onLanguage(ev)],
      [WidgetApiToWidgetAction.CloseModalWidget, (ev) => this.onCloseModal(ev)],
      [WidgetApiToWidgetAction.NotifyCapabilities, (ev) => this.onNotify(ev)],
      [WidgetApiToWidgetAction.SendToDevice, (ev) => this.onToDevice(ev)],
    ];
    this.listeners.forEach(([action, l]) => outer.on(`action:${action}`, l));
  }

  get size(): number {
    return this.members.size;
  }

  add(member: HubMember): void {
    this.members.add(member);
  }

  remove(member: HubMember): void {
    this.members.delete(member);
    if (this.modalOwner === member) this.modalOwner = 'orphaned';
  }

  dispose(): void {
    this.listeners.forEach(([action, l]) =>
      this.outer.off(`action:${action}`, l),
    );
    this.broker.dispose();
    this.members.clear();
  }

  /**
   * Sends a read request upward. Identical concurrent requests (e.g. several
   * embedded polls reading the same state) share one round trip.
   */
  readUpward<T>(action: string, data: unknown): Promise<T> {
    const key = `${action}\u0000${JSON.stringify(data)}`;
    let p = this.inflightReads.get(key) as Promise<T> | undefined;
    if (!p) {
      p = this.outer.transport.send(action, data) as Promise<T>;
      this.inflightReads.set(key, p);
      const clear = () => this.inflightReads.delete(key);
      p.then(clear, clear).catch(() => undefined);
    }
    return p;
  }

  /** Forwards `open_modal`; only one modal can be open at a time. */
  async openModal(member: HubMember, data: unknown): Promise<void> {
    if (this.modalOwner !== undefined && this.modalOwner !== 'orphaned') {
      throw new Error('Another modal is already open');
    }
    await this.outer.transport.send(
      WidgetApiFromWidgetAction.OpenModalWidget,
      data,
    );
    this.modalOwner = member;
  }

  private onSendEvent(ev: CustomEvent<IWidgetApiRequest>) {
    const raw = ev.detail?.data as unknown as IRoomEvent | undefined;
    if (!raw || typeof raw.type !== 'string') return;
    this.members.forEach((m) => m.deliverEvent(raw));
  }

  private onToDevice(ev: CustomEvent<IWidgetApiRequest>) {
    const raw = ev.detail?.data as unknown as ToDeviceMessage | undefined;
    if (!raw || typeof raw.type !== 'string') return;
    this.members.forEach((m) => m.deliverToDevice(raw));
  }

  private onUpdateState(ev: CustomEvent<IWidgetApiRequest>) {
    const state = (ev.detail?.data as { state?: unknown })?.state;
    if (!Array.isArray(state)) return;
    this.members.forEach((m) => m.deliverStateUpdate(state as IRoomEvent[]));
  }

  private onTheme(ev: CustomEvent<IWidgetApiRequest>) {
    this.members.forEach((m) => m.deliverTheme(ev.detail?.data));
  }

  private onLanguage(ev: CustomEvent<IWidgetApiRequest>) {
    const lang = (ev.detail?.data as { lang?: unknown })?.lang;
    if (typeof lang !== 'string') return;
    this.members.forEach((m) => m.deliverLanguage(lang));
  }

  private onCloseModal(ev: CustomEvent<IWidgetApiRequest>) {
    const owner = this.modalOwner;
    if (owner === undefined) return; // the host's own modal
    this.modalOwner = undefined;
    ev.preventDefault();
    this.outer.transport.reply(ev.detail, {});
    if (owner !== 'orphaned') owner.deliverModalClose(ev.detail.data);
  }

  private onNotify(ev: CustomEvent<IWidgetApiRequest>) {
    const approved = approvedFromNotify(ev);
    if (approved) this.broker.handleNotify(approved);
  }
}

const hubs = new WeakMap<OuterWidgetApi, OuterHub>();

/** Returns the hub of an outer API, creating it with defaults on first use. */
export function acquireHub(outer: OuterWidgetApi): OuterHub {
  let hub = hubs.get(outer);
  if (!hub) {
    hub = new OuterHub(outer);
    hubs.set(outer, hub);
  }
  return hub;
}

/**
 * Configures the mediation for a host widget. Must be called before the
 * first embedded widget is mounted (or capabilities are pre-requested), so
 * that no embedded widget can influence host-level settings.
 */
export function configureMediation(
  outer: OuterWidgetApi,
  config: MediationConfig,
): void {
  if (hubs.has(outer)) {
    throw new Error('configureMediation must be called before mounting');
  }
  hubs.set(outer, new OuterHub(outer, config));
}

/** Detaches all listeners of a host widget's mediation (e.g. on unload). */
export function disposeHub(outer: OuterWidgetApi): void {
  hubs.get(outer)?.dispose();
  hubs.delete(outer);
}
