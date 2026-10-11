// NeoBoardception spike — end-to-end measurement in a real Element Web over CDP.
//
// Element → NeoBoard fork (served locally) → inner test widget (served locally).
// Measures M1 (dialog for the inner start request), M2 (second dialog for a
// runtime MSC2974 request), M3 (events really land in the room), plus the fate
// of NeoBoard's own caps, "Remember my selection" and the dialog's identity text.
// Records a video with German captions.
//
// Required env:
//   ELEMENT_URL        e.g. https://app.element.io (MAS/OIDC password login)
//   MATRIX_HOMESERVER  CS-API base URL, e.g. https://matrix.example.org
//   CREDS_FILE         JSON: { users: { bot: {user_id, localpart, password, access_token},
//                                       peer: {user_id, access_token} },
//                              rooms: { "<room_id>": … } }   (or set ROOM_ID)
// Optional env:
//   ROOM_ID, NEOBOARD_URL (https://localhost:5443/), INNER_URL (https://localhost:5444/),
//   SHOTS_DIR (spike/shots), VIDEO_DIR (spike/.video), VIDEO_MP4 (output path),
//   CDP_PORT (9333), HEADED=1, PLAYWRIGHT_DIR (dir whose node_modules has playwright),
//   SERVE=0 to not start the static servers, PAUSE_MS (1500), WIDGET_ID (neoboardception-spike).
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDir } from './serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const env = (k, d) => process.env[k] ?? d;
const req = (k) => {
  if (!process.env[k]) throw new Error(`missing env ${k}`);
  return process.env[k];
};

const require = createRequire(join(env('PLAYWRIGHT_DIR', ROOT), 'noop.js'));
const { chromium } = require('playwright');

const ELEMENT_URL = req('ELEMENT_URL').replace(/\/$/, '');
const HS = req('MATRIX_HOMESERVER').replace(/\/$/, '');
const creds = JSON.parse(readFileSync(req('CREDS_FILE'), 'utf8'));
const ROOM_ID = env('ROOM_ID', Object.keys(creds.rooms ?? {})[0]);
const bot = creds.users.bot;
const peer = creds.users.peer;
const NEOBOARD_URL = env('NEOBOARD_URL', 'https://localhost:5443/');
const INNER_URL = env('INNER_URL', 'https://localhost:5444/');
const WIDGET_ID = env('WIDGET_ID', 'neoboardception-spike');
const SHOTS = env('SHOTS_DIR', join(ROOT, 'spike', 'shots'));
const VIDEO_DIR = env('VIDEO_DIR', join(ROOT, 'spike', '.video'));
const PAUSE = Number(env('PAUSE_MS', 1500));
const CDP_PORT = Number(env('CDP_PORT', 9333));
mkdirSync(SHOTS, { recursive: true });
mkdirSync(VIDEO_DIR, { recursive: true });

const results = {};
const t0 = Date.now();
const note = (k, v) => {
  results[k] = v;
  console.log(
    `[${((Date.now() - t0) / 1000).toFixed(0)}s] ${k}:`,
    typeof v === 'string' ? v : JSON.stringify(v),
  );
};

