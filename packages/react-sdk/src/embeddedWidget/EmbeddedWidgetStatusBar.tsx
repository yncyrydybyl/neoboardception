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
import ExitToAppIcon from '@mui/icons-material/ExitToApp';
import GppMaybeOutlinedIcon from '@mui/icons-material/GppMaybeOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import HourglassTopOutlinedIcon from '@mui/icons-material/HourglassTopOutlined';
import MouseOutlinedIcon from '@mui/icons-material/MouseOutlined';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import TouchAppOutlinedIcon from '@mui/icons-material/TouchAppOutlined';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import { Box, Button, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { EmbeddedWidgetSupport } from './describeCapabilities';
import { EmbeddedWidgetPreapproval } from './renderer';

/** Local UI state of a live embedded widget. */
export type EmbeddedWidgetLiveState =
  | 'loading'
  | 'permissions'
  | 'ready'
  | 'interacting'
  | 'suspended'
  | 'error';

/** Height of the status bar in canvas units. */
export const embeddedWidgetStatusBarHeight = 32;

export type EmbeddedWidgetStatusBarProps = {
  elementId: string;
  name: string;
  state: EmbeddedWidgetLiveState;
  /** The widget just changed shared state (shown for a moment). */
  sharedChange: boolean;
  /**
   * The operator approved the widget's permissions in advance (no local
   * consent was asked). Shown as a non-blocking notice.
   */
  preapproved?: EmbeddedWidgetPreapproval;
  /**
   * Permissions the widget cannot get here. `unsupported` replaces the
   * "ready" state; any blocked permission is shown as a warning.
   */
  support?: EmbeddedWidgetSupport;
  /**
   * Leave the interaction state. Shown as a button while interacting: key
   * presses inside the widget (e.g. Escape) never reach the board.
   */
  onLeave?: () => void;
};

/**
 * Status bar above a live embedded widget. Shows the state with icon and
 * text (never by colour alone) and whether what the user does is private
 * ("only you see this") or shared ("everyone sees this now"). State changes
 * are announced through a polite live region.
 */
export function EmbeddedWidgetStatusBar({
  elementId,
  name,
  state,
  sharedChange,
  preapproved,
  support,
  onLeave,
}: EmbeddedWidgetStatusBarProps) {
  const { t } = useTranslation('neoboard');

  const stateInfo: Record<
    EmbeddedWidgetLiveState,
    { icon: ReactElement; text: string }
  > = {
    loading: {
      icon: <HourglassTopOutlinedIcon fontSize="small" aria-hidden />,
      text: t('embeddedWidget.state.loading', 'Loading'),
    },
    permissions: {
      icon: <GppMaybeOutlinedIcon fontSize="small" aria-hidden />,
      text: t('embeddedWidget.state.permissions', 'Asking for permissions'),
    },
    ready: {
      icon: <TouchAppOutlinedIcon fontSize="small" aria-hidden />,
      text: t('embeddedWidget.state.ready', 'Ready – double-click to use'),
    },
    interacting: {
      icon: <MouseOutlinedIcon fontSize="small" aria-hidden />,
      text: t('embeddedWidget.state.interacting', 'You are in the widget'),
    },
    suspended: {
      icon: <PauseCircleOutlineIcon fontSize="small" aria-hidden />,
      text: t('embeddedWidget.state.suspended', 'Paused'),
    },
    error: {
      icon: <ErrorOutlineIcon fontSize="small" aria-hidden />,
      text: t('embeddedWidget.state.error', 'Error'),
    },
  };
  const unsupported =
    support?.level === 'unsupported' &&
    (state === 'ready' || state === 'suspended');
  const { icon, text } = unsupported
    ? {
        icon: <WarningAmberOutlinedIcon fontSize="small" aria-hidden />,
        text: t('embeddedWidget.state.unsupported', 'Not supported here'),
      }
    : stateInfo[state];
  const showLimits =
    support !== undefined && support.level !== 'full' && state !== 'error';
  const limitsText = showLimits
    ? t(
        'embeddedWidget.limits.text',
        '{{blocked}} of {{requested}} permissions not available here',
        { blocked: support.blocked, requested: support.requested },
      )
    : undefined;
  const limitsDetail = showLimits
    ? t(
        'embeddedWidget.limits.detail',
        'This board does not grant: {{capabilities}}',
        { capabilities: support.blockedCapabilities.join(', ') },
      )
    : undefined;
  const leaveHint =
    state === 'interacting'
      ? t(
          'embeddedWidget.leaveHint',
          'Click outside the widget or use “Leave widget” to return to the board.',
        )
      : undefined;

  const context = sharedChange
    ? {
        kind: 'shared',
        icon: <GroupsOutlinedIcon fontSize="small" aria-hidden />,
        text: t('embeddedWidget.context.shared', 'Everyone sees this now'),
      }
    : state === 'interacting'
      ? {
          kind: 'private',
          icon: <PersonOutlineIcon fontSize="small" aria-hidden />,
          text: t('embeddedWidget.context.private', 'Only you see this'),
        }
      : preapproved && state !== 'error'
        ? {
            kind: 'preapproved',
            icon: <VerifiedUserOutlinedIcon fontSize="small" aria-hidden />,
            text: t(
              'embeddedWidget.context.preapproved',
              'Approved by your administrator',
            ),
            detail: t(
              'embeddedWidget.context.preapprovedDetail',
              'Your administrator approved the permissions of “{{name}}” ({{origin}}) in advance.',
              { name: preapproved.name ?? name, origin: preapproved.origin },
            ),
          }
        : undefined;
  const announcement = [
    context && 'detail' in context ? context.detail : context?.text,
    limitsText,
    leaveHint,
  ]
    .filter((part) => part !== undefined)
    .join('. ');

  return (
    <Box
      data-testid={`element-${elementId}-embedded-widget-statusbar`}
      data-state={state}
      data-context={context?.kind ?? 'none'}
      data-support={support?.level ?? 'full'}
      sx={(theme) => ({
        height: embeddedWidgetStatusBarHeight,
        flex: `0 0 ${embeddedWidgetStatusBarHeight}px`,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        backgroundColor:
          state === 'interacting'
            ? theme.palette.primary.main
            : state === 'error'
              ? theme.palette.error.main
              : unsupported
                ? theme.palette.warning.main
                : theme.palette.background.default,
        color:
          state === 'interacting'
            ? theme.palette.primary.contrastText
            : state === 'error'
              ? theme.palette.error.contrastText
              : unsupported
                ? theme.palette.warning.contrastText
                : theme.palette.text.primary,
        borderBottom: `1px solid ${theme.palette.divider}`,
      })}
    >
      {icon}
      <Typography
        component="span"
        variant="body2"
        noWrap
        sx={{ fontWeight: 600, flexShrink: 1, minWidth: 0 }}
        data-testid={`element-${elementId}-embedded-widget-state`}
      >
        {text}
      </Typography>
      <Typography
        component="span"
        variant="body2"
        noWrap
        sx={{ opacity: 0.8, flexShrink: 2, minWidth: 0 }}
      >
        {name}
      </Typography>
      <Box sx={{ flex: 1 }} />
      {showLimits && (
        <Box
          data-testid={`element-${elementId}-embedded-widget-limits`}
          title={limitsDetail}
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1,
            borderRadius: 1,
            flexShrink: 1,
            minWidth: 0,
            backgroundColor: unsupported
              ? 'rgba(0,0,0,0.12)'
              : theme.palette.warning.main,
            color: unsupported ? 'inherit' : theme.palette.warning.contrastText,
          })}
        >
          <WarningAmberOutlinedIcon fontSize="small" aria-hidden />
          <Typography component="span" variant="body2" noWrap>
            {limitsText}
          </Typography>
        </Box>
      )}
      {context && (
        <Box
          data-testid={`element-${elementId}-embedded-widget-context`}
          title={'detail' in context ? context.detail : undefined}
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1,
            borderRadius: 1,
            flexShrink: 0,
            backgroundColor:
              context.kind === 'shared'
                ? theme.palette.success.main
                : context.kind === 'preapproved'
                  ? theme.palette.info.main
                  : 'rgba(255,255,255,0.2)',
            color:
              context.kind === 'shared'
                ? theme.palette.success.contrastText
                : context.kind === 'preapproved'
                  ? theme.palette.info.contrastText
                  : 'inherit',
          })}
        >
          {context.icon}
          <Typography component="span" variant="body2" noWrap>
            {context.text}
          </Typography>
        </Box>
      )}
      {state === 'interacting' && onLeave && (
        <Button
          size="small"
          variant="contained"
          color="inherit"
          startIcon={<ExitToAppIcon aria-hidden />}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onLeave();
          }}
          data-testid={`element-${elementId}-embedded-widget-leave`}
          sx={{
            flexShrink: 0,
            py: 0,
            minHeight: 0,
            lineHeight: 1.5,
            color: 'primary.main',
            backgroundColor: 'primary.contrastText',
          }}
        >
          {t('embeddedWidget.leave', 'Leave widget')}
        </Button>
      )}
      <Box
        component="span"
        role="status"
        aria-live="polite"
        sx={visuallyHidden}
      >
        {`${name}: ${text}${announcement ? `. ${announcement}` : ''}`}
      </Box>
    </Box>
  );
}
