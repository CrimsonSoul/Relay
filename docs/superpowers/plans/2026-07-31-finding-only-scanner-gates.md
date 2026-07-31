# Finding-Only Scanner Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Relay's pull-request scanners merge-blocking for confirmed findings while making documented third-party rate limits, timeouts, and service outages visible but non-blocking.

**Architecture:** Introduce a shared scanner-outcome module with four explicit states: clean, finding, unavailable, and configuration failure. Sonar and Snyk CI entrypoints translate tool-specific results into that policy, emit GitHub warnings and summaries for unavailable scans, and retain the existing required job names; CodeRabbit findings block through Request Changes and unresolved conversations instead of an availability status.

**Tech Stack:** Node.js 22 ESM, Vitest/Node test runner, GitHub Actions YAML, pinned SonarScanner for NPM, pinned Snyk CLI, CodeRabbit YAML, GitHub branch-protection REST API.

## Global Constraints

- Changes continue to enter `test` through pull requests; direct pushes remain prohibited.
- `Build quality gate`, `SonarQube quality gate`, and `Snyk security gate` remain strict required status contexts.
- A confirmed scanner finding exits nonzero and blocks merge.
- HTTP 429, HTTP 5xx, bounded network timeout, documented Snyk exit 69, and documented Snyk exit 75 warn and return a successful required check.
- Missing credentials, HTTP 401/403, invalid identifiers, malformed responses, unsupported repository state, and contradictory Sonar review metadata remain blocking configuration or contract failures.
- Windows packaging remains independent from every external scanner and produces the newest merged `test` artifact.
- CodeRabbit does not review drafts, uses Request Changes for findings, and is not a required availability status.
- No CodeRabbit usage-based add-on, paid scanner tier, larger GitHub runner, or other paid-overage setting may be enabled.
- Scanner output and summaries must never expose tokens, authorization headers, or unbounded remote response bodies.
- Preserve exact Sonar scope checks, the 49-item reviewed-issue manifest, and branch-only Snyk monitor semantics.

---

### Task 1: Shared Scanner Outcome Policy

**Files:**

- Create: `scripts/scanner-gate-policy.mjs`
- Create: `scripts/scanner-gate-policy.test.mjs`

**Interfaces:**

- Produces: `SCANNER_OUTCOME` with `clean`, `finding`, `unavailable`, and `configuration` values.
- Produces: `ScannerGateError(outcome: string, message: string, options?: { cause?: unknown })`.
- Produces: `findingError`, `unavailableError`, `configurationError`, and `classifyHttpFailure`.
- Produces: `classifyCommandResult(result, policy): string`, where `result` is `{ code: number | null, timedOut: boolean, output: string }`.
- Produces: `runBoundedCommand({ file, args, env, timeoutMs, maxOutputBytes })`.
- Produces: `writeUnavailableReport({ scanner, reason, revision, env, appendFile, write })`.
- Consumes: Node built-ins only; no new package dependency.

- [ ] **Step 1: Write failing outcome-matrix tests**

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SCANNER_OUTCOME,
  ScannerGateError,
  classifyCommandResult,
  classifyHttpFailure,
  runBoundedCommand,
  writeUnavailableReport,
} from './scanner-gate-policy.mjs';

test('classifies only documented availability failures as non-blocking', () => {
  assert.equal(classifyHttpFailure('Sonar', 429).outcome, SCANNER_OUTCOME.UNAVAILABLE);
  assert.equal(classifyHttpFailure('Sonar', 503).outcome, SCANNER_OUTCOME.UNAVAILABLE);
  assert.equal(classifyHttpFailure('Sonar', 401).outcome, SCANNER_OUTCOME.CONFIGURATION);
  assert.equal(
    classifyCommandResult(
      { code: 1, timedOut: false, output: 'issues found' },
      { findingExitCodes: [1], unavailableExitCodes: [69, 75], transientOutput: /HTTP 429/iu },
    ),
    SCANNER_OUTCOME.FINDING,
  );
  assert.equal(
    classifyCommandResult(
      { code: 75, timedOut: false, output: '' },
      { findingExitCodes: [1], unavailableExitCodes: [69, 75], transientOutput: /HTTP 429/iu },
    ),
    SCANNER_OUTCOME.UNAVAILABLE,
  );
});

