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

import { describe, expect, it } from 'vitest';
import { isEmbeddedBoard } from './isEmbeddedBoard';

describe('isEmbeddedBoard', () => {
  it.each([
    ['?widgetId=embedded-el-1', '', true],
    ['', '#/?matrix_widget_id=embedded-el-1', true],
    ['?widgetId=board', '#/?matrix_widget_id=board', false],
    ['?widgetId=my-embedded-board', '', false],
    ['', '', false],
  ])('search %j hash %j → %s', (search, hash, expected) => {
    expect(isEmbeddedBoard({ search, hash })).toBe(expected);
  });
});
