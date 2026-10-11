/*
 * NeoBoardception spike — innermost test widget (measuring instrument).
 *
 * Plain matrix-widget-api. On start it requests exactly one capability pair:
 * send + receive of the room event `net.neoboardception.ping`.
 * "Nachfordern" requests send/receive of the state event
 * `net.neoboardception.pong` at runtime (MSC2974) and then sends one.
 * Every widget-API message is logged visibly on the page.
 */
import {
  EventDirection,
  IWidgetApiRequest,
  WidgetApi,
  WidgetApiToWidgetAction,
  WidgetEventCapability,
} from 'matrix-widget-api';

const PING = 'net.neoboardception.ping';
const PONG = 'net.neoboardception.pong';

const logEl = document.getElementById('log') as HTMLPreElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const capsEl = document.getElementById('caps') as HTMLDivElement;

function log(kind: string, data?: unknown) {
  const line = `${new Date().toISOString().slice(11, 23)} ${kind}${
    data === undefined ? '' : ' ' + JSON.stringify(data)
  }`;
  logEl.textContent = line + '\n' + logEl.textContent;
  (window as unknown as { __nbcLog: string[] }).__nbcLog.push(line);
}
(window as unknown as { __nbcLog: string[] }).__nbcLog = [];

function setStatus(s: string) {
  statusEl.textContent = s;
  document.documentElement.dataset.status = s;
}

// Merge query and hash-query parameters (hosts append widgetId/parentUrl to the query).
const params = new URLSearchParams(window.location.search);
const hq = window.location.hash.indexOf('?');
if (hq >= 0)
  new URLSearchParams(window.location.hash.slice(hq + 1)).forEach(
    (v, k) => params.has(k) || params.set(k, v),
  );
const widgetId = params.get('widgetId');
const parentUrl = params.get('parentUrl');
let targetOrigin = '*';
try {
  if (parentUrl) targetOrigin = new URL(parentUrl).origin;
} catch {
  /* keep * */
}

// Log every raw message arriving from the host (requests + responses).
window.addEventListener('message', (ev) => {
  if (ev.source !== window.parent) return;
  const d = ev.data as {
    api?: string;
    action?: string;
    response?: unknown;
    data?: unknown;
  };
  if (!d || typeof d !== 'object' || !d.action) return;
  log(
    `⇐ ${d.api}:${d.action}${d.response !== undefined ? ' (response)' : ''}`,
    d.response ?? d.data,
  );
});

let approved: string[] = [];
function renderCaps() {
  capsEl.textContent = approved.length ? approved.join('\n') : '(keine)';
  document.documentElement.dataset.approved = approved.join(' ');
}

if (!widgetId) {
  setStatus('standalone (kein widgetId) — nichts zu tun');
} else {
  const api = new WidgetApi(widgetId, targetOrigin);
  // Log outgoing requests.
  const origSend = api.transport.send.bind(api.transport);
  api.transport.send = ((action: string, data: unknown) => {
    log(`⇒ fromWidget:${action}`, data);
    return origSend(action as never, data as never);
  }) as typeof api.transport.send;

  api.requestCapabilityToSendEvent(PING);
  api.requestCapabilityToReceiveEvent(PING);

  api.on(
    `action:${WidgetApiToWidgetAction.NotifyCapabilities}`,
    (ev: CustomEvent<IWidgetApiRequest>) => {
      const d = ev.detail.data as { approved?: string[]; requested?: string[] };
      approved = d.approved ?? [];
      renderCaps();
      log('notify_capabilities', d);
    },
  );
  api.on(
    `action:${WidgetApiToWidgetAction.SendEvent}`,
    (ev: CustomEvent<IWidgetApiRequest>) => {
      ev.preventDefault();
      api.transport.reply(ev.detail, {});
      const e = ev.detail.data as {
        type?: string;
        event_id?: string;
        sender?: string;
      };
      const n = document.getElementById('received') as HTMLDivElement;
      n.textContent =
        `${e.type} ${e.event_id} von ${e.sender}\n` + n.textContent;
    },
  );
  api.on('ready', () => {
    setStatus('ready');
    log('ready');
  });
  api.start();
  setStatus('handshake…');

  const send = document.getElementById('send') as HTMLButtonElement;
  const more = document.getElementById('more') as HTMLButtonElement;
  const pong = document.getElementById('pong') as HTMLButtonElement;
  const result = document.getElementById('result') as HTMLDivElement;
  const show = (s: string) => {
    result.textContent = s;
    document.documentElement.dataset.result = s;
  };

  send.onclick = async () => {
    try {
      const r = await api.sendRoomEvent(PING, {
        body: 'ping from nested widget',
        ts: Date.now(),
      });
      show(`ping gesendet: ${r.event_id}`);
    } catch (e) {
      show(`ping FEHLER: ${String((e as Error)?.message ?? e)}`);
    }
  };

  more.onclick = async () => {
    const sendCap = WidgetEventCapability.forStateEvent(
      EventDirection.Send,
      PONG,
      '',
    ).raw;
    show('Nachforderung läuft (MSC2974)…');
    const notified = new Promise<string[]>((resolve) => {
      const h = (ev: CustomEvent<IWidgetApiRequest>) => {
        api.off(`action:${WidgetApiToWidgetAction.NotifyCapabilities}`, h);
        resolve((ev.detail.data as { approved?: string[] }).approved ?? []);
      };
      api.on(`action:${WidgetApiToWidgetAction.NotifyCapabilities}`, h);
    });
    try {
      api.requestCapabilityToSendState(PONG, '');
      api.requestCapabilityToReceiveState(PONG, '');
      await api.updateRequestedCapabilities();
      const ok = (await notified).includes(sendCap);
      show(
        ok
          ? 'Nachforderung genehmigt — sende pong…'
          : 'Nachforderung ABGELEHNT',
      );
      if (ok) await sendPong();
    } catch (e) {
      show(`Nachforderung FEHLER: ${String((e as Error)?.message ?? e)}`);
    }
  };

  async function sendPong() {
    try {
      const r = await api.sendStateEvent(PONG, '', {
        body: 'pong via MSC2974',
        ts: Date.now(),
      });
      show(`pong (state) gesendet: ${r.event_id}`);
    } catch (e) {
      show(`pong FEHLER: ${String((e as Error)?.message ?? e)}`);
    }
  }
  pong.onclick = sendPong;
}
renderCaps();
