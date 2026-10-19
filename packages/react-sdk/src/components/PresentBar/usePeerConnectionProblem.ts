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

import { useEffect, useRef, useState } from 'react';
import { isMatrixRtcMode } from '../../lib';
import { useActiveWhiteboardInstanceStatistics } from '../../state';
import {
  CommunicationChannelStatistics,
  isPeerConnectionAttempting,
} from '../../state/communication';

/** Time after which a connection that does not come up counts as a problem. */
export const peerConnectionProblemDelayMs = 15_000;

/**
 * Whether a WebRTC connection to another session of this board tries to come
 * up, but does not for {@link peerConnectionProblemDelayMs}. Presentation
 * messages travel over these connections, so the other side can't follow a
 * presentation (or present to us). Usually the devices are behind NATs and
 * need a relay (TURN) server.
 *
 * Sessions that never answer (e.g. a closed tab whose session is not cleaned
 * up yet) are not a problem. MatrixRTC mode is not covered.
 */
export function usePeerConnectionProblem(
  delayMs = peerConnectionProblemDelayMs,
): boolean {
  const { communicationChannel } = useActiveWhiteboardInstanceStatistics();
  return usePeerConnectionProblemOf(communicationChannel, delayMs);
}

/** {@link usePeerConnectionProblem} for the given statistics. */
export function usePeerConnectionProblemOf(
  communicationChannel: CommunicationChannelStatistics,
  delayMs = peerConnectionProblemDelayMs,
): boolean {
  const enabled =
    !isMatrixRtcMode() && communicationChannel.localSession !== undefined;
  const attemptingIds = enabled
    ? Object.entries(communicationChannel.peerConnections)
        .filter(([, statistics]) => isPeerConnectionAttempting(statistics))
        .map(([connectionId]) => connectionId)
        .sort()
        .join(' ')
    : '';

  // since when each connection tries to come up
  const since = useRef(new Map<string, number>());
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    const map = since.current;
    const ids = new Set(attemptingIds ? attemptingIds.split(' ') : []);
    const now = Date.now();

    for (const id of [...map.keys()]) {
      if (!ids.has(id)) {
        map.delete(id);
      }
    }
    for (const id of ids) {
      if (!map.has(id)) {
        map.set(id, now);
      }
    }

    if (map.size === 0) {
      setProblem(false);
      return;
    }

    const remaining = Math.min(...map.values()) + delayMs - now;

    if (remaining <= 0) {
      setProblem(true);
      return;
    }

    setProblem(false);
    const timer = setTimeout(() => setProblem(true), remaining);
    return () => clearTimeout(timer);
  }, [attemptingIds, delayMs]);

  return problem;
}
