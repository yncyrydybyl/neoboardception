# Embedded widget element — integration guide

This document describes the `embedded-widget` board element of the React SDK
and the interface a widget host (the component that actually runs a widget in
an iframe) uses to render into it.

Code: `packages/react-sdk/src/embeddedWidget/` (exported from the SDK index).

## 1. Two separate kinds of state

| State                | Where it lives                  | Synchronized to    |
| -------------------- | ------------------------------- | ------------------ |
| Shell                | Board document (Yjs CRDT)       | All board users    |
| Widget content       | Matrix room events              | Read by the widget |
| Runtime / view state | Local React state of one client | Nobody             |

The **shell** is the `EmbeddedWidgetElement`:

```ts
type EmbeddedWidgetElement = {
  type: 'embedded-widget';
  position: { x: number; y: number };
  width: number;
  height: number;
  widgetUrl: string; // absolute https URL, ≤ 2048 chars, no credentials
  title?: string; // ≤ 256 chars
  capabilities?: string[]; // ≤ 64 unique entries, hint only
  attachedFrame?: string; // infinite canvas frames, like other elements
};
```

Iframe state, focus/interaction, loaded/live state, capability grants and
widget data (e.g. poll votes) are never written to the document. Tests assert
this (`crdt.test.ts`, `EmbeddedWidgetDisplay.test.tsx`).

## 2. Design decisions

### Widget reference: URL instead of a reference to a room widget definition

The shell stores the widget URL directly.

- The board stays self-contained: export/import (`.nwb`), copy/paste across
  boards and rooms, and duplicating work without resolving a reference that
  might not exist in the target room.
- A reference (e.g. to a room widget state event) would need extra read
  capabilities for the board and would break when the definition is removed.
- The URL decides which code runs in every viewer's browser, so it is treated
  as **untrusted input** and checked on two levels:
  1. **Structural rule (schema, always on):** `https:` only, absolute, no
     embedded credentials, length limit. Elements that fail are rejected by
     the document schema, like any other invalid element.
  2. **Deployment allow-list (hook, deny by default):**
     `EmbeddedWidgetUrlPolicy = (url: URL) => boolean`. It is evaluated on
     every client before mounting and again on insertion. Without
     configuration nothing is mounted and insertion is disabled. Board users
     cannot widen it. `createOriginAllowListPolicy(origins)` matches exact
     origins (scheme, host, port).

  The NeoBoard widget wires the policy from its deployment configuration:
  the operator policy `REACT_APP_EMBEDDED_WIDGET_POLICY` (rules per widget
  URL, `HANDOFF.md` §5c) or `REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS`
  (comma-separated https origins).

### Declared capabilities in the shell

`capabilities` is optional, small and static metadata, comparable to the URL.
It lets a host batch capability requests for all widgets of a board early
(in parallel with iframe loading) instead of waiting for each widget's own
request. It is a **hint, not a grant**: a host must intersect it with its own
allow-list and with what the widget actually requests. The field is not
filled by the insertion dialog yet; hosts or catalogs can set it through
`createEmbeddedWidgetElement({ capabilities })`.

### No document version bump

The element is an additional entry of the element union; no migration is
needed. Clients that do not know the element type reject documents that
contain it (the element schema is a closed union). See open questions.

## 3. Renderer interface

```ts
type EmbeddedWidgetRenderer = (
  props: EmbeddedWidgetRendererProps,
) => (() => void) | EmbeddedWidgetMountHandle;

type EmbeddedWidgetRendererProps = {
  container: HTMLElement; // empty, owned by the board, sized to the element
  widgetUrl: string; // validated + allowed; template variables not substituted
  elementId: string;
  title?: string;
  capabilities?: readonly string[]; // untrusted hint from the shell
  readOnly: boolean; // board is read-only for this user
  viewState: EmbeddedWidgetViewState; // initial view state
  onStatusChange: (status: EmbeddedWidgetRuntimeStatus) => void;
  exitInteraction: () => void; // e.g. on Escape inside the iframe
  onActivity: (activity: EmbeddedWidgetActivity) => void; // shared change → glow
};

type EmbeddedWidgetMountHandle = {
  unmount: () => void;
  update?: (viewState: EmbeddedWidgetViewState) => void;
};

type EmbeddedWidgetViewState = {
  visible: boolean; // intersects the viewport (viewBox math)
  gesturing: boolean; // pan/zoom in progress
  interactive: boolean; // user interacts; container gets pointer events
};

type EmbeddedWidgetRuntimeStatus =
  | { state: 'loading' }
  | { state: 'negotiating'; awaitingClient?: boolean; origin?: string }
  | {
      state: 'consent'; // board shows its consent panel
      request: EmbeddedWidgetConsentRequest; // origin, url, capabilities, upstream
      respond: (approved: boolean) => void;
    }
  | { state: 'ready' } // hides the placeholder
  | {
      state: 'error';
      message?: string;
      reason?: 'denied' | 'load-failed' | 'timeout';
      retry?: () => void; // board shows "Try again"
    };
```

