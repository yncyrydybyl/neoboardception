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
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ComponentType, PropsWithChildren } from 'react';
import { Subject } from 'rxjs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  Mocked,
  vi,
} from 'vitest';
import { WhiteboardHost } from '..';
import {
  mockFrameElement,
  mockWhiteboardManager,
  WhiteboardTestingContextProvider,
} from '../../../lib/testUtils';
import { Point, WhiteboardInstance, WhiteboardManager } from '../../../state';
import { Message } from '../../../state/communication';
import { ConnectionPointProvider } from '../../ConnectionPointProvider';
import { ElementOverridesProvider } from '../../ElementOverridesProvider';
import { LayoutStateProvider } from '../../Layout';
import { WhiteboardHotkeysProvider } from '../../WhiteboardHotkeysProvider';
import * as constants from '../constants';
import {
  SvgScaleContextProvider,
  SvgScaleContextType,
  useSvgScaleContext,
} from '../SvgScaleContext';
import { setIgnoreReducedMotion } from './reducedMotion';

vi.mock('../SvgCanvas/useMeasure', () => ({
  useMeasure: vi.fn().mockReturnValue([vi.fn(), { width: 1920, height: 1080 }]),
}));

vi.mock('../SvgCanvas/utils', async () => ({
  ...(await vi.importActual('../SvgCanvas/utils')),
  calculateSvgCoords: (position: Point) => position,
}));

vi.mock('@matrix-widget-toolkit/mui', async () => ({
  ...(await vi.importActual<typeof import('@matrix-widget-toolkit/mui')>(
    '@matrix-widget-toolkit/mui',
  )),
  getEnvironment: vi.fn(),
}));

/** viewBox that shows the rect in the 1920×1080 container. */
function fitViewBox(x: number, y: number, width: number, height: number) {
  const scale = Math.min(1920 / width, 1080 / height);
  const w = 1920 / scale;
  const h = 1080 / scale;
  return [x + width / 2 - w / 2, y + height / 2 - h / 2, w, h];
}

function viewBox(): number[] {
  // the canvas is the first svg of the whiteboard host
  return document
    .querySelector('svg[viewBox]')!
    .getAttribute('viewBox')!
    .split(' ')
    .map(Number);
}

/** Matcher for a viewBox (rounding differences are fine). */
function viewBoxOf(expected: number[]) {
  return expected.map((v) => expect.closeTo(v, 3));
}

