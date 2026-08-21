import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const ARTIFACT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const COVERAGE_ARTIFACT = 'relay-merged-lcov';
const SECURITY_WORKFLOW_PATH = '.github/workflows/security.yml';
const REQUIRED_CHECKS = ['Build quality gate', 'SonarQube quality gate', 'Snyk security gate'];

const blankResult = (reason) => ({
  coverageArtifact: '',
  eligible: false,
  headSha: '',
  headTree: '',
  pullRequest: '',
  reason,
  securityRunId: '',
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSha = (value) => typeof value === 'string' && SHA_PATTERN.test(value);
const isPositiveId = (value) => Number.isSafeInteger(value) && value > 0;

function actionRunId(detailsUrl, repository) {
  if (typeof detailsUrl !== 'string') return null;
  try {
    const url = new URL(detailsUrl);
    const expectedPrefix = `/${repository}/actions/runs/`;
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
    if (!url.pathname.startsWith(expectedPrefix)) return null;
    const value = url.pathname.slice(expectedPrefix.length).split('/')[0];
    if (!/^[1-9]\d*$/u.test(value)) return null;
    const id = Number(value);
    return isPositiveId(id) ? id : null;
  } catch {
    return null;
  }
}

function validateRequest(input) {
  if (!isObject(input)) return 'input-invalid';
  if (input.eventName !== 'push' || input.ref !== 'refs/heads/test') return 'event-ineligible';
  if (typeof input.repository !== 'string' || !REPOSITORY_PATTERN.test(input.repository)) {
    return 'repository-invalid';
  }
  return isSha(input.currentSha) ? null : 'current-sha-invalid';
}

function pullRequestEvidence(input) {
  if (!Array.isArray(input.pullRequests) || input.pullRequests.length !== 1) {
    return { reason: 'pull-request-count' };
  }
  const associatedPullRequest = input.pullRequests[0];
  const pullRequest = input.pullRequest;
  if (
    !isObject(associatedPullRequest) ||
    !isPositiveId(associatedPullRequest.number) ||
    !isObject(pullRequest) ||
    pullRequest.number !== associatedPullRequest.number
  ) {
    return { reason: 'pull-request-invalid' };
  }
  if (
    pullRequest.state !== 'closed' ||
    pullRequest.merged !== true ||
    typeof pullRequest.merged_at !== 'string' ||
    pullRequest.merged_at.length === 0
  ) {
    return { reason: 'pull-request-not-merged' };
  }
  if (pullRequest.base?.ref !== 'test') return { reason: 'pull-request-target-mismatch' };
  if (
    pullRequest.base?.repo?.full_name !== input.repository ||
    pullRequest.head?.repo?.full_name !== input.repository
  ) {
    return { reason: 'pull-request-repository-mismatch' };
  }
  if (pullRequest.merge_commit_sha !== input.currentSha) {
    return { reason: 'merge-sha-mismatch' };
  }

  const baseSha = pullRequest.base?.sha;
  const headSha = pullRequest.head?.sha;
  if (!isSha(baseSha)) return { reason: 'base-sha-invalid' };
  if (!isSha(headSha)) return { reason: 'head-sha-invalid' };
  return { baseSha, headSha, pullRequest, reason: null };
}

function validateCurrentCommit(input, baseSha) {
  const currentCommit = input.currentCommit;
  if (
    !isObject(currentCommit) ||
    currentCommit.sha !== input.currentSha ||
    !isSha(currentCommit.commit?.tree?.sha)
  ) {
    return 'current-commit-invalid';
  }
  if (
    !Array.isArray(currentCommit.parents) ||
    currentCommit.parents.length !== 1 ||
    currentCommit.parents[0]?.sha !== baseSha
  ) {
    return 'parent-mismatch';
  }
  return null;
}

function validateCompare(input, baseSha) {
  const compare = input.compare;
  if (
    !isObject(compare) ||
    compare.status !== 'ahead' ||
    compare.ahead_by !== 1 ||
    compare.total_commits !== 1 ||
    compare.base_commit?.sha !== baseSha ||
    compare.merge_base_commit?.sha !== baseSha ||
    !Array.isArray(compare.commits) ||
    compare.commits.length !== 1 ||
    compare.commits[0]?.sha !== input.currentSha
  ) {
    return 'compare-mismatch';
  }
  return null;
}

function headTreeEvidence(input, headSha) {
  const headCommit = input.headCommit;
  if (!isObject(headCommit) || headCommit.sha !== headSha || !isSha(headCommit.commit?.tree?.sha)) {
    return { reason: 'head-commit-invalid' };
  }
  const headTree = headCommit.commit.tree.sha;
  if (input.currentCommit.commit.tree.sha !== headTree) return { reason: 'tree-mismatch' };
  return { headTree, reason: null };
}

function requiredCheckEvidence(checkRuns, headSha) {
  if (!Array.isArray(checkRuns)) return { reason: 'required-check-missing' };
  const required = new Map();
  for (const name of REQUIRED_CHECKS) {
    const matching = checkRuns.filter((check) => check?.name === name);
    if (matching.length === 0) return { reason: 'required-check-missing' };
    if (matching.length !== 1) return { reason: 'required-check-ambiguous' };
    const check = matching[0];
    if (
      check.status !== 'completed' ||
      check.conclusion !== 'success' ||
      check.head_sha !== headSha ||
      check.app?.slug !== 'github-actions'
    ) {
      return { reason: 'required-check-unsuccessful' };
    }
    required.set(name, check);
  }
  return { reason: null, required };
}

function validateSecurityRun(input, headSha, sonarRunId) {
  if (
    sonarRunId === null ||
    !isObject(input.securityRun) ||
    !isPositiveId(input.securityRun.id) ||
    input.securityRun.id !== sonarRunId ||
    input.securityRun.repository?.full_name !== input.repository ||
    input.securityRun.head_sha !== headSha ||
    input.securityRun.event !== 'pull_request' ||
    input.securityRun.path !== SECURITY_WORKFLOW_PATH ||
    input.securityRun.status !== 'completed' ||
    input.securityRun.conclusion !== 'success'
  ) {
    return 'security-run-mismatch';
  }
  return null;
}

function coverageArtifactEvidence(input) {
  if (!Array.isArray(input.artifacts)) return { reason: 'coverage-artifact-unavailable' };
  const artifacts = input.artifacts.filter((artifact) => artifact?.name === COVERAGE_ARTIFACT);
  if (artifacts.length !== 1) return { reason: 'coverage-artifact-unavailable' };
  const artifact = artifacts[0];
  if (
    !isPositiveId(artifact.id) ||
    artifact.expired !== false ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes <= 0 ||
    artifact.workflow_run?.id !== input.securityRun.id ||
    !ARTIFACT_PATTERN.test(artifact.name)
  ) {
    return { reason: 'coverage-artifact-unavailable' };
  }
  return { artifact, reason: null };
}

export function evaluateTreeReuse(input) {
  const requestReason = validateRequest(input);
  if (requestReason !== null) return blankResult(requestReason);

  const pullRequest = pullRequestEvidence(input);
  if (pullRequest.reason !== null) return blankResult(pullRequest.reason);
  const currentReason = validateCurrentCommit(input, pullRequest.baseSha);
  if (currentReason !== null) return blankResult(currentReason);
  const compareReason = validateCompare(input, pullRequest.baseSha);
  if (compareReason !== null) return blankResult(compareReason);
  const headTree = headTreeEvidence(input, pullRequest.headSha);
  if (headTree.reason !== null) return blankResult(headTree.reason);
  const checks = requiredCheckEvidence(input.checkRuns, pullRequest.headSha);
  if (checks.reason !== null) return blankResult(checks.reason);
  const sonarRunId = actionRunId(
    checks.required.get('SonarQube quality gate')?.details_url,
    input.repository,
  );
  const securityReason = validateSecurityRun(input, pullRequest.headSha, sonarRunId);
  if (securityReason !== null) return blankResult(securityReason);
  const coverage = coverageArtifactEvidence(input);
  if (coverage.reason !== null) return blankResult(coverage.reason);

  return {
    coverageArtifact: coverage.artifact.name,
    eligible: true,
    headSha: pullRequest.headSha,
    headTree: headTree.headTree,
    pullRequest: pullRequest.pullRequest.number,
    reason: 'eligible',
    securityRunId: String(input.securityRun.id),
  };
}

const API_ROOT = 'https://api.github.com';
const PAGE_SIZE = 100;
const MAX_PAGES = 3;

async function defaultFetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`GitHub API request failed with status ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error('GitHub API returned invalid JSON.');
  }
}

const requireObject = (value) => {
  if (!isObject(value)) throw new Error('GitHub API response schema mismatch.');
  return value;
};

function parsePage(response, field, expectedTotal) {
  if (field === null) {
    if (!Array.isArray(response)) throw new Error('GitHub API response schema mismatch.');
    return { total: null, values: response };
  }

  const object = requireObject(response);
  if (!Array.isArray(object[field])) throw new Error('GitHub API response schema mismatch.');
  if (!Number.isSafeInteger(object.total_count) || object.total_count < 0) {
    throw new Error('GitHub API response schema mismatch.');
  }
  if (expectedTotal !== null && object.total_count !== expectedTotal) {
    throw new Error('GitHub API pagination is ambiguous.');
  }
  if (object.total_count > PAGE_SIZE * MAX_PAGES) {
    throw new Error('GitHub API pagination is ambiguous.');
  }
  return { total: object.total_count, values: object[field] };
}

const pageIsComplete = (field, values, collected, total) =>
  field === null ? values.length < PAGE_SIZE : collected.length === total;

const pageIsAmbiguous = (field, values, collected, total) =>
  field !== null && (values.length === 0 || collected.length > total);

async function collectPages({ requestJson, path, field }) {
  const collected = [];
  let expectedTotal = null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(`${API_ROOT}${path}`);
    url.searchParams.set('per_page', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));
    const response = await requestJson(url.href);
    const { total, values } = parsePage(response, field, expectedTotal);
    expectedTotal = total;

    if (values.length > PAGE_SIZE) throw new Error('GitHub API response schema mismatch.');
    collected.push(...values);
    if (pageIsComplete(field, values, collected, expectedTotal)) return collected;
    if (pageIsAmbiguous(field, values, collected, expectedTotal)) {
      throw new Error('GitHub API pagination is ambiguous.');
    }
  }

  throw new Error('GitHub API pagination exceeded the bounded limit.');
}

async function resolveFromGitHub({ env, fetchJson }) {
  const common = {
    currentSha: env.GITHUB_SHA,
    eventName: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    repository: env.GITHUB_REPOSITORY,
  };
  if (common.eventName !== 'push' || common.ref !== 'refs/heads/test') {
    return evaluateTreeReuse(common);
  }
  if (typeof env.GITHUB_TOKEN !== 'string' || env.GITHUB_TOKEN.length === 0) {
    return blankResult('token-unavailable');
  }

  const requestJson = (url) =>
    fetchJson(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  const repoPath = `/repos/${common.repository}`;
  const pullRequests = await collectPages({
    field: null,
    path: `${repoPath}/commits/${common.currentSha}/pulls`,
    requestJson,
  });
  if (
    pullRequests.length !== 1 ||
    !isObject(pullRequests[0]) ||
    !isPositiveId(pullRequests[0].number)
  ) {
    return evaluateTreeReuse({ ...common, pullRequests });
  }

  const pullRequest = requireObject(
    await requestJson(`${API_ROOT}${repoPath}/pulls/${pullRequests[0].number}`),
  );
  const currentCommit = requireObject(
    await requestJson(`${API_ROOT}${repoPath}/commits/${common.currentSha}`),
  );
  if (!isSha(pullRequest.base?.sha) || !isSha(pullRequest.head?.sha)) {
    return evaluateTreeReuse({ ...common, currentCommit, pullRequest, pullRequests });
  }
  const headCommit = requireObject(
    await requestJson(`${API_ROOT}${repoPath}/commits/${pullRequest.head.sha}`),
  );
  const compare = requireObject(
    await requestJson(
      `${API_ROOT}${repoPath}/compare/${pullRequest.base.sha}...${common.currentSha}`,
    ),
  );
  const checkRuns = await collectPages({
    field: 'check_runs',
    path: `${repoPath}/commits/${pullRequest.head.sha}/check-runs`,
    requestJson,
  });

  const sonarChecks = checkRuns.filter((check) => check?.name === 'SonarQube quality gate');
  const runId =
    sonarChecks.length === 1 ? actionRunId(sonarChecks[0].details_url, common.repository) : null;
  let securityRun = null;
  let artifacts = [];
  if (runId !== null) {
    securityRun = requireObject(await requestJson(`${API_ROOT}${repoPath}/actions/runs/${runId}`));
    artifacts = await collectPages({
      field: 'artifacts',
      path: `${repoPath}/actions/runs/${runId}/artifacts`,
      requestJson,
    });
  }

  return evaluateTreeReuse({
    ...common,
    artifacts,
    checkRuns,
    compare,
    currentCommit,
    headCommit,
    pullRequest,
    pullRequests,
    securityRun,
  });
}

const safeEligibleResult = (result) =>
  result.eligible === true &&
  isPositiveId(result.pullRequest) &&
  isSha(result.headSha) &&
  isSha(result.headTree) &&
  /^[1-9]\d*$/u.test(result.securityRunId) &&
  ARTIFACT_PATTERN.test(result.coverageArtifact);

async function writeOutputs(outputPath, result, reuse) {
  const reason = /^[a-z][a-z0-9-]*$/u.test(result.reason) ? result.reason : 'api-failure';
  const lines = [
    `eligible=${result.eligible === true ? 'true' : 'false'}`,
    `reason=${reason}`,
    `reuse=${reuse ? 'true' : 'false'}`,
  ];
  if (result.eligible === true) {
    lines.push(
      `pull-request=${result.pullRequest}`,
      `head-sha=${result.headSha}`,
      `head-tree=${result.headTree}`,
      `security-run-id=${result.securityRunId}`,
      `coverage-artifact=${result.coverageArtifact}`,
    );
  }
  await appendFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

export async function runCiTreeReuse({ env = process.env, fetchJson = defaultFetchJson } = {}) {
  let result;
  try {
    result = await resolveFromGitHub({ env, fetchJson });
  } catch {
    result = blankResult('api-failure');
  }
  if (result.eligible === true && !safeEligibleResult(result)) {
    result = blankResult('api-failure');
  }
  const reuse = result.eligible === true && env.RELAY_CI_TREE_REUSE_MODE === 'enabled';
  await writeOutputs(env.GITHUB_OUTPUT, result, reuse);
  return { ...result, reuse };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCiTreeReuse().catch(() => {
    process.stderr.write('CI tree reuse resolver failed.\n');
    process.exitCode = 1;
  });
}
