# Configuration

Runtime configuration can be performed via environment variables.

- You can configure the environment variables at the container for production
- You can configure an [`.env` file](https://create-react-app.dev/docs/adding-custom-environment-variables/#adding-development-environment-variables-in-env) for local development.

## Environment Variables

```sh
# Base URL of the or a homeserver, used to display avatars
REACT_APP_HOME_SERVER_URL=https://matrix-client.matrix.org

# optional: External link to the documentation that will be shown in the help menu
REACT_APP_HELP_CENTER_URL="https://github.com/nordeck/matrix-neoboard"

# optional: Enable connection to React standalone devtools
# Only works in development builds
REACT_APP_DEVTOOLS=true
```

### Customization

More environment variables exist for UI customization and are inherited from and documented by our framework [@matrix-widget-toolkit/mui](https://www.npmjs.com/package/@matrix-widget-toolkit/mui#customization).

### Experimental and Legacy Features

We sometimes use feature flags during development of bigger new features when
using a long running feature branch would mean too much work spent on rebasing repeatedly.

We also keep some options to use legacy features until we fully deprecate them.

```sh
# optional: Indicate if the widget is embedded, e.g. in standalone mode, to enable/disable respective features.
REACT_APP_EMBEDDED=false

# optional: Set to `webrtc` to use the legacy peer-to-peer WebRTC implementation
# instead of MatrixRTC (default: `matrixrtc`)
REACT_APP_RTC=matrixrtc

# infinite canvas (default: true)
REACT_APP_INFINITE_CANVAS=true
```

### Embedded widgets

Boards can contain embedded widget elements. Which widgets may run, and with
which permissions, is decided by the deployment, never by board users or room
state. Embedding is disabled (deny by default) unless at least one origin is
allowed.

These variables are read at runtime (`window.__ENVIRONMENT__`, set by the
widget-server container) and, as a fallback, at build time
(`import.meta.env`). Runtime values win.

```sh
# optional: Comma-separated list of https origins whose widgets may be
# embedded into boards. Without a policy (below) this is the allow-list and
# every embedded widget asks for local consent; with a policy it is an upper
# bound for the policy's origins. Empty (default) and no policy disables
# embedding.
REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS=https://widgets.example.org,https://poll.example.org

# optional: Comma-separated subset of the allowed origins whose embedded
# widgets may open modal dialogs in the Matrix client (forwarded under the
# board's widget identity). Empty (default) denies modals. A policy rule's
# `modals` field wins; prefer `"modals": "inline"` there (the board shows the
# modal itself, see below).
REACT_APP_EMBEDDED_WIDGET_MODAL_ORIGINS=https://poll.example.org

# optional: Operator policy for embedded widgets, in the schema of Element's
# widget lifecycle module (see below). JSON, or `base64:` followed by
# base64-encoded JSON (use this for container environments: the
# widget-server image does not escape quotes in values). An invalid policy
# disables embedding.
REACT_APP_EMBEDDED_WIDGET_POLICY=base64:eyJ3aWRnZXRfcGVybWlzc2lvbnMiOnt9fQ==

# optional: `true` adds the capabilities of all policy rules to the board's
# initial capability request (default: `false`). Needs the policy.
REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION=false

# optional: Comma-separated capabilities (exact strings) embedded widgets may
# get in addition to the default allow-list (the Matrix Poll capabilities).
# Without a policy, every allowed widget gets the defaults plus these. With a
# policy, this is an upper bound (see below). The board's own events and the
# mediation's hard deny-list (widget registrations, room administration,
# to-device, MatrixRTC, delayed and sticky events, TURN, media) cannot be
# granted this way; such entries and globs are ignored with a warning.
REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES=org.matrix.msc2762.receive.event:m.room.message#m.text

# optional: Maximum number of embedded widgets that run at the same time per
# client (1-20). Activating one more stops the least recently activated one.
# Independent of the policy. Invalid values are ignored with a warning.
# Default: 3
REACT_APP_EMBEDDED_WIDGET_MAX_LIVE=3
```

#### Embedded widget policy

```json
{
  "version": 1,
  "unlisted": "deny",
  "widget_permissions": {
    "https://poll.example.org/": {
      "name": "Poll",
      "preload_approved": true,
      "identity_approved": false,
      "modals": "inline",
      "capabilities_approved": [
        "org.matrix.msc2762.send.event:net.nordeck.poll.vote",
        "org.matrix.msc2762.receive.event:net.nordeck.poll.vote"
      ]
    }
  }
}
```

- **Keys** are URL patterns, `*` only as the last character. They are matched
  against origin and path of the widget URL in the board, **without query and
  fragment**. Patterns must be written in normalised form
  (`https://host/…`, lower-case host, `/` after the host). An exact pattern
  beats every glob; among globs, the longest prefix wins. The winning rule
  applies as a whole.
- **`capabilities_approved`**: the most the widget can get (exact strings).
  Entries on the mediation package's hard deny-list and the board's own event
  types are removed.
- **`preload_approved`**: the board does not show its consent panel for this
  widget; a notice in the widget's status bar names the widget and says that
  the administrator approved it. The Matrix client may still show its own
  dialog unless the capabilities are pre-approved there too (or requested
  initially, see below). Activating a widget ("Load widget") is still a user
  action.
- **`identity_approved`**: the widget may request an OpenID token of the
  user (forwarded to the Matrix client). Default `false`.
- **`modals`**: what happens when the widget opens a modal dialog (Matrix Poll
  does this to create and edit polls). `inline`: the board shows it in its
  own dialog, limited to what the widget was already granted; the Matrix
  client shows nothing and asks for nothing. `forward`: the Matrix client
  opens it on top under the board's identity (it may ask for permissions
  again; a widget lifecycle rule for the modal URL avoids that). `deny`:
  refused. Not set: `forward` for origins in
  `REACT_APP_EMBEDDED_WIDGET_MODAL_ORIGINS`, otherwise `deny`.
- **`unlisted`**: `deny` (default) refuses widget URLs without a rule.
  `consent` allows them for allowed origins, with the default (Poll)
  allow-list and the board's consent panel.
- The origins of all rules form the origin allow-list (capped by
  `REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS` if that is set). Mirror them in
  the widget-server's `CSP_FRAME_SRC`.
- If `REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES` is set as well, it
  caps the policy the same way: a rule keeps only capabilities that are Poll
  defaults or listed there (dropped ones are logged as warnings, also for the
  initial union). It never adds capabilities to a rule or to unlisted
  widgets. Without the variable, the rule's `capabilities_approved` alone
  decides. The hard deny-list and the board's own event types always win.

#### Initial union

With `REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION=true`, the board requests its
own capabilities plus the capabilities of all policy rules in its **first**
capability request. The Matrix client asks once at start-up and can remember
the complete list; embedded widgets then never trigger a renegotiation
(capability rounds per widget are set to 0). The trade-off: every board holds
these capabilities, also boards without embedded widgets, and the first
dialog is longer and lists permissions of widgets the user may never use.
Prefer pre-approval in the client (widget lifecycle module) where possible.

## Room power level

User needs to have permissions to send these events to initialize a whiteboard:

- `net.nordeck.whiteboard` state event that creates a new board
- `net.nordeck.whiteboard.sessions` state event that enables real-time collaboration with this user on the board

User will need to wait for the moderator to join and initialize the room and whiteboard if the user doesn't have these permissions.

## Rate limiting settings

For a good NeoBoard experience rate limiting settings need to be tweaked.

NeoBoard sends one snapshot every 5 seconds, if the board changed. One snapshot may consist of multiple chunk events.
If you added images to the board, there is one media upload per image. Uploads also happen when importing a NeoBoard.

Because of that we recommend at least the following settings (using Synapse as an example):

```yml
rc_message:
  per_second: 5
  burst_count: 25
rc_media_create:
  per_second: 20
  burst_count: 100
```

The calculation base for these settings is:

- 1 snapshot with 10 chunks = 11 events in 5 seconds + additional messages sent by the user
- It is possible to import a NeoBoard with 100 images

You can find more information about where to set the rate limiting settings [in the Synapse configuration manual](https://element-hq.github.io/synapse/latest/usage/configuration/config_documentation.html#ratelimiting).

Loosening the rate limiting settings also means people are allowed to send more messages to a room or upload more media files within a short time outside of NeoBoard, so these settings should be adjusted with care.
