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
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { unstable_useId as useId } from '@mui/utils';
import { useTranslation } from 'react-i18next';

export type EmbeddedWidgetRemovalDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Asks before deleting an element that holds a running call: the element
 * disappears for everyone, so everyone in the call on this board leaves it.
 */
export function EmbeddedWidgetRemovalDialog({
  open,
  onCancel,
  onConfirm,
}: EmbeddedWidgetRemovalDialogProps) {
  const { t } = useTranslation('neoboard');
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      maxWidth="xs"
      data-testid="embedded-widget-removal-dialog"
    >
      <DialogTitle id={titleId}>
        {t('embeddedWidget.removeCall.title', 'The running call will end')}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id={descriptionId}>
          {t(
            'embeddedWidget.removeCall.text',
            'This element holds a running call. Deleting it removes it for everyone, and everyone in the call on this board leaves the call.',
          )}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button autoFocus onClick={onCancel}>
          {t('embeddedWidget.removeCall.cancel', 'Cancel')}
        </Button>
        <Button color="error" variant="contained" onClick={onConfirm}>
          {t('embeddedWidget.removeCall.confirm', 'Delete and end call')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
