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

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { unstable_useId as useId } from '@mui/utils';
import { FormEvent, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  checkEmbeddedWidgetUrl,
  embeddedWidgetTitleMaxLength,
  EmbeddedWidgetUrlCheck,
  EmbeddedWidgetUrlPolicy,
} from './urlPolicy';

export type EmbedWidgetDialogProps = {
  open: boolean;
  isUrlAllowed: EmbeddedWidgetUrlPolicy;
  onClose: () => void;
  onSubmit: (value: { widgetUrl: string; title?: string }) => void;
};

/**
 * Minimal dialog asking for the widget URL and an optional title.
 */
export function EmbedWidgetDialog({
  open,
  isUrlAllowed,
  onClose,
  onSubmit,
}: EmbedWidgetDialogProps) {
  const { t } = useTranslation('neoboard');
  const dialogTitleId = useId();
  const [widgetUrl, setWidgetUrl] = useState('');
  const [title, setTitle] = useState('');
  const [check, setCheck] = useState<EmbeddedWidgetUrlCheck>();

  const handleClose = useCallback(() => {
    setWidgetUrl('');
    setTitle('');
    setCheck(undefined);
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const result = checkEmbeddedWidgetUrl(widgetUrl.trim(), isUrlAllowed);
      setCheck(result);

      if (result.allowed) {
        onSubmit({
          widgetUrl: widgetUrl.trim(),
          title: title.trim() || undefined,
        });
        setWidgetUrl('');
        setTitle('');
        setCheck(undefined);
      }
    },
    [widgetUrl, title, isUrlAllowed, onSubmit],
  );

  let errorText: string | undefined;
  if (check && !check.allowed) {
    errorText =
      check.reason === 'policy'
        ? t(
            'embeddedWidget.dialog.errorPolicy',
            'This widget address is not allowed on this board.',
          )
        : t(
            'embeddedWidget.dialog.errorInvalid',
            'Please enter a valid https address.',
          );
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      aria-labelledby={dialogTitleId}
      fullWidth
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle id={dialogTitleId}>
          {t('embeddedWidget.dialog.title', 'Embed widget')}
        </DialogTitle>
        <DialogContent>
          <Stack gap={2} sx={{ pt: 1 }}>
            <TextField
              autoFocus
              required
              fullWidth
              type="url"
              label={t('embeddedWidget.dialog.urlLabel', 'Widget address')}
              placeholder="https://"
              value={widgetUrl}
              onChange={(e) => {
                setWidgetUrl(e.target.value);
                setCheck(undefined);
              }}
              error={errorText !== undefined}
              helperText={errorText}
            />
            <TextField
              fullWidth
              label={t('embeddedWidget.dialog.titleLabel', 'Title (optional)')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              slotProps={{
                htmlInput: { maxLength: embeddedWidgetTitleMaxLength },
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>
            {t('embeddedWidget.dialog.cancel', 'Cancel')}
          </Button>
          <Button type="submit" variant="contained">
            {t('embeddedWidget.dialog.submit', 'Embed')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