describe('usePresentationCamera', () => {
  let widgetApi: MockedWidgetApi;
  let whiteboardManager: Mocked<WhiteboardManager>;
  let messageSubject: Subject<Message>;
  let activeWhiteboard: WhiteboardInstance;
  let Wrapper: ComponentType<PropsWithChildren<{}>>;
  let svgScale: SvgScaleContextType;

  function SvgScaleExtractor() {
    svgScale = useSvgScaleContext();
    return null;
  }

  const frame0 = { x: 2000, y: 2000, width: 1920, height: 1080 };
  const frame1 = { x: 15000, y: 8000, width: 960, height: 540 };

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
        'setTimeout',
        'clearTimeout',
        'Date',
      ],
    });
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_RTC'
        ? 'webrtc'
        : name === 'REACT_APP_INFINITE_CANVAS'
          ? 'true'
          : defaultValue,
    );
    document.elementsFromPoint = vi.fn().mockReturnValue([]);
    widgetApi = mockWidgetApi();
    vi.spyOn(constants, 'infiniteCanvasMode', 'get').mockReturnValue(true);
    vi.spyOn(constants, 'whiteboardWidth', 'get').mockReturnValue(19200);
    vi.spyOn(constants, 'whiteboardHeight', 'get').mockReturnValue(10800);

    ({ whiteboardManager, messageSubject } = mockWhiteboardManager({
      slides: [
        [
          'slide-0',
          [
            [
              'frame-0',
              mockFrameElement({
                position: { x: frame0.x, y: frame0.y },
                width: frame0.width,
                height: frame0.height,
              }),
            ],
            [
              'frame-1',
              mockFrameElement({
                position: { x: frame1.x, y: frame1.y },
                width: frame1.width,
                height: frame1.height,
              }),
            ],
          ],
        ],
      ],
    }));
    activeWhiteboard = whiteboardManager.getActiveWhiteboardInstance()!;
    activeWhiteboard.setActiveSlideId('slide-0');

    Wrapper = ({ children }) => (
      <LayoutStateProvider>
        <WhiteboardHotkeysProvider>
          <WhiteboardTestingContextProvider
            whiteboardManager={whiteboardManager}
            widgetApi={widgetApi}
          >
            <SvgScaleContextProvider>
              <SvgScaleExtractor />
              <ElementOverridesProvider>
                <ConnectionPointProvider>{children}</ConnectionPointProvider>
              </ElementOverridesProvider>
            </SvgScaleContextProvider>
          </WhiteboardTestingContextProvider>
        </WhiteboardHotkeysProvider>
      </LayoutStateProvider>
    );
  });

  afterEach(() => {
    widgetApi.stop();
    vi.useRealTimers();
  });

  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it('jumps to a frame outside of a presentation (as before)', () => {
    render(<WhiteboardHost />, { wrapper: Wrapper });

    act(() => activeWhiteboard.setActiveFrameElementId('frame-1'));

    expect(viewBox()).toEqual(
      viewBoxOf([frame1.x, frame1.y, frame1.width, frame1.height]),
    );
  });

  it('flies to the next frame while presenting', () => {
    render(<WhiteboardHost />, { wrapper: Wrapper });
    act(() =>
      activeWhiteboard.getPresentationManager()!.startPresentation('frame-0'),
    );
    advance(3000);
    expect(viewBox()).toEqual(
      viewBoxOf(fitViewBox(frame0.x, frame0.y, frame0.width, frame0.height)),
    );

    act(() => activeWhiteboard.setActiveFrameElementId('frame-1'));
    advance(400);

    // somewhere on the way, zoomed out further than both frames
    const [, , width] = viewBox();
    expect(width).toBeGreaterThan(frame0.width);

    advance(3000);
    expect(viewBox()).toEqual(
      viewBoxOf([frame1.x, frame1.y, frame1.width, frame1.height]),
    );
  });

  it('flies to the frame that was already selected when the presentation starts', () => {
    render(<WhiteboardHost />, { wrapper: Wrapper });
    // selected in the frame list: jump there, then the user zooms out
    act(() => activeWhiteboard.setActiveFrameElementId('frame-1'));
    act(() => svgScale.updateScale(0.2, 'set', { x: 15480, y: 8270 }));
    const zoomedOut = viewBox();
    expect(zoomedOut[2]).toBeGreaterThan(frame1.width * 2);

    act(() =>
      activeWhiteboard.getPresentationManager()!.startPresentation('frame-1'),
    );
    advance(200);
    expect(viewBox()[2]).toBeLessThan(zoomedOut[2]);
    expect(viewBox()[2]).toBeGreaterThan(frame1.width);

    advance(3000);
    expect(viewBox()).toEqual(
      viewBoxOf([frame1.x, frame1.y, frame1.width, frame1.height]),
    );
  });

  it('jumps while presenting with the transition "none"', () => {
    activeWhiteboard.setPresentationTransition('none');
    render(<WhiteboardHost />, { wrapper: Wrapper });

    act(() =>
      activeWhiteboard.getPresentationManager()!.startPresentation('frame-1'),
    );

    expect(viewBox()).toEqual(
      viewBoxOf([frame1.x, frame1.y, frame1.width, frame1.height]),
    );
  });

  it('lets a late joiner jump to the current frame of the presenter', () => {
    render(<WhiteboardHost />, { wrapper: Wrapper });

    act(() =>
      messageSubject.next({
        senderUserId: '@user-alice:example.com',
        senderSessionId: 'other',
        type: 'net.nordeck.whiteboard.present_frame',
        content: {
          view: { isEditMode: false, frameId: 'frame-1', catchUp: true },
        },
      }),
    );

    expect(viewBox()).toEqual(
      viewBoxOf([frame1.x, frame1.y, frame1.width, frame1.height]),
    );
  });

  it('lets a follower fly with the presenter', () => {
    render(<WhiteboardHost />, { wrapper: Wrapper });

    act(() =>
      messageSubject.next({
        senderUserId: '@user-alice:example.com',
        senderSessionId: 'other',
        type: 'net.nordeck.whiteboard.present_frame',
        content: { view: { isEditMode: false, frameId: 'frame-1' } },
      }),
    );

    expect(viewBox()[2]).not.toBeCloseTo(frame1.width);
    advance(3000);
    expect(viewBox()).toEqual(
      viewBoxOf([frame1.x, frame1.y, frame1.width, frame1.height]),
    );
  });

  it('shows the overview of all frames and opens a frame by click', () => {
    render(<WhiteboardHost />, { wrapper: Wrapper });
    const presentationManager = activeWhiteboard.getPresentationManager()!;
    act(() => presentationManager.startPresentation('frame-0'));
    advance(3000);

    act(() => presentationManager.setOverview(true));
    advance(3000);

    expect(screen.getByTestId('presentation-overview')).toBeInTheDocument();
    const [x, y, w, h] = viewBox();
    for (const f of [frame0, frame1]) {
      expect(f.x).toBeGreaterThanOrEqual(x);
      expect(f.y).toBeGreaterThanOrEqual(y);
      expect(f.x + f.width).toBeLessThanOrEqual(x + w);
      expect(f.y + f.height).toBeLessThanOrEqual(y + h);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Open frame 2' }));
    advance(3000);

    expect(presentationManager.isOverview()).toBe(false);
    expect(activeWhiteboard.getActiveFrameElementId()).toBe('frame-1');
    expect(
      screen.queryByTestId('presentation-overview'),
    ).not.toBeInTheDocument();
    expect(viewBox()).toEqual(
      viewBoxOf([frame1.x, frame1.y, frame1.width, frame1.height]),
    );
  });

  it('does not fly with reduced motion', () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    try {
      render(<WhiteboardHost />, { wrapper: Wrapper });
      act(() =>
        activeWhiteboard.getPresentationManager()!.startPresentation('frame-0'),
      );
      advance(3000);

      act(() => activeWhiteboard.setActiveFrameElementId('frame-1'));
      advance(16);

      // fade: no intermediate cameras (jsdom cannot animate the opacity)
      expect(viewBox()).toEqual(
        viewBoxOf([frame1.x, frame1.y, frame1.width, frame1.height]),
      );
    } finally {
      window.matchMedia = matchMedia;
    }
  });
  describe('when the viewer plays transitions anyway', () => {
    const matchMedia = window.matchMedia;

    beforeEach(() => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      setIgnoreReducedMotion(true);
    });

    afterEach(() => {
      window.matchMedia = matchMedia;
      setIgnoreReducedMotion(false);
    });

    it('flies as presenter despite reduced motion', () => {
      render(<WhiteboardHost />, { wrapper: Wrapper });
      act(() =>
        activeWhiteboard.getPresentationManager()!.startPresentation('frame-0'),
      );
      advance(3000);

      act(() => activeWhiteboard.setActiveFrameElementId('frame-1'));
      advance(400);

      // somewhere on the way, zoomed out further than both frames
      expect(viewBox()[2]).toBeGreaterThan(frame0.width);

      advance(3000);
      expect(viewBox()).toEqual(
        viewBoxOf([frame1.x, frame1.y, frame1.width, frame1.height]),
      );
    });

    it('flies as follower despite reduced motion', () => {
      render(<WhiteboardHost />, { wrapper: Wrapper });

      act(() =>
        messageSubject.next({
          senderUserId: '@user-alice:example.com',
          senderSessionId: 'other',
          type: 'net.nordeck.whiteboard.present_frame',
          content: { view: { isEditMode: false, frameId: 'frame-1' } },
        }),
      );

      expect(viewBox()[2]).not.toBeCloseTo(frame1.width);
      advance(3000);
      expect(viewBox()).toEqual(
        viewBoxOf([frame1.x, frame1.y, frame1.width, frame1.height]),
      );
    });
  });
});
