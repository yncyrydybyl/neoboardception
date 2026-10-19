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

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getIgnoreReducedMotion,
  ignoreReducedMotionStorageKey,
  setIgnoreReducedMotion,
  useReducedMotionPreference,
} from './reducedMotion';

function mockMatchMedia(reduce: boolean) {
  return vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion: reduce'),
    media: query,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('reduced motion preference', () => {
  const matchMedia = window.matchMedia;

  beforeEach(() => {
    setIgnoreReducedMotion(false);
    localStorage.clear();
  });

  afterEach(() => {
    window.matchMedia = matchMedia;
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('is off by default', () => {
    expect(getIgnoreReducedMotion()).toBe(false);
  });

  it('stores the choice per device', () => {
    setIgnoreReducedMotion(true);
    expect(localStorage.getItem(ignoreReducedMotionStorageKey)).toBe('true');
    expect(getIgnoreReducedMotion()).toBe(true);

    setIgnoreReducedMotion(false);
    expect(localStorage.getItem(ignoreReducedMotionStorageKey)).toBeNull();
    expect(getIgnoreReducedMotion()).toBe(false);
  });

  it('keeps the choice for the page if the storage is not available', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);

    expect(getIgnoreReducedMotion()).toBe(false);

    expect(() => setIgnoreReducedMotion(true)).not.toThrow();
    expect(getIgnoreReducedMotion()).toBe(true);

    expect(() => setIgnoreReducedMotion(false)).not.toThrow();
    expect(getIgnoreReducedMotion()).toBe(false);
  });

  it('follows the system without a choice', () => {
    window.matchMedia = mockMatchMedia(true);

    const { result } = renderHook(() => useReducedMotionPreference());

    expect(result.current).toMatchObject({
      systemPrefersReducedMotion: true,
      ignoreReducedMotion: false,
      reducedMotion: true,
    });
  });

  it('plays transitions anyway if the viewer chose so', () => {
    window.matchMedia = mockMatchMedia(true);

    const { result } = renderHook(() => useReducedMotionPreference());
    act(() => result.current.setIgnoreReducedMotion(true));

    expect(result.current).toMatchObject({
      systemPrefersReducedMotion: true,
      ignoreReducedMotion: true,
      reducedMotion: false,
    });
    expect(getIgnoreReducedMotion()).toBe(true);
  });

  it('updates on changes in another tab', () => {
    window.matchMedia = mockMatchMedia(true);
    const { result } = renderHook(() => useReducedMotionPreference());

    act(() => {
      localStorage.setItem(ignoreReducedMotionStorageKey, 'true');
      window.dispatchEvent(
        new StorageEvent('storage', { key: ignoreReducedMotionStorageKey }),
      );
    });

    expect(result.current.reducedMotion).toBe(false);
  });

  it('has no reduced motion without the system setting', () => {
    window.matchMedia = mockMatchMedia(false);

    const { result } = renderHook(() => useReducedMotionPreference());

    expect(result.current.systemPrefersReducedMotion).toBe(false);
    expect(result.current.reducedMotion).toBe(false);
  });
});
