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

import { getEnvironment } from '@matrix-widget-toolkit/mui';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommunicationChannelStatistics,
  PeerConnectionStatistics,
} from '../../state/communication';
import {
  peerConnectionProblemDelayMs,
  usePeerConnectionProblemOf,
} from './usePeerConnectionProblem';

vi.mock('@matrix-widget-toolkit/mui', async () => ({
  ...(await vi.importActual<typeof import('@matrix-widget-toolkit/mui')>(
    '@matrix-widget-toolkit/mui',
  )),
  getEnvironment: vi.fn(),
}));

function peer(
  connectionState: string,
  iceConnectionState: string,
  dataChannelState?: string,
): PeerConnectionStatistics {
  return {
    remoteUserId: '@user-alice:example.com',
    remoteSessionId: 'other',
    packetsReceived: 0,
    bytesReceived: 0,
    packetsSent: 0,
    bytesSent: 0,
    connectionState,
    iceConnectionState,
    dataChannelState,
  };
}

function statistics(
  peerConnections: Record<string, PeerConnectionStatistics>,
  connected = true,
): CommunicationChannelStatistics {
  return {
    localSession: connected ? { sessionId: 'own' } : undefined,
    peerConnections,
    sessions: {},
  };
}

describe('usePeerConnectionProblem', () => {
  let rtc: string;

  beforeEach(() => {
    vi.useFakeTimers();
    rtc = 'webrtc';
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_RTC' ? rtc : defaultValue,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  let current: CommunicationChannelStatistics;

  function setStatistics(stats: CommunicationChannelStatistics) {
    current = stats;
  }

  function renderProblem() {
    return renderHook(() => usePeerConnectionProblemOf(current));
  }

  it('reports a connection that does not come up within the delay', () => {
    setStatistics(statistics({ 'peer-0': peer('connecting', 'checking') }));
    const { result, rerender } = renderProblem();

    act(() => vi.advanceTimersByTime(peerConnectionProblemDelayMs - 1));
    expect(result.current).toBe(false);

    // ICE fails and restarts: still the same attempt
    setStatistics(statistics({ 'peer-0': peer('failed', 'failed') }));
    rerender();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);

    // connected: the problem is gone
    setStatistics(
      statistics({ 'peer-0': peer('connected', 'connected', 'open') }),
    );
    rerender();
    expect(result.current).toBe(false);
  });

  it('ignores sessions that never answer', () => {
    setStatistics(statistics({ 'peer-0': peer('new', 'new') }));
    const { result } = renderProblem();

    act(() => vi.advanceTimersByTime(peerConnectionProblemDelayMs * 4));

    expect(result.current).toBe(false);
  });

  it('starts again for a new connection', () => {
    setStatistics(statistics({ 'peer-0': peer('connecting', 'checking') }));
    const { result, rerender } = renderProblem();
    act(() => vi.advanceTimersByTime(peerConnectionProblemDelayMs / 2));

    // the session left, another one joins
    setStatistics(statistics({ 'peer-1': peer('connecting', 'checking') }));
    rerender();
    act(() => vi.advanceTimersByTime(peerConnectionProblemDelayMs / 2));
    expect(result.current).toBe(false);

    act(() => vi.advanceTimersByTime(peerConnectionProblemDelayMs / 2));
    expect(result.current).toBe(true);
  });

  it('reports nothing without an own session', () => {
    setStatistics(
      statistics({ 'peer-0': peer('connecting', 'checking') }, false),
    );
    const { result } = renderProblem();

    act(() => vi.advanceTimersByTime(peerConnectionProblemDelayMs * 2));

    expect(result.current).toBe(false);
  });

  it('reports nothing in MatrixRTC mode', () => {
    rtc = 'matrixrtc';
    setStatistics(statistics({ 'peer-0': peer('connecting', 'checking') }));
    const { result } = renderProblem();

    act(() => vi.advanceTimersByTime(peerConnectionProblemDelayMs * 2));

    expect(result.current).toBe(false);
  });
});
