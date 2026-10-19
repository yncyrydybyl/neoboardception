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
import { MockedWidgetApi, mockWidgetApi } from '@matrix-widget-toolkit/testing';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { ComponentType, PropsWithChildren } from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  Mocked,
  vi,
} from 'vitest';
import {
  mockFrameElement,
  mockWhiteboardManager,
  WhiteboardTestingContextProvider,
} from '../../lib/testUtils/documentTestUtils';
import { mockRoomMember } from '../../lib/testUtils/matrixTestUtils';
import { WhiteboardInstance, WhiteboardManager } from '../../state';
import { LayoutStateProvider } from '../Layout';
import {
  getIgnoreReducedMotion,
  setIgnoreReducedMotion,
} from '../Whiteboard/Presentation/reducedMotion';
import {
  PresentationHints,
  reducedMotionHintDurationMs,
} from './PresentationHints';
import { usePeerConnectionProblem } from './usePeerConnectionProblem';

vi.mock('@matrix-widget-toolkit/mui', async () => ({
  ...(await vi.importActual<typeof import('@matrix-widget-toolkit/mui')>(
    '@matrix-widget-toolkit/mui',
  )),
  getEnvironment: vi.fn(),
}));

vi.mock('./usePeerConnectionProblem', async () => ({
  ...(await vi.importActual<typeof import('./usePeerConnectionProblem')>(
    './usePeerConnectionProblem',
  )),
  usePeerConnectionProblem: vi.fn(),
}));

const reducedMotionText =
  'Your system asks for reduced motion, so transitions play as fades on this device.';
const connectionText =
  "Couldn't connect to another person on this board, so you may not be able to follow their presentation. Your devices may need a relay (TURN) server.";

describe('<PresentationHints/>', () => {
  let widgetApi: MockedWidgetApi;
  let whiteboardManager: Mocked<WhiteboardManager>;
  let activeWhiteboardInstance: WhiteboardInstance;
  let setPresentationMode: (
    enable: boolean,
    enableEdit?: boolean,
    presentationType?: 'presentation' | 'presenting',
  ) => void;
  let Wrapper: ComponentType<PropsWithChildren<{}>>;
  let reducedMotion: boolean;
  const matchMedia = window.matchMedia;

  beforeEach(() => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );
    vi.mocked(usePeerConnectionProblem).mockReturnValue(false);

    reducedMotion = true;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches:
        reducedMotion && query.includes('prefers-reduced-motion: reduce'),
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    setIgnoreReducedMotion(false);

    widgetApi = mockWidgetApi();
    widgetApi.mockSendStateEvent(mockRoomMember());

    ({ whiteboardManager, setPresentationMode } = mockWhiteboardManager({
      slides: [['slide-0', [['frame-0', mockFrameElement()]]]],
    }));
    activeWhiteboardInstance = whiteboardManager.getActiveWhiteboardInstance()!;

    Wrapper = ({ children }) => (
      <LayoutStateProvider>
        <WhiteboardTestingContextProvider
          whiteboardManager={whiteboardManager}
          widgetApi={widgetApi}
        >
          {children}
        </WhiteboardTestingContextProvider>
      </LayoutStateProvider>
    );
  });

  afterEach(() => {
    window.matchMedia = matchMedia;
    setIgnoreReducedMotion(false);
    widgetApi.stop();
    vi.useRealTimers();
  });

  function startPresentation() {
    act(() =>
      activeWhiteboardInstance
        .getPresentationManager()!
        .startPresentation('frame-0'),
    );
  }

  function stopPresentation() {
    act(() =>
      activeWhiteboardInstance.getPresentationManager()!.stopPresentation(),
    );
  }

  it('shows nothing outside of a presentation', () => {
    render(<PresentationHints />, { wrapper: Wrapper });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('points the presenter to the transitions menu once', () => {
    render(<PresentationHints />, { wrapper: Wrapper });

    startPresentation();

    expect(screen.getByRole('status')).toHaveTextContent(
      reducedMotionText + ' You can change this in the Transitions menu.',
    );

    stopPresentation();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // only once
    startPresentation();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('lets a follower play the transitions anyway', async () => {
    render(<PresentationHints />, { wrapper: Wrapper });

    act(() => setPresentationMode(true));

    expect(screen.getByRole('status')).toHaveTextContent(reducedMotionText);

    await userEvent.click(screen.getByRole('button', { name: 'Play anyway' }));

    expect(getIgnoreReducedMotion()).toBe(true);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('can be dismissed', async () => {
    render(<PresentationHints />, { wrapper: Wrapper });
    startPresentation();

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(getIgnoreReducedMotion()).toBe(false);
  });

  it('disappears after a while', () => {
    vi.useFakeTimers();
    render(<PresentationHints />, { wrapper: Wrapper });
    startPresentation();
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(reducedMotionHintDurationMs));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not show the reduced motion hint if the viewer plays transitions anyway', () => {
    setIgnoreReducedMotion(true);
    render(<PresentationHints />, { wrapper: Wrapper });

    startPresentation();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not show the reduced motion hint without reduced motion', () => {
    reducedMotion = false;
    render(<PresentationHints />, { wrapper: Wrapper });

    startPresentation();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not show the reduced motion hint in the slide mode', () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'false' : defaultValue,
    );
    render(<PresentationHints />, { wrapper: Wrapper });

    startPresentation();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  describe('connection problems', () => {
    beforeEach(() => {
      reducedMotion = false;
    });

    it('suggests a relay server if a connection does not come up', () => {
      vi.mocked(usePeerConnectionProblem).mockReturnValue(true);

      const { rerender } = render(<PresentationHints />, { wrapper: Wrapper });

      expect(screen.getByRole('status')).toHaveTextContent(connectionText);

      // disappears once connected
      vi.mocked(usePeerConnectionProblem).mockReturnValue(false);
      rerender(<PresentationHints />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('tells the presenter that some people may not see the presentation', () => {
      vi.mocked(usePeerConnectionProblem).mockReturnValue(true);
      render(<PresentationHints />, { wrapper: Wrapper });

      startPresentation();

      expect(screen.getByRole('status')).toHaveTextContent(
        "Couldn't connect to everyone on this board, so some people may not see your presentation. Your devices may need a relay (TURN) server.",
      );
    });

    it('does not show the hint while following a presentation', () => {
      vi.mocked(usePeerConnectionProblem).mockReturnValue(true);
      render(<PresentationHints />, { wrapper: Wrapper });

      act(() => setPresentationMode(true));

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('can be dismissed until the next problem', async () => {
      vi.mocked(usePeerConnectionProblem).mockReturnValue(true);
      const { rerender } = render(<PresentationHints />, { wrapper: Wrapper });

      await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      vi.mocked(usePeerConnectionProblem).mockReturnValue(false);
      rerender(<PresentationHints />);
      vi.mocked(usePeerConnectionProblem).mockReturnValue(true);
      rerender(<PresentationHints />);

      expect(screen.getByRole('status')).toHaveTextContent(connectionText);
    });
  });

  it('should have no accessibility violations', async () => {
    vi.mocked(usePeerConnectionProblem).mockReturnValue(true);
    const { container } = render(<PresentationHints />, { wrapper: Wrapper });
    startPresentation();
    expect(screen.getAllByRole('status')).toHaveLength(2);

    await act(async () => {
      expect(
        await axe.run(container, { rules: { region: { enabled: false } } }),
      ).toHaveNoViolations();
    });
  });
});
