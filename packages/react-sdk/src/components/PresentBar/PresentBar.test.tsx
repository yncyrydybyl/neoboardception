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

import { getEnvironment } from '@matrix-widget-toolkit/mui';
import { MockedWidgetApi, mockWidgetApi } from '@matrix-widget-toolkit/testing';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { ComponentType, PropsWithChildren } from 'react';
import { Subject } from 'rxjs';
import {
  Mocked,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  WhiteboardTestingContextProvider,
  mockFrameElement,
  mockWhiteboardManager,
} from '../../lib/testUtils/documentTestUtils';
import {
  mockPowerLevelsEvent,
  mockRoomMember,
} from '../../lib/testUtils/matrixTestUtils';
import {
  Point,
  WhiteboardInstance,
  WhiteboardManager,
  WhiteboardSlideInstance,
} from '../../state';
import { Message } from '../../state/communication';
import { LayoutStateProvider } from '../Layout';
import { useSvgScaleContext } from '../Whiteboard';
import {
  getIgnoreReducedMotion,
  setIgnoreReducedMotion,
} from '../Whiteboard/Presentation/reducedMotion';
import { PresentBar } from './PresentBar';

let widgetApi: MockedWidgetApi;

vi.mock('@matrix-widget-toolkit/mui', async () => ({
  ...(await vi.importActual<typeof import('@matrix-widget-toolkit/mui')>(
    '@matrix-widget-toolkit/mui',
  )),
  getEnvironment: vi.fn(),
}));

afterEach(() => widgetApi.stop());

beforeEach(() => {
  vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
    name === 'REACT_APP_INFINITE_CANVAS' ? 'false' : defaultValue,
  );

  widgetApi = mockWidgetApi();
});