// ---------- CS-API ----------
async function cs(user, method, path, body) {
  let r;
  for (let i = 0; ; i++) {
    try {
      r = await fetch(`${HS}/_matrix/client/v3${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${user.access_token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      break;
    } catch (e) {
      if (i >= 4) throw e; // transient network errors
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
  const t = await r.text();
  if (!r.ok)
    throw new Error(`${method} ${path} → ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
}
const R = encodeURIComponent(ROOM_ID);
const putState = (u, type, key, content) =>
  cs(u, 'PUT', `/rooms/${R}/state/${type}/${encodeURIComponent(key)}`, content);
const getState = (u, type, key = '') =>
  cs(u, 'GET', `/rooms/${R}/state/${type}/${encodeURIComponent(key)}`).catch(
    () => null,
  );
async function messages(u, types, limit = 100) {
  const filter = encodeURIComponent(JSON.stringify({ types }));
  const j = await cs(
    u,
    'GET',
    `/rooms/${R}/messages?dir=b&limit=${limit}&filter=${filter}`,
  );
  return j.chunk ?? [];
}

// ---------- widget install ----------
const NO_INNER = env('NO_INNER', '0') === '1'; // control run: NeoBoard without nested widget
const TEMPLATE =
  '?widgetId=$matrix_widget_id' +
  (NO_INNER ? '' : '&nbc_inner=' + encodeURIComponent(INNER_URL)) +
  '#/?theme=$org.matrix.msc2873.client_theme&matrix_user_id=$matrix_user_id' +
  '&matrix_room_id=$matrix_room_id&matrix_widget_id=$matrix_widget_id' +
  '&matrix_display_name=$matrix_display_name&matrix_avatar_url=$matrix_avatar_url' +
  '&matrix_client_id=$org.matrix.msc2873.client_id&matrix_client_language=$org.matrix.msc2873.client_language' +
  '&matrix_client_theme=$org.matrix.msc2873.client_theme&matrix_base_url=$org.matrix.msc4039.matrix_base_url' +
  '&matrix_device_id=$org.matrix.msc3819.matrix_device_id';

async function installWidget() {
  const url = NEOBOARD_URL.replace(/\/$/, '/') + TEMPLATE;
  const r = await putState(bot, 'im.vector.modular.widgets', WIDGET_ID, {
    type: 'm.custom',
    url,
    name: 'NeoBoardception',
    id: WIDGET_ID,
    creatorUserId: bot.user_id,
    // Toolkit widgets never send content_loaded → Element must start the
    // capability handshake on iframe load.
    waitForIframeLoad: true,
    data: { title: 'NeoBoardception' },
  });
  await putState(bot, 'io.element.widgets.layout', '', {
    widgets: {
      [WIDGET_ID]: { container: 'center', index: 0, width: 100, height: 100 },
    },
  });
  return r.event_id;
}

// ---------- browser ----------
async function launch() {
  const exe = chromium.executablePath();
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${join(VIDEO_DIR, 'profile-' + Date.now())}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Local https widgets inside a public https client: relax PNA + cert checks (test only).
    '--ignore-certificate-errors',
    '--allow-running-insecure-content',
    '--disable-web-security',
    '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,IsolateOrigins,site-per-process',
    '--window-size=1280,860',
    ...(process.env.HEADED === '1' ? [] : ['--headless=new']),
    'about:blank',
  ];
  const proc = spawn(exe, args, { stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    browser = await chromium
      .connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
      .catch(() => null);
    if (!browser) await new Promise((r) => setTimeout(r, 500));
  }
  if (!browser) throw new Error('CDP connect failed');
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } },
  });
  // Caption banner (top Element page only) + show hidden events in the timeline.
  await ctx.addInitScript(() => {
    if (window.top !== window) return;
    try {
      const k = 'mx_local_settings';
      const s = JSON.parse(localStorage.getItem(k) || '{}');
      if (!s.showHiddenEventsInTimeline) {
        s.showHiddenEventsInTimeline = true;
        localStorage.setItem(k, JSON.stringify(s));
      }
    } catch {}
    const ensure = () => {
      let el = document.getElementById('__cap');
      if (!el && document.body) {
        el = document.createElement('div');
        el.id = '__cap';
        el.style.cssText =
          'position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:2147483647;max-width:1100px;' +
          'background:rgba(20,20,40,.88);color:#fff;font:600 15px system-ui,sans-serif;padding:6px 14px;' +
          'border-radius:6px;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.4);text-align:center';
        document.body.appendChild(el);
      }
      if (el) el.textContent = sessionStorage.getItem('__cap') || '';
      return el;
    };
    window.__setCaption = (t) => {
      sessionStorage.setItem('__cap', t);
      ensure();
    };
    document.addEventListener('DOMContentLoaded', ensure);
    setInterval(ensure, 1000);
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (process.env.CONSOLE_DUMP)
      allConsole.push(`${m.type()} ${t.slice(0, 500)}`);
    if (/nbc-spike|Widget .* is allowed capabilities|waitForIframeLoad/.test(t))
      console.log('  [console]', t.slice(0, 300));
    if (
      (m.type() === 'error' || m.type() === 'warning') &&
      /snapshot|capabilit|Missing|rejected|whiteboard/i.test(t)
    ) {
      consoleIssues.push(t.slice(0, 400));
      console.log('  [console-issue]', t.slice(0, 300));
    }
  });
  return { proc, browser, ctx, page };
}

