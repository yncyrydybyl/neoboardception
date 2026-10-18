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

import AnimationIcon from '@mui/icons-material/Animation';
import CheckIcon from '@mui/icons-material/Check';
import {
  Divider,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  TooltipProps,
} from '@mui/material';
import { unstable_useId as useId } from '@mui/utils';
import { TFunction } from 'i18next';
import { MouseEvent, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PresentationSpeed,
  PresentationTransition,
  presentationSpeeds,
  presentationTransitions,
  usePresentationSettings,
} from '../../state';
import { ToolbarButton } from '../common/Toolbar';

export function transitionLabel(
  t: TFunction<'neoboard'>,
  transition: PresentationTransition,
): string {
  switch (transition) {
    case 'fly':
      return t('presentBar.transition.fly', 'Fly');
    case 'fade':
      return t('presentBar.transition.fade', 'Fade');
    case 'slide':
      return t('presentBar.transition.slide', 'Slide');
    case 'zoom':
      return t('presentBar.transition.zoom', 'Zoom');
    case 'none':
      return t('presentBar.transition.none', 'None');
  }
}

function transitionDescription(
  t: TFunction<'neoboard'>,
  transition: PresentationTransition,
): string {
  switch (transition) {
    case 'fly':
      return t(
        'presentBar.transition.flyDescription',
        'Zoom out, pan and zoom in',
      );
    case 'fade':
      return t('presentBar.transition.fadeDescription', 'Fade out and in');
    case 'slide':
      return t(
        'presentBar.transition.slideDescription',
        'Push the frame aside',
      );
    case 'zoom':
      return t('presentBar.transition.zoomDescription', 'Dive into the frame');
    case 'none':
      return t('presentBar.transition.noneDescription', 'Jump directly');
  }
}

function speedLabel(
  t: TFunction<'neoboard'>,
  speed: PresentationSpeed,
): string {
  switch (speed) {
    case 'slow':
      return t('presentBar.speed.slow', 'Slow');
    case 'normal':
      return t('presentBar.speed.normal', 'Normal');
    case 'fast':
      return t('presentBar.speed.fast', 'Fast');
  }
}

function RadioMenuItem({
  checked,
  primary,
  secondary,
  onClick,
}: {
  checked: boolean;
  primary: string;
  secondary?: string;
  onClick: () => void;
}) {
  return (
    <MenuItem role="menuitemradio" aria-checked={checked} onClick={onClick}>
      <ListItemIcon>{checked && <CheckIcon fontSize="small" />}</ListItemIcon>
      <ListItemText primary={primary} secondary={secondary} />
    </MenuItem>
  );
}

export type TransitionMenuProps = {
  /** The frame the presentation shows now; enables the per frame setting. */
  activeFrameId?: string;
  placement?: TooltipProps['placement'];
};

/**
 * Menu to choose the transition between frames, its speed and an override
 * for the current frame. The settings are stored in the board, so every
 * viewer sees the same transitions.
 */
export function TransitionMenu({
  activeFrameId,
  placement = 'left',
}: TransitionMenuProps) {
  const { t } = useTranslation('neoboard');
  const { settings, setTransition, setSpeed, setFrameTransition } =
    usePresentationSettings();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const buttonId = useId();
  const menuId = useId();

  const handleOpen = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  }, []);
  const handleClose = useCallback(() => setAnchorEl(null), []);

  const frameTransition =
    activeFrameId !== undefined
      ? settings.frameTransitions[activeFrameId]
      : undefined;

  const title = t('presentBar.transition.title', 'Transitions');

  return (
    <>
      <ToolbarButton
        id={buttonId}
        aria-label={title}
        aria-haspopup="true"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open ? 'true' : undefined}
        onClick={handleOpen}
        placement={placement}
      >
        <AnimationIcon />
      </ToolbarButton>
      <Menu
        id={menuId}
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        MenuListProps={{
          'aria-labelledby': buttonId,
          dense: true,
          sx: { minWidth: '240px' },
        }}
      >
        <ListSubheader role="presentation">
          {t('presentBar.transition.between', 'Between frames')}
        </ListSubheader>
        {presentationTransitions.map((transition) => (
          <RadioMenuItem
            key={transition}
            checked={settings.transition === transition}
            primary={transitionLabel(t, transition)}
            secondary={transitionDescription(t, transition)}
            onClick={() => setTransition(transition)}
          />
        ))}
        <Divider />
        <ListSubheader role="presentation">
          {t('presentBar.speed.title', 'Speed')}
        </ListSubheader>
        {presentationSpeeds.map((speed) => (
          <RadioMenuItem
            key={speed}
            checked={settings.speed === speed}
            primary={speedLabel(t, speed)}
            onClick={() => setSpeed(speed)}
          />
        ))}
        {activeFrameId !== undefined && [
          <Divider key="frame-divider" />,
          <ListSubheader key="frame-header" role="presentation">
            {t('presentBar.transition.toThisFrame', 'Into this frame')}
          </ListSubheader>,
          <RadioMenuItem
            key="frame-default"
            checked={frameTransition === undefined}
            primary={t(
              'presentBar.transition.likePresentation',
              'Like all frames',
            )}
            onClick={() => setFrameTransition(activeFrameId, undefined)}
          />,
          ...presentationTransitions.map((transition) => (
            <RadioMenuItem
              key={`frame-${transition}`}
              checked={frameTransition === transition}
              primary={transitionLabel(t, transition)}
              onClick={() => setFrameTransition(activeFrameId, transition)}
            />
          )),
        ]}
      </Menu>
    </>
  );
}
