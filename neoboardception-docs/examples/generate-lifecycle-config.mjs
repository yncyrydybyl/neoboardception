#!/usr/bin/env node
/*
 * Generates the Widget Lifecycle Module rules (layer 1, Element ↔ NeoBoard)
 * and NeoBoard's own embedded widget policy (layer 2, NeoBoard ↔ embedded
 * widgets) for NeoBoardception from the sources of truth in this repository:
 *
 *   - NeoBoard's own capabilities: matrix-neoboard-widget/src/widgetCapabilities.ts
 *     (constants resolved from packages/react-sdk/src)
 *   - the Poll allow-list of the mediation package:
 *     packages/widget-mediation/src/capabilities.ts (POLL_CAPABILITIES)
 *
 * No dependencies, no build step. Node >= 18.
 *
 *   node neoboardception-docs/examples/generate-lifecycle-config.mjs            # write files
 *   node neoboardception-docs/examples/generate-lifecycle-config.mjs --check    # fail on drift
 *   node neoboardception-docs/examples/generate-lifecycle-config.mjs --print    # print, write nothing
 *
 * Options (defaults produce the committed example files):
 *   --neoboard-url  https://neoboard.example.org   origin NeoBoard is served from
 *   --poll-url      https://poll.example.org       origin Matrix Poll is served from
 *   --module-url    /modules/widget-lifecycle/index.js   where Element loads the module from
 *   --rtc           matrixrtc | webrtc             NeoBoard's REACT_APP_RTC (default matrixrtc)
 *   --modals        inline | forward | deny (default inline): how Poll's modals
 *                   (create/edit poll or group) open. inline: NeoBoard shows
 *                   them itself (policy field modals), no lifecycle rule and no
 *                   client dialog needed. forward: the client opens them
 *                   top-level under NeoBoard's identity; adds the exact Poll
 *                   modal rules and REACT_APP_EMBEDDED_WIDGET_MODAL_ORIGINS.
 *                   deny: no modals (Poll cannot create polls).
 *   --no-modals     same as --modals deny
 *   --preapprove    set preload_approved in NeoBoard's policy for Poll: no local
 *                   consent panel in the board (a notice still names the widget)
 *   --initial-union set REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION=true in the env
 *                   example (Poll capabilities in NeoBoard's first request)
 *   --nested-neoboard-url https://board.example.org
 *                   also allow a NeoBoard as embedded widget (NeoBoard inside
 *                   NeoBoard) from this origin, in its own event namespace
 *                   (policy field event_namespace). Adds the namespaced
 *                   capabilities to the NeoBoard rule and a policy rule for it.
 *                   Off by default.
 *   --omit          comma-separated capabilities to leave out of the NeoBoard rule
 *                   (they then show Element's dialog instead), e.g.
 *                   org.matrix.msc2762.send.state_event:m.room.power_levels#
 *
 * The parser fails loudly when widgetCapabilities.ts contains a construct it
 * does not know, so a changed capability list cannot be skipped silently.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

// ---------------------------------------------------------------- options --

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const neoboardOrigin = normalizeOrigin(
  opt('neoboard-url', 'https://neoboard.example.org'),
);
const pollOrigin = normalizeOrigin(opt('poll-url', 'https://poll.example.org'));
const nestedOrigin = opt('nested-neoboard-url', '')
  ? normalizeOrigin(opt('nested-neoboard-url', ''))
  : undefined;
const moduleUrl = opt('module-url', '/modules/widget-lifecycle/index.js');
const rtc = opt('rtc', 'matrixrtc');
const modals = flag('no-modals') ? 'deny' : opt('modals', 'inline');
if (!['inline', 'forward', 'deny'].includes(modals))
  fail(`--modals must be inline, forward or deny`);
// Only forwarded modals reach the client and need its lifecycle rules.
const withModalRules = modals === 'forward';
const preapprove = flag('preapprove');
const initialUnion = flag('initial-union');
const omit = new Set(
  opt('omit', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
if (!['matrixrtc', 'webrtc'].includes(rtc))
  fail(`--rtc must be matrixrtc or webrtc`);

function normalizeOrigin(u) {
  const url = new URL(u);
  if (url.protocol !== 'https:') fail(`${u}: https only`);
  if (url.pathname !== '/' || url.search || url.hash || url.username)
    fail(`${u}: pass an origin only (scheme, host, optional port)`);
  return url.origin;
}

function fail(msg) {
  console.error(`generate-lifecycle-config: ${msg}`);
  process.exit(1);
}

// ------------------------------------------------- library constant table --
// Values from matrix-widget-api 1.19.0 (src/interfaces/Capabilities.ts,
// src/interfaces/WidgetApiAction.ts) and @matrix-widget-toolkit/api 5.1.0.
// Unknown names fail the run: add them here after checking the library.

const LIBRARY_CONSTANTS = {
  STATE_EVENT_CREATE: 'm.room.create',
  STATE_EVENT_POWER_LEVELS: 'm.room.power_levels',
  STATE_EVENT_ROOM_MEMBER: 'm.room.member',
};
const MATRIX_CAPABILITIES = {
  RequiresClient: 'io.element.requires_client',
  MSC2931Navigate: 'org.matrix.msc2931.navigate',
  MSC3846TurnServers: 'town.robin.msc3846.turn_servers',
  MSC4157SendDelayedEvent: 'org.matrix.msc4157.send.delayed_event',
  MSC4157UpdateDelayedEvent: 'org.matrix.msc4157.update_delayed_event',
  MSC4407SendStickyEvent: 'org.matrix.msc4407.send.sticky_event',
  MSC4407ReceiveStickyEvent: 'org.matrix.msc4407.receive.sticky_event',
  MSC4515RtcTransports: 'org.matrix.msc4515.rtc_transports',
};
const FROM_WIDGET_ACTIONS = {
  MSC4039UploadFileAction: 'org.matrix.msc4039.upload_file',
  MSC4039DownloadFileAction: 'org.matrix.msc4039.download_file',
};
// The toolkit adds this one itself unless supportStandalone is set
// (@matrix-widget-toolkit/api WidgetApiImpl constructor).
const TOOLKIT_IMPLICIT = ['io.element.requires_client'];

// ------------------------------------------- react-sdk string constants --

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const sdkConstants = {};
for (const file of walk(join(repoRoot, 'packages/react-sdk/src'))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(
    /export const ([A-Z0-9_]+)\s*=\s*['"]([^'"]+)['"]\s*;/g,
  )) {
    sdkConstants[m[1]] = m[2];
  }
}

function resolveConstant(name) {
  const v = LIBRARY_CONSTANTS[name] ?? sdkConstants[name];
  if (v === undefined)
    fail(`unknown constant ${name} in widgetCapabilities.ts`);
  return v;
}

// ------------------------------------------------ NeoBoard capabilities --

const capsFile = join(
  repoRoot,
  'matrix-neoboard-widget/src/widgetCapabilities.ts',
);
const capsSrc = readFileSync(capsFile, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

function section(startRe, src) {
  const m = startRe.exec(src);
  if (!m) fail(`widgetCapabilities.ts: section ${startRe} not found`);
  // find the matching bracket/paren
  let depth = 0;
  const open = m[0].at(-1);
  const close = open === '[' ? ']' : ')';
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0)
      return src.slice(m.index + m[0].length, i);
  }
  fail(`widgetCapabilities.ts: unbalanced section ${startRe}`);
}

const ENTRY =
  /WidgetEventCapability\.for(RoomEvent|StateEvent|ToDeviceEvent)\(\s*EventDirection\.(Send|Receive)\s*,\s*([A-Z0-9_]+)\s*(?:,\s*([^,)\s][^,)]*?)\s*)?,?\s*\)|MatrixCapabilities\.(\w+)|WidgetApiFromWidgetAction\.(\w+)/g;

function parseList(body, where) {
  const caps = [];
  const rest = body.replace(ENTRY, (...m) => {
    const [, kind, dir, constName, keyExpr, matrixCap, action] = m;
    if (matrixCap) {
      const v = MATRIX_CAPABILITIES[matrixCap];
      if (!v) fail(`unknown MatrixCapabilities.${matrixCap} (${where})`);
      caps.push({ cap: v });
    } else if (action) {
      const v = FROM_WIDGET_ACTIONS[action];
      if (!v) fail(`unknown WidgetApiFromWidgetAction.${action} (${where})`);
      caps.push({ cap: v });
    } else {
      const d = dir.toLowerCase();
      const type = resolveConstant(constName);
      if (kind === 'RoomEvent') {
        if (keyExpr) fail(`forRoomEvent with 3rd argument (${where})`);
        caps.push({ cap: `org.matrix.msc2762.${d}.event:${type}` });
      } else if (kind === 'ToDeviceEvent') {
        if (keyExpr) fail(`forToDeviceEvent with 3rd argument (${where})`);
        caps.push({ cap: `org.matrix.msc3819.${d}.to_device:${type}` });
      } else if (keyExpr === undefined) {
        caps.push({ cap: `org.matrix.msc2762.${d}.state_event:${type}` });
      } else if (/^(['"])(.*)\1$/.test(keyExpr)) {
        const key = keyExpr.slice(1, -1);
        caps.push({
          cap: `org.matrix.msc2762.${d}.state_event:${type}#${key}`,
        });
      } else if (keyExpr === 'userId') {
        // Per-user state key: the exact string differs per user, so a static
        // rule needs the trailing glob. Only the own user id is ever requested.
        caps.push({
          cap: `org.matrix.msc2762.${d}.state_event:${type}#*`,
          perUser: true,
        });
      } else {
        fail(`unsupported state key expression "${keyExpr}" (${where})`);
      }
    }
    return '';
  });
  if (rest.replace(/[\s,]/g, '') !== '')
    fail(`unparsed content in ${where}: ${rest.trim().slice(0, 120)}`);
  return caps;
}

const base = parseList(
  section(/export const widgetCapabilities\s*=\s*\[/, capsSrc),
  'base list',
);
const ifIdx = capsSrc.indexOf('if (isMatrixRtcMode())');
if (ifIdx < 0) fail('widgetCapabilities.ts: isMatrixRtcMode branch not found');
const afterIf = capsSrc.slice(ifIdx);
const rtcBody = section(/widgetCapabilities\.push\(/, afterIf);
const elseIdx = afterIf.indexOf('} else {');
if (elseIdx < 0) fail('widgetCapabilities.ts: else branch not found');
const webrtcBody = section(
  /widgetCapabilities\.push\(/,
  afterIf.slice(elseIdx),
);

const neoboardEntries = [
  ...base,
  ...parseList(rtc === 'matrixrtc' ? rtcBody : webrtcBody, `${rtc} branch`),
  ...TOOLKIT_IMPLICIT.map((cap) => ({ cap })),
];

// ------------------------------------------------- Poll (mediation list) --

const medSrc = readFileSync(
  join(repoRoot, 'packages/widget-mediation/src/capabilities.ts'),
  'utf8',
);
const pollBlock =
  /export const POLL_CAPABILITIES[^=]*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/.exec(
    medSrc,
  );
if (!pollBlock) fail('POLL_CAPABILITIES not found in widget-mediation');
const pollCaps = [...pollBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
if (pollCaps.length === 0) fail('POLL_CAPABILITIES is empty');
if (pollCaps.some((c) => c.includes('*')))
  fail('POLL_CAPABILITIES contains a glob; lifecycle rules must stay exact');

// ------------------------------------- NeoBoard inside NeoBoard (opt-in) --
// The embedded board runs in WebRTC mode (MatrixRTC is not delegated), drops
// the capabilities listed in nestedBoard.ts and works in its own namespace.

function readStringArray(file, name) {
  const src = readFileSync(join(repoRoot, file), 'utf8');
  const m = new RegExp(`export const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`).exec(
    src,
  );
  if (!m) fail(`${name} not found in ${file}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}
function readString(file, name) {
  const src = readFileSync(join(repoRoot, file), 'utf8');
  const m = new RegExp(`export const ${name}\\s*=\\s*'([^']+)'`).exec(src);
  if (!m) fail(`${name} not found in ${file}`);
  return m[1];
}

const uniq = (xs) => [...new Set(xs)];
const BOARD_NAMESPACE = 'net.nordeck.whiteboard';
let nested;
if (nestedOrigin) {
  const root = readString(
    'packages/widget-mediation/src/namespace.ts',
    'NESTED_NAMESPACE_ROOT',
  );
  const omitted = readStringArray(
    'matrix-neoboard-widget/src/embeddedWidgets/nestedBoard.ts',
    'EMBEDDED_BOARD_OMITTED_CAPABILITIES',
  );
  const target = `${root}${BOARD_NAMESPACE}`;
  const rewrite = (cap) =>
    cap.replace(
      /^((?:org\.matrix\.msc2762\.(?:send|receive)\.(?:event|state_event)|org\.matrix\.msc3819\.(?:send|receive)\.to_device):)net\.nordeck\.whiteboard(?=$|[.#])/,
      `$1${target}`,
    );
  const entries = [
    ...base,
    ...parseList(webrtcBody, 'webrtc branch (embedded board)'),
    ...TOOLKIT_IMPLICIT.map((cap) => ({ cap })),
  ].filter((e) => !omitted.includes(e.cap));
  for (const o of omitted)
    if (!neoboardEntries.concat(base).some((e) => e.cap === o))
      fail(
        `EMBEDDED_BOARD_OMITTED_CAPABILITIES: ${o} is not a NeoBoard capability`,
      );
  // Layer 1 (Element): exact strings, per-user state key as #* glob.
  const lifecycle = uniq(entries.map((e) => rewrite(e.cap)));
  // Layer 2 (NeoBoard policy): no globs; the key-less form covers the
  // per-user state key the board requests.
  const policyCaps = uniq(
    entries.map((e) => rewrite(e.perUser ? e.cap.replace(/#\*$/, '') : e.cap)),
  );
  nested = {
    origin: nestedOrigin,
    namespace: { [BOARD_NAMESPACE]: target },
    lifecycle,
    policyCaps,
  };
}

// --------------------------------------------------------------- compose --

const neoboardCaps = uniq(neoboardEntries.map((e) => e.cap));
for (const o of omit)
  if (!neoboardCaps.includes(o) && !pollCaps.includes(o))
    fail(`--omit ${o}: not part of the generated list`);

// Union under NeoBoard's URL: Element only ever sees NeoBoard.
const neoboardRule = uniq([
  ...neoboardCaps,
  ...pollCaps,
  // Namespaced capabilities of an embedded NeoBoard (only what the client
  // does not already grant to NeoBoard itself).
  ...(nested ? nested.lifecycle : []),
]).filter((c) => !omit.has(c));
const pollDelta = pollCaps.filter((c) => !neoboardCaps.includes(c));

// Element Web with Module API v2 (module io.element widget-lifecycle):
// rules match the RAW widget templateUrl including query and hash, so the
// NeoBoard rule needs the trailing glob; modal URLs are <path>#/?<params>.
const MODULE_V2_KEY = 'io.element.element-web-modules.widget-lifecycle';
// Legacy Nordeck module (legacy module API, build_config.yaml): query and
// hash are stripped before matching, so exact URLs work.
const MODULE_LEGACY_KEY = 'net.nordeck.element_web.module.widget_lifecycle';

const POLL_MODAL_PATHS = ['/create-poll', '/admin/create-group'];

function rules(variant) {
  const r = {};
  r[variant === 'v2' ? `${neoboardOrigin}/*` : `${neoboardOrigin}/`] = {
    preload_approved: true,
    capabilities_approved: neoboardRule,
  };
  if (withModalRules)
    for (const p of POLL_MODAL_PATHS)
      r[variant === 'v2' ? `${pollOrigin}${p}#*` : `${pollOrigin}${p}`] = {
        capabilities_approved: pollCaps,
      };
  return r;
}

const runtimeConfig = {
  modules: [moduleUrl],
  [MODULE_V2_KEY]: { widget_permissions: rules('v2') },
};
const legacyConfig = {
  [MODULE_LEGACY_KEY]: { widget_permissions: rules('legacy') },
};

// Layer 2: read by NeoBoard from REACT_APP_EMBEDDED_WIDGET_POLICY. Matched on
// origin + path without query and fragment; exact rule for the Poll root.
const policy = {
  $comment:
    'NeoBoard embedded widget policy (layer 2). Same schema as the lifecycle module; NeoBoard reads it from REACT_APP_EMBEDDED_WIDGET_POLICY (JSON or base64:<JSON>). See hardening.md section 9.',
  version: 1,
  unlisted: 'deny',
  widget_permissions: {
    [`${pollOrigin}/`]: {
      name: 'Poll',
      preload_approved: preapprove,
      identity_approved: false,
      modals,
      capabilities_approved: pollCaps,
    },
    ...(nested
      ? {
          [`${nested.origin}/`]: {
            name: 'NeoBoard (embedded)',
            preload_approved: preapprove,
            identity_approved: false,
            event_namespace: nested.namespace,
            capabilities_approved: nested.policyCaps,
          },
        }
      : {}),
  },
};
// The environment value leaves out the comment to stay short.
const { $comment: _comment, ...policyForEnv } = policy;
const policyBase64 = Buffer.from(JSON.stringify(policyForEnv), 'utf8').toString(
  'base64',
);

const frameOrigins = [pollOrigin, ...(nested ? [nested.origin] : [])];

const json = (o) => JSON.stringify(o, null, 2) + '\n';
const header =
  '# Generated by generate-lifecycle-config.mjs. Do not edit by hand.\n';

const env = `${header}# NeoBoard (matrix-neoboard-widget) settings for NeoBoardception.
# Runtime variables: set them on the container (widget-server image injects
# every REACT_APP_* variable into window.__ENVIRONMENT__ at start-up). The same
# names also work at build time (import.meta.env), runtime values win.

# Embedded widget origins (exact origins, comma-separated). Without a policy
# this is the allow-list (empty = embedding off); with a policy it caps the
# policy's origins.
REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS=${frameOrigins.join(',')}

# CSP frame-src of the widget-server image (space-separated). Default is 'self'
# only, which blocks every embedded widget. Must equal the allow-list above.
CSP_FRAME_SRC=${frameOrigins.join(' ')}

# Must match the --rtc value the lifecycle rules were generated with,
# otherwise NeoBoard requests capabilities that are not pre-approved.
REACT_APP_RTC=${rtc}

# Existing NeoBoard settings (see docs/configuration.md).
REACT_APP_HOME_SERVER_URL=https://matrix.example.org

# NeoBoard's embedded widget policy (layer 2, same schema as the lifecycle
# module), generated from embedded-widgets.policy.json. base64:<JSON> because
# the widget-server image does not escape quotes in environment values.
# With a policy, REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS is an upper bound.
REACT_APP_EMBEDDED_WIDGET_POLICY=base64:${policyBase64}

# Initial union: add the policy's capabilities to NeoBoard's FIRST capability
# request, so the client asks once at start-up (or pre-approves the union) and
# no renegotiation is needed. Off by default: boards without embedded widgets
# then also hold the Poll capabilities.
${initialUnion ? '' : '# '}REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION=true

# Optional, only without a policy rule field "modals": origins whose embedded
# widgets may open modals in the client (forward; needs the modal rules in
# config.runtime.json). The policy above sets "modals" for Poll (${modals}).
${withModalRules ? '' : '# '}REACT_APP_EMBEDDED_WIDGET_MODAL_ORIGINS=${pollOrigin}

# Optional: capabilities (exact strings) in addition to the Poll defaults.
# Without a policy, every allowed widget gets them; with a policy, this is an
# upper bound for the policy's rules (it never widens a rule). The hard
# deny-list and NeoBoard's own events always win.
# REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES=

# Optional: embedded widgets running at the same time per client (1-20,
# default 3).
# REACT_APP_EMBEDDED_WIDGET_MAX_LIVE=3

# ---------------------------------------------------------------------------
# Build-time: leave UNSET for hardened builds. When set, the spike's nested
# host is compiled into the bundle (see spike/).
# REACT_APP_NBC_SPIKE_INNER_ORIGINS=
`;

const buildYaml = `${header}# Build-time module loading (LEGACY Element Web only).
#
# build_config.yaml belongs to the legacy module system that Element Web removed
# in September 2026 (element-web PR #33941, "Remove legacy Module & Customisation API").
# Use it only for an Element Web release that still contains it. Newer releases
# load modules at runtime via config.json "modules" (see config.runtime.json),
# optionally baked into the image (Docker target element_web_modules, /modules).
#
# The legacy package is the Nordeck module. Its configuration goes into
# config.json under "${MODULE_LEGACY_KEY}"
# (see config.legacy-build.json). It strips query and hash before matching.
modules:
  - "@nordeck/element-web-widget-lifecycle-module@1.0.1"
`;

const outputs = {
  'config.runtime.json': json(runtimeConfig),
  'config.legacy-build.json': json(legacyConfig),
  'build_config.yaml': buildYaml,
  'neoboard.env.example': env,
  'embedded-widgets.policy.json': json(policy),
};

// Format like the repository's prettier setup (the commit hook runs prettier
// on *.json and *.yaml), so --check does not report formatting-only drift.
async function format(file, content) {
  if (!/\.(json|ya?ml)$/.test(file)) return content;
  let prettier;
  try {
    prettier = await import(join(repoRoot, 'node_modules/prettier/index.mjs'));
  } catch {
    fail('prettier not found; run yarn install in the repository root first');
  }
  const config = (await prettier.resolveConfig(join(here, file))) ?? {};
  return prettier.format(content, { ...config, filepath: join(here, file) });
}
for (const f of Object.keys(outputs)) outputs[f] = await format(f, outputs[f]);

if (flag('print')) {
  for (const [f, c] of Object.entries(outputs)) console.log(`==> ${f}\n${c}`);
  process.exit(0);
}

let drift = false;
for (const [f, content] of Object.entries(outputs)) {
  const p = join(here, f);
  if (flag('check')) {
    let old = '';
    try {
      old = readFileSync(p, 'utf8');
    } catch {}
    if (old !== content) {
      console.error(`drift: ${relative(repoRoot, p)}`);
      drift = true;
    }
  } else {
    writeFileSync(p, content);
    console.log(`wrote ${relative(repoRoot, p)}`);
  }
}
console.log(
  `NeoBoard (${rtc}): ${neoboardCaps.length} caps, Poll: ${pollCaps.length}, ` +
    `Poll delta: ${pollDelta.length}, NeoBoard rule: ${neoboardRule.length}` +
    (neoboardEntries.some((e) => e.perUser)
      ? ' (contains a per-user #* glob)'
      : ''),
);
if (drift) process.exit(1);
