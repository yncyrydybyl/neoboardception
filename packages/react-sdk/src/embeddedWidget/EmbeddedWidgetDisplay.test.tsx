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

import { MockedWidgetApi, mockWidgetApi } from '@matrix-widget-toolkit/testing';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ComponentType, PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { LayoutStateProvider } from '../components/Layout';
import { SlidesProvider } from '../components/Layout/SlidesProvider';
import { whiteboardHeight, whiteboardWidth } from '../components/Whiteboard';
import { SvgCanvas } from '../components/Whiteboard/SvgCanvas';
import {
  mockWhiteboardManager,
  WhiteboardTestingContextProvider,
} from '../lib/testUtils/documentTestUtils';
import { WhiteboardDocument } from '../state';
import { SynchronizedDocument } from '../state/types';
import { EmbeddedWidgetElement } from './element';
import EmbeddedWidgetDisplay from './EmbeddedWidgetDisplay';
import {
  EmbeddedWidgetHostConfig,
  EmbeddedWidgetPreview,
  EmbeddedWidgetProvider,
} from './EmbeddedWidgetProvider';
import {
  EmbeddedWidgetRenderer,
  EmbeddedWidgetRendererProps,
} from './renderer';
import { createOriginAllowListPolicy } from './urlPolicy';

const allowWidgets = createOriginAllowListPolicy([
  'https://widgets.example.org',
]);

const shell: EmbeddedWidgetElement = {
  type: 'embedded-widget',
  position: { x: 10, y: 20 },
  width: 480,
  height: 360,
  widgetUrl: 'https://widgets.example.org/poll/',
  title: 'Team poll',
};

