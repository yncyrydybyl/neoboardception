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

import CloseIcon from '@mui/icons-material/Close';
import { Alert, Button, IconButton, Stack } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isInfiniteCanvasMode } from '../../lib';
import { usePresentationMode } from '../../state';
import { useReducedMotionPreference } from '../Whiteboard/Presentation/reducedMotion';
import { usePeerConnectionProblem } from './usePeerConnectionProblem';

/** How long the reduced motion hint stays. */
export const reducedMotionHintDurationMs = 12_000;

/**
 * Non-blocking hints about the presentation on this device:
 *
 * - Once per page load, when a presentation starts (presenting or
 *   following) while the system asks for reduced motion: the transitions
 *   play as fades, with a button to play them anyway.
 * - While a connection to another session of the board does not come up:
 *   the devices may need a relay (TURN) server.
 */
export function PresentationHints() {
  const { t } = useTranslation('neoboard');
  const { state } = usePresentationMode();
  const { reducedMotion, setIgnoreReducedMotion } =
    useReducedMotionPreference();
  const connectionProblem = usePeerConnectionProblem();

  const isPresentation = state.type !== 'idle';
  const [showMotionHint, setShowMotionHint] = useState(false);
  const motionHintShown = useRef(false);

  useEffect(() => {
    if (!isPresentation) {
      setShowMotionHint(false);
    } else if (
      reducedMotion &&
      isInfiniteCanvasMode() &&
      !motionHintShown.current
    ) {
      motionHintShown.current = true;
      setShowMotionHint(true);
    }
  }, [isPresentation, reducedMotion]);

  useEffect(() => {
    if (!showMotionHint) {
      return;
    }

    const timer = setTimeout(
      () => setShowMotionHint(false),
      reducedMotionHintDurationMs,
    );
    return () => clearTimeout(timer);
  }, [showMotionHint]);

  const [connectionHintDismissed, setConnectionHintDismissed] = useState(false);

  useEffect(() => {
    if (!connectionProblem) {
      setConnectionHintDismissed(false);
    }
  }, [connectionProblem]);

  // a follower is connected to the presenter, other connections don't matter
  const showConnectionHint =
    connectionProblem &&
    !connectionHintDismissed &&
    state.type !== 'presentation';

  const motionHintVisible = showMotionHint && reducedMotion && isPresentation;

  if (!motionHintVisible && !showConnectionHint) {
    return null;
  }

  const dismissLabel = t('presentBar.hints.dismiss', 'Dismiss');

  return (
    <Stack
      gap={1}
      alignItems="center"
      sx={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: (theme) => theme.spacing(10),
        width: 'max-content',
        maxWidth: 'min(560px, calc(100% - 32px))',
        pointerEvents: 'none',
        zIndex: (theme) => theme.zIndex.appBar,
      }}
    >
      {motionHintVisible && (
        <Alert
          role="status"
          severity="info"
          variant="filled"
          sx={{ pointerEvents: 'auto' }}
          action={
            <>
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  setIgnoreReducedMotion(true);
                  setShowMotionHint(false);
                }}
              >
                {t('presentBar.hints.playAnyway', 'Play anyway')}
              </Button>
              <IconButton
                aria-label={dismissLabel}
                color="inherit"
                size="small"
                onClick={() => setShowMotionHint(false)}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </>
          }
        >
          {state.type === 'presenting'
            ? t(
                'presentBar.hints.reducedMotionPresenter',
                'Your system asks for reduced motion, so transitions play as fades on this device. You can change this in the Transitions menu.',
              )
            : t(
                'presentBar.hints.reducedMotion',
                'Your system asks for reduced motion, so transitions play as fades on this device.',
              )}
        </Alert>
      )}
      {showConnectionHint && (
        <Alert
          role="status"
          severity="warning"
          sx={{ pointerEvents: 'auto' }}
          onClose={() => setConnectionHintDismissed(true)}
          closeText={dismissLabel}
        >
          {state.type === 'presenting'
            ? t(
                'presentBar.hints.connectionPresenter',
                "Couldn't connect to everyone on this board, so some people may not see your presentation. Your devices may need a relay (TURN) server.",
              )
            : t(
                'presentBar.hints.connection',
                "Couldn't connect to another person on this board, so you may not be able to follow their presentation. Your devices may need a relay (TURN) server.",
              )}
        </Alert>
      )}
    </Stack>
  );
}
