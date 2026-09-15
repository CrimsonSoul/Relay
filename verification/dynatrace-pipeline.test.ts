import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PocketBase, { type RecordModel } from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DynatraceProblemsClient } from '../src/main/dynatrace/DynatraceProblemsClient';
import { DynatraceProblemsManager } from '../src/main/dynatrace/DynatraceProblemsManager';
import type {
  DynatraceProblemsConfig,
  DynatraceProblemsConfigStore,
} from '../src/main/dynatrace/DynatraceProblemsConfigStore';
import { getPocketBaseBinaryPath } from '../src/main/pocketbase/binaryPath';
import { installMainProcessEventSource } from '../src/main/pocketbase/mainProcessEventSource';
import { AUTODATE_FIELDS, COLLECTIONS } from '../src/main/pocketbase/schema/collectionCatalog';

vi.mock('../src/main/logger', () => ({ loggers: { main: { info: vi.fn(), warn: vi.fn() } } }));

const PASSWORD = 'disposable-dynatrace-pipeline-password';
let root = '';
let child: ChildProcess | undefined;
let admin: PocketBase;
let observer: PocketBase;

beforeAll(async () => {
  installMainProcessEventSource();
  root = await mkdtemp(join(tmpdir(), 'relay-dynatrace-pipeline-'));
  const binary = getPocketBaseBinaryPath({
    isPackaged: false,
    appRoot: process.cwd(),
    resourcesPath: '',
    platform: process.platform,
    arch: process.arch,
  });
  const dataDir = join(root, 'data');
  const created = spawnSync(
    binary,
    ['superuser', 'upsert', 'admin@pipeline.test', PASSWORD, `--dir=${dataDir}`],
    { encoding: 'utf8' },
  );
  if (created.status !== 0) throw new Error('Could not prepare disposable PocketBase');
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No test port allocated');
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  const url = `http://127.0.0.1:${address.port}`;
  child = spawn(
    binary,
    [
      'serve',
      `--http=127.0.0.1:${address.port}`,
      `--dir=${dataDir}`,
      `--migrationsDir=${join(root, 'migrations')}`,
      `--hooksDir=${join(root, 'hooks')}`,
    ],
    { stdio: 'ignore' },
  );
  admin = new PocketBase(url);
  admin.autoCancellation(false);
  await vi.waitFor(() => admin.health.check(), { timeout: 10_000 });
  await admin.collection('_superusers').authWithPassword('admin@pipeline.test', PASSWORD);
  observer = new PocketBase(url);
  await observer.collection('_superusers').authWithPassword('admin@pipeline.test', PASSWORD);
  for (const definition of COLLECTIONS.filter((entry) =>
    entry.name.startsWith('dynatrace_problem'),
  )) {
    await admin.collections.create({
      name: definition.name,
      type: definition.type,
      fields: [...definition.fields, ...AUTODATE_FIELDS],
      indexes: definition.indexes,
    });
  }
});

afterAll(async () => {
  await observer?.realtime.unsubscribe();
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  if (root) await rm(root, { recursive: true, force: true });
});

function apiProblem(index: number) {
  return {
    problemId: `${1000000000000000000n + BigInt(index)}_1789492996054V2`,
    displayId: `P-${index}`,
    title: `Canonical problem ${index}`,
    status: 'OPEN',
    severityLevel: 'AVAILABILITY',
    impactLevel: 'SERVICES',
    startTime: Date.now() - 60_000,
    endTime: -1,
    affectedEntities: [],
    impactedEntities: [],
    managementZones: [],
    problemFilters: [
      {
        id: index % 2 === 0 ? 'profile-noc' : 'profile-other',
        name: index % 2 === 0 ? 'NOC' : 'Other',
      },
    ],
  };
}

