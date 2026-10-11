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

import {
  parseEmbeddedWidgetPolicy,
  POLL_CAPABILITIES,
} from '@nordeck/matrix-widget-mediation';
import { EventDirection, WidgetEventCapability } from 'matrix-widget-api';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadEmbeddedWidgetConfig, withInitialCapabilities } from './config';

const POLL = 'https://poll.example.org';
const OTHER = 'https://other.example.org';
const VOTE = 'org.matrix.msc2762.send.event:net.nordeck.poll.vote';
const READ_VOTE = 'org.matrix.msc2762.receive.event:net.nordeck.poll.vote';
const MEMBERS = 'org.matrix.msc2762.receive.state_event:m.room.member';
const BOARD = 'org.matrix.msc2762.send.event:net.nordeck.whiteboard.document';

const policy = {
  version: 1,
  widget_permissions: {
    [`${POLL}/`]: {
      name: 'Poll',
      preload_approved: true,
      capabilities_approved: [VOTE, READ_VOTE, BOARD],
    },
    [`${OTHER}/apps/*`]: {
      identity_approved: true,
      capabilities_approved: [MEMBERS],
    },
  },
};

function load(env: Record<string, string>) {
  return loadEmbeddedWidgetConfig((name) => env[name] ?? '');
}

const url = (u: string) => new URL(u);