test('rejects ambiguous outcome values', () => {
  assert.equal(new ScannerGateError(SCANNER_OUTCOME.FINDING, 'found').outcome, 'finding');
  assert.throws(() => new ScannerGateError('maybe', 'ambiguous'), /outcome/i);
});
```

- [ ] **Step 2: Run the focused test to verify red**

Run: `npx vitest run scripts/scanner-gate-policy.test.mjs`

Expected: FAIL because `scripts/scanner-gate-policy.mjs` does not exist.

- [ ] **Step 3: Implement the typed policy and HTTP rules**

```js
export const SCANNER_OUTCOME = Object.freeze({
  CLEAN: 'clean',
  FINDING: 'finding',
  UNAVAILABLE: 'unavailable',
  CONFIGURATION: 'configuration',
});

const ERROR_OUTCOMES = new Set([
  SCANNER_OUTCOME.FINDING,
  SCANNER_OUTCOME.UNAVAILABLE,
  SCANNER_OUTCOME.CONFIGURATION,
]);

export class ScannerGateError extends Error {
  constructor(outcome, message, options = {}) {
    if (!ERROR_OUTCOMES.has(outcome)) throw new TypeError('Scanner error outcome is invalid.');
    super(message, options);
    this.name = 'ScannerGateError';
    this.outcome = outcome;
  }
}

export const findingError = (message, options) =>
  new ScannerGateError(SCANNER_OUTCOME.FINDING, message, options);
export const unavailableError = (message, options) =>
  new ScannerGateError(SCANNER_OUTCOME.UNAVAILABLE, message, options);
export const configurationError = (message, options) =>
  new ScannerGateError(SCANNER_OUTCOME.CONFIGURATION, message, options);

