import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIST_CLOUD_STATUS_PROVIDER_ORDER } from '@shared/ipc';
import {
  MIST_COMPONENTS_URL,
  MIST_NOTICES_URL,
  MIST_STATUS_URL,
  fetchMistProviderGroup,
  mistNoticeStateToSeverity,
} from './mistProvider';

type TestComponent = {
  id: number;
  name: string;
  state: string;
  updated_at: string;
};

type TestUpdate = {
  state: string;
  content: string;
  created_at: string;
};

type TestNotice = {
  id: number;
  type: string;
  state: string;
  timeline_state: string;
  subject: string;
  url: string;
  began_at: string;
  latest_update: TestUpdate | null;
};

type TestNoticeDetail = TestNotice & {
  components: TestComponent[];
  updates: TestUpdate[];
};

function component(id: number, name: string, state: string): TestComponent {
  return { id, name, state, updated_at: '2026-08-03T10:00:00.000Z' };
}

function update(state: string, content: string, created_at: string): TestUpdate {
  return { state, content, created_at };
}

function notice(overrides: Partial<TestNotice> = {}): TestNotice {
  return {
    id: 42,
    type: 'unplanned',
    state: 'investigating',
    timeline_state: 'present',
    subject: 'Mist incident',
    url: 'https://status.mist.com/notices/test-incident',
    began_at: '2026-08-03T10:00:00.000Z',
    latest_update: null,
    ...overrides,
  };
}

