import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { classifyHttpFailure, findingError, unavailableError } from './scanner-gate-policy.mjs';
import { normalizeSonarIssueStatus } from './sonar-issue-status.mjs';

const EXPECTED_PROJECT_KEY = 'CrimsonSoul_Relay';
const EXPECTED_BRANCH = 'test';
const PAGE_SIZE = 500;
const MAX_ISSUES = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 1_080_000;
const SEARCHED_STATUSES = ['OPEN', 'CONFIRMED', 'ACCEPTED', 'FALSE_POSITIVE'];
const OPEN_STATUSES = new Set(['OPEN', 'CONFIRMED']);
const REVIEWED_STATUS_BY_TRANSITION = Object.freeze({
  accept: 'ACCEPTED',
  falsepositive: 'FALSE_POSITIVE',
});
const REVIEW_COMMENT_BY_RULE = Object.freeze({
  'Web:S6819':
    'Relay reviewed exception: role=status is the W3C live-region pattern for startup progress; output would imply a calculation result.',
  'css:S7924':
    'Relay reviewed exception: browser-computed contrast passes the supported palette matrix.',
  'tssecurity:S5144':
    'Relay reviewed exception: shell.openExternal delegates to the OS after protocol, host, credential, and port allowlisting; Relay performs no server-side request.',
  'typescript:S5976':
    'Relay reviewed exception: these tests retain distinct setup, behavior, and diagnostics.',
  'typescript:S6478':
    'Relay reviewed exception: this function is an ErrorBoundary render callback, not a nested React component.',
  'typescript:S6819':
    'Relay reviewed exception: the explicit ARIA pattern preserves required interaction semantics.',
  'typescript:S7758':
    'Relay reviewed exception: UTF-16 hashing is a persisted compatibility contract.',
  'typescript:S7785':
    'Relay reviewed exception: the explicit async runner prevents a confirmed Electron ESM app.whenReady deadlock on macOS 26.',
  'typescript:S8980':
    'Relay reviewed exception: direct hook state transitions require React act().',
});
const monotonicNow = () => performance.now();

function reviewedIssue(key, rule, path, transition) {
  return Object.freeze({
    key,
    rule,
    component: `${EXPECTED_PROJECT_KEY}:${path}`,
    transition,
  });
}

