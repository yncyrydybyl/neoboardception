# Handoff — NeoBoardception (embedded widgets in NeoBoard)

> **Kurzfassung (Deutsch).** NeoBoardception erweitert NeoBoard um ein
> Board-Element, in dem ein echtes Matrix-Widget (erster Fall: Matrix Poll)
> läuft. Die _Hülle_ (URL, Position, Größe) liegt im Yjs-Dokument des Boards,
> der _Inhalt_ (z. B. Stimmen) in Matrix-Events, die das eingebettete Widget
> selbst über die Widget-API liest und schreibt. Die Funktionalität steckt
> überwiegend in zwei eigenständigen Teilen: dem neuen Modul
> `packages/react-sdk/src/embeddedWidget/` und dem neuen Paket
> `packages/widget-mediation`. Im NeoBoard-Kern sind 13 Dateien berührt,
> meist mit wenigen Zeilen (Element-Union, Schema, Render-Weiche, PDF,
> Vorschau, Toolbar, Verdrahtung). Wichtigster offener Punkt für Upstream:
> Ältere NeoBoard-Clients verwerfen Dokumente mit dem neuen Elementtyp
> (geschlossene Element-Union) — Vorschlag: zuerst tolerante Behandlung
> unbekannter Elemente upstream. Bewiesen ist: Capability-Vermittlung über
> zwei Ebenen inklusive Laufzeit-Nachforderung (MSC2974) funktioniert in
> Element Web ohne Änderungen an Element oder Spec. Gate 2 (echtes Poll im
> Board, zwei Nutzer, auch E2EE) ist bestanden. Die Betreiber-Policy für
> eingebettete Widgets (Schema des Lifecycle-Moduls, Vorab-Genehmigung,
> optionale Initial-Union) ist umgesetzt (§5c). Offen ist die Verifikation
> der Härtung in einem echten Element (`TODO(F)`).

This document is for the NeoBoard maintainers. It lists every change to the
NeoBoard core, separates self-contained additions from core patches, and
collects build settings, tests, open points and risks.

Related documents:

- [`neoboardception-docs/architecture.md`](neoboardception-docs/architecture.md):
  state worlds, capability chain, event and modal flow, lifecycle,
  allow-lists (Mermaid diagrams).
- [`neoboardception-docs/INTEGRATION.md`](neoboardception-docs/INTEGRATION.md):
  the board element and its renderer interface.
- [`packages/widget-mediation/README.md`](packages/widget-mediation/README.md):
  the host-side Widget API package.
- [`neoboardception-docs/upstream-proposals.md`](neoboardception-docs/upstream-proposals.md):
  draft issues for NeoBoard, the toolkit, Element Web and the spec.
- [`spike/README.md`](spike/README.md): the throwaway capability spike
  (German).

## 1. Status

| Step                                                               | State                                       |
| ------------------------------------------------------------------ | ------------------------------------------- |
| Spike: capability forwarding across two levels (Gate 1)            | done, passed in Element Web                 |
| Board element `embedded-widget` (shell in the CRDT)                | done, tested                                |
| `packages/widget-mediation` (host side of the Widget API)          | done, tested                                |
| Renderer wiring, UI states, real Matrix Poll on the board (Gate 2) | done, passed in Element Web, see §5a and §9 |
| Operator policy for embedded widgets (layer 2), initial union      | done, unit tested, see §5c                  |
| Hardening, widget lifecycle module configuration                   | guide done, verification open, see §10      |

Commits on top of NeoBoard `main` (in order):

1. `spike(agent-a): nested widget capability forwarding` — throwaway spike.
2. `chore: exclude spike/ from the root depcheck`.
3. `feat(widget-mediation): host side of the Widget API for embedded widgets`.
4. `feat(react-sdk): add embedded-widget board element (CRDT shell only)`.
5. Merge of 3 into 4, then the documentation commit.

## 2. Separate code vs. core patches

| Part                                      | Kind                                    | Size                     | Upstream effort                                    |
| ----------------------------------------- | --------------------------------------- | ------------------------ | -------------------------------------------------- |
| `packages/widget-mediation/`              | **New package**, no NeoBoard dependency | ~5,300 lines incl. tests | Low; could move to the toolkit (proposal A3)       |
| `packages/react-sdk/src/embeddedWidget/`  | **New module** inside the React SDK     | ~2,900 lines incl. tests | Low; self-contained, imported by the patches below |
| Core patches in `packages/react-sdk/src/` | **Core patch**                          | ~100 lines in 9 files    | Medium; see §3, would shrink with proposal A2      |
| Core patches in `matrix-neoboard-widget/` | **Core patch** (wiring)                 | ~25 lines                | Low                                                |
| Docs, locales, changeset                  | Additions to existing files             | small                    | Low                                                |
| `spike/` and its wiring                   | **Throwaway**                           | –                        | Do not upstream; drop before merging               |

New files of the board element (`packages/react-sdk/src/embeddedWidget/`):

