# Test Branch Security Enforcement Design

**Date:** 2026-07-31

**Status:** Approved for implementation planning

**Scope:** Clear the current Sonar findings, make Relay's security and quality checks run before merge, and enforce a fast agent-operated pull-request path into `test`

## Problem

Relay's `Security and Code Quality` workflow is active and event-driven, and its credentials are configured. The most recent `test` run proves that Snyk completes successfully and SonarCloud accepts and processes the analysis. The overall run is red because the Sonar reconciliation gate correctly rejects 16 unreviewed open issues: 14 minor code smells and 2 major code smells.

The checks are not currently preventative. `test` has no branch protection or repository ruleset, so a direct push lands before GitHub evaluates it. The build workflow also runs pull requests only when they target `main`, while Snyk is limited to pushes to `test`. A pull request into `test` therefore cannot demonstrate all of the checks that should be required before merge.

## Goals

- Resolve or evidence-review all 16 current Sonar findings without changing Relay behavior unnecessarily.
- Run the build quality job, SonarQube gate, and Snyk gate on every internal pull request targeting `test`.
- Keep Snyk's monitored `test` snapshot tied to the merged branch rather than temporary pull-request revisions.
- Prevent direct pushes, force pushes, and branch deletion on `test`, including administrator bypasses.
- Require the stable build, Sonar, and Snyk check contexts before merge.
- Require a pull request without requiring a separate human approval for the user's own agent-operated changes.
- Allow Codex to create the temporary branch and pull request, monitor checks, repair legitimate failures, and merge automatically after every required check is green when the user says “push to test.”
- Preserve all unrelated and unstaged user work throughout the transition.

## Approaches considered

### Protected pull requests with required checks — selected

Run every required gate on internal pull requests, protect `test`, and merge automatically only after GitHub reports all required contexts successful. This is the only approach that prevents a failing revision from landing while preserving a quick, mostly unattended user workflow.

### Repository ruleset

A repository ruleset can express similar requirements and is useful when one policy spans many branches or repositories. Relay needs one focused policy on `test`; classic branch protection is easier to inspect and maintain for this scope.

### Post-push scanning with alerts or rollback

Keeping direct pushes would be faster at the instant of publication, but a failing revision would already be on `test`. Automated rollback would add another write, can race later pushes, and does not satisfy the requirement that checks pass before changes enter the branch.

## Workflow design

### Build and test quality

Extend `Build and Package` so pull requests targeting `test` run its Ubuntu quality job. Give that job a stable displayed name, `Build quality gate`, so branch protection can require an intentional contract rather than an incidental job identifier.

Windows packaging remains a post-merge `test` push job. It is valuable release evidence but is too slow and platform-specific to sit in the short pre-merge loop for every change. Existing local verification and the post-merge packaging run remain required evidence before release claims.

### SonarQube

Keep the current Sonar behavior for pushes to `test` and internal pull requests targeting `test`:

1. install from the lockfile;
2. generate LCOV coverage;
3. upload the exact revision;
4. wait for that exact analysis;
5. reject unreviewed open or confirmed issues; and
6. verify the exact quality gate.

The branch-push-only reviewed-issue reconciliation remains after merge. Pull requests must not rewrite Sonar issue state. The stable required context is `SonarQube quality gate`.

### Snyk

Run Snyk Open Source and Snyk Code for both:

- pushes to `test`; and
- internal pull requests whose base branch is `test`.

Continue to require `SNYK_TOKEN` and `SNYK_ORG` explicitly. Do not expose Actions secrets to forked pull requests and do not switch to `pull_request_target`, which would execute privileged scanning in a less trustworthy context.

The `snyk monitor` snapshot update runs only after a successful push to the merged `test` branch. Pull-request scans are ephemeral validation and must not replace the canonical monitored branch snapshot. The stable required context is `Snyk security gate`.

## Current Sonar cleanup

Treat each of the 16 current Sonar issues as a focused maintenance item:

- prefer behavior-preserving source changes for stringification, optional chaining, accessible status output, dataset access, direct index lookup, iterable use, focus-list indexing, and unnecessary raw strings;
- remove redundant test `act()` wrappers only where the Testing Library call already flushes updates;
- retain or expand focused regression coverage for any change whose behavior is not purely syntactic; and
- mark an issue reviewed or false-positive only when a source change would be incorrect and the repository can record specific evidence for that decision.

No issue is closed merely to make the gate green. After the source changes pass locally, the pull-request Sonar analysis is the authority for whether the exact revision has zero unresolved issues and a passing quality gate.

