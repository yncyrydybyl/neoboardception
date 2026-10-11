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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComponentType, PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Toolbar } from '../components/common/Toolbar';
import { LayoutStateProvider } from '../components/Layout';
import { SlidesProvider } from '../components/Layout/SlidesProvider';
import {
  mockWhiteboardManager,
  WhiteboardTestingContextProvider,
} from '../lib/testUtils/documentTestUtils';
import { WhiteboardManager, WhiteboardSlideInstance } from '../state';
import {
  EmbeddedWidgetHostConfig,
  EmbeddedWidgetProvider,
} from './EmbeddedWidgetProvider';
import { EmbedWidgetButton } from './EmbedWidgetButton';
import { createOriginAllowListPolicy } from './urlPolicy';

describe('<EmbedWidgetButton />', () => {
  let widgetApi: MockedWidgetApi;
  let whiteboardManager: WhiteboardManager;
  let slide: WhiteboardSlideInstance;

  function createWrapper(
    host?: Partial<EmbeddedWidgetHostConfig>,
  ): ComponentType<PropsWithChildren<{}>> {
    return ({ children }) => (
      <LayoutStateProvider>
        <WhiteboardTestingContextProvider
          whiteboardManager={whiteboardManager}
          widgetApi={widgetApi}
        >
          <SlidesProvider>
            {host ? (
              <EmbeddedWidgetProvider {...host}>
                <Toolbar>{children}</Toolbar>
              </EmbeddedWidgetProvider>
            ) : (
              <Toolbar>{children}</Toolbar>
            )}
          </SlidesProvider>
        </WhiteboardTestingContextProvider>
      </LayoutStateProvider>
    );
  }

  beforeEach(() => {
    widgetApi = mockWidgetApi();
    ({ whiteboardManager } = mockWhiteboardManager());
    slide = whiteboardManager
      .getActiveWhiteboardInstance()!
      .getSlide('slide-0');
  });

  afterEach(() => {
    widgetApi.stop();
  });

  it('should render nothing without a provider', () => {
    render(<EmbedWidgetButton />, { wrapper: createWrapper() });

    expect(
      screen.queryByRole('button', { name: 'Embed widget' }),
    ).not.toBeInTheDocument();
  });

  it('should insert an allowed widget', async () => {
    render(<EmbedWidgetButton />, {
      wrapper: createWrapper({
        isUrlAllowed: createOriginAllowListPolicy([
          'https://widgets.example.org',
        ]),
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Embed widget' }));
    const dialog = screen.getByRole('dialog', { name: 'Embed widget' });
    fireEvent.change(screen.getByRole('textbox', { name: /Widget address/ }), {
      target: { value: 'https://widgets.example.org/poll/' },
    });
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Title (optional)' }),
      { target: { value: 'Poll' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Embed' }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    const ids = slide.getElementIds();
    expect(ids).toHaveLength(2);
    expect(slide.getElement(ids[1])).toMatchObject({
      type: 'embedded-widget',
      widgetUrl: 'https://widgets.example.org/poll/',
      title: 'Poll',
      width: 720,
      height: 540,
    });
    expect(slide.getActiveElementIds()).toEqual([ids[1]]);
  });

  it.each([
    [
      'https://evil.example.org/',
      'This widget address is not allowed on this board.',
    ],
    ['http://widgets.example.org/', 'Please enter a valid https address.'],
  ])('should reject %s', (url, message) => {
    render(<EmbedWidgetButton />, {
      wrapper: createWrapper({
        isUrlAllowed: createOriginAllowListPolicy([
          'https://widgets.example.org',
        ]),
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Embed widget' }));
    const submit = screen.getByRole('button', { name: 'Embed' });
    expect(submit).toBeDisabled();
    expect(
      screen.getByText(
        'Only widget addresses approved for this board can be embedded.',
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: /Widget address/ }), {
      target: { value: url },
    });

    // Refused while typing: helper text, "Embed" disabled, Enter ignored.
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(submit).toBeDisabled();
    fireEvent.submit(screen.getByRole('textbox', { name: /Widget address/ }));
    expect(slide.getElementIds()).toHaveLength(1);

    fireEvent.change(screen.getByRole('textbox', { name: /Widget address/ }), {
      target: { value: 'https://widgets.example.org/poll/' },
    });
    expect(submit).toBeEnabled();
    expect(screen.queryByText(message)).not.toBeInTheDocument();
  });
});
