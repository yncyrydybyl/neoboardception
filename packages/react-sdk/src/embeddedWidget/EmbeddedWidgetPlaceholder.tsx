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
import { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { EmbeddedWidgetErrorCode } from './renderer';

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
  /** Cause of an error; selects the localised text. */
  errorCode?: EmbeddedWidgetErrorCode;
  /**
   * Technical error description (not localised). Only offered as details
   * (tooltip), never as the main text.
   */
  errorDetails?: string;
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
 * Readable form of a widget URL: origin and path, without query and
 * fragment (they carry widget parameters such as `$matrix_room_id`
 * template variables). The path is left out if it contains a template
 * variable itself. Invalid URLs are not shown.
 */
export function getDisplayUrl(widgetUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(widgetUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return undefined;
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    path = url.pathname;
  }
  if (path === '/' || path.includes('$')) {
    return url.origin;
  }
  return `${url.origin}${path}`;
}

/** Localized, user-facing text for an error code of an embedded widget. */
export function getErrorText(
  t: TFunction,
  code: EmbeddedWidgetErrorCode | undefined,
): string {
  switch (code) {
    case 'policy':
    case 'origin-not-allowed':
      return t(
        'embeddedWidget.error.policy',
        'This widget is not allowed in this deployment.',
      );
    case 'same-origin':
      return t(
        'embeddedWidget.error.sameOrigin',
        'Widgets from the board’s own address cannot be embedded.',
      );
    case 'invalid-url':
      return t(
        'embeddedWidget.error.invalidUrl',
        'The widget address was refused.',
      );
    case 'navigated':
      return t(
        'embeddedWidget.error.navigated',
        'The widget opened another page and was stopped for security reasons.',
      );
    case 'timeout':
      return t(
        'embeddedWidget.error.timeout',
        'The widget did not respond in time.',
      );
    case 'denied':
      return t(
        'embeddedWidget.status.denied',
        'The widget did not get any permission and cannot run.',
      );
    case 'load-failed':
    default:
      return t(
        'embeddedWidget.status.error',
        'The widget could not be loaded.',
      );
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
  errorCode,
  errorDetails,
  onActivate,
  onRetry,
}: EmbeddedWidgetPlaceholderProps) {
  const { t } = useTranslation('neoboard');
  const displayTitle =
    title && title.trim() !== ''
      ? title
      : (getHostname(widgetUrl) ??
        t('embeddedWidget.untitled', 'Embedded widget'));

  const displayUrl = getDisplayUrl(widgetUrl);
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
      status = getErrorText(t, errorCode);
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
      {displayUrl !== undefined && (
        <Typography
          component="div"
          variant="body2"
          noWrap
          title={displayUrl}
          sx={{ maxWidth: '100%', color: 'text.secondary' }}
          data-testid={`element-${elementId}-embedded-widget-url`}
        >
          {displayUrl}
        </Typography>
      )}
      <Typography
        component="div"
        variant="caption"
        role="status"
        title={reason === 'error' ? errorDetails : undefined}
        data-error-code={
          reason === 'error' ? (errorCode ?? 'load-failed') : undefined
        }
        sx={{ color: 'text.secondary' }}
        data-testid={`element-${elementId}-embedded-widget-status`}
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
