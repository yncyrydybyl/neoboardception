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

/**
 * MatrixRTC calls (e.g. Element Call) as embedded widgets: an explicit,
 * per-widget opt-in of the operator. Off by default.
 *
 * Pure data and helpers, no DOM, no network, so the operator policy can use
 * it without loading the mediator. Nothing here grants anything by itself:
 * the mediator lifts the hard deny-list only for the exact strings returned
 * by {@link matrixRtcCapabilities}, only for a widget mounted with
 * `matrixRtc`, and the outer client still has to approve them.
 */

/** Who the call membership belongs to: the host's user and device. */
export interface MatrixRtcContext {
  userId: string;
  /** Device of the outer client. Without it no membership can be sent. */
  deviceId?: string;
  roomId: string;
}

/**
 * Permission-policy features an operator may delegate to an embedded widget
 * (`media_permissions`). Element gives a room widget `camera; microphone;
 * display-capture; autoplay; encrypted-media; clipboard-*` plus
 * `allowfullscreen`; nothing beyond that can be delegated further anyway.
 * `fullscreen` lets e.g. an embedded board use its own fullscreen mode
 * (`requestFullscreen()` still needs a user gesture in the widget).
 */
export const MEDIA_PERMISSIONS = Object.freeze([
  'camera',
  'microphone',
  'display-capture',
  'autoplay',
  'encrypted-media',
  'clipboard-write',
  'clipboard-read',
  'fullscreen',
] as const);

export type MediaPermission = (typeof MEDIA_PERMISSIONS)[number];

export function isMediaPermission(value: unknown): value is MediaPermission {
  return (
    typeof value === 'string' &&
    (MEDIA_PERMISSIONS as readonly string[]).includes(value)
  );
}

/**
 * The iframe `allow` attribute for the given features. Unknown entries are
 * dropped, the order is fixed (independent of the input).
 */
export function buildAllowAttribute(features: readonly string[]): string {
  return MEDIA_PERMISSIONS.filter((f) => features.includes(f)).join('; ');
}

const SEND_EVENT = 'org.matrix.msc2762.send.event:';
const RECEIVE_EVENT = 'org.matrix.msc2762.receive.event:';
const SEND_STATE = 'org.matrix.msc2762.send.state_event:';
const RECEIVE_STATE = 'org.matrix.msc2762.receive.state_event:';
const SEND_TO_DEVICE = 'org.matrix.msc3819.send.to_device:';
const RECEIVE_TO_DEVICE = 'org.matrix.msc3819.receive.to_device:';

/** Call membership state (MSC3401 legacy and MSC4143 session form). */
export const CALL_MEMBER_EVENT_TYPE = 'org.matrix.msc3401.call.member';

/** Room events a call sends and receives. */
const CALL_ROOM_EVENTS = [
  // per-participant key distribution via room events (legacy)
  'io.element.call.encryption_keys',
  // MSC4143 membership as (sticky) room event
  'org.matrix.msc4143.rtc.member',
  'm.rtc.member',
  // MSC4310 decline
  'org.matrix.msc4310.rtc.decline',
  'm.rtc.decline',
];
/** Room events a call only sends (MSC4075 ringing/notification). */
const CALL_NOTIFY_EVENTS = [
  'org.matrix.msc4075.call.notify',
  'org.matrix.msc4075.rtc.notification',
  'm.rtc.notification',
];
/** Room state a call reads. */
const CALL_RECEIVE_STATE = [
  CALL_MEMBER_EVENT_TYPE,
  'org.matrix.msc3401.call',
  'org.matrix.msc4143.rtc.slot',
  'm.room.encryption',
  'm.room.create',
  'm.room.name',
  'm.room.member',
];
/** To-device messages of a call (signalling, per-participant keys). */
export const CALL_TO_DEVICE_TYPES = Object.freeze([
  'm.call.invite',
  'm.call.candidates',
  'm.call.answer',
  'm.call.hangup',
  'm.call.reject',
  'm.call.select_answer',
  'm.call.negotiate',
  'm.call.sdp_stream_metadata_changed',
  'org.matrix.call.sdp_stream_metadata_changed',
  'm.call.replaces',
  'io.element.call.encryption_keys',
]);

export const DELAYED_EVENT_CAPABILITY = 'org.matrix.msc4157.send.delayed_event';
export const UPDATE_DELAYED_EVENT_CAPABILITY =
  'org.matrix.msc4157.update_delayed_event';
export const SEND_STICKY_CAPABILITY = 'org.matrix.msc4407.send.sticky_event';
export const RECEIVE_STICKY_CAPABILITY =
  'org.matrix.msc4407.receive.sticky_event';
