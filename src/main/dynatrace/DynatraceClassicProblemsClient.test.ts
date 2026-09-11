import { describe, expect, it, vi } from 'vitest';
import { DynatraceClassicProblemsClient } from './DynatraceClassicProblemsClient';
import { readDynatracePlatform } from './DynatracePlatformRead';

const config = {
  environmentUrl: 'https://test.apps.dynatrace.com',
  apiToken: 'secret',
  alertingProfiles: null,
  customDqlMatcher: null,
};
const entity = { entityId: { id: 'HOST-1', type: 'HOST' }, name: 'Router' };
function problem(problemId = 'problem-1', status: 'OPEN' | 'CLOSED' = 'OPEN') {
  return {
    problemId,
    displayId: 'P-1',
    title: 'Unavailable',
    status,
    severityLevel: 'AVAILABILITY',
    impactLevel: 'INFRASTRUCTURE',
    startTime: 1600000000000,
    endTime: status === 'OPEN' ? -1 : 1750000000000,
    affectedEntities: [entity],
    impactedEntities: [],
    rootCauseEntity: entity,
    managementZones: [{ id: '1', name: 'Production' }],
    problemFilters: [{ id: 'profile-1', name: 'NOC' }],
  };
}
function response(problems: ReturnType<typeof problem>[], nextPageKey: string | null = null) {
  return new Response(JSON.stringify({ problems, nextPageKey, totalCount: problems.length }));
}

describe('DynatraceClassicProblemsClient', () => {
  it('reads long-running open problems and recent closures directly using an authorized bearer token', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([problem()]))
      .mockResolvedValueOnce(response([problem('closed', 'CLOSED')]));
    const records = await new DynatraceClassicProblemsClient(fetchMock).read(
      { ...config, alertingProfiles: ['NOC', 'a"b\\c'] },
      10,
    );
    const urls = fetchMock.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls[0]?.pathname).toBe('/platform/classic/environment-api/v2/problems');
    expect(urls[0]?.searchParams.get('from')).toBe('1');
    expect(urls[0]?.searchParams.get('problemSelector')).toBe(
      'status("open"),problemFilterNames.equals("NOC","a\\"b\\\\c")',
    );
    expect(urls[1]?.searchParams.get('from')).toBe('now-120m');
    expect(urls[1]?.searchParams.get('problemSelector')).toContain('status("closed")');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'error',
      headers: { Authorization: 'Bearer secret' },
    });
    expect(records[0]).toMatchObject({
      problemId: 'problem-1',
      status: 'OPEN',
      endTime: -1,
      rootCauseName: 'Router',
      affectedEntities: [{ id: 'HOST-1', type: 'HOST', name: 'Router' }],
      alertingProfiles: ['NOC'],
    });
    expect(records[1]).toMatchObject({ problemId: 'closed', status: 'CLOSED' });
    expect(urls.some((url) => url.pathname.includes('storage'))).toBe(false);
  });

  it('follows opaque pagination without repeating the initial filters', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.has('nextPageKey')) {
        expect([...url.searchParams.keys()]).toEqual(['nextPageKey']);
        expect(url.searchParams.get('nextPageKey')).toBe('opaque +/&?');
        return response([problem('second')]);
      }
      return url.searchParams.get('problemSelector')?.includes('open')
        ? response([problem()], 'opaque +/&?')
        : response([]);
    });
    expect(await new DynatraceClassicProblemsClient(fetchMock).read(config, 120)).toHaveLength(2);
  });

  it('recovers a tracked problem closed outside the incremental window without assuming missing means closed', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([problem('old', 'CLOSED')]));
    const records = await new DynatraceClassicProblemsClient(fetchMock).read(config, 120, [
      'old',
      'unavailable',
    ]);
    const recovery = new URL(String(fetchMock.mock.calls[2]?.[0]));
    expect(recovery.searchParams.get('from')).toBe('1');
    expect(recovery.searchParams.get('problemSelector')).toBe('problemId("old","unavailable")');
    expect(records.map(({ problemId }) => problemId)).toEqual(['old']);
  });

  it('rejects repeated page cursors rather than publishing a partial snapshot', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      return url.searchParams.get('problemSelector')?.includes('closed')
        ? response([])
        : response([problem()], 'same');
    });
    await expect(new DynatraceClassicProblemsClient(fetchMock).read(config, 120)).rejects.toThrow(
      /repeated/,
    );
  });

  it('preserves Retry-After and reports the required live-read permission without logging the response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('sensitive server message', { status: 429, headers: { 'retry-after': '90' } }),
      );
    await expect(
      new DynatraceClassicProblemsClient(fetchMock).read(config, 120),
    ).rejects.toMatchObject({
      cause: 90000,
      message: expect.stringContaining('environment-api:problems:read'),
    });
  });

  it('rejects oversized responses even if Content-Length is absent', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('x'.repeat(8 * 1024 * 1024 + 1)));
    await expect(
      readDynatracePlatform(
        fetchMock,
        config,
        '/platform/classic/environment-api/v2/problems',
        new URLSearchParams(),
        new AbortController().signal,
        'read',
      ),
    ).rejects.toThrow(/size limit/);
  });
});

// Endpoint tests isolate authentication; OAuthIntegration covers the full exchange and transport path.
vi.mock('./DynatraceAuthentication', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./DynatraceAuthentication')>();
  const authentication = new actual.DynatraceAuthentication();
  authentication.token = vi.fn(async (config) => config.apiToken);
  return { ...actual, dynatraceAuthentication: () => authentication };
});
