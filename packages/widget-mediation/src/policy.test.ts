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
import { POLL_CAPABILITIES } from './capabilities';
import {
  decideEmbeddedWidget,
  decodeEmbeddedWidgetPolicy,
  EmbeddedWidgetPolicy,
  findPolicyRule,
  parseEmbeddedWidgetPolicy,
  POLICY_LIMITS,
  policyInitialCapabilities,
  policyMatchKey,
  policyOrigins,
} from './policy';

const VOTE = 'org.matrix.msc2762.send.event:net.nordeck.poll.vote';
const READ_VOTE = 'org.matrix.msc2762.receive.event:net.nordeck.poll.vote';
const MEMBERS = 'org.matrix.msc2762.receive.state_event:m.room.member';
const BOARD_SEND = 'org.matrix.msc2762.send.event:net.nordeck.whiteboard.chunk';

function valid(input: unknown): EmbeddedWidgetPolicy {
  const result = parseEmbeddedWidgetPolicy(input);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.policy;
}

function errorsOf(input: unknown): string[] {
  const result = parseEmbeddedWidgetPolicy(input);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

function ruleFor(pattern: string, rule: unknown = {}) {
  return { widget_permissions: { [pattern]: rule } };
}

describe('policyMatchKey', () => {
  it('strips query and fragment and normalises the URL', () => {
    expect(
      policyMatchKey('https://Poll.Example.org:443/a/../poll/?x=1#/?theme=$t'),
    ).toBe('https://poll.example.org/poll/');
    expect(policyMatchKey('https://poll.example.org')).toBe(
      'https://poll.example.org/',
    );
    expect(policyMatchKey(new URL('https://poll.example.org/p#h'))).toBe(
      'https://poll.example.org/p',
    );
  });

  it('rejects non-https URLs and credentials', () => {
    expect(policyMatchKey('http://poll.example.org/')).toBeUndefined();
    expect(policyMatchKey('javascript:alert(1)')).toBeUndefined();
    expect(policyMatchKey('https://u:p@poll.example.org/')).toBeUndefined();
    expect(policyMatchKey('not a url')).toBeUndefined();
  });
});

describe('parseEmbeddedWidgetPolicy', () => {
  it('parses the schema of the lifecycle module plus extensions', () => {
    const result = parseEmbeddedWidgetPolicy({
      $comment: 'operator note',
      version: 1,
      unlisted: 'deny',
      widget_permissions: {
        'https://poll.example.org/': {
          name: ' Poll ',
          preload_approved: true,
          identity_approved: false,
          capabilities_approved: [...POLL_CAPABILITIES],
        },
      },
    });
    expect(result).toEqual({
      ok: true,
      warnings: [],
      policy: {
        version: 1,
        unlisted: 'deny',
        rules: [
          {
            pattern: 'https://poll.example.org/',
            prefix: 'https://poll.example.org/',
            glob: false,
            origin: 'https://poll.example.org',
            name: 'Poll',
            preloadApproved: true,
            identityApproved: false,
            capabilitiesApproved: [...POLL_CAPABILITIES],
            matrixRtc: false,
            mediaPermissions: [],
          },
        ],
      },
    });
  });

  it('defaults: unlisted deny, booleans false, no capabilities', () => {
    const policy = valid(ruleFor('https://poll.example.org/*'));
    expect(policy.unlisted).toBe('deny');
    expect(policy.rules[0]).toMatchObject({
      glob: true,
      prefix: 'https://poll.example.org/',
      preloadApproved: false,
      identityApproved: false,
      capabilitiesApproved: [],
      matrixRtc: false,
      mediaPermissions: [],
    });
  });

  it('accepts an empty rule set (nothing can be embedded)', () => {
    expect(valid({ widget_permissions: {} }).rules).toEqual([]);
  });

  it('tolerates unknown fields with a warning', () => {
    const result = parseEmbeddedWidgetPolicy({
      other: 1,
      widget_permissions: {
        'https://poll.example.org/': { preload_aproved: true },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      'unknown field "other"',
      'widget_permissions["https://poll.example.org/"]: unknown field "preload_aproved"',
    ]);
    // The misspelt field has no effect (safe direction).
    expect(result.ok && result.policy.rules[0].preloadApproved).toBe(false);
  });

  it('drops hard-denied capabilities with a warning and dedupes', () => {
    const result = parseEmbeddedWidgetPolicy(
      ruleFor('https://poll.example.org/', {
        capabilities_approved: [
          VOTE,
          VOTE,
          'org.matrix.msc2762.send.state_event:im.vector.modular.widgets',
          'org.matrix.msc2931.navigate',
        ],
      }),
    );
    expect(result.ok && result.policy.rules[0].capabilitiesApproved).toEqual([
      VOTE,
    ]);
    expect(result.warnings).toHaveLength(2);
  });

  describe('fails closed on invalid input', () => {
    it.each([
      ['null', null],
      ['array', []],
      ['string', 'x'],
      ['number', 1],
    ])('%s', (_, input) => {
      expect(errorsOf(input)).toEqual(['policy must be a JSON object']);
    });

    it('missing or wrong widget_permissions', () => {
      expect(errorsOf({})).toEqual(['widget_permissions: must be an object']);
      expect(errorsOf({ widget_permissions: [] })).toEqual([
        'widget_permissions: must be an object',
      ]);
    });

    it('unknown version and unlisted values', () => {
      expect(errorsOf({ version: 2, widget_permissions: {} })).toEqual([
        'version: only 1 is supported',
      ]);
      expect(errorsOf({ unlisted: 'allow', widget_permissions: {} })).toEqual([
        'unlisted: must be "deny" or "consent"',
      ]);
    });

    it.each([
      ['no slash after the host', 'https://poll.example.org*'],
      ['no slash, exact', 'https://poll.example.org'],
      ['upper-case host', 'https://POLL.example.org/'],
      ['default port', 'https://poll.example.org:443/'],
      ['dot segments', 'https://poll.example.org/a/../b'],
      ['wildcard host', 'https://*.example.org/'],
      ['inner star', 'https://poll.example.org/*/x'],
      ['query', 'https://poll.example.org/?a=1'],
      ['fragment glob (module modal rule)', 'https://poll.example.org/p#*'],
      ['http', 'http://poll.example.org/'],
      ['credentials', 'https://u@poll.example.org/'],
      ['not a URL', 'poll'],
      ['too long', `https://poll.example.org/${'a'.repeat(600)}`],
    ])('pattern: %s', (_, pattern) => {
      const errors = errorsOf(ruleFor(pattern));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(`widget_permissions["${pattern}"]`);
    });

    it('suggests the normalised pattern', () => {
      expect(errorsOf(ruleFor('https://poll.example.org*'))[0]).toContain(
        'write "https://poll.example.org/*"',
      );
    });

    it.each([
      ['rule not an object', 'yes'],
      ['preload_approved not boolean', { preload_approved: 'true' }],
      ['identity_approved not boolean', { identity_approved: 1 }],
      ['name empty', { name: ' ' }],
      ['name not a string', { name: 3 }],
      ['capabilities not an array', { capabilities_approved: VOTE }],
      ['capability not a string', { capabilities_approved: [1] }],
      ['capability empty', { capabilities_approved: [''] }],
      ['capability with spaces', { capabilities_approved: [` ${VOTE}`] }],
      [
        'capability glob',
        { capabilities_approved: ['org.matrix.msc2762.receive.event:net.*'] },
      ],
      [
        'state key glob',
        {
          capabilities_approved: [
            'org.matrix.msc2762.receive.state_event:m.room.member#*',
          ],
        },
      ],
      [
        'too many capabilities',
        {
          capabilities_approved: Array.from(
            { length: POLICY_LIMITS.capabilitiesPerRule + 1 },
            (_, i) => `${VOTE}${i}`,
          ),
        },
      ],
    ])('rule: %s', (_, rule) => {
      expect(errorsOf(ruleFor('https://poll.example.org/', rule))).toHaveLength(
        1,
      );
    });

    it('one bad rule invalidates the whole policy', () => {
      expect(
        parseEmbeddedWidgetPolicy({
          widget_permissions: {
            'https://poll.example.org/': { capabilities_approved: [VOTE] },
            'https://other.example.org': {},
          },
        }).ok,
      ).toBe(false);
    });

    it('too many rules', () => {
      const widget_permissions = Object.fromEntries(
        Array.from({ length: POLICY_LIMITS.rules + 1 }, (_, i) => [
          `https://w${i}.example.org/`,
          {},
        ]),
      );
      expect(errorsOf({ widget_permissions })).toEqual([
        'widget_permissions: too many rules',
      ]);
    });

    it('prototype tricks are not plain objects', () => {
      expect(
        errorsOf({ widget_permissions: Object.create({ polluted: true }) }),
      ).toEqual(['widget_permissions: must be an object']);
    });
  });
});

describe('decodeEmbeddedWidgetPolicy', () => {
  const json = JSON.stringify({
    widget_permissions: {
      'https://poll.example.org/': { name: 'Umfrage ✓' },
    },
  });

  it('decodes JSON', () => {
    const result = decodeEmbeddedWidgetPolicy(`  ${json}\n`);
    expect(result.ok && result.policy.rules[0].name).toBe('Umfrage ✓');
  });

  it('decodes base64 UTF-8 JSON', () => {
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
    const result = decodeEmbeddedWidgetPolicy(`base64:${b64}`);
    expect(result.ok && result.policy.rules[0].name).toBe('Umfrage ✓');
  });

  it('fails closed on broken input', () => {
    expect(decodeEmbeddedWidgetPolicy('{').ok).toBe(false);
    expect(decodeEmbeddedWidgetPolicy('<!doctype html><html>').ok).toBe(false);
    expect(decodeEmbeddedWidgetPolicy('base64:!!!').ok).toBe(false);
    // valid base64, invalid UTF-8
    expect(decodeEmbeddedWidgetPolicy('base64:/w==').ok).toBe(false);
    expect(decodeEmbeddedWidgetPolicy('').ok).toBe(false);
  });
});

describe('findPolicyRule (specificity)', () => {
  const policy = valid({
    widget_permissions: {
      'https://poll.example.org/*': { name: 'origin-wide' },
      'https://poll.example.org/': { name: 'exact root' },
      'https://poll.example.org/app/*': { name: 'app' },
      'https://poll.example.org/app/admin/*': { name: 'admin' },
      'https://poll.example.org/app/exact': { name: 'exact app' },
    },
  });
  const name = (url: string) => findPolicyRule(policy, url)?.name;

  it('an exact rule beats every glob (unlike the module)', () => {
    expect(name('https://poll.example.org/')).toBe('exact root');
    expect(name('https://poll.example.org/#/?theme=dark')).toBe('exact root');
    expect(name('https://poll.example.org/app/exact?x')).toBe('exact app');
  });

  it('the longest glob prefix wins', () => {
    expect(name('https://poll.example.org/app/x')).toBe('app');
    expect(name('https://poll.example.org/app/')).toBe('app');
    expect(name('https://poll.example.org/app/admin/x')).toBe('admin');
    expect(name('https://poll.example.org/other')).toBe('origin-wide');
    // prefix semantics like the module: "/app" without slash is not "/app/*"
    expect(name('https://poll.example.org/app')).toBe('origin-wide');
  });

  it('query and fragment cannot change the rule', () => {
    expect(name('https://poll.example.org/?/app/admin/')).toBe('exact root');
    expect(name('https://poll.example.org/#/app/admin/')).toBe('exact root');
  });

  it('normalisation cannot be used to escape a rule', () => {
    expect(name('https://poll.example.org/app/admin/../exact')).toBe(
      'exact app',
    );
    expect(name('https://POLL.EXAMPLE.ORG:443/app/x')).toBe('app');
  });

  it('host boundaries are respected', () => {
    expect(name('https://poll.example.org.attacker.example/')).toBeUndefined();
    expect(name('https://other.example.org/')).toBeUndefined();
    expect(name('https://poll.example.org:8443/')).toBeUndefined();
    expect(name('http://poll.example.org/')).toBeUndefined();
  });

  it('the winning rule is used as a whole (no field merge)', () => {
    const p = valid({
      widget_permissions: {
        'https://poll.example.org/*': {
          preload_approved: true,
          identity_approved: true,
          capabilities_approved: [VOTE, MEMBERS],
        },
        'https://poll.example.org/narrow/*': {
          capabilities_approved: [READ_VOTE],
        },
      },
    });
    expect(
      findPolicyRule(p, 'https://poll.example.org/narrow/x'),
    ).toMatchObject({
      preloadApproved: false,
      identityApproved: false,
      capabilitiesApproved: [READ_VOTE],
    });
  });
});

describe('policyOrigins', () => {
  it('lists each origin once, sorted', () => {
    const policy = valid({
      widget_permissions: {
        'https://poll.example.org/a': {},
        'https://b.example.org/*': {},
        'https://poll.example.org/b/*': {},
      },
    });
    expect(policyOrigins(policy)).toEqual([
      'https://b.example.org',
      'https://poll.example.org',
    ]);
  });
});

describe('decideEmbeddedWidget', () => {
  const policy = valid({
    widget_permissions: {
      'https://poll.example.org/': {
        name: 'Poll',
        preload_approved: true,
        capabilities_approved: [VOTE, READ_VOTE, BOARD_SEND],
      },
      'https://ask.example.org/*': {
        identity_approved: true,
        capabilities_approved: [MEMBERS],
      },
    },
  });
  const denied = ['org.matrix.msc2762.send.event:net.nordeck.whiteboard*'];

  it('pre-approved rule: no local consent, capabilities minus denials', () => {
    expect(
      decideEmbeddedWidget(policy, 'https://poll.example.org/#/x', {
        deniedCapabilities: denied,
      }),
    ).toMatchObject({
      allowed: true,
      consent: 'preapproved',
      name: 'Poll',
      allowedCapabilities: [VOTE, READ_VOTE],
      identityApproved: false,
    });
  });

  it('rule without preload_approved asks locally; identity per rule', () => {
    expect(
      decideEmbeddedWidget(policy, 'https://ask.example.org/w'),
    ).toMatchObject({
      allowed: true,
      consent: 'ask',
      allowedCapabilities: [MEMBERS],
      identityApproved: true,
    });
  });

  it('unlisted URLs are denied by default', () => {
    expect(decideEmbeddedWidget(policy, 'https://poll.example.org/x')).toEqual({
      allowed: false,
      reason: 'unlisted',
    });
    expect(decideEmbeddedWidget(policy, 'https://evil.example.org/')).toEqual({
      allowed: false,
      reason: 'unlisted',
    });
  });

  it('unlisted: consent allows with the host default and local consent', () => {
    const consent = valid({ unlisted: 'consent', widget_permissions: {} });
    expect(decideEmbeddedWidget(consent, 'https://poll.example.org/')).toEqual({
      allowed: true,
      consent: 'ask',
      identityApproved: false,
      matrixRtc: false,
      mediaPermissions: [],
    });
  });

  it('modals: per rule, unset by default, invalid values fail closed', () => {
    const withModals = valid({
      widget_permissions: {
        'https://poll.example.org/': { modals: 'inline' },
        'https://fwd.example.org/': { modals: 'forward' },
        'https://no.example.org/': { modals: 'deny' },
      },
    });
    expect(
      decideEmbeddedWidget(withModals, 'https://poll.example.org/'),
    ).toMatchObject({ allowed: true, modals: 'inline' });
    expect(
      decideEmbeddedWidget(withModals, 'https://fwd.example.org/'),
    ).toMatchObject({ modals: 'forward' });
    expect(
      decideEmbeddedWidget(withModals, 'https://no.example.org/'),
    ).toMatchObject({ modals: 'deny' });
    expect(
      decideEmbeddedWidget(policy, 'https://poll.example.org/'),
    ).not.toHaveProperty('modals');

    const bad = parseEmbeddedWidgetPolicy({
      widget_permissions: { 'https://poll.example.org/': { modals: 'yes' } },
    });
    expect(bad.ok).toBe(false);
  });

  it('invalid URLs are denied', () => {
    expect(decideEmbeddedWidget(policy, 'http://poll.example.org/')).toEqual({
      allowed: false,
      reason: 'invalid-url',
    });
  });
});

describe('policyInitialCapabilities', () => {
  it('is the union of all rules after denials, without duplicates', () => {
    const policy = valid({
      widget_permissions: {
        'https://a.example.org/': { capabilities_approved: [VOTE, BOARD_SEND] },
        'https://b.example.org/': { capabilities_approved: [VOTE, MEMBERS] },
      },
    });
    expect(
      policyInitialCapabilities(policy, {
        deniedCapabilities: [
          'org.matrix.msc2762.send.event:net.nordeck.whiteboard*',
        ],
      }),
    ).toEqual([VOTE, MEMBERS]);
  });

  it('is empty without rules', () => {
    expect(
      policyInitialCapabilities(valid({ widget_permissions: {} })),
    ).toEqual([]);
  });
});

describe('event_namespace', () => {
  const NS = 'net.neoboardception.nested.net.example.board';
  const rule = (extra: Record<string, unknown>) => ({
    version: 1,
    widget_permissions: {
      'https://board.example/': {
        name: 'Board',
        preload_approved: true,
        capabilities_approved: [
          `org.matrix.msc2762.send.state_event:${NS}`,
          `org.matrix.msc2762.receive.state_event:${NS}`,
          `org.matrix.msc3819.send.to_device:${NS}.sig`,
          'org.matrix.msc2762.receive.state_event:m.room.member',
        ],
        ...extra,
      },
    },
  });

  it('keeps the map and the rewritten capabilities (incl. to-device)', () => {
    const r = parseEmbeddedWidgetPolicy(
      rule({ event_namespace: { 'net.example.board': NS } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    const d = decideEmbeddedWidget(r.policy, 'https://board.example/', {
      deniedCapabilities: [
        'org.matrix.msc2762.send.state_event:net.example.board*',
      ],
    });
    expect(d).toMatchObject({
      allowed: true,
      consent: 'preapproved',
      eventNamespace: { 'net.example.board': NS },
    });
    expect(d.allowed && d.allowedCapabilities).toHaveLength(4);
    expect(policyInitialCapabilities(r.policy)).toContain(
      `org.matrix.msc3819.send.to_device:${NS}.sig`,
    );
  });

  it('rejects an invalid map and capabilities in the original form', () => {
    const bad = parseEmbeddedWidgetPolicy(
      rule({ event_namespace: { 'net.example.board': 'net.other' } }),
    );
    expect(bad.ok).toBe(false);
    const original = parseEmbeddedWidgetPolicy({
      widget_permissions: {
        'https://board.example/': {
          event_namespace: { 'net.example.board': NS },
          capabilities_approved: [
            'org.matrix.msc2762.send.state_event:net.example.board',
          ],
        },
      },
    });
    expect(original.ok).toBe(false);
    expect(!original.ok && original.errors[0]).toMatch(/rewritten form/);
  });

  it('warns about reserved-namespace capabilities without a matching map', () => {
    const r = parseEmbeddedWidgetPolicy(rule({}));
    expect(r.ok).toBe(true);
    expect(r.warnings.join('\n')).toMatch(/never requested/);
    // The to-device capability is not hard denied in the rewritten form.
    expect(r.ok && r.policy.rules[0].capabilitiesApproved).toContain(
      `org.matrix.msc3819.send.to_device:${NS}.sig`,
    );
  });
});