let page;
const consoleIssues = [];
const allConsole = [];
const sleep = (ms) => page.waitForTimeout(ms);
async function caption(text, pause = PAUSE) {
  console.log('  ▶', text);
  await page.evaluate((t) => window.__setCaption?.(t), text).catch(() => {});
  await sleep(pause);
}
const shot = async (name) => {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  return `${name}.png`;
};

async function login() {
  for (let i = 0; i < 5; i++) {
    await page
      .goto(`${ELEMENT_URL}/#/login`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      .catch(() => {});
    await sleep(2500);
    if (
      !(await page
        .getByText(/misconfigured|Unexpected error/i)
        .count()
        .catch(() => 0))
    )
      break;
  }
  await caption('Anmeldung in Element über MAS (OIDC) als Test-Bot');
  // Homeserver picker on generic Element instances: switch to our homeserver if needed.
  const editHs = page.getByRole('button', { name: /^edit$/i }).first();
  if (await editHs.isVisible({ timeout: 2000 }).catch(() => false)) {
    const shown = await page
      .locator('.mx_ServerPicker_server')
      .innerText()
      .catch(() => '');
    const hsHost = new URL(HS).host;
    const serverName = bot.user_id.split(':').slice(1).join(':');
    if (!shown.includes(serverName) && !shown.includes(hsHost)) {
      await editHs.click();
      const other = page.locator('input[type=text], input[label]').last();
      await page
        .getByLabel(/other homeserver/i)
        .check()
        .catch(() => {});
      await page
        .locator('.mx_ServerPickerDialog input[type=text]')
        .fill(serverName)
        .catch(() => other.fill(serverName));
      await page
        .getByRole('button', { name: /^continue$/i })
        .last()
        .click();
      await sleep(3000);
    }
  }
  await page
    .getByRole('button', { name: /continue|sign in/i })
    .first()
    .click({ timeout: 20000 })
    .catch(() => {});
  const user = page.locator('input[name="username"]');
  if (
    await user
      .waitFor({ timeout: 45000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await user.fill(bot.localpart);
    const pw = page.locator('input[name="password"]');
    if (!(await pw.isVisible({ timeout: 1500 }).catch(() => false))) {
      await page.locator('button[type="submit"]').first().click();
    }
    await pw.fill(bot.password);
    await page.locator('button[type="submit"]').first().click();
    await sleep(3500);
    const consent = page
      .getByRole('button', { name: /^(continue|allow|authori[sz]e)$/i })
      .first();
    if (await consent.isVisible({ timeout: 6000 }).catch(() => false))
      await consent.click();
  }
  await page
    .waitForURL((u) => u.toString().startsWith(ELEMENT_URL), { timeout: 60000 })
    .catch(() => {});
  // Skip device verification (unencrypted test room).
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    const skip = page
      .locator(
        '[aria-label="Skip verification for now"], .mx_CompleteSecurity_skip',
      )
      .first();
    if (await skip.isVisible({ timeout: 800 }).catch(() => false)) {
      await skip.click().catch(() => {});
      await sleep(1000);
      const later = page
        .getByRole('button', { name: /i'll verify later|verify later/i })
        .first();
      if (await later.isVisible({ timeout: 2000 }).catch(() => false))
        await later.click().catch(() => {});
      break;
    }
    if (
      await page
        .locator('.mx_RoomList, .mx_LeftPanel, .mx_HomePage')
        .first()
        .isVisible({ timeout: 800 })
        .catch(() => false)
    ) {
      if (Date.now() > deadline - 25000) break;
    }
  }
  await page
    .locator('.mx_LeftPanel, .mx_RoomList, .mx_HomePage')
    .first()
    .waitFor({ timeout: 60000 })
    .catch(() => {});
  return page.url().startsWith(ELEMENT_URL);
}

async function dismissToasts() {
  for (const n of [/^later$/i, /^dismiss$/i, /^not now$/i, /^ok$/i]) {
    await page
      .getByRole('button', { name: n })
      .first()
      .click({ timeout: 800 })
      .catch(() => {});
  }
}

/**
 * Wait for Element's capability dialog, record its text and approve it with
 * Element's defaults (incl. the default of the "Remember my selection" switch,
 * which is recorded). OpenID "verify your identity" dialogs that Element
 * queues in front are recorded and confirmed on the way.
 */
const identityDialogs = [];
async function capabilityDialog(label, { timeout = 60000 } = {}) {
  const dlg = page.locator('.mx_WidgetCapabilitiesPromptDialog');
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await dlg.isVisible({ timeout: 500 }).catch(() => false)) break;
    await page
      .getByRole('button', { name: /^dismiss$/i })
      .first()
      .click({ timeout: 200 })
      .catch(() => {});
  }
  if (!(await dlg.isVisible().catch(() => false))) return null;
  await sleep(800);
  const text = await dlg.innerText();
  const remember = await dlg
    .locator('input[type=checkbox]')
    .last()
    .isChecked()
    .catch(() => null);
  const unchecked = await dlg
    .locator(
      '.mx_WidgetCapabilitiesPromptDialog_cap input[type=checkbox]:not(:checked)',
    )
    .count();
  const file = await shot(label);
  await sleep(PAUSE);
  await dlg.getByRole('button', { name: /^approve$/i }).click();
  await dlg.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  return { text, file, rememberDefault: remember, uncheckedCaps: unchecked };
}

// Element's OpenID "verify your identity" dialog (requested by NeoBoard) can
// pop up at any time; record and confirm it in the background.
let idBusy = false;
function startIdentityWatcher() {
  return setInterval(async () => {
    if (idBusy || !page) return;
    idBusy = true;
    try {
      const idDlg = page
        .locator('.mx_Dialog')
        .filter({ hasText: /verify your identity/i });
      if (await idDlg.isVisible({ timeout: 200 }).catch(() => false)) {
        const text = await idDlg.innerText().catch(() => '');
        const file = await shot(`identity-${identityDialogs.length}`).catch(
          () => null,
        );
        identityDialogs.push({
          at: Math.round((Date.now() - t0) / 1000),
          text,
          file,
        });
        note('identity_dialog', { text });
        await idDlg
          .getByRole('button', { name: /^continue$/i })
          .click({ timeout: 2000 })
          .catch(() => {});
      }
    } finally {
      idBusy = false;
    }
  }, 1000);
}

// MUI radio inside NeoBoard's toolbar: a DOM click reliably fires React's onChange.
const selectRectangle = (f) =>
  f.evaluate(() => {
    const el = document.querySelector(
      'input[type=radio][aria-label="Rectangle"]',
    );
    el?.click();
    return !!el?.checked;
  });
// NeoBoard's guided tour sits partly under the spike overlay → click via DOM.
const closeTour = (f) =>
  f
    ?.evaluate(() => {
      const b = [
        ...document.querySelectorAll('button[aria-label="Close"]'),
      ].find((x) => x.closest('[aria-labelledby]'));
      if (b) b.click();
      return !!b;
    })
    .catch(() => false);
const frameBy = async (prefix, tries = 160) => {
  for (let i = 0; i < tries; i++) {
    const f = page.frames().find((f) => (f.url() || '').startsWith(prefix));
    if (f) return f;
    await sleep(250);
  }
  return null;
};
const innerFrame = () => frameBy(INNER_URL);
const rememberedCaps = () =>
  page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem(`widget_${id}_approved_caps`) || 'null'),
    WIDGET_ID,
  );

