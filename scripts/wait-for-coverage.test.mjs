import { describe, expect, it } from 'vitest';
import { COVERAGE_JOBS, waitForCoverage } from './wait-for-coverage.mjs';

const env = {
  GITHUB_REPOSITORY: 'owner/repo',
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '2',
  EXPECTED_HEAD_SHA: 'a'.repeat(40),
  GH_TOKEN: 'token-not-for-logs',
};
const successfulJobs = () =>
  COVERAGE_JOBS.map((name) => ({
    name,
    run_id: 123,
    run_attempt: 2,
    head_sha: env.EXPECTED_HEAD_SHA,
    status: 'completed',
    conclusion: 'success',
  }));
const response = (jobs, total = jobs.length) => ({
  ok: true,
  json: async () => ({ jobs, total_count: total }),
});

describe('coverage preparation overlap', () => {
  it('waits for every job in the exact attempt before authorizing report download', async () => {
    let calls = 0;
    let clock = 0;
    await waitForCoverage({
      env,
      now: () => clock,
      wait: async (ms) => {
        clock += ms;
      },
      fetchImpl: async (url, options) => {
        expect(url).toContain('/runs/123/attempts/2/jobs?per_page=100&page=1');
        expect(options.headers.Authorization).toBe(`Bearer ${env.GH_TOKEN}`);
        expect(options.redirect).toBe('error');
        const jobs = successfulJobs();
        if (calls++ === 0) {
          jobs[4].status = 'in_progress';
          jobs[4].conclusion = null;
        }
        return response(jobs);
      },
    });
    expect(calls).toBe(2);
    expect(clock).toBe(5000);
  });

  it.each(['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', null])(
    'rejects completed coverage with conclusion %s',
    async (conclusion) => {
      const jobs = successfulJobs();
      jobs[0].conclusion = conclusion;
      await expect(waitForCoverage({ env, fetchImpl: async () => response(jobs) })).rejects.toThrow(
        'Coverage failed',
      );
    },
  );

  it.each([{ run_id: 124 }, { run_attempt: 1 }, { head_sha: 'b'.repeat(40) }])(
    'rejects mismatched job provenance %j',
    async (change) => {
      const jobs = successfulJobs();
      Object.assign(jobs[1], change);
      await expect(waitForCoverage({ env, fetchImpl: async () => response(jobs) })).rejects.toThrow(
        'provenance mismatch',
      );
    },
  );

  it('does not accept an older successful duplicate over a failed rerun', async () => {
    const jobs = successfulJobs();
    jobs.push({ ...jobs[0], conclusion: 'failure' });
    await expect(waitForCoverage({ env, fetchImpl: async () => response(jobs) })).rejects.toThrow(
      'Ambiguous',
    );
  });

  it('times out on missing coverage without treating artifacts as success', async () => {
    let clock = 0;
    await expect(
      waitForCoverage({
        env,
        now: () => clock,
        wait: async (ms) => {
          clock += ms;
        },
        timeoutMs: 6000,
        fetchImpl: async () => response(successfulJobs().slice(1)),
      }),
    ).rejects.toThrow('Timed out');
    expect(clock).toBe(6000);
  });

  it('follows pagination before accepting coverage', async () => {
    const jobs = successfulJobs();
    await expect(
      waitForCoverage({
        env,
        fetchImpl: async (url) =>
          url.endsWith('page=1') ? response(jobs.slice(0, 2), 5) : response(jobs.slice(2), 5),
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    { ok: false, status: 403 },
    { ok: true, json: async () => ({ jobs: [], total_count: 2 }) },
    { ok: true, json: async () => ({ jobs: null }) },
  ])('fails closed on an unavailable or incomplete API response', async (reply) => {
    await expect(waitForCoverage({ env, fetchImpl: async () => reply })).rejects.toThrow();
  });

  it('rejects missing context before sending credentials', async () => {
    await expect(
      waitForCoverage({
        env: { ...env, GITHUB_RUN_ATTEMPT: '' },
        fetchImpl: async () => {
          throw new Error('must not fetch');
        },
      }),
    ).rejects.toThrow('requires');
  });
});
