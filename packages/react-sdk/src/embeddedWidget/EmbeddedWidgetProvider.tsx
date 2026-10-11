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

import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { EmbeddedWidgetRenderer } from './renderer';
import {
  denyAllEmbeddedWidgetUrls,
  EmbeddedWidgetUrlPolicy,
} from './urlPolicy';

/** Default for {@link EmbeddedWidgetHostConfig.maxLiveWidgets}. */
export const defaultMaxLiveEmbeddedWidgets = 3;

export type EmbeddedWidgetHostConfig = {
  /**
   * Renders the widget into the element. If undefined, only the placeholder
   * is shown.
   */
  renderer?: EmbeddedWidgetRenderer;
  /**
   * Deployment allow-list hook, evaluated before mounting and on insertion.
   * Defaults to {@link denyAllEmbeddedWidgetUrls}: nothing runs unless the
   * deployment configures a policy.
   */
  isUrlAllowed: EmbeddedWidgetUrlPolicy;
  /**
   * Called when a board with an embedded widget element is shown (not for
   * previews), before any widget is activated. Lets the host warm up, e.g.
   * load its widget host code lazily. Must not ask the user for anything.
   */
  preload?: () => void;
  /** Whether users can insert new embedded widgets. */
  insertionEnabled: boolean;
  /**
   * Upper bound of simultaneously mounted widgets on this client. Activating
   * another widget unmounts the least recently activated one that is not
   * pinned (see {@link EmbeddedWidgetHost.setPinned}).
   */
  maxLiveWidgets: number;
};

/**
 * Applies the live-widget cap to `ids` (least recently activated first).
 * Pinned widgets (e.g. a running call) are never dropped; the remaining
 * slots go to the most recently activated other widgets, and the most
 * recently activated one always stays, even if pinned widgets fill the cap.
 */
export function limitLiveElementIds(
  ids: readonly string[],
  pinned: ReadonlySet<string>,
  maxLiveWidgets: number,
): string[] {
  if (ids.length <= maxLiveWidgets) {
    return [...ids];
  }
  const pinnedLive = ids.filter((id) => pinned.has(id)).length;
  const others = ids.filter((id) => !pinned.has(id));
  const keep = new Set(
    others.slice(
      Math.max(0, others.length - Math.max(1, maxLiveWidgets - pinnedLive)),
    ),
  );
  if (maxLiveWidgets <= 0) {
    keep.clear();
  }
  return ids.filter((id) => pinned.has(id) || keep.has(id));
}

export type EmbeddedWidgetHost = EmbeddedWidgetHostConfig & {
  /** Ids of the elements that may mount, least recently activated first. */
  liveElementIds: readonly string[];
  /** Mark an element as live (moves it to the end of the LRU list). */
  activate: (elementId: string) => void;
  deactivate: (elementId: string) => void;
  /**
   * Pin a live element: it is never unmounted to make room for others
   * (used while a call runs). Unpinned again when deactivated.
   */
  setPinned: (elementId: string, pinned: boolean) => void;
  /** Ids of pinned elements. */
  pinnedElementIds: ReadonlySet<string>;
  /** The element that currently receives pointer events, if any. */
  interactingElementId?: string;
  setInteractingElementId: (elementId: string | undefined) => void;
};

const noop = () => {};

const defaultHost: EmbeddedWidgetHost = {
  renderer: undefined,
  preload: undefined,
  isUrlAllowed: denyAllEmbeddedWidgetUrls,
  insertionEnabled: false,
  maxLiveWidgets: 0,
  liveElementIds: [],
  activate: noop,
  deactivate: noop,
  setPinned: noop,
  pinnedElementIds: new Set(),
  interactingElementId: undefined,
  setInteractingElementId: noop,
};

const EmbeddedWidgetHostContext =
  createContext<EmbeddedWidgetHost>(defaultHost);

/**
 * Configure embedded widgets for the board. Without this provider, embedded
 * widget elements are shown as placeholders and cannot be inserted.
 *
 * Live/interaction state is local to this client and never written to the
 * board document.
 */
export function EmbeddedWidgetProvider({
  renderer,
  preload,
  isUrlAllowed = denyAllEmbeddedWidgetUrls,
  insertionEnabled = true,
  maxLiveWidgets = defaultMaxLiveEmbeddedWidgets,
  children,
}: PropsWithChildren<Partial<EmbeddedWidgetHostConfig>>) {
  const [liveElementIds, setLiveElementIds] = useState<string[]>([]);
  const [pinnedElementIds, setPinnedElementIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const pinnedRef = useRef(pinnedElementIds);
  pinnedRef.current = pinnedElementIds;
  const [interactingElementId, setInteractingElementId] = useState<string>();

  const activate = useCallback(
    (elementId: string) =>
      setLiveElementIds((ids) => {
        if (ids.at(-1) === elementId) {
          return ids;
        }
        // Widgets dropped here stay inactive until activated again.
        return limitLiveElementIds(
          [...ids.filter((id) => id !== elementId), elementId],
          pinnedRef.current,
          maxLiveWidgets,
        );
      }),
    [maxLiveWidgets],
  );

  const setPinned = useCallback((elementId: string, pinned: boolean) => {
    setPinnedElementIds((current) => {
      if (current.has(elementId) === pinned) {
        return current;
      }
      const next = new Set(current);
      if (pinned) {
        next.add(elementId);
      } else {
        next.delete(elementId);
      }
      return next;
    });
  }, []);

  const deactivate = useCallback((elementId: string) => {
    setLiveElementIds((ids) =>
      ids.includes(elementId) ? ids.filter((id) => id !== elementId) : ids,
    );
    setPinnedElementIds((current) => {
      if (!current.has(elementId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(elementId);
      return next;
    });
    setInteractingElementId((id) => (id === elementId ? undefined : id));
  }, []);

  // Also applied when reading, so a lowered cap takes effect immediately.
  const cappedLiveElementIds = useMemo(
    () => limitLiveElementIds(liveElementIds, pinnedElementIds, maxLiveWidgets),
    [liveElementIds, pinnedElementIds, maxLiveWidgets],
  );

  const value = useMemo<EmbeddedWidgetHost>(
    () => ({
      renderer,
      preload,
      isUrlAllowed,
      insertionEnabled,
      maxLiveWidgets,
      liveElementIds: cappedLiveElementIds,
      activate,
      deactivate,
      setPinned,
      pinnedElementIds,
      interactingElementId,
      setInteractingElementId,
    }),
    [
      renderer,
      preload,
      isUrlAllowed,
      insertionEnabled,
      maxLiveWidgets,
      cappedLiveElementIds,
      activate,
      deactivate,
      setPinned,
      pinnedElementIds,
      interactingElementId,
    ],
  );

  return (
    <EmbeddedWidgetHostContext.Provider value={value}>
      {children}
    </EmbeddedWidgetHostContext.Provider>
  );
}

export function useEmbeddedWidgetHost(): EmbeddedWidgetHost {
  return useContext(EmbeddedWidgetHostContext);
}

const EmbeddedWidgetPreviewContext = createContext(false);

/**
 * Marks a subtree as a static preview (e.g. slide thumbnails). Embedded
 * widgets inside never mount a renderer and only show the placeholder.
 */
export function EmbeddedWidgetPreview({ children }: PropsWithChildren) {
  return (
    <EmbeddedWidgetPreviewContext.Provider value={true}>
      {children}
    </EmbeddedWidgetPreviewContext.Provider>
  );
}

export function useIsEmbeddedWidgetPreview(): boolean {
  return useContext(EmbeddedWidgetPreviewContext);
}