export function classifyHttpFailure(scanner, status) {
  if (!Number.isInteger(status)) return configurationError(`${scanner} returned invalid HTTP status.`);
  if (status === 429 || (status >= 500 && status <= 599)) {
    return unavailableError(`${scanner} request failed with HTTP ${status}.`);
  }
  return configurationError(`${scanner} request failed with HTTP ${status}.`);
}
```

`classifyCommandResult` returns unavailable for `timedOut`, a configured unavailable exit, or the bounded transient regex; it returns finding for configured finding exits, clean for code 0, and configuration for every other result.

- [ ] **Step 4: Add bounded-process and safe-reporting tests**

```js
test('kills a command at its internal deadline', async () => {
  const result = await runBoundedCommand({
    file: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    env: process.env,
    timeoutMs: 25,
    maxOutputBytes: 4096,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.code, null);
});

test('writes warning evidence without echoing a token', () => {
  const annotations = [];
  const summaries = [];
  writeUnavailableReport({
    scanner: 'Snyk',
    reason: 'service unavailable using token-sentinel',
    revision: 'abc123',
    env: { SNYK_TOKEN: 'token-sentinel', GITHUB_STEP_SUMMARY: '/summary' },
    appendFile: (_path, text) => summaries.push(text),
    write: (text) => annotations.push(text),
  });
  assert.match(annotations.join(''), /::warning/);
  assert.match(summaries.join(''), /No security decision was produced/);
  assert.equal(`${annotations}${summaries}`.includes('token-sentinel'), false);
});
```

- [ ] **Step 5: Implement bounded execution and warning evidence**

Use `node:child_process.spawn` with `shell: false`, stream output to the job log, retain only the last `maxOutputBytes`, and terminate at `timeoutMs`. Sanitize `SONAR_TOKEN` and `SNYK_TOKEN`; replace annotation newlines; append scanner, revision, sanitized category, “No security decision was produced,” and retry guidance to `$GITHUB_STEP_SUMMARY`.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run scripts/scanner-gate-policy.test.mjs`

Expected: PASS for all four states, timeout, truncation, and token redaction.

```bash
git add scripts/scanner-gate-policy.mjs scripts/scanner-gate-policy.test.mjs
git commit -m "ci: define scanner outcome policy"
```

---

### Task 2: Sonar Finding-Only CI Gate

**Files:**

- Create: `scripts/run-sonar-ci.mjs`
- Create: `scripts/run-sonar-ci.test.mjs`
- Modify: `scripts/sonar-open-findings.mjs:169-192,271-325`
- Modify: `scripts/sonar-open-findings.test.mjs:288-337`
- Modify: `scripts/sonar-quality-gate.mjs:144-168,235-263,308-393,509-521`
- Modify: `scripts/sonar-quality-gate.test.mjs:320-365,470-575`
- Modify: `scripts/sonar-reviewed-issues.mjs:552-584,699-741,783-818`
- Modify: `scripts/sonar-reviewed-issues.test.mjs:430-470,529-565`
- Modify: `package.json:38-44`
- Modify: `.github/workflows/security.yml:47-125`

**Interfaces:**

- Consumes: Task 1 policy exports.
- Produces: `runSonarCi({ argv, env, runCommand, waitAnalysis, reconcile, readIssues, checkGate, reportUnavailable })`.
- Produces: npm command `security:sonar:ci` mapped to `node scripts/run-sonar-ci.mjs`.
- Preserves: existing lower-level Sonar command signatures for local diagnostics.

- [ ] **Step 1: Write failing typed Sonar tests**

```js
import assert from 'node:assert/strict';
import { SCANNER_OUTCOME, ScannerGateError } from './scanner-gate-policy.mjs';
import { fetchSonarIssues } from './sonar-open-findings.mjs';
import { waitForQualityGate } from './sonar-quality-gate.mjs';

const response = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});
const options = {
  hostUrl: 'https://sonarcloud.io',
  projectKey: 'CrimsonSoul_Relay',
  scope: { branch: 'test' },
  token: 'sonar-token-sentinel',
};
const pullRequestOptions = {
  serverUrl: 'https://sonarcloud.io/',
  analysisId: 'analysis_456',
  projectKey: 'CrimsonSoul_Relay',
  scope: { pullRequest: '221' },
  token: 'sonar-token-sentinel',
  timeoutMs: 1_000,
  pollIntervalMs: 10,
};

await assert.rejects(
  fetchSonarIssues({ ...options, fetcher: async () => response({}, { ok: false, status: 503 }) }),
  (error) => error instanceof ScannerGateError && error.outcome === SCANNER_OUTCOME.UNAVAILABLE,
);
await assert.rejects(
  fetchSonarIssues({ ...options, fetcher: async () => response({}, { ok: false, status: 401 }) }),
  (error) => error instanceof ScannerGateError && error.outcome === SCANNER_OUTCOME.CONFIGURATION,
);
await assert.rejects(
  waitForQualityGate({
    ...pullRequestOptions,
    fetcher: async () => response({ projectStatus: { status: 'ERROR' } }),
  }),
  (error) => error instanceof ScannerGateError && error.outcome === SCANNER_OUTCOME.FINDING,
);
```

Retain malformed-payload, cross-project, cross-branch, contradictory-status, and token-redaction cases as blocking configuration failures.

- [ ] **Step 2: Run Sonar tests to verify red**

Run:

```bash
npx vitest run scripts/sonar-open-findings.test.mjs scripts/sonar-quality-gate.test.mjs scripts/sonar-reviewed-issues.test.mjs
```

Expected: FAIL because Sonar errors are not typed yet.

- [ ] **Step 3: Implement Sonar classification**

Use this request behavior in all three Sonar modules:

```js
try {
  response = await fetcher(url, options);
} catch (cause) {
  throw unavailableError('Sonar API request timed out or failed before receiving a response.', {
    cause,
  });
}
if (!response?.ok) throw classifyHttpFailure('Sonar', response?.status);
```

Use unavailable for bounded compute and quality-gate timeouts; finding for non-OK completed quality gates and open/confirmed/reopened issues; configuration for authentication, malformed JSON/schema, wrong report/project/branch/PR, failed compute tasks, pagination contradictions, and reviewed-manifest drift. Unknown errors stay configuration failures.

- [ ] **Step 4: Write failing Sonar orchestrator tests**

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runSonarCi } from './run-sonar-ci.mjs';
import { SCANNER_OUTCOME } from './scanner-gate-policy.mjs';

const configuredEnv = {
  SONAR_HOST_URL: 'https://sonarcloud.io',
  SONAR_ORGANIZATION: 'crimsonsoul',
  SONAR_TOKEN: 'sonar-token-sentinel',
  GITHUB_SHA: 'abc123',
};

