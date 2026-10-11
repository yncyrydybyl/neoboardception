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

/*
 * Real-browser check over three origins:
 *   client (mock Matrix client) → host widget → embedded widget.
 * Bundles the pages with esbuild, serves them on three local ports and
 * drives Chromium with playwright-core.
 *
 * playwright-core is not a dependency of this repository. Run with:
 *   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core yarn test:e2e
 * (a browser for that playwright-core version must be installed).
 */

/* global console, process, URL, window */

import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const { chromium } = await import(
  process.env.PLAYWRIGHT_CORE
    ? `${process.env.PLAYWRIGHT_CORE}/index.mjs`
    : 'playwright-core'
);

async function bundle(entry) {
  const r = await build({
    entryPoints: [`${dir}/${entry}.ts`],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  return r.outputFiles[0].text;
}

const pages = {};
for (const name of ['client', 'host', 'inner']) {
  pages[name] = await bundle(name);
}

function serve(name) {
  const server = createServer((req, res) => {
    if (req.url.startsWith('/app.js')) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(pages[name]);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>${name}</title>` +
        `<body><script type="module" src="/app.js"></script></body>`,
    );
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server)),
  );
}

const servers = await Promise.all(['client', 'host', 'inner'].map(serve));
// Distinct ports are distinct origins; the embedded widget uses `localhost`
// so that it is not even same-host with the host widget.
const [clientUrl, hostUrl, innerUrl] = servers.map(
  (s, i) =>
    `http://${i === 2 ? 'localhost' : '127.0.0.1'}:${s.address().port}/`,
);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(
    `${clientUrl}?host=${encodeURIComponent(hostUrl)}&inner=${encodeURIComponent(innerUrl)}`,
  );

  const hostFrame = () =>
    page.frames().find((f) => f.url().startsWith(hostUrl));
  const innerFrame = () =>
    page.frames().find((f) => f.url().startsWith(innerUrl));

  await page.waitForFunction(() => window.__CLIENT__?.sent.length > 0, null, {
    timeout: 15000,
  });
  await page.waitForTimeout(300);

  const client = await page.evaluate(() => window.__CLIENT__);
  const host = await hostFrame().evaluate(() => window.__HOST__);
  const inner = await innerFrame().evaluate(() => window.__INNER__);

  assert.equal(inner.error, '', 'embedded widget saw an error');
  // Upward: the vote went to the client under the host's identity.
  assert.deepEqual(
    client.sent.map((e) => e.type),
    ['net.example.vote'],
    'only the vote reached the client (the spoofed board event did not)',
  );
  assert.equal(inner.sent, client.sent[0].event_id);
  // Capability renegotiation: host round, then the embedded widget's caps.
  assert.equal(client.capabilityRounds.length, 2);
  assert.deepEqual(client.capabilityRounds[1].sort(), [
    'org.matrix.msc2762.receive.event:net.example.vote',
    'org.matrix.msc2762.send.event:net.example.vote',
  ]);
  // Downward: the echo arrived; the read went through.
  assert.deepEqual(inner.echoed, [inner.sent]);
  assert.equal(inner.read.length, 1);
  // UI states and disclosure.
  assert.deepEqual(
    [...new Set(host.states.map((s) => s.status))],
    ['loading', 'negotiating', 'ready'],
  );
  assert.equal(host.capabilityRequests.length, 1);
  // The foreign-id message was dropped by the guard.
  assert.ok(
    host.warnings.some((w) => w.message === 'blocked postMessage'),
    'spoofed message was not reported',
  );
  // The embedded widget got its own widget id and only the host origin.
  const innerSrc = new URL(innerFrame().url());
  assert.equal(innerSrc.searchParams.get('widgetId'), 'embedded-element-1');
  assert.equal(
    innerSrc.searchParams.get('parentUrl'),
    new URL(hostUrl).origin + '/',
  );
  console.log('e2e: all checks passed');
} finally {
  await browser.close();
  servers.forEach((s) => s.close());
}