// ---------- run ----------
const servers = [];
if (env('SERVE', '1') !== '0') {
  servers.push(
    await serveDir(
      join(ROOT, 'matrix-neoboard-widget', 'build'),
      Number(new URL(NEOBOARD_URL).port || 443),
    ),
  );
  servers.push(
    await serveDir(
      join(ROOT, 'spike', 'test-widget', 'dist'),
      Number(new URL(INNER_URL).port || 443),
    ),
  );
}
const { proc, browser, ctx, page: p } = await launch();
page = p;
let exitCode = 0;
try {
  note('widget_state_event', await installWidget());
  startIdentityWatcher();
  note('logged_in', await login());
  await dismissToasts();
  await caption(
    'Testraum öffnen – NeoBoard-Fork ist als Raum-Widget (maximiert) installiert',
  );
  await page.goto(`${ELEMENT_URL}/#/room/${ROOM_ID}`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .locator('.mx_RoomView')
    .first()
    .waitFor({ timeout: 60000 })
    .catch(() => {});
  await dismissToasts();
  await shot('01-room-open');

  // 0. NeoBoard's own dialog (Ebene 2). Remember ticked to observe the overwrite later.
  await caption(
    'Schritt 0: Element fragt NeoBoards EIGENE Berechtigungen ab (Standard: „Merken“ an)',
  );
  const d0 = await capabilityDialog('02-dialog-neoboard-own');
  note(
    'dialog0_neoboard_own',
    d0
      ? {
          lines: d0.text.split('\n').length,
          rememberDefault: d0.rememberDefault,
          unchecked: d0.uncheckedCaps,
          text: d0.text,
        }
      : 'NOT SHOWN',
  );
  note('remembered_after_dialog0', (await rememberedCaps())?.length ?? null);

  const nbFrame = await frameBy(NEOBOARD_URL);
  note('neoboard_frame', !!nbFrame);
  await caption(
    'NeoBoard lädt (Loading-Blocker-Check: waitForIframeLoad=true)',
  );
  const boardReady = nbFrame
    ? await nbFrame
        .locator('[aria-label="Rectangle"], [role="toolbar"]')
        .first()
        .waitFor({ timeout: 60000 })
        .then(() => true)
        .catch(() => false)
    : false;
  note('neoboard_board_rendered', boardReady);
  // NeoBoard's onboarding tour and Element's feature popups would cover the canvas.
  await sleep(3000);
  note('tour_closed', await closeTour(nbFrame));
  await page
    .getByRole('button', { name: /^ok$/i })
    .first()
    .click({ timeout: 1500 })
    .catch(() => {});
  await shot('03-neoboard-loaded');

  if (NO_INNER) {
    await caption(
      'Kontrolllauf ohne inneres Widget: Rechteck zeichnen, Snapshot prüfen',
    );
    const tC = Date.now();
    await sleep(6000);
    await selectRectangle(nbFrame);
    await sleep(800);
    if (process.env.CONSOLE_DUMP)
      writeFileSync(
        process.env.CONSOLE_DUMP + '.toolbar.html',
        await nbFrame.evaluate(() =>
          [...document.querySelectorAll('[aria-label*="ectangle"]')]
            .map((e) => e.outerHTML.slice(0, 600))
            .join('\n----\n'),
        ),
      );
    note(
      'control_tool_checked',
      await nbFrame
        .locator('input[aria-label="Rectangle"]')
        .first()
        .isChecked()
        .catch(() => null),
    );
    const b = await page
      .locator(`iframe[src^="${NEOBOARD_URL}"]`)
      .first()
      .boundingBox();
    await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(
      b.x + b.width * 0.3 + 160,
      b.y + b.height * 0.4 + 110,
      { steps: 12 },
    );
    await page.mouse.up();
    let docs = [];
    for (let i = 0; i < 30 && !docs.length; i++) {
      await sleep(1500);
      docs = (
        await messages(
          peer,
          [
            'net.nordeck.whiteboard.document.snapshot',
            'net.nordeck.whiteboard.document.chunk',
          ],
          50,
        )
      ).filter((e) => e.origin_server_ts >= tC - 2000);
    }
    note(
      'control_doc_events',
      docs.map((e) => ({ type: e.type, event_id: e.event_id })),
    );
    await shot('control-draw');
    throw Object.assign(new Error('control run finished'), { control: true });
  }

  // M1
  await caption(
    'Messpunkt 1: Inneres Testwidget startet und fordert net.neoboardception.ping an – kommt ein Dialog in Element?',
  );
  const d1 = await capabilityDialog('04-M1-dialog-inner-start', {
    timeout: 90000,
  });
  note(
    'M1_dialog',
    d1
      ? {
          text: d1.text,
          rememberDefault: d1.rememberDefault,
          unchecked: d1.uncheckedCaps,
        }
      : 'NOT SHOWN',
  );
  note('remembered_after_M1', await rememberedCaps());
  const inner = await innerFrame();
  note('inner_frame', !!inner);
  await inner
    ?.locator('html[data-status="ready"]')
    .waitFor({ timeout: 60000 })
    .catch(() => {});
  await sleep(1500);
  note(
    'inner_approved_after_M1',
    await inner?.locator('html').getAttribute('data-approved'),
  );
  await caption(
    'Messpunkt 1: Inneres Widget meldet „ready“ und genehmigte Capabilities',
  );
  await shot('05-M1-inner-ready');

  // M3 (ping)
  const tPing = Date.now();
  await caption(
    'Messpunkt 3a: „Ping senden“ im inneren Widget – Event läuft Testwidget → NeoBoard → Element → Raum',
  );
  await inner.getByRole('button', { name: 'Ping senden' }).click();
  await inner
    .locator('html[data-result^="ping"]')
    .waitFor({ timeout: 30000 })
    .catch(() => {});
  const pingResult = await inner.locator('html').getAttribute('data-result');
  note('M3_ping_result_in_widget', pingResult);
  await sleep(2500);
  const pingsPeer = (await messages(peer, ['net.neoboardception.ping'])).filter(
    (e) => e.origin_server_ts >= tPing - 5000,
  );
  note(
    'M3_ping_seen_by_peer_csapi',
    pingsPeer.map((e) => ({
      event_id: e.event_id,
      sender: e.sender,
      body: e.content?.body,
    })),
  );
  await shot('06-M3-ping-sent');

  // NeoBoard's own caps still working? (draw a rectangle → board document events)
  await caption(
    'Prüfung: Funktioniert NeoBoard nach der Neuverhandlung noch? (Rechteck zeichnen)',
  );
  const tDraw = Date.now();
  await dismissToasts();
  await closeTour(nbFrame);
  try {
    await selectRectangle(nbFrame);
    const box = await page
      .locator(`iframe[src^="${NEOBOARD_URL}"]`)
      .first()
      .boundingBox();
    const x = box.x + box.width * 0.3,
      y = box.y + box.height * 0.4;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 160, y + 110, { steps: 12 });
    await page.mouse.up();
  } catch (e) {
    note('draw_error', String(e).slice(0, 200));
  }
  await sleep(2000);
  await shot('07-neoboard-draw-after-renegotiation');

  // M2
  await caption(
    'Messpunkt 2: „Nachfordern“ – Laufzeit-Anfrage (MSC2974) für State-Event net.neoboardception.pong',
  );
  await inner.getByRole('button', { name: 'Nachfordern' }).click();
  const d2 = await capabilityDialog('08-M2-dialog-runtime');
  note(
    'M2_dialog',
    d2
      ? {
          text: d2.text,
          rememberDefault: d2.rememberDefault,
          unchecked: d2.uncheckedCaps,
        }
      : 'NOT SHOWN',
  );
  note('remembered_after_M2', await rememberedCaps());
  await inner
    .locator(
      'html[data-result^="pong"], html[data-result*="ABGELEHNT"], html[data-result*="FEHLER"]',
    )
    .waitFor({ timeout: 60000 })
    .catch(() => {});
  note(
    'M2_inner_result',
    await inner.locator('html').getAttribute('data-result'),
  );
  note(
    'inner_approved_after_M2',
    await inner.locator('html').getAttribute('data-approved'),
  );
  await caption(
    'Messpunkt 3b: Pong-State-Event gesendet – Prüfung per CS-API als Peer',
  );
  await sleep(2000);
  note(
    'M3_pong_state_peer_csapi',
    await getState(peer, 'net.neoboardception.pong', ''),
  );
  await shot('09-M2-pong-sent');

  // board persisted?
  for (let i = 0; i < 30; i++) {
    const docs = (
      await messages(
        peer,
        [
          'net.nordeck.whiteboard.document.chunk',
          'net.nordeck.whiteboard.document.snapshot',
          'net.nordeck.whiteboard.document.create',
        ],
        50,
      )
    ).filter((e) => e.origin_server_ts >= tDraw - 2000);
    if (docs.length) {
      note(
        'neoboard_doc_events_after_renegotiation',
        docs.map((e) => ({ type: e.type, event_id: e.event_id })).slice(0, 5),
      );
      break;
    }
    if (i === 29) note('neoboard_doc_events_after_renegotiation', []);
    await sleep(1500);
  }
  const hostLog = await nbFrame
    .locator('#nbc-spike-hostlog')
    .innerText()
    .catch(() => '');
  writeFileSync(join(SHOTS, 'hostlog-run1.txt'), hostLog);
  const lastNotify = [
    ...hostLog.matchAll(/outer notify_capabilities \(from Element\) (.*)/g),
  ].map((m) => JSON.parse(m[1]));
  if (lastNotify.length) {
    const n = lastNotify[lastNotify.length - 1];
    note('outer_notify_last', {
      requested: n.requested,
      approved_count: n.approved?.length,
      still_has_neoboard_caps: (n.approved ?? []).some((c) =>
        c.includes('net.nordeck.whiteboard'),
      ),
    });
  }
  const innerLog = await inner.evaluate(() => window.__nbcLog).catch(() => []);
  writeFileSync(join(SHOTS, 'innerlog-run1.txt'), (innerLog ?? []).join('\n'));

  // Reload: what does "remember" do?
  await caption(
    'Neu laden: Welche Dialoge erscheinen nach „Merken“? (Remember-Verhalten)',
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page
    .locator('.mx_RoomView')
    .first()
    .waitFor({ timeout: 60000 })
    .catch(() => {});
  const r0 = await capabilityDialog('10-reload-dialog-1', { timeout: 30000 });
  note('reload_dialog_1', r0 ? r0.text : 'NOT SHOWN');
  const r1 = await capabilityDialog('11-reload-dialog-2', { timeout: 20000 });
  note('reload_dialog_2', r1 ? r1.text : 'NOT SHOWN');
  const r2 = await capabilityDialog('11b-reload-dialog-3', { timeout: 10000 });
  note('reload_dialog_3', r2 ? r2.text : 'NOT SHOWN');
  const nb2 = await frameBy(NEOBOARD_URL);
  note(
    'reload_board_rendered',
    nb2
      ? await nb2
          .locator('[aria-label="Rectangle"]')
          .first()
          .waitFor({ timeout: 40000 })
          .then(() => true)
          .catch(() => false)
      : false,
  );
  const inner2 = await innerFrame();
  await inner2
    ?.locator('html[data-status="ready"]')
    .waitFor({ timeout: 40000 })
    .catch(() => {});
  note(
    'reload_inner_approved',
    await inner2?.locator('html').getAttribute('data-approved'),
  );
  note('remembered_after_reload', await rememberedCaps());
  await shot('12-after-reload');

  // Visible proof in the timeline: un-maximise (empty layout) and show hidden events.
  await caption(
    'Sichtbarer Nachweis: Timeline mit versteckten Events (ping / pong) im Raum',
  );
  await putState(bot, 'io.element.widgets.layout', '', { widgets: {} });
  await sleep(4000);
  await page
    .locator('.mx_RoomView_MessageList')
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  await shot('14-timeline-hidden-events');
  await sleep(3000);
  await caption('Ende des Spikes – Ergebnisse siehe FINDINGS', 2500);
} catch (e) {
  if (!e?.control) exitCode = 1;
  note('error', String(e?.stack ?? e).slice(0, 800));
  await shot('error').catch(() => {});
} finally {
  results.console_issues = consoleIssues;
  if (process.env.CONSOLE_DUMP)
    writeFileSync(process.env.CONSOLE_DUMP, allConsole.join('\n'));
  writeFileSync(join(SHOTS, 'results.json'), JSON.stringify(results, null, 2));
  const video = page.video();
  await ctx.close().catch(() => {});
  await browser.close().catch(() => {});
  proc.kill();
  servers.forEach((s) => s.close());
  const webm = video ? await video.path().catch(() => null) : null;
  const mp4 = env('VIDEO_MP4', join(VIDEO_DIR, 'spike.mp4'));
  if (webm) {
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      webm,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '23',
      '-movflags',
      '+faststart',
      mp4,
    ]);
    console.log('video:', mp4);
  }
  process.exit(exitCode);
}