test('runs the clean PR phases in exact order', async () => {
  const calls = [];
  const result = await runSonarCi({
    argv: ['--pull-request=221'],
    env: configuredEnv,
    runCommand: async () => ({ code: 0, timedOut: false, output: '' }),
    waitAnalysis: async () => calls.push('wait'),
    reconcile: async () => calls.push('reconcile'),
    readIssues: async () => {
      calls.push('issues');
      return { summary: { open: [] } };
    },
    checkGate: async () => calls.push('gate'),
  });
  assert.equal(result.outcome, SCANNER_OUTCOME.CLEAN);
  assert.deepEqual(calls, ['wait', 'issues', 'gate']);
});

test('warns for timeout and blocks a finding', async () => {
  const unavailable = await runSonarCi({
    argv: ['--pull-request=221'],
    env: configuredEnv,
    runCommand: async () => ({ code: null, timedOut: true, output: '' }),
    reportUnavailable: () => {},
  });
  assert.equal(unavailable.outcome, SCANNER_OUTCOME.UNAVAILABLE);
  await assert.rejects(
    runSonarCi({
      argv: ['--pull-request=221'],
      env: configuredEnv,
      runCommand: async () => ({ code: 0, timedOut: false, output: '' }),
      waitAnalysis: async () => {},
      readIssues: async () => ({ summary: { open: ['relay-finding'] } }),
      checkGate: async () => {},
    }),
    (error) => error.outcome === SCANNER_OUTCOME.FINDING,
  );
});
```

Also assert branch scope reconciles exactly once, PR scope never reconciles, transient upload text warns, authentication text fails, unknown upload errors fail, and tokens remain redacted.

- [ ] **Step 5: Implement `runSonarCi`**

Require one existing `--branch=test` or numeric `--pull-request`; require `SONAR_TOKEN` and `SONAR_ORGANIZATION`; reject non-HTTPS `SONAR_HOST_URL`; invoke the pinned scanner with:

```js
args: [
  'run',
  'security:sonar',
  '--',
  `-Dsonar.organization=${env.SONAR_ORGANIZATION}`,
  '-Dsonar.qualitygate.wait=false',
  ...(env.SONAR_HOST_URL ? [`-Dsonar.host.url=${env.SONAR_HOST_URL}`] : []),
]
```

Use a 600,000 ms internal deadline and 32,768-byte classification buffer. Treat only HTTP 429/5xx, `ETIMEDOUT`, `ECONNRESET`, `EAI_AGAIN`, `ENOTFOUND`, `socket hang up`, `temporarily unavailable`, and `service unavailable` as transient upload evidence. After upload, run exact analysis, branch-only reconciliation, open-issue inspection, and exact gate inspection. Catch unavailable to warn and return success; rethrow finding/configuration failures.

- [ ] **Step 6: Replace Sonar workflow steps**

Keep LCOV generation hard. Replace scanner steps with `Run Sonar finding gate`, select PR or branch scope, and run `npm run security:sonar:ci -- "${SONAR_SCOPE[@]}"`. Set job `timeout-minutes: 25` so the internal deadline reports first. Preserve job name `SonarQube quality gate`.

- [ ] **Step 7: Verify and commit Sonar work**

```bash
npx vitest run scripts/scanner-gate-policy.test.mjs scripts/sonar-open-findings.test.mjs scripts/sonar-quality-gate.test.mjs scripts/sonar-reviewed-issues.test.mjs scripts/run-sonar-ci.test.mjs
node -e "import('yaml').then(({parse}) => parse(require('fs').readFileSync('.github/workflows/security.yml','utf8')))"
```

Expected: PASS and valid workflow YAML.

```bash
git add scripts/sonar-open-findings.mjs scripts/sonar-open-findings.test.mjs scripts/sonar-quality-gate.mjs scripts/sonar-quality-gate.test.mjs scripts/sonar-reviewed-issues.mjs scripts/sonar-reviewed-issues.test.mjs scripts/run-sonar-ci.mjs scripts/run-sonar-ci.test.mjs package.json .github/workflows/security.yml
git commit -m "ci: soften Sonar availability failures"
```

---

### Task 3: Snyk Finding-Only CI Gate

**Files:**

- Create: `scripts/run-snyk-ci.mjs`
- Create: `scripts/run-snyk-ci.test.mjs`
- Modify: `package.json:42-45`
- Modify: `.github/workflows/security.yml:127-183`

**Interfaces:**

- Consumes: Task 1 policy and bounded-command exports.
- Produces: `runSnykCi({ env, runCommand, reportUnavailable })`.
- Produces: npm command `security:snyk:ci` mapped to `node scripts/run-snyk-ci.mjs`.

- [ ] **Step 1: Write failing Snyk matrix tests**

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runSnykCi } from './run-snyk-ci.mjs';
import { SCANNER_OUTCOME } from './scanner-gate-policy.mjs';

const configuredEnv = {
  SNYK_ORG: 'crimsonsoul',
  SNYK_TOKEN: 'snyk-token-sentinel',
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_REF: 'refs/pull/221/merge',
  GITHUB_REPOSITORY: 'CrimsonSoul/Relay',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_SHA: 'abc123',
};
const runWithExit = (code) =>
  runSnykCi({
    env: configuredEnv,
    runCommand: async () => ({ code, timedOut: false, output: '' }),
    reportUnavailable: () => {},
  });

test('runs Open Source, Code, then branch monitor', async () => {
  const commands = [];
  const result = await runSnykCi({
    env: { ...configuredEnv, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/test' },
    runCommand: async (command) => {
      commands.push(command.args);
      return { code: 0, timedOut: false, output: '' };
    },
  });
  assert.equal(result.outcome, SCANNER_OUTCOME.CLEAN);
  assert.match(commands[0].join(' '), /security:snyk:open-source/);
  assert.match(commands[1].join(' '), /security:snyk:code/);
  assert.match(commands[2].join(' '), /security:snyk:monitor/);
});

test('blocks code 1 and warns for documented temporary exits', async () => {
  await assert.rejects(runWithExit(1), (error) => error.outcome === SCANNER_OUTCOME.FINDING);
  for (const code of [69, 75]) {
    assert.equal((await runWithExit(code)).outcome, SCANNER_OUTCOME.UNAVAILABLE);
  }
});
```

