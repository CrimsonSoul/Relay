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
const buildRunId = 1234;
const securityRunId = 4321;
const pullRequestNumber = 243;
const headRef = 'codex/ci-pipeline-optimization';
const buildArtifactName = `relay-pr-provenance-${pullRequestNumber}-${baseSha}-${headSha}`;
const coverageArtifactName = `relay-merged-lcov-${pullRequestNumber}-${baseSha}-${headSha}`;

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
  buildArtifacts: [
    {
      expired: false,
      id: 8765,
      name: buildArtifactName,
      size_in_bytes: 123,
      workflow_run: { id: buildRunId },
    },
  ],
  buildRun: {
    conclusion: 'success',
    event: 'pull_request',
    head_branch: headRef,
    head_repository: { full_name: repository },
    head_sha: headSha,
    id: buildRunId,
    path: '.github/workflows/build.yml',
    repository: { full_name: repository },
    status: 'completed',
  },
  checkRuns: [
    requiredCheck('Build quality gate', buildRunId),
    requiredCheck('SonarQube quality gate', securityRunId),
    requiredCheck('Snyk security gate', securityRunId),
  ],
  compare: {
    ahead_by: 1,
    base_commit: { sha: baseSha },
    behind_by: 0,
    commits: [{ sha: headSha }],
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
    head: { ref: headRef, repo: { full_name: repository }, sha: headSha },
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
    head_branch: headRef,
    head_repository: { full_name: repository },
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
      baseSha,
      buildArtifact: buildArtifactName,
      buildRunId: String(buildRunId),
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
        compare: { ...validFixture.compare, commits: [{ sha: currentSha }] },
      }).reason,
    ).toBe('compare-mismatch');
  });

  it('accepts complete bounded ancestry evidence for a multi-commit pull request head', () => {
    const intermediateSha = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    expect(
      evaluateTreeReuse({
        ...validFixture,
        compare: {
          ...validFixture.compare,
          ahead_by: 2,
          commits: [{ sha: intermediateSha }, { sha: headSha }],
          total_commits: 2,
        },
      }).eligible,
    ).toBe(true);
  });

  it('rejects a PR head not descended from its preserved base even when squash and tree evidence pass', () => {
    expect(
      evaluateTreeReuse({
        ...validFixture,
        compare: {
          ...validFixture.compare,
          merge_base_commit: { sha: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' },
          status: 'diverged',
        },
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

  it('binds all required checks to the exact Build and shared Security workflow runs', () => {
    expect(
      evaluateTreeReuse({
        ...validFixture,
        buildRun: { ...validFixture.buildRun, path: '.github/workflows/security.yml' },
      }).reason,
    ).toBe('build-run-mismatch');
    expect(
      evaluateTreeReuse({
        ...validFixture,
        securityRun: { ...validFixture.securityRun, path: '.github/workflows/build.yml' },
      }).reason,
    ).toBe('security-run-mismatch');
    expect(
      evaluateTreeReuse({
        ...validFixture,
        buildRun: { ...validFixture.buildRun, id: 9999 },
      }).reason,
    ).toBe('build-run-mismatch');
    expect(
      evaluateTreeReuse({
        ...validFixture,
        checkRuns: validFixture.checkRuns.map((check) =>
          check.name === 'Snyk security gate' ? requiredCheck('Snyk security gate', 9999) : check,
        ),
      }).reason,
    ).toBe('security-run-mismatch');
  });

  it('requires exact head ref and repository metadata on both workflow runs', () => {
    for (const field of ['buildRun', 'securityRun']) {
      expect(
        evaluateTreeReuse({
          ...validFixture,
          [field]: { ...validFixture[field], head_branch: 'same-sha-different-branch' },
        }).reason,
      ).toBe(field === 'buildRun' ? 'build-run-mismatch' : 'security-run-mismatch');
      expect(
        evaluateTreeReuse({
          ...validFixture,
          [field]: {
            ...validFixture[field],
            head_repository: { full_name: 'other/repository' },
          },
        }).reason,
      ).toBe(field === 'buildRun' ? 'build-run-mismatch' : 'security-run-mismatch');
      expect(
        evaluateTreeReuse({
          ...validFixture,
          [field]: {
            ...validFixture[field],
            repository: { full_name: 'other/repository' },
          },
        }).reason,
      ).toBe(field === 'buildRun' ? 'build-run-mismatch' : 'security-run-mismatch');
    }
  });

  it('requires exact PR and preserved-base attestations even when the head SHA is reused', () => {
    const otherPullRequest = 244;
    expect(
      evaluateTreeReuse({
        ...validFixture,
        pullRequest: { ...validFixture.pullRequest, number: otherPullRequest },
        pullRequests: [{ number: otherPullRequest }],
      }).reason,
    ).toBe('build-attestation-unavailable');

    const otherBaseSha = 'ffffffffffffffffffffffffffffffffffffffff';
    expect(
      evaluateTreeReuse({
        ...validFixture,
        compare: {
          ...validFixture.compare,
          base_commit: { sha: otherBaseSha },
          merge_base_commit: { sha: otherBaseSha },
        },
        currentCommit: {
          ...validFixture.currentCommit,
          parents: [{ sha: otherBaseSha }],
        },
        pullRequest: {
          ...validFixture.pullRequest,
          base: { ...validFixture.pullRequest.base, sha: otherBaseSha },
        },
      }).reason,
    ).toBe('build-attestation-unavailable');
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
      baseSha: '',
      buildArtifact: '',
      buildRunId: '',
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
  if (url.pathname === `/repos/${repository}/pulls/${pullRequestNumber}`) {
    return validFixture.pullRequest;
  }
  if (url.pathname === `/repos/${repository}/commits/${currentSha}`) {
    return validFixture.currentCommit;
  }
  if (url.pathname === `/repos/${repository}/commits/${headSha}`) return validFixture.headCommit;
  if (url.pathname === `/repos/${repository}/compare/${baseSha}...${headSha}`) {
    return validFixture.compare;
  }
  if (url.pathname === `/repos/${repository}/commits/${headSha}/check-runs`) {
    return { check_runs: validFixture.checkRuns, total_count: validFixture.checkRuns.length };
  }
  if (url.pathname === `/repos/${repository}/actions/runs/${buildRunId}`) {
    return validFixture.buildRun;
  }
  if (url.pathname === `/repos/${repository}/actions/runs/${buildRunId}/artifacts`) {
    return {
      artifacts: validFixture.buildArtifacts,
      total_count: validFixture.buildArtifacts.length,
    };
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
  it('writes only sanitized candidate identities and cannot claim final reuse', async () => {
    const env = await adapterEnv();
    const result = await runCiTreeReuse({ env, fetchJson: validFetchJson });
    const output = await readFile(env.GITHUB_OUTPUT, 'utf8');

    expect(result).toMatchObject({ eligible: true, reason: 'eligible' });
    expect(result).not.toHaveProperty('reuse');
    expect(output).toBe(
      [
        'metadata-eligible=true',
        'metadata-reason=eligible',
        'pull-request=243',
        `base-sha=${baseSha}`,
        `head-sha=${headSha}`,
        `head-tree=${treeSha}`,
        `build-run-id=${buildRunId}`,
        `build-artifact=${buildArtifactName}`,
        `security-run-id=${securityRunId}`,
        `coverage-artifact=${coverageArtifactName}`,
        '',
      ].join('\n'),
    );
    expect(output).not.toContain(env.GITHUB_TOKEN);
    expect(output).not.toMatch(/^reuse=/mu);
  });

  it('still resolves complete metadata provenance in shadow mode', async () => {
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

    expect(result).toMatchObject({ eligible: true, reason: 'eligible' });
    expect(result).not.toHaveProperty('reuse');
    expect(requests).toHaveLength(10);
    expect(requests).toContain(
      `https://api.github.com/repos/${repository}/compare/${baseSha}...${headSha}?per_page=100&page=1`,
    );
    expect(output).toContain('metadata-eligible=true\n');
    expect(output).not.toMatch(/^reuse=/mu);
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

    expect(result).toMatchObject({ eligible: false, reason: 'api-failure' });
    expect(result).not.toHaveProperty('reuse');
    expect(output).toBe('metadata-eligible=false\nmetadata-reason=api-failure\n');
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

    expect(result).toMatchObject({ eligible: false, reason: 'api-failure' });
    expect(await readFile(env.GITHUB_OUTPUT, 'utf8')).toBe(
      'metadata-eligible=false\nmetadata-reason=api-failure\n',
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

    expect(result).toMatchObject({ eligible: false, reason: 'api-failure' });
    expect(pages).toEqual(['1', '2', '3']);
  });

  it('never emits malformed IDs, SHAs, or unsafe artifact names', async () => {
    const env = await adapterEnv();
    const result = await runCiTreeReuse({
      env,
      fetchJson: async (rawUrl) => {
        const url = new URL(rawUrl);
        if (url.pathname === `/repos/${repository}/actions/runs/${securityRunId}/artifacts`) {
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
    expect(output).toBe('metadata-eligible=false\nmetadata-reason=coverage-artifact-unavailable\n');
    expect(output).not.toContain('attack=true');
  });
});