| File                                             | Purpose                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `element.ts`                                     | Element type and Joi schema keys                                                 |
| `urlPolicy.ts`                                   | https-only validation, allow-list hook, origin allow-list helper                 |
| `renderer.ts`                                    | Renderer interface (mount point for a widget host)                               |
| `EmbeddedWidgetProvider.tsx`                     | Host config (renderer, policy, live cap), live/interaction state, preview marker |
| `EmbeddedWidgetDisplay.tsx`                      | Board element: placeholder, mount container, interaction, view state             |
| `EmbeddedWidgetPlaceholder.tsx`                  | Placeholder UI (icon, title, URL, status, "Load widget")                         |
| `viewport.ts`                                    | Viewport visibility (viewBox math) and gesture detection                         |
| `createEmbeddedWidgetElement.ts`                 | Builds a new shell centred and fitted on the canvas                              |
| `EmbedWidgetButton.tsx`, `EmbedWidgetDialog.tsx` | Tools bar action "Embed widget" with URL/title dialog                            |
| `pdf.ts`                                         | Static representation in the PDF export                                          |
| `index.ts`                                       | Public exports                                                                   |
| `*.test.ts(x)`                                   | Schema, URL policy, CRDT sync, export/import, clipboard, display, insertion      |

Files of the mediation package: see its README.

## 3. Core changes, one by one

"Upstream" means: suitable for NeoBoard `main` as is (**yes**), after the
named change (**with changes**), or not at all (**no**).

### 3.1 React SDK

| #   | File                                                                                | What                                                                                                                                                                                     | Why                                                                                            | Upstream                                                                                | Alternative                                                                      |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | `packages/react-sdk/src/state/crdt/documents/elements.ts`                           | Adds `EmbeddedWidgetElement` to the `Element` union, a new `embeddedWidgetElementSchema` branch in `elementSchema`, and the type to `copyElementWithAttachedFrame` / `findFrameToAttach` | The document schema is a closed union; without it the element is invalid and dropped           | **With changes**: only after tolerant unknown-element handling (§4, proposal A1)        | Element registry (proposal A2): register the schema instead of editing the union |
| 2   | `packages/react-sdk/src/state/crdt/documents/index.ts`                              | Exports the schema and type                                                                                                                                                              | Public API of the state module                                                                 | **Yes** (with 1)                                                                        | Not needed with a registry                                                       |
| 3   | `packages/react-sdk/src/state/export/whiteboardDocumentExport.ts`                   | Adds the element to the `.nwb` export/import schema                                                                                                                                      | `.nwb` import would reject boards with the element                                             | **With changes** (same as 1)                                                            | Export schema derived from the registry                                          |
| 4   | `packages/react-sdk/src/state/utils.ts`                                             | `changeElementFrame` accepts the type; `deleteRelations` strips `attachedFrame`                                                                                                          | Frame attach/detach and copy without relations work like for images                            | **Yes**                                                                                 | Let these helpers take `ElementBase`, then no change per type                    |
| 5   | `packages/react-sdk/src/components/Whiteboard/Element/ConnectedElement.tsx`         | Render branch `element.type === 'embedded-widget'` → `EmbeddedWidgetDisplay`                                                                                                             | Closed render switch                                                                           | **Yes** (with 1)                                                                        | Registry lookup of a `Display` component                                         |
| 6   | `packages/react-sdk/src/components/Whiteboard/SlidePreview.tsx`                     | Wraps the preview canvas in `EmbeddedWidgetPreview` (diff is mostly re-indentation)                                                                                                      | Slide thumbnails must never mount a live widget (one extra iframe and handshake per thumbnail) | **Yes**, generic and harmless                                                           | A generic `preview` prop or context that any element can read                    |
| 7   | `packages/react-sdk/src/components/BoardBar/pdf/createWhiteboardPdfContentSlide.ts` | `case 'embedded-widget'`: draws a rectangle with title and URL                                                                                                                           | PDF export cannot render iframe content                                                        | **Yes** (with 1)                                                                        | Registry `toPdf`, or a generic bounding-box fallback for unknown types           |
| 8   | `packages/react-sdk/src/components/ToolsBar/ToolsBar.tsx`                           | Adds `<EmbedWidgetButton>` (renders nothing unless insertion is enabled)                                                                                                                 | Insertion gesture                                                                              | **With changes**: product decision where the action belongs (tools bar vs. insert menu) | Registry `toolsBarAction`; or insertion only from a host-provided catalog        |
| 9   | `packages/react-sdk/src/index.ts`                                                   | `export * from './embeddedWidget'`                                                                                                                                                       | Hosts need the provider, policy helpers and renderer types                                     | **Yes**                                                                                 | Separate entry point (`/embedded-widget`) to keep it out of the main export      |
| 10  | `packages/react-sdk/src/locales/{en,de}/neoboard.json`                              | Strings for placeholder, dialog and tools bar action                                                                                                                                     | i18n                                                                                           | **Yes**                                                                                 | –                                                                                |

### 3.2 NeoBoard widget

