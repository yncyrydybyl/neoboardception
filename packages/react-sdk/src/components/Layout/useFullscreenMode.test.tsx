/*
 * Copyright 2024 Nordeck IT + Consulting GmbH
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

import { act, renderHook } from '@testing-library/react';
import { ComponentType, PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockFullscreenApi } from '../../lib/testUtils/documentTestUtils';
import { useFullscreenMode } from './useFullscreenMode';

describe('useFullscreenMode', () => {
  let Wrapper: ComponentType<PropsWithChildren<{}>>;

  beforeEach(() => {
    mockFullscreenApi();
    Wrapper = ({ children }) => {
      return <>{children}</>;
    };
  });

  it(
    'should call requestFullscreen() on the documentElement and set isFullscreen to true ' +
      'if calling setFullscreen(true) on the hook',
    async () => {
      const { result } = renderHook(() => useFullscreenMode(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFullscreenMode(true);
      });

      expect(document.documentElement.requestFullscreen).toHaveBeenCalled();
      expect(result.current.isFullscreenMode).toBe(true);
    },
  );

  it(
    'should call exitFullscreen() on the document and set isFullscreen to false ' +
      'if calling setFullscreen(false) on the hook',
    async () => {
      // Pretend being in fullscreen mode by setting the fullscreenElement.
      // Ignore TS and linter here for setting a mocked API.
      // @ts-ignore
      // eslint-disable-next-line
      document.fullscreenElement = {};
      const { result } = renderHook(() => useFullscreenMode(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFullscreenMode(false);
      });

      expect(document.exitFullscreen).toHaveBeenCalled();
      expect(result.current.isFullscreenMode).toBe(false);
    },
  );
  it('should not switch to fullscreen mode if an embedded widget goes fullscreen', () => {
    const mount = document.createElement('div');
    mount.setAttribute('data-embedded-widget-mount', '');
    const iframe = document.createElement('iframe');
    mount.appendChild(iframe);
    document.body.appendChild(mount);
    const { result } = renderHook(() => useFullscreenMode(), {
      wrapper: Wrapper,
    });

    // the widget's iframe becomes the fullscreen element of the board
    act(() => {
      // mocked Fullscreen API: the element the browser reports
      Reflect.set(document, 'fullscreenElement', iframe);
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(result.current.isFullscreenMode).toBe(false);

    act(() => {
      // mocked Fullscreen API: the element the browser reports
      Reflect.set(document, 'fullscreenElement', null);
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(result.current.isFullscreenMode).toBe(false);
    mount.remove();
  });

  it('should stay in fullscreen mode while an embedded widget is fullscreen on top', async () => {
    const mount = document.createElement('div');
    mount.setAttribute('data-embedded-widget-mount', '');
    const iframe = document.createElement('iframe');
    mount.appendChild(iframe);
    document.body.appendChild(mount);
    const { result } = renderHook(() => useFullscreenMode(), {
      wrapper: Wrapper,
    });
    await act(() => result.current.setFullscreenMode(true));
    expect(result.current.isFullscreenMode).toBe(true);

    act(() => {
      // mocked Fullscreen API: the element the browser reports
      Reflect.set(document, 'fullscreenElement', iframe);
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(result.current.isFullscreenMode).toBe(true);
    mount.remove();
  });
});
