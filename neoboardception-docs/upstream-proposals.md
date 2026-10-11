# Upstream proposals (drafts)

Draft issues that came out of NeoBoardception. Each one can be filed on its
own. Statements are marked **verified** (read in source or reproduced) or
**assumption** (not verified). Line numbers refer to the versions named in
each section. Before filing, search the target tracker for duplicates (not
done for these drafts).

Contents:

- A. NeoBoard (`nordeck/matrix-neoboard`)
  - A1. Tolerant handling of unknown element kinds
  - A2. Extension point for element types
  - A3. Upstreaming `widget-mediation`
  - A4. Build-time `REACT_APP_*` values are ignored by `getEnvironment()`
    (also for `nordeck/matrix-widget-toolkit`)
  - A5. `matrix-widget-api` is bundled three times
- B. Element Web (`element-hq/element-web`)
  - B1. "Remember my selection" keeps only the latest renegotiation request
  - B2. The capability dialog does not name the widget
- C. Specification note: nested widgets and MSC2974 across two levels

---

## A1. NeoBoard: tolerate unknown element kinds

**Title:** Documents with an unknown element type are rejected as a whole

**Problem (verified, NeoBoard `main` as of 2026-10).** The element schema is
a closed union:
`packages/react-sdk/src/state/crdt/documents/elements.ts`, `elementSchema =
Joi.alternatives().conditional('.type', [...])` with one branch per known
type and no `otherwise`. The slide schema in
`state/crdt/documents/whiteboardDocument.ts` (`getSlideSchema`) validates
every element against it. So one element of an unknown type makes the whole
document invalid:

- `isValidWhiteboardDocumentSnapshot` returns `false`, and
  `SynchronizedDocumentImpl` drops the snapshot (`filter(... snapshotValidator)`).
- Live updates go through `YDocument.applyChange(change, isValid)`, which
  applies the change to a clone and silently discards it if the result is
  invalid.

Consequences for a client that is one release behind:

- It ignores every snapshot that contains the new element, so it may show an
  older state of the board or none at all.
- It discards the live update that adds the element. **Assumption (not
  tested):** because Yjs needs each client's updates in order, later updates
  from the same editing session may then wait as pending updates, so the old
  client stops seeing that user's edits until a reload.
- There is no message to the user. The existing "document version" notice
  (`WhiteboardUpdate`) is not shown, because the version did not change.

**Proposal.**

1. Add an `otherwise` branch with a permissive _unknown element_ schema: the
   common base (`type: string`, `position`, `width`, `height`, optional
   `attachedFrame`) and `.unknown(true)` for the rest.