Also test timeout as unavailable; exits 2, 3, and 77 as configuration; missing token/org as configuration; PR scans omit monitor; and exact repository/org/target arguments without token leakage.

- [ ] **Step 2: Run the focused test to verify red**

Run: `npx vitest run scripts/run-snyk-ci.test.mjs`

Expected: FAIL because `run-snyk-ci.mjs` does not exist.

- [ ] **Step 3: Implement documented Snyk semantics**

Use:

```js
const SNYK_POLICY = {
  findingExitCodes: [1],
  unavailableExitCodes: [69, 75],
  transientOutput: /(?:HTTP\s+(?:429|5\d\d)|ETIMEDOUT|ECONNRESET|EAI_AGAIN|temporarily unavailable|maintenance window)/iu,
};
```

Run Open Source then Code with a 600,000 ms internal deadline and 32,768-byte buffer. Stop at the first non-clean result. Run monitor only after both scans are clean on a `test` push. Unavailable monitor is warning success; monitor authentication/configuration remains red.

- [ ] **Step 4: Replace Snyk workflow shell**

Preserve `Snyk security gate`; add `timeout-minutes: 25`; replace scan and monitor steps with `Run Snyk finding gate`; provide Snyk org/token and GitHub event/ref/repository/server environment; run `npm run security:snyk:ci`.

- [ ] **Step 5: Verify and commit Snyk work**

```bash
npx vitest run scripts/scanner-gate-policy.test.mjs scripts/run-snyk-ci.test.mjs scripts/security-workflow-contract.test.mjs
node -e "import('yaml').then(({parse}) => parse(require('fs').readFileSync('.github/workflows/security.yml','utf8')))"
```

Expected: PASS and stable job names.

```bash
git add scripts/run-snyk-ci.mjs scripts/run-snyk-ci.test.mjs package.json .github/workflows/security.yml
git commit -m "ci: soften Snyk availability failures"
```

---

### Task 4: CodeRabbit and Workflow Contracts

**Files:**

- Modify: `.coderabbit.yaml:1-10`
- Modify: `scripts/coderabbit-config-contract.test.mjs:7-29`
- Modify: `scripts/security-workflow-contract.test.mjs:7-50`

**Interfaces:**

- Consumes: stable CI entrypoints from Tasks 2-3.
- Produces: CodeRabbit Request Changes, draft exclusion, and two-commit review pause.
- Preserves: GitHub Checks timeout `900000` ms.

- [ ] **Step 1: Write failing contracts**

