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

import GppMaybeOutlinedIcon from '@mui/icons-material/GppMaybeOutlined';
import HourglassTopOutlinedIcon from '@mui/icons-material/HourglassTopOutlined';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { groupCapabilities } from './describeCapabilities';
import { EmbeddedWidgetConsentRequest } from './renderer';

export type EmbeddedWidgetConsentProps = {
  elementId: string;
  /** Display name of the widget (title or host name). */
  name: string;
  /** Origin of the widget. */
  origin: string;
} & (
  | {
      /** The board asks the user (local consent). */
      mode: 'consent';
      request: EmbeddedWidgetConsentRequest;
      onRespond: (approved: boolean) => void;
    }
  | {
      /** The Matrix client shows its own dialog right now. */
      mode: 'awaiting-client';
    }
);

/**
 * Explains who asks for permissions. The Matrix client's dialog only names
 * the board, so the board names the embedded widget and its origin, lists
 * what it reads and writes, and asks for consent before anything is passed
 * on or requested from the client.
 */
export function EmbeddedWidgetConsent(props: EmbeddedWidgetConsentProps) {
  const { t } = useTranslation('neoboard');
  const headingId = useId();
  const { elementId, name, origin } = props;

  if (props.mode === 'awaiting-client') {
    return (
      <Box
        data-testid={`element-${elementId}-embedded-widget-awaiting-client`}
        role="group"
        aria-labelledby={headingId}
        sx={panelSx}
      >
        <HourglassTopOutlinedIcon
          aria-hidden
          sx={{ fontSize: 40, color: 'warning.main' }}
        />
        <Typography id={headingId} component="div" variant="h6">
          {t(
            'embeddedWidget.consent.awaitingTitle',
            'Please confirm in the dialog of your Matrix client',
          )}
        </Typography>
        <Typography component="div" variant="body2" sx={{ maxWidth: 520 }}>
          {t(
            'embeddedWidget.consent.awaitingText',
            'The dialog asks on behalf of the NeoBoard. The request comes from the embedded widget “{{name}}” ({{origin}}); the permissions are used by this widget only.',
            { name, origin },
          )}
        </Typography>
      </Box>
    );
  }

  const { request, onRespond } = props;
  const groups = groupCapabilities(request.capabilities);

  return (
    <Box
      data-testid={`element-${elementId}-embedded-widget-consent`}
      role="group"
      aria-labelledby={headingId}
      sx={{ ...panelSx, justifyContent: 'flex-start', overflowY: 'auto' }}
    >
      <GppMaybeOutlinedIcon
        aria-hidden
        sx={{ fontSize: 40, color: 'warning.main' }}
      />
      <Typography id={headingId} component="div" variant="h6">
        {t(
          'embeddedWidget.consent.title',
          '“{{name}}” wants to access this room',
          { name },
        )}
      </Typography>
      <Typography
        component="div"
        variant="body2"
        sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
        data-testid={`element-${elementId}-embedded-widget-consent-origin`}
      >
        {t('embeddedWidget.consent.origin', 'Origin: {{origin}}', {
          origin: request.origin,
        })}
      </Typography>
      <Typography component="div" variant="body2" sx={{ maxWidth: 560 }}>
        {request.upstream.length > 0
          ? t(
              'embeddedWidget.consent.explanationClient',
              'This widget runs inside the NeoBoard. After you agree, your Matrix client asks for permissions on behalf of the NeoBoard — they are used by this widget.',
            )
          : t(
              'embeddedWidget.consent.explanationInherited',
              'This widget runs inside the NeoBoard and would use permissions the NeoBoard already has.',
            )}
      </Typography>
      <Box
        component="ul"
        sx={{ m: 0, pl: 3, textAlign: 'left', maxWidth: 560 }}
        data-testid={`element-${elementId}-embedded-widget-consent-list`}
      >
        {groups.read.length > 0 && (
          <Typography component="li" variant="body2">
            {t('embeddedWidget.consent.reads', 'Reads: {{types}}', {
              types: groups.read.join(', '),
            })}
          </Typography>
        )}
        {groups.write.length > 0 && (
          <Typography component="li" variant="body2">
            {t(
              'embeddedWidget.consent.writes',
              'Writes (visible to everyone in the room): {{types}}',
              { types: groups.write.join(', ') },
            )}
          </Typography>
        )}
        {groups.readsMembers && (
          <Typography component="li" variant="body2" sx={{ fontWeight: 600 }}>
            {t(
              'embeddedWidget.consent.members',
              'Reads the member list of this room (personal data)',
            )}
          </Typography>
        )}
        {groups.other.length > 0 && (
          <Typography component="li" variant="body2">
            {t('embeddedWidget.consent.other', 'Other: {{capabilities}}', {
              capabilities: groups.other.join(', '),
            })}
          </Typography>
        )}
      </Box>
      <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
        <Button
          size="small"
          variant="outlined"
          onClick={() => onRespond(false)}
          data-testid={`element-${elementId}-embedded-widget-consent-deny`}
        >
          {t('embeddedWidget.consent.deny', 'Deny')}
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={() => onRespond(true)}
          data-testid={`element-${elementId}-embedded-widget-consent-allow`}
        >
          {t('embeddedWidget.consent.allow', 'Allow')}
        </Button>
      </Stack>
    </Box>
  );
}

const panelSx = {
  position: 'absolute',
  inset: 0,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  gap: 1,
  padding: 2,
  overflow: 'hidden',
  backgroundColor: 'background.paper',
  color: 'text.primary',
  userSelect: 'none',
} as const;
