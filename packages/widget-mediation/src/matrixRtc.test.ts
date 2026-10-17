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

import { afterEach, describe, expect, it } from 'vitest';
import { applyCapabilityPolicy, isHardDenied } from './capabilities';
import { mountEmbeddedWidget } from './embeddedWidget';
import {
  buildAllowAttribute,
  callMemberStateKeys,
  matrixRtcCapabilities,
  MatrixRtcHostEvent,
} from './matrixRtc';
import { configureMediation } from './outerHub';
import {
  decideEmbeddedWidget,
  parseEmbeddedWidgetPolicy,
  policyInitialCapabilities,
} from './policy';
import { FakeInnerWidget } from './testing/fakeInnerWidget';
import { FakeOuterApi } from './testing/fakeOuterApi';
import type { EmbeddedWidgetHandle, MountEmbeddedWidgetOptions } from './types';

const ORIGIN = 'https://call.example';
const ROOM = '!room:example.org';
const USER = '@alice:example.org';
const DEVICE = 'DEVICEA';
const ctx = { userId: USER, deviceId: DEVICE, roomId: ROOM };
const params = { userId: USER, roomId: ROOM, deviceId: DEVICE, theme: 'light' };

const MEMBER = 'org.matrix.msc3401.call.member';
const OWN_MEMBER_KEY = `_${USER}_${DEVICE}_m.call`;
const SEND_OWN_MEMBER = `org.matrix.msc2762.send.state_event:${MEMBER}#${OWN_MEMBER_KEY}`;
const RECEIVE_MEMBER = `org.matrix.msc2762.receive.state_event:${MEMBER}`;
const KEYS = 'io.element.call.encryption_keys';
const SEND_KEYS_TD = `org.matrix.msc3819.send.to_device:${KEYS}`;
const RECEIVE_KEYS_TD = `org.matrix.msc3819.receive.to_device:${KEYS}`;
const DELAYED = 'org.matrix.msc4157.send.delayed_event';
const UPDATE_DELAYED = 'org.matrix.msc4157.update_delayed_event';
const TRANSPORTS = 'org.matrix.msc4515.rtc_transports';
const AOS = 'm.always_on_screen';

/** Roughly what Element Call requests (subset). */
const CALL_CAPS = [
  AOS,
  `org.matrix.msc2762.timeline:${ROOM}`,
  'org.matrix.msc2762.timeline:!other:example.org',
  'org.matrix.msc4039.download_file',
  SEND_OWN_MEMBER,
  `org.matrix.msc2762.send.state_event:${MEMBER}#@bob:example.org`,
  RECEIVE_MEMBER,
  'org.matrix.msc2762.receive.state_event:m.room.member',
  SEND_KEYS_TD,
  RECEIVE_KEYS_TD,
  DELAYED,
  UPDATE_DELAYED,
  TRANSPORTS,
  'org.matrix.msc2762.send.event:m.room.redaction',
];

const handles: EmbeddedWidgetHandle[] = [];
afterEach(() => {
  handles.splice(0).forEach((h) => h.destroy());
});