describe('<EmbeddedWidgetDisplay />', () => {
  let widgetApi: MockedWidgetApi;
  let synchronizedDocument: SynchronizedDocument<WhiteboardDocument>;
  let unmountWidget: Mock<() => void>;
  let updateWidget: Mock;
  let renderer: Mock<EmbeddedWidgetRenderer>;
  let lastProps: EmbeddedWidgetRendererProps | undefined;

  function createWrapper(
    host: Partial<EmbeddedWidgetHostConfig> | undefined,
    preview = false,
  ): ComponentType<PropsWithChildren<{}>> {
    const { whiteboardManager, synchronizedDocument: doc } =
      mockWhiteboardManager({
        slides: [['slide-0', [['element-0', shell]]]],
      });
    synchronizedDocument = doc;

    return ({ children }) => {
      let content = (
        <SvgCanvas
          viewportWidth={whiteboardWidth}
          viewportHeight={whiteboardHeight}
        >
          {children}
        </SvgCanvas>
      );
      if (preview) {
        content = <EmbeddedWidgetPreview>{content}</EmbeddedWidgetPreview>;
      }
      if (host) {
        content = (
          <EmbeddedWidgetProvider {...host}>{content}</EmbeddedWidgetProvider>
        );
      }
      return (
        <LayoutStateProvider>
          <WhiteboardTestingContextProvider
            whiteboardManager={whiteboardManager}
            widgetApi={widgetApi}
          >
            <SlidesProvider>{content}</SlidesProvider>
          </WhiteboardTestingContextProvider>
        </LayoutStateProvider>
      );
    };
  }

  function renderDisplay(
    wrapper: ComponentType<PropsWithChildren<{}>>,
    elementId = 'element-0',
    element: EmbeddedWidgetElement = shell,
  ) {
    return render(
      <EmbeddedWidgetDisplay
        elementId={elementId}
        {...element}
        active={false}
        readOnly={false}
      />,
      { wrapper },
    );
  }

  beforeEach(() => {
    widgetApi = mockWidgetApi();
    unmountWidget = vi.fn();
    updateWidget = vi.fn();
    lastProps = undefined;
    renderer = vi.fn((props: EmbeddedWidgetRendererProps) => {
      lastProps = props;
      const iframe = document.createElement('iframe');
      iframe.title = 'inner widget';
      props.container.appendChild(iframe);
      return {
        unmount: () => {
          iframe.remove();
          unmountWidget();
        },
        update: updateWidget,
      };
    });
  });

  afterEach(() => {
    widgetApi.stop();
  });

  it('should render a placeholder with title and URL without a provider', () => {
    renderDisplay(createWrapper(undefined));

    expect(
      screen.getByRole('group', { name: 'Team poll' }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('element-element-0-embedded-widget-url'),
    ).toHaveTextContent('https://widgets.example.org/poll/');
    expect(
      screen.getByText('This widget address is not allowed on this board.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('element-element-0-embedded-widget-mount'),
    ).not.toBeInTheDocument();
  });

  it('should fall back to the host name without a title', () => {
    renderDisplay(createWrapper(undefined), 'element-0', {
      ...shell,
      title: undefined,
    });

    expect(
      screen.getByRole('group', { name: 'widgets.example.org' }),
    ).toBeInTheDocument();
  });

  it('should not mount before the user activates the widget', () => {
    renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));

    expect(renderer).not.toHaveBeenCalled();
    expect(screen.getByText('Widget not loaded.')).toBeInTheDocument();
  });

  it('should mount into the container after activation', () => {
    renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));

    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));

    expect(renderer).toHaveBeenCalledTimes(1);
    expect(lastProps).toMatchObject({
      widgetUrl: 'https://widgets.example.org/poll/',
      elementId: 'element-0',
      title: 'Team poll',
      readOnly: false,
      viewState: { visible: true, gesturing: false, interactive: false },
    });
    const mount = screen.getByTestId('element-element-0-embedded-widget-mount');
    expect(lastProps?.container).toBe(mount);
    expect(mount).toContainElement(screen.getByTitle('inner widget'));
    expect(mount).toHaveStyle({ pointerEvents: 'none' });
    expect(screen.getByText('Loading widget…')).toBeInTheDocument();

    act(() => lastProps?.onStatusChange({ state: 'ready' }));
    expect(
      screen.queryByTestId('element-element-0-embedded-widget-placeholder'),
    ).not.toBeInTheDocument();
  });

  it('should show an error reported by the renderer', () => {
    renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));

    act(() =>
      lastProps?.onStatusChange({ state: 'error', message: 'Rights denied' }),
    );
    // Localised text; the technical message only as details.
    const status = screen.getByTestId(
      'element-element-0-embedded-widget-status',
    );
    expect(status).toHaveTextContent('The widget could not be loaded.');
    expect(status).toHaveAttribute('title', 'Rights denied');
    expect(screen.queryByText('Rights denied')).not.toBeInTheDocument();
  });

  it.each([
    ['policy', 'This widget is not allowed in this deployment.'],
    ['origin-not-allowed', 'This widget is not allowed in this deployment.'],
    ['same-origin', 'Widgets from the board’s own address cannot be embedded.'],
    ['invalid-url', 'The widget address was refused.'],
  ] as const)(
    'should show a localised permanent error (%s) without retry',
    (code, text) => {
      renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));
      fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
      act(() =>
        lastProps?.onStatusChange({
          state: 'error',
          reason: 'load-failed',
          code,
          message: 'technical text',
          retry: vi.fn(),
        }),
      );

      const status = screen.getByTestId(
        'element-element-0-embedded-widget-status',
      );
      expect(status).toHaveTextContent(text);
      expect(status).toHaveAttribute('data-error-code', code);
      expect(
        screen.queryByRole('button', { name: 'Try again' }),
      ).not.toBeInTheDocument();
    },
  );

  it.each([
    ['timeout', 'The widget did not respond in time.'],
    [
      'navigated',
      'The widget opened another page and was stopped for security reasons.',
    ],
    ['load-failed', 'The widget could not be loaded.'],
  ] as const)(
    'should show a localised transient error (%s) with retry',
    (code, text) => {
      renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));
      fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
      const retry = vi.fn();
      act(() =>
        lastProps?.onStatusChange({
          state: 'error',
          reason: code === 'timeout' ? 'timeout' : 'load-failed',
          code,
          message: 'technical text',
          retry,
        }),
      );

      expect(
        screen.getByTestId('element-element-0-embedded-widget-status'),
      ).toHaveTextContent(text);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(retry).toHaveBeenCalledTimes(1);
    },
  );

  it('should deactivate a running widget whose URL changes remotely', () => {
    const { rerender } = renderDisplay(
      createWrapper({ renderer, isUrlAllowed: allowWidgets }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
    act(() => lastProps?.onStatusChange({ state: 'ready' }));
    expect(renderer).toHaveBeenCalledTimes(1);

    rerender(
      <EmbeddedWidgetDisplay
        elementId="element-0"
        {...shell}
        widgetUrl="https://widgets.example.org/other/"
        active={false}
        readOnly={false}
      />,
    );

    // Unmounted, not remounted with the new URL: a new activation is needed.
    expect(unmountWidget).toHaveBeenCalledTimes(1);
    expect(renderer).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId('element-element-0-embedded-widget-mount'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Widget not loaded.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
    expect(renderer).toHaveBeenCalledTimes(2);
    expect(lastProps?.widgetUrl).toBe('https://widgets.example.org/other/');
  });

  it('should not resume after a detour over a URL that is not allowed', () => {
    const { rerender } = renderDisplay(
      createWrapper({ renderer, isUrlAllowed: allowWidgets }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
    const show = (widgetUrl: string) =>
      rerender(
        <EmbeddedWidgetDisplay
          elementId="element-0"
          {...shell}
          widgetUrl={widgetUrl}
          active={false}
          readOnly={false}
        />,
      );

    show('https://evil.example.org/poll/');
    expect(unmountWidget).toHaveBeenCalledTimes(1);
    show(shell.widgetUrl);

    expect(renderer).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Widget not loaded.')).toBeInTheDocument();
  });

  it('should show origin and path, never template parameters', () => {
    renderDisplay(createWrapper(undefined), 'element-0', {
      ...shell,
      widgetUrl:
        'https://call.example.org/room/?roomId=$matrix_room_id&user=$matrix_user_id#/x',
    });
    const url = screen.getByTestId('element-element-0-embedded-widget-url');
    expect(url).toHaveTextContent('https://call.example.org/room/');
    expect(url).toHaveAttribute('title', 'https://call.example.org/room/');
    expect(url.textContent).not.toContain('$matrix');
    expect(
      screen.getByRole('group', { name: 'Team poll' }),
    ).toBeInTheDocument();
  });

  it('should show only the origin if the path holds a template variable', () => {
    renderDisplay(createWrapper(undefined), 'element-0', {
      ...shell,
      widgetUrl: 'https://call.example.org/$matrix_room_id/?a=1',
    });
    expect(
      screen.getByTestId('element-element-0-embedded-widget-url'),
    ).toHaveTextContent(/^https:\/\/call\.example\.org$/);
  });

  it('should leave the interaction with the "Leave widget" button', () => {
    renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
    act(() => lastProps?.onStatusChange({ state: 'ready' }));
    const mount = screen.getByTestId('element-element-0-embedded-widget-mount');
    expect(
      screen.queryByRole('button', { name: 'Leave widget' }),
    ).not.toBeInTheDocument();

    fireEvent.doubleClick(
      screen.getByTestId('element-element-0-embedded-widget-content'),
    );
    expect(mount).toHaveStyle({ pointerEvents: 'auto' });
    // One in the status bar, one after the widget for keyboard users.
    const buttons = screen.getAllByRole('button', { name: 'Leave widget' });
    expect(buttons).toHaveLength(2);

    fireEvent.click(buttons[0]);
    expect(mount).toHaveStyle({ pointerEvents: 'none' });
    expect(
      screen.queryByRole('button', { name: 'Leave widget' }),
    ).not.toBeInTheDocument();

    fireEvent.doubleClick(
      screen.getByTestId('element-element-0-embedded-widget-content'),
    );
    fireEvent.click(
      screen.getByTestId('element-element-0-embedded-widget-leave-after'),
    );
    expect(mount).toHaveStyle({ pointerEvents: 'none' });
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  it('should warn about permissions that are not available here', () => {
    renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
    act(() =>
      lastProps?.onStatusChange({
        state: 'ready',
        limits: {
          requested: [
            'org.matrix.msc2762.send.event:net.example.vote',
            'org.matrix.msc2762.receive.event:net.example.vote',
            'org.matrix.msc2762.timeline:*',
          ],
          blocked: ['org.matrix.msc2762.timeline:*'],
        },
      }),
    );
    const bar = screen.getByTestId(
      'element-element-0-embedded-widget-statusbar',
    );
    expect(bar).toHaveAttribute('data-support', 'limited');
    expect(bar).toHaveTextContent('Ready – double-click to use');
    const limits = screen.getByTestId(
      'element-element-0-embedded-widget-limits',
    );
    expect(limits).toHaveTextContent('1 of 3 permissions not available here');
    expect(limits).toHaveAttribute(
      'title',
      'This board does not grant: org.matrix.msc2762.timeline:*',
    );
    expect(within(bar).getByRole('status')).toHaveTextContent(
      'Team poll: Ready – double-click to use. 1 of 3 permissions not available here',
    );
  });

  it('should show "not supported" when every write permission is blocked', () => {
    renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
    act(() =>
      lastProps?.onStatusChange({
        state: 'ready',
        limits: {
          requested: [
            'org.matrix.msc2762.send.event:net.example.vote',
            'org.matrix.msc2762.receive.event:net.example.vote',
          ],
          blocked: ['org.matrix.msc2762.send.event:net.example.vote'],
        },
      }),
    );
    const bar = screen.getByTestId(
      'element-element-0-embedded-widget-statusbar',
    );
    expect(bar).toHaveAttribute('data-support', 'unsupported');
    expect(
      screen.getByTestId('element-element-0-embedded-widget-state'),
    ).toHaveTextContent('Not supported here');
    expect(bar).not.toHaveTextContent('Ready');
    expect(within(bar).getByRole('status')).toHaveTextContent(
      'Team poll: Not supported here. 1 of 2 permissions not available here',
    );
  });

  it('should accept a cleanup function as renderer result', () => {
    const cleanup = vi.fn();
    const { unmount } = renderDisplay(
      createWrapper({ renderer: () => cleanup, isUrlAllowed: allowWidgets }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));

    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('should enter and leave the interaction state', () => {
    renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
    const mount = screen.getByTestId('element-element-0-embedded-widget-mount');

    fireEvent.doubleClick(
      screen.getByTestId('element-element-0-embedded-widget-content'),
    );
    expect(mount).toHaveStyle({ pointerEvents: 'auto' });
    expect(updateWidget).toHaveBeenLastCalledWith({
      visible: true,
      gesturing: false,
      interactive: true,
    });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mount).toHaveStyle({ pointerEvents: 'none' });

    fireEvent.doubleClick(
      screen.getByTestId('element-element-0-embedded-widget-content'),
    );
    expect(mount).toHaveStyle({ pointerEvents: 'auto' });
    act(() => lastProps?.exitInteraction());
    expect(mount).toHaveStyle({ pointerEvents: 'none' });

    fireEvent.doubleClick(
      screen.getByTestId('element-element-0-embedded-widget-content'),
    );
    expect(mount).toHaveStyle({ pointerEvents: 'auto' });
    fireEvent.pointerDown(document.body);
    expect(mount).toHaveStyle({ pointerEvents: 'none' });
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  it('should unmount the widget on unmount of the element', () => {
    const { unmount } = renderDisplay(
      createWrapper({ renderer, isUrlAllowed: allowWidgets }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));

    unmount();
    expect(unmountWidget).toHaveBeenCalledTimes(1);
  });

  it('should cap the number of live widgets', () => {
    const wrapper = createWrapper({
      renderer,
      isUrlAllowed: allowWidgets,
      maxLiveWidgets: 1,
    });
    render(
      <>
        <EmbeddedWidgetDisplay
          elementId="a"
          {...shell}
          title="A"
          active={false}
          readOnly={false}
        />
        <EmbeddedWidgetDisplay
          elementId="b"
          {...shell}
          title="B"
          active={false}
          readOnly={false}
        />
      </>,
      { wrapper },
    );

    const [loadA, loadB] = screen.getAllByRole('button', {
      name: 'Load widget',
    });
    fireEvent.click(loadA);
    expect(screen.getByTestId('element-a-embedded-widget-mount')).toBeVisible();

    fireEvent.click(loadB);
    expect(unmountWidget).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId('element-a-embedded-widget-mount'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('element-b-embedded-widget-mount'),
    ).toBeInTheDocument();
  });

  it('should never evict a pinned widget (running call)', () => {
    const wrapper = createWrapper({
      renderer,
      isUrlAllowed: allowWidgets,
      maxLiveWidgets: 1,
    });
    render(
      <>
        {['a', 'b', 'c'].map((id) => (
          <EmbeddedWidgetDisplay
            key={id}
            elementId={id}
            {...shell}
            title={id}
            active={false}
            readOnly={false}
          />
        ))}
      </>,
      { wrapper },
    );
    const propsOf = (id: string) =>
      renderer.mock.calls.map(([p]) => p).find((p) => p.elementId === id)!;

    const [loadA] = screen.getAllByRole('button', { name: 'Load widget' });
    fireEvent.click(loadA);
    act(() => propsOf('a').setKeepAlive?.(true));
    expect(
      screen.getByTestId('element-a-embedded-widget-content'),
    ).toHaveAttribute('data-pinned', 'true');

    // B and C take turns in the remaining slot; A keeps running.
    fireEvent.click(screen.getAllByRole('button', { name: 'Load widget' })[0]);
    expect(
      screen.getByTestId('element-b-embedded-widget-mount'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Load widget' })[0]);
    expect(
      screen.getByTestId('element-a-embedded-widget-mount'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('element-b-embedded-widget-mount'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('element-c-embedded-widget-mount'),
    ).toBeInTheDocument();
    expect(unmountWidget).toHaveBeenCalledTimes(1);

    // The call ends: A is unpinned and the cap applies again.
    act(() => propsOf('a').setKeepAlive?.(false));
    expect(
      screen.getByTestId('element-a-embedded-widget-content'),
    ).not.toHaveAttribute('data-pinned');
    expect(
      screen.queryByTestId('element-a-embedded-widget-mount'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('element-c-embedded-widget-mount'),
    ).toBeInTheDocument();
  });

  it('should not remount a removed element that comes back without a new activation', () => {
    const wrapper = createWrapper({ renderer, isUrlAllowed: allowWidgets });
    const Board = ({ ids }: { ids: string[] }) => (
      <>
        {ids.map((id) => (
          <EmbeddedWidgetDisplay
            key={id}
            elementId={id}
            {...shell}
            title={id}
            active={false}
            readOnly={false}
          />
        ))}
      </>
    );
    const { rerender } = render(<Board ids={['a']} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
    expect(renderer).toHaveBeenCalledTimes(1);

    // removed from the document (e.g. deleted by another user) …
    rerender(<Board ids={[]} />);
    expect(unmountWidget).toHaveBeenCalledTimes(1);

    // … and restored (undo): placeholder again, nothing mounted
    rerender(<Board ids={['a']} />);
    expect(
      screen.getByRole('button', { name: 'Load widget' }),
    ).toBeInTheDocument();
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  it('should free the live slot of a removed element', () => {
    const wrapper = createWrapper({
      renderer,
      isUrlAllowed: allowWidgets,
      maxLiveWidgets: 2,
    });
    const Board = ({ ids }: { ids: string[] }) => (
      <>
        {ids.map((id) => (
          <EmbeddedWidgetDisplay
            key={id}
            elementId={id}
            {...shell}
            title={id}
            active={false}
            readOnly={false}
          />
        ))}
      </>
    );
    const { rerender } = render(<Board ids={['a', 'b']} />, { wrapper });
    for (const button of screen.getAllByRole('button', {
      name: 'Load widget',
    })) {
      fireEvent.click(button);
    }
    expect(renderer).toHaveBeenCalledTimes(2);

    rerender(<Board ids={['a', 'c']} />);
    expect(unmountWidget).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));

    // "a" keeps running: the removed "b" must not hold a slot
    expect(unmountWidget).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('element-a-embedded-widget-mount')).toBeVisible();
    expect(
      screen.getByTestId('element-c-embedded-widget-mount'),
    ).toBeInTheDocument();
  });

  it('should unpin and deactivate a deleted pinned (call) element', () => {
    const wrapper = createWrapper({
      renderer,
      isUrlAllowed: allowWidgets,
      maxLiveWidgets: 1,
    });
    const Board = ({ ids }: { ids: string[] }) => (
      <>
        {ids.map((id) => (
          <EmbeddedWidgetDisplay
            key={id}
            elementId={id}
            {...shell}
            title={id}
            active={false}
            readOnly={false}
          />
        ))}
      </>
    );
    const { rerender } = render(<Board ids={['a', 'b']} />, { wrapper });
    const lastPropsOf = (id: string) =>
      renderer.mock.calls
        .map(([p]) => p)
        .filter((p) => p.elementId === id)
        .at(-1)!;

    fireEvent.click(screen.getAllByRole('button', { name: 'Load widget' })[0]);
    act(() => lastPropsOf('a').setKeepAlive?.(true));
    expect(
      screen.getByTestId('element-a-embedded-widget-content'),
    ).toHaveAttribute('data-pinned', 'true');

    // the running call element is deleted: its call ends with it
    rerender(<Board ids={['b']} />);
    expect(unmountWidget).toHaveBeenCalledTimes(1);

    // restored (undo): neither live nor pinned
    rerender(<Board ids={['a', 'b']} />);
    expect(
      screen.getByTestId('element-a-embedded-widget-content'),
    ).not.toHaveAttribute('data-pinned');
    expect(
      screen.queryByTestId('element-a-embedded-widget-mount'),
    ).not.toBeInTheDocument();
    expect(renderer).toHaveBeenCalledTimes(1);

    // re-activated without a new pin, it is evicted by the cap again
    fireEvent.click(screen.getAllByRole('button', { name: 'Load widget' })[0]);
    expect(renderer).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
    expect(
      screen.queryByTestId('element-a-embedded-widget-mount'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('element-b-embedded-widget-mount'),
    ).toBeInTheDocument();
  });

  it('should never mount in a preview', () => {
    renderDisplay(
      createWrapper({ renderer, isUrlAllowed: allowWidgets }, true),
    );

    expect(
      screen.queryByRole('button', { name: 'Load widget' }),
    ).not.toBeInTheDocument();
    expect(renderer).not.toHaveBeenCalled();
  });

  it('should not mount a URL that is not allowed', () => {
    renderDisplay(
      createWrapper({
        renderer,
        isUrlAllowed: createOriginAllowListPolicy([
          'https://other.example.org',
        ]),
      }),
    );

    expect(
      screen.queryByRole('button', { name: 'Load widget' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('This widget address is not allowed on this board.'),
    ).toBeInTheDocument();
    expect(renderer).not.toHaveBeenCalled();
  });

  it('should never write widget state into the board document', () => {
    renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));
    const before = synchronizedDocument.getDocument().store();
    const json = synchronizedDocument.getDocument().getData().toJSON();

    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
    act(() => lastProps?.onStatusChange({ state: 'ready' }));
    fireEvent.doubleClick(
      screen.getByTestId('element-element-0-embedded-widget-content'),
    );
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(synchronizedDocument.getDocument().store()).toEqual(before);
    expect(synchronizedDocument.getDocument().getData().toJSON()).toEqual(json);
  });

  it('should ask for local consent naming the widget and its origin', () => {
    renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
    const respond = vi.fn();

    act(() =>
      lastProps?.onStatusChange({
        state: 'consent',
        request: {
          origin: 'https://widgets.example.org',
          url: 'https://widgets.example.org/poll/',
          capabilities: [
            'org.matrix.msc2762.send.event:net.example.vote',
            'org.matrix.msc2762.receive.state_event:m.room.member',
          ],
          upstream: ['org.matrix.msc2762.send.event:net.example.vote'],
        },
        respond,
      }),
    );

    const consent = screen.getByRole('group', {
      name: '“Team poll” wants to access this room',
    });
    expect(consent).toHaveTextContent('Origin: https://widgets.example.org');
    expect(consent).toHaveTextContent(
      'Writes (visible to everyone in the room): net.example.vote',
    );
    expect(consent).toHaveTextContent(
      'Reads the member list of this room (personal data)',
    );
    expect(
      screen.getByTestId('element-element-0-embedded-widget-state'),
    ).toHaveTextContent('Asking for permissions');

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(respond).toHaveBeenCalledWith(true);
  });

  it('should explain the client dialog while it is open', () => {
    renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));

    act(() =>
      lastProps?.onStatusChange({
        state: 'negotiating',
        awaitingClient: true,
        origin: 'https://widgets.example.org',
      }),
    );

    expect(
      screen.getByRole('group', {
        name: 'Please confirm in the dialog of your Matrix client',
      }),
    ).toHaveTextContent(
      'The request comes from the embedded widget “Team poll” (https://widgets.example.org)',
    );
  });

  it('should offer a retry when no permission was granted', () => {
    renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
    const retry = vi.fn();

    act(() =>
      lastProps?.onStatusChange({ state: 'error', reason: 'denied', retry }),
    );

    expect(
      screen.getByText('The widget did not get any permission and cannot run.'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('element-element-0-embedded-widget-state'),
    ).toHaveTextContent('Error');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('should show focus and private/shared context with icon and text', () => {
    vi.useFakeTimers();
    try {
      renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));
      fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
      act(() => lastProps?.onStatusChange({ state: 'ready' }));
      const bar = screen.getByTestId(
        'element-element-0-embedded-widget-statusbar',
      );
      expect(bar).toHaveAttribute('data-state', 'ready');
      expect(bar).toHaveTextContent('Ready – double-click to use');
      expect(bar).toHaveAttribute('data-context', 'none');

      fireEvent.doubleClick(
        screen.getByTestId('element-element-0-embedded-widget-content'),
      );
      expect(bar).toHaveAttribute('data-state', 'interacting');
      expect(bar).toHaveTextContent('Only you see this');
      expect(screen.getByRole('status')).toHaveTextContent(
        'Team poll: You are in the widget',
      );

      act(() =>
        lastProps?.onActivity({
          kind: 'shared-change',
          eventType: 'net.example.vote',
        }),
      );
      expect(bar).toHaveAttribute('data-context', 'shared');
      expect(bar).toHaveTextContent('Everyone sees this now');

      act(() => vi.advanceTimersByTime(3000));
      expect(bar).toHaveAttribute('data-context', 'private');
    } finally {
      vi.useRealTimers();
    }
  });

  it('should name a pre-approved widget in a non-blocking notice', () => {
    renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
    const preapproved = { origin: 'https://widgets.example.org', name: 'Poll' };

    act(() => lastProps?.onStatusChange({ state: 'negotiating', preapproved }));
    // No consent panel, nothing to click.
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    const bar = screen.getByTestId(
      'element-element-0-embedded-widget-statusbar',
    );
    expect(bar).toHaveAttribute('data-context', 'preapproved');

    act(() => lastProps?.onStatusChange({ state: 'ready', preapproved }));
    expect(bar).toHaveAttribute('data-state', 'ready');
    expect(bar).toHaveTextContent('Approved by your administrator');
    expect(
      screen.getByTestId('element-element-0-embedded-widget-context'),
    ).toHaveAttribute(
      'title',
      'Your administrator approved the permissions of “Poll” (https://widgets.example.org) in advance.',
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Team poll: Ready – double-click to use. Your administrator approved the permissions of “Poll” (https://widgets.example.org) in advance.',
    );

    // Interacting takes precedence over the notice.
    fireEvent.doubleClick(
      screen.getByTestId('element-element-0-embedded-widget-content'),
    );
    expect(bar).toHaveAttribute('data-context', 'private');
  });

  it('should let the host warm up when a widget element is shown', () => {
    const preload = vi.fn();
    renderDisplay(
      createWrapper({ renderer, preload, isUrlAllowed: allowWidgets }),
    );
    expect(preload).toHaveBeenCalled();
    expect(renderer).not.toHaveBeenCalled();
  });

  it('should not warm up in a preview', () => {
    const preload = vi.fn();
    renderDisplay(
      createWrapper({ renderer, preload, isUrlAllowed: allowWidgets }, true),
    );
    expect(preload).not.toHaveBeenCalled();
  });
  it('should show a modal of the widget in a board dialog', () => {
    renderDisplay(createWrapper({ renderer, isUrlAllowed: allowWidgets }));
    fireEvent.click(screen.getByRole('button', { name: 'Load widget' }));
    act(() => lastProps?.onStatusChange({ state: 'ready' }));

    const cancel = vi.fn();
    act(() =>
      lastProps?.onModalChange?.({
        name: 'Create poll',
        origin: 'https://widgets.example.org',
        buttons: [],
        mount: () => () => {},
        clickButton: vi.fn(),
        cancel,
      }),
    );
    expect(
      screen.getByRole('dialog', { name: 'Create poll' }),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(cancel).toHaveBeenCalled();

    act(() => lastProps?.onModalChange?.(undefined));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
