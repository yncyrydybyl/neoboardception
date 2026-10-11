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

import { mockWidgetApi } from '@matrix-widget-toolkit/testing';
import { describe, expect, it } from 'vitest';
import {
  deserializeFromClipboard,
  serializeToClipboard,
} from '../components/Shortcuts/ClipboardShortcuts/serialization';
import {
  createWhiteboardDocument,
  embeddedWidgetElementSchema,
  exportWhiteboard,
  generateAddElement,
  generateLoadWhiteboardFromExport,
  getElement,
  getNormalizedElementIds,
  isValidElement,
  isValidWhiteboardExportDocument,
  WhiteboardDocumentVersion,
} from '../state';
import { deleteRelations } from '../state/utils';
import { createEmbeddedWidgetElement } from './createEmbeddedWidgetElement';
import { EmbeddedWidgetElement } from './element';
import { embeddedWidgetToPdfShape } from './pdf';

const slide0 = 'IN4h74suMiIAK4AVMAdl_';

function createShell(
  overrides: Partial<EmbeddedWidgetElement> = {},
): EmbeddedWidgetElement {
  return {
    type: 'embedded-widget',
    position: { x: 10, y: 20 },
    width: 480,
    height: 360,
    widgetUrl: 'https://widgets.example.org/poll/',
    ...overrides,
  };
}

describe('embeddedWidgetElementSchema', () => {
  it('should accept a minimal shell', () => {
    expect(isValidElement(createShell())).toBe(true);
  });

  it('should accept all optional fields', () => {
    expect(
      isValidElement(
        createShell({
          title: 'Poll',
          capabilities: ['org.matrix.msc2762.receive.event:m.poll.response'],
          attachedFrame: 'frame-0',
        }),
      ),
    ).toBe(true);
  });

  it('should accept Matrix widget template variables', () => {
    expect(
      isValidElement(
        createShell({
          widgetUrl:
            'https://widgets.example.org/#/?roomId=$matrix_room_id&theme=$org.matrix.msc2873.client_theme',
        }),
      ),
    ).toBe(true);
  });

  it('should default an empty size to 1', () => {
    const { value } = embeddedWidgetElementSchema.validate(
      createShell({ width: 0, height: '' as unknown as number }),
    );
    expect(value).toMatchObject({ width: 1, height: 1 });
  });

  it.each<[string, Record<string, unknown>]>([
    ['missing url', { widgetUrl: undefined }],
    ['empty url', { widgetUrl: '' }],
    ['relative url', { widgetUrl: '/widget' }],
    ['http url', { widgetUrl: 'http://widgets.example.org/' }],
    ['javascript url', { widgetUrl: 'javascript:alert(1)' }],
    ['data url', { widgetUrl: 'data:text/html,<p>x</p>' }],
    ['credentials', { widgetUrl: 'https://user:secret@widgets.example.org/' }],
    [
      'too long url',
      { widgetUrl: `https://widgets.example.org/${'a'.repeat(2048)}` },
    ],
    ['non-string url', { widgetUrl: 1 }],
    ['too long title', { title: 'a'.repeat(257) }],
    ['non-string title', { title: 1 }],
    ['non-array capabilities', { capabilities: 'x' }],
    ['empty capability', { capabilities: [''] }],
    ['duplicate capabilities', { capabilities: ['a', 'a'] }],
    [
      'too many capabilities',
      { capabilities: Array.from({ length: 65 }, (_, i) => `cap${i}`) },
    ],
    ['invalid position', { position: { x: '1', y: 2 } }],
    ['invalid width', { width: '100' }],
    ['disallowed attachedFrame', { attachedFrame: '__proto__' }],
  ])('should reject %s', (_, patch) => {
    expect(isValidElement({ ...createShell(), ...patch })).toBe(false);
  });
});

