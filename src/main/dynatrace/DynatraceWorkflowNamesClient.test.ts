import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DynatraceWorkflowNamesClient,
  type DynatraceWorkflowExecutionRef,
} from './DynatraceWorkflowNamesClient';

const config = {
  environmentUrl: 'https://abc.apps.dynatrace.com',
  apiToken: 'private-token',
  alertingProfiles: null,
  customDqlMatcher: null,
};
const execution: DynatraceWorkflowExecutionRef = {
  problemId: 'problem-1',
  executionId: 'run-1',
  notificationStatus: 'OPEN',
  notificationUpdatedAt: 1000,
};
const sent = { action: 'dynatrace.email:send-email', state: 'SUCCESS' };
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers });
function setup() {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).endsWith('/tasks')
        ? json({ email_noc: sent })
        : json({ subject: 'Device Offline', body: 'private body', to: ['private recipient'] }),
    );
  return { fetchMock, client: new DynatraceWorkflowNamesClient(fetchMock) };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('read-only workflow subjects', () => {
  it('caches immutable execution subjects but reads a new execution after a workflow rename', async () => {
    const { client, fetchMock } = setup();
    await client.read(config, [execution], true);
    const cached = await client.read(config, [execution], false);
    expect(cached.titles[0]?.notificationTitle).toBe('Device Offline');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith('/tasks')
        ? json({ renamed_task: sent })
        : json({ subject: 'A future name with entirely different wording' }),
    );
    const changed = await client.read(
      config,
      [{ ...execution, executionId: 'run-2', notificationUpdatedAt: 2000 }],
      false,
    );
    expect(changed.titles[0]).toMatchObject({
      notificationTitle: 'A future name with entirely different wording',
      notificationUpdatedAt: 2000,
    });
    expect(JSON.stringify(changed)).not.toMatch(/private body|private recipient|private-token/);
  });
  it('does not reuse a cached subject across environments or changed credentials', async () => {
    const { client, fetchMock } = setup();
    await client.read(config, [execution], true);
    await client.read(
      { ...config, environmentUrl: 'https://other.apps.dynatrace.com' },
      [execution],
      true,
    );
    await client.read({ ...config, apiToken: 'changed-token' }, [execution], true);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
  it('waits for all email routes before preferring the successful NOC email', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(
      json({ email_noc: { ...sent, state: 'RUNNING' }, email_network: sent }),
    );
    expect(await client.read(config, [execution], true)).toEqual({ titles: [], complete: false });
    expect((await client.read(config, [execution], true)).titles[0]?.notificationTitle).toBe(
      'Device Offline',
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/email_noc/input');
  });
  it.each(['email_network', 'email_dcs', 'future_email_task'])(
    'finds the successful %s route by action type',
    async (name) => {
      const { client, fetchMock } = setup();
      fetchMock.mockResolvedValueOnce(
        json({ email_noc: { ...sent, state: 'SKIPPED' }, [name]: sent }),
      );
      expect((await client.read(config, [execution], true)).titles[0]?.notificationTitle).toBe(
        'Device Offline',
      );
      expect(String(fetchMock.mock.calls[1]?.[0])).toContain(`/${name}/input`);
    },
  );
  it.each(['', 'x'.repeat(1001), '{{ template }}', 'a\u0000b', 'a\nb'])(
    'rejects an invalid subject without exposing other email inputs',
    async (subject) => {
      const { client, fetchMock } = setup();
      fetchMock
        .mockResolvedValueOnce(json({ email_noc: sent }))
        .mockResolvedValueOnce(json({ subject, body: 'private body' }));
      expect(await client.read(config, [execution], true)).toEqual({ titles: [], complete: true });
    },
  );
  it('treats expired executions as unavailable and continues to other problems', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/run-1/')) return json({}, 404);
      return String(url).endsWith('/tasks')
        ? json({ email_noc: sent })
        : json({ subject: 'Retained subject' });
    });
    const result = await client.read(
      config,
      [execution, { ...execution, problemId: 'problem-2', executionId: 'run-2' }],
      true,
    );
    expect(result).toEqual({
      complete: true,
      titles: [
        {
          problemId: 'problem-2',
          notificationTitle: 'Retained subject',
          notificationStatus: 'OPEN',
          notificationUpdatedAt: 1000,
        },
      ],
    });
  });
  it.each(['oversized subject', 'forbidden execution'])(
    'still returns healthy names when another run has an %s',
    async (failure) => {
      const { client, fetchMock } = setup();
      fetchMock.mockImplementation(async (url) => {
        const invalidRun = String(url).includes('/run-1/');
        if (invalidRun && failure === 'forbidden execution') return json({}, 403);
        if (String(url).endsWith('/tasks')) return json({ email_noc: sent });
        return json({ subject: invalidRun ? 'x'.repeat(1001) : 'Healthy subject' });
      });
      const refs = [execution, { ...execution, executionId: 'run-2', problemId: 'problem-2' }];
      for (let poll = 0; poll < 2; poll += 1) {
        expect((await client.read(config, refs, true)).titles).toEqual([
          {
            problemId: 'problem-2',
            notificationTitle: 'Healthy subject',
            notificationStatus: 'OPEN',
            notificationUpdatedAt: 1000,
          },
        ]);
      }
    },
  );
  it('does not reread terminal executions that sent no email', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValue(json({ email_noc: { ...sent, state: 'SKIPPED' } }));
    expect(await client.read(config, [execution], true)).toEqual({ titles: [], complete: true });
    await client.read(config, [execution], false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('limits historical catch-up and continues the remaining execution on the next poll', async () => {
    const { client, fetchMock } = setup();
    const refs = Array.from({ length: 26 }, (_, i) => ({
      ...execution,
      problemId: `p-${i}`,
      executionId: `run-${i}`,
    }));
    const first = await client.read(config, refs, true);
    expect(first.titles).toHaveLength(25);
    expect(first.complete).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(50);
    const next = await client.read(config, refs, true);
    expect(next.titles).toHaveLength(26);
    expect(next.complete).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(52);
  });
  it('does not let slow earlier executions starve later completed emails', async () => {
    const { client, fetchMock } = setup();
    const refs = Array.from({ length: 26 }, (_, i) => ({
      ...execution,
      problemId: `p-${i}`,
      executionId: `run-${i}`,
    }));
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith('/input')
        ? json({ subject: 'Later completed email' })
        : json({
            email_noc: { ...sent, state: String(url).includes('/run-25/') ? 'SUCCESS' : 'RUNNING' },
          }),
    );
    expect((await client.read(config, refs, true)).titles).toEqual([]);
    expect((await client.read(config, refs, true)).titles).toEqual([
      {
        problemId: 'p-25',
        notificationTitle: 'Later completed email',
        notificationStatus: 'OPEN',
        notificationUpdatedAt: 1000,
      },
    ]);
  });
  it('prioritizes a new email arriving while historical executions are still pending', async () => {
    const { client, fetchMock } = setup();
    const refs = Array.from({ length: 30 }, (_, i) => ({
      ...execution,
      problemId: `p-${i}`,
      executionId: `run-${i}`,
      notificationUpdatedAt: 1000 + i,
    }));
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith('/input')) return json({ subject: 'New email during catch-up' });
      return json({
        email_noc: { ...sent, state: String(url).includes('/new-run/') ? 'SUCCESS' : 'RUNNING' },
      });
    });
    await client.read(config, refs, true);
    const newest = {
      ...execution,
      problemId: 'new-problem',
      executionId: 'new-run',
      notificationUpdatedAt: 2000,
    };
    expect((await client.read(config, [...refs, newest], true)).titles).toEqual([
      {
        problemId: 'new-problem',
        notificationTitle: 'New email during catch-up',
        notificationStatus: 'OPEN',
        notificationUpdatedAt: 2000,
      },
    ]);
  });
  it('cancels slow requests within the poll budget and leaves their names retryable', async () => {
    vi.useFakeTimers();
    const { client, fetchMock } = setup();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          ),
        ),
    );
    const reading = client.read(config, [execution], true);
    await vi.advanceTimersByTimeAsync(10001);
    expect(await reading).toEqual({ titles: [], complete: false });
  });
  it('lets unattempted executions proceed on the next poll after earlier requests time out', async () => {
    vi.useFakeTimers();
    const { client, fetchMock } = setup();
    const refs = Array.from({ length: 5 }, (_, i) => ({
      ...execution,
      problemId: `p-${i}`,
      executionId: `run-${i}`,
    }));
    fetchMock.mockImplementation((url, init) => {
      if (String(url).includes('/run-4/'))
        return Promise.resolve(
          String(url).endsWith('/tasks')
            ? json({ email_noc: sent })
            : json({ subject: 'Healthy after stalled requests' }),
        );
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        ),
      );
    });
    const first = client.read(config, refs, true);
    await vi.advanceTimersByTimeAsync(10001);
    expect((await first).titles).toEqual([]);
    const second = client.read(config, refs, true);
    await vi.advanceTimersByTimeAsync(10001);
    expect((await second).titles).toEqual([
      {
        problemId: 'p-4',
        notificationTitle: 'Healthy after stalled requests',
        notificationStatus: 'OPEN',
        notificationUpdatedAt: 1000,
      },
    ]);
  });
  it('honors rate-limit backoff without revealing response bodies or credentials', async () => {
    vi.useFakeTimers();
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValue(json({ private: 'private body' }, 429, { 'retry-after': '120' }));
    await expect(client.read(config, [execution], true)).rejects.toThrow(/HTTP 429/);
    await expect(client.read(config, [execution], true)).rejects.toThrow(/rate-limited/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120001);
    await expect(client.read(config, [execution], true)).rejects.toThrow(/HTTP 429/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('requires only read access and rejects missing permission safely', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValue(json({ private: 'private body' }, 403));
    await expect(client.read(config, [execution], true)).rejects.toThrow(
      /automation:workflows:read/,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', redirect: 'error' });
  });
  it('shares the execution-read allowance across grace-period retries', async () => {
    const { client, fetchMock } = setup();
    const context = { signal: new AbortController().signal, remainingExecutions: 1 };
    fetchMock.mockResolvedValue(json({ email_noc: { ...sent, state: 'RUNNING' } }));
    expect(await client.read(config, [execution], true, context)).toEqual({
      titles: [],
      complete: false,
    });
    expect(await client.read(config, [execution], true, context)).toEqual({
      titles: [],
      complete: false,
    });
    expect(context.remainingExecutions).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('uses only the remaining outer deadline instead of starting a new ten-second allowance', async () => {
    vi.useFakeTimers();
    const { client, fetchMock } = setup();
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          ),
        ),
    );
    setTimeout(() => controller.abort(), 2000);
    const reading = client.read(config, [execution], true, {
      signal: controller.signal,
      remainingExecutions: 25,
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await reading).toEqual({ titles: [], complete: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});

// Endpoint tests isolate authentication; OAuthIntegration covers the full exchange and transport path.
vi.mock('./DynatraceAuthentication', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./DynatraceAuthentication')>();
  const authentication = new actual.DynatraceAuthentication();
  authentication.token = vi.fn(async (config) => config.apiToken);
  return { ...actual, dynatraceAuthentication: () => authentication };
});
