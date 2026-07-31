# Test Branch Security Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear Relay's current Sonar findings and convert `test` into a protected pull-request branch that requires build, SonarQube, and Snyk gates before an agent-authorized automatic merge.

**Architecture:** Keep the existing Sonar and Snyk scripts as the scanner authority, extend their GitHub Actions event coverage to internal pull requests, and add a small repository-level workflow contract test so the PR and post-merge boundaries cannot silently drift. Land the verified bootstrap pull request before enabling branch protection, then require the stable job names through GitHub's branch-protection API and preserve the agent-operated “push to test” flow in `AGENTS.md`.

**Tech Stack:** TypeScript, React, Vitest, Node test runner, GitHub Actions YAML, SonarQube Cloud, Snyk CLI, GitHub CLI and REST API

## Global Constraints

- Preserve the four pre-existing unstaged Radar-polish files exactly and never stage, reformat, commit, or publish them without separate user authorization.
- Keep existing Relay client/server, Electron, Relay Web, PocketBase, offline, backup, and packaging behavior unchanged.
- Resolve Sonar findings with behavior-preserving source changes; record an exception only when a source change would be wrong and the evidence is explicit.
- Run Snyk Open Source and Code on internal pull requests to `test`; run `snyk monitor` only on the merged `test` push.
- Keep scanner secrets out of forked pull requests and do not introduce `pull_request_target`.
- Require `Build quality gate`, `SonarQube quality gate`, and `Snyk security gate` before merge.
- Require a pull request with zero human approvals, enforce the rule for administrators, and disable direct pushes, force pushes, and branch deletion.
- Treat the user's “push to test” instruction as authorization to merge automatically only after every required check is green.
- Apply branch protection only after GitHub has emitted and passed all three stable contexts on the bootstrap pull request.
- Run Electron and Web suites through their npm scripts so native-module ABI restoration remains intact.

---

### Task 1: Lock the PR and post-merge workflow contract

**Files:**
- Create: `scripts/security-workflow-contract.test.mjs`
- Modify: `.github/workflows/build.yml:10-25`
- Modify: `.github/workflows/security.yml:127-177`
- Modify: `docs/DEVELOPMENT.md:383-416`
- Modify: `docs/SECURITY.md:189-214`
- Modify: `AGENTS.md:80-100`

**Interfaces:**
- Consumes: existing `Build and Package` and `Security and Code Quality` workflow names, the three approved stable job names, and existing npm scanner scripts.
- Produces: PR-time `Build quality gate` and `Snyk security gate` checks, push-only Snyk monitoring, and canonical PR publication instructions for later tasks.

- [ ] **Step 1: Add a failing workflow contract test**

Create `scripts/security-workflow-contract.test.mjs` with this complete contract:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');

