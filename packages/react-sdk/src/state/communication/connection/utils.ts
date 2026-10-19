/*
 * Copyright 2023 Nordeck IT + Consulting GmbH
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

import { PeerConnectionStatistics } from './types';

export function extractPeerConnectionStatistics(
  report: RTCStatsReport,
): Partial<PeerConnectionStatistics> {
  const stats: Partial<PeerConnectionStatistics> = {};

  const entries = [...report.values()];
  const transportReport = entries.find((e) => e.type === 'transport');
  const candidatePairReport =
    report.get(transportReport?.selectedCandidatePairId) ??
    // Fallback for Firefox.
    entries.find((e) => e.type === 'candidate-pair' && e.selected);
  const localCandidate = report.get(candidatePairReport?.localCandidateId);
  const remoteCandidate = report.get(candidatePairReport?.remoteCandidateId);

  if (candidatePairReport) {
    stats.packetsReceived = candidatePairReport.packetsReceived;
    stats.bytesReceived = candidatePairReport.bytesReceived;
    stats.packetsSent = candidatePairReport.packetsSent;
    stats.bytesSent = candidatePairReport.bytesSent;
  }

  if (localCandidate) {
    stats.localCandidateType = localCandidate.candidateType;
  }

  if (remoteCandidate) {
    stats.remoteCandidateType = remoteCandidate.candidateType;
  }

  return stats;
}

export function isImpolite(
  ownSessionId: string,
  otherSessionId: string,
): boolean {
  // The session with the higher lexical ordering is the impolite peer
  return ownSessionId > otherSessionId;
}

export function isPeerConnected(
  peerConnectionStatistics: PeerConnectionStatistics,
) {
  const dataChannelOpen = peerConnectionStatistics.dataChannelState === 'open';

  // connectionState was not implemented in Firefox until v103. We manually decide
  // it based on https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionState
  if (peerConnectionStatistics.connectionState === undefined) {
    return (
      dataChannelOpen &&
      (peerConnectionStatistics.iceConnectionState === 'connected' ||
        peerConnectionStatistics.iceConnectionState === 'completed')
    );
  }

  return (
    dataChannelOpen && peerConnectionStatistics.connectionState === 'connected'
  );
}

/**
 * Whether the peers found each other but the connection is not (or no
 * longer) up: ICE checks run or failed. A peer that never answered (e.g. a
 * session that was not cleaned up) stays in the `new` state and does not
 * count. If such a connection does not come up for a while, the network
 * between the devices probably needs a relay (TURN) server.
 */
export function isPeerConnectionAttempting(
  peerConnectionStatistics: PeerConnectionStatistics,
): boolean {
  if (isPeerConnected(peerConnectionStatistics)) {
    return false;
  }

  const { connectionState, iceConnectionState } = peerConnectionStatistics;

  return (
    connectionState === 'connecting' ||
    connectionState === 'failed' ||
    connectionState === 'disconnected' ||
    iceConnectionState === 'checking' ||
    iceConnectionState === 'failed' ||
    iceConnectionState === 'disconnected'
  );
}
