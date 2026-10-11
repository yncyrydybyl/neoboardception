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
import { limitLiveElementIds } from './EmbeddedWidgetProvider';

describe('limitLiveElementIds', () => {
  it('keeps the most recently activated widgets within the cap', () => {
    expect(limitLiveElementIds(['a', 'b', 'c'], new Set(), 2)).toEqual([
      'b',
      'c',
    ]);
    expect(limitLiveElementIds(['a'], new Set(), 3)).toEqual(['a']);
  });

  it('never drops pinned widgets', () => {
    expect(limitLiveElementIds(['a', 'b', 'c'], new Set(['a']), 2)).toEqual([
      'a',
      'c',
    ]);
  });

  it('keeps the newest widget even if pinned ones fill the cap', () => {
    expect(
      limitLiveElementIds(['a', 'b', 'c'], new Set(['a', 'b']), 2),
    ).toEqual(['a', 'b', 'c']);
    expect(limitLiveElementIds(['a', 'b'], new Set(['a']), 1)).toEqual([
      'a',
      'b',
    ]);
  });

  it('drops everything unpinned with a cap of 0', () => {
    expect(limitLiveElementIds(['a', 'b'], new Set(['a']), 0)).toEqual(['a']);
  });
});