2. Render unknown elements as a neutral, locked placeholder ("This element
   needs a newer NeoBoard version"), keep them in the document, and exclude
   them from editing operations that need type knowledge (style changes,
   text editing). Move, delete and frame attachment can use the base fields.
3. Keep them out of PDF export, or draw their bounding box (the PDF code
   already has a `default` branch that logs "Unknown element type").
4. Decide how `.nwb` import and copy/paste should treat them (keep as is, or
   drop with a notice).

This must ship in a release **before** any new element type is used, because
only clients with the tolerant schema benefit.

**Alternatives.**

- **Document version bump.** A new `WhiteboardDocumentVersion` (for example
  `v2`) that allows the new element. Old clients then show the existing
  "unsupported document" notice instead of silently ignoring data. Cost: a
  migration path like `v0 → v1`, every board that uses the element must be
  migrated (the version is the root map of the Y document), and each new
  element type would need another bump. Possible refinement: bump only when
  the first element of the new type is inserted.
- **Feature flag.** Keep the new type behind a deployment flag (as
  NeoBoardception does with its origin allow-list) and enable it only after
  all clients of the deployment run a version that knows it. This works for
  managed deployments, not for boards shared across deployments.
- **Do nothing and document.** Acceptable only if all clients are updated
  together.

Recommendation: A1 upstream first, then new element types without a version
bump. Use a version bump only for changes that alter existing structures.

## A2. NeoBoard: extension point for element types

**Title:** Allow element types to be added without patching the core union

**Problem (verified).** Adding the `embedded-widget` element touched nine
core files of the React SDK: the `Element` union and schema dispatch, the
export schema, frame helpers (`copyElementWithAttachedFrame`,
`findFrameToAttach`, `changeElementFrame`, `deleteRelations`), the render
switch in `ConnectedElement`, PDF export, slide previews and the tools bar.
Each of these is a closed `if`/`switch` on `element.type`. See the list in
[`HANDOFF.md`](../HANDOFF.md).

**Proposal.** A small element registry, for example:

```ts
registerElementKind({
  type: 'embedded-widget',
  schemaKeys, // Joi keys appended to elementBaseSchema
  Display, // React component for the canvas
  toPdf, // optional, else bounding box
  frameAttachable: true, // participates in frame helpers via base fields
  toolsBarAction, // optional
});
```

- Schema dispatch, export schema, render switch and PDF export look up the
  registry. Unknown types fall back to A1.
- Frame helpers use only base fields (`position`, `width`, `height`,
  `attachedFrame`), so most of them could accept `ElementBase` instead of a
  union of concrete types.
- A per-element "preview" flag (slide thumbnails, export) lets elements with
  live content render a static version. NeoBoardception added a context for
  this (`EmbeddedWidgetPreview`); a generic `preview` prop would be cleaner.

This would reduce the NeoBoardception core patch to registration and
configuration.

## A3. NeoBoard: upstream `packages/widget-mediation`

**Title:** Host-side Widget API for widgets embedded in a widget

**What it is.** `packages/widget-mediation` (`@nordeck/matrix-widget-mediation`,
private, version 0.1.0) lets a widget host another widget and act as its
client. It forwards upward through the host's own `WidgetApi` and knows
nothing about NeoBoard. It has no NeoBoard dependency and 108 unit and
integration tests (jsdom, fake client and fake embedded widget over
`postMessage`), plus an opt-in three-origin browser check.

**Where it could live.**

| Option                                                     | Pros                                                                | Cons                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| Package in the NeoBoard monorepo (as now)                  | No new repository, released with NeoBoard                           | Other widgets cannot reuse it easily           |
| New package in `nordeck/matrix-widget-toolkit` (preferred) | Generic, next to `@matrix-widget-toolkit/api`, same release process | Toolkit has to maintain it                     |
| Helper in `matrix-org/matrix-widget-api`                   | Closest to `ClientWidgetApi`                                        | Larger review, policy defaults are opinionated |

**Open review points before publishing:**

- Default capability allow-list is Matrix Poll's list. A generic package
  should have no default allow-list and require one.
- `matrix-widget-api` as peer dependency (`^1.18.0`); see A5.
- Modals: default `'deny'`; decide whether to add host-rendered modals
  (see `architecture.md` §4).
- Rate-limit defaults (aggregate 1 event per 2 s) are above Synapse's default
  `rc_message`; see `architecture.md` §6.

## A4. Build-time `REACT_APP_*` values are ignored by `getEnvironment()`

**Title:** `getEnvironment()` never sees build-time variables in Vite builds

**Repositories:** `nordeck/matrix-widget-toolkit` (root cause) and
`nordeck/matrix-neoboard` (docs and build scripts).

**Verified with:** `@matrix-widget-toolkit/mui` 2.2.2, Vite 7.3.6,
NeoBoard `matrix-neoboard-widget` production build (`vite build`).

**Finding.**

1. `getEnvironment(name)` in `@matrix-widget-toolkit/mui` returns
   `window.__ENVIRONMENT__[name] || process.env[name]`.
2. In a non-library `vite build`, Vite's define plugin replaces `process.env`
   with `{}` in every module, including dependencies
   (`vite/dist/node/chunks/config.js`, `definePlugin`). In the NeoBoard bundle
   the fallback compiles to a lookup in a constant empty object literal.
3. `matrix-neoboard-widget/index.html` copies `import.meta.env` to
   `window.process.env` "for backward compatibility with CRA". The values are
   in the bundle (for example `REACT_APP_RTC:"webrtc"`), but `getEnvironment`
   no longer reads `process.env` at runtime, so nothing uses them.
4. Result: values passed at build time, such as
   `REACT_APP_RTC=webrtc yarn build`, have no effect on anything read through
   `getEnvironment()`. In NeoBoard this includes `REACT_APP_RTC`
   (`isMatrixRtcMode`), `REACT_APP_INFINITE_CANVAS`, `REACT_APP_HOME_SERVER_URL`,
   `REACT_APP_HELP_CENTER_URL`, `REACT_APP_EMBEDDED` and the toolkit's theme
   variables. A build made with `REACT_APP_RTC=webrtc` still runs in MatrixRTC
   mode and still requests the MatrixRTC capabilities.
5. Runtime injection through `window.__ENVIRONMENT__` (the widget-server
   container) works as documented in `docs/configuration.md`
   ("configure the environment variables at the container").

Not checked: the Vite dev server (`yarn dev`) with a `.env` file.

**Proposal.**

- Toolkit: let the app pass its build-time environment explicitly, for
  example `setBuildEnvironment(import.meta.env)` called once from the app
  entry, and read that before falling back. A library cannot read
  `import.meta.env` of the app by itself.
- NeoBoard: until then, say in `docs/configuration.md` that `REACT_APP_*`
  values are runtime-only (container environment) and that build-time values
  are ignored; remove the misleading `.env` hint or fix the dev path.
- Catalogs or deployment notes that claim a build-time `REACT_APP_RTC=webrtc`
  produces a WebRTC build should be corrected.

Related, in the NeoBoardception fork: `VITE_*` variables are not exposed at
all, because `vite.config.ts` sets `envPrefix: 'REACT_APP_'`. See
`HANDOFF.md` §6.

## A5. `matrix-widget-api` is bundled three times

**Title:** Deduplicate `matrix-widget-api` in the widget bundle

**Verified (pre-existing on NeoBoard `main`).** The widget bundle contains
three copies:

| Copy                                      | Version | Pulled in by                                       |
| ----------------------------------------- | ------- | -------------------------------------------------- |
| `node_modules/matrix-widget-api`          | 1.19.0  | `@matrix-widget-toolkit/api` (`^`)                 |
| `matrix-neoboard-widget/node_modules/...` | 1.18.0  | exact pin in `matrix-neoboard-widget/package.json` |
| `packages/react-sdk/node_modules/...`     | 1.18.0  | exact pin in `packages/react-sdk/package.json`     |

The two 1.18.0 copies are not merged because they sit in different
`node_modules` directories, and `matrix-widget-api` is not in
`resolve.dedupe` in `matrix-neoboard-widget/vite.config.ts`. The library
ships CommonJS only, so it is not tree-shaken.

**Measured** in a spike build: adding `'matrix-widget-api'` to
`resolve.dedupe` reduces the main chunk by about 212 KB raw / 42 KB gzip
(about 7 % raw; brotli hides most of it on the wire, parse cost remains).

**Proposal.**

- Align the pins with the toolkit (`^1.19.0`, or a `resolutions` entry) and
  add `matrix-widget-api` to `resolve.dedupe`.
- Besides size, one instance avoids type and enum identity mismatches
  between code paths (for example toolkit `WidgetApi` 1.19 and react-sdk
  imports 1.18). This matters for anything that hosts widgets inside
  NeoBoard, which uses `ClientWidgetApi` next to the toolkit's `WidgetApi`.

---

## B1. Element Web: "Remember my selection" keeps only the latest renegotiation request

**Title:** Remembered widget capabilities are overwritten by a capability
renegotiation (MSC2974)

**Verified against:** `element-hq/element-web` `develop` at commit
`171955a` (2026-10-09) and `matrix-org/matrix-widget-api` `main` / 1.19.0.
Also reproduced in Element Web 1.12.x with a widget that renegotiates.

**Code.**

- `matrix-widget-api`, `src/ClientWidgetApi.ts`,
  `handleCapabilitiesRenegotiate` (lines 403–417 in 1.19.0): the driver gets
  only the newly requested capabilities:

  ```ts
  const newlyRequested = new Set(requested.filter((r) => !this.hasCapability(r)));
  ...
  this.driver.validateCapabilities(newlyRequested)
      .then((allowed) => this.allowCapabilities([...allowed], [...newlyRequested]));
  ```

- `element-web`, `apps/web/src/stores/widgets/ElementWidgetDriver.ts`,
  `validateCapabilities` (line 247). Lines 287–292:

  ```ts
  // TODO: this results in an unexpected behavior when this function is called during the capabilities renegotiation of MSC2974 that will be resolved later.
  const allAllowed = new Set(iterableIntersection(allowedSoFar, requested));
  if (rememberApproved) {
    setRememberedCapabilitiesForWidget(this.forWidget, Array.from(allAllowed));
  }
  ```

  `setRememberedCapabilitiesForWidget` (lines 71–73) replaces
  `localStorage["widget_<id>_approved_caps"]`.

**Steps to reproduce.**

1. Add a widget that requests capabilities A at start.
2. Approve with "Remember my selection" (checked by default).
3. Let the widget request an extra capability B through MSC2974
   (`org.matrix.msc2974.request_capabilities`). Approve with "Remember".
4. Reload.

**Expected:** no dialog; A and B are remembered.
**Actual:** Element asks for A again. The stored list contains only B
(observed: 28 remembered capabilities became 2).

Within the running session everything works, because `ClientWidgetApi`
adds the new grants to the ones it already holds. Only the stored selection
is wrong.

**Proposal.** When remembering, merge instead of replace:

```ts
if (rememberApproved) {
  const remembered = new Set(
    getRememberedCapabilitiesForWidget(this.forWidget),
  );
  allAllowed.forEach((c) => remembered.add(c));
  setRememberedCapabilitiesForWidget(this.forWidget, [...remembered]);
}
```

Optionally store decisions per capability, so a later denial can remove a
single entry. The existing TODO comment points at the same problem.

Workaround available today: deployments that pre-approve the full capability
list with the widget lifecycle module see no dialog, and Element writes the
remembered list only after a dialog, so nothing is overwritten (see
`hardening.md`). The bug still affects every deployment without
pre-approval.

**Small related issue in `matrix-widget-api` (verified, 1.19.0):** in
`handleCapabilitiesRenegotiate`, when nothing is newly requested,
`allowCapabilities([], [])` is called but the function does not return, so
`validateCapabilities` still runs with an empty set and the widget receives
`notify_capabilities` twice.

## B2. Element Web: the capability dialog does not name the widget

**Title:** Widget capability dialog should say which widget is asking

**Verified against:** `element-web` `develop` `171955a`.
`apps/web/src/components/views/dialogs/WidgetCapabilitiesPromptDialog.tsx`:
the props are `requestedCapabilities` and `widgetKind` only (lines 21–25);
the dialog text is the generic `widget|capabilities_dialog|content_starting_text`
("This widget would like to:"). `ElementWidgetDriver.validateCapabilities`
opens it without widget name or URL (lines 275–278).

**Problem.** In a room with several widgets, especially when a request
arrives later through MSC2974, the user cannot tell which widget asks. The
OpenID dialog, in contrast, shows the widget URL.

**Proposal.** Pass the widget (name, and origin of its URL) to the dialog and
show it in the title or first line, for example
"_Whiteboard_ (`board.example.org`) would like to:". For renegotiation,
say that this is an additional request.

Note: for nested widgets this would still name the host (NeoBoard), not the
embedded widget. NeoBoardception therefore shows its own consent step that
names the embedded widget. See C for a possible spec extension.

---

## C. Specification note: nested widgets and MSC2974 across two levels

**Audience:** matrix-spec-proposals discussion of MSC2974 (or a short new
MSC). This is a note, not a request for a required change.

**Setup.** A widget (the host, here a whiteboard) runs a second widget in an
iframe and acts as its client. The Matrix client only sees the host.

```
client  <-- Widget API, host widget id -->  host widget  <-- Widget API, derived id -->  embedded widget
```

**Result.** This works with today's specifications and no client change.
Checked in Element Web against a test widget:

- **MSC2762** (send and receive events): the host forwards the embedded
  widget's `send_event` and pushes received events, including the echo of
  the widget's own events, down to it.
- **MSC2871** (approved capabilities): `notify_capabilities` is the answer on
  both levels; toolkit widgets wait for it before reporting `ready`.
- **MSC2974** (capability renegotiation): the host requests the union of its
  own and the embedded widget's capabilities. The client shows a dialog for
  the new capabilities only. A request at runtime from the embedded widget
  becomes a second renegotiation of the host and shows a second dialog. The
  host's own capabilities stay granted for the session.
- MSC2876 (`read_events`) and MSC3869 (`read_relations`) are forwarded the
  same way.
- **MSC4039** (media upload and download): not forwarded in this project; a
  host could forward it the same way, but it would hand the embedded widget
  the user's media access, so it is denied by default.

**Gaps that make hosts more complex (optional improvements).**

1. **No correlation between request and answer.** `notify_capabilities` does
   not reference the `request_capabilities` it answers, so a host must
   serialise renegotiations. A request id echoed in `notify_capabilities`
   would allow parallel requests.
2. **The requested list can only grow.** A widget cannot withdraw a
   capability it once requested. A host that removes an embedded widget
   keeps its capabilities in every later renegotiation for the session. A
   way to send a smaller list (and have it honoured) would help.
3. **Attribution.** Consent is attached to the host's widget id, and the
   client cannot tell the user who actually asks. An optional field in
   `request_capabilities`, such as
   `"on_behalf_of": { "name": "...", "origin": "https://..." }`, would let
   clients show it in the dialog (display only, it grants nothing). The host
   remains responsible for its own consent step.
4. **Remembered selections** (B1) are a client issue, not a spec issue, but
   MSC2974 could say that a renegotiation adds to, and does not replace,
   remembered approvals.

None of these blocked the implementation. They would reduce dialogs and
make consent clearer.

**Security note.** Hosting a widget means acting with the host's identity.
Embedded widgets must be operator-trusted and allow-listed by the
deployment; a host's capability policy is defense in depth, not a sandbox
for untrusted code. Any spec text on nested widgets should say this.