describe('<PresentBar/>', () => {
  let Wrapper: ComponentType<PropsWithChildren<{}>>;
  let whiteboardManager: Mocked<WhiteboardManager>;
  let messageSubject: Subject<Message>;
  let activeWhiteboardInstance: WhiteboardInstance;
  let activeSlide: WhiteboardSlideInstance;
  let setPresentationMode: (enable: boolean) => void;

  beforeEach(() => {
    ({ whiteboardManager, messageSubject, setPresentationMode } =
      mockWhiteboardManager({
        slides: [
          ['slide-0', []],
          ['slide-1', []],
          ['slide-2', []],
        ],
      }));

    activeWhiteboardInstance = whiteboardManager.getActiveWhiteboardInstance()!;
    activeWhiteboardInstance.setActiveSlideId('slide-1');
    activeSlide = activeWhiteboardInstance.getSlide('slide-1');

    widgetApi.mockSendStateEvent(mockRoomMember());

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

  it('should render without exploding', async () => {
    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    expect(
      within(toolbar).getByRole('checkbox', {
        name: 'Start presentation',
        checked: false,
      }),
    ).toBeInTheDocument();
  });

  it('should render without frames in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    expect(
      within(toolbar).getByRole('checkbox', {
        name: 'Add a frame to enable presentation mode',
        checked: false,
      }),
    ).toBeDisabled();
  });

  it('should have no accessibility violations', async () => {
    const { container } = render(<PresentBar />, { wrapper: Wrapper });

    await act(async () => {
      expect(
        screen.getByRole('checkbox', { name: 'Start presentation' }),
      ).toBeInTheDocument();

      expect(await axe.run(container)).toHaveNoViolations();
    });
  });

  it('should have no accessibility violations when viewing a presentation', async () => {
    setPresentationMode(true);

    const { container } = render(<PresentBar />, { wrapper: Wrapper });

    await act(async () => {
      expect(await axe.run(container)).toHaveNoViolations();
    });
  });

  it('should start the presentation', async () => {
    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    await userEvent.click(
      within(toolbar).getByRole('checkbox', {
        name: 'Start presentation',
        checked: false,
      }),
    );

    expect(
      within(toolbar).getByRole('checkbox', {
        name: 'End presentation',
        checked: true,
      }),
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('button', {
        name: 'Next slide',
      }),
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('button', {
        name: 'Previous slide',
      }),
    ).toBeInTheDocument();
  });

  it('should start the presentation in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    activeSlide.addElement(mockFrameElement());

    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    await userEvent.click(
      within(toolbar).getByRole('checkbox', {
        name: 'Start presentation',
        checked: false,
      }),
    );

    expect(
      within(toolbar).getByRole('checkbox', {
        name: 'End presentation',
        checked: true,
      }),
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('button', {
        name: 'Next frame',
      }),
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('button', {
        name: 'Previous frame',
      }),
    ).toBeInTheDocument();
  });

  describe('start frame in infinite canvas mode', () => {
    let viewportCanvasCenter: Point;
    let frameIds: string[];

    function ViewportCenterExtractor() {
      viewportCanvasCenter = useSvgScaleContext().viewportCanvasCenter;
      return null;
    }

    beforeEach(() => {
      vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
        name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
      );
    });

    function renderWithFrames() {
      render(
        <>
          <ViewportCenterExtractor />
          <PresentBar />
        </>,
        { wrapper: Wrapper },
      );

      // frame 1 is far away from the view, the view is centred on frame 2
      const { x, y } = viewportCanvasCenter;
      act(() => {
        frameIds = [
          activeSlide.addElement(
            mockFrameElement({ position: { x: x + 5000, y: y + 5000 } }),
          ),
          activeSlide.addElement(
            mockFrameElement({ position: { x: x - 100, y: y - 50 } }),
          ),
          activeSlide.addElement(
            mockFrameElement({ position: { x: x - 5000, y: y - 5000 } }),
          ),
        ];
      });
    }

    async function clickStart() {
      await userEvent.click(
        within(screen.getByRole('toolbar', { name: 'Present' })).getByRole(
          'checkbox',
          { name: 'Start presentation', checked: false },
        ),
      );
    }

    it('should start on the first frame, not on the frame nearest to the view', async () => {
      renderWithFrames();
      expect(
        activeWhiteboardInstance.getActiveFrameElementId(),
      ).toBeUndefined();

      await clickStart();

      expect(activeWhiteboardInstance.getActiveFrameElementId()).toBe(
        frameIds[0],
      );
    });

    it('should start on the frame that is selected in the frame list', async () => {
      renderWithFrames();
      act(() => activeWhiteboardInstance.setActiveFrameElementId(frameIds[2]));

      await clickStart();

      expect(activeWhiteboardInstance.getActiveFrameElementId()).toBe(
        frameIds[2],
      );
    });

    it('should start on an explicitly passed frame', () => {
      renderWithFrames();
      act(() =>
        activeWhiteboardInstance
          .getPresentationManager()
          ?.startPresentation(frameIds[1]),
      );

      expect(activeWhiteboardInstance.getActiveFrameElementId()).toBe(
        frameIds[1],
      );
    });
  });

  it('should stop the presentation', async () => {
    whiteboardManager
      .getActiveWhiteboardInstance()
      ?.getPresentationManager()
      ?.startPresentation();

    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    await userEvent.click(
      within(toolbar).getByRole('checkbox', {
        name: 'End presentation',
        checked: true,
      }),
    );

    expect(
      within(toolbar).getByRole('checkbox', {
        name: 'Start presentation',
        checked: false,
      }),
    ).toBeInTheDocument();
  });

  it('should stop the presentation in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    const frameId = activeSlide.addElement(mockFrameElement());

    whiteboardManager
      .getActiveWhiteboardInstance()
      ?.getPresentationManager()
      ?.startPresentation(frameId);

    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    await userEvent.click(
      within(toolbar).getByRole('checkbox', {
        name: 'End presentation',
        checked: true,
      }),
    );

    expect(
      within(toolbar).getByRole('checkbox', {
        name: 'Start presentation',
        checked: false,
      }),
    ).toBeInTheDocument();
  });

  it('should change to the next slide', async () => {
    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    await userEvent.click(
      within(toolbar).getByRole('checkbox', {
        name: 'Start presentation',
        checked: false,
      }),
    );

    expect(activeWhiteboardInstance.getActiveSlideId()).toBe('slide-1');

    await userEvent.click(
      within(toolbar).getByRole('button', {
        name: 'Next slide',
      }),
    );

    expect(activeWhiteboardInstance.getActiveSlideId()).toBe('slide-2');
  });

  it('should change to the next frame in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    const frameId0 = activeSlide.addElement(mockFrameElement());
    const frameId1 = activeSlide.addElement(mockFrameElement());

    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    await userEvent.click(
      within(toolbar).getByRole('checkbox', {
        name: 'Start presentation',
        checked: false,
      }),
    );

    expect(activeWhiteboardInstance.getActiveSlideId()).toBe('slide-1');
    expect(activeWhiteboardInstance.getActiveFrameElementId()).toBe(frameId0);

    await userEvent.click(
      within(toolbar).getByRole('button', {
        name: 'Next frame',
      }),
    );

    expect(activeWhiteboardInstance.getActiveSlideId()).toBe('slide-1');
    expect(activeWhiteboardInstance.getActiveFrameElementId()).toBe(frameId1);
  });

  it('should change to the previous slide', async () => {
    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    await userEvent.click(
      within(toolbar).getByRole('checkbox', {
        name: 'Start presentation',
        checked: false,
      }),
    );

    expect(activeWhiteboardInstance.getActiveSlideId()).toBe('slide-1');

    await userEvent.click(
      within(toolbar).getByRole('button', {
        name: 'Previous slide',
      }),
    );

    expect(activeWhiteboardInstance.getActiveSlideId()).toBe('slide-0');
  });

  it('should change to the previous frame in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    const frameId0 = activeSlide.addElement(mockFrameElement());
    const frameId1 = activeSlide.addElement(mockFrameElement());

    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    await userEvent.click(
      within(toolbar).getByRole('checkbox', {
        name: 'Start presentation',
        checked: false,
      }),
    );

    act(() => {
      activeWhiteboardInstance.setActiveFrameElementId(frameId1);
    });

    await userEvent.click(
      within(toolbar).getByRole('button', {
        name: 'Previous frame',
      }),
    );

    expect(activeWhiteboardInstance.getActiveSlideId()).toBe('slide-1');
    expect(activeWhiteboardInstance.getActiveFrameElementId()).toBe(frameId0);
  });

  it('should disabled next slide button if the last slide active', async () => {
    activeWhiteboardInstance.setActiveSlideId('slide-2');
    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    await userEvent.click(
      within(toolbar).getByRole('checkbox', {
        name: 'Start presentation',
        checked: false,
      }),
    );

    expect(
      within(toolbar).getByRole('button', {
        name: 'Next slide',
      }),
    ).toBeDisabled();
  });

  it('should disabled next frame button if the last frame active in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    activeSlide.addElement(mockFrameElement());
    const frameId1 = activeSlide.addElement(mockFrameElement());

    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    await userEvent.click(
      within(toolbar).getByRole('checkbox', {
        name: 'Start presentation',
        checked: false,
      }),
    );

    act(() => {
      activeWhiteboardInstance.setActiveFrameElementId(frameId1);
    });

    expect(
      within(toolbar).getByRole('button', {
        name: 'Next frame',
      }),
    ).toBeDisabled();
  });

  it('should disabled previous slide button if the first slide active', async () => {
    activeWhiteboardInstance.setActiveSlideId('slide-0');
    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    await userEvent.click(
      within(toolbar).getByRole('checkbox', {
        name: 'Start presentation',
        checked: false,
      }),
    );

    expect(
      within(toolbar).getByRole('button', {
        name: 'Previous slide',
      }),
    ).toBeDisabled();
  });

  it('should disabled previous frame button if the first frame active in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    activeSlide.addElement(mockFrameElement());

    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    await userEvent.click(
      within(toolbar).getByRole('checkbox', {
        name: 'Start presentation',
        checked: false,
      }),
    );

    expect(
      within(toolbar).getByRole('button', {
        name: 'Previous frame',
      }),
    ).toBeDisabled();
  });

  it('should toggle the edit mode', async () => {
    whiteboardManager
      .getActiveWhiteboardInstance()
      ?.getPresentationManager()
      ?.startPresentation();

    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    await userEvent.click(
      within(toolbar).getByRole('checkbox', {
        name: 'Enable editing',
        checked: false,
      }),
    );

    await userEvent.click(
      within(toolbar).getByRole('checkbox', {
        name: 'Disable editing',
        checked: true,
      }),
    );

    expect(
      within(toolbar).getByRole('checkbox', {
        name: 'Enable editing',
        checked: false,
      }),
    ).toBeInTheDocument();
  });

  it('should be able to end presentation of another user if can moderate', async () => {
    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    act(() => {
      messageSubject.next({
        senderUserId: '@user-alice:example.com',
        senderSessionId: 'other',
        type: 'net.nordeck.whiteboard.present_slide',
        content: {
          view: { isEditMode: false, slideId: 'slide-0' },
        },
      });
    });

    widgetApi.mockSendStateEvent(
      mockPowerLevelsEvent({
        content: {
          users: { '@user-id:example.com': 50 },
          users_default: 0,
        },
      }),
    );

    const endPresentationButton = await within(toolbar).findByRole('button', {
      name: 'End presentation',
    });

    await userEvent.click(endPresentationButton);

    expect(endPresentationButton).not.toBeInTheDocument();

    expect(
      within(toolbar).getByRole('checkbox', {
        name: 'Start presentation',
        checked: false,
      }),
    ).toBeInTheDocument();
  });

  it('should be able to end presentation of another user if can moderate in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    const frameId0 = activeSlide.addElement(mockFrameElement());

    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    act(() => {
      messageSubject.next({
        senderUserId: '@user-alice:example.com',
        senderSessionId: 'other',
        type: 'net.nordeck.whiteboard.present_frame',
        content: {
          view: { isEditMode: false, frameId: frameId0 },
        },
      });
    });

    widgetApi.mockSendStateEvent(
      mockPowerLevelsEvent({
        content: {
          users: { '@user-id:example.com': 50 },
          users_default: 0,
        },
      }),
    );

    const endPresentationButton = await within(toolbar).findByRole('button', {
      name: 'End presentation',
    });

    await userEvent.click(endPresentationButton);

    expect(endPresentationButton).not.toBeInTheDocument();

    expect(
      within(toolbar).getByRole('checkbox', {
        name: 'Start presentation',
        checked: false,
      }),
    ).toBeInTheDocument();
  });

  it('should not be able to end presentation of another user if cannot moderate', async () => {
    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    act(() => {
      messageSubject.next({
        senderUserId: '@user-alice:example.com',
        senderSessionId: 'other',
        type: 'net.nordeck.whiteboard.present_slide',
        content: {
          view: { isEditMode: false, slideId: 'slide-0' },
        },
      });
    });

    widgetApi.mockSendStateEvent(
      mockPowerLevelsEvent({
        content: {
          users: { '@user-id:example.com': 50 },
          users_default: 0,
        },
      }),
    );

    const endPresentationButton = await within(toolbar).findByRole('button', {
      name: 'End presentation',
    });

    widgetApi.mockSendStateEvent(
      mockPowerLevelsEvent({
        content: {
          users: { '@user-id:example.com': 0 },
          users_default: 0,
        },
      }),
    );

    await waitFor(() => {
      expect(endPresentationButton).not.toBeInTheDocument();
    });
  });

  it('should not be able to end presentation of another user if cannot moderate in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    const frameId0 = activeSlide.addElement(mockFrameElement());

    render(<PresentBar />, { wrapper: Wrapper });

    const toolbar = screen.getByRole('toolbar', { name: 'Present' });

    act(() => {
      messageSubject.next({
        senderUserId: '@user-alice:example.com',
        senderSessionId: 'other',
        type: 'net.nordeck.whiteboard.present_frame',
        content: {
          view: { isEditMode: false, frameId: frameId0 },
        },
      });
    });

    widgetApi.mockSendStateEvent(
      mockPowerLevelsEvent({
        content: {
          users: { '@user-id:example.com': 50 },
          users_default: 0,
        },
      }),
    );

    const endPresentationButton = await within(toolbar).findByRole('button', {
      name: 'End presentation',
    });

    widgetApi.mockSendStateEvent(
      mockPowerLevelsEvent({
        content: {
          users: { '@user-id:example.com': 0 },
          users_default: 0,
        },
      }),
    );

    await waitFor(() => {
      expect(endPresentationButton).not.toBeInTheDocument();
    });
  });

  describe('transitions and overview (infinite canvas)', () => {
    beforeEach(() => {
      vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
        name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
      );
    });

    async function startPresentation() {
      const toolbar = screen.getByRole('toolbar', { name: 'Present' });
      await userEvent.click(
        within(toolbar).getByRole('checkbox', {
          name: 'Start presentation',
          checked: false,
        }),
      );
      return toolbar;
    }

    it('should not offer transitions without frames', () => {
      render(<PresentBar />, { wrapper: Wrapper });

      expect(
        screen.queryByRole('button', { name: 'Transitions' }),
      ).not.toBeInTheDocument();
    });

    it('should choose the transition before presenting', async () => {
      activeSlide.addElement(mockFrameElement());
      render(<PresentBar />, { wrapper: Wrapper });

      await userEvent.click(
        screen.getByRole('button', { name: 'Transitions' }),
      );
      const menu = screen.getByRole('menu');

      expect(
        within(menu).getByRole('menuitemradio', { name: /^Fly/ }),
      ).toHaveAttribute('aria-checked', 'true');
      expect(
        within(menu).getByRole('menuitemradio', { name: 'Normal' }),
      ).toHaveAttribute('aria-checked', 'true');
      // no frame is shown: no per frame setting
      expect(
        within(menu).queryByText('Into this frame'),
      ).not.toBeInTheDocument();

      await userEvent.click(
        within(menu).getByRole('menuitemradio', { name: /^Slide/ }),
      );
      await userEvent.click(
        within(menu).getByRole('menuitemradio', { name: 'Fast' }),
      );

      expect(activeWhiteboardInstance.getPresentationSettings()).toEqual({
        transition: 'slide',
        speed: 'fast',
        frameTransitions: {},
      });
      expect(
        within(menu).getByRole('menuitemradio', { name: /^Slide/ }),
      ).toHaveAttribute('aria-checked', 'true');
    });

    it('should set the transition into the current frame', async () => {
      const frameId0 = activeSlide.addElement(mockFrameElement());
      activeSlide.addElement(mockFrameElement());
      render(<PresentBar />, { wrapper: Wrapper });
      const toolbar = await startPresentation();

      await userEvent.click(
        within(toolbar).getByRole('button', { name: 'Transitions' }),
      );
      const menu = screen.getByRole('menu');
      expect(
        within(menu).getByRole('menuitemradio', { name: 'Like all frames' }),
      ).toHaveAttribute('aria-checked', 'true');

      // the second "Scale" entry belongs to "Into this frame"
      const zoomItems = within(menu).getAllByRole('menuitemradio', {
        name: /^Scale/,
      });
      expect(zoomItems).toHaveLength(2);
      await userEvent.click(zoomItems[1]);

      expect(
        activeWhiteboardInstance.getPresentationSettings().frameTransitions,
      ).toEqual({ [frameId0]: 'zoom' });

      await userEvent.click(
        within(menu).getByRole('menuitemradio', { name: 'Like all frames' }),
      );
      expect(
        activeWhiteboardInstance.getPresentationSettings().frameTransitions,
      ).toEqual({});
    });

    it('should label the stored "zoom" transition as "Scale"', async () => {
      activeSlide.addElement(mockFrameElement());
      activeWhiteboardInstance.setPresentationTransition('zoom');
      render(<PresentBar />, { wrapper: Wrapper });

      await userEvent.click(
        screen.getByRole('button', { name: 'Transitions' }),
      );

      expect(
        within(screen.getByRole('menu')).getByRole('menuitemradio', {
          name: /^Scale/,
        }),
      ).toHaveAttribute('aria-checked', 'true');
      expect(
        within(screen.getByRole('menu')).queryByRole('menuitemradio', {
          name: /^Zoom/,
        }),
      ).not.toBeInTheDocument();
    });

    it('should not summarize frame transitions without overrides', async () => {
      activeSlide.addElement(mockFrameElement());
      render(<PresentBar />, { wrapper: Wrapper });

      await userEvent.click(
        screen.getByRole('button', { name: 'Transitions' }),
      );

      expect(
        within(screen.getByRole('menu')).queryByRole('menuitem', {
          name: /Use for all frames/,
        }),
      ).not.toBeInTheDocument();
    });

    it('should summarize the frame transitions before presenting and use one for all frames', async () => {
      const frameId0 = activeSlide.addElement(mockFrameElement());
      const frameId1 = activeSlide.addElement(mockFrameElement());
      activeSlide.addElement(mockFrameElement());
      activeWhiteboardInstance.setFrameTransition(frameId0, 'zoom');
      activeWhiteboardInstance.setFrameTransition(frameId1, 'fade');
      // an override of a deleted frame does not count
      activeWhiteboardInstance.setFrameTransition('deleted-frame', 'slide');
      render(<PresentBar />, { wrapper: Wrapper });

      await userEvent.click(
        screen.getByRole('button', { name: 'Transitions' }),
      );
      const item = within(screen.getByRole('menu')).getByRole('menuitem', {
        name: /Use for all frames/,
      });
      expect(item).toHaveTextContent('2 frames have their own transition');

      // cancel keeps the overrides
      await userEvent.click(item);
      let dialog = screen.getByRole('dialog', {
        name: 'Use "Fly" for all frames?',
      });
      expect(dialog).toHaveTextContent(
        '2 frames have their own transition. They will be removed for everyone on this board and cannot be restored with undo.',
      );
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Cancel' }),
      );
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(
        Object.keys(
          activeWhiteboardInstance.getPresentationSettings().frameTransitions,
        ),
      ).toHaveLength(3);

      // confirm removes all overrides
      await userEvent.click(
        screen.getByRole('button', { name: 'Transitions' }),
      );
      await userEvent.click(
        within(screen.getByRole('menu')).getByRole('menuitem', {
          name: /Use for all frames/,
        }),
      );
      dialog = screen.getByRole('dialog');
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Use for all frames' }),
      );

      expect(activeWhiteboardInstance.getPresentationSettings()).toEqual({
        transition: 'fly',
        speed: 'normal',
        frameTransitions: {},
      });
    });

    it('should use the singular for one frame with its own transition', async () => {
      const frameId0 = activeSlide.addElement(mockFrameElement());
      activeSlide.addElement(mockFrameElement());
      activeWhiteboardInstance.setFrameTransition(frameId0, 'zoom');
      render(<PresentBar />, { wrapper: Wrapper });

      await userEvent.click(
        screen.getByRole('button', { name: 'Transitions' }),
      );

      expect(
        within(screen.getByRole('menu')).getByRole('menuitem', {
          name: /Use for all frames/,
        }),
      ).toHaveTextContent('One frame has its own transition');
    });

    it('should not offer the reduced motion choice without reduced motion', async () => {
      activeSlide.addElement(mockFrameElement());
      render(<PresentBar />, { wrapper: Wrapper });

      await userEvent.click(
        screen.getByRole('button', { name: 'Transitions' }),
      );

      expect(
        within(screen.getByRole('menu')).queryByRole('menuitemcheckbox'),
      ).not.toBeInTheDocument();
    });

    describe('with reduced motion', () => {
      const matchMedia = window.matchMedia;

      beforeEach(() => {
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
          matches: query.includes('prefers-reduced-motion: reduce'),
          media: query,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }));
        setIgnoreReducedMotion(false);
      });

      afterEach(() => {
        window.matchMedia = matchMedia;
        setIgnoreReducedMotion(false);
      });

      it('should play transitions anyway on this device', async () => {
        activeSlide.addElement(mockFrameElement());
        render(<PresentBar />, { wrapper: Wrapper });

        await userEvent.click(
          screen.getByRole('button', { name: 'Transitions' }),
        );
        const toggle = within(screen.getByRole('menu')).getByRole(
          'menuitemcheckbox',
          { name: /Play transitions anyway \(this device\)/ },
        );
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        expect(toggle).toHaveTextContent(
          'Your system asks for reduced motion, so transitions play as fades on this device.',
        );

        await userEvent.click(toggle);

        expect(toggle).toHaveAttribute('aria-checked', 'true');
        expect(getIgnoreReducedMotion()).toBe(true);
        // a device setting, not a board setting
        expect(activeWhiteboardInstance.getPresentationSettings()).toEqual({
          transition: 'fly',
          speed: 'normal',
          frameTransitions: {},
        });

        await userEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        expect(getIgnoreReducedMotion()).toBe(false);
      });

      it('should offer the choice while presenting', async () => {
        activeSlide.addElement(mockFrameElement());
        render(<PresentBar />, { wrapper: Wrapper });
        const toolbar = await startPresentation();

        await userEvent.click(
          within(toolbar).getByRole('button', { name: 'Transitions' }),
        );

        expect(
          within(screen.getByRole('menu')).getByRole('menuitemcheckbox', {
            name: /Play transitions anyway/,
          }),
        ).toBeInTheDocument();
      });

      it('should have no accessibility violations with the menu open', async () => {
        const frameId0 = activeSlide.addElement(mockFrameElement());
        activeSlide.addElement(mockFrameElement());
        activeWhiteboardInstance.setFrameTransition(frameId0, 'zoom');
        const { baseElement } = render(<PresentBar />, { wrapper: Wrapper });
        await userEvent.click(
          screen.getByRole('button', { name: 'Transitions' }),
        );
        expect(
          within(screen.getByRole('menu')).getByRole('menuitemcheckbox'),
        ).toBeInTheDocument();

        await act(async () => {
          expect(
            await axe.run(baseElement, {
              rules: { region: { enabled: false } },
            }),
          ).toHaveNoViolations();
        });
      });
    });

    it('should have no accessibility violations with the "use for all frames" dialog open', async () => {
      const frameId0 = activeSlide.addElement(mockFrameElement());
      activeWhiteboardInstance.setFrameTransition(frameId0, 'zoom');
      const { baseElement } = render(<PresentBar />, { wrapper: Wrapper });
      await userEvent.click(
        screen.getByRole('button', { name: 'Transitions' }),
      );
      await userEvent.click(
        within(screen.getByRole('menu')).getByRole('menuitem', {
          name: /Use for all frames/,
        }),
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await act(async () => {
        expect(
          await axe.run(baseElement, { rules: { region: { enabled: false } } }),
        ).toHaveNoViolations();
      });
    });

    it('should show and close the overview', async () => {
      const frameId0 = activeSlide.addElement(mockFrameElement());
      activeSlide.addElement(mockFrameElement());
      render(<PresentBar />, { wrapper: Wrapper });
      const toolbar = await startPresentation();
      const presentationManager =
        activeWhiteboardInstance.getPresentationManager()!;

      await userEvent.click(
        within(toolbar).getByRole('checkbox', {
          name: 'Show all frames',
          checked: false,
        }),
      );

      expect(presentationManager.isOverview()).toBe(true);
      expect(
        within(toolbar).getByRole('checkbox', {
          name: 'Close overview',
          checked: true,
        }),
      ).toBeInTheDocument();

      // the next frame is only selected in the overview
      await userEvent.click(
        within(toolbar).getByRole('button', { name: 'Next frame' }),
      );
      expect(presentationManager.isOverview()).toBe(true);
      expect(activeWhiteboardInstance.getActiveFrameElementId()).not.toBe(
        frameId0,
      );

      await userEvent.click(
        within(toolbar).getByRole('checkbox', { name: 'Close overview' }),
      );
      expect(presentationManager.isOverview()).toBe(false);
    });

    it('should not show the overview button in the slide mode', async () => {
      vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
        name === 'REACT_APP_INFINITE_CANVAS' ? 'false' : defaultValue,
      );
      render(<PresentBar />, { wrapper: Wrapper });
      const toolbar = await startPresentation();

      expect(
        within(toolbar).queryByRole('checkbox', { name: 'Show all frames' }),
      ).not.toBeInTheDocument();
      expect(
        within(toolbar).queryByRole('button', { name: 'Transitions' }),
      ).not.toBeInTheDocument();
    });

    it('should have no accessibility violations with the menu open', async () => {
      activeSlide.addElement(mockFrameElement());
      const { baseElement } = render(<PresentBar />, { wrapper: Wrapper });
      const toolbar = await startPresentation();
      await userEvent.click(
        within(toolbar).getByRole('button', { name: 'Transitions' }),
      );

      await act(async () => {
        expect(
          // the menu is rendered in a portal outside of any landmark
          await axe.run(baseElement, { rules: { region: { enabled: false } } }),
        ).toHaveNoViolations();
      });
    });
  });
});