```js
const findStep = (job, name) => {
  const step = job.steps.find((candidate) => candidate.name === name);
  assert.ok(step, `missing workflow step: ${name}`);
  return step;
};

expect(config).toMatchObject({
  reviews: {
    request_changes_workflow: true,
    auto_review: {
      enabled: true,
      drafts: false,
      auto_incremental_review: true,
      auto_pause_after_reviewed_commits: 2,
      base_branches: ['test'],
    },
    tools: { 'github-checks': { enabled: true, timeout_ms: 900_000 } },
  },
});

assert.equal(security.jobs.sonarqube.name, 'SonarQube quality gate');
assert.equal(security.jobs.snyk.name, 'Snyk security gate');
assert.match(findStep(security.jobs.sonarqube, 'Run Sonar finding gate').run, /security:sonar:ci/u);
assert.match(findStep(security.jobs.snyk, 'Run Snyk finding gate').run, /security:snyk:ci/u);
assert.equal(build.jobs['package-windows'].needs, undefined);
```

Recursively reject CodeRabbit keys containing `usage`, `credit`, `billing`, `overage`, or `paid`.

- [ ] **Step 2: Run contracts to verify red**

Run: `npx vitest run scripts/coderabbit-config-contract.test.mjs scripts/security-workflow-contract.test.mjs`

Expected: FAIL for missing Request Changes and auto-pause.

- [ ] **Step 3: Update CodeRabbit configuration**

```yaml
reviews:
  request_changes_workflow: true
  auto_review:
    enabled: true
    drafts: false
    auto_incremental_review: true
    auto_pause_after_reviewed_commits: 2
    base_branches:
      - test
  tools:
    github-checks:
      enabled: true
      timeout_ms: 900000
```

- [ ] **Step 4: Run contracts and commit**

```bash
npx vitest run scripts/coderabbit-config-contract.test.mjs scripts/security-workflow-contract.test.mjs scripts/windows-nsis-contract.test.mjs
```

Expected: PASS; Windows packaging remains scanner-independent.

```bash
git add .coderabbit.yaml scripts/coderabbit-config-contract.test.mjs scripts/security-workflow-contract.test.mjs
git commit -m "ci: block only on CodeRabbit findings"
```

---

### Task 5: Canonical Documentation

**Files:**

- Modify: `docs/SECURITY.md:189-214`
- Modify: `docs/DEVELOPMENT.md:377-420`

**Interfaces:**

- Consumes: final Tasks 1-4 behavior.
- Produces: operator documentation for outcome states, warning evidence, draft/ready flow, retry guidance, and free-tier boundaries.

- [ ] **Step 1: Update security policy**

Add this exact policy meaning:

```md
A completed Sonar or Snyk finding remains a release blocker. The CI wrappers classify documented
HTTP 429/5xx responses, bounded network timeouts, and documented temporary Snyk exit codes as
Unavailable: the required job emits a warning and summary but succeeds because no negative security
decision was produced. Missing credentials, authorization failures, malformed responses, identity
drift, and unknown errors remain blocking configuration failures. CodeRabbit blocks through Request
Changes and unresolved conversations; its availability status is not a required check.
```

Document independent Windows packaging, newest nonsuperseded artifact semantics, and no paid overage.

- [ ] **Step 2: Update development guidance**

Document `npm run security:sonar:ci -- --pull-request=<number>`, `npm run security:sonar:ci -- --branch=test`, and `npm run security:snyk:ci`; explain real credentials, `$GITHUB_STEP_SUMMARY`, lower-level diagnostic commands, and draft-to-ready rapid-push flow.

- [ ] **Step 3: Check and commit documentation**

```bash
npx prettier --check docs/SECURITY.md docs/DEVELOPMENT.md
git diff --check
git add docs/SECURITY.md docs/DEVELOPMENT.md
git commit -m "docs: explain finding-only scanner gates"
```

Expected: formatting and whitespace checks pass.

---

### Task 6: Verification, Pull Request, and Live Enforcement

**Files:**

- Verify: all Task 1-5 files
- External state: GitHub PR into `test`
- External state: `test` required status contexts

**Interfaces:**

- Consumes: completed implementation and GitHub credentials.
- Produces: merged policy requiring Build, Sonar, and Snyk, with CodeRabbit removed as an availability context and conversation resolution retained.

- [ ] **Step 1: Run focused suites**

