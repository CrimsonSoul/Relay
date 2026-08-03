import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { RadarSnapshot } from './ipc';
import { WEB_RUNTIME } from './runtime';
import * as webApi from './webApi';
import {
  WebBrandAssetInputSchema,
  WebCloudStatusDataSchema,
  WebDynatraceDashboardInputSchema,
  WebDynatraceProblemsSettingsInputSchema,
  WebSessionBootstrapResultSchema,
  WebSessionLoginInputSchema,
} from './webApi';

const PB_URL = ['http', '://', 'relay-server', ':8090'].join('');
const LAN_ADDRESS = ['192', '168', '1', '25'].join('.');

describe('Relay Web session contracts', () => {
  it('preserves passphrase bytes and rejects unknown login fields', () => {
    const passphrase = '  exact passphrase bytes  ';

    expect(WebSessionLoginInputSchema.parse({ passphrase })).toEqual({ passphrase });
    expect(() => WebSessionLoginInputSchema.parse({ passphrase, remember: true })).toThrow();
  });

  it('normalizes only a complete authenticated bootstrap response', () => {
    const result = {
      ok: true as const,
      session: {
        csrfToken: 'c'.repeat(32),
        pbUrl: PB_URL,
        auth: { token: 'app-user-token', record: null },
        publicConfig: {
          mode: 'server' as const,
          port: 8090,
          bindHost: '0.0.0.0' as const,
          lanIp: LAN_ADDRESS,
        },
        runtime: WEB_RUNTIME,
      },
    };

    expect(WebSessionBootstrapResultSchema.parse(result)).toEqual(result);
    expect(() =>
      WebSessionBootstrapResultSchema.parse({
        ...result,
        session: { ...result.session, csrfToken: 'short' },
      }),
    ).toThrow();
  });

  it('accepts only bounded public bootstrap failures', () => {
    expect(WebSessionBootstrapResultSchema.parse({ ok: false, error: 'unauthenticated' })).toEqual({
      ok: false,
      error: 'unauthenticated',
    });
    expect(() =>
      WebSessionBootstrapResultSchema.parse({
        ok: false,
        error: 'database-password-was-wrong',
      }),
    ).toThrow();
  });
});

describe('Relay Web API operational schemas', () => {
  it('accepts only complete bounded Radar snapshots', () => {
    const schema = (webApi as unknown as { WebRadarSnapshotSchema?: z.ZodType<RadarSnapshot> })
      .WebRadarSnapshotSchema;
    expect(schema).toBeDefined();
    if (!schema) return;

    const snapshot: RadarSnapshot = {
      color: 'green',
      dispatchers: [
        {
          name: 'Prod01',
          tone: 'yellow',
          lastScheduleDate: '2026-07-31 10:00',
          lastPubSubDate: '2026-07-31 10:01',
          queues: [{ name: 'Work', depth: 4 }],
        },
      ],
      papa: [{ name: 'Messages', depth: 2 }],
      metrics: [{ label: 'Transactional Emails Queue Depth', value: '7', tone: 'red' }],
      xcenter: { ok: 977, pending: 3 },
      currentTime: '10:02',
      lastUpdated: 1_785_515_320_000,
      signInRequired: false,
      error: null,
    };

    expect(schema.safeParse(snapshot).success).toBe(true);
    expect(schema.safeParse({ ...snapshot, color: 'blue' }).success).toBe(false);
    expect(
      schema.safeParse({
        ...snapshot,
        dispatchers: [{ ...snapshot.dispatchers[0], queues: [{ name: 'Work', depth: -1 }] }],
      }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...snapshot, error: undefined }).success).toBe(false);
    expect(schema.safeParse({ ...snapshot, cookie: 'must-not-cross' }).success).toBe(false);
  });

  it('accepts the complete cloud status provider map and rejects incomplete or unknown maps', () => {
    const providers = Object.fromEntries(
      [
        'aws',
        'azure',
        'm365',
        'jira',
        'github',
        'cloudflare',
        'mist_global',
        'mist_emea',
        'mist_apac',
        'mist_federal',
        'google',
        'anthropic',
        'openai',
        'salesforce',
      ].map((provider) => [provider, []]),
    );
    expect(
      WebCloudStatusDataSchema.safeParse({ providers, lastUpdated: 1, errors: [] }).success,
    ).toBe(true);
    expect(
      WebCloudStatusDataSchema.safeParse({ providers: {}, lastUpdated: 1, errors: [] }).success,
    ).toBe(false);
    const withoutMistGlobal = Object.fromEntries(
      Object.entries(providers).filter(([provider]) => provider !== 'mist_global'),
    );
    expect(
      WebCloudStatusDataSchema.safeParse({
        providers: withoutMistGlobal,
        lastUpdated: 1,
        errors: [],
      }).success,
    ).toBe(false);
    expect(
      WebCloudStatusDataSchema.safeParse({
        providers: { ...providers, unknown: [] },
        lastUpdated: 1,
        errors: [],
      }).success,
    ).toBe(false);

    expect(
      WebCloudStatusDataSchema.safeParse({
        providers: {
          ...providers,
          mist_global: [
            {
              id: 'misrouted',
              provider: 'aws',
              title: 'Wrong bucket',
              description: '',
              pubDate: '2026-08-03T10:00:00.000Z',
              link: 'https://status.mist.com/',
              severity: 'error',
            },
          ],
        },
        lastUpdated: 1,
        errors: [],
      }).success,
    ).toBe(false);
  });

  it('keeps dashboard, Problems, and asset inputs exact and bounded', () => {
    expect(
      WebDynatraceDashboardInputSchema.safeParse({
        name: 'NOC',
        url: 'https://abc.live.dynatrace.com/ui/dashboard',
      }).success,
    ).toBe(true);
    expect(
      WebDynatraceDashboardInputSchema.safeParse({
        name: 'NOC',
        url: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
    expect(
      WebDynatraceProblemsSettingsInputSchema.safeParse({
        environmentUrl: 'https://abc.apps.dynatrace.com',
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      WebBrandAssetInputSchema.safeParse({ dataUrl: 'data:text/html;base64,PGgxPg==' }).success,
    ).toBe(false);
  });
});
