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
import { describe, expect, it, vi } from 'vitest';
import {
  EmbeddedWidgetHost,
  EmbeddedWidgetProvider,
  useEmbeddedWidgetHost,
} from './EmbeddedWidgetProvider';

describe('confirmRemoval', () => {
  function setup(provider = true) {
    const host: { current?: EmbeddedWidgetHost } = {};
    function Probe() {
      host.current = useEmbeddedWidgetHost();
      return null;
    }
    render(
      provider ? (
        <EmbeddedWidgetProvider>
          <Probe />
        </EmbeddedWidgetProvider>
      ) : (
        <Probe />
      ),
    );
    return host;
  }

  it('removes right away without a running call', () => {
    const host = setup();
    const remove = vi.fn();
    act(() => host.current!.confirmRemoval(['a', 'b'], remove));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('removes right away without a provider', () => {
    const host = setup(false);
    const remove = vi.fn();
    host.current!.confirmRemoval(['a'], remove);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('asks before removing an element with a running call', () => {
    const host = setup();
    act(() => host.current!.setPinned('call', true));
    const remove = vi.fn();

    act(() => host.current!.confirmRemoval(['a', 'call'], remove));
    const dialog = screen.getByRole('dialog', {
      name: 'The running call will end',
    });
    expect(dialog).toHaveAccessibleDescription(
      'This element holds a running call. Deleting it removes it for everyone, and everyone in the call on this board leaves the call.',
    );
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();

    act(() => host.current!.confirmRemoval(['call'], remove));
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete and end call' }),
    );
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
