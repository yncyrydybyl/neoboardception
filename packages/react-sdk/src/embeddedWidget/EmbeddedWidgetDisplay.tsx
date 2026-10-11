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

import { Box, keyframes } from '@mui/material';
import loglevel from 'loglevel';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ElementFrameOverlay } from '../components/elements/ElementFrameOverlay';
import {
  ElementContextMenu,
  MoveableElement,
  SelectableElement,
  WithExtendedSelectionProps,
} from '../components/Whiteboard';
import { EmbeddedWidgetElement } from './element';
import { EmbeddedWidgetConsent } from './EmbeddedWidgetConsent';
import {
  EmbeddedWidgetPlaceholder,
  EmbeddedWidgetPlaceholderReason,
} from './EmbeddedWidgetPlaceholder';
import {
  useEmbeddedWidgetHost,
  useIsEmbeddedWidgetPreview,
} from './EmbeddedWidgetProvider';
import {
  EmbeddedWidgetLiveState,
  EmbeddedWidgetStatusBar,
} from './EmbeddedWidgetStatusBar';
import {
  EmbeddedWidgetMountHandle,
  EmbeddedWidgetRuntimeStatus,
  EmbeddedWidgetViewState,
} from './renderer';
import { checkEmbeddedWidgetUrl } from './urlPolicy';
import { useEmbeddedWidgetViewport } from './viewport';

export type EmbeddedWidgetDisplayProps = EmbeddedWidgetElement &
  WithExtendedSelectionProps;

/** How long the "everyone sees this now" indication stays visible. */
export const sharedChangeDurationMs = 2500;

const sharedGlow = (color: string) => keyframes`
  0% { box-shadow: inset 0 0 0 0 ${color}; }
  15% { box-shadow: inset 0 0 0 8px ${color}; }
  100% { box-shadow: inset 0 0 0 0 ${color}; }
`;

function getDisplayName(title: string | undefined, widgetUrl: string): string {
  if (title && title.trim() !== '') {
    return title;
  }
  try {
    return new URL(widgetUrl).hostname;
  } catch {
    return widgetUrl;
  }
}

function getOrigin(widgetUrl: string): string {
  try {
    return new URL(widgetUrl).origin;
  } catch {
    return widgetUrl;
  }
}

/**
 * Board element that shows an embedded widget.
 *
 * Renders a placeholder by default. Only if a renderer is configured, the URL
 * is allowed, the element is not part of a preview, and the element is live
 * (activated by the user or host, within the live-widget cap), the renderer
 * mounts the widget into an empty container. The container only receives
 * pointer events while the user interacts with the widget (double click to
 * enter; pointer down outside of the element or Escape to leave) and is
 * hidden during pan/zoom gestures and while off-viewport.
 */
