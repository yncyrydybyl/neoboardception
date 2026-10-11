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
 * Local, per-client runtime status reported by a renderer. Never written to
 * the board document.
 */
export type EmbeddedWidgetRuntimeStatus =
  | { state: 'loading' }
  | {
      /**
       * The widget asks for permissions. If `awaitingClient` is set, the
       * Matrix client (e.g. Element) shows its own dialog right now; that
       * dialog only names the board, so the board explains who is asking.
       */
      state: 'negotiating';
      awaitingClient?: boolean;
      origin?: string;
      preapproved?: EmbeddedWidgetPreapproval;
    }
  | {
      /**
       * Local consent: the board must ask the user before the widget gets
       * any permission. `respond` must be called exactly once.
       */
      state: 'consent';
      request: EmbeddedWidgetConsentRequest;
      respond: (approved: boolean) => void;
    }
  | {
      state: 'ready';
      preapproved?: EmbeddedWidgetPreapproval;
      /** Permissions the widget asked for that it cannot get here. */
      limits?: EmbeddedWidgetCapabilityLimits;
    }
  | {
      state: 'error';
      /**
       * Technical description (not localised). The board shows a localised
       * text for `code` and keeps this one for details and logs.
       */
      message?: string;
      /** `denied`: no permission was granted. */
      reason?: 'denied' | 'load-failed' | 'timeout';
      /** Finer cause, selects the localised message. */
      code?: EmbeddedWidgetErrorCode;
      /**
       * If set, the board offers a retry button (explicit user action).
       * Never offered for permanent errors (see
       * {@link isPermanentEmbeddedWidgetErrorCode}).
       */
      retry?: () => void;
    };

/**
 * Cause of an embedded widget error, for localised messages.
 *
 * - `policy`: the deployment's policy does not allow this widget.
 * - `origin-not-allowed`: the widget's origin is not allowed.
 * - `same-origin`: the widget would run on the board's own origin.
 * - `invalid-url`: the widget URL was refused.
 * - `navigated`: the widget left its page and was stopped.
 * - `timeout`: the widget did not load in time.
 * - `denied`: no permission was granted.
 * - `load-failed`: anything else while loading.
 */
export type EmbeddedWidgetErrorCode =
  | 'policy'
  | 'origin-not-allowed'
  | 'same-origin'
  | 'invalid-url'
  | 'navigated'
  | 'timeout'
  | 'denied'
  | 'load-failed';

/** Errors that a retry cannot fix (the configuration or URL must change). */
export function isPermanentEmbeddedWidgetErrorCode(
  code: EmbeddedWidgetErrorCode | undefined,
): boolean {
  return (
    code === 'policy' ||
    code === 'origin-not-allowed' ||
    code === 'same-origin' ||
    code === 'invalid-url'
  );
}

/**
 * Permissions an embedded widget asked for but cannot get on this board,
 * because the deployment's policy or the board's hard limits refuse them
 * (not because the user declined). Local UI only.
 */
export type EmbeddedWidgetCapabilityLimits = {
  /** Everything the widget asked for. */
  requested: readonly string[];
  /** The part of `requested` that is not available here. */
  blocked: readonly string[];
};

/**
 * The deployment's operator approved the widget's permissions in advance, so
 * the board skips its consent step. The board still names the widget in a
 * non-blocking notice.
 */
export type EmbeddedWidgetPreapproval = {
  /** Origin of the embedded widget. */
  origin: string;
  /** Name from the operator's configuration, if any. */
  name?: string;
};

/** What an embedded widget asks for, shown in the board's consent UI. */
export type EmbeddedWidgetConsentRequest = {
  /** Origin of the embedded widget, e.g. `https://poll.example.org`. */
  origin: string;
  /** Widget URL without query and fragment. */
  url: string;
  /** Every capability the widget asks for (after the host's policy). */
  capabilities: readonly string[];
  /**
   * Subset that the Matrix client still has to approve in its own dialog.
   * The rest is already held by the board and would be passed on silently
   * without this consent.
   */
  upstream: readonly string[];
};

/** A button of an embedded widget's modal. */
export type EmbeddedWidgetModalButton = {
  id: string;
  label: string;
  /** `m.primary`, `m.secondary`, `m.warning`, `m.danger`, `m.link`, … */
  kind: string;
  disabled: boolean;
};

/** Local status of the widget shown inside a modal. */
export type EmbeddedWidgetModalStatus =
  | { state: 'loading' }
  | { state: 'ready' }
  | {
      state: 'error';
      /** Finer cause, selects the user-facing message. */
      code?: EmbeddedWidgetErrorCode;
      /** Technical description (English), for logs. */
      message?: string;
    };

/**
 * A modal the embedded widget opened, shown by the board in a dialog (not
 * by the Matrix client). The renderer reports it with `onModalChange` and
 * reports `undefined` when it ended.
 */