| #   | File                                           | What                                                                                                                                                                                                                            | Why                                                                     | Upstream                              | Alternative                                   |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------- |
| 11  | `matrix-neoboard-widget/src/AppContainer.tsx`  | Takes the embedded widget configuration (`embeddedWidgets/config.ts`: origins or operator policy), creates the mediation renderer, wraps `<App>` in `<EmbeddedWidgetProvider>`; insertion enabled only if an origin is allowed. | Deny by default; the allow-list must come from deployment configuration | **Yes**                               | –                                             |
| 12  | `matrix-neoboard-widget/src/index.tsx` (spike) | Dynamic import of the spike, guarded by `import.meta.env.REACT_APP_NBC_SPIKE_INNER_ORIGINS` (compiled out when unset)                                                                                                           | Spike only                                                              | **No**. Remove before merging         | –                                             |
| 12a | `matrix-neoboard-widget/src/index.tsx`         | Appends the optional initial union (`withInitialCapabilities`) to the capabilities passed to `WidgetApiImpl.create`; unchanged list when the option is off                                                                      | One client dialog at start-up instead of renegotiation (§5c)            | **Yes** (no effect unless configured) | A toolkit hook for extra initial capabilities |
| 13  | `matrix-neoboard-widget/tsconfig.json` (spike) | `rootDir: ".."`, includes `../spike/nested-host/src`                                                                                                                                                                            | Type-check the spike from the widget                                    | **No**. Revert with 12                | –                                             |

### 3.3 Repository files

| #   | File                                    | What                                                   | Why                                                                               | Upstream                                | Alternative |
| --- | --------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------- | ----------- |
| 14  | `package.json` (root)                   | `depcheck:root` gets `--ignore-patterns=spike`         | Spike scripts import tools that are not dependencies; the lint-staged hook failed | **No**. Revert when `spike/` is removed | –           |
| 15  | `docs/model/crdt-documents.md`          | Documents `EmbeddedWidgetElement`                      | Data model docs                                                                   | **Yes**                                 | –           |
| 16  | `docs/configuration.md`                 | Documents the embedded widget variables and the policy | Configuration docs                                                                | **Yes**                                 | –           |
| 17  | `.changeset/embedded-widget-element.md` | Minor bump for react-sdk and widget                    | Release notes                                                                     | **Yes**                                 | –           |

Unchanged by design: copy/paste, duplicate, undo/redo, move/resize, frame
attachment and `.nwb` import all work through the generic element code
paths once the type is part of the union and the schema.

The new workspace package (`packages/widget-mediation`) is picked up by the
existing `packages/*` workspace and vitest project globs; no root config
change was needed for it.

## 4. Document compatibility

**Problem (verified in code).** The element schema is a closed union
(`elementSchema` in `state/crdt/documents/elements.ts`, no `otherwise`), and
every slide validates all its elements against it. A NeoBoard client that
does not know `embedded-widget`:

- drops every snapshot that contains such an element
  (`isValidWhiteboardDocumentSnapshot` → `false`, filtered in
  `SynchronizedDocumentImpl`), so it may load an older state or nothing;
- silently discards the live update that adds the element
  (`YDocument.applyChange` validates a clone and returns);
- shows no message, because the document version did not change.

Assumption (not tested): because Yjs applies each client's updates in order,
later updates of the same editing session may also stay pending on the old
client, so it stops seeing that user's edits until a reload.

Newer clients are not affected: they keep the element, and Yjs merges the
old client's own edits as usual.

**Options.**

| Option                                                    | How                                                                                                                | Pros                                                                           | Cons                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| A. Tolerant unknown elements upstream first (recommended) | `otherwise` branch with a permissive base schema; render a locked "needs newer version" placeholder; keep the data | Works for every future element type; no migration; old clients degrade visibly | Needs one upstream release before any new type is used; edit operations must skip unknown types   |
| B. Document version bump (`v2`)                           | New `WhiteboardDocumentVersion` that allows the element; migration like `v0 → v1`                                  | Old clients show the existing "unsupported document" notice                    | Migration per board; one bump per new element type; all boards that use it lock out older clients |
| B′. Lazy bump                                             | Bump only when the first embedded widget is inserted                                                               | Boards without the element stay compatible                                     | Same migration code; the version is the root map of the Y document, so mixing is not trivial      |
| C. Feature flag per deployment                            | Keep insertion disabled (empty origin list) until all clients of the deployment are updated                        | Already in place: no origin configured means no insertion                      | Does not help with boards shared across deployments, or with imported `.nwb` files                |
| D. Document only                                          | State that all clients must be updated together                                                                    | No code                                                                        | Silent data loss on old clients                                                                   |

Recommendation: **A upstream first, C in the meantime.** NeoBoardception
currently relies on C: without configured origins nothing can be inserted.
Draft issue: `upstream-proposals.md` A1, with the registry idea in A2.

## 5. Behaviour summary (board element)

- Deny by default: without a configured allow-list nothing is mounted and the
  insertion action is hidden.
- Placeholder by default; widgets mount only after activation, at most
  `maxLiveWidgets` (default 3) per client; never in slide thumbnails or
  exports.