function upstream(config: DynatraceProblemsConfig) {
  const problems = Array.from({ length: 100 }, (_, index) => apiProblem(index));
  let unavailable = false;
  let tokenExchanges = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === 'https://sso.dynatrace.com') {
      tokenExchanges += 1;
      return Response.json({
        access_token: 'pipeline-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    expect(url.origin).toBe(config.environmentUrl);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer pipeline-access-token');
    if (url.pathname.includes('/classic/')) {
      if (unavailable) return new Response(null, { status: 503 });
      const selector = url.searchParams.get('problemSelector') ?? '';
      const selected = selector.startsWith('problemId(')
        ? problems.filter((problem) => selector.includes(problem.problemId))
        : problems.filter((problem) => selector.includes(problem.status.toLowerCase()));
      // Return a superset so the real manager must still enforce exact profile membership.
      return Response.json({ problems: selected });
    }
    if (url.pathname.endsWith('/workflows/workflow-test')) {
      return Response.json({
        id: 'workflow-test',
        type: 'STANDARD',
        isDeployed: true,
        triggerType: 'Event',
        trigger: { eventTrigger: { isActive: true } },
      });
    }
    if (url.pathname.endsWith('/executions')) {
      const results = problems.map((problem, index) => ({
        id: `execution-${index}`,
        workflow: 'workflow-test',
        triggerType: 'Event',
        state: 'RUNNING',
        startedAt: new Date(problem.startTime).toISOString(),
        params: {
          event: {
            'event.kind': 'DAVIS_PROBLEM',
            'event.id': problem.problemId,
            'event.status': 'ACTIVE',
            entity_tags: problem.problemFilters.map(({ name }) => `team:${name}`),
          },
        },
      }));
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (url.searchParams.get('ordering')?.startsWith('-')) results.reverse();
      return Response.json({ count: results.length, results: results.slice(offset, offset + 100) });
    }
    if (url.pathname.endsWith('query:execute')) {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      // Native DQL semantics are verified separately against Dynatrace. This fixture makes
      // history unavailable and checks composition of the live transports and persistence.
      expect(query.startsWith('data json:')).toBe(true);
      const payload = JSON.parse(JSON.parse(query.split('\n')[0]!.slice('data json:'.length))) as {
        relay_trigger_payload: { entity_tags: string[]; relay_execution_id: string };
      }[];
      const records =
        config.customDqlMatcher === 'false'
          ? []
          : payload
              .filter(({ relay_trigger_payload: event }) => event.entity_tags.includes('team:NOC'))
              .map(({ relay_trigger_payload: event }) => ({
                relay_execution_id: event.relay_execution_id,
              }));
      return Response.json({ state: 'SUCCEEDED', result: { records } });
    }
    if (url.pathname.endsWith('/tasks'))
      return Response.json({
        email_noc: { action: 'dynatrace.email:send-email', state: 'SUCCESS' },
      });
    if (url.pathname.endsWith('/input'))
      return Response.json({ subject: '🟥 Workflow email subject' });
    throw new Error(`Unexpected Dynatrace request: ${url.pathname}`);
  };
  return {
    problems,
    fetchImpl,
    tokenExchanges: () => tokenExchanges,
    setUnavailable: (value: boolean) => {
      unavailable = value;
    },
  };
}

