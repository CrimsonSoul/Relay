import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateTreeReuse, runCiTreeReuse } from './ciTreeReuse.mjs';

const repository = 'relaycorp/relay';
const currentSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const baseSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const headSha = 'cccccccccccccccccccccccccccccccccccccccc';
const treeSha = 'dddddddddddddddddddddddddddddddddddddddd';
const securityRunId = 4321;
const coverageArtifactName = 'relay-merged-lcov';

const requiredCheck = (name, runId) => ({
  app: { slug: 'github-actions' },
  conclusion: 'success',
  details_url: `https://github.com/${repository}/actions/runs/${runId}/job/${runId + 1}`,
  head_sha: headSha,
  name,
  status: 'completed',
});

const validFixture = {
  artifacts: [
    {
      expired: false,
      id: 9876,
      name: coverageArtifactName,
      size_in_bytes: 321,
      workflow_run: { id: securityRunId },
    },
  ],
  checkRuns: [
    requiredCheck('Build quality gate', 1234),
    requiredCheck('SonarQube quality gate', securityRunId),
    requiredCheck('Snyk security gate', 2345),
  ],
  compare: {
    ahead_by: 1,
    base_commit: { sha: baseSha },
    commits: [{ sha: currentSha }],
    merge_base_commit: { sha: baseSha },
    status: 'ahead',
    total_commits: 1,
  },
  currentCommit: {
    commit: { tree: { sha: treeSha } },
    parents: [{ sha: baseSha }],
    sha: currentSha,
  },
  currentSha,
  eventName: 'push',
  headCommit: {
    commit: { tree: { sha: treeSha } },
    parents: [{ sha: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' }],
    sha: headSha,
  },
  pullRequest: {
    base: { ref: 'test', repo: { full_name: repository }, sha: baseSha },
    head: { repo: { full_name: repository }, sha: headSha },
    merge_commit_sha: currentSha,
    merged: true,
    merged_at: '2026-08-21T12:00:00Z',
    number: 243,
    state: 'closed',
  },
  pullRequests: [{ number: 243 }],
  ref: 'refs/heads/test',
  repository,
  securityRun: {
    conclusion: 'success',
    event: 'pull_request',
    head_sha: headSha,
    id: securityRunId,
    path: '.github/workflows/security.yml',
    repository: { full_name: repository },
    status: 'completed',
  },
};

describe('evaluateTreeReuse', () => {
  it('accepts one exact-tree squash with all required exact-head evidence', () => {
    expect(evaluateTreeReuse(validFixture)).toEqual({
      coverageArtifact: coverageArtifactName,
      eligible: true,
      headSha,
      headTree: treeSha,
      pullRequest: 243,
      reason: 'eligible',
      securityRunId: '4321',
    });
  });

  it('rejects events other than a push to test before considering provenance', () => {
    expect(evaluateTreeReuse({ ...validFixture, eventName: 'pull_request' }).reason).toBe(
      'event-ineligible',
    );
    expect(evaluateTreeReuse({ ...validFixture, ref: 'refs/heads/main' }).reason).toBe(
      'event-ineligible',
    );
  });

  it('rejects missing or ambiguous associated pull requests', () => {
    expect(evaluateTreeReuse({ ...validFixture, pullRequests: [] }).reason).toBe(
      'pull-request-count',
    );
    expect(
      evaluateTreeReuse({
        ...validFixture,
        pullRequests: [{ number: 243 }, { number: 244 }],
      }).reason,
    ).toBe('pull-request-count');
  });

  it('requires a merged internal pull request targeting test and the current merge SHA', () => {
    expect(
      evaluateTreeReuse({
        ...validFixture,
        pullRequest: { ...validFixture.pullRequest, merged_at: null },
      }).reason,
    ).toBe('pull-request-not-merged');
    expect(
      evaluateTreeReuse({
        ...validFixture,
        pullRequest: { ...validFixture.pullRequest, merged: false },
      }).reason,
    ).toBe('pull-request-not-merged');
    expect(
      evaluateTreeReuse({
        ...validFixture,
        pullRequest: {
          ...validFixture.pullRequest,
          head: { ...validFixture.pullRequest.head, repo: { full_name: 'fork/relay' } },
        },
      }).reason,
    ).toBe('pull-request-repository-mismatch');
    expect(
      evaluateTreeReuse({
        ...validFixture,
        pullRequest: { ...validFixture.pullRequest, merge_commit_sha: headSha },
      }).reason,
    ).toBe('merge-sha-mismatch');
  });

  it('requires a one-parent squash whose parent is the preserved pull request base', () => {
    expect(
      evaluateTreeReuse({
        ...validFixture,
        currentCommit: {
          ...validFixture.currentCommit,
          parents: [{ sha: baseSha }, { sha: headSha }],
        },
      }).reason,
    ).toBe('parent-mismatch');
    expect(
      evaluateTreeReuse({
        ...validFixture,
        currentCommit: {
          ...validFixture.currentCommit,
          parents: [{ sha: 'ffffffffffffffffffffffffffffffffffffffff' }],
        },
      }).reason,
    ).toBe('parent-mismatch');
  });

  it('requires compare evidence that the preserved base is the exact head ancestor', () => {
    expect(
      evaluateTreeReuse({
        ...validFixture,
        compare: { ...validFixture.compare, merge_base_commit: { sha: headSha } },
      }).reason,
    ).toBe('compare-mismatch');
    expect(
      evaluateTreeReuse({
        ...validFixture,
        compare: { ...validFixture.compare, commits: [{ sha: headSha }] },
      }).reason,
    ).toBe('compare-mismatch');
  });

  it('rejects a recursive tree mismatch between the current commit and pull request head', () => {
    expect(
      evaluateTreeReuse({
        ...validFixture,
        headCommit: {
          ...validFixture.headCommit,
          commit: { tree: { sha: 'ffffffffffffffffffffffffffffffffffffffff' } },
        },
      }).reason,
    ).toBe('tree-mismatch');
  });

  it('requires one completed successful GitHub Actions check for every stable gate name', () => {
    expect(
      evaluateTreeReuse({
        ...validFixture,
        checkRuns: validFixture.checkRuns.filter((check) => check.name !== 'Snyk security gate'),
      }).reason,
    ).toBe('required-check-missing');
    expect(
      evaluateTreeReuse({
        ...validFixture,
        checkRuns: [...validFixture.checkRuns, requiredCheck('Build quality gate', 7654)],
      }).reason,
    ).toBe('required-check-ambiguous');
    expect(
      evaluateTreeReuse({
        ...validFixture,
        checkRuns: validFixture.checkRuns.map((check) =>
          check.name === 'Build quality gate' ? { ...check, conclusion: 'failure' } : check,
        ),
      }).reason,
    ).toBe('required-check-unsuccessful');
  });

  it('binds the Sonar check details URL to the exact successful security pull request run', () => {
    expect(
      evaluateTreeReuse({
        ...validFixture,
        securityRun: { ...validFixture.securityRun, id: 98765 },
      }).reason,
    ).toBe('security-run-mismatch');
    expect(
      evaluateTreeReuse({
        ...validFixture,
        securityRun: { ...validFixture.securityRun, event: 'push' },
      }).reason,
    ).toBe('security-run-mismatch');
  });

  it('requires exactly one nonexpired nonempty merged LCOV artifact from that run', () => {
    expect(
      evaluateTreeReuse({
        ...validFixture,
        artifacts: [{ ...validFixture.artifacts[0], expired: true }],
      }).reason,
    ).toBe('coverage-artifact-unavailable');
    expect(
      evaluateTreeReuse({
        ...validFixture,
        artifacts: [{ ...validFixture.artifacts[0], size_in_bytes: 0 }],
      }).reason,
    ).toBe('coverage-artifact-unavailable');
    expect(
      evaluateTreeReuse({
        ...validFixture,
        artifacts: [...validFixture.artifacts, { ...validFixture.artifacts[0], id: 9877 }],
      }).reason,
    ).toBe('coverage-artifact-unavailable');
  });

  it('fails closed with sanitized empty outputs for malformed input instead of throwing', () => {
    expect(evaluateTreeReuse({ ...validFixture, currentSha: 'not-a-sha' })).toEqual({
      coverageArtifact: '',
      eligible: false,
      headSha: '',
      headTree: '',
      pullRequest: '',
      reason: 'current-sha-invalid',
      securityRunId: '',
    });
    expect(evaluateTreeReuse(null).reason).toBe('input-invalid');
  });
});

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

const adapterEnv = async (mode = 'enabled') => {
  const directory = await mkdtemp(join(tmpdir(), 'relay-ci-tree-reuse-'));
  temporaryDirectories.push(directory);
  return {
    GITHUB_EVENT_NAME: 'push',
    GITHUB_OUTPUT: join(directory, 'github-output'),
    GITHUB_REF: 'refs/heads/test',
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: currentSha,
    GITHUB_TOKEN: 'token-that-must-never-be-output',
    RELAY_CI_TREE_REUSE_MODE: mode,
  };
};

const validFetchJson = async (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.pathname === `/repos/${repository}/commits/${currentSha}/pulls`) {
    return validFixture.pullRequests;
  }
  if (url.pathname === `/repos/${repository}/pulls/243`) return validFixture.pullRequest;
  if (url.pathname === `/repos/${repository}/commits/${currentSha}`) {
    return validFixture.currentCommit;
  }
  if (url.pathname === `/repos/${repository}/commits/${headSha}`) return validFixture.headCommit;
  if (url.pathname === `/repos/${repository}/compare/${baseSha}...${currentSha}`) {
    return validFixture.compare;
  }
  if (url.pathname === `/repos/${repository}/commits/${headSha}/check-runs`) {
    return { check_runs: validFixture.checkRuns, total_count: validFixture.checkRuns.length };
  }
  if (url.pathname === `/repos/${repository}/actions/runs/${securityRunId}`) {
    return validFixture.securityRun;
  }
  if (url.pathname === `/repos/${repository}/actions/runs/${securityRunId}/artifacts`) {
    return { artifacts: validFixture.artifacts, total_count: validFixture.artifacts.length };
  }
  throw new Error(`unexpected fixture URL: ${url.pathname}${url.search}`);
};

describe('runCiTreeReuse adapter', () => {
  it('writes only sanitized validated outputs and enables reuse only for exact enabled mode', async () => {
    const env = await adapterEnv();
    const result = await runCiTreeReuse({ env, fetchJson: validFetchJson });
    const output = await readFile(env.GITHUB_OUTPUT, 'utf8');

    expect(result).toMatchObject({ eligible: true, reason: 'eligible', reuse: true });
    expect(output).toBe(
      [
        'eligible=true',
        'reason=eligible',
        'reuse=true',
        'pull-request=243',
        `head-sha=${headSha}`,
        `head-tree=${treeSha}`,
        `security-run-id=${securityRunId}`,
        `coverage-artifact=${coverageArtifactName}`,
        '',
      ].join('\n'),
    );
    expect(output).not.toContain(env.GITHUB_TOKEN);
  });

  it('still resolves complete provenance in shadow mode while forcing reuse false', async () => {
    const env = await adapterEnv('shadow');
    const requests = [];
    const result = await runCiTreeReuse({
      env,
      fetchJson: async (...args) => {
        requests.push(args[0]);
        return validFetchJson(...args);
      },
    });
    const output = await readFile(env.GITHUB_OUTPUT, 'utf8');

    expect(result).toMatchObject({ eligible: true, reuse: false });
    expect(requests).toHaveLength(8);
    expect(output).toContain('eligible=true\n');
    expect(output).toContain('reuse=false\n');
  });

  it('fails closed on API errors without writing the token or response body', async () => {
    const env = await adapterEnv();
    const responseBody = 'private-response-body-that-must-never-be-output';
    const result = await runCiTreeReuse({
      env,
      fetchJson: async () => {
        throw new Error(responseBody);
      },
    });
    const output = await readFile(env.GITHUB_OUTPUT, 'utf8');

    expect(result).toMatchObject({ eligible: false, reason: 'api-failure', reuse: false });
    expect(output).toBe('eligible=false\nreason=api-failure\nreuse=false\n');
    expect(output).not.toContain(env.GITHUB_TOKEN);
    expect(output).not.toContain(responseBody);
  });

  it('fails closed on malformed paginated response schemas', async () => {
    const env = await adapterEnv();
    const result = await runCiTreeReuse({
      env,
      fetchJson: async (rawUrl) => {
        const url = new URL(rawUrl);
        if (url.pathname.endsWith('/check-runs')) return { check_runs: 'not-an-array' };
        return validFetchJson(rawUrl);
      },
    });

    expect(result).toMatchObject({ eligible: false, reason: 'api-failure', reuse: false });
    expect(await readFile(env.GITHUB_OUTPUT, 'utf8')).toBe(
      'eligible=false\nreason=api-failure\nreuse=false\n',
    );
  });

  it('bounds pagination and falls back instead of accepting truncated evidence', async () => {
    const env = await adapterEnv();
    const pages = [];
    const result = await runCiTreeReuse({
      env,
      fetchJson: async (rawUrl) => {
        const url = new URL(rawUrl);
        pages.push(url.searchParams.get('page'));
        return Array.from({ length: 100 }, (_, index) => ({ number: index + 1 }));
      },
    });

    expect(result).toMatchObject({ eligible: false, reason: 'api-failure', reuse: false });
    expect(pages).toEqual(['1', '2', '3']);
  });

  it('never emits malformed IDs, SHAs, or unsafe artifact names', async () => {
    const env = await adapterEnv();
    const result = await runCiTreeReuse({
      env,
      fetchJson: async (rawUrl) => {
        const url = new URL(rawUrl);
        if (url.pathname.endsWith('/artifacts')) {
          return {
            artifacts: [{ ...validFixture.artifacts[0], name: 'unsafe value\nattack=true' }],
            total_count: 1,
          };
        }
        return validFetchJson(rawUrl);
      },
    });
    const output = await readFile(env.GITHUB_OUTPUT, 'utf8');

    expect(result.eligible).toBe(false);
    expect(output).toBe('eligible=false\nreason=coverage-artifact-unavailable\nreuse=false\n');
    expect(output).not.toContain('attack=true');
  });
});