function detail(overrides: Partial<TestNoticeDetail> = {}): TestNoticeDetail {
  return {
    ...notice(),
    components: [],
    updates: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mockMistApi(input: {
  notices?: TestNotice[];
  components?: TestComponent[];
  details?: Record<number, TestNoticeDetail>;
  componentFailure?: Error;
  detailFailures?: number[];
}) {
  const fetchMock = vi.fn(async (value: string | URL) => {
    const url = String(value);
    if (url === MIST_NOTICES_URL) return jsonResponse({ notices: input.notices ?? [] });
    if (url === MIST_COMPONENTS_URL) {
      if (input.componentFailure) throw input.componentFailure;
      return jsonResponse({ components: input.components ?? [] });
    }
    const id = Number(url.split('/').at(-1));
    if (input.detailFailures?.includes(id)) throw new Error(`Detail ${id} failed`);
    return jsonResponse({ notice: input.details?.[id] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Mist SorryApp provider', () => {
  it.each([
    ['investigating', 'error'],
    ['identified', 'error'],
    ['recovering', 'warning'],
    ['resolved', null],
    ['false_alarm', null],
    ['unknown', null],
  ] as const)('maps notice state %s to %s', (state, expected) => {
    expect(mistNoticeStateToSeverity(state)).toBe(expected);
  });

  it('routes one active notice to every affected Mist region using the newest update', async () => {
    mockMistApi({
      notices: [notice()],
      components: [component(24585, 'MIST GLOBAL CLOUD', 'degraded')],
      details: {
        42: detail({
          components: [
            component(24585, 'MIST GLOBAL CLOUD', 'degraded'),
            component(84051, 'MIST APAC CLOUD', 'degraded'),
          ],
          updates: [
            update('investigating', 'Initial update', '2026-08-03T10:00:00.000Z'),
            update('identified', 'Latest update', '2026-08-03T10:05:00.000Z'),
          ],
        }),
      },
    });

    const result = await fetchMistProviderGroup(() => Date.parse('2026-08-03T10:06:00.000Z'));

    expect(result.providers.mist_global).toEqual([
      expect.objectContaining({
        id: '42',
        provider: 'mist_global',
        description: 'Latest update',
        pubDate: '2026-08-03T10:05:00.000Z',
        severity: 'error',
      }),
    ]);
    expect(result.providers.mist_apac).toEqual([
      expect.objectContaining({ id: '42', provider: 'mist_apac' }),
    ]);
    expect(result.providers.mist_emea).toEqual([]);
  });

  it('assigns an unscoped incident to all four regions', async () => {
    mockMistApi({
      notices: [notice({ id: 43 })],
      details: { 43: detail({ id: 43, components: [] }) },
    });

    const result = await fetchMistProviderGroup();

    for (const provider of MIST_CLOUD_STATUS_PROVIDER_ORDER) {
      expect(result.providers[provider]).toEqual([
        expect.objectContaining({ id: '43', provider, severity: 'error' }),
      ]);
    }
  });

  it('maps an active recovering incident to a degradation', async () => {
    mockMistApi({
      notices: [notice({ state: 'recovering' })],
      details: {
        42: detail({
          state: 'recovering',
          components: [component(24592, 'MIST EMEA CLOUD', 'degraded')],
        }),
      },
    });

    const result = await fetchMistProviderGroup();

    expect(result.providers.mist_emea[0]).toMatchObject({ severity: 'warning' });
  });

  it('creates one stable warning for an unexplained degraded component', async () => {
    mockMistApi({
      components: [component(24592, 'MIST EMEA CLOUD', 'degraded')],
    });

    const result = await fetchMistProviderGroup(() => Date.parse('2026-08-03T10:06:00.000Z'));

    expect(result.providers.mist_emea).toEqual([
      expect.objectContaining({
        id: 'mist-component-24592',
        provider: 'mist_emea',
        severity: 'warning',
        pubDate: '2026-08-03T10:06:00.000Z',
      }),
    ]);
  });

  it('does not duplicate a component warning when an incident already covers the region', async () => {
    mockMistApi({
      notices: [notice()],
      components: [component(24585, 'MIST GLOBAL CLOUD', 'degraded')],
      details: {
        42: detail({ components: [component(24585, 'MIST GLOBAL CLOUD', 'degraded')] }),
      },
    });

    const result = await fetchMistProviderGroup();

    expect(result.providers.mist_global).toHaveLength(1);
    expect(result.providers.mist_global[0]?.id).toBe('42');
  });

  it('ignores planned, resolved, false-alarm, operational, and maintenance records', async () => {
    mockMistApi({
      notices: [
        notice({ id: 1, type: 'planned' }),
        notice({ id: 2, state: 'resolved' }),
        notice({ id: 3, state: 'false_alarm' }),
      ],
      components: [
        component(24585, 'MIST GLOBAL CLOUD', 'operational'),
        component(24592, 'MIST EMEA CLOUD', 'under_maintenance'),
      ],
    });

    const result = await fetchMistProviderGroup();

    expect(Object.values(result.providers).flat()).toEqual([]);
  });

  it('keeps routed incidents and reports every region when component coverage fails', async () => {
    mockMistApi({
      notices: [notice()],
      componentFailure: new Error('components offline'),
      details: {
        42: detail({ components: [component(84052, 'MIST FEDERAL CLOUD', 'degraded')] }),
      },
    });

    const result = await fetchMistProviderGroup();

    expect(result.providers.mist_federal).toHaveLength(1);
    expect(result.errors.map(({ provider }) => provider)).toEqual([
      'mist_global',
      'mist_emea',
      'mist_apac',
      'mist_federal',
    ]);
  });

  it('assigns a summary notice to all regions when its detail request fails', async () => {
    mockMistApi({
      notices: [
        notice({
          latest_update: update('investigating', 'Summary update', '2026-08-03T10:03:00.000Z'),
        }),
      ],
      detailFailures: [42],
    });

    const result = await fetchMistProviderGroup();

    for (const provider of MIST_CLOUD_STATUS_PROVIDER_ORDER) {
      expect(result.providers[provider][0]).toMatchObject({
        id: '42',
        provider,
        description: 'Summary update',
        pubDate: '2026-08-03T10:03:00.000Z',
      });
    }
  });

  it('falls back to the official page for an untrusted notice URL', async () => {
    mockMistApi({
      notices: [notice({ url: 'https://status.mist.com.evil.example/notices/42' })],
      details: {
        42: detail({
          url: 'https://status.mist.com.evil.example/notices/42',
          components: [component(24585, 'MIST GLOBAL CLOUD', 'degraded')],
        }),
      },
    });

    const result = await fetchMistProviderGroup();

    expect(result.providers.mist_global[0]?.link).toBe(MIST_STATUS_URL);
  });

  it('uses no-store requests for the public endpoints', async () => {
    const fetchMock = mockMistApi({});

    await fetchMistProviderGroup();

    expect(fetchMock).toHaveBeenCalledWith(
      MIST_NOTICES_URL,
      expect.objectContaining({ cache: 'no-store', headers: { Accept: 'application/json' } }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      MIST_COMPONENTS_URL,
      expect.objectContaining({ cache: 'no-store', headers: { Accept: 'application/json' } }),
    );
  });

  it('rejects a structurally invalid notices response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (value: string | URL) =>
        String(value) === MIST_NOTICES_URL
          ? jsonResponse({ notices: {} })
          : jsonResponse({ components: [] }),
      ),
    );

    await expect(fetchMistProviderGroup()).rejects.toThrow('Invalid Mist notices response');
  });
});