export const REVIEWED_ISSUES = Object.freeze([
  // Compatibility-sensitive UTF-16 hashes.
  reviewedIssue(
    'AZ-alMNnTAUVQ8sYgogo',
    'typescript:S7758',
    'src/renderer/src/stores/collectionStore.ts',
    'falsepositive',
  ),
  reviewedIssue(
    'AZ7H_5Gegw1m044Cse53',
    'typescript:S7758',
    'src/renderer/src/utils/ics.ts',
    'falsepositive',
  ),

  // Browser-measured contrast false positives.
  reviewedIssue(
    'AZ-alM3UTAUVQ8sYgoim',
    'css:S7924',
    'src/renderer/src/styles/components.css',
    'falsepositive',
  ),
  reviewedIssue(
    'AZ-alM3UTAUVQ8sYgoin',
    'css:S7924',
    'src/renderer/src/styles/components.css',
    'falsepositive',
  ),
  reviewedIssue(
    'AZ-alM3UTAUVQ8sYgoio',
    'css:S7924',
    'src/renderer/src/styles/components.css',
    'falsepositive',
  ),

  // shell.openExternal delegates an allowlisted URL to the OS; it is not an SSRF sink.
  reviewedIssue(
    'AZ-gb17s7Nsapz3kouHt',
    'tssecurity:S5144',
    'src/main/handlers/windowHandlers.ts',
    'falsepositive',
  ),

  // Electron ESM startup must finish module evaluation before awaiting app readiness.
  reviewedIssue('AZ-gb19K7Nsapz3kouHu', 'typescript:S7785', 'src/main/index.ts', 'accept'),

  // ErrorBoundary invokes this as a render callback, not as a nested React component.
  reviewedIssue(
    'AZ-alMTTTAUVQ8sYgog2',
    'typescript:S6478',
    'src/renderer/src/features/knowledge/KnowledgeWorkspace.tsx',
    'accept',
  ),

  // Explicit ARIA patterns whose native substitutions would weaken behavior.
  reviewedIssue('AZ-alM5ATAUVQ8sYgoiw', 'Web:S6819', 'src/renderer/index.html', 'accept'),
  reviewedIssue(
    'AZytnJJ1sZaVqOVfTofc',
    'typescript:S6819',
    'src/renderer/src/components/HeaderSearch.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMJcTAUVQ8sYgogf',
    'typescript:S6819',
    'src/renderer/src/components/ConnectionManager.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMI8TAUVQ8sYgogc',
    'typescript:S6819',
    'src/renderer/src/components/SettingsModal.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMAkTAUVQ8sYgogB',
    'typescript:S6819',
    'src/renderer/src/components/settings/administration/RelayServerPanel.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMBCTAUVQ8sYgogD',
    'typescript:S6819',
    'src/renderer/src/components/settings/administration/RoleAccountsPanel.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMVhTAUVQ8sYgohB',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgeLibrary.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMXRTAUVQ8sYgohM',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMXRTAUVQ8sYgohQ',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMWYTAUVQ8sYgohI',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgePassageResultList.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMWYTAUVQ8sYgohJ',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgePassageResultList.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMWYTAUVQ8sYgohK',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgePassageResultList.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMWATAUVQ8sYgohH',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMTuTAUVQ8sYgog3',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgeTab.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMfrTAUVQ8sYgohp',
    'typescript:S6819',
    'src/renderer/src/tabs/CloudStatusTab.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMfrTAUVQ8sYgohq',
    'typescript:S6819',
    'src/renderer/src/tabs/CloudStatusTab.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMfrTAUVQ8sYgohy',
    'typescript:S6819',
    'src/renderer/src/tabs/CloudStatusTab.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMkRTAUVQ8sYgoh-',
    'typescript:S6819',
    'src/renderer/src/tabs/DynatraceProblemsTab.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMGbTAUVQ8sYgogX',
    'typescript:S6819',
    'src/renderer/src/components/oncall/OnCallDisplayControl.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMBCTAUVQ8sYgogC',
    'typescript:S6819',
    'src/renderer/src/components/settings/administration/RoleAccountsPanel.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMVGTAUVQ8sYgog_',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgeCategoryManager.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMWATAUVQ8sYgohE',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMWATAUVQ8sYgohF',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMULTAUVQ8sYgog6',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgeTree.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMULTAUVQ8sYgog7',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgeTree.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMkRTAUVQ8sYgoh9',
    'typescript:S6819',
    'src/renderer/src/tabs/DynatraceProblemsTab.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMLQTAUVQ8sYgogj',
    'typescript:S6819',
    'src/renderer/src/components/WebReauthenticationOverlay.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMXRTAUVQ8sYgohV',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMWATAUVQ8sYgohG',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMFHTAUVQ8sYgogS',
    'typescript:S6819',
    'src/renderer/src/components/HeaderSearch.tsx',
    'accept',
  ),

  // Tests intentionally kept independent or requiring a direct-hook act().
  reviewedIssue(
    'AZ-alLj7TAUVQ8sYgoeM',
    'typescript:S5976',
    'src/main/handlers/windowHandlers.test.ts',
    'accept',
  ),
  reviewedIssue(
    'AZ-alLj7TAUVQ8sYgoeN',
    'typescript:S5976',
    'src/main/handlers/windowHandlers.test.ts',
    'accept',
  ),
  reviewedIssue(
    'AZ-alLj7TAUVQ8sYgoeO',
    'typescript:S5976',
    'src/main/handlers/windowHandlers.test.ts',
    'accept',
  ),
  reviewedIssue(
    'AZ-alLj7TAUVQ8sYgoeP',
    'typescript:S5976',
    'src/main/handlers/windowHandlers.test.ts',
    'accept',
  ),
  reviewedIssue(
    'AZ-alLfyTAUVQ8sYgoeB',
    'typescript:S5976',
    'src/main/utils/pathValidation.test.ts',
    'accept',
  ),
  reviewedIssue(
    'AZ-alL6XTAUVQ8sYgofT',
    'typescript:S5976',
    'src/renderer/src/components/__tests__/SetupScreen.test.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMlJTAUVQ8sYgoh_',
    'typescript:S5976',
    'src/renderer/src/hooks/__tests__/useCollection.test.ts',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMaFTAUVQ8sYgohd',
    'typescript:S5976',
    'src/renderer/src/tabs/__tests__/AlertForm.test.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMaFTAUVQ8sYgohe',
    'typescript:S5976',
    'src/renderer/src/tabs/__tests__/AlertForm.test.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMc4TAUVQ8sYgohk',
    'typescript:S5976',
    'src/renderer/src/tabs/__tests__/AlertsTab.test.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMl2TAUVQ8sYgoiA',
    'typescript:S8980',
    'src/renderer/src/hooks/__tests__/useAssembler.test.ts',
    'accept',
  ),
]);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function boundedString(value, maximumLength = 1_024) {
  return nonEmptyString(value) && value.length <= maximumLength;
}