describe('loadEmbeddedWidgetConfig', () => {
  it('is off when nothing is configured', () => {
    const config = load({});
    expect(config).toMatchObject({
      source: 'none',
      allowedOrigins: [],
      initialCapabilities: [],
      errors: [],
    });
    expect(config.isUrlAllowed(url(`${POLL}/`))).toBe(false);
  });

  describe("the board's own origin", () => {
    const BOARD_ORIGIN = 'https://board.example.org';

    it('is dropped from the origin list with a warning', () => {
      const config = loadEmbeddedWidgetConfig(
        (name) =>
          ({
            REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS: `${POLL},${BOARD_ORIGIN}`,
          })[name] ?? '',
        { hostOrigin: `${BOARD_ORIGIN}/index.html` },
      );
      expect(config.allowedOrigins).toEqual([POLL]);
      expect(config.isUrlAllowed(url(`${BOARD_ORIGIN}/poll/`))).toBe(false);
      expect(
        config.resolveMountPolicy(`${BOARD_ORIGIN}/poll/`),
      ).toBeUndefined();
      expect(config.warnings).toEqual([
        expect.stringContaining(
          `${BOARD_ORIGIN} is the board's own origin; widgets cannot be embedded from it; ignored`,
        ),
      ]);
    });

    it('is dropped from the policy with a warning', () => {
      const config = loadEmbeddedWidgetConfig(
        (name) =>
          ({
            REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify({
              version: 1,
              widget_permissions: {
                [`${POLL}/`]: { capabilities_approved: [VOTE] },
                [`${BOARD_ORIGIN}/*`]: { capabilities_approved: [VOTE] },
              },
            }),
          })[name] ?? '',
        { hostOrigin: BOARD_ORIGIN },
      );
      expect(config.source).toBe('policy');
      expect(config.allowedOrigins).toEqual([POLL]);
      expect(config.isUrlAllowed(url(`${BOARD_ORIGIN}/x`))).toBe(false);
      expect(config.warnings).toEqual([
        expect.stringContaining(
          `REACT_APP_EMBEDDED_WIDGET_POLICY: ${BOARD_ORIGIN} is the board's own origin`,
        ),
      ]);
    });
  });

  describe('without a policy (compatibility)', () => {
    const config = load({
      REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS: `${POLL}, http://x.example.org,${POLL}`,
      REACT_APP_EMBEDDED_WIDGET_MODAL_ORIGINS: `${POLL},${OTHER}`,
    });

    it('allows the listed https origins with consent and defaults', () => {
      expect(config.source).toBe('origins');
      expect(config.allowedOrigins).toEqual([POLL]);
      expect(config.modalOrigins).toEqual([POLL]);
      expect(config.isUrlAllowed(url(`${POLL}/any/path?x#y`))).toBe(true);
      expect(config.isUrlAllowed(url(`${OTHER}/`))).toBe(false);
      expect(config.resolveMountPolicy(`${POLL}/`)).toEqual({
        preapproved: false,
        identityApproved: false,
      });
      expect(config.warnings).toEqual([
        'REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS: "http://x.example.org" is not an https origin; ignored',
      ]);
    });

    it('ignores the initial union without a policy', () => {
      const c = load({
        REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS: POLL,
        REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION: 'true',
      });
      expect(c.initialCapabilities).toEqual([]);
      expect(c.maxCapabilityRequests).toBeUndefined();
      expect(c.warnings[0]).toContain('needs REACT_APP_EMBEDDED_WIDGET_POLICY');
    });
  });

  describe('with a policy', () => {
    it('derives the origins and per-widget settings from the policy', () => {
      const config = load({
        REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify(policy),
      });
      expect(config.source).toBe('policy');
      expect(config.allowedOrigins).toEqual([OTHER, POLL]);
      expect(config.resolveMountPolicy(`${POLL}/#/?theme=$theme`)).toEqual({
        allowedCapabilities: [VOTE, READ_VOTE],
        preapproved: true,
        identityApproved: false,
        name: 'Poll',
      });
      expect(config.resolveMountPolicy(`${OTHER}/apps/x`)).toEqual({
        allowedCapabilities: [MEMBERS],
        preapproved: false,
        identityApproved: true,
        name: undefined,
      });
    });

    it('passes the modal mode of a rule on', () => {
      const config = load({
        REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify({
          widget_permissions: {
            [`${POLL}/`]: {
              ...policy.widget_permissions[`${POLL}/`],
              modals: 'inline',
            },
          },
        }),
      });
      expect(config.resolveMountPolicy(`${POLL}/`)?.modals).toBe('inline');
      expect(
        load({
          REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify(policy),
        }).resolveMountPolicy(`${POLL}/`),
      ).not.toHaveProperty('modals');
    });

    it('denies unlisted URLs, also on listed origins', () => {
      const config = load({
        REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify(policy),
      });
      expect(config.isUrlAllowed(url(`${POLL}/other`))).toBe(false);
      expect(config.isUrlAllowed(url(`${OTHER}/`))).toBe(false);
      expect(config.isUrlAllowed(url('https://evil.example.org/'))).toBe(false);
      expect(config.resolveMountPolicy(`${POLL}/other`)).toBeUndefined();
    });

    it('accepts base64 (for container environments)', () => {
      const config = load({
        REACT_APP_EMBEDDED_WIDGET_POLICY: `base64:${btoa(JSON.stringify(policy))}`,
      });
      expect(config.source).toBe('policy');
      expect(config.isUrlAllowed(url(`${POLL}/`))).toBe(true);
    });

    it('uses the origin list as an upper bound', () => {
      const config = load({
        REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify(policy),
        REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS: POLL,
        REACT_APP_EMBEDDED_WIDGET_MODAL_ORIGINS: `${POLL},${OTHER}`,
      });
      expect(config.allowedOrigins).toEqual([POLL]);
      expect(config.modalOrigins).toEqual([POLL]);
      expect(config.isUrlAllowed(url(`${OTHER}/apps/x`))).toBe(false);
      expect(config.warnings).toEqual([
        `${OTHER} is in the policy but not in REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS; not allowed`,
      ]);
    });

    it('unlisted: consent allows other URLs of allowed origins with consent', () => {
      const config = load({
        REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify({
          ...policy,
          unlisted: 'consent',
        }),
        REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS: `${POLL},https://third.example.org`,
      });
      expect(config.allowedOrigins).toEqual([
        POLL,
        'https://third.example.org',
      ]);
      expect(config.resolveMountPolicy(`${POLL}/other`)).toEqual({
        allowedCapabilities: undefined,
        preapproved: false,
        identityApproved: false,
        name: undefined,
      });
      expect(
        config.resolveMountPolicy('https://third.example.org/w'),
      ).toMatchObject({ preapproved: false });
      expect(
        config.resolveMountPolicy('https://evil.example.org/'),
      ).toBeUndefined();
    });

    it.each([
      ['broken JSON', '{"widget_permissions":'],
      ['an HTML page', '<!doctype html>'],
      ['a schema error', JSON.stringify({ widget_permissions: [] })],
      [
        'a bad pattern',
        JSON.stringify({
          widget_permissions: { 'https://poll.example.org': {} },
        }),
      ],
      [
        'a capability glob',
        JSON.stringify({
          widget_permissions: {
            [`${POLL}/`]: { capabilities_approved: ['net.*'] },
          },
        }),
      ],
    ])('fails closed on %s, even with an origin list', (_, value) => {
      const config = load({
        REACT_APP_EMBEDDED_WIDGET_POLICY: value,
        REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS: POLL,
        REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION: 'true',
      });
      expect(config.source).toBe('invalid');
      expect(config.allowedOrigins).toEqual([]);
      expect(config.isUrlAllowed(url(`${POLL}/`))).toBe(false);
      expect(config.resolveMountPolicy(`${POLL}/`)).toBeUndefined();
      expect(config.initialCapabilities).toEqual([]);
      expect(config.errors.at(-1)).toBe(
        'Embedded widgets are disabled because the policy is invalid',
      );
    });
  });

  describe('initial union', () => {
    it('is off by default', () => {
      const config = load({
        REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify(policy),
      });
      expect(config.initialCapabilities).toEqual([]);
      expect(config.maxCapabilityRequests).toBeUndefined();
    });

    it('adds the capabilities of all allowed rules, without board-own ones', () => {
      const config = load({
        REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify(policy),
        REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION: 'TRUE',
      });
      expect(config.initialCapabilities).toEqual([VOTE, READ_VOTE, MEMBERS]);
      expect(config.maxCapabilityRequests).toBe(0);
    });

    it('leaves out rules of origins outside the origin list', () => {
      const config = load({
        REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify(policy),
        REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS: POLL,
        REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION: 'true',
      });
      expect(config.initialCapabilities).toEqual([VOTE, READ_VOTE]);
    });

    it('warns about values other than true/false', () => {
      const config = load({
        REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify(policy),
        REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION: 'yes',
      });
      expect(config.initialCapabilities).toEqual([]);
      expect(config.warnings).toEqual([
        'REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION: expected "true" or "false", got "yes"',
      ]);
    });

    it('never contains hard-denied capabilities', () => {
      const config = load({
        REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify({
          widget_permissions: {
            [`${POLL}/`]: {
              capabilities_approved: [
                ...POLL_CAPABILITIES,
                'org.matrix.msc2762.send.state_event:m.room.power_levels',
                'org.matrix.msc4157.send.delayed_event',
              ],
            },
          },
        }),
        REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION: 'true',
      });
      expect(config.initialCapabilities).toEqual([...POLL_CAPABILITIES]);
      expect(config.warnings).toHaveLength(2);
    });
  });
});

