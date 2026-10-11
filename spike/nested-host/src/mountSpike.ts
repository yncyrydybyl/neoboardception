/*
 * NeoBoardception spike — overlay that hosts ONE inner widget on top of the
 * board. Compiled in only for spike builds (VITE_NBC_SPIKE_INNER_ORIGINS) and
 * activated only when the NeoBoard widget URL carries
 * `nbc_inner=<https url of the inner widget>` whose origin is on the
 * build-time allow-list. Room members can set the URL, so the allow-list —
 * not the URL — decides what may run.
 */

import { mountNestedWidget, OuterWidgetApi } from './nestedHost';

/** Minimal shape of the toolkit WidgetApi we need (structural typing). */
interface ToolkitWidgetApiLike {
  matrixWidgetApi: unknown;
  widgetParameters: { roomId?: string; userId?: string; clientTheme?: string };
}

export function getInnerWidgetUrl(): string | undefined {
  const fromSearch = new URLSearchParams(window.location.search).get(
    'nbc_inner',
  );
  if (fromSearch) return fromSearch;
  const hash = window.location.hash;
  const q = hash.indexOf('?');
  if (q >= 0)
    return new URLSearchParams(hash.slice(q + 1)).get('nbc_inner') ?? undefined;
  return undefined;
}

export async function maybeMountNeoBoardceptionSpike(
  widgetApiPromise: Promise<unknown>,
  allowedOrigins: string[],
): Promise<void> {
  const innerUrl = getInnerWidgetUrl();
  if (!innerUrl) return;
  let origin: string;
  try {
    const parsed = new URL(innerUrl);
    if (parsed.protocol !== 'https:') throw new Error('not https');
    origin = parsed.origin;
  } catch {
    console.warn('[nbc-spike] inner widget URL must be an https URL, ignoring');
    return;
  }
  if (!allowedOrigins.map((o) => o.trim()).includes(origin)) {
    console.warn('[nbc-spike] inner widget origin not allowed, ignoring');
    return;
  }
  if (origin === window.location.origin) {
    console.warn("[nbc-spike] inner widget must not share NeoBoard's origin");
    return;
  }
  // WidgetApiImpl exposes the raw matrix-widget-api instance as `matrixWidgetApi`.
  const api = (await widgetApiPromise) as ToolkitWidgetApiLike;
  const outer = api.matrixWidgetApi as OuterWidgetApi & {
    approvedCapabilities?: string[];
  };
  const { roomId, userId, clientTheme } = api.widgetParameters;
  if (!roomId || !userId) return;

  const panel = document.createElement('div');
  panel.id = 'nbc-spike-panel';
  panel.style.cssText =
    'position:fixed;right:12px;bottom:12px;width:460px;height:470px;z-index:2147483000;' +
    'display:flex;flex-direction:column;background:#fff;border:2px solid #7b1fa2;' +
    'border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.3);font:12px system-ui,sans-serif;overflow:hidden';
  const header = document.createElement('div');
  header.style.cssText =
    'background:#7b1fa2;color:#fff;padding:4px 8px;font-weight:600';
  header.textContent = 'NeoBoardception-Spike: eingebettetes Widget (Ebene 3)';
  const body = document.createElement('div');
  body.style.cssText = 'flex:1 1 auto;min-height:0';
  const log = document.createElement('pre');
  log.id = 'nbc-spike-hostlog';
  log.style.cssText =
    'margin:0;height:90px;overflow:auto;background:#f3e5f5;color:#311b92;padding:4px;font-size:10px;white-space:pre-wrap;border-top:1px solid #7b1fa2';
  panel.append(header, body, log);
  document.body.appendChild(panel);

  const write = (msg: string, data?: unknown) => {
    const line = `[host ${new Date().toISOString().slice(11, 19)}] ${msg}${
      data === undefined ? '' : ' ' + JSON.stringify(data)
    }`;
    console.log('[nbc-spike]', line);
    log.textContent += line + '\n';
    log.scrollTop = log.scrollHeight;
  };

  const handle = mountNestedWidget(body, {
    outer,
    outerInitiallyApproved: outer.approvedCapabilities ?? [],
    roomId,
    userId,
    theme: clientTheme,
    innerWidgetUrl: innerUrl,
    log: write,
    // NeoBoard's own namespace: never hand these to the inner widget.
    denyPrefixes: [
      'net.nordeck.whiteboard',
      'send.state_event:m.room.power_levels',
    ],
  });
  (window as unknown as { __nbcSpike?: unknown }).__nbcSpike = handle;
  write('inner widget mounted', { url: innerUrl.replace(/[?#].*$/, '') });
}
