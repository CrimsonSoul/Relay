import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const ARTIFACT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const BUILD_ARTIFACT_PREFIX = 'relay-pr-provenance';
const COVERAGE_ARTIFACT_PREFIX = 'relay-merged-lcov';
const BUILD_WORKFLOW_PATH = '.github/workflows/build.yml';
const SECURITY_WORKFLOW_PATH = '.github/workflows/security.yml';
const REQUIRED_CHECKS = ['Build quality gate', 'SonarQube quality gate', 'Snyk security gate'];
const MAX_COMPARE_COMMITS = 300;

const blankResult = (reason) => ({
  baseSha: '',
  buildArtifact: '',
  buildRunId: '',
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
const isSafeRef = (value) =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= 255 &&
  [...value].every((character) => {
    const code = character.codePointAt(0);
    return code >= 32 && code !== 127;
  });

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
  const [owner, repository] = input.repository.split('/');
  if (owner === '.' || owner === '..' || repository === '.' || repository === '..') {
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
  const headRef = pullRequest.head?.ref;
  if (!isSha(baseSha)) return { reason: 'base-sha-invalid' };
  if (!isSha(headSha)) return { reason: 'head-sha-invalid' };
  if (!isSafeRef(headRef)) return { reason: 'head-ref-invalid' };
  return { baseSha, headRef, headSha, pullRequest, reason: null };
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

function validateCompare(input, baseSha, headSha) {
  const compare = input.compare;
  const commits = compare?.commits;
  if (
    !isObject(compare) ||
    compare.status !== 'ahead' ||
    !Number.isSafeInteger(compare.ahead_by) ||
    compare.ahead_by <= 0 ||
    compare.ahead_by > MAX_COMPARE_COMMITS ||
    compare.behind_by !== 0 ||
    compare.total_commits !== compare.ahead_by ||
    compare.base_commit?.sha !== baseSha ||
    compare.merge_base_commit?.sha !== baseSha ||
    !Array.isArray(commits) ||
    commits.length !== compare.total_commits ||
    commits.some((commit) => !isSha(commit?.sha)) ||
    new Set(commits.map((commit) => commit.sha)).size !== commits.length ||
    commits.at(-1)?.sha !== headSha
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

function validateWorkflowRun(input, pullRequest, run, runId, workflowPath) {
  return (
    runId !== null &&
    isObject(run) &&
    isPositiveId(run.id) &&
    run.id === runId &&
    run.repository?.full_name === input.repository &&
    run.head_repository?.full_name === input.repository &&
    run.head_sha === pullRequest.headSha &&
    run.head_branch === pullRequest.headRef &&
    run.event === 'pull_request' &&
    run.path === workflowPath &&
    run.status === 'completed' &&
    run.conclusion === 'success'
  );
}

function attestationName(prefix, pullRequest) {
  const name = `${prefix}-${pullRequest.pullRequest.number}-${pullRequest.baseSha}-${pullRequest.headSha}`;
  return ARTIFACT_PATTERN.test(name) ? name : null;
}

function artifactEvidence(artifactsInput, expectedName, runId, reason) {
  if (!Array.isArray(artifactsInput) || expectedName === null) return { reason };
  const artifacts = artifactsInput.filter((artifact) => artifact?.name === expectedName);
  if (artifacts.length !== 1) return { reason };
  const artifact = artifacts[0];
  if (
    !isPositiveId(artifact.id) ||
    artifact.expired !== false ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes <= 0 ||
    artifact.workflow_run?.id !== runId ||
    !ARTIFACT_PATTERN.test(artifact.name)
  ) {
    return { reason };
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
  const compareReason = validateCompare(input, pullRequest.baseSha, pullRequest.headSha);
  if (compareReason !== null) return blankResult(compareReason);
  const headTree = headTreeEvidence(input, pullRequest.headSha);
  if (headTree.reason !== null) return blankResult(headTree.reason);
  const checks = requiredCheckEvidence(input.checkRuns, pullRequest.headSha);
  if (checks.reason !== null) return blankResult(checks.reason);
  const buildRunId = actionRunId(
    checks.required.get('Build quality gate')?.details_url,
    input.repository,
  );
  if (!validateWorkflowRun(input, pullRequest, input.buildRun, buildRunId, BUILD_WORKFLOW_PATH)) {
    return blankResult('build-run-mismatch');
  }
  const buildAttestation = artifactEvidence(
    input.buildArtifacts,
    attestationName(BUILD_ARTIFACT_PREFIX, pullRequest),
    input.buildRun.id,
    'build-attestation-unavailable',
  );
  if (buildAttestation.reason !== null) return blankResult(buildAttestation.reason);

  const sonarRunId = actionRunId(
    checks.required.get('SonarQube quality gate')?.details_url,
    input.repository,
  );
  const snykRunId = actionRunId(
    checks.required.get('Snyk security gate')?.details_url,
    input.repository,
  );
  if (
    sonarRunId !== snykRunId ||
    !validateWorkflowRun(input, pullRequest, input.securityRun, sonarRunId, SECURITY_WORKFLOW_PATH)
  ) {
    return blankResult('security-run-mismatch');
  }
  const coverage = artifactEvidence(
    input.artifacts,
    attestationName(COVERAGE_ARTIFACT_PREFIX, pullRequest),
    input.securityRun.id,
    'coverage-artifact-unavailable',
  );
  if (coverage.reason !== null) return blankResult(coverage.reason);

  return {
    baseSha: pullRequest.baseSha,
    buildArtifact: buildAttestation.artifact.name,
    buildRunId: String(input.buildRun.id),
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
const GITHUB_API_PATH_PATTERNS = [
  /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/commits\/[0-9a-f]{40}(?:\/pulls|\/check-runs)?$/u,
  /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pulls\/[1-9]\d*$/u,
  /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/compare\/[0-9a-f]{40}\.\.\.[0-9a-f]{40}$/u,
  /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9]\d*(?:\/artifacts)?$/u,
];

export function validateGitHubApiUrl(value) {
  if (typeof value !== 'string') throw new Error('GitHub API URL is invalid.');
  const candidate = new URL(value);
  const page = candidate.searchParams.get('page');
  const paginated =
    candidate.searchParams.size === 2 &&
    candidate.searchParams.get('per_page') === String(PAGE_SIZE) &&
    typeof page === 'string' &&
    /^[1-3]$/u.test(page);
  if (
    candidate.origin !== API_ROOT ||
    candidate.username !== '' ||
    candidate.password !== '' ||
    candidate.hash !== '' ||
    !GITHUB_API_PATH_PATTERNS.some((pattern) => pattern.test(candidate.pathname)) ||
    (candidate.search !== '' && !paginated)
  ) {
    throw new Error('GitHub API URL is invalid.');
  }
  return candidate.href;
}

async function defaultFetchJson(url, options) {
  const response = await fetch(validateGitHubApiUrl(url), options);
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

const compareIdentity = (compare) => ({
  ahead_by: compare.ahead_by,
  baseSha: compare.base_commit?.sha,
  behind_by: compare.behind_by,
  mergeBaseSha: compare.merge_base_commit?.sha,
  status: compare.status,
  total_commits: compare.total_commits,
});

function parseComparePage(response, identity) {
  const compare = requireObject(response);
  if (
    !Array.isArray(compare.commits) ||
    compare.commits.length > PAGE_SIZE ||
    !Number.isSafeInteger(compare.total_commits) ||
    compare.total_commits <= 0 ||
    compare.total_commits > MAX_COMPARE_COMMITS
  ) {
    throw new Error('GitHub compare response schema mismatch.');
  }
  const currentIdentity = compareIdentity(compare);
  if (identity !== null && JSON.stringify(currentIdentity) !== JSON.stringify(identity)) {
    throw new Error('GitHub compare pagination is ambiguous.');
  }
  return { compare, identity: currentIdentity };
}

async function collectCompare({ requestJson, path }) {
  const commits = [];
  let firstPage = null;
  let identity = null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(`${API_ROOT}${path}`);
    url.searchParams.set('per_page', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));
    const parsed = parseComparePage(await requestJson(url.href), identity);
    firstPage ??= parsed.compare;
    identity = parsed.identity;
    commits.push(...parsed.compare.commits);

    if (commits.length === identity.total_commits) return { ...firstPage, commits };
    if (parsed.compare.commits.length === 0 || commits.length > identity.total_commits) {
      throw new Error('GitHub compare pagination is ambiguous.');
    }
  }

  throw new Error('GitHub compare pagination exceeded the bounded limit.');
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
  const requestReason = validateRequest(common);
  if (requestReason !== null) return blankResult(requestReason);
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
  const [owner, repository] = common.repository.split('/');
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  const pullRequests = await collectPages({
    field: null,
    path: `${repoPath}/commits/${encodeURIComponent(common.currentSha)}/pulls`,
    requestJson,
  });
  const pullRequestNumber = pullRequests[0]?.number;
  if (
    pullRequests.length !== 1 ||
    !isObject(pullRequests[0]) ||
    !Number.isSafeInteger(pullRequestNumber) ||
    pullRequestNumber <= 0
  ) {
    return evaluateTreeReuse({ ...common, pullRequests });
  }

  const pullRequest = requireObject(
    await requestJson(`${API_ROOT}${repoPath}/pulls/${pullRequestNumber}`),
  );
  const currentCommit = requireObject(
    await requestJson(`${API_ROOT}${repoPath}/commits/${encodeURIComponent(common.currentSha)}`),
  );
  const pullRequestBaseSha = pullRequest.base?.sha;
  const pullRequestHeadSha = pullRequest.head?.sha;
  if (
    typeof pullRequestBaseSha !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(pullRequestBaseSha) ||
    typeof pullRequestHeadSha !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(pullRequestHeadSha)
  ) {
    return evaluateTreeReuse({ ...common, currentCommit, pullRequest, pullRequests });
  }
  const headCommit = requireObject(
    await requestJson(`${API_ROOT}${repoPath}/commits/${encodeURIComponent(pullRequestHeadSha)}`),
  );
  const compare = await collectCompare({
    path: `${repoPath}/compare/${encodeURIComponent(pullRequestBaseSha)}...${encodeURIComponent(pullRequestHeadSha)}`,
    requestJson,
  });
  const checkRuns = await collectPages({
    field: 'check_runs',
    path: `${repoPath}/commits/${encodeURIComponent(pullRequestHeadSha)}/check-runs`,
    requestJson,
  });

  const checkRunId = (name) => {
    const checks = checkRuns.filter((check) => check?.name === name);
    return checks.length === 1 ? actionRunId(checks[0].details_url, common.repository) : null;
  };
  const buildRunId = checkRunId('Build quality gate');
  let buildRun = null;
  let buildArtifacts = [];
  if (Number.isSafeInteger(buildRunId) && buildRunId > 0) {
    buildRun = requireObject(
      await requestJson(
        `${API_ROOT}${repoPath}/actions/runs/${encodeURIComponent(String(buildRunId))}`,
      ),
    );
    buildArtifacts = await collectPages({
      field: 'artifacts',
      path: `${repoPath}/actions/runs/${encodeURIComponent(String(buildRunId))}/artifacts`,
      requestJson,
    });
  }

  const securityRunId = checkRunId('SonarQube quality gate');
  let securityRun = null;
  let artifacts = [];
  if (Number.isSafeInteger(securityRunId) && securityRunId > 0) {
    securityRun = requireObject(
      await requestJson(
        `${API_ROOT}${repoPath}/actions/runs/${encodeURIComponent(String(securityRunId))}`,
      ),
    );
    artifacts = await collectPages({
      field: 'artifacts',
      path: `${repoPath}/actions/runs/${encodeURIComponent(String(securityRunId))}/artifacts`,
      requestJson,
    });
  }

  return evaluateTreeReuse({
    ...common,
    artifacts,
    buildArtifacts,
    buildRun,
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
  isSha(result.baseSha) &&
  isSha(result.headSha) &&
  isSha(result.headTree) &&
  /^[1-9]\d*$/u.test(result.buildRunId) &&
  ARTIFACT_PATTERN.test(result.buildArtifact) &&
  /^[1-9]\d*$/u.test(result.securityRunId) &&
  ARTIFACT_PATTERN.test(result.coverageArtifact);

async function writeOutputs(outputPath, result) {
  const reason = /^[a-z][a-z0-9-]*$/u.test(result.reason) ? result.reason : 'api-failure';
  const lines = [
    `metadata-eligible=${result.eligible === true ? 'true' : 'false'}`,
    `metadata-reason=${reason}`,
  ];
  if (result.eligible === true) {
    lines.push(
      `pull-request=${result.pullRequest}`,
      `base-sha=${result.baseSha}`,
      `head-sha=${result.headSha}`,
      `head-tree=${result.headTree}`,
      `build-run-id=${result.buildRunId}`,
      `build-artifact=${result.buildArtifact}`,
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
  await writeOutputs(env.GITHUB_OUTPUT, result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runCiTreeReuse();
  } catch {
    process.stderr.write('CI tree reuse resolver failed.\n');
    process.exitCode = 1;
  }
}