## GitHub enforcement

Apply branch protection only after the workflow changes have landed and one pull request has demonstrated the stable check names. This avoids locking `test` behind a status context that GitHub has never emitted.

Protect `test` with:

- required pull requests before merging;
- zero required human approvals;
- strict required status checks against the current `test` tip;
- required contexts `Build quality gate`, `SonarQube quality gate`, and `Snyk security gate`;
- administrator enforcement enabled;
- force pushes disabled;
- branch deletion disabled; and
- conversation resolution required when review conversations exist.

Enable repository auto-merge support. The agent may request merge automatically after checks succeed because the user's “push to test” instruction is the merge authorization. The policy must not include a user or administrator bypass that silently restores direct pushes.

## Agent-operated push flow

After enforcement, “push to test” means:

1. inspect and preserve the working tree;
2. verify the intended commit scope and fetch `origin/test`;
3. create or update a temporary `codex/` branch without including unrelated changes;
4. push the exact verified tip and open a pull request into `test`;
5. enable or perform automatic merge after required checks pass;
6. monitor GitHub Actions without treating a queued or running job as success;
7. diagnose legitimate failures from their logs, make the smallest approved in-scope repair, push it to the same pull request, and wait again;
8. merge only after every required context is successful;
9. fetch `test` and verify the merged revision and final divergence; and
10. report the pull request, merge commit, required-check results, and any post-merge checks still running.

If a failure requires a product decision, new authority, or unrelated work, automatic repair stops and the user receives the evidence instead of an unsafe guess.

## Error and recovery behavior

- Missing Sonar or Snyk credentials fail visibly; the workflow never silently skips a required scanner.
- A scanner service outage leaves the pull request unmerged until the check can be rerun successfully.
- A superseded workflow run may be cancelled by concurrency, but the newest revision must receive its own complete required checks.
- A new Sonar or Snyk finding blocks merge and is handled as a real finding until validated otherwise.
- A renamed or missing required check blocks protection rollout; discover the emitted context from a successful pull request before applying the policy.
- Post-merge Windows packaging failure does not undo the protected merge, but it blocks packaging or release readiness and must be reported and repaired separately.

## Verification strategy

### Focused source verification

Run tests covering every behavior-bearing Sonar change, including logger formatting, Knowledge management status output, focus trapping, alert dataset access, and affected renderer utilities. Pure syntax simplifications retain the surrounding existing tests.

### Repository verification

Before publishing the enforcement pull request, run:

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
git diff --check
```

### Live CI verification

On the enforcement pull request, require fresh successful results for:

- `Build quality gate`;
- `SonarQube quality gate`; and
- `Snyk security gate`.

Confirm that the Snyk monitor step is skipped on the pull request and runs on the subsequent `test` push. After branch protection is applied, query GitHub directly to prove the exact required contexts, administrator enforcement, pull-request requirement, and disabled force-push/deletion settings.

Finally, perform a read-only enforcement smoke check against GitHub's branch rules. Do not create a deliberately failing production commit merely to prove rejection.

## Acceptance criteria

1. SonarCloud reports no unresolved open or confirmed issues for the exact enforcement pull-request revision and its quality gate passes.
2. Snyk Open Source and Code scans pass on the pull request; `snyk monitor` does not update from the pull request.
3. The build quality job runs and passes on pull requests targeting `test`.
4. The enforcement pull request merges only after all three required contexts pass.
5. A post-merge `test` push run updates the Snyk monitored snapshot and repeats Sonar analysis.
6. GitHub reports that `test` requires pull requests and all three stable checks, enforces the policy for administrators, and rejects force pushes and deletion.
7. Future “push to test” requests use the temporary-branch, pull-request, wait-for-green, automatic-merge, and final-divergence workflow.
8. Existing clients, Relay Web, Electron behavior, and packaging semantics remain unchanged except for the intended CI and branch-publication policy.
9. The four pre-existing unstaged Radar-polish files remain intact and outside the enforcement commits unless the user explicitly includes them later.

## Working-tree preservation

The implementation must preserve the pre-existing unstaged changes in:

- `src/renderer/src/tabs/RadarTab.tsx`
- `src/renderer/src/tabs/__tests__/RadarTab.test.tsx`
- `src/renderer/src/tabs/radar.css`
- `tests/e2e/css-visual-contracts.spec.ts`

Those changes are not part of this design and must not be staged, reformatted, committed, or published accidentally.