export function parseProjectKey(properties) {
  if (typeof properties !== 'string') {
    throw new TypeError('sonar-project.properties must be readable text.');
  }
  const matches = properties
    .split(/\r?\n/u)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return '';
      const separator = trimmed.indexOf('=');
      if (separator < 0 || trimmed.slice(0, separator).trim() !== 'sonar.projectKey') return '';
      return trimmed.slice(separator + 1).trim();
    })
    .filter(Boolean);
  if (matches.length !== 1) {
    throw new Error('sonar-project.properties must define exactly one sonar.projectKey.');
  }
  return matches[0];
}

function branchArgumentValue(argv, index) {
  const argument = argv[index];
  if (argument.startsWith('--branch=')) {
    return { consumed: 1, value: argument.slice('--branch='.length) };
  }
  if (argument === '--branch') {
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.startsWith('--')) {
      throw new Error('Missing value for --branch.');
    }
    return { consumed: 2, value };
  }
  throw new Error(`Unknown argument: ${argument}`);
}

export function parseReviewedArgs(argv) {
  let branch;
  let apply = false;
  for (let index = 0; index < argv.length;) {
    if (argv[index] === '--apply') {
      if (apply) throw new Error('Duplicate --apply argument.');
      apply = true;
      index += 1;
      continue;
    }
    const parsed = branchArgumentValue(argv, index);
    if (branch !== undefined) throw new Error('Duplicate --branch argument.');
    branch = parsed.value;
    index += parsed.consumed;
  }
  if (branch !== EXPECTED_BRANCH) {
    throw new Error('Reviewed Sonar issue reconciliation is restricted to branch test.');
  }
  if (!apply) {
    throw new Error('Reviewed Sonar issue reconciliation requires the explicit --apply latch.');
  }
  return { apply: true, branch: EXPECTED_BRANCH };
}

function sonarApiBase(hostUrl) {
  let base;
  try {
    base = new URL(hostUrl);
  } catch {
    throw new Error('SONAR_HOST_URL must be a valid HTTPS URL.');
  }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('SONAR_HOST_URL must be a credential-free HTTPS base URL.');
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return base;
}

export function validateReviewedIssueManifest(reviewedIssues = REVIEWED_ISSUES) {
  if (!Array.isArray(reviewedIssues) || reviewedIssues.length !== 49) {
    throw new Error('The reviewed Sonar issue manifest must contain exactly 49 issues.');
  }
  const keys = new Set();
  const counts = { accept: 0, falsepositive: 0 };
  for (const issue of reviewedIssues) {
    if (
      issue === null ||
      typeof issue !== 'object' ||
      Array.isArray(issue) ||
      !boundedString(issue.key, 128) ||
      !boundedString(issue.rule, 128) ||
      !boundedString(issue.component) ||
      !Object.hasOwn(REVIEWED_STATUS_BY_TRANSITION, issue.transition)
    ) {
      throw new Error('The reviewed Sonar issue manifest contains invalid metadata.');
    }
    if (keys.has(issue.key)) {
      throw new Error(`The reviewed Sonar issue manifest repeats key ${issue.key}.`);
    }
    if (!issue.component.startsWith(`${EXPECTED_PROJECT_KEY}:`)) {
      throw new Error(`Reviewed Sonar issue ${issue.key} belongs to an unexpected project.`);
    }
    keys.add(issue.key);
    counts[issue.transition] += 1;
  }
  if (counts.accept !== 43 || counts.falsepositive !== 6) {
    throw new Error(
      'The reviewed Sonar issue manifest must contain 43 accepts and 6 false positives.',
    );
  }
  return reviewedIssues;
}

