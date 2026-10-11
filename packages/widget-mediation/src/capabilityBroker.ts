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

import type { IWidgetApiRequest } from 'matrix-widget-api';
import { WidgetApiToWidgetAction } from 'matrix-widget-api';
import { capabilityImpliedBy } from './capabilities';
import type {
  CapabilityRequestResult,
  MediationLogger,
  OuterWidgetApi,
} from './types';

export interface EnsureCapabilitiesOptions {
  /**
   * Ask again for capabilities that were denied earlier in this session.
   * Only set this for an explicit user action (a "retry"), otherwise every
   * remount would show the outer client's dialog again.
   */
  retryDenied?: boolean;
  /** Called when this request is sent upstream, with its missing caps. */
  onRequest?: (
    capabilities: string[],
    settled: Promise<CapabilityRequestResult>,
  ) => void;
  signal?: AbortSignal;
}

interface PendingRequest {
  capabilities: readonly string[];
  options: EnsureCapabilitiesOptions;
  resolve: (result: CapabilityRequestResult) => void;
}

export interface CapabilityBrokerOptions {
  /** Max. time to wait for the user's decision upstream. */
  timeoutMs: number;
  /** Collect requests for this long into one renegotiation. */
  batchWindowMs: number;
  logger?: MediationLogger;
}

/**
 * Negotiates capabilities with the outer client on behalf of all embedded
 * widgets of one host widget.
 *
 * - **Union:** upward requests are an MSC2974 renegotiation of the host's
 *   own capabilities. `requestCapabilities(missing)` adds to the host's
 *   requested list and `updateRequestedCapabilities()` always sends the
 *   whole list (the host's initial capabilities plus everything embedded
 *   widgets added), so nothing the host already holds is dropped.
 * - **Batching:** requests arriving within `batchWindowMs` (or while a
 *   renegotiation is in flight) are merged into one renegotiation, so N
 *   widgets mounting together cause one dialog, not N.
 * - **Serialisation:** at most one renegotiation is in flight; the answer
 *   (`notify_capabilities`) carries no correlation id.
 * - **Shared cache:** the approved set is tracked from every
 *   `notify_capabilities`; denied capabilities are remembered for the
 *   session and only asked again with `retryDenied`.
 */