```bash
npx vitest run scripts/scanner-gate-policy.test.mjs scripts/run-sonar-ci.test.mjs scripts/run-snyk-ci.test.mjs scripts/sonar-open-findings.test.mjs scripts/sonar-quality-gate.test.mjs scripts/sonar-reviewed-issues.test.mjs scripts/security-workflow-contract.test.mjs scripts/coderabbit-config-contract.test.mjs scripts/windows-nsis-contract.test.mjs
```

Expected: all policy matrices and workflow contracts pass.

- [ ] **Step 2: Run required repository gates**

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm audit --audit-level=high --omit=dev
git diff --check
```

Expected: every command exits 0 and audit reports zero high-or-greater production vulnerabilities.

- [ ] **Step 3: Publish a draft PR**

```bash
git status --short --branch
git fetch origin test
git rev-list --left-right --count origin/test...HEAD
git log --oneline origin/test..HEAD
git push -u origin codex/finding-only-scanner-gates
gh pr create --base test --head codex/finding-only-scanner-gates --draft --title "ci: block only on confirmed scanner findings" --body "Implements the approved finding-only scanner policy. External rate limits, bounded timeouts, and service outages warn without blocking; findings and configuration failures remain blocking."
```

Expected: zero remote-only commits and an intentional draft PR.

- [ ] **Step 4: Mark stable revision ready and require real scans**

Run `gh pr ready <number>` after the final implementation push. Wait for Build, Sonar, Snyk, and the currently required CodeRabbit status. Inspect Sonar/Snyk logs and summaries; this rollout requires actual clean scans rather than a green unavailable warning. Require CodeRabbit review when allowance is available and address every actionable finding.

- [ ] **Step 5: Merge after green checks**

Use auto-merge or merge after required checks succeed. Fetch `test`, switch locally, fast-forward only, and record the exact merge commit. Do not change protection before this PR's CodeRabbit status completes under the old base configuration.

- [ ] **Step 6: Remove only CodeRabbit's availability context**

```bash
printf '%s' '{"contexts":["CodeRabbit"]}' | gh api --method DELETE repos/CrimsonSoul/Relay/branches/test/protection/required_status_checks/contexts --input -
```

Verify:

```bash
gh api repos/CrimsonSoul/Relay/branches/test/protection --jq '{checks:.required_status_checks.checks,strict:.required_status_checks.strict,conversations:.required_conversation_resolution.enabled,reviews:.required_pull_request_reviews.required_approving_review_count,admins:.enforce_admins.enabled,force:.allow_force_pushes.enabled,deletions:.allow_deletions.enabled}'
```

Expected: exactly Build, Sonar, and Snyk; strict, conversations, and admin enforcement true; zero human approvals; force/deletion false.

- [ ] **Step 7: Verify post-merge Windows and security runs**

Inspect exact merge-SHA runs. Require successful Windows packaging and Windows artifact, with no Mac job/artifact. Confirm security either completed real scans or clearly warned that no decision was produced without affecting Windows packaging.

- [ ] **Step 8: Prove final alignment**

```bash
git fetch origin test
git rev-parse HEAD origin/test
git rev-list --left-right --count origin/test...HEAD
git ls-remote origin refs/heads/test
git status --short --branch
```

Expected: identical local/remote/GitHub SHA, divergence `0 0`, clean worktree.

---

## Final Acceptance Matrix

| Event                                                | Sonar check    | Snyk check     | CodeRabbit                     | Windows build                       |
| ---------------------------------------------------- | -------------- | -------------- | ------------------------------ | ----------------------------------- |
| Clean completed scan                                 | Pass           | Pass           | Approve/no blocking findings   | Produced after merge                |
| Confirmed policy finding                             | Fail           | Fail           | Request changes                | No merge                            |
| HTTP 429 or HTTP 5xx                                 | Warning + pass | Warning + pass | Rate-limit warning/pass        | Produced after merge                |
| Bounded external timeout                             | Warning + pass | Warning + pass | Missing review does not block  | Produced after merge                |
| Invalid token or organization/project configuration | Fail           | Fail           | Configuration remains visible  | No merge                            |
| Malformed or ambiguous scanner response              | Fail           | Fail           | Conversations require handling | No merge                            |
| Rapid intermediate draft pushes                     | Latest only    | Latest only    | Draft skipped                  | No branch build before merge        |
| New `test` push supersedes an old run                | Latest runs    | Latest runs    | Not packaging-dependent        | Newest tip artifact authoritative   |
