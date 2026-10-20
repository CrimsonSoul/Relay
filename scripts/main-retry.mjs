// A failed first attempt of the main Release workflow gets exactly one automatic retry. When
// the same commit's Build failed on its first attempt, its failed jobs rerun first so the
// retried Release gate waits for the fresh check runs; otherwise only the Release reruns.
export const BUILD_WORKFLOW = 'build.yml';
export const BUILD_WAIT_TIMEOUT_MS = 30 * 60 * 1000;
export const BUILD_POLL_INTERVAL_MS = 30 * 1000;

export function planMainRetry({ release, build }) {
  if (release?.event !== 'push' || release.head_branch !== 'main') {
    return { action: 'none', reason: 'Only main push releases are retried.' };
  }
  if (release.conclusion !== 'failure' || release.run_attempt !== 1) {
    return { action: 'none', reason: 'Only a failed first Release attempt is retried.' };
  }
  if (!build) return { action: 'none', reason: 'No Build run exists for the release commit.' };
  if (build.status !== 'completed') return { action: 'wait' };
  if (build.conclusion === 'success') return { action: 'rerun', runs: ['release'] };
  if (build.conclusion === 'failure' && build.run_attempt === 1) {
    return { action: 'rerun', runs: ['build', 'release'] };
  }
  return {
    action: 'none',
    reason: `Build ${build.conclusion} on attempt ${build.run_attempt} is not retried.`,
  };
}

async function findBuildRun({ github, owner, repo, headSha }) {
  const { data } = await github.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: BUILD_WORKFLOW,
    branch: 'main',
    event: 'push',
    head_sha: headSha,
    per_page: 10,
  });
  return data.workflow_runs.toSorted((left, right) => right.id - left.id)[0];
}

export async function runMainRetry({
  github,
  owner,
  repo,
  release,
  log = console.log,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs = BUILD_WAIT_TIMEOUT_MS,
  pollIntervalMs = BUILD_POLL_INTERVAL_MS,
}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const build = await findBuildRun({ github, owner, repo, headSha: release.head_sha });
    const plan = planMainRetry({ release, build });
    if (plan.action === 'none') {
      log(plan.reason);
      return plan;
    }
    if (plan.action === 'rerun') {
      const ids = { build: build.id, release: release.id };
      for (const run of plan.runs) {
        await github.rest.actions.reRunWorkflowFailedJobs({ owner, repo, run_id: ids[run] });
        log(`Reran failed ${run} jobs for ${release.head_sha} (run ${ids[run]}).`);
      }
      return plan;
    }
    if (now() >= deadline) {
      throw new Error(`Timed out waiting for Build run ${build.id} on ${release.head_sha}.`);
    }
    log(`Waiting for Build run ${build.id} to complete.`);
    await sleep(pollIntervalMs);
  }
}
