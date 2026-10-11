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

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, Mock, vi } from 'vitest';
import { EmbeddedWidgetModalDialog } from './EmbeddedWidgetModalDialog';
import {
  EmbeddedWidgetModal,
  EmbeddedWidgetModalButton,
  EmbeddedWidgetModalStatus,
} from './renderer';

type Callbacks = {
  onButtonsChange: (buttons: EmbeddedWidgetModalButton[]) => void;
  onStatusChange: (status: EmbeddedWidgetModalStatus) => void;
};

function createModal(overrides: Partial<EmbeddedWidgetModal> = {}) {
  let callbacks: Callbacks | undefined;
  const unmount = vi.fn();
  const mount: Mock<EmbeddedWidgetModal['mount']> = vi.fn(
    (container: HTMLElement, cb: Callbacks) => {
      callbacks = cb;
      const iframe = document.createElement('iframe');
      iframe.title = 'modal widget';
      container.appendChild(iframe);
      return () => {
        iframe.remove();
        unmount();
      };
    },
  );
  const modal: EmbeddedWidgetModal = {
    name: 'Create poll',
    origin: 'https://poll.example.org',
    buttons: [
      { id: 'save', label: 'Save', kind: 'm.primary', disabled: true },
      { id: 'm.close', label: 'Cancel', kind: 'm.link', disabled: false },
    ],
    mount,
    clickButton: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
  return { modal, mount, unmount, callbacks: () => callbacks! };
}

describe('<EmbeddedWidgetModalDialog />', () => {
  it('is a dialog labelled by the modal name that hosts the modal widget', () => {
    const { modal, mount } = createModal();
    render(
      <EmbeddedWidgetModalDialog
        elementId="element-0"
        widgetName="Team poll"
        modal={modal}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Create poll' });
    expect(dialog).toHaveAccessibleDescription(
      /Content of the embedded widget from poll\.example\.org/,
    );
    expect(mount).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId('element-element-0-embedded-widget-modal-mount'),
    ).toContainElement(screen.getByTitle('modal widget'));
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  it('falls back to the widget name without a modal name', () => {
    const { modal } = createModal({ name: '' });
    render(
      <EmbeddedWidgetModalDialog
        elementId="element-0"
        widgetName="Team poll"
        modal={modal}
      />,
    );
    expect(
      screen.getByRole('dialog', { name: 'Team poll' }),
    ).toBeInTheDocument();
  });

  it('renders the buttons and follows the widget enabling them', () => {
    const { modal, callbacks } = createModal();
    render(
      <EmbeddedWidgetModalDialog
        elementId="element-0"
        widgetName="Team poll"
        modal={modal}
      />,
    );
    act(() => callbacks().onStatusChange({ state: 'ready' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    act(() =>
      callbacks().onButtonsChange([
        { id: 'save', label: 'Save', kind: 'm.primary', disabled: false },
        { id: 'm.close', label: 'Cancel', kind: 'm.link', disabled: false },
      ]),
    );
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(modal.clickButton).toHaveBeenCalledWith('save');

    // The widget decides what its own close button does.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(modal.clickButton).toHaveBeenCalledWith('m.close');
    expect(modal.cancel).not.toHaveBeenCalled();
  });

  it('cancels with Escape and the close button, not on the backdrop', () => {
    const { modal } = createModal();
    render(
      <EmbeddedWidgetModalDialog
        elementId="element-0"
        widgetName="Team poll"
        modal={modal}
      />,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(modal.cancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(modal.cancel).toHaveBeenCalledTimes(2);
  });

  it('cancels with the close button of a widget that did not load', () => {
    const { modal, callbacks } = createModal();
    render(
      <EmbeddedWidgetModalDialog
        elementId="element-0"
        widgetName="Team poll"
        modal={modal}
      />,
    );
    act(() => callbacks().onStatusChange({ state: 'error' }));
    expect(
      screen.getByText('The content of this dialog could not be loaded.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(modal.cancel).toHaveBeenCalled();
    expect(modal.clickButton).not.toHaveBeenCalled();
  });

  it('explains why the modal widget was stopped', () => {
    const { modal, callbacks } = createModal();
    render(
      <EmbeddedWidgetModalDialog
        elementId="element-0"
        widgetName="Team poll"
        modal={modal}
      />,
    );
    act(() =>
      callbacks().onStatusChange({ state: 'error', code: 'navigated' }),
    );
    expect(
      screen.getByText(
        'The widget opened another page and was stopped for security reasons.',
      ),
    ).toBeInTheDocument();
  });

  it('removes the modal widget when it unmounts', () => {
    const { modal, unmount } = createModal();
    const { unmount: unmountDialog } = render(
      <EmbeddedWidgetModalDialog
        elementId="element-0"
        widgetName="Team poll"
        modal={modal}
      />,
    );
    unmountDialog();
    expect(unmount).toHaveBeenCalled();
  });
});
