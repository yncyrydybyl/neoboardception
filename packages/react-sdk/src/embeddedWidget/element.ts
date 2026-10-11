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

import Joi from 'joi';
// Type-only import: no runtime cycle with the element module.
import type { ElementBase } from '../state/crdt/documents/elements';
import {
  embeddedWidgetTitleMaxLength,
  embeddedWidgetUrlMaxLength,
  validateEmbeddedWidgetUrl,
} from './urlPolicy';

export const embeddedWidgetElementType = 'embedded-widget';

/**
 * The *shell* of an embedded widget as it is stored in the board document
 * (Yjs CRDT) and therefore synchronized to all participants.
 *
 * It intentionally contains no widget content and no runtime state (iframe
 * state, focus, capabilities, poll votes, ...). Widget content lives in Matrix
 * events and is fetched by the embedded widget itself.
 */
export type EmbeddedWidgetElement = ElementBase & {
  type: typeof embeddedWidgetElementType;
  width: number;
  height: number;
  /**
   * Absolute https URL of the widget. May contain Matrix widget template
   * variables (e.g. `$matrix_room_id`) that are substituted at render time.
   */
  widgetUrl: string;
  /** Optional label shown in the placeholder and to assistive technology. */
  title?: string;
  /**
   * Optional list of Matrix widget capabilities the widget is expected to
   * request. Declarative metadata only: it lets the host batch capability
   * requests early (e.g. while the widget is still loading). It grants
   * nothing; hosts must still intersect it with their own allow-list.
   */
  capabilities?: string[];
  attachedFrame?: string;
};

/** Maximum number of entries in {@link EmbeddedWidgetElement.capabilities}. */
export const embeddedWidgetCapabilitiesMaxCount = 64;
/** Maximum length of a single capability string. */
export const embeddedWidgetCapabilityMaxLength = 512;

export const defaultEmbeddedWidgetSize = { width: 720, height: 540 };

const emptyCoordinateSchema = Joi.any().valid(null, 0, '');

const widgetUrlSchema = Joi.string()
  .max(embeddedWidgetUrlMaxLength)
  .custom((value: string, helpers) =>
    validateEmbeddedWidgetUrl(value).valid
      ? value
      : helpers.error('any.invalid'),
  )
  .required();

/**
 * Element-specific schema keys, to be appended to the element base schema by
 * the element module. Passed the disallowed id list to avoid a runtime import
 * cycle.
 */
export function createEmbeddedWidgetElementSchemaKeys(
  disallowElementIds: string[],
) {
  return {
    type: Joi.string().valid(embeddedWidgetElementType).required(),
    width: Joi.number().strict().empty(emptyCoordinateSchema).default(1),
    height: Joi.number().strict().empty(emptyCoordinateSchema).default(1),
    widgetUrl: widgetUrlSchema,
    title: Joi.string().allow('').max(embeddedWidgetTitleMaxLength),
    capabilities: Joi.array()
      .items(Joi.string().min(1).max(embeddedWidgetCapabilityMaxLength))
      .max(embeddedWidgetCapabilitiesMaxCount)
      .unique(),
    attachedFrame: Joi.string().not(...disallowElementIds),
  };
}