export type EmbeddedWidgetModal = {
  /** Title requested by the widget (may be empty). */
  name: string;
  /** Origin of the modal's content (the embedded widget's origin). */
  origin: string;
  buttons: readonly EmbeddedWidgetModalButton[];
  /**
   * Mounts the modal's content (a widget iframe) into `container`. Returns
   * a cleanup function that removes it again.
   */
  mount: (
    container: HTMLElement,
    callbacks: {
      onButtonsChange: (buttons: EmbeddedWidgetModalButton[]) => void;
      onStatusChange: (status: EmbeddedWidgetModalStatus) => void;
    },
  ) => () => void;
  /** The user clicked one of `buttons`. */
  clickButton: (id: string) => void;
  /** The user dismissed the dialog (close button, Escape). */
  cancel: () => void;
};

/** Something the widget did that is visible to other room members. */
export type EmbeddedWidgetActivity = {
  kind: 'shared-change';
  /** Event type (no content). */
  eventType: string;
};

/**
 * Local, per-client view state of a mounted widget, decided by the board.
 * Never written to the board document.
 */
export type EmbeddedWidgetViewState = {
  /**
   * The element intersects the visible part of the canvas (computed from the
   * board's viewport, not with IntersectionObserver). Renderers may suspend
   * work (e.g. stop feeding events) while not visible.
   */
  visible: boolean;
  /**
   * A pan or zoom gesture is in progress. The board hides the container
   * (`visibility: hidden`) and shows the placeholder meanwhile.
   */
  gesturing: boolean;
  /**
   * The user is interacting with the widget. Only then does the container
   * receive pointer events (`pointer-events: auto`); otherwise it is
   * `pointer-events: none` so the board can select, move and pan.
   */
  interactive: boolean;
};

export type EmbeddedWidgetRendererProps = {
  /**
   * Empty element owned by the board. The renderer may append children (e.g.
   * an iframe) and must remove everything it added when unmounted.
   *
   * The container is sized to the element in canvas units and follows moves
   * and resizes. Zooming scales it visually (SVG viewBox) without changing
   * its CSS box, so the widget is not re-laid out on zoom. The board controls
   * `pointer-events` and `visibility` of the container; renderers must not
   * override them on their children.
   */
  container: HTMLElement;
  /**
   * The widget URL from the board document. Already validated (https, no
   * credentials) and accepted by the configured URL policy. Matrix widget
   * template variables are *not* substituted yet. A change of the URL in the
   * board document never remounts: the board deactivates the element, so
   * the user has to load it again (and consent again).
   */
  widgetUrl: string;
  /** Id of the board element; stable for the lifetime of the element. */
  elementId: string;
  /** Optional title from the board document. */
  title?: string;
  /**
   * Capabilities declared in the board document, if any. Untrusted hint for
   * early batching of capability requests; grants nothing by itself.
   */
  capabilities?: readonly string[];
  /**
   * The current user cannot edit the board (e.g. slide locked, viewing a
   * presentation). Interaction with the widget itself may still be allowed.
   */
  readOnly: boolean;
  /** View state at mount time; changes are delivered via `update`. */
  viewState: EmbeddedWidgetViewState;
  /** Report local runtime status, e.g. to hide the placeholder when ready. */
  onStatusChange: (status: EmbeddedWidgetRuntimeStatus) => void;
  /**
   * Leave the interaction state, e.g. when the user presses Escape inside the
   * widget (key events inside the iframe do not reach the board).
   */
  exitInteraction: () => void;
  /**
   * Report that the widget changed shared state (e.g. sent a room event), so
   * the board can show that everybody sees this now. Local UI only.
   */
  onActivity: (activity: EmbeddedWidgetActivity) => void;
  /**
   * Keep this widget mounted (e.g. a running call): while set, the board
   * never unmounts it to make room for other live widgets. Local only.
   */
  setKeepAlive?: (keepAlive: boolean) => void;
  /**
   * The widget opened a modal (or `undefined`: it ended). The board shows
   * it in a dialog. At most one per widget. Local only.
   */
  onModalChange?: (modal: EmbeddedWidgetModal | undefined) => void;
};

export type EmbeddedWidgetMountHandle = {
  /** Remove everything that was added to the container and release resources. */
  unmount: () => void;
  /** Called whenever the board changes the view state of this widget. */
  update?: (viewState: EmbeddedWidgetViewState) => void;
};

/**
 * Mounts a widget into the given container. Returns either a cleanup
 * function or a {@link EmbeddedWidgetMountHandle}.
 *
 * The board only mounts widgets that are *live*: never in previews,
 * thumbnails or exports, only for allowed URLs, only after the user (or the
 * host) activated the element, and at most `maxLiveWidgets` at a time (least
 * recently activated widgets are unmounted first).
 *
 * The board unmounts when the element is removed or deactivated, and
 * remounts when `elementId`, `capabilities` or `readOnly` change. A change
 * of `widgetUrl` (e.g. by another user) unmounts and deactivates the
 * element; it needs a new activation. Title and geometry changes do not
 * remount.
 */
export type EmbeddedWidgetRenderer = (
  props: EmbeddedWidgetRendererProps,
) => (() => void) | EmbeddedWidgetMountHandle;