const [buildWorkflow, securityWorkflow] = await Promise.all([
  readFile(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/security.yml', import.meta.url), 'utf8'),
]);

test('test pull requests emit the stable build quality gate', () => {
  assert.match(
    buildWorkflow,
    /pull_request:\s+branches:\s+- main\s+- test/u,
  );
  assert.match(buildWorkflow, /quality:\s+name: Build quality gate/u);
});

test('Snyk scans internal test pull requests and monitors only merged test pushes', () => {
  const snykJobStart = securityWorkflow.indexOf('\n  snyk:');
  assert.ok(snykJobStart >= 0, 'missing Snyk job');
  const snykJob = securityWorkflow.slice(snykJobStart);

  assert.match(snykJob, /name: Snyk security gate/u);
  assert.match(snykJob, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/test'/u);
  assert.match(snykJob, /github\.event_name == 'pull_request'/u);
  assert.match(snykJob, /github\.event\.pull_request\.base\.ref == 'test'/u);
  assert.match(
    snykJob,
    /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/u,
  );

  assert.match(
    snykJob,
    /Update the Snyk test-branch dependency snapshot[\s\S]*?if:\s+>-?\s+github\.event_name == 'push' &&\s+github\.ref == 'refs\/heads\/test'/u,
  );
});
```

- [ ] **Step 2: Run the contract test and confirm the intended RED state**

Run:

```bash
npx vitest run scripts/security-workflow-contract.test.mjs
```

Expected: both tests fail because `build.yml` does not include `test` under `pull_request`, the quality job has no stable `name`, Snyk is push-only, and its monitor step has no push guard.

- [ ] **Step 3: Make the build quality job available to `test` pull requests**

Change the top of `.github/workflows/build.yml` to:

```yaml
  pull_request:
    branches:
      - main
      - test

jobs:
  quality:
    name: Build quality gate
    runs-on: ubuntu-latest
```

Do not change `package-windows`; its existing `if` keeps packaging on manual runs and merged branch pushes only.

- [ ] **Step 4: Make the pinned Snyk CLI gate run on trusted `test` pull requests**

Replace the Snyk job condition in `.github/workflows/security.yml` with:

```yaml
    if: >-
      (github.event_name == 'push' && github.ref == 'refs/heads/test') ||
      (github.event_name == 'pull_request' &&
       github.event.pull_request.base.ref == 'test' &&
       github.event.pull_request.head.repo.full_name == github.repository)
```

Add this condition to `Update the Snyk test-branch dependency snapshot`:

```yaml
        if: >-
          github.event_name == 'push' &&
          github.ref == 'refs/heads/test'
```

Leave the existing credential checks, `--severity-threshold=high`, `--target-reference=test`, and remote repository URL arguments unchanged.

- [ ] **Step 5: Run the workflow contract and existing Sonar workflow tests**

Run:

```bash
npx vitest run scripts/security-workflow-contract.test.mjs scripts/sonar-reviewed-issues.test.mjs scripts/sonar-open-findings.test.mjs scripts/sonar-quality-gate.test.mjs
```

Expected: all workflow and Sonar tests pass.

- [ ] **Step 6: Update the live security and contributor documentation**

Update `docs/DEVELOPMENT.md` and `docs/SECURITY.md` so they state:

```text
Internal pull requests targeting test run the pinned SonarQube, Snyk Open Source,
Snyk Code, and build quality gates. Pull-request scans never change Sonar issue
state or the canonical Snyk monitored snapshot. After merge, the test push repeats
the scanners, reconciles only the pinned Sonar review manifest, and updates the
Snyk snapshot identified by target-reference test.
```

Replace `AGENTS.md`'s direct-push section with the protected publication contract:

```markdown
## Publishing to `origin/test`

- “Push the changes to test” authorizes the full verified tip to enter `test`
  through a temporary `codex/` branch and pull request; it does not authorize a
  direct push or a partial cherry-pick.
- Fetch `origin/test`, prove there are no remote-only commits, push the exact
  verified tip to the temporary branch, and open a pull request targeting `test`.
- Require `Build quality gate`, `SonarQube quality gate`, and `Snyk security gate`.
  A queued, skipped, cancelled, neutral, or stale check is not success.
- The agent may enable automatic merge after the user says “push to test.” Merge
  only when every required check is successful. Diagnose and repair in-scope
  failures on the same pull request; stop for user direction if a repair requires
  new authority or unrelated work.
- After merge, fetch `test`, fast-forward the local `test` branch, and prove local
  `HEAD` and `origin/test` match with final divergence `0 0`. Report the pull
  request, merge commit, checks, and any post-merge packaging still running.
```

- [ ] **Step 7: Format, inspect, and commit the workflow contract**

Run:

```bash
npx prettier --check .github/workflows/build.yml .github/workflows/security.yml scripts/security-workflow-contract.test.mjs docs/DEVELOPMENT.md docs/SECURITY.md AGENTS.md
git diff --check
git diff -- .github/workflows/build.yml .github/workflows/security.yml scripts/security-workflow-contract.test.mjs docs/DEVELOPMENT.md docs/SECURITY.md AGENTS.md
```

Stage only those six files and commit:

```bash
git add .github/workflows/build.yml .github/workflows/security.yml scripts/security-workflow-contract.test.mjs docs/DEVELOPMENT.md docs/SECURITY.md AGENTS.md
git commit -m "ci: require security gates before test merges"
```

Expected: the commit contains the workflow contract, workflow changes, and canonical documentation only.

---

### Task 2: Clear the main-process Sonar findings without changing behavior

**Files:**
- Modify: `src/main/handlers/loggerHandlers.ts:18-30`
- Test: `src/main/handlers/loggerHandlers.test.ts:233-295`
- Modify: `src/main/knowledge/KnowledgeSearchIndexer.ts:239-244`
- Test: `src/main/knowledge/__tests__/KnowledgeSearchIndexer.test.ts:1114-1136`
- Modify: `src/renderer/src/components/__tests__/HeaderSearch.test.tsx:367-378`

**Interfaces:**
- Consumes: `boundRendererLogData(data, depth)`, `pendingRemovals`, and Testing Library's already-wrapped `fireEvent` helpers.
- Produces: the same bounded logger payloads, snapshot-safe pending-removal iteration, and equivalent HeaderSearch geometry coverage without redundant `act()` wrappers.

- [ ] **Step 1: Run the existing characterization tests**

Run:

```bash
npx vitest run src/main/handlers/loggerHandlers.test.ts src/main/knowledge/__tests__/KnowledgeSearchIndexer.test.ts
npm run test:renderer -- src/renderer/src/components/__tests__/HeaderSearch.test.tsx
```

Expected: all existing logger, removal-retry, and HeaderSearch geometry tests pass before source cleanup.

- [ ] **Step 2: Narrow non-object logger primitives explicitly**

Replace the generic non-object conversion in `boundRendererLogData` with explicit branches:

```ts
  if (typeof data === 'bigint') return data.toString();
  if (typeof data === 'symbol' || typeof data === 'function') {
    return `[Unsupported ${typeof data}]`;
  }
```

Keep the earlier string, number, boolean, null, and undefined branches and the later object depth bounding intact. The existing bigint tests must continue to prove JSON-safe output.

- [ ] **Step 3: Preserve pending-removal snapshot semantics without array conversion**

Change the removal sweep to iterate a Set snapshot:

```ts
  private async sweepPendingRemovals(): Promise<void> {
    const pendingRemovals = new Set(this.pendingRemovals);
    for (const documentId of pendingRemovals) {
      if (this.disposed) return;
      await this.trackRemoval(this.removePermanently(documentId));
    }
  }
```

This keeps removals added during an awaited sweep for the next scheduled pass, matching the old array snapshot behavior.

- [ ] **Step 4: Remove only the redundant Testing Library wrappers**

Change the two HeaderSearch event blocks to:

```ts
        rectSpy.mockReturnValue(rectAt(0));
        fireEvent.scroll(document);
        expect(dropdown.style.top).toBe('40px');

        rectSpy.mockReturnValue(rectAt(96));
        fireEvent(window, new Event('resize'));
        expect(dropdown.style.top).toBe('136px');
```

Retain `act()` around fake-timer advancement because that operation still flushes a timer-driven React update directly.

- [ ] **Step 5: Rerun focused tests and commit**

Run:

```bash
npx vitest run src/main/handlers/loggerHandlers.test.ts src/main/knowledge/__tests__/KnowledgeSearchIndexer.test.ts
npm run test:renderer -- src/renderer/src/components/__tests__/HeaderSearch.test.tsx
npx eslint src/main/handlers/loggerHandlers.ts src/main/knowledge/KnowledgeSearchIndexer.ts src/renderer/src/components/__tests__/HeaderSearch.test.tsx
npx prettier --check src/main/handlers/loggerHandlers.ts src/main/knowledge/KnowledgeSearchIndexer.ts src/renderer/src/components/__tests__/HeaderSearch.test.tsx
git diff --check
```

Stage only the listed files and commit:

```bash
git add src/main/handlers/loggerHandlers.ts src/main/knowledge/KnowledgeSearchIndexer.ts src/renderer/src/components/__tests__/HeaderSearch.test.tsx
git commit -m "fix: clear main-process Sonar findings"
```

---

### Task 3: Clear the Knowledge renderer findings with semantic coverage

**Files:**
- Modify: `src/renderer/src/features/knowledge/KnowledgeContinuousPdf.tsx:317-324`
- Test: `src/renderer/src/features/knowledge/__tests__/KnowledgeContinuousPdf.test.tsx:272-410`
- Modify: `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx:543-558`
- Test: `src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx:176-219`
- Modify: `src/renderer/src/features/knowledge/useKnowledgeManagement.ts:725-839`
- Test: `src/renderer/src/features/knowledge/__tests__/useKnowledgeManagement.test.tsx`

**Interfaces:**
- Consumes: pending PDF scroll requests, native `<output>` status semantics, optional `BridgeAPI` upload-control methods, and `runUploadControl`.
- Produces: unchanged scroll timing and upload-control calls plus native status outputs that remain discoverable through the implicit `status` role.

- [ ] **Step 1: Strengthen the management status characterization test**

Extend `shows aggregate readiness only while documents remain unsearchable` with:

```ts
    const readinessOutput = screen.getByText('1 of 3 searchable');
    expect(readinessOutput).toBeVisible();
    expect(readinessOutput.tagName).toBe('OUTPUT');
    expect(screen.getByText('3 shown · 3 loaded').tagName).toBe('OUTPUT');
```

Run:

```bash
npm run test:renderer -- src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx
```

Expected: the new tag-name assertions fail while the component still renders `<span role="status">`.

- [ ] **Step 2: Split the PDF pending-scroll guard without weakening it**

Change the effect guard to:

```ts
  useEffect(() => {
    const pendingScroll = pendingScrollRef.current;
    if (!pendingScroll) return;
    if (pendingScroll.pdf !== pdf || measuredThrough < pendingScroll.pageIndex) return;
    pendingScrollRef.current = null;
    applyScrollRequest(pendingScroll);
  }, [applyScrollRequest, measuredThrough, pdf]);
```

Do not replace the guard with an optional-chain expression that can fall through when both values are absent.

- [ ] **Step 3: Use native output elements for document counts**

Replace both count spans with:

```tsx
                {searchableDocumentCount !== documents.length && (
                  <output className="knowledge-management__searchable-count">
                    {searchableDocumentCount} of {documents.length} searchable
                  </output>
                )}
                <output className="knowledge-management__searchable-count">
                  {filteredDocuments.length} shown · {documents.length} loaded
                  {snapshot.documents.nextCursor ? ' · more available' : ''}
                </output>
```

The class remains unchanged, so layout and styling retain the existing contract.

- [ ] **Step 4: Resolve optional bridge methods into stable callable constants**

For cancellation, use:

```ts
      const cancelKnowledgeUpload = globalThis.api?.cancelKnowledgeUpload;
      const cancelDirectly = cancelKnowledgeUpload
        ? () => cancelKnowledgeUpload(uploadId)
        : undefined;
```

For each returned batch/upload controller, follow this exact pattern:

```ts
    pauseUploadBatch: (batchId: string) => {
      const pauseKnowledgeUploadBatch = globalThis.api?.pauseKnowledgeUploadBatch;
      return runUploadControl(
        `pause:${batchId}`,
        pauseKnowledgeUploadBatch ? () => pauseKnowledgeUploadBatch(batchId) : undefined,
        'Relay could not pause this upload batch.',
      );
    },
```

Apply the same callable-constant structure to `resumeKnowledgeUploadBatch`, `retryKnowledgeUpload`, `reselectKnowledgeUploadSource`, and `cancelKnowledgeUploadBatch`. Update the nearby comment to state that each closure captures the exact callable whose presence was checked.

- [ ] **Step 5: Run the complete focused Knowledge test set**

Run:

```bash
npm run test:renderer -- src/renderer/src/features/knowledge/__tests__/KnowledgeContinuousPdf.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx src/renderer/src/features/knowledge/__tests__/useKnowledgeManagement.test.tsx
npx eslint src/renderer/src/features/knowledge/KnowledgeContinuousPdf.tsx src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx src/renderer/src/features/knowledge/useKnowledgeManagement.ts src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx
npx prettier --check src/renderer/src/features/knowledge/KnowledgeContinuousPdf.tsx src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx src/renderer/src/features/knowledge/useKnowledgeManagement.ts src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx
git diff --check
```

Expected: all focused tests, lint, formatting, and diff checks pass.

- [ ] **Step 6: Commit the Knowledge cleanup**

```bash
git add src/renderer/src/features/knowledge/KnowledgeContinuousPdf.tsx src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx src/renderer/src/features/knowledge/useKnowledgeManagement.ts src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx
git commit -m "fix: clear Knowledge Sonar findings"
```

---

### Task 4: Clear the remaining renderer utility findings

**Files:**
- Modify: `src/renderer/src/hooks/useFocusTrap.ts:79-84`
- Test: `src/renderer/src/hooks/__tests__/useFocusTrap.test.ts:82-148`
- Modify: `src/renderer/src/tabs/alertUtils.tsx:110-116`
- Test: `src/renderer/src/tabs/__tests__/alertUtils.test.ts:214-240`
- Modify: `src/renderer/src/utils/timeParsing.ts:15-18`
- Test: `src/renderer/src/utils/__tests__/timeParsing.test.ts:85-120`
- Modify: `src/renderer/src/components/sidebar/SidebarDashboards.tsx:124-140`
- Test: `src/renderer/src/components/__tests__/sidebar/SidebarDashboards.test.tsx:44-64`

**Interfaces:**
- Consumes: ordered focusable element arrays, DOM `dataset`, day-range regular expressions, and dashboard menu focus state.
- Produces: the same focus wrapping, sanitized highlight markup, time-window matching, and dashboard keyboard navigation through clearer platform-native operations.

- [ ] **Step 1: Run the utility characterization tests**

```bash
npm run test:renderer -- src/renderer/src/hooks/__tests__/useFocusTrap.test.ts src/renderer/src/tabs/__tests__/alertUtils.test.ts src/renderer/src/utils/__tests__/timeParsing.test.ts src/renderer/src/components/__tests__/sidebar/SidebarDashboards.test.tsx
```

Expected: all existing behavioral tests pass before cleanup.

- [ ] **Step 2: Apply the four behavior-preserving platform-native forms**

Use `.at(-1)` in the focus trap:

```ts
      const firstElement = focusableElements[0]!;
      const lastElement = focusableElements.at(-1)!;
```

Read the sanitizer marker through `dataset`:

```ts
    if (tag === 'span') {
      const hlType = (el as HTMLElement).dataset.hl;
      if (hlType && (HIGHLIGHT_TYPES as readonly string[]).includes(hlType)) {
        return `<span data-hl="${escapeHtml(hlType)}">${children}</span>`;
      }
    }
```

Use a normal string for the regex fragment that contains no escapes:

```ts
  const day = '(mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?';
  const separator = String.raw`\s*(?:-|to|through)\s*`;
```

Use direct identity lookup for dashboard focus:

```ts
    const focusedIndex = Math.max(
      0,
      items.indexOf(document.activeElement as HTMLButtonElement),
    );
```

- [ ] **Step 3: Rerun focused tests and commit**

Run:

```bash
npm run test:renderer -- src/renderer/src/hooks/__tests__/useFocusTrap.test.ts src/renderer/src/tabs/__tests__/alertUtils.test.ts src/renderer/src/utils/__tests__/timeParsing.test.ts src/renderer/src/components/__tests__/sidebar/SidebarDashboards.test.tsx
npx eslint src/renderer/src/hooks/useFocusTrap.ts src/renderer/src/tabs/alertUtils.tsx src/renderer/src/utils/timeParsing.ts src/renderer/src/components/sidebar/SidebarDashboards.tsx
npx prettier --check src/renderer/src/hooks/useFocusTrap.ts src/renderer/src/tabs/alertUtils.tsx src/renderer/src/utils/timeParsing.ts src/renderer/src/components/sidebar/SidebarDashboards.tsx
git diff --check
```

Stage only the four source files and commit:

```bash
git add src/renderer/src/hooks/useFocusTrap.ts src/renderer/src/tabs/alertUtils.tsx src/renderer/src/utils/timeParsing.ts src/renderer/src/components/sidebar/SidebarDashboards.tsx
git commit -m "fix: clear renderer Sonar findings"
```

---

### Task 5: Verify the exact committed enforcement candidate

**Files:**
- Verify only: all files committed in Tasks 1-4 plus the pre-existing Relay Web parity commits

**Interfaces:**
- Consumes: the exact committed branch tip, verified independently from the unstaged Radar overlays.
- Produces: fresh local evidence suitable for creating the bootstrap enforcement pull request.

- [ ] **Step 1: Audit commit and working-tree scope**

Run:

```bash
git status --short --branch
git fetch origin test
git rev-list --left-right --count origin/test...HEAD
git log --oneline origin/test..HEAD
git diff --cached --name-status
git diff --name-status
```

Expected: zero remote-only commits; no staged files; the only working-tree files are the four protected Radar-polish files.

- [ ] **Step 2: Run the required repository gates**

Run each command and require exit code zero:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:coverage:sonar
npm run test:electron
npm run test:web
npm audit --audit-level=high --omit=dev
git diff --check origin/test...HEAD
git diff --check
git diff --cached --check
```

Expected: all static checks, tests, builds, coverage generation, Electron scenarios, Web browser profiles, dependency audit, and diff checks pass.

- [ ] **Step 3: Prove the exact committed tree independently of the Radar overlays**

Create a disposable detached worktree at the exact `HEAD`, install from `package-lock.json`, and repeat at minimum:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:electron
npm run test:web
npm audit --audit-level=high --omit=dev
git diff --check
```

Remove only that disposable worktree after verifying it is clean. Expected: the exact push candidate is green without the four unstaged Radar files.

---

### Task 6: Publish and validate the bootstrap enforcement pull request

**Files:**
- External GitHub state: remote branch `codex/test-security-enforcement`
- External GitHub state: one pull request targeting `test`

**Interfaces:**
- Consumes: the verified committed `HEAD`, active Actions credentials, and the three stable check names.
- Produces: a green pull request whose merge introduces PR-time checks before branch protection is enabled.

- [ ] **Step 1: Push the exact candidate to the temporary branch**

Re-fetch and require `origin/test...HEAD` to have zero remote-only commits, then run:

```bash
git push origin HEAD:refs/heads/codex/test-security-enforcement
```

Expected: only the intended committed tip is published; the four unstaged files remain local.

- [ ] **Step 2: Open the pull request**

```bash
gh pr create --base test --head codex/test-security-enforcement --title "Enforce security gates before test merges" --body-file docs/superpowers/specs/2026-07-31-test-branch-security-enforcement-design.md
```

Record the returned pull-request URL. Do not merge while a required job is queued, skipped, cancelled, neutral, stale, or failing.

- [ ] **Step 3: Monitor all three stable contexts**

```bash
gh pr checks codex/test-security-enforcement --watch --interval 15
```

Expected successful contexts:

```text
Build quality gate
SonarQube quality gate
Snyk security gate
```

Inspect the Snyk job metadata and prove `Update the Snyk test-branch dependency snapshot` is skipped on the pull request.

- [ ] **Step 4: Handle bootstrap event-discovery failure without weakening the gate**

If GitHub does not emit one of the three contexts, inspect the run list and exact workflow file used by the PR. Do not merge and do not configure branch protection around a missing context. Push the smallest workflow-only correction to the same temporary branch, wait for a new PR synchronization event, and require the complete three-context run before continuing.

- [ ] **Step 5: Handle scanner findings from the exact PR analysis**

For a failing job, inspect it with:

```bash
RELAY_SECURITY_RUN_ID="$(gh run list --branch codex/test-security-enforcement --workflow security.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run view "$RELAY_SECURITY_RUN_ID" --json name,conclusion,status,url,event,headBranch,headSha,jobs
gh run view "$RELAY_SECURITY_RUN_ID" --log-failed
```

If Sonar reports a new issue, set `RELAY_PR_NUMBER="$(gh pr view codex/test-security-enforcement --json number --jq .number)"`, inspect the exact issue set from the failed job log and SonarQube pull-request dashboard, validate the finding against the exact source, apply the smallest behavior-preserving fix and focused regression, commit, push to the same temporary branch, and wait for all three contexts again. Do not add a reviewed-issue manifest entry for a pull-request issue.

- [ ] **Step 6: Merge only after the live contexts are green**

Because branch protection is not enabled until Task 7, manually enforce the approved condition:

```bash
gh pr checks codex/test-security-enforcement
gh pr merge codex/test-security-enforcement --merge --delete-branch
```

Run the merge command only after the check listing shows all three approved contexts successful. Record the merge commit from `gh pr view --json mergeCommit,url,state`.

---

### Task 7: Apply and prove GitHub enforcement

**Files:**
- External GitHub state: repository auto-merge setting
- External GitHub state: classic branch protection for `test`
- Local Git state: fast-forwarded `test` branch

**Interfaces:**
- Consumes: the merged workflow definitions and the three contexts proven by Task 6.
- Produces: administrator-enforced PR-only publication with automatic green merge support.

- [ ] **Step 1: Align the local branch with the merged `test` tip**

```bash
git fetch origin test
git merge --ff-only origin/test
git rev-parse HEAD origin/test
git rev-list --left-right --count origin/test...HEAD
git status --short --branch
```

Expected: matching hashes, divergence `0 0`, and the same four unstaged Radar files.

- [ ] **Step 2: Enable repository auto-merge support**

```bash
gh api --method PATCH repos/CrimsonSoul/Relay -F allow_auto_merge=true
```

Expected: the repository response reports `allow_auto_merge: true`.

- [ ] **Step 3: Apply strict branch protection**

Send this exact JSON body to `PUT /repos/CrimsonSoul/Relay/branches/test/protection`:

```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Build quality gate",
      "SonarQube quality gate",
      "Snyk security gate"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
```

Send the JSON without creating a repository file:

```bash
gh api --method PUT repos/CrimsonSoul/Relay/branches/test/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Build quality gate",
      "SonarQube quality gate",
      "Snyk security gate"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON
```

- [ ] **Step 4: Query the live policy and compare every field**

```bash
gh api repos/CrimsonSoul/Relay/branches/test/protection
gh api repos/CrimsonSoul/Relay --jq '{allow_auto_merge,allow_merge_commit,allow_squash_merge,allow_rebase_merge}'
gh api repos/CrimsonSoul/Relay/rulesets
```

Expected live state:

```text
required status checks: strict
contexts: Build quality gate, SonarQube quality gate, Snyk security gate
pull request required: yes
required approvals: 0
administrator enforcement: enabled
force pushes: disabled
deletion: disabled
conversation resolution: required
auto merge: enabled
```

Do not attempt a destructive or deliberately failing direct push as the enforcement test.

- [ ] **Step 5: Verify the post-merge security run**

Find the `Security and Code Quality` run for the merge commit and wait for completion:

```bash
RELAY_MERGE_SHA="$(gh pr view codex/test-security-enforcement --json mergeCommit --jq .mergeCommit.oid)"
RELAY_SECURITY_RUN_ID="$(gh run list --workflow security.yml --branch test --limit 5 --json databaseId,headSha --jq "map(select(.headSha == \"$RELAY_MERGE_SHA\"))[0].databaseId")"
gh run watch "$RELAY_SECURITY_RUN_ID" --exit-status
```

Require both SonarQube and Snyk jobs to pass, and prove the push-only Snyk monitor step ran successfully.

---

### Task 8: Prove the future automatic “push to test” contract

**Files:**
- Verify only: GitHub repository settings, merged documentation, and local worktree

**Interfaces:**
- Consumes: protected `test`, repository auto-merge support, and the updated `AGENTS.md` publication contract.
- Produces: final operational evidence and the repeatable flow for later user requests.

- [ ] **Step 1: Re-read the merged publication contract and live settings**

Confirm the merged `AGENTS.md` requires a `codex/` branch, pull request, the three required contexts, automatic merge only after green, and final `0 0` divergence. Compare it to the live branch-protection response field by field.

- [ ] **Step 2: Record the next-request command sequence**

For the next user-authorized “push to test,” use:

```bash
git fetch origin test
git rev-list --left-right --count origin/test...HEAD
RELAY_TASK_BRANCH="codex/test-$(date -u +%Y%m%d-%H%M%S)"
git push origin "HEAD:refs/heads/$RELAY_TASK_BRANCH"
gh pr create --base test --head "$RELAY_TASK_BRANCH" --fill
gh pr merge "$RELAY_TASK_BRANCH" --auto --merge --delete-branch
gh pr checks "$RELAY_TASK_BRANCH" --watch --interval 15
git fetch origin test
git merge --ff-only origin/test
git rev-list --left-right --count origin/test...HEAD
```

- [ ] **Step 3: Deliver the enforcement report**

Report:

- the enforcement pull-request URL and merge commit;
- the three required PR checks and their successful run URLs;
- the successful post-merge Sonar and Snyk run, including Snyk monitor;
- the exact branch-protection and auto-merge settings;
- local and remote `test` hashes with divergence `0 0`; and
- confirmation that the four unstaged Radar files remain intact and unpublished.