- The mount container has `pointer-events: none` except in the interaction
  state (double click to enter; pointer down outside, Escape or the "Leave
  widget" button to leave) and
  is hidden during pan/zoom and while off-viewport.
- The shell stores the URL directly (not a reference to a room widget), so
  boards stay self-contained for export and copy. The URL is checked twice:
  structurally by the schema (https, no credentials, length) and by the
  deployment allow-list before every mount.
- `capabilities` in the shell is an optional hint for early capability
  requests. It grants nothing.

## 5a. Widget host and UI states (integration, Gate 2)

The NeoBoard widget renders embedded widgets with
`@nordeck/matrix-widget-mediation` (`packages/widget-mediation`):

- `matrix-neoboard-widget/src/embeddedWidgets/mediationRenderer.ts`
  implements `EmbeddedWidgetRenderer`. The mediation code is a separate,
  lazily loaded chunk (`import()`); it is loaded when a board shows an
  embedded widget element (`preload`), never for boards without one.
  `configureMediation` runs once; each mount uses the deployment allow-list,
  the Poll capability allow-list, denies the board's own
  `net.nordeck.whiteboard*` event types, fills `$matrix_*` template variables
  from the toolkit widget parameters, pauses event delivery while the element
  is hidden or the board pans/zooms, and destroys the widget on unmount
  (including remote deletion of the element).
- Local consent: before anything is passed on or requested from the client,
  the board shows which widget (title and origin) asks for which data (read,
  write, member list). Afterwards, while the client's own dialog is open
  (it only names the board), the board explains that the request comes from
  the embedded widget. Consent is remembered per widget URL (origin and
  path, normalised like the policy) for the session; two widgets on one
  origin never share a consent. A remote change of an element's URL while
  it runs deactivates the element (new activation and consent needed).
- Capabilities declared in the shell are asked for on activation and then
  requested from the client (`prerequestCapabilities`) while the widget boots.
- Modals (`open_modal`): per policy rule (`modals`), see §5e. Without a
  rule field, forwarded for origins in `REACT_APP_EMBEDDED_WIDGET_MODAL_ORIGINS`
  (default: none).
- UI states (icon + text + polite live region, not colour alone): placeholder
  (inactive), loading, permissions (consent / client dialog), ready (dimmed,
  "double-click to use"), interacting (thick coloured frame, "you are in the
  widget", "only you see this", "Leave widget" button), error / denied with
  a localised message per error code (technical text as tooltip and in the
  console) and "Try again" (`retryCapabilities` or reload; not offered for
  permanent errors such as a refused origin). Permissions refused by the
  policy show "x of y permissions not available here"; if nothing or no
  write permission is left, the state reads "Not supported here" instead of
  "Ready". When the widget sends an event (shared
  state), the element glows briefly and shows "everyone sees this now"
  (mediation hook `onEventSent`, no event content).

New files: `packages/react-sdk/src/embeddedWidget/EmbeddedWidgetConsent.tsx`,
`EmbeddedWidgetStatusBar.tsx`, `describeCapabilities.ts` (+ tests),
`matrix-neoboard-widget/src/embeddedWidgets/mediationRenderer.ts` (+ test).
Changed within the new modules: renderer interface (`consent` and
`negotiating` status, error `reason`/`retry`, `onActivity`), provider
(`preload`), display (status bar, frame, consent panel), placeholder (retry,
`denied`), default element size 720×540, mediation option `onEventSent`.

Touched core files for the integration:

| File                                                   | Reason                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `matrix-neoboard-widget/src/AppContainer.tsx`          | Pass renderer/preload; read origins at runtime or from `import.meta.env`; modal origins |
| `matrix-neoboard-widget/package.json`                  | Dependency on `@nordeck/matrix-widget-mediation` (workspace)                            |
| `packages/react-sdk/src/locales/{en,de}/neoboard.json` | Strings of consent panel, status bar and retry                                          |
| `docs/configuration.md`                                | Document `REACT_APP_EMBEDDED_WIDGET_MODAL_ORIGINS`                                      |
| `.changeset/embedded-widget-host.md`                   | Changeset entry                                                                         |

Configuration note: in the Vite build the toolkit's `getEnvironment` only
sees runtime configuration (`window.__ENVIRONMENT__`); its `process.env`
fallback is empty. The embedded widget settings therefore fall back to
`import.meta.env`, so build-time values work as well.

## 5b. Known limitations / open points (Gate 2)

- Clients without this element type reject documents containing it (closed
  element union, no document version bump).
- Modals in `forward` mode run top-level in the client under the board's
  identity; `inline` (§5e) avoids this.
- Escape pressed inside the embedded widget does not leave the interaction
  state (key events do not leave the iframe); click outside and the "Leave
  widget" button (keyboard reachable with Tab / Shift+Tab) work.
- No UI yet for editing URL/title or for declaring capabilities.
- Rotation is not supported for this element.

## 5c. Operator policy for embedded widgets (layer 2) and initial union

Element's widget lifecycle module only sees NeoBoard (layer 1). Layer 2 is
NeoBoard's own policy for the widgets it embeds, in the **same schema**
(`widget_permissions[<url pattern>]` → `capabilities_approved`,
`preload_approved`, `identity_approved`), so operators learn one format.
Details and the deliberate differences to the module: `hardening.md` §9.1
(German) and `packages/widget-mediation/README.md`.

- **Source:** `REACT_APP_EMBEDDED_WIDGET_POLICY` (JSON or `base64:<JSON>`),
  runtime (`window.__ENVIRONMENT__`) or build time (`import.meta.env`). Not
  a fetched file: the initial union needs it synchronously, and a missing
  file would come back as `index.html` with status 200. Never from room
  state or board content.
- **Matching:** origin + path of the normalised widget URL, without query
  and fragment (the board URL is user input; parameters are filled in by the
  mediator). Patterns must be normalised, `*` only as suffix. Exact rule
  beats glob, longest glob prefix wins, the winning rule applies as a whole.
- **Effects:** origins of the rules form the origin allow-list
  (`REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS`, if set, caps them);
  `capabilities_approved` minus the hard deny-list and the board's own types
  is the widget's allow-list; `preload_approved` skips the board's consent
  panel and shows a non-blocking notice that names the widget and its
  origin; `identity_approved` forwards OpenID requests (new mediation option
  `openId: 'forward'`, default `'deny'`); unlisted URLs are denied
  (`unlisted: "consent"` allows them with local consent).
- **Fail closed:** any error makes the whole policy invalid and turns
  embedding off, also with an origin list set. Unknown fields are warnings.
- **Initial union** (`REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION=true`, off by
  default): the policy's capabilities are added to NeoBoard's first
  capability request; embedded widgets then never renegotiate
  (`maxCapabilityRequests: 0`). Trade-off: every board holds these grants,
  also boards without embedded widgets (`hardening.md` §9.3).
- **Global capability list** (`REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES`,
  exact strings): without a policy, every allowed widget gets the Poll
  allow-list plus these. With a policy, an upper bound like the origin list:
  a rule keeps only Poll defaults and listed entries (dropped ones are
  warned about, also in the initial union); it never widens a rule or the
  default of unlisted widgets. Globs and hard-denied entries are ignored with
  a warning; the hard deny-list and the board's own types always win.
- **Live widgets** (`REACT_APP_EMBEDDED_WIDGET_MAX_LIVE`, 1–20, default 3):
  independent of the policy; invalid values fall back to the default with a
  warning.
- Without a policy, behaviour is unchanged (origin list, Poll allow-list
  plus the global capability list, consent panel for every widget).

New files: `packages/widget-mediation/src/policy.ts` (+ test, separate entry
point `@nordeck/matrix-widget-mediation/policy` so the main bundle does not
pull in the rest of the package), `matrix-neoboard-widget/src/embeddedWidgets/config.ts`
(+ test). Changed within the new modules: mediation `openId` option and
`askOpenID` in the driver; renderer `resolvePolicy` / `maxCapabilityRequests`;
renderer status `preapproved`; status bar notice.

Touched core files:

| File                                                                           | Reason                                                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `matrix-neoboard-widget/src/AppContainer.tsx`                                  | Configuration moved to `embeddedWidgets/config.ts`; passes the policy and `maxLiveWidgets` |
| `matrix-neoboard-widget/src/index.tsx`                                         | Optional initial union in `WidgetApiImpl.create` (core change #12a)                        |
| `packages/widget-mediation/package.json`                                       | `exports` with the `./policy` entry point                                                  |
| `packages/react-sdk/src/locales/{en,de}/neoboard.json`                         | Two strings for the pre-approval notice                                                    |
| `docs/configuration.md`                                                        | Policy, initial union, global capability list, max live widgets, runtime/build-time note   |
| `.changeset/embedded-widget-policy.md`, `.changeset/embedded-widget-config.md` | Changeset entries                                                                          |

## 5d. NeoBoard inside NeoBoard (event type namespace)

Without further measures an embedded NeoBoard opens the **same** board as
its host (`useOwnedWhiteboard` falls back to the first board of the room)
and, given the capabilities, could overwrite any board in the room. The
board's own types (`net.nordeck.whiteboard*`) are therefore denied to
embedded widgets. With an **event type namespace** an embedded NeoBoard gets
its own copy of these types instead:

- **Policy:** a rule field `event_namespace` maps a type prefix to a prefix
  below the reserved root `net.neoboardception.nested.`, e.g.
  `{"net.nordeck.whiteboard": "net.neoboardception.nested.net.nordeck.whiteboard"}`.
  `capabilities_approved` lists the **rewritten** strings (what the client
  sees and what the lifecycle module pre-approves). All embedded boards share
  this one namespace, so one rule can be pre-approved.
- **Mediator** (`packages/widget-mediation/src/namespace.ts`, option
  `eventNamespace`): rewrites in both directions — capability strings (room
  event, state event with `#state_key`/`#msgtype`, to-device), `send_event`,
  `read_events` filter and results, `read_relations` filter and chunk,
  pushed events, to-device messages, the local echo. `notify_capabilities`
  carries the widget's own strings. Order: rewrite first, then allow-list,
  configured denials (the board's own namespace, unchanged) and the hard
  deny-list on the rewritten form. The original namespace never goes up;
  events of the host's own types never come down. Content is not rewritten,
  except the `events` map of `m.room.power_levels` on the way down.
- **To-device:** forwarded only for rewritten types (needed for the
  embedded board's WebRTC signalling); everything else stays hard denied.
  Own budget (10 burst, 1/s).
- **Depth 1:** no embedded widget can name the reserved namespace directly
  (capabilities, sends, reads), with or without a map, so a namespaced
  widget cannot stack another namespace; namespace maps that nest the root
  are invalid. In addition an embedded NeoBoard (widget id `embedded-…`)
  turns embedding off for itself.
- **Embedded board** (`isEmbeddedBoard()`): shows only its own board (state
  key = its widget id, the same for every member), uses the WebRTC/session
  transport (MatrixRTC is not delegated), does not request power levels,
  TURN or media up-/download (`nestedBoard.ts`), does not try to change
  power levels.
- **Power levels:** the embedded board cannot write `m.room.power_levels`
  (hard deny). Its session type
  (`net.neoboardception.nested.net.nordeck.whiteboard.sessions`) therefore
  falls back to `state_default` (usually 50). The hosting board sets it to 0
  when an embedded board becomes ready and the user may change power levels
  (once per session; same thing the board does for its own session type).
  Until a moderator has opened an embedded board once, members without that
  power have no presence/live cursors there; drawing and saving work.
- **Generator:** `generate-lifecycle-config.mjs --rtc webrtc
--nested-neoboard-url <origin>` emits the namespaced capabilities for the
  NeoBoard lifecycle rule and the layer-2 rule with `event_namespace`.

## 5e. Modals of embedded widgets in the board (`modals: 'inline'`)

Matrix Poll opens a modal widget to create or edit polls and groups. Forwarded
to Element (`forward`), it runs top-level under NeoBoard's identity
(`modal_<NeoBoard id>`), asks for all Poll capabilities again (a third Element
dialog without a lifecycle rule) and Element sees the Poll origin. In `inline`
mode NeoBoard shows the modal itself:

- **Policy:** rule field `modals: "deny" | "forward" | "inline"`. Not set:
  `forward` for origins in `REACT_APP_EMBEDDED_WIDGET_MODAL_ORIGINS`, else
  `deny`. Invalid value: policy invalid. The generator writes `inline` by
  default (`--modals forward` restores the modal lifecycle rules).
- **Mediator** (`packages/widget-mediation/src/inlineModal.ts`, options
  `modals: 'inline'` + `onModalRequest`): `open_modal` (own origin only, one
  per widget) is acknowledged and handed to the host as an
  `EmbeddedModalRequest`. `mount(container)` starts a second mediated
  instance of the modal URL with widget id `modal_<embedded id>` (the toolkit
  only enters modal mode with this prefix; the task's working name
  `embedded-modal-<id>` would not). Its allow-list is the parent's granted
  set and it never asks upward (`maxCapabilityRequests: 0`), so no Element
  dialog. After `ready` it receives `widget_config` (type, url, name,
  buttons, data); `button_clicked` for enabled buttons; `set_button_enabled`
  (not `m.close`, not unknown ids); `close_modal` from the modal ends it and
  delivers the data to the parent; `cancel()` delivers `{"m.exited": true}`;
  parent removal/reload ends it silently. Forward and deny are unchanged.
- **Board** (`EmbeddedWidgetModalDialog.tsx`): MUI dialog (focus trap,
  labelled by the modal name, described by the origin note), the modal
  iframe, the buttons (first rightmost; kinds mapped to MUI variants), a
  close button; Escape and close cancel, the backdrop does nothing. React
  events from the dialog portal do not reach the board element. Renderer
  prop `onModalChange` (react-sdk), wiring in `mediationRenderer.ts`.
- **Strings:** `embeddedWidget.modal.*` (de/en).

## 6. Build and environment settings

### 6.1 Runtime environment (container)

| Variable                                         | Default     | Meaning                                                                                                                                                                               |
| ------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS`      | empty       | Comma-separated `https` origins whose widgets may be embedded. Without a policy: the allow-list; empty disables embedding and hides the insertion action. With a policy: upper bound. |
| `REACT_APP_EMBEDDED_WIDGET_MODAL_ORIGINS`        | empty       | Subset of the allowed origins whose widgets may open client modals (`forward`) unless their policy rule sets `modals` (§5e).                                                          |
| `REACT_APP_EMBEDDED_WIDGET_POLICY`               | empty       | Operator policy (§5c), JSON or `base64:<JSON>`. Invalid disables embedding.                                                                                                           |
| `REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION`        | `false`     | `true`: add the policy's capabilities to NeoBoard's initial capability request (§5c).                                                                                                 |
| `REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES` | empty       | Exact capabilities in addition to the Poll allow-list. Without a policy: granted to every allowed widget. With a policy: upper bound for the rules (§5c). Hard deny-list always wins. |
| `REACT_APP_EMBEDDED_WIDGET_MAX_LIVE`             | `3`         | Embedded widgets running at the same time per client (1–20).                                                                                                                          |
| `REACT_APP_RTC`                                  | `matrixrtc` | Existing. `webrtc` selects the legacy transport (and its capability list). Must match the lifecycle rule (§10).                                                                       |
| `CSP_FRAME_SRC`                                  | empty       | Variable of the widget-server image (`frame-src 'self' $CSP_FRAME_SRC`). Must list exactly the embeddable origins (space-separated), otherwise the browser blocks embedded widgets.   |

**Runtime vs. build time (verified, see `upstream-proposals.md` A4):** the
toolkit's `getEnvironment()` only sees runtime values (the widget-server
container sets `window.__ENVIRONMENT__`); in a `vite build`, `process.env`
is `{}`. The `REACT_APP_EMBEDDED_WIDGET_*` settings therefore fall back to
`import.meta.env`, so build-time values work for them; runtime values win.
Upstream settings read only with `getEnvironment()`, such as `REACT_APP_RTC`,
still ignore build-time values (`REACT_APP_RTC=webrtc yarn build` has no
effect); set them on the container.

### 6.2 Widget registration in the room

- Register NeoBoard with `waitForIframeLoad: true`. Toolkit widgets never send
  `content_loaded`; with `false` the client waits for it and the handshake
  never starts.
- The embedded widget's URL is not a room widget. It is stored in the board
  shell and must match the origin allow-list.

### 6.3 Spike build (not for production)

- `spike/scripts/build.sh` builds NeoBoard with `REACT_APP_RTC=webrtc` and
  `REACT_APP_NBC_SPIKE_INNER_ORIGINS`, plus the spike's test widget.
- The spike gate is `REACT_APP_NBC_SPIKE_INNER_ORIGINS` (`vite.config.ts`
  exposes only `REACT_APP_*` to `import.meta.env`). Unset, the spike branch
  and its code are dropped from the bundle; hardened builds must leave it
  unset. As §6.1 explains, `REACT_APP_RTC=webrtc` in that script has no
  effect.

### 6.4 Bundle

- The mediation package has no side effects at import time. It is a
  separate lazy chunk (about 29 KB), loaded when a board shows an embedded
  widget element (verified in the build). Only the small policy module
  (`@nordeck/matrix-widget-mediation/policy`, with the capability rules it
  needs) is in the main bundle, because the configuration is evaluated at
  start-up.
- `matrix-widget-api` is bundled once (1.19.0; the widget and the React SDK
  pin the same version, `.changeset/single-widget-api-copy.md`). The
  mediation package declares it as a peer dependency (`^1.18.0`) and uses
  the same copy as the toolkit's `WidgetApi`.

## 7. Running the tests

```sh
yarn install --frozen-lockfile

# everything (as CI does)
yarn vitest run

# only the new parts
yarn vitest run --project @nordeck/matrix-widget-mediation
yarn vitest run --project @nordeck/matrix-neoboard-react-sdk src/embeddedWidget

# static checks
yarn tsc && yarn lint && yarn depcheck && yarn prettier:check
```

- **Node 25:** run with `NODE_OPTIONS=--no-experimental-webstorage`. Node 25
  enables its own experimental Web Storage globals by default; they collide
  with jsdom's `localStorage` (Node warns "`--localstorage-file` was provided
  without a valid path"). CI uses the Node version from `package.json`
  (`>=20`) or Node 24, where the flag is not needed. Without the flag on
  Node 25, 34 tests that use `localStorage` fail (for example
  `src/lib/settings.test.ts` and `StyledJoyride.test.tsx`).
- Results on this branch with Node 25.6 and the flag: full suite 211 files,
  2882 tests passed (2 skipped); mediation package 172 tests (59 of them for
  the policy module); embedded widget module 94 tests; NeoBoard widget 39
  tests (configuration and renderer wiring).
- Real-browser check of the mediation package (mock client → host → embedded
  widget on three origins, Chromium), opt-in because `playwright-core` is not
  a dependency:

  ```sh
  PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
    yarn workspace @nordeck/matrix-widget-mediation test:e2e
  ```

- The spike's measurement run against a real Element Web is described in
  `spike/README.md`; it needs test accounts and is not part of CI.

## 8. Open points and risks

Sorted by risk.

1. **Trust model (high).** An embedded widget acts with NeoBoard's identity
   towards the client. Embedded widgets must be operator-trusted (hosted on
   operator-controlled origins, reviewed, version-pinned) and allow-listed by
   deployment configuration. The mediator's capability policy is defense in
   depth and makes consent understandable; it is not a sandbox for untrusted
   third-party code. Do not allow user- or room-supplied widget origins.
2. **Document compatibility (high for upstream).** See §4.
3. **Consent identity (medium).** Element's dialog names no widget and grants
   land on NeoBoard's widget id. NeoBoard must show its own consent step that
   names the embedded widget and its origin, including capabilities NeoBoard
   already holds (for example the member list). Done: the board's consent
   panel (§5a), or, for widgets the operator pre-approved, a non-blocking
   notice (§5c).
4. **"Remember my selection" (medium, UX).** Element stores only the latest
   renegotiation request, so after a reload users are asked for NeoBoard's own
   capabilities again (`upstream-proposals.md` B1). Hardened deployments avoid
   the dialogs, and with them this problem, by pre-approving the full union
   with the widget lifecycle module (§10).
5. **Modals (low).** Matrix Poll needs `open_modal` to create and edit
   polls. With the policy field `modals: "inline"` NeoBoard shows them in a
   board dialog (§5e); `forward` (top-level client modal, needs lifecycle
   rules for modal URLs) remains as fallback. The mediation default stays
   `'deny'`.
6. **Rate limits (medium).** Embedded widgets share the user's homeserver
   budget with NeoBoard's snapshot writer. The aggregate default (1 event per
   2 s) is above Synapse's default `rc_message` (0.2/s). Tune per deployment;
   not yet measured with several widgets.
7. **Rendering on the canvas (medium).** Iframes in SVG `foreignObject` are
   re-rasterised on every viewBox change and have known Safari issues. The
   element hides live widgets during gestures. An HTML overlay layer is the
   alternative (`INTEGRATION.md` §6). FPS and memory with 1/5/10 widgets are
   not measured.
8. **Encrypted rooms (unknown).** Not tested. Timeline events (votes, poll
   start) are encrypted by the client; state events (polls, groups) never are.
9. **Widgets with internal state (conceptual).** Widgets that keep shared
   state inside the iframe instead of room events do not fit the two-world
   model; their state would be private per viewer.
10. **Union of capabilities only grows (low).** `matrix-widget-api` cannot
    withdraw requested capabilities; after removing an embedded widget its
    capabilities stay requested for the session.
11. **Element type editing (low).** No UI yet to edit URL/title or to declare
    capabilities of an existing element. Rotation is not supported.
12. **Stale live entries (low).** Live ids of deleted elements stay in the LRU
    list until evicted.
13. **Toolkit "repair registration" (low).** Toolkit widgets that miss URL
    parameters offer to rewrite their room widget registration. The mediator
    always fills all toolkit parameters and hard-denies widget registration
    capabilities, so this path is unreachable; keep it that way.

## 9. Gate 2: UI states and wiring (done)

Former `TODO(E)`; details in §5a.

- Renderer `matrix-neoboard-widget/src/embeddedWidgets/mediationRenderer.ts`
  connects `EmbeddedWidgetRenderer` to `mountEmbeddedWidget`: status
  mapping, `setPaused` while hidden or gesturing, teardown on unmount and
  remote deletion; mediation code in a lazy chunk; wired in
  `AppContainer.tsx` (core change #11).
- Consent UI in the board (`confirmCapabilities`) naming widget and origin,
  and an explanation while the client's own dialog is open
  (`onCapabilityRequest`).
- UI states placeholder, loading, permissions, ready, interacting,
  error/denied with retry; icon + text + live region, not colour alone.
- Modals: forwarded only for `REACT_APP_EMBEDDED_WIDGET_MODAL_ORIGINS`;
  host-rendered modals followed later (§5e).
- Result: real Matrix Poll on the board in Element Web for two users, votes
  via Matrix events, shell via CRDT, also in an encrypted room.
- Open: measurements (FPS during pan/zoom, memory with several widgets);
  Escape inside the widget does not leave the interaction state; use the
  "Leave widget" button (§5b).

## 10. Hardening and widget lifecycle module (from the hardening work)

Full guide (German, added by the separate hardening commit): [`neoboardception-docs/hardening.md`](neoboardception-docs/hardening.md),
example configurations and a generator in
[`neoboardception-docs/examples/`](neoboardception-docs/examples/).
Summary of the points that matter for maintainers:

- **Pre-approval also covers MSC2974 renegotiation.** Element's
  `ElementWidgetDriver.validateCapabilities` asks the module's capability
  approver first on every call, including renegotiation. If NeoBoard's rule
  lists the full union, no dialog appears, and because Element only writes
  "remembered" capabilities after a dialog, the remember problem
  (`upstream-proposals.md` B1) does not occur. One unlisted capability brings
  the dialog, and the problem, back; use complete lists.
- **Rule content:** NeoBoard's own capabilities (28 in `matrixrtc` mode, 21 in
  `webrtc` mode, including the implicit `io.element.requires_client`) plus the
  Poll capabilities, 39 strings in `matrixrtc` mode. Both
  `…receive.state_event:m.room.power_levels#` (NeoBoard) and the key-less form
  (Poll) are needed, because Element approves exact strings only. Exact
  strings, no globs (single exception: the per-user session key in `webrtc`
  mode).
- **Current module (Element Web module API v2):** config key
  `io.element.element-web-modules.widget-lifecycle`; it matches the raw
  `templateUrl` including query and hash, so the NeoBoard rule must be
  `https://<neoboard-origin>/*`. The old key
  `net.nordeck.element_web.module.widget_lifecycle` applies only to the legacy
  Nordeck module.
- **Loading:** at runtime via `config.json` → `modules`, or bundled into the
  Element Docker image (`/modules`). Build-time loading through
  `build_config.yaml` was removed from Element Web in September 2026; use it
  only with older releases.
- **"Most specific rule wins"** means alphabetically last (`localeCompare`),
  not longest; `capabilities_approved` is replaced, not merged. Every rule
  must be complete on its own.
- **The module never denies.** Unlisted capabilities show Element's normal
  dialog. Hard denial exists only in NeoBoard's mediation layer (allow-list
  and hard deny-list).
- **Poll modals** (only with `modals: 'forward'`): exact rules for
  `/create-poll#*` and `/admin/create-group#*` on the Poll origin, no
  origin-wide rule.
- **NeoBoard host:** `CSP_FRAME_SRC` (widget-server image) must contain exactly
  the embeddable origins; without it the browser blocks every embedded
  widget. `REACT_APP_RTC` must match the generated rule.
- **Rooms:** only admins may edit widget registrations; the NeoBoard origin
  must serve nothing but NeoBoard.
- **Second layer (done, §5c):** an operator policy in the same schema as the
  module (`REACT_APP_EMBEDDED_WIDGET_POLICY`) that maps to the mediation
  options per embedded widget, plus the optional initial union.

Remaining TODO(F): verification in a real Element (checklist in
`hardening.md` §11), including a "no dialog" acceptance test.
