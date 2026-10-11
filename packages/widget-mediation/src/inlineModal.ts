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
 * Inline modals: an embedded widget's `open_modal` shown by the host itself
 * (instead of the outer client). The host mounts the modal URL as a second
 * mediated widget instance; this file holds the modal's bookkeeping (spec,
 * buttons, exactly-once close), the instance itself is an embedded widget
 * created by the parent (`createInstance`).
 */

import type {
  EmbeddedModalButton,
  EmbeddedModalMountCallbacks,
  EmbeddedModalRequest,
  EmbeddedWidgetState,
} from './types';

/** Like the outer client: at most three buttons are shown. */
export const MAX_MODAL_BUTTONS = 3;
/** The built-in close button; a modal widget cannot toggle it. */
export const CLOSE_BUTTON_ID = 'm.close';
/** Result of a modal that ended without data (cancel, escape). */
export const MODAL_EXITED = Object.freeze({ 'm.exited': true });

const MAX_NAME = 200;
const MAX_ID = 128;
const MAX_KIND = 64;

/** The sanitised `open_modal` request. */
export interface ModalSpec {
  type: string;
  /** Modal URL as requested (template, validated by the parent). */
  url: string;
  name: string;
  buttons: EmbeddedModalButton[];
  data: Record<string, unknown>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype ||
      Object.getPrototypeOf(v) === null)
  );
}

function shortString(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length <= max ? v : undefined;
}

/**
 * Reads the `open_modal` data defensively: unknown fields are dropped,
 * buttons are limited to {@link MAX_MODAL_BUTTONS} with unique ids.
 */
export function parseModalSpec(raw: unknown, url: string): ModalSpec {
  const d = isPlainObject(raw) ? raw : {};
  const buttons: EmbeddedModalButton[] = [];
  if (Array.isArray(d.buttons)) {
    for (const b of d.buttons) {
      if (buttons.length >= MAX_MODAL_BUTTONS || !isPlainObject(b)) continue;
      const id = shortString(b.id, MAX_ID);
      const label = shortString(b.label, MAX_NAME);
      if (!id || label === undefined || buttons.some((x) => x.id === id)) {
        continue;
      }
      buttons.push({
        id,
        label,
        kind: shortString(b.kind, MAX_KIND) ?? 'm.secondary',
        disabled: b.disabled === true,
      });
    }
  }
  return {
    type: shortString(d.type, MAX_KIND) ?? 'm.custom',
    url,
    name: (shortString(d.name, MAX_NAME) ?? '').trim(),
    buttons,
    data: isPlainObject(d.data) ? d.data : {},
  };
}

/** What the modal widget instance (an embedded widget) needs from the modal. */
export interface ModalContext {
  readonly widgetId: string;
  /** Sent as `widget_config` once the modal widget is ready. */
  readonly widgetConfig: Record<string, unknown>;
  /** The modal widget sent `close_modal`. */
  closeFromWidget(data: unknown): void;
  /** `set_button_enabled`; `false` for an unknown or built-in button. */
  setButtonEnabled(id: string, enabled: boolean): boolean;
}

/** A mounted modal widget instance. */
export interface ModalInstance {
  clickButton(id: string): void;
  destroy(): void;
}

export interface InlineModalHost {
  readonly widgetId: string;
  readonly parentWidgetId: string;
  readonly origin: string;
  readonly displayUrl: string;
  createInstance(
    container: HTMLElement,
    context: ModalContext,
    onStateChange?: (state: EmbeddedWidgetState) => void,
  ): ModalInstance;
  /** Delivers `close_modal` to the embedded widget that opened the modal. */
  deliverClose(data: Record<string, unknown>): void;
  /** The modal ended (the parent frees its slot). */
  onClosed(): void;
}

export class InlineModal implements EmbeddedModalRequest, ModalContext {
  readonly closed: Promise<void>;
  private resolveClosed!: () => void;
  private isClosed = false;
  private instance: ModalInstance | undefined;
  private current: EmbeddedModalButton[];
  private onButtonsChange: ((b: EmbeddedModalButton[]) => void) | undefined;

  constructor(
    private readonly spec: ModalSpec,
    private readonly host: InlineModalHost,
  ) {
    this.current = spec.buttons.map((b) => ({ ...b }));
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  get widgetId(): string {
    return this.host.widgetId;
  }

  get parentWidgetId(): string {
    return this.host.parentWidgetId;
  }

  get name(): string {
    return this.spec.name;
  }

  get origin(): string {
    return this.host.origin;
  }

  get url(): string {
    return this.host.displayUrl;
  }

  get buttons(): readonly EmbeddedModalButton[] {
    return this.current.map((b) => ({ ...b }));
  }

  get widgetConfig(): Record<string, unknown> {
    // What the outer client sends: the modal's own open request.
    return {
      type: this.spec.type,
      url: this.spec.url,
      name: this.spec.name,
      buttons: this.spec.buttons.map((b) => ({ ...b })),
      data: this.spec.data,
    };
  }

  mount(
    container: HTMLElement,
    callbacks: EmbeddedModalMountCallbacks = {},
  ): () => void {
    if (this.isClosed) return () => undefined;
    this.instance?.destroy();
    this.onButtonsChange = callbacks.onButtonsChange;
    const instance = this.host.createInstance(
      container,
      this,
      callbacks.onStateChange,
    );
    this.instance = instance;
    return () => {
      if (this.instance !== instance) return;
      this.instance = undefined;
      this.onButtonsChange = undefined;
      instance.destroy();
    };
  }

  clickButton(id: string): void {
    const button = this.current.find((b) => b.id === id);
    if (!button || button.disabled || this.isClosed) return;
    this.instance?.clickButton(id);
  }

  cancel(): void {
    this.close({ ...MODAL_EXITED }, true);
  }

  closeFromWidget(data: unknown): void {
    this.close(isPlainObject(data) ? data : { ...MODAL_EXITED }, true);
  }

  /** The embedded widget went away: end the modal, nobody to tell. */
  abort(): void {
    this.close({ ...MODAL_EXITED }, false);
  }

  setButtonEnabled(id: string, enabled: boolean): boolean {
    if (id === CLOSE_BUTTON_ID) return false;
    const button = this.current.find((b) => b.id === id);
    if (!button) return false;
    if (button.disabled === !enabled) return true;
    button.disabled = !enabled;
    try {
      this.onButtonsChange?.(this.buttons as EmbeddedModalButton[]);
    } catch {
      // A failing UI callback must not break the widget's request.
    }
    return true;
  }

  private close(data: Record<string, unknown>, deliver: boolean) {
    if (this.isClosed) return;
    this.isClosed = true;
    const instance = this.instance;
    this.instance = undefined;
    this.onButtonsChange = undefined;
    instance?.destroy();
    this.host.onClosed();
    if (deliver) this.host.deliverClose(data);
    this.resolveClosed();
  }
}
