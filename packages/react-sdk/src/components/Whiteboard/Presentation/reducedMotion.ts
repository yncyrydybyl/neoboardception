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

import { useMediaQuery } from '@mui/material';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * Key in the local storage of the browser: the user of this device wants to
 * see the presentation transitions although the system asks for reduced
 * motion.
 */
export const ignoreReducedMotionStorageKey =
  'neoboard.presentation.ignoreReducedMotion';

export const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

const listeners = new Set<() => void>();

/** The choice for this page if the storage is not available. */
let memoryValue = false;

/**
 * Whether transitions play although the system asks for reduced motion.
 * Defaults to false. If the storage is not available, the choice lasts until
 * the page is reloaded.
 */
export function getIgnoreReducedMotion(): boolean {
  try {
    return localStorage.getItem(ignoreReducedMotionStorageKey) === 'true';
  } catch {
    return memoryValue;
  }
}

/** Store the choice for this device (best effort). */
export function setIgnoreReducedMotion(value: boolean): void {
  memoryValue = value;

  try {
    if (value) {
      localStorage.setItem(ignoreReducedMotionStorageKey, 'true');
    } else {
      localStorage.removeItem(ignoreReducedMotionStorageKey);
    }
  } catch {
    // the storage may be blocked (private mode, site data settings)
  }

  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === ignoreReducedMotionStorageKey) {
      listener();
    }
  };

  listeners.add(listener);
  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export type ReducedMotionPreference = {
  /** The system of the viewer asks for reduced motion. */
  systemPrefersReducedMotion: boolean;
  /** The viewer wants transitions anyway (stored per device). */
  ignoreReducedMotion: boolean;
  setIgnoreReducedMotion: (value: boolean) => void;
  /** Transitions play as fades on this device. */
  reducedMotion: boolean;
};

/**
 * Reduced motion for the presentation transitions on this device: the
 * system setting, unless the viewer chose to play the transitions anyway.
 */
export function useReducedMotionPreference(): ReducedMotionPreference {
  const systemPrefersReducedMotion = useMediaQuery(reducedMotionQuery);
  const ignoreReducedMotion = useSyncExternalStore(
    subscribe,
    getIgnoreReducedMotion,
    () => false,
  );
  const set = useCallback(
    (value: boolean) => setIgnoreReducedMotion(value),
    [],
  );

  return {
    systemPrefersReducedMotion,
    ignoreReducedMotion,
    setIgnoreReducedMotion: set,
    reducedMotion: systemPrefersReducedMotion && !ignoreReducedMotion,
  };
}
