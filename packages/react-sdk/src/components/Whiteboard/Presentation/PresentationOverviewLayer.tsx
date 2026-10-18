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

import { alpha, useTheme } from '@mui/material';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLatestValue } from '../../../lib';
import {
  FrameElement,
  useActiveSlideOrFrame,
  usePresentationMode,
  usePresentationOverview,
  useWhiteboardSlideInstance,
  useWhiteboardSlideOrFrameIds,
} from '../../../state';
import { useSvgScaleContext } from '../SvgScaleContext';
import { presentationTargetCamera } from './usePresentationCamera';

/** Size of the frame number badges in screen pixels. */
const badgeSize = 34;

/**
 * Frame outlines with their numbers on top of the canvas while the
 * presentation shows the overview of all frames. The presenter opens a frame
 * by clicking it; followers only see where the presenter is.
 */
export function PresentationOverviewLayer() {
  const { t } = useTranslation('neoboard');
  const theme = useTheme();
  const { state } = usePresentationMode();
  const { overview, setOverview } = usePresentationOverview();
  const { activeId } = useActiveSlideOrFrame();
  const frameIds = useWhiteboardSlideOrFrameIds();
  const slideInstance = useWhiteboardSlideInstance();
  const frames = useLatestValue(
    useCallback(() => slideInstance.getFrameElements(), [slideInstance]),
    useMemo(() => slideInstance.observeFrameElements(), [slideInstance]),
  );
  const { containerDimensions } = useSvgScaleContext();

  if (state.type === 'idle' || !overview) {
    return null;
  }

  const isPresenter = state.type === 'presenting';
  // Size the badges for the overview camera (not the current one, which
  // still flies), so they do not change size when the camera arrives.
  const overviewScale =
    presentationTargetCamera(frames, undefined, true, containerDimensions)
      ?.scale ?? 1;
  const unit = 1 / overviewScale;
  const badge = badgeSize * unit;

  return (
    <g
      data-testid="presentation-overview"
      aria-label={t('presentBar.overview', 'Overview of all frames')}
    >
      {frameIds.map((frameId, index) => {
        const frame: FrameElement | undefined = frames[frameId];
        if (!frame) {
          return null;
        }
        const active = frameId === activeId;
        const { x, y } = frame.position;
        const label = t('presentBar.openFrame', 'Open frame {{number}}', {
          number: index + 1,
        });

        return (
          <g
            key={frameId}
            data-testid={`presentation-overview-frame-${frameId}`}
            data-active={active ? 'true' : 'false'}
            role={isPresenter ? 'button' : undefined}
            aria-label={isPresenter ? label : undefined}
            onClick={
              isPresenter
                ? (event) => {
                    event.stopPropagation();
                    setOverview(false, frameId);
                  }
                : undefined
            }
            onPointerDown={
              isPresenter ? (event) => event.stopPropagation() : undefined
            }
            tabIndex={isPresenter ? 0 : undefined}
            onKeyDown={
              isPresenter
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      setOverview(false, frameId);
                    }
                  }
                : undefined
            }
            style={{
              cursor: isPresenter ? 'pointer' : undefined,
              pointerEvents: isPresenter ? 'all' : 'none',
            }}
          >
            <rect
              x={x}
              y={y}
              width={frame.width}
              height={frame.height}
              fill={
                active ? alpha(theme.palette.primary.main, 0.08) : 'transparent'
              }
              stroke={
                active ? theme.palette.primary.main : theme.palette.grey[500]
              }
              strokeWidth={active ? 4 : 2}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={x + badge * 0.75}
              cy={y + badge * 0.75}
              r={badge / 2}
              fill={
                active ? theme.palette.primary.main : theme.palette.grey[800]
              }
            />
            <text
              x={x + badge * 0.75}
              y={y + badge * 0.75}
              fill={theme.palette.common.white}
              fontSize={badge * 0.5}
              fontFamily={theme.typography.fontFamily}
              fontWeight="bold"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {index + 1}
            </text>
          </g>
        );
      })}
    </g>
  );
}
