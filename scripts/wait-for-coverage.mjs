import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

export const COVERAGE_JOBS = Object.freeze([
  'Unit coverage',
  ...[1, 2, 3, 4].map((index) => `Renderer coverage (${index}/4)`),
]);

function contextFromEnvironment(env) {
  const {
    GITHUB_REPOSITORY: repository,
    GITHUB_RUN_ID: runId,
    GITHUB_RUN_ATTEMPT: attempt,
    EXPECTED_HEAD_SHA: headSha,
    GH_TOKEN: token,
  } = env;
  if (
    !/^[\w.-]+\/[\w.-]+$/u.test(repository ?? '') ||
    !/^[1-9]\d*$/u.test(runId ?? '') ||
    !/^[1-9]\d*$/u.test(attempt ?? '') ||
    !/^[a-f0-9]{40}$/u.test(headSha ?? '') ||
    !token
  ) {
    throw new Error('Coverage wait requires repository, run, attempt, head SHA and token.');
  }
  return { repository, runId, attempt, headSha, token };
}

async function fetchJobs({ repository, runId, attempt, token }, fetchImpl, now, deadline) {
  const jobs = [];
  let total;
  for (let page = 1; page <= 10; page += 1) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('Timed out waiting for successful coverage.');
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(30_000, remaining)))),
        redirect: 'error',
      },
    );
    if (!response.ok) throw new Error(`Coverage job lookup failed: HTTP ${response.status}.`);
    const data = await response.json();
    if (
      !Array.isArray(data.jobs) ||
      !Number.isSafeInteger(data.total_count) ||
      data.total_count < 0
    ) {
      throw new Error('Malformed coverage job lookup.');
    }
    total = data.total_count;
    jobs.push(...data.jobs);
    if (jobs.length >= total) break;
    if (data.jobs.length === 0) throw new Error('Incomplete coverage job lookup.');
  }
  if (jobs.length !== total) throw new Error('Incomplete coverage job lookup.');
  return jobs;
}

function coverageSucceeded(jobs, name, { runId, attempt, headSha }) {
  const matches = jobs.filter((job) => job.name === name);
  if (matches.length > 1) throw new Error(`Ambiguous coverage job: ${name}.`);
  if (matches.length === 0) return false;
  const job = matches[0];
  if (
    String(job.run_id) !== runId ||
    String(job.run_attempt) !== attempt ||
    job.head_sha !== headSha
  ) {
    throw new Error(`Coverage job provenance mismatch: ${name}.`);
  }
  if (job.status !== 'completed') return false;
  if (job.conclusion !== 'success')
    throw new Error(`Coverage failed: ${name} (${job.conclusion}).`);
  return true;
}

// Query the exact attempt: GitHub includes successful jobs carried forward by a
// partial rerun here, without accepting an older success over a rerun failure.
export async function waitForCoverage({
  env = process.env,
  fetchImpl = fetch,
  now = () => performance.now(),
  wait = sleep,
  timeoutMs = 300_000,
} = {}) {
  const context = contextFromEnvironment(env);
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const jobs = await fetchJobs(context, fetchImpl, now, deadline);
    if (now() >= deadline) break;
    const results = COVERAGE_JOBS.map((name) => coverageSucceeded(jobs, name, context));
    if (results.every(Boolean)) return;
    await wait(Math.max(0, Math.min(5_000, deadline - now())));
  }
  throw new Error('Timed out waiting for successful coverage.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await waitForCoverage();
  console.log('All coverage jobs succeeded for this run, attempt and head commit.');
}
