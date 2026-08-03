import assert from 'node:assert/strict';
import { SCANNER_OUTCOME, ScannerGateError } from './scanner-gate-policy.mjs';

const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');
const TOKEN = 'sonar-shared-client-token-never-print';

function response(body, { ok = true, status = 200, jsonError } = {}) {
  return {
    ok,
    status,
    json: async () => {
      if (jsonError) throw jsonError;
      return body;
    },
  };
}

test('shared Sonar parsing rejects malformed project files and insecure API bases', async () => {
  const { normalizeSonarApiBase, parseSonarProjectKey } = await import('./sonar-api-client.mjs');

  assert.equal(
    parseSonarProjectKey('sonar.projectName=Relay\nsonar.projectKey=CrimsonSoul_Relay\n'),
    'CrimsonSoul_Relay',
  );
  assert.throws(() => parseSonarProjectKey('sonar.projectName=Relay\n'), /exactly one/i);
  assert.throws(
    () => parseSonarProjectKey('sonar.projectKey=one\nsonar.projectKey=two\n'),
    /exactly one/i,
  );
  for (const value of [
    'http://sonar.example.test',
    'https://user:password@sonar.example.test',
    'https://sonar.example.test?token=unsafe',
  ]) {
    assert.throws(() => normalizeSonarApiBase(value), /credential-free HTTPS/i);
  }
  assert.equal(
    normalizeSonarApiBase('https://sonar.example.test/base').href,
    'https://sonar.example.test/base/',
  );
});

test('shared Sonar JSON requests reject malformed payloads and bound stalled requests', async () => {
  const { requestSonarJson } = await import('./sonar-api-client.mjs');
  const url = new URL('https://sonar.example.test/api/issues/search');

  let insecureRequestSent = false;
  await assert.rejects(
    requestSonarJson({
      fetcher: async () => {
        insecureRequestSent = true;
        return response({});
      },
      url: new URL('http://sonar.example.test/api/issues/search'),
      token: TOKEN,
      timeoutMs: 20,
    }),
    /HTTPS/i,
  );
  assert.equal(insecureRequestSent, false);

  await assert.rejects(
    requestSonarJson({
      fetcher: async () => response({}, { jsonError: new Error('malformed') }),
      url,
      token: TOKEN,
      timeoutMs: 20,
    }),
    /invalid JSON/i,
  );

  let receivedSignal = false;
  await assert.rejects(
    requestSonarJson({
      fetcher: async (_requestUrl, options) => {
        receivedSignal = options.signal instanceof AbortSignal;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          });
        });
      },
      url,
      token: TOKEN,
      timeoutMs: 10,
    }),
    (error) => error instanceof ScannerGateError && error.outcome === SCANNER_OUTCOME.UNAVAILABLE,
  );
  assert.equal(receivedSignal, true);
});

test('shared Sonar issue pagination applies caller parameters and rejects unstable totals', async () => {
  const { paginateSonarIssues } = await import('./sonar-api-client.mjs');
  const requests = [];
  const validateIssue = (issue) => {
    if (!issue || typeof issue.key !== 'string') throw new Error('invalid issue fixture');
    return { key: issue.key };
  };

  const issues = await paginateSonarIssues({
    fetcher: async (url) => {
      const requestUrl = new URL(url);
      requests.push(requestUrl);
      const currentPage = Number(requestUrl.searchParams.get('p'));
      return response({
        paging: { pageIndex: currentPage, pageSize: 2, total: 3 },
        issues: currentPage === 1 ? [{ key: 'issue-a' }, { key: 'issue-b' }] : [{ key: 'issue-c' }],
      });
    },
    baseUrl: 'https://sonar.example.test/base',
    token: TOKEN,
    searchParams: {
      branch: 'test',
      componentKeys: 'CrimsonSoul_Relay',
      issueStatuses: 'OPEN,CONFIRMED',
    },
    pageSize: 2,
    maxIssues: 10,
    requestTimeoutMs: 100,
    timeoutMs: 1_000,
    validateIssue,
  });

  assert.deepEqual(issues, [{ key: 'issue-a' }, { key: 'issue-b' }, { key: 'issue-c' }]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].pathname, '/base/api/issues/search');
  assert.equal(requests[0].searchParams.get('branch'), 'test');
  assert.equal(requests[0].searchParams.get('componentKeys'), 'CrimsonSoul_Relay');
  assert.equal(requests[0].searchParams.get('ps'), '2');

  let page = 0;
  await assert.rejects(
    paginateSonarIssues({
      fetcher: async () => {
        page += 1;
        return response({
          paging: { pageIndex: page, pageSize: 1, total: page === 1 ? 2 : 1 },
          issues: [{ key: `unstable-${page}` }],
        });
      },
      baseUrl: 'https://sonar.example.test',
      token: TOKEN,
      searchParams: { componentKeys: 'CrimsonSoul_Relay' },
      pageSize: 1,
      maxIssues: 10,
      requestTimeoutMs: 100,
      timeoutMs: 1_000,
      validateIssue,
    }),
    /pagination total changed/i,
  );
});