describe('REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES', () => {
  const MESSAGE = 'org.matrix.msc2762.receive.event:m.room.message#m.text';
  const TOPIC = 'org.matrix.msc2762.receive.state_event:m.room.topic';
  const RTC =
    'org.matrix.msc2762.send.state_event:org.matrix.msc3401.call.member';
  const capPolicy = {
    version: 1,
    unlisted: 'consent',
    widget_permissions: {
      [`${POLL}/`]: { capabilities_approved: [VOTE, MESSAGE, TOPIC] },
    },
  };

  it('without a policy: Poll defaults plus the listed capabilities for every widget', () => {
    const config = load({
      REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS: POLL,
      REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES: `${MESSAGE}, ${VOTE},${MESSAGE}`,
    });
    const expected = [...POLL_CAPABILITIES, MESSAGE];
    expect(config.capabilityAllowList).toEqual(expected);
    expect(config.resolveMountPolicy(`${POLL}/`)).toEqual({
      allowedCapabilities: expected,
      preapproved: false,
      identityApproved: false,
    });
    expect(config.warnings).toEqual([]);
  });

  it('drops globs and hard-denied entries with a warning', () => {
    const config = load({
      REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS: POLL,
      REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES: `${RTC},org.matrix.msc2762.receive.event:*,${MESSAGE}`,
    });
    expect(config.capabilityAllowList).toEqual([...POLL_CAPABILITIES, MESSAGE]);
    expect(config.warnings).toHaveLength(2);
    expect(config.warnings.join('\n')).toContain('hard deny-list');
    expect(config.warnings.join('\n')).toContain('globs are not allowed');
  });

  it('with a policy: caps the rule capabilities and warns about dropped ones', () => {
    const config = load({
      REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify(capPolicy),
      REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES: MESSAGE,
      REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION: 'true',
    });
    expect(config.resolveMountPolicy(`${POLL}/`)?.allowedCapabilities).toEqual([
      VOTE,
      MESSAGE,
    ]);
    expect(config.initialCapabilities).toEqual([VOTE, MESSAGE]);
    expect(config.warnings).toEqual([
      `"${TOPIC}" is in the policy but neither a Poll default nor in REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES; not granted`,
    ]);
  });

  it('with a policy: never adds capabilities, also not to unlisted widgets', () => {
    const config = load({
      REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify({
        ...capPolicy,
        widget_permissions: {
          [`${POLL}/`]: { capabilities_approved: [VOTE] },
        },
      }),
      REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES: MESSAGE,
    });
    expect(config.resolveMountPolicy(`${POLL}/`)?.allowedCapabilities).toEqual([
      VOTE,
    ]);
    // Unlisted (consent mode): the mediation default, not widened.
    expect(
      config.resolveMountPolicy(`${POLL}/other`)?.allowedCapabilities,
    ).toBeUndefined();
  });

  it('with a policy and without the variable: the policy alone decides', () => {
    const config = load({
      REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify(capPolicy),
    });
    expect(config.capabilityAllowList).toBeUndefined();
    expect(config.resolveMountPolicy(`${POLL}/`)?.allowedCapabilities).toEqual([
      VOTE,
      MESSAGE,
      TOPIC,
    ]);
  });
});