export class CapabilityBroker {
  private readonly approved = new Set<string>();
  private readonly denied = new Set<string>();
  private readonly requestedUpstream = new Set<string>();
  private pending: PendingRequest[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;
  private notifyWaiter: (() => void) | undefined;
  private disposed = false;

  constructor(
    private readonly outer: OuterWidgetApi,
    private readonly options: CapabilityBrokerOptions,
  ) {}

  /** Feed every `notify_capabilities` the outer client sends. */
  handleNotify(approved: readonly string[]): void {
    this.approved.clear();
    for (const c of approved) {
      this.approved.add(c);
      this.denied.delete(c);
    }
    const waiter = this.notifyWaiter;
    this.notifyWaiter = undefined;
    waiter?.();
  }

  isApproved(capability: string): boolean {
    if (this.outer.hasCapability?.(capability)) return true;
    // A keyed event capability is implied by the key-less one.
    const hash = capability.indexOf('#');
    if (
      hash > 0 &&
      capability.startsWith('org.matrix.msc2762.') &&
      this.outer.hasCapability?.(capability.slice(0, hash))
    ) {
      return true;
    }
    for (const granted of this.approved) {
      if (capabilityImpliedBy(capability, granted)) return true;
    }
    return false;
  }

  /**
   * Makes sure the outer client was asked for `capabilities` and resolves
   * with the approved/denied split. Never rejects.
   */
  ensure(
    capabilities: readonly string[],
    options: EnsureCapabilitiesOptions = {},
  ): Promise<CapabilityRequestResult> {
    const unique = [...new Set(capabilities)];
    const needsRequest = unique.some(
      (c) =>
        !this.isApproved(c) && (options.retryDenied || !this.denied.has(c)),
    );
    if (!needsRequest || this.disposed) {
      return Promise.resolve(this.result(unique, false));
    }
    return new Promise<CapabilityRequestResult>((resolve) => {
      const request: PendingRequest = {
        capabilities: unique,
        options,
        resolve,
      };
      this.pending.push(request);
      options.signal?.addEventListener('abort', () => {
        const i = this.pending.indexOf(request);
        if (i >= 0) {
          this.pending.splice(i, 1);
          resolve(this.result(unique, false));
        }
      });
      this.scheduleFlush();
    });
  }

  /** Resolves all waiters and stops listening. */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.flushTimer);
    const pending = this.pending;
    this.pending = [];
    pending.forEach((p) => p.resolve(this.result(p.capabilities, false)));
    this.notifyWaiter?.();
  }

  private result(
    capabilities: readonly string[],
    timedOut: boolean,
  ): CapabilityRequestResult {
    return {
      approved: capabilities.filter((c) => this.isApproved(c)),
      denied: capabilities.filter((c) => !this.isApproved(c)),
      timedOut,
    };
  }

  private scheduleFlush() {
    if (this.inFlight || this.flushTimer !== undefined) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, this.options.batchWindowMs);
  }

  private async flush(): Promise<void> {
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0 || this.disposed) return;
    this.inFlight = true;

    const missingFor = (p: PendingRequest) =>
      p.capabilities.filter(
        (c) =>
          !this.isApproved(c) && (p.options.retryDenied || !this.denied.has(c)),
      );
    const union = [...new Set(batch.flatMap(missingFor))];

    let timedOut = false;
    if (union.length > 0) {
      let settle!: (timedOut: boolean) => void;
      const settled = new Promise<boolean>((resolve) => {
        settle = resolve;
      });
      for (const p of batch) {
        const missing = missingFor(p);
        if (missing.length > 0) {
          p.options.onRequest?.(
            missing,
            settled.then((t) => this.result(p.capabilities, t)),
          );
        }
      }

      const outcome = await this.renegotiate(union);
      timedOut = outcome !== 'notified';
      if (outcome === 'notified') {
        // Only an actual answer is cached as a denial; a timeout or a
        // transport failure may be retried on the next mount.
        union
          .filter((c) => !this.isApproved(c))
          .forEach((c) => this.denied.add(c));
      }
      settle(timedOut);
    }

    batch.forEach((p) => p.resolve(this.result(p.capabilities, timedOut)));
    this.inFlight = false;
    if (this.pending.length > 0) this.scheduleFlush();
  }

  /** One renegotiation round. */
  private async renegotiate(
    missing: string[],
  ): Promise<'notified' | 'timeout' | 'failed'> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const notified = new Promise<boolean>((resolve) => {
      this.notifyWaiter = () => resolve(true);
      timer = setTimeout(() => resolve(false), this.options.timeoutMs);
    });
    try {
      const fresh = missing.filter((c) => !this.requestedUpstream.has(c));
      if (fresh.length > 0) this.outer.requestCapabilities(fresh);
      fresh.forEach((c) => this.requestedUpstream.add(c));
      this.options.logger?.debug('requesting capabilities upstream', missing);
      await this.outer.updateRequestedCapabilities();
      return (await notified) ? 'notified' : 'timeout';
    } catch (e) {
      this.options.logger?.warn('capability renegotiation failed', String(e));
      return 'failed';
    } finally {
      clearTimeout(timer);
      this.notifyWaiter = undefined;
    }
  }
}

/** Extracts the approved list from an outer `notify_capabilities` request. */
export function approvedFromNotify(
  ev: CustomEvent<IWidgetApiRequest>,
): string[] | undefined {
  if (ev.detail?.action !== WidgetApiToWidgetAction.NotifyCapabilities) {
    return undefined;
  }
  const approved = (ev.detail.data as { approved?: unknown })?.approved;
  return Array.isArray(approved)
    ? approved.filter((c): c is string => typeof c === 'string')
    : undefined;
}