function EmbeddedWidgetDisplay({
  widgetUrl,
  title,
  capabilities,
  width,
  height,
  position,
  active,
  readOnly,
  elementId,
  activeElementIds = [],
  elements = {},
  elementMovedHasFrame,
}: EmbeddedWidgetDisplayProps) {
  const {
    renderer,
    preload,
    isUrlAllowed,
    liveElementIds,
    activate,
    deactivate,
    setPinned,
    pinnedElementIds,
    interactingElementId,
    setInteractingElementId,
  } = useEmbeddedWidgetHost();
  const setPinnedRef = useRef(setPinned);
  setPinnedRef.current = setPinned;
  const isPreview = useIsEmbeddedWidgetPreview();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<EmbeddedWidgetRuntimeStatus>();
  const [sharedChange, setSharedChange] = useState(false);
  const sharedChangeTimer = useRef<ReturnType<typeof setTimeout>>();

  const urlCheck = useMemo(
    () => checkEmbeddedWidgetUrl(widgetUrl, isUrlAllowed),
    [widgetUrl, isUrlAllowed],
  );
  const canActivate = !isPreview && renderer !== undefined && urlCheck.allowed;
  const isLive = canActivate && liveElementIds.includes(elementId);
  const interactive = isLive && interactingElementId === elementId;

  const { visible, gesturing } = useEmbeddedWidgetViewport({
    offsetX: position.x,
    offsetY: position.y,
    width,
    height,
  });
  const viewState = useMemo<EmbeddedWidgetViewState>(
    () => ({ visible, gesturing, interactive }),
    [visible, gesturing, interactive],
  );
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;

  // Title changes must not remount; capabilities remount by value.
  const titleRef = useRef(title);
  titleRef.current = title;
  const capabilitiesKey = capabilities?.join('\n');

  const handleRef = useRef<EmbeddedWidgetMountHandle>();
  const exitInteractionRef = useRef(() => {});
  exitInteractionRef.current = () => {
    if (interactingElementId === elementId) {
      setInteractingElementId(undefined);
    }
  };

  // A board with an embedded widget is shown: let the host warm up.
  useEffect(() => {
    if (canActivate) {
      preload?.();
    }
  }, [canActivate, preload]);

  useEffect(() => () => clearTimeout(sharedChangeTimer.current), []);

  // An element that leaves the board (deleted, also by another user) gives
  // up its live slot and its pin (a running call ends with the element). If
  // it comes back (undo), it needs a new activation. Previews render the
  // same element id and must not touch the live or pinned set.
  useEffect(() => {
    if (isPreview) {
      return;
    }
    return () => deactivate(elementId);
  }, [isPreview, deactivate, elementId]);

  useEffect(() => {
    if (!isLive || !renderer || !container) {
      return;
    }

    let mounted = true;
    setStatus({ state: 'loading' });

    try {
      const result = renderer({
        container,
        widgetUrl,
        elementId,
        title: titleRef.current,
        capabilities:
          capabilitiesKey !== undefined
            ? capabilitiesKey.split('\n').filter((c) => c !== '')
            : undefined,
        readOnly,
        viewState: viewStateRef.current,
        onStatusChange: (newStatus) => {
          if (mounted) {
            setStatus(newStatus);
          }
        },
        exitInteraction: () => {
          if (mounted) {
            exitInteractionRef.current();
          }
        },
        setKeepAlive: (keepAlive) => {
          // Releasing is always allowed (also during unmount).
          if (mounted || !keepAlive) {
            setPinnedRef.current(elementId, keepAlive);
          }
        },
        onActivity: (activity) => {
          if (mounted && activity.kind === 'shared-change') {
            clearTimeout(sharedChangeTimer.current);
            setSharedChange(true);
            sharedChangeTimer.current = setTimeout(
              () => setSharedChange(false),
              sharedChangeDurationMs,
            );
          }
        },
      });
      handleRef.current =
        typeof result === 'function' ? { unmount: result } : result;
    } catch (error) {
      loglevel.error('Embedded widget renderer failed to mount', error);
      setStatus({ state: 'error' });
    }

    return () => {
      mounted = false;
      setPinnedRef.current(elementId, false);
      const handle = handleRef.current;
      handleRef.current = undefined;
      try {
        handle?.unmount();
      } catch (error) {
        loglevel.error('Embedded widget renderer failed to unmount', error);
      }
      setStatus(undefined);
    };
  }, [
    isLive,
    renderer,
    container,
    widgetUrl,
    elementId,
    capabilitiesKey,
    readOnly,
  ]);

  // Deliver view state changes to the mounted renderer.
  useEffect(() => {
    try {
      handleRef.current?.update?.(viewState);
    } catch (error) {
      loglevel.error('Embedded widget renderer failed to update', error);
    }
  }, [viewState]);

  // Leave the interaction state on pointer down outside or on Escape.
  useEffect(() => {
    if (!interactive) {
      return;
    }

    const leave = () => setInteractingElementId(undefined);
    const handlePointerDown = (event: PointerEvent) => {
      if (
        wrapperRef.current &&
        event.target instanceof Node &&
        wrapperRef.current.contains(event.target)
      ) {
        return;
      }
      leave();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        leave();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [interactive, setInteractingElementId]);

  const handleActivate = () => activate(elementId);
  const handleDoubleClick = () => {
    if (isLive) {
      setInteractingElementId(elementId);
    }
  };

  const displayName = getDisplayName(title, widgetUrl);
  const origin = getOrigin(widgetUrl);
  const hidden = gesturing || !visible;
  let placeholderReason: EmbeddedWidgetPlaceholderReason | undefined;
  let consentPanel: React.ReactNode;
  if (isPreview) {
    placeholderReason = 'preview';
  } else if (!urlCheck.allowed) {
    placeholderReason = urlCheck.reason === 'policy' ? 'blocked' : 'invalid';
  } else if (!isLive) {
    placeholderReason = 'inactive';
  } else if (status?.state === 'error') {
    placeholderReason = status.reason === 'denied' ? 'denied' : 'error';
  } else if (status?.state === 'consent') {
    consentPanel = (
      <EmbeddedWidgetConsent
        mode="consent"
        elementId={elementId}
        name={displayName}
        origin={status.request.origin}
        request={status.request}
        onRespond={status.respond}
      />
    );
  } else if (status?.state === 'negotiating' && status.awaitingClient) {
    consentPanel = (
      <EmbeddedWidgetConsent
        mode="awaiting-client"
        elementId={elementId}
        name={displayName}
        origin={status.origin ?? origin}
      />
    );
  } else if (status?.state !== 'ready') {
    placeholderReason = 'loading';
  } else if (hidden) {
    placeholderReason = 'suspended';
  }

  let liveState: EmbeddedWidgetLiveState = 'loading';
  if (status?.state === 'error') {
    liveState = 'error';
  } else if (status?.state === 'consent' || status?.state === 'negotiating') {
    liveState = 'permissions';
  } else if (status?.state === 'ready') {
    liveState = interactive ? 'interacting' : hidden ? 'suspended' : 'ready';
  }
  const showSharedChange = sharedChange && status?.state === 'ready';
  const preapproved =
    status?.state === 'ready' || status?.state === 'negotiating'
      ? status.preapproved
      : undefined;

  const renderedChild = (
    <foreignObject
      data-testid={`element-${elementId}-embedded-widget`}
      x={position.x}
      y={position.y}
      width={width}
      height={height}
    >
      <Box
        ref={wrapperRef}
        data-testid={`element-${elementId}-embedded-widget-content`}
        onDoubleClick={handleDoubleClick}
        data-interactive={interactive ? 'true' : 'false'}
        data-live-state={isLive ? liveState : 'inactive'}
        data-pinned={pinnedElementIds.has(elementId) ? 'true' : undefined}
        sx={(theme) => ({
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: theme.palette.background.paper,
          ...(isLive && {
            borderRadius: 1,
            border: interactive
              ? `4px solid ${theme.palette.primary.main}`
              : `1px solid ${theme.palette.grey[500]}`,
          }),
          ...(showSharedChange && {
            animation: `${sharedGlow(theme.palette.success.main)} ${sharedChangeDurationMs}ms ease-out`,
            borderColor: theme.palette.success.main,
          }),
        })}
      >
        {isLive && (
          <EmbeddedWidgetStatusBar
            elementId={elementId}
            name={displayName}
            state={liveState}
            sharedChange={showSharedChange}
            preapproved={preapproved}
          />
        )}
        <div
          style={{
            position: 'relative',
            flex: '1 1 auto',
            minHeight: 0,
          }}
        >
          {isLive && (
            <div
              ref={setContainer}
              data-testid={`element-${elementId}-embedded-widget-mount`}
              data-embedded-widget-mount=""
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: interactive ? 'auto' : 'none',
                visibility: hidden ? 'hidden' : 'visible',
              }}
            />
          )}
          {isLive && liveState === 'ready' && (
            // Slightly dimmed while the board, not the widget, has the mouse.
            <Box
              aria-hidden
              data-testid={`element-${elementId}-embedded-widget-dim`}
              sx={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                backgroundColor: 'rgba(128, 128, 128, 0.12)',
              }}
            />
          )}
          {consentPanel}
          {placeholderReason !== undefined && (
            <EmbeddedWidgetPlaceholder
              elementId={elementId}
              widgetUrl={widgetUrl}
              title={title}
              reason={placeholderReason}
              errorMessage={
                status?.state === 'error' ? status.message : undefined
              }
              onActivate={
                placeholderReason === 'inactive' && canActivate
                  ? handleActivate
                  : undefined
              }
              onRetry={status?.state === 'error' ? status.retry : undefined}
            />
          )}
        </div>
      </Box>
    </foreignObject>
  );

  if (readOnly) {
    return renderedChild;
  }

  return (
    <SelectableElement
      active={active}
      readOnly={readOnly}
      elementId={elementId}
    >
      <MoveableElement elementId={elementId} elements={elements}>
        <ElementContextMenu
          elementId={elementId}
          activeElementIds={activeElementIds}
        >
          {renderedChild}
          {elementMovedHasFrame && (
            <ElementFrameOverlay
              offsetX={position.x}
              offsetY={position.y}
              width={width}
              height={height}
            />
          )}
        </ElementContextMenu>
      </MoveableElement>
    </SelectableElement>
  );
}

export default React.memo(EmbeddedWidgetDisplay);