describe('REACT_APP_EMBEDDED_WIDGET_MAX_LIVE', () => {
  it.each([
    ['', undefined, 0],
    ['1', 1, 0],
    [' 20 ', 20, 0],
    ['0', undefined, 1],
    ['21', undefined, 1],
    ['2.5', undefined, 1],
    ['many', undefined, 1],
  ])('"%s" → %s', (value, expected, warnings) => {
    const config = load({ REACT_APP_EMBEDDED_WIDGET_MAX_LIVE: value });
    expect(config.maxLiveWidgets).toBe(expected);
    expect(config.warnings).toHaveLength(warnings);
  });

  it('is independent of the policy', () => {
    const config = load({
      REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify(policy),
      REACT_APP_EMBEDDED_WIDGET_MAX_LIVE: '5',
    });
    expect(config.maxLiveWidgets).toBe(5);
  });
});

describe('withInitialCapabilities', () => {
  it('appends missing capabilities and keeps the own ones first', () => {
    const own = [
      WidgetEventCapability.forRoomEvent(
        EventDirection.Send,
        'net.nordeck.poll.vote',
      ),
      'io.element.requires_client',
    ];
    expect(
      withInitialCapabilities(own, [
        VOTE,
        'io.element.requires_client',
        MEMBERS,
      ]),
    ).toEqual([...own, MEMBERS]);
  });
});

describe('generated examples', () => {
  const examples = join(__dirname, '../../../neoboardception-docs/examples');
  const read = (name: string) => readFileSync(join(examples, name), 'utf8');

  it('the example policy file is valid', () => {
    const result = parseEmbeddedWidgetPolicy(
      JSON.parse(read('embedded-widgets.policy.json')),
    );
    expect(result).toMatchObject({ ok: true, warnings: [] });
  });

  it('the example environment configures the same policy', () => {
    const env = Object.fromEntries(
      read('neoboard.env.example')
        .split('\n')
        .filter((line) => /^REACT_APP_[A-Z_]+=/.test(line))
        .map((line) => [
          line.slice(0, line.indexOf('=')),
          line.slice(line.indexOf('=') + 1),
        ]),
    );
    const config = load(env);
    expect(config).toMatchObject({
      source: 'policy',
      errors: [],
      warnings: [],
    });
    expect(config.allowedOrigins).toEqual([POLL]);
    expect(config.resolveMountPolicy(`${POLL}/`)).toMatchObject({
      allowedCapabilities: [...POLL_CAPABILITIES],
      identityApproved: false,
      name: 'Poll',
    });
  });
});