function validateIssue(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !boundedString(value.key, 128) ||
    !boundedString(value.rule, 128) ||
    !boundedString(value.component) ||
    !nonEmptyString(value.status) ||
    (value.issueStatus !== undefined &&
      value.issueStatus !== null &&
      typeof value.issueStatus !== 'string') ||
    (value.resolution !== undefined &&
      value.resolution !== null &&
      typeof value.resolution !== 'string')
  ) {
    throw new Error('Sonar returned invalid issue metadata.');
  }
  const status = normalizeSonarIssueStatus(value);
  if (!SEARCHED_STATUSES.includes(status)) {
    throw new Error(`Sonar returned unsupported status for issue ${value.key}.`);
  }
  return {
    key: value.key,
    rule: value.rule,
    component: value.component,
    status,
  };
}

function validatePage(value, expectedPage) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Array.isArray(value.issues) ||
    value.paging === null ||
    typeof value.paging !== 'object' ||
    Array.isArray(value.paging)
  ) {
    throw new Error('Sonar returned an invalid issue response.');
  }
  const { pageIndex, pageSize, total } = value.paging;
  if (
    !Number.isSafeInteger(pageIndex) ||
    pageIndex !== expectedPage ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > PAGE_SIZE ||
    !Number.isSafeInteger(total) ||
    total < 0 ||
    total > MAX_ISSUES
  ) {
    throw new Error('Sonar returned invalid issue pagination.');
  }
  return {
    issues: value.issues.map(validateIssue),
    total,
  };
}

function issueSearchUrl(base, projectKey, page) {
  const url = new URL('api/issues/search', base);
  url.searchParams.set('componentKeys', projectKey);
  url.searchParams.set('issueStatuses', SEARCHED_STATUSES.join(','));
  url.searchParams.set('branch', EXPECTED_BRANCH);
  url.searchParams.set('p', String(page));
  url.searchParams.set('ps', String(PAGE_SIZE));
  return url;
}

function validateRequestTimeout(requestTimeoutMs) {
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw new Error('Sonar request timeout must be between 1 and 60000 milliseconds.');
  }
}

function validateTiming(timeoutMs, now) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error('Sonar reconciliation timeout must be between 1 and 1080000 milliseconds.');
  }
  if (typeof now !== 'function') throw new TypeError('Sonar timing function is required.');
}

function remainingTime(deadline, now, operation) {
  const remaining = Math.floor(deadline - now());
  if (remaining <= 0) throw unavailableError(`${operation} exceeded its deadline.`);
  return remaining;
}

