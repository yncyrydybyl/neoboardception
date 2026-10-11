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

import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import { Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * Why the widget is (not yet) shown. Local UI state only.
 */
export type EmbeddedWidgetPlaceholderReason =
  | 'inactive'
  | 'preview'
  | 'blocked'
  | 'invalid'
  | 'loading'
  | 'suspended'
  | 'denied'
  | 'error';

export type EmbeddedWidgetPlaceholderProps = {
  elementId: string;
  widgetUrl: string;
  title?: string;
  reason: EmbeddedWidgetPlaceholderReason;
  errorMessage?: string;
  /** If set, a button to load (activate) the widget is shown. */
  onActivate?: () => void;
  /** If set, a retry button is shown (error state). */
  onRetry?: () => void;
};

function getHostname(widgetUrl: string): string | undefined {
  try {
    return new URL(widgetUrl).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Static placeholder of an embedded widget: icon, title and URL plus a short
 * status line. The visual design of the states is expected to be refined.
 */
export function EmbeddedWidgetPlaceholder({
  elementId,
  widgetUrl,
  title,
  reason,
  errorMessage,
  onActivate,
  onRetry,
}: EmbeddedWidgetPlaceholderProps) {
  const { t } = useTranslation('neoboard');
  const displayTitle =
    title && title.trim() !== ''
      ? title
      : (getHostname(widgetUrl) ??
        t('embeddedWidget.untitled', 'Embedded widget'));

  let status: string;
  switch (reason) {
    case 'blocked':
      status = t(
        'embeddedWidget.status.blocked',
        'This widget address is not allowed on this board.',
      );
      break;
    case 'invalid':
      status = t('embeddedWidget.status.invalid', 'Invalid widget address.');
      break;
    case 'loading':
      status = t('embeddedWidget.status.loading', 'Loading widget…');
      break;
    case 'suspended':
      status = t('embeddedWidget.status.suspended', 'Widget paused.');
      break;
    case 'denied':
      status = t(
        'embeddedWidget.status.denied',
        'The widget did not get any permission and cannot run.',
      );
      break;
    case 'error':
      status =
        errorMessage ??
        t('embeddedWidget.status.error', 'The widget could not be loaded.');
      break;
    case 'preview':
    case 'inactive':
    default:
      status = t('embeddedWidget.status.inactive', 'Widget not loaded.');
      break;
  }

  return (
    <Box
      data-testid={`element-${elementId}-embedded-widget-placeholder`}
      role="group"
      aria-label={displayTitle}
      sx={(theme) => ({
        position: 'absolute',
        inset: 0,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        padding: 2,
        overflow: 'hidden',
        border: `2px dashed ${
          reason === 'blocked' ||
          reason === 'error' ||
          reason === 'denied' ||
          reason === 'invalid'
            ? theme.palette.error.main
            : theme.palette.grey[500]
        }`,
        borderRadius: 1,
        backgroundColor: theme.palette.background.paper,
        color: theme.palette.text.primary,
        userSelect: 'none',
      })}
    >
      {reason === 'error' || reason === 'denied' || reason === 'blocked' ? (
        <ErrorOutlineIcon
          aria-hidden
          sx={{ fontSize: 48, color: 'error.main' }}
        />
      ) : (
        <ExtensionOutlinedIcon
          aria-hidden
          sx={{ fontSize: 48, color: 'text.secondary' }}
        />
      )}
      <Typography
        component="div"
        variant="h6"
        noWrap
        sx={{ maxWidth: '100%' }}
        data-testid={`element-${elementId}-embedded-widget-title`}
      >
        {displayTitle}
      </Typography>
      <Typography
        component="div"
        variant="body2"
        noWrap
        title={widgetUrl}
        sx={{ maxWidth: '100%', color: 'text.secondary' }}
        data-testid={`element-${elementId}-embedded-widget-url`}
      >
        {widgetUrl}
      </Typography>
      <Typography
        component="div"
        variant="caption"
        role="status"
        sx={{ color: 'text.secondary' }}
      >
        {status}
      </Typography>
      {onRetry && (
        <Button
          size="small"
          variant="outlined"
          onClick={onRetry}
          data-testid={`element-${elementId}-embedded-widget-retry`}
        >
          {t('embeddedWidget.retry', 'Try again')}
        </Button>
      )}
      {onActivate && (
        <Button
          size="small"
          variant="outlined"
          onClick={onActivate}
          data-testid={`element-${elementId}-embedded-widget-activate`}
        >
          {t('embeddedWidget.activate', 'Load widget')}
        </Button>
      )}
    </Box>
  );
}
