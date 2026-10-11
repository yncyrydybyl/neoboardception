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

/**
 * One capture-phase `message` listener per window that validates Widget API
 * traffic before any transport sees it: it checks `event.source` and
 * `event.origin` of every message in one place.
 *
 * Rules for messages that look like Widget API messages (`api` field):
 * - carrying the widget id of a registered embedded widget: must come from
 *   that widget's iframe window and from its expected origin;
 * - sent by a registered embedded widget's window with any other widget id:
 *   dropped (an embedded widget may only speak for itself);
 * - everything else must come from `window.parent` (the host's own client),
 *   unless `strictParent` is disabled.
 *
 * O(1) per message, independent of the number of embedded widgets.
 */

interface GuardEntry {
  window: Window;
  /** Expected `event.origin`; `'null'` for opaque (sandboxed) origins. */
  origin: string;
}

export interface MessageGuardOptions {
  strictParent?: boolean;
  onBlocked?: (reason: string, widgetId: unknown) => void;
}

class MessageGuard {
  private readonly byWidgetId = new Map<string, GuardEntry>();
  private readonly byWindow = new Map<Window, string>();
  private installed = false;
  private onBlocked?: MessageGuardOptions['onBlocked'];
  private strictParent = true;

  constructor(private readonly win: Window) {}

  register(
    widgetId: string,
    entry: GuardEntry,
    options: MessageGuardOptions = {},
  ): () => void {
    if (this.byWidgetId.has(widgetId)) {
      throw new Error(`Embedded widget id already in use: ${widgetId}`);
    }
    this.byWidgetId.set(widgetId, entry);
    this.byWindow.set(entry.window, widgetId);
    if (options.onBlocked) this.onBlocked = options.onBlocked;
    if (options.strictParent === false) this.strictParent = false;
    this.install();
    return () => {
      if (this.byWidgetId.get(widgetId) === entry) {
        this.byWidgetId.delete(widgetId);
        this.byWindow.delete(entry.window);
      }
      if (this.byWidgetId.size === 0) this.uninstall();
    };
  }

  private readonly listener = (ev: MessageEvent) => {
    const data = ev.data as { api?: unknown; widgetId?: unknown } | null;
    if (!data || typeof data !== 'object' || typeof data.api !== 'string') {
      return;
    }
    const widgetId = data.widgetId;
    const entry =
      typeof widgetId === 'string' ? this.byWidgetId.get(widgetId) : undefined;
    let reason: string | undefined;
    if (entry) {
      if (ev.source !== entry.window) reason = 'unexpected source';
      else if (ev.origin !== entry.origin) reason = 'unexpected origin';
    } else if (ev.source && this.byWindow.has(ev.source as Window)) {
      reason = 'embedded widget used a foreign widget id';
    } else if (this.strictParent && ev.source !== this.win.parent) {
      reason = 'message not from the parent window';
    }
    if (reason) {
      ev.stopImmediatePropagation();
      this.onBlocked?.(reason, widgetId);
    }
  };

  private install() {
    if (this.installed) return;
    this.win.addEventListener('message', this.listener, true);
    this.installed = true;
  }

  private uninstall() {
    if (!this.installed) return;
    this.win.removeEventListener('message', this.listener, true);
    this.installed = false;
    this.strictParent = true;
  }
}

const guards = new WeakMap<Window, MessageGuard>();

/** Registers an embedded widget with the window's shared guard. */
export function registerWithMessageGuard(
  win: Window,
  widgetId: string,
  entry: GuardEntry,
  options?: MessageGuardOptions,
): () => void {
  let guard = guards.get(win);
  if (!guard) {
    guard = new MessageGuard(win);
    guards.set(win, guard);
  }
  return guard.register(widgetId, entry, options);
}