describe('embedded widget export and import (.nwb)', () => {
  it('should export the shell and validate the export', async () => {
    const document = createWhiteboardDocument();
    document.performChange((doc) => {
      const [addElement] = generateAddElement(
        slide0,
        createShell({ title: 'Poll' }),
      );
      addElement(doc);
    });

    const exported = await exportWhiteboard(
      WhiteboardDocumentVersion.v0,
      document.getData(),
      mockWidgetApi(),
    );

    expect(exported).toEqual({
      version: 'net.nordeck.whiteboard@v1',
      whiteboard: {
        slides: [{ elements: [createShell({ title: 'Poll' })] }],
      },
    });
    expect(
      isValidWhiteboardExportDocument(WhiteboardDocumentVersion.v0, exported),
    ).toBe(true);
  });

  it('should reject an export with an invalid widget URL', () => {
    expect(
      isValidWhiteboardExportDocument(WhiteboardDocumentVersion.v0, {
        version: 'net.nordeck.whiteboard@v1',
        whiteboard: {
          slides: [
            { elements: [createShell({ widgetUrl: 'http://example.org' })] },
          ],
        },
      }),
    ).toBe(false);
  });

  it('should import the shell', () => {
    const document = createWhiteboardDocument();
    document.performChange(
      generateLoadWhiteboardFromExport(
        {
          version: 'net.nordeck.whiteboard@v1',
          whiteboard: { slides: [{ elements: [createShell()] }] },
        },
        '@user-id:example.org',
      ),
    );

    const doc = document.getData();
    const slideId = doc.get('slideIds').get(0);
    const [elementId] = getNormalizedElementIds(doc, slideId);
    expect(getElement(doc, slideId, elementId)?.toJSON()).toEqual(
      createShell(),
    );
  });
});

describe('embedded widget clipboard', () => {
  it('should copy and paste the shell', () => {
    const content = serializeToClipboard({
      elements: { 'element-0': createShell({ title: 'Poll' }) },
    });

    expect(deserializeFromClipboard(content)).toEqual({
      elements: { 'element-0': createShell({ title: 'Poll' }) },
    });
  });
});

describe('deleteRelations', () => {
  it('should remove the attached frame', () => {
    expect(deleteRelations(createShell({ attachedFrame: 'frame-0' }))).toEqual(
      createShell(),
    );
  });
});

describe('createEmbeddedWidgetElement', () => {
  it('should centre and fit a new shell', () => {
    expect(
      createEmbeddedWidgetElement({
        widgetUrl: ' https://widgets.example.org/poll/ ',
        title: '  Poll ',
        capabilities: ['a', 'a', 'b'],
        center: { x: 500, y: 400 },
        whiteboardSize: { width: 1920, height: 1080 },
      }),
    ).toEqual({
      type: 'embedded-widget',
      position: { x: 140, y: 130 },
      width: 720,
      height: 540,
      widgetUrl: 'https://widgets.example.org/poll/',
      title: 'Poll',
      capabilities: ['a', 'b'],
    });
  });

  it('should clamp into the whiteboard and omit an empty title', () => {
    const element = createEmbeddedWidgetElement({
      widgetUrl: 'https://widgets.example.org/',
      title: ' ',
      center: { x: 0, y: 0 },
      whiteboardSize: { width: 1920, height: 1080 },
    });
    expect(element.position).toEqual({ x: 0, y: 0 });
    expect(element).not.toHaveProperty('title');
    expect(isValidElement(element)).toBe(true);
  });

  it('should throw for an invalid URL', () => {
    expect(() =>
      createEmbeddedWidgetElement({
        widgetUrl: 'http://widgets.example.org/',
        center: { x: 0, y: 0 },
        whiteboardSize: { width: 1920, height: 1080 },
      }),
    ).toThrow();
  });
});

describe('embeddedWidgetToPdfShape', () => {
  it('should render title and URL into a rectangle', () => {
    expect(
      embeddedWidgetToPdfShape(createShell({ title: 'Poll' })),
    ).toMatchObject({
      type: 'shape',
      kind: 'rectangle',
      position: { x: 10, y: 20 },
      width: 480,
      height: 360,
      text: 'Poll\nhttps://widgets.example.org/poll/',
    });
  });
});