async function fetchJson(fetcher, url, options, operation, requestTimeoutMs) {
  let response;
  try {
    response = await fetcher(url, {
      ...options,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    throw unavailableError(`${operation} failed before receiving a response.`, {
      cause: error,
    });
  }
  if (!response?.ok) {
    throw classifyHttpFailure(operation, response?.status);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${operation} returned invalid JSON.`);
  }
  return payload;
}

export async function fetchCurrentSonarIssues({
  fetcher = globalThis.fetch,
  hostUrl,
  projectKey,
  token,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = monotonicNow,
}) {
  if (typeof fetcher !== 'function') throw new Error('A Fetch implementation is required.');
  if (projectKey !== EXPECTED_PROJECT_KEY) {
    throw new Error('sonar.projectKey does not match the reviewed Sonar issue manifest.');
  }
  if (!nonEmptyString(token)) throw new Error('SONAR_TOKEN is required.');
  validateRequestTimeout(requestTimeoutMs);
  validateTiming(timeoutMs, now);
  const base = sonarApiBase(hostUrl);
  const issues = [];
  const seen = new Set();
  let page = 1;
  let expectedTotal;
  const deadline = now() + timeoutMs;

  do {
    const remaining = remainingTime(deadline, now, 'Sonar issue search');
    const payload = await fetchJson(
      fetcher,
      issueSearchUrl(base, projectKey, page),
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
      'Sonar issue search',
      Math.min(requestTimeoutMs, remaining),
    );
    const validated = validatePage(payload, page);
    expectedTotal ??= validated.total;
    if (validated.total !== expectedTotal) {
      throw new Error('Sonar pagination total changed while issues were being read.');
    }
    for (const issue of validated.issues) {
      if (seen.has(issue.key)) {
        throw new Error(`Sonar returned duplicate issue key ${issue.key}.`);
      }
      seen.add(issue.key);
      issues.push(issue);
    }
    if (issues.length < expectedTotal && validated.issues.length === 0) {
      throw new Error('Sonar pagination ended before all issues were returned.');
    }
    page += 1;
  } while (issues.length < expectedTotal);

  if (issues.length !== expectedTotal) {
    throw new Error(
      `Sonar pagination returned ${issues.length} issues for a total of ${expectedTotal}.`,
    );
  }
  return issues;
}

function assertIssueMetadata(issue, expected) {
  if (issue.rule !== expected.rule) {
    throw new Error(`Reviewed Sonar issue ${issue.key} no longer matches its expected rule.`);
  }
  if (issue.component !== expected.component) {
    throw new Error(`Reviewed Sonar issue ${issue.key} no longer matches its expected component.`);
  }
}

function reviewComment(expected) {
  const comment = REVIEW_COMMENT_BY_RULE[expected.rule];
  if (!comment) {
    throw new Error(`Reviewed Sonar issue ${expected.key} has no audit rationale.`);
  }
  return comment;
}

function unexpectedIssueMessage(issues) {
  const keys = issues
    .map((issue) => issue.key)
    .sort((left, right) => left.localeCompare(right, 'en'));
  const visible = keys.slice(0, 20).join(', ');
  const remainder = keys.length > 20 ? ` and ${keys.length - 20} more` : '';
  return `Sonar returned unreviewed open or confirmed issues: ${visible}${remainder}.`;
}

function collectUnreviewedIssue(issue, state) {
  if (OPEN_STATUSES.has(issue.status)) state.unexpectedOpen.push(issue);
  else state.ignoredReviewed.push(issue.key);
}

function collectExpectedIssue(issue, expected, state) {
  if (state.observedReviewedKeys.has(issue.key)) {
    throw new Error(`Sonar returned duplicate issue key ${issue.key}.`);
  }
  state.observedReviewedKeys.add(issue.key);
  assertIssueMetadata(issue, expected);
  if (OPEN_STATUSES.has(issue.status)) {
    state.transitions.push({
      key: issue.key,
      transition: expected.transition,
      comment: reviewComment(expected),
    });
    return;
  }

  const expectedStatus = REVIEWED_STATUS_BY_TRANSITION[expected.transition];
  if (issue.status !== expectedStatus) {
    throw new Error(`Reviewed Sonar issue ${issue.key} has an unexpected reviewed status.`);
  }
  state.alreadyReviewed.push(issue.key);
}

function collectObservedIssue(issueValue, expectedByKey, state) {
  const issue = validateIssue(issueValue);
  const expected = expectedByKey.get(issue.key);
  if (expected) collectExpectedIssue(issue, expected, state);
  else collectUnreviewedIssue(issue, state);
}

function sortByIssueKey(values) {
  values.sort((left, right) => {
    const leftKey = typeof left === 'string' ? left : left.key;
    const rightKey = typeof right === 'string' ? right : right.key;
    return leftKey.localeCompare(rightKey, 'en');
  });
}

export function planReviewedIssueReconciliation(issues, reviewedIssues = REVIEWED_ISSUES) {
  validateReviewedIssueManifest(reviewedIssues);
  if (!Array.isArray(issues)) throw new Error('Sonar issues must be an array.');
  const expectedByKey = new Map(reviewedIssues.map((issue) => [issue.key, issue]));
  const state = {
    observedReviewedKeys: new Set(),
    transitions: [],
    alreadyReviewed: [],
    ignoredReviewed: [],
    unexpectedOpen: [],
  };

  for (const issueValue of issues) {
    collectObservedIssue(issueValue, expectedByKey, state);
  }

  if (state.unexpectedOpen.length > 0) {
    throw findingError(unexpectedIssueMessage(state.unexpectedOpen));
  }

  const fixedOrMissing = reviewedIssues
    .filter((issue) => !state.observedReviewedKeys.has(issue.key))
    .map((issue) => issue.key);
  for (const values of [
    state.transitions,
    state.alreadyReviewed,
    fixedOrMissing,
    state.ignoredReviewed,
  ]) {
    sortByIssueKey(values);
  }
  return {
    transitions: state.transitions,
    alreadyReviewed: state.alreadyReviewed,
    fixedOrMissing,
    ignoredReviewed: state.ignoredReviewed,
  };
}

async function applyTransition(fetcher, base, token, item, requestTimeoutMs) {
  const url = new URL('api/issues/do_transition', base);
  const body = new URLSearchParams({
    comment: item.comment,
    issue: item.key,
    transition: item.transition,
  });
  let response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    throw unavailableError(`Sonar transition failed for reviewed issue ${item.key}.`, {
      cause: error,
    });
  }
  if (!response?.ok) {
    throw classifyHttpFailure(`Sonar transition for reviewed issue ${item.key}`, response?.status);
  }
}

export async function reconcileReviewedSonarIssues({
  fetcher = globalThis.fetch,
  hostUrl,
  projectKey,
  token,
  reviewedIssues = REVIEWED_ISSUES,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = monotonicNow,
}) {
  validateRequestTimeout(requestTimeoutMs);
  validateTiming(timeoutMs, now);
  const base = sonarApiBase(hostUrl);
  const deadline = now() + timeoutMs;
  const searchTimeoutMs = remainingTime(deadline, now, 'Sonar reviewed-issue reconciliation');
  const issues = await fetchCurrentSonarIssues({
    fetcher,
    hostUrl: base,
    projectKey,
    token,
    requestTimeoutMs,
    timeoutMs: searchTimeoutMs,
    now,
  });
  const plan = planReviewedIssueReconciliation(issues, reviewedIssues);
  const transitioned = [];
  for (const item of plan.transitions) {
    const remaining = remainingTime(deadline, now, 'Sonar reviewed-issue reconciliation');
    await applyTransition(fetcher, base, token, item, Math.min(requestTimeoutMs, remaining));
    transitioned.push(item.key);
  }
  return {
    ...plan,
    transitioned,
  };
}

export function formatReconciliationSummary(result) {
  const lines = [
    `Sonar reviewed issue reconciliation for branch test: transitioned=${result.transitioned.length} already_reviewed=${result.alreadyReviewed.length} fixed_or_missing=${result.fixedOrMissing.length}`,
  ];
  if (result.transitioned.length > 0) {
    lines.push(`Transitioned: ${result.transitioned.join(', ')}`);
  }
  if (result.alreadyReviewed.length > 0) {
    lines.push(`Already reviewed: ${result.alreadyReviewed.join(', ')}`);
  }
  if (result.fixedOrMissing.length > 0) {
    lines.push(`Fixed or missing: ${result.fixedOrMissing.join(', ')}`);
  }
  return lines.join('\n');
}

export async function runSonarReviewedIssues({
  argv = process.argv.slice(2),
  env = process.env,
  fetcher = globalThis.fetch,
  readProperties = () =>
    readFileSync(new URL('../sonar-project.properties', import.meta.url), 'utf8'),
  write = (line) => process.stdout.write(`${line}\n`),
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = monotonicNow,
} = {}) {
  const token = env.SONAR_TOKEN;
  if (!nonEmptyString(token)) throw new Error('SONAR_TOKEN is required.');
  parseReviewedArgs(argv);
  const projectKey = parseProjectKey(readProperties());
  const result = await reconcileReviewedSonarIssues({
    fetcher,
    hostUrl: env.SONAR_HOST_URL || 'https://sonarcloud.io',
    projectKey,
    token,
    requestTimeoutMs,
    timeoutMs,
    now,
  });
  write(formatReconciliationSummary(result));
  return result;
}

export function safeMessage(error, token) {
  const message =
    error instanceof Error ? error.message : 'Unknown Sonar reviewed-issue reconciliation failure.';
  return nonEmptyString(token) ? message.replaceAll(token, '[REDACTED]') : message;
}

async function main() {
  try {
    await runSonarReviewedIssues();
  } catch (error) {
    process.stderr.write(
      `Sonar reviewed-issue reconciliation failed: ${safeMessage(error, process.env.SONAR_TOKEN)}\n`,
    );
    process.exitCode = 1;
  }
}

validateReviewedIssueManifest();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
