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

/** A message as posted between widget and client. */
export interface WireMessage {
  api: 'fromWidget' | 'toWidget';
  widgetId: string;
  requestId: string;
  action: string;
  data: Record<string, unknown>;
  response?: Record<string, unknown>;
}

export interface FakeInnerWidgetOptions {
  capabilities: string[];
  /** Versions the widget reports (toolkit: no update_state). */
  versions?: string[];
  origin?: string;
}

/**
 * Widget side of the Widget API over real `postMessage` semantics: messages
 * from the host arrive through the iframe window's `postMessage`, messages to
 * the host are dispatched as `MessageEvent`s with the iframe as `source`.
 */
export class FakeInnerWidget {
  /** To-widget requests received from the mediator, in order. */
  readonly received: WireMessage[] = [];
  approved: string[] | undefined;
  clientVersions: string[] | undefined;
  readonly origin: string;
  private readonly pending = new Map<string, (r: unknown) => void>();
  private seq = 0;

  constructor(
    readonly iframe: HTMLIFrameElement,
    readonly widgetId: string,
    private readonly options: FakeInnerWidgetOptions,
  ) {
    this.origin = options.origin ?? new URL(iframe.src).origin;
    const win = iframe.contentWindow as Window & {
      postMessage: (m: unknown) => void;
    };
    win.postMessage = (m: unknown) => this.onMessage(m as WireMessage);
  }

  get window(): Window {
    return this.iframe.contentWindow as Window;
  }

  /** The iframe finished loading: the mediator starts the handshake. */
  load(): void {
    this.iframe.dispatchEvent(new Event('load'));
  }

  received_(action: string): WireMessage[] {
    return this.received.filter((m) => m.action === action);
  }

  /** Sends a from-widget request and resolves with the response data. */
  request(
    action: string,
    data: Record<string, unknown> = {},
    overrides: {
      origin?: string;
      source?: Window | null;
      widgetId?: string;
    } = {},
  ): Promise<Record<string, unknown>> {
    const requestId = `inner-${++this.seq}`;
    const msg: WireMessage = {
      api: 'fromWidget',
      widgetId: overrides.widgetId ?? this.widgetId,
      requestId,
      action,
      data,
    };
    const p = new Promise<Record<string, unknown>>((resolve) =>
      this.pending.set(requestId, resolve as (r: unknown) => void),
    );
    this.post(msg, overrides);
    return p;
  }

  post(
    msg: unknown,
    overrides: { origin?: string; source?: Window | null } = {},
  ): void {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: msg,
        origin: overrides.origin ?? this.origin,
        source: overrides.source === undefined ? this.window : overrides.source,
      }),
    );
  }

  private async answerCapabilities(msg: WireMessage) {
    const r = await this.request('supported_api_versions');
    this.clientVersions = r.supported_versions as string[];
    this.post({
      ...msg,
      response: { capabilities: this.options.capabilities },
    });
  }

  private onMessage(msg: WireMessage) {
    if (msg.widgetId !== this.widgetId) {
      throw new Error('mediator used the wrong widget id');
    }
    if (msg.api === 'fromWidget' && msg.response) {
      this.pending.get(msg.requestId)?.(msg.response);
      this.pending.delete(msg.requestId);
      return;
    }
    if (msg.api !== 'toWidget') return;
    this.received.push(msg);
    let response: Record<string, unknown> = {};
    switch (msg.action) {
      case 'capabilities':
        // Like matrix-widget-api: ask the client for its versions first.
        void this.answerCapabilities(msg);
        return;
      case 'supported_api_versions':
        response = {
          supported_versions: this.options.versions ?? [
            '0.0.1',
            '0.0.2',
            'org.matrix.msc2762',
            'org.matrix.msc2871',
          ],
        };
        break;
      case 'notify_capabilities':
        this.approved = msg.data.approved as string[];
        break;
      case 'update_state':
        if (
          !this.options.versions?.includes('org.matrix.msc2762_update_state')
        ) {
          response = {
            error: { message: 'Unknown or unsupported to-widget action' },
          };
        }
        break;
    }
    this.post({ ...msg, response });
  }
}
