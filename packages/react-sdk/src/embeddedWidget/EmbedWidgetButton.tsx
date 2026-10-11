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

import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ToolbarButton } from '../components/common/Toolbar';
import {
  useSvgScaleContext,
  whiteboardHeight,
  whiteboardWidth,
} from '../components/Whiteboard';
import {
  copyElementWithAttachedFrame,
  useWhiteboardSlideInstance,
} from '../state';
import { createEmbeddedWidgetElement } from './createEmbeddedWidgetElement';
import { useEmbeddedWidgetHost } from './EmbeddedWidgetProvider';
import { EmbedWidgetDialog } from './EmbedWidgetDialog';

/**
 * Tools bar action "Embed widget". Renders nothing unless insertion is
 * enabled by an {@link EmbeddedWidgetProvider}.
 */
export function EmbedWidgetButton({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation('neoboard');
  const { insertionEnabled, isUrlAllowed } = useEmbeddedWidgetHost();
  const slideInstance = useWhiteboardSlideInstance();
  const { viewportCanvasCenter } = useSvgScaleContext();
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  const handleSubmit = useCallback(
    ({ widgetUrl, title }: { widgetUrl: string; title?: string }) => {
      const element = copyElementWithAttachedFrame(
        createEmbeddedWidgetElement({
          widgetUrl,
          title,
          center: viewportCanvasCenter,
          whiteboardSize: { width: whiteboardWidth, height: whiteboardHeight },
        }),
        slideInstance.getFrameElements(),
      );
      // Keeps the frame relation in sync and selects the new element.
      slideInstance.addElementsWithRelations({ 0: element });
      setOpen(false);
    },
    [slideInstance, viewportCanvasCenter],
  );

  if (!insertionEnabled) {
    return null;
  }

  return (
    <>
      <ToolbarButton
        aria-label={t('embeddedWidget.embedTool', 'Embed widget')}
        disabled={disabled}
        onClick={handleOpen}
      >
        <ExtensionOutlinedIcon />
      </ToolbarButton>
      <EmbedWidgetDialog
        open={open}
        isUrlAllowed={isUrlAllowed}
        onClose={handleClose}
        onSubmit={handleSubmit}
      />
    </>
  );
}