export const RTC_TRANSPORTS_CAPABILITY = 'org.matrix.msc4515.rtc_transports';

/** Non-event capabilities of a call. */
const CALL_API_CAPABILITIES = [
  DELAYED_EVENT_CAPABILITY,
  UPDATE_DELAYED_EVENT_CAPABILITY,
  SEND_STICKY_CAPABILITY,
  RECEIVE_STICKY_CAPABILITY,
  RTC_TRANSPORTS_CAPABILITY,
];

export const ALWAYS_ON_SCREEN_CAPABILITY = 'm.always_on_screen';

/**
 * Granted by the mediator itself, never requested from the outer client:
 *
 * - `m.always_on_screen` means "keep this widget running" (the host pins it
 *   instead of evicting or pausing it);
 * - `timeline:<host room>`: matrix-js-sdk's widget client names its room
 *   explicitly on every request, which the Widget API only accepts with a
 *   timeline capability for that room. The host's own room only; what the
 *   widget may read or send there is still decided by its event
 *   capabilities, and other rooms stay closed.
 */
export function matrixRtcLocalCapabilities({
  roomId,
}: Pick<MatrixRtcContext, 'roomId'>): string[] {
  return [
    ALWAYS_ON_SCREEN_CAPABILITY,
    ...(roomId ? [`org.matrix.msc2762.timeline:${roomId}`] : []),
  ];
}

/**
 * State keys under which a call may publish the membership of *this* user
 * and device: the legacy per-user key and the MSC4143 session keys (with and
 * without leading underscore, with and without the application suffix).
 * Other users' or devices' keys are never included.
 */
export function callMemberStateKeys({
  userId,
  deviceId,
}: Pick<MatrixRtcContext, 'userId' | 'deviceId'>): string[] {
  if (!userId) return [];
  const keys = [userId];
  if (deviceId) {
    keys.push(
      `_${userId}_${deviceId}`,
      `_${userId}_${deviceId}_m.call`,
      `${userId}_${deviceId}`,
      `${userId}_${deviceId}_m.call`,
    );
  }
  return keys;
}

/**
 * Every capability a MatrixRTC call widget may get when the operator opted
 * in, scoped to the host's own user and device. Mirrors what Element grants
 * its own call widget, minus TURN (`town.robin.msc3846`), other rooms
 * (`timeline:`), media download (MSC4039), reactions and redactions.
 */
export function matrixRtcCapabilities(ctx: MatrixRtcContext): string[] {
  return [
    ...callMemberStateKeys(ctx).map(
      (key) => `${SEND_STATE}${CALL_MEMBER_EVENT_TYPE}#${key}`,
    ),
    ...CALL_RECEIVE_STATE.map((t) => `${RECEIVE_STATE}${t}`),
    ...CALL_ROOM_EVENTS.map((t) => `${SEND_EVENT}${t}`),
    ...CALL_NOTIFY_EVENTS.map((t) => `${SEND_EVENT}${t}`),
    ...CALL_ROOM_EVENTS.map((t) => `${RECEIVE_EVENT}${t}`),
    ...CALL_TO_DEVICE_TYPES.map((t) => `${SEND_TO_DEVICE}${t}`),
    ...CALL_TO_DEVICE_TYPES.map((t) => `${RECEIVE_TO_DEVICE}${t}`),
    ...CALL_API_CAPABILITIES,
  ];
}

/**
 * Widget API versions the mediator additionally advertises to a call
 * widget: to-device (MSC3819), delayed events (MSC4157), sticky events
 * (MSC4407) and RTC transports (MSC4515).
 */
export const MATRIXRTC_API_VERSIONS = Object.freeze([
  'org.matrix.msc3819',
  'org.matrix.msc4157',
  'org.matrix.msc4407',
  'org.matrix.msc4515',
]);

/**
 * Element Call's host actions (from-widget). The mediator acknowledges them
 * and reports them to the host; it never forwards them to the outer client,
 * which would apply them to its own call.
 */
export const CALL_HOST_ACTIONS = Object.freeze({
  join: 'io.element.join',
  hangup: 'im.vector.hangup',
  close: 'io.element.close',
  deviceMute: 'io.element.device_mute',
  tileLayout: 'io.element.tile_layout',
  spotlightLayout: 'io.element.spotlight_layout',
});

export type CallHostAction = keyof typeof CALL_HOST_ACTIONS;

/** What a call widget told its host. */
export type MatrixRtcHostEvent =
  | { kind: 'joined' }
  | { kind: 'hung-up' }
  | { kind: 'close' }
  | { kind: 'always-on-screen'; value: boolean }
  | { kind: 'device-mute'; audio?: boolean; video?: boolean }
  | { kind: 'layout'; layout: 'tile' | 'spotlight' };
