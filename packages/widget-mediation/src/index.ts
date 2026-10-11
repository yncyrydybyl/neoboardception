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

export {
  DEFAULT_ALLOWED_CAPABILITIES,
  POLL_CAPABILITIES,
  WIDGET_REGISTRATION_EVENT_TYPE,
  applyCapabilityPolicy,
  capabilityCoveredBy,
  isHardDenied,
  isNamespacedToDevice,
  isValidGlob,
} from './capabilities';
export type { CapabilityPolicy, PolicyDecision } from './capabilities';
export { LOCAL_ECHO_MARKER, mountEmbeddedWidget } from './embeddedWidget';
export {
  ALWAYS_ON_SCREEN_CAPABILITY,
  CALL_HOST_ACTIONS,
  MATRIXRTC_API_VERSIONS,
  MEDIA_PERMISSIONS,
  buildAllowAttribute,
  callMemberStateKeys,
  isMediaPermission,
  matrixRtcCapabilities,
  matrixRtcLocalCapabilities,
} from './matrixRtc';
export type {
  MatrixRtcContext,
  MatrixRtcHostEvent,
  MediaPermission,
} from './matrixRtc';
export {
  EventTypeRewriter,
  NESTED_NAMESPACE_ROOT,
  isNestedNamespaceType,
  validateEventNamespace,
} from './namespace';
export type { CapabilityRewrite, EventNamespaceMap } from './namespace';
export { configureMediation, disposeHub as disposeMediation } from './outerHub';
export {
  POLICY_LIMITS,
  decideEmbeddedWidget,
  decodeEmbeddedWidgetPolicy,
  findPolicyRule,
  parseEmbeddedWidgetPolicy,
  policyInitialCapabilities,
  policyMatchKey,
  policyOrigins,
} from './policy';
export type {
  DecideOptions,
  EmbeddedWidgetPolicy,
  EmbeddedWidgetPolicyDecision,
  EmbeddedWidgetPolicyParseResult,
  EmbeddedWidgetPolicyRule,
  InitialCapabilitiesOptions,
  UnlistedMode,
} from './policy';
export { prerequestCapabilities } from './prerequest';
export type { PrerequestCapabilitiesOptions } from './prerequest';
export type { RateLimit } from './rateLimit';
export type {
  CapabilityRequestEvent,
  CapabilityRequestInfo,
  CapabilityRequestResult,
  CapabilitySummary,
  EmbeddedWidgetErrorReason,
  EmbeddedWidgetHandle,
  EmbeddedWidgetParams,
  EmbeddedWidgetState,
  MediationConfig,
  MediationLogger,
  ModalMode,
  MountEmbeddedWidgetOptions,
  OpenIdMode,
  OuterTransport,
  OuterWidgetApi,
  SentEventInfo,
  ToDeviceMessage,
  UpdateStateMode,
} from './types';
export {
  buildWidgetUrl,
  deriveEmbeddedWidgetId,
  validateWidgetUrl,
} from './url';