async function waitFor(check: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

function makeOuter() {
  const outer = new FakeOuterApi([
    'org.matrix.msc2762.receive.state_event:m.room.member',
  ]);
  configureMediation(outer, { capabilityBatchMs: 0 });
  return outer;
}

async function mountCall(
  outer: FakeOuterApi,
  overrides: Partial<MountEmbeddedWidgetOptions> = {},
  innerCaps: string[] = CALL_CAPS,
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const events: MatrixRtcHostEvent[] = [];
  const handle = mountEmbeddedWidget({
    container,
    widgetUrl: `${ORIGIN}/room`,
    widgetId: 'call-1',
    outerApi: outer,
    allowedOrigins: [ORIGIN],
    params,
    allowedCapabilities: [],
    matrixRtc: true,
    mediaPermissions: ['camera', 'microphone'],
    echoFallbackMs: 0,
    onMatrixRtcEvent: (e) => events.push(e),
    ...overrides,
  });
  handles.push(handle);
  const inner = new FakeInnerWidget(handle.iframe!, handle.widgetId, {
    capabilities: innerCaps,
  });
  inner.load();
  await waitFor(() => ['ready', 'error'].includes(handle.getState().status));
  return { handle, inner, events, container };
}

function upward(outer: FakeOuterApi, action: string) {
  return outer.transport.send.mock.calls.filter((c) => c[0] === action);
}

describe('matrixRtc helpers', () => {
  it('scopes membership state keys to the own user and device', () => {
    expect(callMemberStateKeys(ctx)).toEqual([
      USER,
      `_${USER}_${DEVICE}`,
      `_${USER}_${DEVICE}_m.call`,
      `${USER}_${DEVICE}`,
      `${USER}_${DEVICE}_m.call`,
    ]);
    expect(callMemberStateKeys({ userId: USER })).toEqual([USER]);
    expect(callMemberStateKeys({ userId: '' })).toEqual([]);
  });

  it('never includes TURN, other rooms, downloads or redactions', () => {
    const caps = matrixRtcCapabilities(ctx);
    expect(caps).toContain(SEND_OWN_MEMBER);
    expect(caps).toContain(SEND_KEYS_TD);
    expect(caps).toContain(TRANSPORTS);
    expect(caps).not.toContain(AOS); // local, never asked upstream
    for (const c of caps) {
      expect(c).not.toMatch(
        /timeline:|msc3846|msc4039|m\.room\.redaction|widgets|power_levels/,
      );
    }
  });

  it('builds the allow attribute from known features only', () => {
    expect(
      buildAllowAttribute(['microphone', 'geolocation', 'camera', 'camera']),
    ).toBe('camera; microphone');
    expect(buildAllowAttribute([])).toBe('');
    expect(buildAllowAttribute(['fullscreen', 'camera'])).toBe(
      'camera; fullscreen',
    );
  });

  it('lifts the hard deny-list for exactly the listed strings', () => {
    const rtc = matrixRtcCapabilities(ctx);
    const other = `org.matrix.msc2762.send.state_event:${MEMBER}#@bob:example.org`;
    expect(isHardDenied(SEND_OWN_MEMBER)).toBe(true);
    expect(
      applyCapabilityPolicy([SEND_OWN_MEMBER, other], {
        allowed: [...rtc, other],
        denied: [],
        lifted: rtc,
      }),
    ).toEqual({ allowed: [SEND_OWN_MEMBER], blocked: [other] });
    // Without the lift nothing changes.
    expect(
      applyCapabilityPolicy([SEND_OWN_MEMBER], { allowed: rtc, denied: [] })
        .allowed,
    ).toEqual([]);
    // Configured denials still win.
    expect(
      applyCapabilityPolicy([SEND_OWN_MEMBER], {
        allowed: rtc,
        denied: ['org.matrix.msc2762.send.state_event:org.matrix.msc3401*'],
        lifted: rtc,
      }).allowed,
    ).toEqual([]);
  });
});

describe('operator policy: matrixrtc and media_permissions', () => {
  const policyWith = (rule: unknown) =>
    parseEmbeddedWidgetPolicy({
      widget_permissions: { 'https://call.example/room': rule },
    });

  it('is off by default', () => {
    const r = policyWith({});
    expect(r.ok && r.policy.rules[0]).toMatchObject({
      matrixRtc: false,
      mediaPermissions: [],
    });
  });

  it('parses the opt-in and the media features', () => {
    const r = policyWith({
      matrixrtc: true,
      media_permissions: ['camera', 'microphone', 'camera'],
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
    if (!r.ok) return;
    expect(
      decideEmbeddedWidget(r.policy, 'https://call.example/room#?x=1'),
    ).toMatchObject({
      allowed: true,
      matrixRtc: true,
      mediaPermissions: ['camera', 'microphone'],
    });
  });

  it('accepts fullscreen without matrixrtc and without a warning', () => {
    const r = policyWith({ media_permissions: ['fullscreen'] });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
    if (!r.ok) return;
    expect(
      decideEmbeddedWidget(r.policy, 'https://call.example/room'),
    ).toMatchObject({
      allowed: true,
      matrixRtc: false,
      mediaPermissions: ['fullscreen'],
    });
  });

  it('fails closed on unknown media features and wrong types', () => {
    expect(policyWith({ media_permissions: ['geolocation'] }).ok).toBe(false);
    expect(policyWith({ media_permissions: 'camera' }).ok).toBe(false);
    expect(policyWith({ matrixrtc: 'yes' }).ok).toBe(false);
  });

  it('warns about a call without camera or microphone', () => {
    const r = policyWith({ matrixrtc: true });
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/cannot capture media/);
  });

  it('adds call capabilities to the initial union only with a user context', () => {
    const r = policyWith({ matrixrtc: true, media_permissions: ['camera'] });
    if (!r.ok) throw new Error('invalid');
    expect(policyInitialCapabilities(r.policy)).toEqual([]);
    const union = policyInitialCapabilities(r.policy, { matrixRtc: ctx });
    expect(union).toContain(SEND_OWN_MEMBER);
    expect(union).toEqual(matrixRtcCapabilities(ctx));
  });
});

describe('mediation of a MatrixRTC widget', () => {
  it('grants the call capabilities only with the opt-in', async () => {
    const outer = makeOuter();
    const off = await mountCall(outer, { matrixRtc: false, widgetId: 'c0' });
    // m.room.member is not on the (empty) allow-list either: nothing granted.
    expect(off.handle.getState().status).toBe('error');
    expect(outer.renegotiations).toEqual([]);

    const on = await mountCall(outer);
    expect(on.handle.getState().status).toBe('ready');
    expect(on.inner.approved).toEqual(
      expect.arrayContaining([
        AOS,
        SEND_OWN_MEMBER,
        RECEIVE_MEMBER,
        SEND_KEYS_TD,
        RECEIVE_KEYS_TD,
        DELAYED,
        UPDATE_DELAYED,
        TRANSPORTS,
      ]),
    );
    const asked = outer.renegotiations.flat();
    // Another user's membership, other rooms, downloads, redactions: never.
    const never = [
      `org.matrix.msc2762.send.state_event:${MEMBER}#@bob:example.org`,
      'org.matrix.msc2762.timeline:!other:example.org',
      'org.matrix.msc4039.download_file',
      'org.matrix.msc2762.send.event:m.room.redaction',
    ];
    for (const c of never) {
      expect(asked).not.toContain(c);
      expect(on.inner.approved).not.toContain(c);
    }
    // Granted locally, never asked upstream.
    expect(asked).not.toContain(AOS);
    expect(asked).not.toContain(`org.matrix.msc2762.timeline:${ROOM}`);
    expect(on.inner.approved).toContain(`org.matrix.msc2762.timeline:${ROOM}`);
  });

  it('sets the allow attribute and advertises the RTC API versions', async () => {
    const outer = makeOuter();
    const m = await mountCall(outer);
    expect(m.handle.iframe?.getAttribute('allow')).toBe('camera; microphone');
    expect(m.inner.clientVersions).toEqual(
      expect.arrayContaining([
        'org.matrix.msc3819',
        'org.matrix.msc4157',
        'org.matrix.msc4515',
      ]),
    );
  });

  it('delegates fullscreen to a non-call widget when the policy grants it', async () => {
    const outer = makeOuter();
    const m = await mountCall(outer, {
      matrixRtc: false,
      mediaPermissions: ['fullscreen'],
    });
    expect(m.handle.iframe?.getAttribute('allow')).toBe('fullscreen');
    expect(m.inner.clientVersions).not.toContain('org.matrix.msc3819');
  });

  it('keeps the empty allow attribute and versions for other widgets', async () => {
    const outer = makeOuter();
    const m = await mountCall(outer, {
      matrixRtc: false,
      mediaPermissions: undefined,
    });
    expect(m.handle.iframe?.getAttribute('allow')).toBe('');
    expect(m.inner.clientVersions).not.toContain('org.matrix.msc3819');
  });

  it('forwards delayed membership events and restarts only own delay ids', async () => {
    const outer = makeOuter();
    let n = 0;
    outer.handlers['send_event'] = (d) =>
      d.delay !== undefined
        ? { room_id: ROOM, delay_id: `syd_${++n}` }
        : { room_id: ROOM, event_id: `$e${++n}` };
    outer.handlers['org.matrix.msc4157.update_delayed_event'] = () => ({});
    const m = await mountCall(outer);

    const r = await m.inner.request('send_event', {
      type: MEMBER,
      state_key: OWN_MEMBER_KEY,
      content: {},
      delay: 90000,
    });
    expect(r).toEqual({ room_id: ROOM, delay_id: 'syd_1' });
    expect(upward(outer, 'send_event').at(-1)?.[1]).toEqual({
      type: MEMBER,
      content: {},
      state_key: OWN_MEMBER_KEY,
      delay: 90000,
    });

    expect(
      await m.inner.request('org.matrix.msc4157.update_delayed_event', {
        action: 'restart',
        delay_id: 'syd_1',
      }),
    ).toEqual({});
    const foreign = await m.inner.request(
      'org.matrix.msc4157.update_delayed_event',
      { action: 'cancel', delay_id: 'syd_host' },
    );
    expect(foreign.error).toBeDefined();
    expect(upward(outer, 'org.matrix.msc4157.update_delayed_event')).toEqual([
      [
        'org.matrix.msc4157.update_delayed_event',
        { action: 'restart', delay_id: 'syd_1' },
      ],
    ]);
  });

  it("refuses another device's membership state", async () => {
    const outer = makeOuter();
    const m = await mountCall(outer);
    const r = await m.inner.request('send_event', {
      type: MEMBER,
      state_key: `_@bob:example.org_OTHER_m.call`,
      content: {},
    });
    expect(r.error).toBeDefined();
    expect(upward(outer, 'send_event')).toEqual([]);
  });

  it('sends the delayed leave immediately when the widget is torn down', async () => {
    const outer = makeOuter();
    outer.handlers['send_event'] = () => ({ room_id: ROOM, delay_id: 'syd_9' });
    outer.handlers['org.matrix.msc4157.update_delayed_event'] = () => ({});
    const m = await mountCall(outer);
    await m.inner.request('send_event', {
      type: MEMBER,
      state_key: OWN_MEMBER_KEY,
      content: {},
      delay: 90000,
    });
    m.handle.destroy();
    await tick();
    expect(upward(outer, 'org.matrix.msc4157.update_delayed_event')).toEqual([
      [
        'org.matrix.msc4157.update_delayed_event',
        { action: 'send', delay_id: 'syd_9' },
      ],
    ]);
  });

  it('forwards to-device messages in both directions, filtered by grants', async () => {
    const outer = makeOuter();
    outer.handlers['send_to_device'] = () => ({});
    const m = await mountCall(outer);
    const messages = { '@bob:example.org': { BOBDEV: { keys: [] } } };
    expect(
      await m.inner.request('send_to_device', {
        type: KEYS,
        encrypted: true,
        messages,
      }),
    ).toEqual({});
    expect(upward(outer, 'send_to_device')).toEqual([
      ['send_to_device', { type: KEYS, encrypted: true, messages }],
    ]);

    outer.toWidget('send_to_device', {
      type: KEYS,
      sender: '@bob:example.org',
      content: { keys: [1] },
      encrypted: true,
    });
    outer.toWidget('send_to_device', {
      type: 'net.nordeck.whiteboard.connection',
      sender: '@bob:example.org',
      content: {},
    });
    await tick();
    const got = m.inner.received_('send_to_device');
    expect(got).toHaveLength(1);
    expect(got[0].data).toMatchObject({
      type: KEYS,
      sender: '@bob:example.org',
      encrypted: true,
    });
  });

  it('never forwards to-device to widgets without the opt-in', async () => {
    const outer = makeOuter();
    outer.handlers['send_to_device'] = () => ({});
    const m = await mountCall(
      outer,
      {
        matrixRtc: false,
        allowedCapabilities: [SEND_KEYS_TD, RECEIVE_KEYS_TD, RECEIVE_MEMBER],
      },
      [SEND_KEYS_TD, RECEIVE_KEYS_TD, RECEIVE_MEMBER],
    );
    expect(m.inner.approved).toEqual([]);
    outer.toWidget('send_to_device', {
      type: KEYS,
      sender: '@bob:example.org',
      content: {},
    });
    await tick();
    expect(m.inner.received_('send_to_device')).toEqual([]);
  });

  it('answers rtc_transports through the outer client', async () => {
    const outer = makeOuter();
    const transports = [
      { type: 'livekit', livekit_service_url: 'https://rtc.example' },
      'garbage',
    ];
    outer.handlers['org.matrix.msc4515.get_rtc_transports'] = () => ({
      rtc_transports: transports,
    });
    const m = await mountCall(outer);
    expect(
      await m.inner.request('org.matrix.msc4515.get_rtc_transports', {}),
    ).toEqual({ rtc_transports: [transports[0]] });
  });

  it('acknowledges host actions and reports always-on-screen', async () => {
    const outer = makeOuter();
    const m = await mountCall(outer);
    expect(await m.inner.request('io.element.join', {})).toEqual({});
    expect(
      await m.inner.request('set_always_on_screen', { value: true }),
    ).toEqual({});
    expect(
      await m.inner.request('io.element.device_mute', {
        audio_enabled: false,
        video_enabled: true,
      }),
    ).toEqual({});
    expect(await m.inner.request('im.vector.hangup', {})).toEqual({});
    expect(m.events).toEqual([
      { kind: 'joined' },
      { kind: 'always-on-screen', value: true },
      { kind: 'device-mute', audio: false, video: true },
      { kind: 'hung-up' },
    ]);
    // None of it reaches the outer client.
    expect(
      outer.transport.send.mock.calls.filter((c) =>
        /io\.element|im\.vector|always_on_screen/.test(String(c[0])),
      ),
    ).toEqual([]);
  });

  it('refuses always-on-screen when the user did not consent to it', async () => {
    const outer = makeOuter();
    const m = await mountCall(outer, {
      confirmCapabilities: async (req) =>
        req.capabilities.filter((c) => c !== AOS),
    });
    const r = await m.inner.request('set_always_on_screen', { value: true });
    expect(r.error).toBeDefined();
    expect(m.events).toEqual([]);
  });

  it('never pauses event delivery of a call', async () => {
    const outer = makeOuter();
    const m = await mountCall(outer);
    m.handle.setPaused(true);
    outer.toWidget('send_event', {
      type: MEMBER,
      state_key: '_@bob:example.org_B_m.call',
      content: {},
      event_id: '$m1',
      room_id: ROOM,
      sender: '@bob:example.org',
      origin_server_ts: 1,
    });
    await tick();
    expect(m.inner.received_('send_event')).toHaveLength(1);
  });

  it('accepts the own room named explicitly (matrix-js-sdk widget client)', async () => {
    const outer = makeOuter();
    outer.handlers['send_event'] = () => ({ room_id: ROOM, delay_id: 'd1' });
    const m = await mountCall(outer);
    const r = await m.inner.request('send_event', {
      type: MEMBER,
      state_key: OWN_MEMBER_KEY,
      content: {},
      delay: 1000,
      room_id: ROOM,
    });
    expect(r).toEqual({ room_id: ROOM, delay_id: 'd1' });
    // The own room is implicit upward.
    expect(upward(outer, 'send_event')[0][1]).not.toHaveProperty('room_id');
  });

  it('rejects RTC requests for another room', async () => {
    const outer = makeOuter();
    outer.handlers['send_event'] = () => ({ room_id: ROOM, delay_id: 'x' });
    const m = await mountCall(outer);
    const r = await m.inner.request('send_event', {
      type: MEMBER,
      state_key: OWN_MEMBER_KEY,
      content: {},
      delay: 1000,
      room_id: '!other:example.org',
    });
    expect(r.error).toBeDefined();
    expect(upward(outer, 'send_event')).toEqual([]);
  });
});
