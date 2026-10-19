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
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
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
  useWhiteboardSlideOrFrameIds,
} from '../../state';
import { ToolbarButton } from '../common/Toolbar';
import { useReducedMotionPreference } from '../Whiteboard/Presentation/reducedMotion';

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
    // stored as `zoom` for compatibility; it scales the view, the camera
    // does not move
    case 'zoom':
      return t('presentBar.transition.zoom', 'Scale');
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
      return t(
        'presentBar.transition.zoomDescription',
        'Grow and fade into the frame',
      );
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

function UseForAllFramesDialog({
  open,
  count,
  transition,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  count: number;
  transition: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
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
    >
      <DialogTitle id={titleId}>
        {t(
          'presentBar.transition.useForAllTitle',
          'Use "{{transition}}" for all frames?',
          { transition },
        )}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id={descriptionId}>
          {t('presentBar.transition.useForAllText', {
            defaultValue_one:
              'One frame has its own transition. It will be removed for everyone on this board and cannot be restored with undo.',
            defaultValue:
              '{{count}} frames have their own transition. They will be removed for everyone on this board and cannot be restored with undo.',
            count,
          })}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button autoFocus onClick={onCancel}>
          {t('presentBar.transition.useForAllCancel', 'Cancel')}
        </Button>
        <Button variant="contained" onClick={onConfirm}>
          {t('presentBar.transition.useForAll', 'Use for all frames')}
        </Button>
      </DialogActions>
    </Dialog>
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
 *
 * Outside of a presentation the menu tells how many frames have their own
 * transition and can remove these overrides. If the system of the viewer
 * asks for reduced motion, it offers to play the transitions anyway on this
 * device.
 */
export function TransitionMenu({
  activeFrameId,
  placement = 'left',
}: TransitionMenuProps) {
  const { t } = useTranslation('neoboard');
  const {
    settings,
    setTransition,
    setSpeed,
    setFrameTransition,
    clearFrameTransitions,
  } = usePresentationSettings();
  const {
    systemPrefersReducedMotion,
    ignoreReducedMotion,
    setIgnoreReducedMotion,
  } = useReducedMotionPreference();
  const frameIds = useWhiteboardSlideOrFrameIds();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
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

  // overrides of frames that were deleted do not count
  const overrideCount = frameIds.filter(
    (id) => settings.frameTransitions[id] !== undefined,
  ).length;

  const handleUseForAll = useCallback(() => {
    setAnchorEl(null);
    setConfirmOpen(true);
  }, []);
  const handleConfirmUseForAll = useCallback(() => {
    clearFrameTransitions();
    setConfirmOpen(false);
  }, [clearFrameTransitions]);
  const handleCancelUseForAll = useCallback(() => setConfirmOpen(false), []);

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
          sx: { minWidth: '240px', maxWidth: '320px' },
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
        {activeFrameId === undefined &&
          overrideCount > 0 && [
            <Divider key="frames-divider" />,
            <ListSubheader key="frames-header" role="presentation">
              {t('presentBar.transition.frames', 'Frames')}
            </ListSubheader>,
            <MenuItem key="frames-use-for-all" onClick={handleUseForAll}>
              <ListItemIcon />
              <ListItemText
                primary={t(
                  'presentBar.transition.useForAll',
                  'Use for all frames',
                )}
                secondary={t('presentBar.transition.frameOverrides', {
                  defaultValue_one: 'One frame has its own transition',
                  defaultValue: '{{count}} frames have their own transition',
                  count: overrideCount,
                })}
              />
            </MenuItem>,
          ]}
        {systemPrefersReducedMotion && [
          <Divider key="motion-divider" />,
          <ListSubheader key="motion-header" role="presentation">
            {t('presentBar.reducedMotion.title', 'Reduced motion')}
          </ListSubheader>,
          <MenuItem
            key="motion-ignore"
            role="menuitemcheckbox"
            aria-checked={ignoreReducedMotion}
            onClick={() => setIgnoreReducedMotion(!ignoreReducedMotion)}
          >
            <ListItemIcon>
              {ignoreReducedMotion ? (
                <CheckBoxIcon fontSize="small" />
              ) : (
                <CheckBoxOutlineBlankIcon fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText
              primary={t(
                'presentBar.reducedMotion.playAnyway',
                'Play transitions anyway (this device)',
              )}
              secondary={
                ignoreReducedMotion
                  ? t(
                      'presentBar.reducedMotion.noteIgnored',
                      'Your system asks for reduced motion, but transitions play as usual on this device.',
                    )
                  : t(
                      'presentBar.reducedMotion.note',
                      'Your system asks for reduced motion, so transitions play as fades on this device.',
                    )
              }
              secondaryTypographyProps={{ sx: { whiteSpace: 'normal' } }}
            />
          </MenuItem>,
        ]}
      </Menu>
      <UseForAllFramesDialog
        open={confirmOpen}
        count={overrideCount}
        transition={transitionLabel(t, settings.transition)}
        onCancel={handleCancelUseForAll}
        onConfirm={handleConfirmUseForAll}
      />
    </>
  );
}
