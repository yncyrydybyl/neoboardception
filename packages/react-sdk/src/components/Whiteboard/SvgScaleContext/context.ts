/*
 * Copyright 2025 Nordeck IT + Consulting GmbH
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

import { createContext, useContext } from 'react';
import { Point } from '../../../state';

export type Translation = { x: number; y: number };

export type ContainerDimensions = { width: number; height: number };

export type Operation = 'set' | 'add';

/**
 * What caused a viewport change: `user` for gestures and zoom controls,
 * `camera` for presentation transitions.
 */
export type ViewportChangeSource = 'user' | 'camera';

/**
 * This context provides data and functions to handle a scaled SVG element inside a container.
 */
export type SvgScaleContextType = {
  /**
   * Scale that is applied to the SVG
   */
  scale: number;

  /**
   * Update the scale that is applied to the SVG
   *
   * @param scaleChange - value to add to the current scale
   * @param operation - either 'set' a scale or 'add' a value to the current scale value
   * @param origin - canvas coordinates of the point that should stay in the same place when scaling
   */
  updateScale: (
    scaleChange: number,
    operation: Operation,
    origin: Point,
  ) => void;

  /**
   * Translation that is applied to the SVG
   */
  translation: Translation;

  /**
   * Update the translation that is applied to the SVG
   *
   * @param changeX - X value to add to the current translation
   * @param changeY - Y value to add to the current translation
   */
  updateTranslation: (changeX: number, changeY: number) => void;

  /**
   * Dimensions of the container holing the SVG
   */
  containerDimensions: ContainerDimensions;

  /**
   * Set the dimensions of the container holing the SVG
   */
  setContainerDimensions: (dimensions: ContainerDimensions) => void;

  /**
   * Transform a point from the SVG coordinate system to pixels on the container.
   */
  transformPointSvgToContainer: (point: Point) => Point;

  /**
   * Center point of the canvas on the current viewport.
   */
  viewportCanvasCenter: Point;

  /**
   * Move the viewport center to a specific canvas position and scale
   *
   * @param source - what causes the change, default `user`
   */
  moveToPositionAndScale: (
    position: Point,
    scale: number,
    source?: ViewportChangeSource,
  ) => void;

  /**
   * What caused the last change of the viewport.
   */
  viewportChangeSource: ViewportChangeSource;
};

export const SvgScaleContext = createContext<SvgScaleContextType | undefined>(
  undefined,
);

/**
 * Whether a presentation transition moves the camera continuously. Kept
 * apart from {@link SvgScaleContext}, so that starting a flight does not
 * render every element of the board. The viewport state of the scale
 * context is only updated at the end of the movement.
 */
export type SvgCameraContextType = {
  cameraMoving: boolean;
  setCameraMoving: (moving: boolean) => void;
};

export const SvgCameraContext = createContext<SvgCameraContextType>({
  cameraMoving: false,
  setCameraMoving: () => {},
});

export const useSvgCameraContext = (): SvgCameraContextType =>
  useContext(SvgCameraContext);

export const useSvgScaleContext = (): SvgScaleContextType => {
  const context = useContext(SvgScaleContext);

  if (context === undefined) {
    throw new Error('useSvgScaleContext must be used within a SvgScaleContext');
  }

  return context;
};
