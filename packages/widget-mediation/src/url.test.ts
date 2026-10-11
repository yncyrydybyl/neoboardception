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
  buildWidgetUrl,
  deriveEmbeddedWidgetId,
  validateWidgetUrl,
  WidgetUrlError,
} from './url';

const params = {
  userId: '@alice:example.org',
  roomId: '!room:example.org',
  displayName: 'Alice',
  avatarUrl: 'https://example.org/a.png',
  theme: 'dark',
  clientId: 'io.element.web',
  clientLanguage: 'de',
  baseUrl: 'https://matrix.example.org',
  deviceId: 'DEVICE',
};

function fragmentParams(url: string) {
  const hash = new URL(url).hash;
  return new URLSearchParams(hash.slice(hash.indexOf('?') + 1));
}

describe('validateWidgetUrl', () => {
  const opts = { hostOrigin: 'https://board.example' };

  it('accepts https URLs', () => {
    expect(validateWidgetUrl('https://poll.example/', opts).origin).toBe(
      'https://poll.example',
    );
  });

  it.each([
    'http://poll.example/',
    'javascript:alert(1)',
    'data:text/html,hi',
    'https://user:pw@poll.example/',
    'https://board.example/other',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => validateWidgetUrl(url, opts)).toThrow(WidgetUrlError);
  });

  it('allows http://localhost only when enabled', () => {
    expect(() => validateWidgetUrl('http://localhost:5173/', opts)).toThrow();
    expect(
      validateWidgetUrl('http://localhost:5173/', {
        ...opts,
        allowInsecureLocalhost: true,
      }).origin,
    ).toBe('http://localhost:5173');
  });
});

describe('deriveEmbeddedWidgetId', () => {
  it('derives an own id that is not a modal id', () => {
    const id = deriveEmbeddedWidgetId('element/1 ü');
    expect(id).toBe('embedded-element-1--');
    expect(id.startsWith('modal_')).toBe(false);
  });

  it('refuses ids containing the host widget id', () => {
    expect(() => deriveEmbeddedWidgetId('host-abc', 'host-abc')).toThrow();
  });
});

describe('buildWidgetUrl', () => {
  it('appends all toolkit parameters and fills them', () => {
    const url = buildWidgetUrl({
      widgetUrl: new URL('https://poll.example/'),
      widgetId: 'embedded-1',
      params,
      parentOrigin: 'https://board.example',
    });
    const u = new URL(url);
    expect(u.searchParams.get('widgetId')).toBe('embedded-1');
    expect(u.searchParams.get('parentUrl')).toBe('https://board.example/');
    const f = fragmentParams(url);
    expect(Object.fromEntries(f)).toEqual({
      theme: 'dark',
      matrix_user_id: '@alice:example.org',
      matrix_display_name: 'Alice',
      matrix_avatar_url: 'https://example.org/a.png',
      matrix_room_id: '!room:example.org',
      matrix_client_id: 'io.element.web',
      matrix_client_language: 'de',
      matrix_device_id: 'DEVICE',
      matrix_base_url: 'https://matrix.example.org',
    });
  });

  it('fills an existing template and only adds what is missing', () => {
    const url = buildWidgetUrl({
      widgetUrl: new URL(
        'https://poll.example/app?room=$matrix_room_id&wid=$matrix_widget_id#/x?theme=$org.matrix.msc2873.client_theme&custom=$foo',
      ),
      widgetId: 'embedded-1',
      params,
      parentOrigin: 'https://board.example',
      data: { foo: 'bar' },
    });
    const u = new URL(url);
    expect(u.pathname).toBe('/app');
    expect(u.searchParams.get('room')).toBe('!room:example.org');
    expect(u.searchParams.get('wid')).toBe('embedded-1');
    expect(u.hash.startsWith('#/x?')).toBe(true);
    const f = fragmentParams(url);
    expect(f.get('theme')).toBe('dark');
    expect(f.get('custom')).toBe('bar');
    expect(f.getAll('theme')).toHaveLength(1);
    expect(f.get('matrix_user_id')).toBe('@alice:example.org');
  });

  it('never passes the host widget id or URL', () => {
    const url = buildWidgetUrl({
      widgetUrl: new URL(
        'https://poll.example/?widgetId=host-widget-id&parentUrl=https%3A%2F%2Fevil.example#/?widgetId=host-widget-id&parentUrl=x&a=1',
      ),
      widgetId: 'embedded-1',
      params,
      parentOrigin: 'https://board.example',
    });
    expect(url).not.toContain('host-widget-id');
    expect(url).not.toContain('evil.example');
    expect(new URL(url).searchParams.getAll('widgetId')).toEqual([
      'embedded-1',
    ]);
    expect(fragmentParams(url).has('widgetId')).toBe(false);
    expect(fragmentParams(url).has('parentUrl')).toBe(false);
    expect(fragmentParams(url).get('a')).toBe('1');
  });

  it('supplies empty strings for unknown parameters', () => {
    const url = buildWidgetUrl({
      widgetUrl: new URL('https://poll.example/'),
      widgetId: 'embedded-1',
      params: { userId: '@a:example.org', roomId: '!r:example.org' },
      parentOrigin: 'https://board.example',
    });
    const f = fragmentParams(url);
    expect(f.get('matrix_avatar_url')).toBe('');
    expect(f.get('matrix_display_name')).toBe('@a:example.org');
    expect(f.has('matrix_base_url')).toBe(true);
  });

  it('supplies only the declared parameters', () => {
    const url = buildWidgetUrl({
      widgetUrl: new URL('https://poll.example/?u=$matrix_user_id'),
      widgetId: 'embedded-1',
      params,
      parentOrigin: 'https://board.example',
      parameters: ['theme', 'matrix_room_id'],
    });
    expect(url).not.toContain('alice');
    expect(new URL(url).searchParams.get('u')).toBe('');
    expect(Object.fromEntries(fragmentParams(url))).toEqual({
      theme: 'dark',
      matrix_room_id: '!room:example.org',
    });
  });
});
