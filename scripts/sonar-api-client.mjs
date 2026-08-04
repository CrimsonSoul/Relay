import { performance } from 'node:perf_hooks';

const MAX_REQUEST_TIMEOUT_MS = 60_000;
const MAX_PAGINATION_TIMEOUT_MS = 1_080_000;
const MAX_PAGE_SIZE = 500;
const MAX_ISSUES = 1_000_000;
const monotonicNow = () => performance.now();

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export class SonarHttpError extends Error {
  constructor(status) {
    super(
      Number.isInteger(status)
        ? `Sonar API request failed with HTTP ${status}.`
        : 'Sonar API returned an invalid HTTP status.',
    );
    this.name = 'SonarHttpError';
    this.status = status;
  }
}

export class SonarTransportError extends Error {
  constructor(kind, message, options = {}) {
    super(message, options);
    this.name = 'SonarTransportError';
    this.kind = kind;
  }
}

export function parseSonarProjectKey(properties) {
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

export function normalizeSonarApiBase(hostUrl) {
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

function normalizeSonarRequestUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Sonar API request must use a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Sonar API request must use a credential-free HTTPS URL.');
  }
  return url;
}

function validateRequestTimeout(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_REQUEST_TIMEOUT_MS) {
    throw new Error('Sonar request timeout must be between 1 and 60000 milliseconds.');
  }
}

export async function requestSonarJson({
  fetcher = globalThis.fetch,
  url,
  token,
  timeoutMs,
  options = {},
}) {
  if (typeof fetcher !== 'function') throw new Error('A Fetch implementation is required.');
  if (!nonEmptyString(token)) throw new Error('SONAR_TOKEN is required.');
  validateRequestTimeout(timeoutMs);
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Sonar request options must be an object.');
  }
  const requestUrl = normalizeSonarRequestUrl(url);
  const signal = AbortSignal.timeout(timeoutMs);

  let response;
  try {
    response = await fetcher(requestUrl, {
      ...options,
      headers: {
        ...options.headers,
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      throw new SonarTransportError('timeout', 'Sonar API request timed out.', { cause: error });
    }
    throw new SonarTransportError(
      'network',
      'Sonar API request failed before receiving a response.',
      { cause: error },
    );
  }
  if (!response?.ok) throw new SonarHttpError(response?.status);

  try {
    const payload = await response.json();
    if (signal.aborted) {
      throw new SonarTransportError('timeout', 'Sonar API response body timed out.');
    }
    return payload;
  } catch (error) {
    if (error instanceof SonarTransportError) throw error;
    if (signal.aborted) {
      throw new SonarTransportError('timeout', 'Sonar API response body timed out.', {
        cause: error,
      });
    }
    throw new Error('Sonar returned invalid JSON.', { cause: error });
  }
}

function validatePaginationOptions({
  pageSize,
  maxIssues,
  requestTimeoutMs,
  timeoutMs,
  now,
  validateIssue,
}) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error('Sonar page size must be between 1 and 500.');
  }
  if (!Number.isSafeInteger(maxIssues) || maxIssues < 1 || maxIssues > MAX_ISSUES) {
    throw new Error('Sonar issue limit must be between 1 and 1000000.');
  }
  validateRequestTimeout(requestTimeoutMs);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_PAGINATION_TIMEOUT_MS) {
    throw new Error('Sonar issue-search timeout must be between 1 and 1080000 milliseconds.');
  }
  if (typeof now !== 'function') throw new TypeError('Sonar timing function is required.');
  if (typeof validateIssue !== 'function')
    throw new TypeError('Sonar issue validator is required.');
}

function issuePage(payload, expectedPage, pageSize, maxIssues, validateIssue) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Sonar returned an invalid issue response.');
  }
  const paging =
    payload.paging && typeof payload.paging === 'object' && !Array.isArray(payload.paging)
      ? payload.paging
      : {
          pageIndex: payload.p,
          pageSize: payload.ps,
          total: payload.total,
        };
  if (
    !Array.isArray(payload.issues) ||
    !Number.isSafeInteger(paging.pageIndex) ||
    paging.pageIndex !== expectedPage ||
    !Number.isSafeInteger(paging.pageSize) ||
    paging.pageSize < 1 ||
    paging.pageSize > pageSize ||
    !Number.isSafeInteger(paging.total) ||
    paging.total < 0 ||
    paging.total > maxIssues
  ) {
    throw new Error('Sonar returned an invalid issue response.');
  }
  return {
    issues: payload.issues.map(validateIssue),
    total: paging.total,
  };
}

function appendUniqueIssues(target, seen, additions) {
  for (const issue of additions) {
    if (
      issue === null ||
      typeof issue !== 'object' ||
      Array.isArray(issue) ||
      !nonEmptyString(issue.key)
    ) {
      throw new Error('Sonar issue validator returned invalid metadata.');
    }
    if (seen.has(issue.key)) throw new Error(`Sonar returned duplicate issue key: ${issue.key}`);
    seen.add(issue.key);
    target.push(issue);
  }
}

export async function paginateSonarIssues({
  fetcher = globalThis.fetch,
  baseUrl,
  token,
  searchParams,
  pageSize = MAX_PAGE_SIZE,
  maxIssues = MAX_ISSUES,
  requestTimeoutMs = 30_000,
  timeoutMs = 300_000,
  now = monotonicNow,
  validateIssue,
}) {
  validatePaginationOptions({
    pageSize,
    maxIssues,
    requestTimeoutMs,
    timeoutMs,
    now,
    validateIssue,
  });
  if (!searchParams || typeof searchParams !== 'object' || Array.isArray(searchParams)) {
    throw new TypeError('Sonar issue search parameters must be an object.');
  }
  const base = normalizeSonarApiBase(baseUrl);
  const issues = [];
  const seen = new Set();
  let expectedTotal;
  let page = 1;
  const deadline = now() + timeoutMs;

  do {
    const remaining = Math.floor(deadline - now());
    if (remaining <= 0) {
      throw new SonarTransportError('deadline', 'Sonar issue search exceeded its deadline.');
    }
    const url = new URL('api/issues/search', base);
    for (const [name, value] of Object.entries(searchParams)) {
      if (!nonEmptyString(name) || !nonEmptyString(value)) {
        throw new Error('Sonar issue search parameters must be non-empty strings.');
      }
      url.searchParams.set(name, value);
    }
    url.searchParams.set('p', String(page));
    url.searchParams.set('ps', String(pageSize));
    const payload = await requestSonarJson({
      fetcher,
      url,
      token,
      timeoutMs: Math.min(requestTimeoutMs, remaining),
    });
    const validated = issuePage(payload, page, pageSize, maxIssues, validateIssue);
    expectedTotal ??= validated.total;
    if (validated.total !== expectedTotal) {
      throw new Error('Sonar pagination total changed while issues were being read.');
    }
    appendUniqueIssues(issues, seen, validated.issues);
    if (validated.issues.length === 0 && issues.length < expectedTotal) {
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
