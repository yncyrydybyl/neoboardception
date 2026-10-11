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
import {
  Alert,
  Box,
  Button,
  ButtonProps,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { unstable_useId as useId } from '@mui/utils';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getErrorText } from './EmbeddedWidgetPlaceholder';
import {
  EmbeddedWidgetModal,
  EmbeddedWidgetModalButton,
  EmbeddedWidgetModalStatus,
} from './renderer';

export type EmbeddedWidgetModalDialogProps = {
  elementId: string;
  /** Display name of the embedded widget (fallback title). */
  widgetName: string;
  modal: EmbeddedWidgetModal;
};

function buttonProps(kind: string): Pick<ButtonProps, 'variant' | 'color'> {
  switch (kind) {
    case 'm.primary':
      return { variant: 'contained', color: 'primary' };
    case 'm.danger':
      return { variant: 'contained', color: 'error' };
    case 'm.warning':
      return { variant: 'outlined', color: 'warning' };
    case 'm.link':
      return { variant: 'text', color: 'primary' };
    default:
      return { variant: 'outlined', color: 'primary' };
  }
}

/** React events from the dialog's portal must not reach the board element. */
const stop = (event: React.SyntheticEvent) => event.stopPropagation();
const stopHandlers = {
  onClick: stop,
  onDoubleClick: stop,
  onPointerDown: stop,
  onPointerUp: stop,
  onMouseDown: stop,
  onMouseUp: stop,
  onTouchStart: stop,
  onContextMenu: stop,
  onKeyDown: stop,
  onKeyUp: stop,
  onWheel: stop,
};

/**
 * Shows a modal of an embedded widget inside the board (instead of the
 * Matrix client): an accessible dialog, labelled by the modal's title, that
 * hosts the modal's widget and its buttons. Escape and the close button
 * cancel the modal; clicking the backdrop does nothing (like the client).
 */
export function EmbeddedWidgetModalDialog({
  elementId,
  widgetName,
  modal,
}: EmbeddedWidgetModalDialogProps) {
  const { t } = useTranslation('neoboard');
  const titleId = useId();
  const descriptionId = useId();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [buttons, setButtons] = useState<readonly EmbeddedWidgetModalButton[]>(
    modal.buttons,
  );
  const [status, setStatus] = useState<EmbeddedWidgetModalStatus>({
    state: 'loading',
  });

  useEffect(() => {
    setButtons(modal.buttons);
  }, [modal]);

  useEffect(() => {
    if (!container) {
      return;
    }
    setStatus({ state: 'loading' });
    return modal.mount(container, {
      onButtonsChange: setButtons,
      onStatusChange: setStatus,
    });
  }, [modal, container]);

  const title = modal.name || widgetName;
  let host = modal.origin;
  try {
    host = new URL(modal.origin).host;
  } catch {
    // keep the origin
  }

  return (
    <Dialog
      open
      fullWidth
      maxWidth="md"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-testid={`element-${elementId}-embedded-widget-modal`}
      onClose={(_event, reason) => {
        if (reason !== 'backdropClick') {
          modal.cancel();
        }
      }}
      {...stopHandlers}
    >
      <Stack alignItems="center" direction="row">
        <DialogTitle component="h3" id={titleId} sx={{ flex: 1 }}>
          {title}
        </DialogTitle>
        <Tooltip title={t('embeddedWidget.modal.close', 'Close')}>
          <IconButton
            aria-label={t('embeddedWidget.modal.close', 'Close')}
            onClick={() => modal.cancel()}
            sx={{ mr: 2 }}
          >
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Stack>
      <DialogContent sx={{ pt: 0 }}>
        <Typography
          id={descriptionId}
          variant="body2"
          color="text.secondary"
          sx={{ mb: 1 }}
        >
          {t(
            'embeddedWidget.modal.origin',
            'Content of the embedded widget from {{host}}. Data you enter here goes to this widget.',
            { host },
          )}
        </Typography>
        <Box
          sx={{
            position: 'relative',
            height: '60vh',
            minHeight: 240,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            overflow: 'hidden',
          }}
        >
          <div
            ref={setContainer}
            data-testid={`element-${elementId}-embedded-widget-modal-mount`}
            style={{ position: 'absolute', inset: 0 }}
          />
          {status.state === 'loading' && (
            <Stack
              role="status"
              alignItems="center"
              justifyContent="center"
              gap={1}
              sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            >
              <CircularProgress size={24} aria-hidden />
              <Typography variant="body2">
                {t('embeddedWidget.modal.loading', 'Loading…')}
              </Typography>
            </Stack>
          )}
          {status.state === 'error' && (
            <Alert
              severity="error"
              sx={{ position: 'absolute', left: 8, right: 8, top: 8 }}
            >
              {status.code === undefined || status.code === 'load-failed'
                ? t(
                    'embeddedWidget.modal.error',
                    'The content of this dialog could not be loaded.',
                  )
                : getErrorText(t, status.code)}
            </Alert>
          )}
        </Box>
      </DialogContent>
      {buttons.length > 0 && (
        <DialogActions>
          {
            // First button rightmost, like the Matrix client.
            [...buttons].reverse().map((button) => (
              <Button
                key={button.id}
                {...buttonProps(button.kind)}
                disabled={button.disabled}
                onClick={() =>
                  // Without a running widget nobody answers "close".
                  button.id === 'm.close' && status.state !== 'ready'
                    ? modal.cancel()
                    : modal.clickButton(button.id)
                }
              >
                {button.label}
              </Button>
            ))
          }
        </DialogActions>
      )}
    </Dialog>
  );
}
