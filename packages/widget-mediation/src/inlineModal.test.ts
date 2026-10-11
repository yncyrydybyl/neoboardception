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
import { MAX_MODAL_BUTTONS, parseModalSpec } from './inlineModal';

const URL_ = 'https://poll.example/create-poll';

describe('parseModalSpec', () => {
  it('keeps type, name, buttons and data', () => {
    expect(
      parseModalSpec(
        {
          type: 'm.custom',
          url: 'ignored',
          name: ' Create poll ',
          buttons: [{ id: 'save', label: 'Save', kind: 'm.primary' }],
          data: { poll: 1 },
          extra: 'dropped',
        },
        URL_,
      ),
    ).toEqual({
      type: 'm.custom',
      url: URL_,
      name: 'Create poll',
      buttons: [
        { id: 'save', label: 'Save', kind: 'm.primary', disabled: false },
      ],
      data: { poll: 1 },
    });
  });

  it('drops malformed and duplicate buttons and limits their number', () => {
    const spec = parseModalSpec(
      {
        buttons: [
          { id: 'a', label: 'A' },
          { id: 'a', label: 'again' },
          { id: 7, label: 'number id' },
          { id: 'b' },
          'string',
          { id: 'c', label: 'C', disabled: true },
          { id: 'd', label: 'D' },
          { id: 'e', label: 'E' },
        ],
      },
      URL_,
    );
    expect(spec.buttons.map((b) => b.id)).toEqual(['a', 'c', 'd']);
    expect(spec.buttons).toHaveLength(MAX_MODAL_BUTTONS);
    expect(spec.buttons[0].kind).toBe('m.secondary');
    expect(spec.buttons[1].disabled).toBe(true);
  });

  it('tolerates garbage', () => {
    for (const raw of [undefined, null, 'x', [], { data: [1], name: 5 }]) {
      expect(parseModalSpec(raw, URL_)).toEqual({
        type: 'm.custom',
        url: URL_,
        name: '',
        buttons: [],
        data: {},
      });
    }
  });
});
