# @nordeck/matrix-widget-mediation

Host side of the [Matrix Widget API](https://github.com/matrix-org/matrix-widget-api)
for widgets that are **embedded inside another widget**.

A host widget (for example a whiteboard) runs inside a Matrix client and talks
to it through its own `WidgetApi`. This package lets the host frame a second
widget (for example a poll) and act as that widget's client: it answers the
embedded widget's Widget API requests and forwards them upward through the
host's own API. The Matrix client only ever sees the host widget.

```
Matrix client ──(host's WidgetApi, host widget id)── host widget
host widget   ──(this package: ClientWidgetApi)───── embedded widget
```

The package knows nothing about the host's data model. It needs a container
element, a URL, the host's outer API and a policy.

## Usage

```ts
import {
  configureMediation,
  mountEmbeddedWidget,
  POLL_CAPABILITIES,
} from '@nordeck/matrix-widget-mediation';

// Optional, once per host widget and before the first mount.
configureMediation(widgetApi.matrixWidgetApi, { capabilityBatchMs: 50 });

const handle = mountEmbeddedWidget({
  container, // HTMLElement the iframe is appended to
  widgetUrl: 'https://poll.example/',
  widgetId: boardElementId, // stable id; the widget gets a derived id
  outerApi: widgetApi.matrixWidgetApi, // or a Promise of it
  allowedOrigins: deploymentConfig.embeddableOrigins, // required
  allowedCapabilities: POLL_CAPABILITIES, // default
  deniedCapabilities: ['org.matrix.msc2762.send.event:net.example.board*'],
  params: widgetApi.widgetParameters, // fills $matrix_* template variables
  name: 'Poll',
  onStateChange: (state) => render(state),
  onCapabilityRequest: (request) => showWhoIsAsking(request),
  confirmCapabilities: (request) => askUserLocally(request),
});

// later
handle.destroy();
```

The entry point has no side effects. Hosts should load it lazily
(`import()`) when a document first contains an embedded widget.

## API

### `mountEmbeddedWidget(options): EmbeddedWidgetHandle`

| Option                                           | Default                | Meaning                                                                                                                                                                                                  |
| ------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `container`                                      | –                      | Element the iframe is appended to.                                                                                                                                                                       |
| `widgetUrl`                                      | –                      | URL or URL template of the embedded widget. `https:` only.                                                                                                                                               |
| `widgetId`                                       | –                      | Stable id of the embedding. The widget gets `embedded-<id>`, never the host's widget id.                                                                                                                 |
| `outerApi`                                       | –                      | The host's widget-side API (`WidgetApi` of matrix-widget-api, or anything matching `OuterWidgetApi`), or a promise of it. With a promise, the iframe starts loading while the host's own handshake runs. |
| `allowedOrigins`                                 | –                      | **Required.** Origins embedded widgets may come from. Must come from deployment configuration, never from room or document content.                                                                      |
| `params`                                         | –                      | Host widget parameters (`userId`, `roomId`, `displayName`, `avatarUrl`, `theme`, `clientId`, `clientLanguage`, `baseUrl`, `deviceId`). Same shape as the toolkit's `widgetParameters`.                   |
| `allowedCapabilities`                            | `POLL_CAPABILITIES`    | Allow-list, exact strings. A key-less event capability also allows the same capability narrowed to a state key or msgtype, never the other way round.                                                    |
| `allowCapabilityGlobs`                           | `false`                | Treat a trailing `.*` or `#*` in the allow-list as a prefix glob. Never applies to `send` capabilities.                                                                                                  |
| `deniedCapabilities`                             | `[]`                   | Extra denials, exact or `prefix*`, e.g. the host's own namespace.                                                                                                                                        |
| `confirmCapabilities`                            | –                      | Local consent: called with what the widget asks for (including capabilities the host already holds) before anything is granted. Resolve with the agreed subset, `true` or `false`.                       |
| `maxCapabilityRequests`                          | `3`                    | Capability rounds that need the client's dialog, per mounted widget.                                                                                                                                     |
| `urlParameters`                                  | all toolkit parameters | Which user/room parameters the widget receives. Others are left empty.                                                                                                                                   |
| `updateState`                                    | `'never'`              | `'never'`: deliver state as `send_event`, do not advertise `update_state` (required for matrix-widget-toolkit widgets). `'auto'`: use `update_state` for widgets that support it.                        |
| `modals`                                         | `'deny'`               | `'inline'`: the host shows the modal itself (`onModalRequest`); `'forward'`: passes `open_modal` to the client. See [Modals](#modals).                                                                   |
| `onModalRequest`                                 | –                      | `'inline'` modals: called with an `EmbeddedModalRequest` the host shows in a dialog. Without it, `'inline'` refuses modals.                                                                              |
| `openId`                                         | `'deny'`               | `'forward'` passes OpenID requests to the host's `requestOpenIDConnectToken()`; the token identifies the user to the widget's backend. Answers "pending" first, then the result.                         |
| `sandboxSameOrigin`                              | `true`                 | Keep `allow-same-origin` in the sandbox.                                                                                                                                                                 |
| `sandboxExtras`, `allow`, `title`                | –                      | Extra sandbox tokens (`allow-top-navigation*` is always dropped), permissions policy, iframe title.                                                                                                      |
| `loadTimeoutMs`                                  | `30000`                | Time for the iframe `load` event.                                                                                                                                                                        |
| `echoFallbackMs`                                 | `5000`                 | Local echo of the widget's own event if the client does not echo it (`0` disables).                                                                                                                      |
| `rateLimit`, `maxQueuedSends`                    | 5 burst, 1 per 3 s; 20 | Send budget of this widget.                                                                                                                                                                              |
| `eventNamespace`, `toDeviceRateLimit`            | –                      | Event type namespace of the widget (see below) and its to-device budget.                                                                                                                                 |
| `matrixRtc`, `rtcRateLimit`, `onMatrixRtcEvent`  | `false`                | MatrixRTC call widget (operator opt-in, see below), its budget for delayed/sticky events and the call's host actions.                                                                                    |
| `mediaPermissions`                               | –                      | Permission-policy features for the iframe (`camera`, `microphone`, `display-capture`, `autoplay`, `encrypted-media`, `clipboard-*`); wins over `allow`.                                                  |
| `maxTimelineReadLimit`                           | `1000`                 | Upper bound for `limit` on timeline reads.                                                                                                                                                               |
| `allowInsecureLocalhost`                         | `false`                | Accept `http://localhost` (development).                                                                                                                                                                 |
| `onStateChange`, `onCapabilityRequest`, `logger` | –                      | Callbacks, see below. The logger never receives event content.                                                                                                                                           |

`EmbeddedWidgetHandle`: `widgetId`, `iframe`, `getState()`, `reload()`,
`retryCapabilities()` (reload and ask again for capabilities denied earlier;
only for an explicit user action), `setPaused(paused)` (stop delivering
events while hidden; buffered and delivered on resume, or reload on
overflow; no effect for MatrixRTC widgets), `destroy()`.

### States

```
idle → loading → negotiating → ready
                      └──────→ error(denied | load-failed | timeout)
```

- `loading`: iframe created, waiting for `load`.
- `negotiating`: handshake running. `awaitingCapabilities` is set while the
  client's dialog is open.
- `ready`: `capabilities` summarises `requested`, `granted`,
  `blockedByPolicy`, `deniedLocally` and `deniedUpstream`.
- `error`: `denied` (nothing granted), `load-failed` (URL refused, origin not
  allowed, frame navigated away, load error) or `timeout`. `code` names the
  cause for user-facing messages: `invalid-url`, `origin-not-allowed`,
  `same-origin`, `navigated`, `load-failed`, `timeout` or `denied`.
  `isPermanentEmbeddedWidgetError(code)` is true for the first three: a
  retry cannot help, so hosts should not offer one. `message` is a technical
  English text for logs and details.

### Capability requests

`onCapabilityRequest` fires for every capability round with the widget's
`widgetId`, `name`, `origin`, `url` (without query), `capabilities`, the
subsets `inherited` (already held by the host) and `upstream` (needs the
client's dialog), and a `settled` promise. The client's dialog does not say
which widget asks, so the host's UI should.

### Other exports

- `configureMediation(outerApi, config)`: host-level settings
  (`capabilityTimeoutMs`, `capabilityBatchMs`, `aggregateRateLimit`,
  `logger`). Throws if a widget was already mounted.
- `prerequestCapabilities(options)`: request the capabilities of embedded
  widgets known to be in a document before their iframes boot.
- `disposeMediation(outerApi)`: detach all listeners of a host.
- The policy functions above are also exported from the main entry point.
- `POLL_CAPABILITIES`, `applyCapabilityPolicy`, `capabilityCoveredBy`,
  `isHardDenied`, `isValidGlob`, `buildWidgetUrl`, `validateWidgetUrl`,
  `deriveEmbeddedWidgetId`, `TOOLKIT_PARAMETERS`, `LOCAL_ECHO_MARKER`.

### Operator policy (`@nordeck/matrix-widget-mediation/policy`)

A small pure module (no DOM, no network) for an operator policy per embedded
widget URL, in the schema of Element's widget lifecycle module. Separate
entry point, so a host can evaluate it at start-up without loading the rest
of the package.

```ts
import {
  decideEmbeddedWidget,
  decodeEmbeddedWidgetPolicy,
  policyInitialCapabilities,
  policyOrigins,
} from '@nordeck/matrix-widget-mediation/policy';

const result = decodeEmbeddedWidgetPolicy(deploymentConfig.policyText);
if (!result.ok) disableEmbedding(result.errors); // fail closed
const decision = decideEmbeddedWidget(result.policy, widgetUrl, {
  deniedCapabilities: ['org.matrix.msc2762.send.event:net.example.board*'],
});
// decision.allowed, .consent ('preapproved' | 'ask'), .allowedCapabilities,
// .identityApproved, .name
```

```json
{
  "version": 1,
  "unlisted": "deny",
  "widget_permissions": {
    "https://poll.example.org/": {
      "name": "Poll",
      "preload_approved": true,
      "identity_approved": false,
      "capabilities_approved": ["org.matrix.msc2762.send.event:…"]
    }
  }
}
```

| Rule                    | Semantics                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key                     | URL pattern, `*` only as the last character (prefix). Matched against origin + path of the normalised widget URL, **without query and fragment**.                |
| Pattern form            | Must already be normalised (`https`, lower-case host, `/` after the host, no default port, no dot segments, no `?`/`#`). Otherwise the policy is invalid.        |
| Specificity             | An exact rule beats every glob; among globs the longest prefix wins. The winning rule is used as a whole (no merge of fields across rules).                      |
| `capabilities_approved` | Allow-list for the widget (exact strings; `*` is an error). Hard-denied entries are dropped with a warning; the host's `deniedCapabilities` are removed as well. |
| `preload_approved`      | `consent: 'preapproved'`: the host may skip its local consent step.                                                                                              |
| `identity_approved`     | `identityApproved: true`: the host may pass `openId: 'forward'`. Default off.                                                                                    |
| `name`                  | Display name chosen by the operator (extension).                                                                                                                 |
| `unlisted`              | `'deny'` (default): URLs without a rule are refused. `'consent'`: allowed with the host's default allow-list and local consent (extension).                      |
| `matrixrtc`             | `matrixRtc: true` for this widget (extension, default off, see below).                                                                                           |
| `media_permissions`     | `mediaPermissions` for this widget's iframe (extension; unknown features make the policy invalid).                                                               |
| `version`, `$comment`   | Extensions; other unknown fields are tolerated with a warning, like the module's loose schema.                                                                   |

Any error (not an object, wrong types, bad pattern, glob capability, too many
rules or entries) makes the whole policy invalid. `policyOrigins` lists the
origins of all rules; `policyInitialCapabilities` returns the union of all
rules' capabilities (after denials) for a host that wants to request them
in its first capability request.

### Event type namespaces (`eventNamespace`)

For an embedded widget that uses the same event types as its host (a
whiteboard inside a whiteboard), the mediator can rewrite the widget's types
into a namespace of its own:

```ts
mountEmbeddedWidget({
  // …
  eventNamespace: {
    'net.example.board': 'net.neoboardception.nested.net.example.board',
  },
  // allow-list and denials in the rewritten form
  allowedCapabilities: [
    'org.matrix.msc2762.send.state_event:net.neoboardception.nested.net.example.board',
  ],
  deniedCapabilities: [
    'org.matrix.msc2762.send.state_event:net.example.board*',
  ],
});
```

- A key covers the type and all types below it at a `.` boundary. Targets
  must lie below `NESTED_NAMESPACE_ROOT` (`net.neoboardception.nested.`),
  exactly once; keys must not be spec types (`m.*`). Invalid maps refuse the
  widget.
- Rewritten in both directions: capability strings (room events, state
  events with `#key`, to-device), `send_event`, `read_events` and
  `read_relations` (filters and results), pushed events, to-device messages,
  the local echo. The widget only ever sees its own strings.
- Policy order: rewrite, then allow-list, configured and hard deny-lists on
  the rewritten form. Events of the original types never reach the widget.
- Content is not rewritten, except the `events` map of
  `m.room.power_levels` on the way down. Sending power levels stays denied.
- To-device messages are forwarded only for rewritten types
  (`toDeviceRateLimit`, default 10 burst, 1/s).
- No embedded widget may name the reserved namespace directly, so
  namespaces cannot be stacked (nesting depth 1).
- In the operator policy the field is `event_namespace`; the rule's
  `capabilities_approved` are written in the rewritten form.

### MatrixRTC calls (`matrixRtc`)

A call widget such as Element Call needs much more than a board widget:
call membership state, per-participant keys over to-device messages,
delayed events for its leave, RTC transports, camera and microphone. All of
it is on the hard deny-list. An operator can opt one widget in:

```json
"https://call.example.org/room": {
  "name": "Call",
  "identity_approved": true,
  "matrixrtc": true,
  "media_permissions": ["camera", "microphone", "autoplay", "display-capture", "encrypted-media"]
}
```

- Exactly the strings of `matrixRtcCapabilities({ userId, deviceId, roomId })`
  are exempt from the hard deny-list, and only for this widget: membership
  state under the host's **own** user and device keys, call notifications
  and declines, `io.element.call.encryption_keys`, the call's to-device
  types, delayed events, sticky events and RTC transports. Never TURN,
  downloads, redactions, other users' memberships or other rooms. The client
  still has to approve them in its dialog (renegotiation when the widget
  loads, or `policyInitialCapabilities(…, { matrixRtc })` for an initial
  union). Requires `params.deviceId`.
- Granted by the mediator itself, never requested upstream:
  `m.always_on_screen` and `timeline:<host room>` (matrix-js-sdk's widget
  client names its room on every request).
- Forwarded: `send_event` with `delay` or `sticky_duration_ms`,
  `update_delayed_event` (only for delay ids this widget scheduled),
  `send_to_device` both ways (the call's types only, the same path and budget
  as namespaced types), `get_rtc_transports`. The host's room only.
- When the widget is torn down, the delayed events it scheduled are sent at
  once (a call's delayed event is its leave).
- Host actions of Element Call (`io.element.join`, `im.vector.hangup`,
  `io.element.close`, `io.element.device_mute`, layout,
  `set_always_on_screen`) are acknowledged locally and reported through
  `onMatrixRtcEvent`; nothing reaches the outer client. A host should keep a
  widget that is always on screen mounted (never evict it).
- Event delivery is never paused, so a call keeps its keys and memberships
  while the host hides it.
- The room must let members send `org.matrix.msc3401.call.member` (Element
  sets this when it creates a room).

## Behaviour

### Capabilities

1. **Policy.** A capability passes if it is on the allow-list, not denied by
   configuration and not hard-denied. The hard deny-list cannot be
   overridden: widget registrations and layout (`im.vector.modular.widgets`,
   `io.element.widgets.layout`), sending room-administration state and
   redactions, other rooms (`timeline:`), to-device (except namespaced types), navigation, media, TURN,
   delayed and sticky events, and MatrixRTC. The only exemption is the
   operator's MatrixRTC opt-in for one widget (exact strings, see above).
2. **Disclosure and local consent.** Capabilities the host already holds are
   not handed over silently: they are reported in `onCapabilityRequest` and
   pass through `confirmCapabilities`.
3. **Upstream.** Missing capabilities are requested as an MSC2974
   renegotiation of the host's own capabilities. matrix-widget-api always
   sends the union of everything the host requested, so the host keeps its
   own grants. Requests from several embedded widgets within
   `capabilityBatchMs` are merged into one renegotiation; only one is in
   flight at a time, because the answer (`notify_capabilities`) cannot be
   correlated. Answers update a shared approved set; denials are cached for
   the session.
4. **Result.** The widget gets exactly the strings it requested that the
   client approved. A request for a key-less capability is never satisfied
   by a keyed grant; the key-less form is requested instead.

### Forwarding

| Embedded widget →                                                                                        | Handling                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `supported_api_versions`                                                                                 | Answered locally: MSC2762, MSC2871, MSC2873, MSC2876, MSC2974, MSC3869 (and `update_state` in `'auto'` mode).                                                                  |
| `send_event`                                                                                             | Checked against the widget's grants and the hard deny-list, rate limited, forwarded. A `room_id` is only passed for a foreign room. The client's answer is returned unchanged. |
| `org.matrix.msc2876.read_events`                                                                         | Checked, forwarded without `room_ids` for the own room, results filtered by the widget's grants. Identical concurrent reads share one round trip.                              |
| `org.matrix.msc3869.read_relations`                                                                      | Forwarded, chunk filtered by the widget's grants.                                                                                                                              |
| `org.matrix.msc2974.request_capabilities`                                                                | See above; limited by `maxCapabilityRequests` and a minimum interval.                                                                                                          |
| `open_modal`                                                                                             | Denied by default. `'inline'`/`'forward'`: only for URLs on the widget's own (allowed) origin; one modal at a time. See [Modals](#modals).                                     |
| `content_loaded`                                                                                         | Acknowledged. The handshake starts on iframe `load` anyway.                                                                                                                    |
| `get_openid`                                                                                             | Blocked by default. With `openId: 'forward'`, forwarded to the host's outer API.                                                                                               |
| delayed/sticky events, `update_delayed_event`, `send_to_device`, `get_rtc_transports`, call host actions | MatrixRTC widgets only, see above.                                                                                                                                             |
| others                                                                                                   | Rejected (navigation, media, to-device except namespaced or call types, …).                                                                                                    |

| Client → host → embedded widget   | Handling                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send_event`                      | Delivered to every embedded widget that may receive it (own room only, deduplicated). This includes the echo of the widget's own events, which matrix-widget-toolkit waits for. |
| `update_state`                    | Converted to `send_event` unless the widget uses `update_state`.                                                                                                                |
| `theme_change`, `language_change` | Forwarded (theme name only).                                                                                                                                                    |
| `close_modal`                     | `'forward'`: routed to the embedded widget that opened the modal; the host's own modals are left alone.                                                                         |

The host keeps answering the client's requests itself; the package only
observes them, except `close_modal` for its own modals.

### Modals

matrix-widget-toolkit widgets (e.g. Matrix Poll) open a modal widget to
create or edit content (`open_modal` with a URL on their own origin, a
title, buttons and `data`) and act on its result (`close_modal`). Three
modes per widget (`modals`):

| Mode      | What happens                                                                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deny`    | Default. `open_modal` is answered with an error.                                                                                                                                                                                                                         |
| `inline`  | The host shows the modal itself. The client sees nothing: no top-level modal, no capability dialog, no lifecycle rule for the modal URL.                                                                                                                                 |
| `forward` | Fallback. `open_modal` goes to the client, which opens a top-level modal under the host's identity; it asks for the modal's capabilities itself (or a lifecycle rule for the modal URL approves them). `close_modal` comes back to the host and is routed to the opener. |

`inline` in detail:

1. The widget sends `open_modal`. The URL must be on the widget's own,
   allowed origin; one modal per widget at a time. The request is
   acknowledged and `onModalRequest` receives an `EmbeddedModalRequest`
   (`name`, `origin`, `url` without query and fragment, up to three
   `buttons`, `closed`).
2. The host opens a dialog titled `name` and calls `request.mount(container)`.
   This mounts a **second mediated instance** of the modal URL with the
   widget id `modal_<embedded widget id>` (the toolkit enters modal mode only
   for this prefix). Same origin check, parameters, namespace and denials as
   the widget; its allow-list is the set the widget was **granted**, and it
   never asks the client (`maxCapabilityRequests: 0`): capabilities the
   widget holds are given without a dialog, anything else is refused. No
   modals, OpenID or calls from inside a modal.
3. Once the modal widget is ready it receives `widget_config` (its own open
   request: `type`, `url`, `name`, `buttons`, `data`), like from the client.
4. The host renders the buttons and calls `request.clickButton(id)`
   (`button_clicked` to the modal widget, enabled buttons only). The modal
   widget may enable and disable them (`set_button_enabled`; reported via
   `onButtonsChange`; `m.close` and unknown ids are refused).
5. The modal widget sends `close_modal` with its result: the modal ends, the
   instance is removed and the embedded widget receives `close_modal` with
   that data. `request.cancel()` (Cancel, Escape) ends it with
   `{ "m.exited": true }`. If the embedded widget is removed or reloaded,
   the modal ends silently. `request.closed` resolves in every case.

`request.mount` returns a function that removes the instance without
ending the modal (a dialog that remounts its content calls `mount` again).

### Iframe and messages

- URL: `https:` only, origin must be in `allowedOrigins` and differ from the
  host's origin (a same-site origin only logs a warning). Missing toolkit
  parameters are appended to the fragment so toolkit widgets never fall back
  to their "repair registration" flow. `widgetId` and `parentUrl` are set in
  the query; `parentUrl` is the host origin only.
- Sandbox: `allow-scripts allow-forms allow-popups
allow-popups-to-escape-sandbox allow-downloads` plus `allow-same-origin`
  (most widgets need storage and module scripts; safe because the origin
  differs from the host's). No `allow-top-navigation*`.
  `referrerpolicy="no-referrer"`, empty `allow` unless `mediaPermissions`
  delegates features (the host's frame must have them, too).
- `event.source` and `event.origin` of every inbound message are checked in
  one capture-phase listener per window (constant cost,
  independent of the number of embedded widgets): messages carrying an
  embedded widget's id must come from its frame and origin, an embedded
  widget may not use any other widget id, and other Widget API messages must
  come from the host's parent window.
- A second `load` event means the frame navigated; the widget is stopped
  (`error: load-failed`).

## Design notes

- **Embedded widgets must be operator-trusted:** only allow-listed,
  operator-hosted, version-pinned widgets. Treat an embedded widget as having
  the same trust as the host itself.
- **Hiding the host's widget id is hygiene, not a boundary.** The embedded
  widget gets its own derived id and only the host origin as `parentUrl`, and
  no referrer. This avoids handing out identifiers needlessly, but widget ids
  are visible in room state, so it is not a security control. The controls
  are: origins limited by deployment configuration, a capability allow-list
  with a hard deny-list, and local consent. Forwarded modals run top-level in
  the client under an id derived from the host's, which is one more reason
  modals are off by default; `inline` modals avoid this and stay within the
  widget's grants.
- **Union only grows.** matrix-widget-api has no way to withdraw a requested
  capability, so the host's requested list grows for the session. Request
  capabilities only for widgets that are actually in the document.
- **"Remember my selection" in the client.** `ClientWidgetApi` passes only
  newly requested capabilities to the client's driver, so a client that
  stores the last approval may store only those. Requesting the union does
  not change that. Pre-approval by deployment configuration (for example a
  widget lifecycle module) avoids repeated dialogs.
- **Rate limits.** Embedded widgets send as the same user as the host. Each
  widget has its own budget and all embedded widgets share an aggregate
  budget, so the host's own writes keep their share. Queued writes to the
  same state key are coalesced.
- **Local echo.** If the client does not echo an event within
  `echoFallbackMs`, the sending widget gets a local copy marked with
  `unsigned.local_echo`; a later real echo is not delivered twice.

## Tests

```sh
yarn vitest run --project @nordeck/matrix-widget-mediation
```

Unit and integration tests run in jsdom with a fake outer API (playing the
Matrix client and the user's decisions) and a fake embedded widget that
speaks the Widget API over `postMessage`.

A real-browser check (mock client → host → embedded widget on three origins,
Chromium) is opt-in because `playwright-core` is not a dependency:

```sh
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core yarn workspace @nordeck/matrix-widget-mediation test:e2e
```
