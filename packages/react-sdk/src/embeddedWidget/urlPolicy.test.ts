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
  checkEmbeddedWidgetUrl,
  createOriginAllowListPolicy,
  denyAllEmbeddedWidgetUrls,
  validateEmbeddedWidgetUrl,
} from './urlPolicy';

describe('validateEmbeddedWidgetUrl', () => {
  it('should accept https URLs', () => {
    const result = validateEmbeddedWidgetUrl(
      'https://widgets.example.org:8443/poll/?a=$matrix_user_id#/x',
    );
    expect(result.valid).toBe(true);
  });

  it.each([
    ['', 'invalid'],
    ['widgets.example.org', 'invalid'],
    ['http://widgets.example.org', 'not-https'],
    ['javascript:alert(1)', 'not-https'],
    ['data:text/html,x', 'not-https'],
    ['blob:https://widgets.example.org/1', 'not-https'],
    ['https://user@widgets.example.org', 'credentials'],
    ['https://user:pw@widgets.example.org', 'credentials'],
    [`https://widgets.example.org/${'a'.repeat(2048)}`, 'too-long'],
  ])('should reject %j as %s', (url, reason) => {
    expect(validateEmbeddedWidgetUrl(url)).toEqual({ valid: false, reason });
  });
});

describe('createOriginAllowListPolicy', () => {
  const policy = createOriginAllowListPolicy([
    'https://widgets.example.org',
    ' https://other.example.org:8443/ignored/path ',
    'http://insecure.example.org',
    'not a url',
  ]);

  it.each([
    ['https://widgets.example.org/poll/', true],
    ['https://other.example.org:8443/x', true],
    ['https://other.example.org/x', false],
    ['https://evil.example.org/', false],
    ['https://widgets.example.org.evil.example/', false],
    ['https://insecure.example.org/', false],
  ])('%s -> %s', (url, expected) => {
    expect(policy(new URL(url))).toBe(expected);
  });

  it('should allow nothing for an empty list', () => {
    expect(
      createOriginAllowListPolicy([])(new URL('https://widgets.example.org')),
    ).toBe(false);
  });
});

describe('checkEmbeddedWidgetUrl', () => {
  const policy = createOriginAllowListPolicy(['https://widgets.example.org']);

  it('should allow an allow-listed https URL', () => {
    expect(
      checkEmbeddedWidgetUrl('https://widgets.example.org/a', policy),
    ).toMatchObject({ allowed: true });
  });

  it('should deny by default', () => {
    expect(
      checkEmbeddedWidgetUrl(
        'https://widgets.example.org/a',
        denyAllEmbeddedWidgetUrls,
      ),
    ).toEqual({ allowed: false, reason: 'policy' });
  });

  it('should not consult the policy for invalid URLs', () => {
    expect(
      checkEmbeddedWidgetUrl('http://widgets.example.org/a', () => true),
    ).toEqual({ allowed: false, reason: 'not-https' });
  });

  it('should treat a throwing policy as deny', () => {
    expect(
      checkEmbeddedWidgetUrl('https://widgets.example.org/a', () => {
        throw new Error('boom');
      }),
    ).toEqual({ allowed: false, reason: 'policy' });
  });
});
