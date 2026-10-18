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
import { RefObject, useEffect, useMemo, useRef } from 'react';
import {
  FrameElement,
  useActiveSlideOrFrame,
  useActiveWhiteboardInstance,
  usePresentationMode,
  usePresentationOverview,
  usePresentationSettings,
  useWhiteboardSlideInstance,
  useWhiteboardSlideOrFrameIds,
} from '../../../state';
import { whiteboardHeight, whiteboardWidth } from '../constants';
import { useSvgCameraContext, useSvgScaleContext } from '../SvgScaleContext';
import {
  boundingRect,
  Camera,
  cameraForRect,
  cameraForTranslation,
  clampCamera,
  formatViewBox,
  Rect,
  Size,
  viewBoxForCamera,
} from './camera';
import { CameraTransitionPlayer } from './CameraTransitionPlayer';
import {
  planTransition,
  resolveOverviewTransition,
  resolveTransition,
} from './transitions';

/** Free space around the frames in the overview (fraction per side). */
export const overviewPadding = 0.06;

/** Size of the canvas (read on use, the constants depend on the mode). */
function boardSize(): Size {
  return { width: whiteboardWidth, height: whiteboardHeight };
}

function frameRect(frame: FrameElement): Rect {
  return {
    x: frame.position.x,
    y: frame.position.y,
    width: frame.width,
    height: frame.height,
  };
}

/**
 * The camera that shows a frame (or all frames in the overview), kept inside
 * the board like the scale context does.
 */
export function presentationTargetCamera(
  frames: Record<string, FrameElement>,
  activeFrameId: string | undefined,
  overview: boolean,
  container: Size,
): Camera | undefined {
  let camera: Camera | undefined;

  if (overview) {
    const rect = boundingRect(Object.values(frames).map(frameRect));
    camera = rect ? cameraForRect(rect, container, overviewPadding) : undefined;
  } else if (activeFrameId !== undefined && frames[activeFrameId]) {
    camera = cameraForRect(frameRect(frames[activeFrameId]), container);
  }

  return camera && Number.isFinite(camera.scale) && camera.scale > 0
    ? clampCamera(camera, container, boardSize())
    : undefined;
}

/**
 * Moves the viewport of the infinite canvas to the active frame (or to the
 * overview) and plays the presentation transition while presenting or
 * following a presentation.
 *
 * Outside of a presentation, resizes and late joins the view jumps, as
 * before.
 *
 * @param svgRef - the canvas; fly transitions write its viewBox directly
 * @param enabled - false for previews and the slide mode
 */
export function usePresentationCamera(
  svgRef: RefObject<SVGSVGElement>,
  enabled: boolean,
): void {
  const { scale, translation, containerDimensions, moveToPositionAndScale } =
    useSvgScaleContext();
  const { setCameraMoving } = useSvgCameraContext();
  const slideInstance = useWhiteboardSlideInstance();
  const whiteboardInstance = useActiveWhiteboardInstance();
  const { activeId } = useActiveSlideOrFrame();
  const frameIds = useWhiteboardSlideOrFrameIds();
  const { state } = usePresentationMode();
  const { overview } = usePresentationOverview();
  const { settings } = usePresentationSettings();
  const prefersReducedMotion = useMediaQuery(
    '(prefers-reduced-motion: reduce)',
  );

  const isPresentation = state.type !== 'idle';
  const showOverview = isPresentation && overview;

  // values that the effect reads but that must not restart it
  const latest = useRef({
    scale,
    translation,
    containerDimensions,
    moveToPositionAndScale,
    setCameraMoving,
    frameIds,
    settings,
    prefersReducedMotion,
    isPresentation,
  });
  latest.current = {
    scale,
    translation,
    containerDimensions,
    moveToPositionAndScale,
    setCameraMoving,
    frameIds,
    settings,
    prefersReducedMotion,
    isPresentation,
  };

  const player = useMemo(
    () =>
      new CameraTransitionPlayer({
        applyCamera: (camera) => {
          svgRef.current?.setAttribute(
            'viewBox',
            formatViewBox(
              viewBoxForCamera(camera, latest.current.containerDimensions),
            ),
          );
        },
        commitCamera: (camera) => {
          latest.current.moveToPositionAndScale(
            { x: camera.x, y: camera.y },
            camera.scale,
            'camera',
          );
        },
        getOverlayElement: () => svgRef.current,
        onMovingChange: (moving) => latest.current.setCameraMoving(moving),
      }),
    [svgRef],
  );

  useEffect(
    () => () => {
      player.destroy();
      latest.current.setCameraMoving(false);
    },
    [player],
  );

  const previous = useRef<{
    activeId: string | undefined;
    overview: boolean;
    width: number;
    height: number;
  }>();

  const { width, height } = containerDimensions;

  useEffect(() => {
    if (!enabled || width <= 0 || height <= 0) {
      return;
    }

    const container = { width, height };
    const target = presentationTargetCamera(
      slideInstance.getFrameElements(),
      activeId,
      showOverview,
      container,
    );

    const prev = previous.current;
    previous.current = { activeId, overview: showOverview, width, height };

    if (!target) {
      return;
    }

    const {
      frameIds,
      settings,
      prefersReducedMotion,
      isPresentation,
      translation,
      scale,
    } = latest.current;

    const resized =
      prev !== undefined && (prev.width !== width || prev.height !== height);
    const overviewChanged =
      prev !== undefined && prev.overview !== showOverview;
    const frameChanged = prev !== undefined && prev.activeId !== activeId;
    const animate =
      isPresentation && !resized && (overviewChanged || frameChanged);

    const transition = !animate
      ? 'none'
      : overviewChanged
        ? resolveOverviewTransition(settings, prefersReducedMotion)
        : resolveTransition(settings, activeId, prefersReducedMotion);

    const catchUp =
      activeId !== undefined &&
      (whiteboardInstance
        .getPresentationManager()
        ?.isCatchUpNavigation(activeId) ??
        false);

    const previousIndex =
      prev?.activeId !== undefined ? frameIds.indexOf(prev.activeId) : -1;
    const nextIndex = activeId !== undefined ? frameIds.indexOf(activeId) : -1;
    const direction = nextIndex < previousIndex ? -1 : 1;

    const from =
      (player.isRunning() ? player.getVisibleCamera() : undefined) ??
      cameraForTranslation(translation, scale, boardSize());

    player.play(
      planTransition({
        transition,
        from,
        to: target,
        container,
        speed: settings.speed,
        direction,
        instant: catchUp,
      }),
      target,
    );
  }, [
    enabled,
    activeId,
    showOverview,
    width,
    height,
    slideInstance,
    whiteboardInstance,
    player,
  ]);
}
