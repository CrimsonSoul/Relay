import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  paginateSonarIssues,
  parseSonarProjectKey as parseProjectKey,
} from './sonar-api-client.mjs';
import { normalizeSonarIssueStatus } from './sonar-issue-status.mjs';

const PAGE_SIZE = 500;
const MAX_ISSUES = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const CURRENT_ISSUE_STATUSES = ['OPEN', 'CONFIRMED', 'ACCEPTED', 'FALSE_POSITIVE'];
const OPEN_STATUSES = new Set(['OPEN', 'CONFIRMED']);
const monotonicNow = () => performance.now();

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export { parseProjectKey };

function argumentValue(argv, index, name) {
  const argument = argv[index];
  const prefix = `${name}=`;
  if (argument.startsWith(prefix)) return { value: argument.slice(prefix.length), consumed: 1 };
  if (argument === name) {
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.startsWith('--')) {
      throw new Error(`Missing value for ${name}.`);
    }
    return { value, consumed: 2 };
  }
  return null;
}

function scopeArgument(argv, index) {
  for (const [name, field] of [
    ['--branch', 'branch'],
    ['--pull-request', 'pullRequest'],
  ]) {
    const parsed = argumentValue(argv, index, name);
    if (parsed) return { ...parsed, field, name };
  }
  throw new Error(`Unknown argument: ${argv[index]}`);
}

function containsControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

export function parseScopeArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length;) {
    const parsed = scopeArgument(argv, index);
    if (values[parsed.field] !== undefined) throw new Error(`Duplicate ${parsed.name} argument.`);
    values[parsed.field] = parsed.value;
    index += parsed.consumed;
  }

  const { branch, pullRequest } = values;
  if (Boolean(branch) === Boolean(pullRequest)) {
    throw new Error('Specify exactly one --branch or --pull-request scope.');
  }
  if (branch) {
    if (!nonEmptyString(branch) || branch.length > 255 || containsControlCharacter(branch)) {
      throw new Error('Sonar branch must be a bounded non-empty value.');
    }
    return { branch };
  }
  if (!/^[1-9]\d{0,19}$/u.test(pullRequest)) {
    throw new Error('Sonar pull request must be a positive numeric identifier.');
  }
  return { pullRequest };
}

function validateIssue(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !nonEmptyString(value.key) ||
    !nonEmptyString(value.status) ||
    (value.issueStatus !== undefined &&
      value.issueStatus !== null &&
      typeof value.issueStatus !== 'string') ||
    (value.resolution !== undefined &&
      value.resolution !== null &&
      typeof value.resolution !== 'string')
  ) {
    throw new Error('Sonar returned an invalid issue response.');
  }
  return {
    key: value.key,
    status: normalizeSonarIssueStatus(value),
    resolution: typeof value.resolution === 'string' ? value.resolution.toUpperCase() : null,
  };
}

export async function fetchSonarIssues({
  fetcher = globalThis.fetch,
  hostUrl,
  projectKey,
  scope,
  token,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = monotonicNow,
}) {
  if (typeof fetcher !== 'function') throw new Error('A Fetch implementation is required.');
  if (!nonEmptyString(projectKey)) throw new Error('A Sonar project key is required.');
  if (!nonEmptyString(token)) throw new Error('SONAR_TOKEN is required.');
  if (typeof now !== 'function') throw new TypeError('Sonar timing function is required.');
  return paginateSonarIssues({
    fetcher,
    baseUrl: hostUrl,
    token,
    searchParams: {
      componentKeys: projectKey,
      issueStatuses: CURRENT_ISSUE_STATUSES.join(','),
      ...('branch' in scope ? { branch: scope.branch } : { pullRequest: scope.pullRequest }),
    },
    pageSize: PAGE_SIZE,
    maxIssues: MAX_ISSUES,
    requestTimeoutMs,
    timeoutMs,
    now,
    validateIssue,
  });
}

export function classifyIssue(issue) {
  const status = normalizeSonarIssueStatus(issue);
  if (OPEN_STATUSES.has(status)) return 'open';
  if (status === 'ACCEPTED') return 'accepted';
  if (status === 'FALSE_POSITIVE') return 'falsePositive';
  return 'resolved';
}

function scopeLabel(scope) {
  return 'branch' in scope ? `branch ${scope.branch}` : `pull request ${scope.pullRequest}`;
}

export function summarizeIssues(issues) {
  const summary = {
    open: [],
    accepted: [],
    falsePositive: [],
    resolved: [],
  };
  for (const issue of issues) summary[classifyIssue(issue)].push(issue.key);
  for (const keys of Object.values(summary)) keys.sort((a, b) => a.localeCompare(b, 'en'));
  return summary;
}

export function sonarGateExitCode(summary) {
  return summary.open.length > 0 ? 1 : 0;
}

export function formatSonarSummary(issues, scope) {
  const summary = summarizeIssues(issues);
  const lines = [
    `Sonar issues for ${scopeLabel(scope)}: open=${summary.open.length} accepted=${summary.accepted.length} false_positive=${summary.falsePositive.length}`,
  ];
  if (summary.open.length) lines.push(`Open/confirmed: ${summary.open.join(', ')}`);
  if (summary.accepted.length) lines.push(`Accepted: ${summary.accepted.join(', ')}`);
  if (summary.falsePositive.length) {
    lines.push(`False positive: ${summary.falsePositive.join(', ')}`);
  }
  return lines.join('\n');
}

export async function runSonarOpenFindings({
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
  const scope = parseScopeArgs(argv);
  const projectKey = parseProjectKey(readProperties());
  const issues = await fetchSonarIssues({
    fetcher,
    hostUrl: env.SONAR_HOST_URL || 'https://sonarcloud.io',
    projectKey,
    scope,
    token,
    requestTimeoutMs,
    timeoutMs,
    now,
  });
  const summary = summarizeIssues(issues);
  write(formatSonarSummary(issues, scope));
  return { issues, scope, summary };
}

function safeMessage(error, token) {
  const message = error instanceof Error ? error.message : 'Unknown Sonar gate failure.';
  return token ? message.replaceAll(token, '[REDACTED]') : message;
}

async function main() {
  try {
    const result = await runSonarOpenFindings();
    process.exitCode = sonarGateExitCode(result.summary);
  } catch (error) {
    process.stderr.write(
      `Sonar open-findings gate failed: ${safeMessage(error, process.env.SONAR_TOKEN)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
