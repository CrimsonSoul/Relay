# Finding-Only Scanner Gates

## Goal

Keep Relay's pull-request safety checks without allowing CodeRabbit, Snyk, or Sonar capacity limits,
timeouts, or service outages to prevent a valid change from merging into `test` and producing a
Windows build. Confirmed findings must still block. No paid overage or usage-based add-on may be
enabled.

This design supersedes the scanner-availability behavior in
`2026-07-31-test-branch-security-enforcement-design.md`; the earlier design remains the historical
record for the initial enforcement rollout.

## Decisions

- Changes continue to enter `test` through pull requests. Direct pushes remain prohibited.
- The GitHub-hosted `Build quality gate` remains a strict required status check.
- Windows packaging remains independent of every external scanner and runs after a merge to
  `test`.
- Confirmed Snyk or Sonar findings remain merge-blocking.
- Known third-party capacity and availability failures become visible warnings and do not block a
  merge.
- Invalid credentials, invalid scanner configuration, or an invalid repository security contract
  remain blocking failures because treating them as availability problems could silently disable
  scanning indefinitely.
- CodeRabbit findings block through its Request Changes workflow and unresolved review
  conversations, not by requiring CodeRabbit's availability status.
- Rapid updates happen while a pull request is a draft. The pull request becomes ready only after
  its intended final revision has been pushed, so CodeRabbit reviews the stable diff instead of
  consuming its rolling OSS allowance on intermediate commits.

## Required Checks and Review Policy

`test` branch protection will strictly require:

- `Build quality gate`;
- `SonarQube quality gate`; and
- `Snyk security gate`.

The `CodeRabbit` status context will no longer be required. Branch protection will continue to
require pull requests, enforce the policy for administrators, disable force pushes and deletion,
and require conversation resolution.

CodeRabbit will enable `reviews.request_changes_workflow`. When a completed review has actionable
findings, CodeRabbit requests changes and the pull request remains blocked until the findings are
resolved. If CodeRabbit is rate-limited or unavailable, it may warn or omit a review without
blocking the pull request. No usage-based CodeRabbit add-on will be enabled.

CodeRabbit automatic reviews remain limited to non-draft pull requests targeting `test`. Its
incremental-review pause will be set conservatively so a branch with repeated post-review pushes
does not exhaust the rolling OSS review allowance. The normal publication flow should return the
pull request to draft or explicitly pause review before another rapid edit sequence, then request a
fresh review on the final revision.

## Scanner Outcome Classification

The security workflow will give Snyk and Sonar an explicit four-state policy:

1. **Clean:** the scanner completed and found no blocking issue. The required check succeeds.
2. **Finding:** the scanner completed and reported a vulnerability, unresolved issue, or failed
   quality gate covered by Relay's policy. The required check fails.
3. **Unavailable:** the service did not produce a security decision because of a documented rate
   limit, temporary outage, network timeout, or bounded server-side failure. The workflow emits a
   prominent warning and job summary, then the required check succeeds.
4. **Configuration:** credentials, scope, identity, or scanner output is invalid or ambiguous. The
   required check fails closed until the pipeline or repository configuration is repaired.

Examples include an authentication failure, missing secret, invalid organization or project
identifier, unsupported repository state, malformed scanner response, or contradiction in
persisted Sonar issue state. Those cases are never softened into Unavailable.

### Snyk

Snyk's documented successful-scan exit codes distinguish clean results from findings. The workflow
will preserve that distinction and classify documented temporary-service outcomes separately.
Open Source and Code scans must both complete cleanly for the gate to pass as `Clean`; a finding in
either scan fails the gate. The post-merge `snyk monitor` snapshot remains best-effort operational
bookkeeping and cannot invalidate a build that has already been produced.

### Sonar

Sonar analysis upload, exact-analysis polling, open-finding inspection, and quality-gate inspection
will report structured outcomes instead of collapsing every error into the same exit status.
Confirmed open issues or a completed failing quality gate block. Bounded polling timeouts, rate
limits, and server-side availability failures warn and allow the merge. Identity, scope, schema,
and reviewed-issue consistency checks continue to fail closed.

## Rapid-Push and Build Flow

1. Create a temporary `codex/` branch and a draft pull request into `test`.
2. Push intermediate commits as needed. Concurrency may cancel superseded CI runs.
3. Push the intended final revision and mark the pull request ready.
4. Run the build gate and the latest Snyk and Sonar scans; CodeRabbit reviews the ready revision
   when its OSS allowance is available.
5. Block on local build/test failures, scanner configuration failures, or confirmed findings.
6. Warn but continue on classified third-party availability failures.
7. Auto-merge only after the required checks and review-conversation rules permit it.
8. The resulting `test` push starts Windows packaging independently. A newer `test` push may cancel
   a superseded packaging run, but the newest branch tip must receive a complete packaging run.

The system optimizes for one current artifact rather than preserving an artifact for every
superseded intermediate commit.

## Reporting

Unavailable scans must be conspicuous rather than silent. Each soft-failed scanner writes:

- a GitHub warning annotation;
- a job-summary section naming the scanner and affected revision;
- the sanitized failure category, such as rate limited, timed out, or service unavailable; and
- the fact that no security decision was produced and a later retry is recommended.

Logs and summaries must not expose scanner tokens, organization secrets, or untrusted raw response
bodies.

## Verification

Focused contract tests will cover the policy matrix for each scanner:

- clean result -> success;
- confirmed finding -> failure;
- documented rate limit -> warning success;
- bounded timeout or service outage -> warning success;
- missing credential or invalid configuration -> failure; and
- ambiguous or malformed output -> failure.

Repository contract tests will also prove that:

- Windows packaging has no dependency on CodeRabbit, Snyk, or Sonar jobs;
- CodeRabbit enables Request Changes and does not consume reviews for drafts;
- branch protection requires the build, Snyk, and Sonar contexts but not CodeRabbit availability;
- conversation resolution remains enabled; and
- no paid-overage setting is introduced.

Before publication, run the repository's required typecheck, lint, formatting, test, build, audit,
and diff checks. The pull request must then demonstrate a clean path with all three required status
checks green and a completed CodeRabbit review when capacity is available. Branch protection must
be queried after merge to verify its exact status contexts and review settings.

## Completion Criteria

1. A confirmed Snyk, Sonar, or CodeRabbit finding blocks merge.
2. A documented scanner quota, rate limit, timeout, or service outage is visible but does not block
   merge or Windows packaging.
3. Broken scanner credentials or configuration remain blocking.
4. Rapid intermediate pushes do not require a CodeRabbit review per commit.
5. The newest merged `test` tip produces a Windows artifact independently of scanner availability.
6. Relay remains on free public/OSS service tiers with no paid overage enabled.