Contract:

- Append the iframe (or anything else) to `container`; remove everything in
  `unmount`.
- Mount happens once per live element. Remount happens when `widgetUrl`,
  `elementId`, `capabilities` or `readOnly` change. Title, position and size
  changes do not remount; the container follows geometry by itself.
- `update` may be called with an unchanged view state.
- The board sets `pointer-events` and `visibility` on the container. Do not
  override them on children (an iframe inherits `pointer-events: none`).
- Report `ready` once the widget is usable; until then the placeholder covers
  the container.

## 4. Lifecycle on the board

- **Placeholder by default.** An element shows icon, title (or host name), URL
  and a status line. Nothing is mounted until the element is _live_.
- **Live.** The user activates an element with "Load widget"; a host can call
  `useEmbeddedWidgetHost().activate(elementId)` (e.g. to auto-activate a few
  visible widgets). At most `maxLiveWidgets` (default 3) are live per client;
  activating another one unmounts the least recently activated one.
- **Never in previews.** Slide thumbnails are wrapped in
  `EmbeddedWidgetPreview`; the PDF export draws a rectangle with title and URL.
- **Interaction.** Double click on a live element enters interaction
  (`interactive: true`, container receives pointer events). Pointer down
  outside the element or Escape leaves it. Escape pressed _inside_ the iframe
  does not reach the board; a renderer may forward it by calling
  `exitInteraction()`.
- **Pan/zoom and off-viewport.** While the viewport changes (and 150 ms after),
  and while the element is outside the viewport, the board hides the
  container and shows the placeholder (`gesturing` / `visible: false` in the
  view state). Renderers may additionally suspend work, e.g. stop feeding
  events, and resync when visible again.
- **Zoom does not resize the widget's CSS box.** The element lives in canvas
  units inside an SVG `foreignObject`; zoom scales it visually.

## 5. Wiring a renderer

```tsx
import {
  createOriginAllowListPolicy,
  EmbeddedWidgetProvider,
} from '@nordeck/matrix-neoboard-react-sdk';

<EmbeddedWidgetProvider
  renderer={myRenderer}
  isUrlAllowed={createOriginAllowListPolicy(['https://widgets.example.org'])}
  insertionEnabled
  maxLiveWidgets={3}
>
  <App />
</EmbeddedWidgetProvider>;
```

In the NeoBoard widget this provider is placed in
`matrix-neoboard-widget/src/AppContainer.tsx` with the renderer from
`src/embeddedWidgets/mediationRenderer.ts` (based on
`@nordeck/matrix-widget-mediation`, loaded lazily through `preload`).

## 6. Open questions

- **Compatibility with clients without this element:** they reject documents
  containing an `embedded-widget` element (closed element union). Options:
  a tolerant fallback for unknown element types upstream, or a document
  version bump that makes such clients show the "unsupported document" notice.
- **`foreignObject` vs. HTML overlay:** iframes inside `foreignObject` are
  re-rasterized on every viewBox change and have known Safari issues. An
  overlay layer positioned by CSS transforms may perform better at the cost of
  z-order with SVG elements. The renderer interface does not depend on this
  choice.
- **Template variables** (`$matrix_room_id`, …) are substituted by the
  renderer (the mediation package), not by the board.
- **Editing** URL/title of an existing element has no UI yet (data model and
  `generateUpdateElement` support it).
- **Stale live entries:** live ids of deleted elements stay in the LRU list
  until evicted.
