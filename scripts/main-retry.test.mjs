import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { planMainRetry, runMainRetry } from './main-retry.mjs';

const release = {
  id: 10,
  event: 'push',
  head_branch: 'main',
  head_sha: 'a'.repeat(40),
  conclusion: 'failure',
  run_attempt: 1,
};
const build = { id: 20, status: 'completed', conclusion: 'failure', run_attempt: 1 };

const fakeGithub = (builds) => {
  const listWorkflowRuns = vi.fn();
  for (const runs of builds)
    listWorkflowRuns.mockResolvedValueOnce({ data: { workflow_runs: runs } });
  return {
    rest: { actions: { listWorkflowRuns, reRunWorkflowFailedJobs: vi.fn().mockResolvedValue({}) } },
  };
};

describe('main release retry', () => {
  it('reruns a failed first Build before its Release', () => {
    expect(planMainRetry({ release, build })).toEqual({
      action: 'rerun',
      runs: ['build', 'release'],
    });
  });

  it('reruns only the Release when its Build succeeded', () => {
    expect(planMainRetry({ release, build: { ...build, conclusion: 'success' } })).toEqual({
      action: 'rerun',
      runs: ['release'],
    });
  });

  it('waits while the Build is still running', () => {
    expect(planMainRetry({ release, build: { ...build, status: 'in_progress' } })).toEqual({
      action: 'wait',
    });
  });

  it.each([
    ['a second Release attempt', { ...release, run_attempt: 2 }, build],
    ['a successful Release', { ...release, conclusion: 'success' }, build],
    ['a cancelled Release', { ...release, conclusion: 'cancelled' }, build],
    ['a non-main Release', { ...release, head_branch: 'codex/topic' }, build],
    ['a non-push Release', { ...release, event: 'workflow_dispatch' }, build],
    ['a missing Build', release, undefined],
    ['a cancelled Build', release, { ...build, conclusion: 'cancelled' }],
    ['an already retried Build', release, { ...build, run_attempt: 2 }],
  ])('does not retry %s', (_label, candidateRelease, candidateBuild) => {
    expect(planMainRetry({ release: candidateRelease, build: candidateBuild }).action).toBe('none');
  });

  it('polls the newest Build for the commit, then reruns Build before Release', async () => {
    const github = fakeGithub([
      [{ ...build, status: 'in_progress' }],
      [
        { ...build, id: 19, conclusion: 'success' },
        { ...build, id: 21 },
      ],
    ]);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const plan = await runMainRetry({
      github,
      owner: 'o',
      repo: 'r',
      release,
      log: () => {},
      sleep,
    });

    expect(plan).toEqual({ action: 'rerun', runs: ['build', 'release'] });
    expect(sleep).toHaveBeenCalledOnce();
    expect(github.rest.actions.listWorkflowRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: 'build.yml',
        branch: 'main',
        event: 'push',
        head_sha: release.head_sha,
      }),
    );
    expect(github.rest.actions.reRunWorkflowFailedJobs.mock.calls).toEqual([
      [{ owner: 'o', repo: 'r', run_id: 21 }],
      [{ owner: 'o', repo: 'r', run_id: 10 }],
    ]);
  });

  it('gives up without rerunning when the Build never completes', async () => {
    const github = fakeGithub([[{ ...build, status: 'in_progress' }]]);
    let clock = 0;

    await expect(
      runMainRetry({
        github,
        owner: 'o',
        repo: 'r',
        release,
        log: () => {},
        now: () => (clock += 1000),
        timeoutMs: 500,
        sleep: vi.fn(),
      }),
    ).rejects.toThrow('Timed out waiting for Build run 20');
    expect(github.rest.actions.reRunWorkflowFailedJobs).not.toHaveBeenCalled();
  });

  it('runs from the trusted default branch only after a failed first main Release', async () => {
    const workflow = parse(
      await readFile(new URL('../.github/workflows/main-retry.yml', import.meta.url), 'utf8'),
    );

    expect(workflow.on).toEqual({
      workflow_run: { workflows: ['Build and Release'], types: ['completed'], branches: ['main'] },
    });
    expect(workflow.permissions).toEqual({ actions: 'write', contents: 'read' });
    const job = workflow.jobs.retry;
    expect(String(job.if).replaceAll(/\s+/gu, ' ').trim()).toBe(
      "github.event.workflow_run.event == 'push' && github.event.workflow_run.conclusion == 'failure' && github.event.workflow_run.run_attempt == 1",
    );
    expect(job.steps[0].with).toBeUndefined();
    expect(job.steps.at(-1).with.script).toContain('scripts/main-retry.mjs');
  });
});
