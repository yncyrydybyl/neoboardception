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
import {
  createWhiteboardDocument,
  generateAddElement,
  generateRemoveElement,
  generateUpdateElement,
  getElement,
  getNormalizedElementIds,
  isValidWhiteboardDocument,
  WhiteboardDocumentVersion,
} from '../state';
import { EmbeddedWidgetElement } from './element';

const slide0 = 'IN4h74suMiIAK4AVMAdl_';

const shellKeys = [
  'attachedFrame',
  'capabilities',
  'height',
  'position',
  'title',
  'type',
  'widgetUrl',
  'width',
];

function createShell(
  overrides: Partial<EmbeddedWidgetElement> = {},
): EmbeddedWidgetElement {
  return {
    type: 'embedded-widget',
    position: { x: 10, y: 20 },
    width: 480,
    height: 360,
    widgetUrl: 'https://widgets.example.org/poll/#/?roomId=$matrix_room_id',
    title: 'Poll',
    ...overrides,
  };
}

/** Two documents that exchange their updates like two clients. */
function createSyncedPair(
  version: WhiteboardDocumentVersion = WhiteboardDocumentVersion.v1,
) {
  const docA = createWhiteboardDocument(version);
  const docB = createWhiteboardDocument(version);
  docA.observePublish().subscribe((update) => docB.applyChange(update));
  docB.observePublish().subscribe((update) => docA.applyChange(update));
  return { docA, docB };
}

describe('embedded widget shell in the CRDT', () => {
  it.each([WhiteboardDocumentVersion.v0, WhiteboardDocumentVersion.v1])(
    'should sync the shell to a second document (version %s)',
    (version) => {
      const { docA, docB } = createSyncedPair(version);

      const [addFn, elementId] = generateAddElement(slide0, createShell());
      docA.performChange(addFn);

      expect(getNormalizedElementIds(docB.getData(), slide0)).toEqual([
        elementId,
      ]);
      expect(getElement(docB.getData(), slide0, elementId)?.toJSON()).toEqual(
        createShell(),
      );
      expect(isValidWhiteboardDocument(docB)).toBe(true);
    },
  );

  it('should sync moves, resizes and title changes in both directions', () => {
    const { docA, docB } = createSyncedPair();
    const [addFn, elementId] = generateAddElement(slide0, createShell());
    docA.performChange(addFn);

    docB.performChange(
      generateUpdateElement(slide0, elementId, {
        position: { x: 300, y: 400 },
        width: 640,
        height: 480,
      }),
    );
    docA.performChange(
      generateUpdateElement(slide0, elementId, { title: 'Team poll' }),
    );

    const expected = createShell({
      position: { x: 300, y: 400 },
      width: 640,
      height: 480,
      title: 'Team poll',
    });
    expect(getElement(docA.getData(), slide0, elementId)?.toJSON()).toEqual(
      expected,
    );
    expect(getElement(docB.getData(), slide0, elementId)?.toJSON()).toEqual(
      expected,
    );
  });

  it('should sync the removal of the shell', () => {
    const { docA, docB } = createSyncedPair();
    const [addFn, elementId] = generateAddElement(slide0, createShell());
    docA.performChange(addFn);
    docB.performChange(generateRemoveElement(slide0, elementId));

    expect(getElement(docA.getData(), slide0, elementId)).toBeUndefined();
    expect(getNormalizedElementIds(docA.getData(), slide0)).toEqual([]);
  });

  it('should only contain shell keys in the document', () => {
    const { docA, docB } = createSyncedPair();
    const [addFn, elementId] = generateAddElement(
      slide0,
      createShell({
        capabilities: ['org.matrix.msc2762.receive.event:m.poll.response'],
      }),
    );
    docA.performChange(addFn);

    const element = getElement(docB.getData(), slide0, elementId)!.toJSON();
    for (const key of Object.keys(element)) {
      expect(shellKeys).toContain(key);
    }
  });

  it('should replicate a full snapshot into a fresh document', () => {
    const docA = createWhiteboardDocument(WhiteboardDocumentVersion.v1);
    const [addFn, elementId] = generateAddElement(slide0, createShell());
    docA.performChange(addFn);

    const docB = createWhiteboardDocument(WhiteboardDocumentVersion.v1);
    docB.mergeFrom(docA.store());

    expect(getElement(docB.getData(), slide0, elementId)?.toJSON()).toEqual(
      createShell(),
    );
  });

  it('should reject a document with a non-https widget URL', () => {
    const doc = createWhiteboardDocument(WhiteboardDocumentVersion.v1);
    const [addFn] = generateAddElement(
      slide0,
      createShell({ widgetUrl: 'javascript:alert(1)' }),
    );
    doc.performChange(addFn);

    expect(isValidWhiteboardDocument(doc)).toBe(false);
  });

  it('should undo and redo the insertion', () => {
    const doc = createWhiteboardDocument(WhiteboardDocumentVersion.v1);
    const [addFn, elementId] = generateAddElement(slide0, createShell());
    doc.performChange(addFn);
    expect(getElement(doc.getData(), slide0, elementId)).toBeDefined();

    doc.getUndoManager().undo();
    expect(getElement(doc.getData(), slide0, elementId)).toBeUndefined();

    doc.getUndoManager().redo();
    expect(getElement(doc.getData(), slide0, elementId)?.toJSON()).toEqual(
      createShell(),
    );
  });
});