describe('MatrixRTC calls (policy opt-in)', () => {
  const CALL = 'https://call.example.org';
  const callPolicy = {
    widget_permissions: {
      [`${POLL}/`]: { capabilities_approved: [VOTE] },
      [`${CALL}/room`]: {
        name: 'Call',
        identity_approved: true,
        matrixrtc: true,
        media_permissions: ['camera', 'microphone', 'autoplay'],
      },
    },
  };
  const ctx = {
    userId: '@user:example.org',
    deviceId: 'DEV',
    roomId: '!room:example.org',
  };
  const OWN_MEMBER = `org.matrix.msc2762.send.state_event:org.matrix.msc3401.call.member#_@user:example.org_DEV_m.call`;

  it('passes the opt-in and the media features to the renderer', () => {
    const config = load({
      REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify(callPolicy),
    });
    expect(config.errors).toEqual([]);
    expect(config.resolveMountPolicy(`${CALL}/room#?a=b`)).toMatchObject({
      matrixRtc: true,
      mediaPermissions: ['camera', 'microphone', 'autoplay'],
      identityApproved: true,
    });
    const poll = config.resolveMountPolicy(`${POLL}/`);
    expect(poll?.matrixRtc).toBeUndefined();
    expect(poll?.mediaPermissions).toBeUndefined();
  });

  it('does not grow the initial request of normal boards', () => {
    const config = load({
      REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify(callPolicy),
    });
    expect(config.initialCapabilities).toEqual([]);
    expect(config.initialCapabilitiesFor(ctx)).toEqual([]);
  });

  it('adds the call capabilities of the own device to the initial union', () => {
    const config = load({
      REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify(callPolicy),
      REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION: 'true',
      REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES: VOTE,
    });
    expect(config.initialCapabilities).toEqual([VOTE]);
    const union = config.initialCapabilitiesFor(ctx);
    expect(union[0]).toBe(VOTE);
    expect(union).toContain(OWN_MEMBER);
    expect(union.some((c) => c.includes('timeline:'))).toBe(false);
  });

  it('fails closed on unknown media features', () => {
    const config = load({
      REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify({
        widget_permissions: {
          [`${CALL}/room`]: { media_permissions: ['usb'] },
        },
      }),
    });
    expect(config.source).toBe('invalid');
    expect(config.allowedOrigins).toEqual([]);
  });
});

describe('event namespace in the policy', () => {
  const NS = 'net.neoboardception.nested.net.nordeck.whiteboard';
  const BOARD_URL = 'https://board.example.org';
  const nestedPolicy = {
    version: 1,
    widget_permissions: {
      [`${BOARD_URL}/`]: {
        name: 'NeoBoard',
        preload_approved: true,
        event_namespace: { 'net.nordeck.whiteboard': NS },
        capabilities_approved: [
          `org.matrix.msc2762.send.state_event:${NS}`,
          `org.matrix.msc3819.send.to_device:${NS}.connection_signaling`,
          // the original namespace is an error with a namespace, so only
          // the board's own deny-list is tested via the rewritten strings
        ],
      },
    },
  };

  it('hands the namespace and the rewritten capabilities to the renderer', () => {
    const config = load({
      REACT_APP_EMBEDDED_WIDGET_POLICY: JSON.stringify(nestedPolicy),
    });
    expect(config.errors).toEqual([]);
    expect(config.resolveMountPolicy(`${BOARD_URL}/`)).toEqual({
      allowedCapabilities: [
        `org.matrix.msc2762.send.state_event:${NS}`,
        `org.matrix.msc3819.send.to_device:${NS}.connection_signaling`,
      ],
      preapproved: true,
      identityApproved: false,
      name: 'NeoBoard',
      eventNamespace: { 'net.nordeck.whiteboard': NS },
    });
  });
});

describe('getEmbeddedWidgetConfig in an embedded board', () => {
  async function configAt(search: string) {
    const original = window.location.href;
    window.history.replaceState({}, '', search);
    try {
      vi.resetModules();
      vi.doMock('@matrix-widget-toolkit/mui', async () => ({
        ...(await vi.importActual<object>('@matrix-widget-toolkit/mui')),
        getEnvironment: (name: string, fallback?: string) =>
          name === 'REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS'
            ? 'https://poll.example.org'
            : fallback,
      }));
      const { getEmbeddedWidgetConfig } = await import('./config');
      return getEmbeddedWidgetConfig();
    } finally {
      vi.doUnmock('@matrix-widget-toolkit/mui');
      window.history.replaceState({}, '', original);
    }
  }

  it('is off whatever the deployment configures (nesting depth 1)', async () => {
    expect((await configAt('/?widgetId=board-1')).source).toBe('origins');
    const config = await configAt('/?widgetId=embedded-element-1');
    expect(config.source).toBe('none');
    expect(config.allowedOrigins).toEqual([]);
    expect(config.initialCapabilities).toEqual([]);
  });
});