describe('Dynatrace polling through real PocketBase and realtime', () => {
  it.each([
    { name: 'all problems', profiles: null, matcher: null, expected: 100 },
    { name: 'one exact profile', profiles: ['NOC'], matcher: null, expected: 50 },
    { name: 'multiple exact profiles', profiles: ['NOC', 'Other'], matcher: null, expected: 100 },
    {
      name: 'workflow DQL',
      profiles: null,
      matcher: 'matchesValue(entity_tags, "team:NOC")',
      expected: 50,
    },
    { name: 'DQL matching nothing', profiles: null, matcher: 'false', expected: 0 },
  ])(
    '$name updates automatically and recovers without manual refresh',
    async ({ profiles, matcher, expected }) => {
      for (const name of ['dynatrace_problems', 'dynatrace_problem_sync']) {
        for (const record of await admin.collection(name).getFullList())
          await admin.collection(name).delete(record.id);
      }
      const now = new Date().toISOString();
      await admin
        .collection('dynatrace_problem_sync')
        .create({ key: 'primary', state: 'disabled', lastSuccessAt: now, lastReconciledAt: now });
      const config: DynatraceProblemsConfig = {
        environmentUrl: 'https://pipeline.apps.dynatrace.com',
        apiToken: '',
        oauth: {
          clientId: 'pipeline-client',
          clientSecret: 'pipeline-secret',
          accountUuid: '11111111-1111-4111-8111-111111111111',
        },
        alertingProfiles: profiles,
        customDqlMatcher: matcher,
        workflowId: 'workflow-test',
      };
      const source = upstream(config);
      const events: { action: string; record: RecordModel }[] = [];
      const unsubscribe = await observer
        .collection('dynatrace_problems')
        .subscribe('*', (event) => events.push(event));
      const manager = new DynatraceProblemsManager(
        { load: () => config } as unknown as DynatraceProblemsConfigStore,
        () => admin,
        new DynatraceProblemsClient(source.fetchImpl),
        () => false,
      );
      const syncState = () =>
        admin.collection('dynatrace_problem_sync').getFirstListItem('key="primary"');
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      try {
        manager.start();
        await vi.waitFor(
          async () => {
            const state = await syncState();
            expect({ state: state.state, error: state.error }).toEqual({ state: 'ok', error: '' });
          },
          {
            timeout: 8_000,
          },
        );
        const initial = await admin.collection('dynatrace_problems').getFullList();
        expect(initial).toHaveLength(expected);
        if (expected) {
          expect(new Set(initial.map((problem) => problem.problemId))).toEqual(
            new Set(
              source.problems
                .filter(
                  (problem) =>
                    (!matcher && profiles?.length !== 1) ||
                    problem.problemFilters[0]!.name === 'NOC',
                )
                .map((problem) => problem.problemId),
            ),
          );
          await vi.waitFor(() =>
            expect(events.filter((event) => event.action === 'create')).toHaveLength(expected),
          );
        }
        // A new canonical problem and its RUNNING workflow execution become visible on
        // the next scheduled poll, without invoking syncNow or awaiting email completion.
        source.problems.push(apiProblem(100));
        await vi.advanceTimersByTimeAsync(15_000);
        await vi.waitFor(async () =>
          expect((await admin.collection('dynatrace_problems').getList(1, 1)).totalItems).toBe(
            expected ? expected + 1 : 0,
          ),
        );
        if (expected) {
          await vi.waitFor(() =>
            expect(
              events.some(
                (event) =>
                  event.action === 'create' &&
                  event.record.problemId === source.problems[100]!.problemId,
              ),
            ).toBe(true),
          );
          source.problems[0]!.status = 'CLOSED';
          source.problems[0]!.endTime = Date.now();
          await vi.advanceTimersByTimeAsync(15_000);
          await vi.waitFor(() =>
            expect(
              events.some(
                (event) =>
                  event.action === 'update' &&
                  event.record.problemId === source.problems[0]!.problemId &&
                  event.record.status === 'CLOSED',
              ),
            ).toBe(true),
          );
        }
        source.setUnavailable(true);
        await vi.advanceTimersByTimeAsync(15_000);
        await vi.waitFor(async () => expect((await syncState()).state).toBe('error'));
        expect((await admin.collection('dynatrace_problems').getList(1, 1)).totalItems).toBe(
          expected ? expected + 1 : 0,
        );
        source.setUnavailable(false);
        await vi.advanceTimersByTimeAsync(30_000);
        await vi.waitFor(async () => expect((await syncState()).state).toBe('ok'), {
          timeout: 8_000,
        });
        expect((await syncState()).error).toBe('');
        expect(source.tokenExchanges()).toBe(1);
      } finally {
        await manager.stopForRestore();
        vi.useRealTimers();
        await unsubscribe();
      }
    },
  );
});
