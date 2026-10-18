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

import { Box, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { usePresentationMode } from '../../state';
import { usePresentationNavigation } from './usePresentationNavigation';

export type PresentationProgressProps = {
  /** Keep the frame number above the bottom toolbars. */
  raised?: boolean;
};

/**
 * Progress of the presentation for the presenter and everyone who follows:
 * a thin bar along the bottom edge (like Reveal.js) and the frame number.
 */
export function PresentationProgress({ raised }: PresentationProgressProps) {
  const { t } = useTranslation('neoboard');
  const theme = useTheme();
  const { state } = usePresentationMode();
  const { index, count, overview } = usePresentationNavigation();

  if (state.type === 'idle' || count === 0 || index < 0) {
    return null;
  }

  const progress = count > 1 ? index / (count - 1) : 1;
  const label = overview
    ? t('presentBar.progressOverview', 'Overview · {{current}} of {{total}}', {
        current: index + 1,
        total: count,
      })
    : t('presentBar.progress', '{{current}} of {{total}}', {
        current: index + 1,
        total: count,
      });

  return (
    <Box
      data-testid="presentation-progress"
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
        zIndex: theme.zIndex.appBar - 1,
      }}
    >
      <Typography
        role="status"
        aria-live="polite"
        variant="caption"
        sx={{
          position: 'absolute',
          left: theme.spacing(1.5),
          bottom: theme.spacing(raised ? 8 : 1.5),
          px: 1,
          py: 0.25,
          borderRadius: 1,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color: theme.palette.common.white,
          backgroundColor: 'rgba(0, 0, 0, 0.55)',
        }}
      >
        {label}
      </Typography>
      <Box
        role="progressbar"
        aria-label={t('presentBar.progressLabel', 'Presentation progress')}
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={index + 1}
        sx={{ height: 4, backgroundColor: 'rgba(0, 0, 0, 0.08)' }}
      >
        <Box
          sx={{
            height: '100%',
            width: '100%',
            transformOrigin: 'left center',
            transform: `scaleX(${progress})`,
            backgroundColor: theme.palette.primary.main,
            transition: 'transform 600ms cubic-bezier(0.22, 1, 0.36, 1)',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        />
      </Box>
    </Box>
  );
}
