# Relay repository instructions

This file applies to the entire Relay repository. `~/.codex/AGENTS.md` is the
sole cross-project routing and engineering policy; nothing here duplicates or
overrides it.

## Working tree

- Inspect `git status --short --branch` before editing and again before any
  commit or push.
- Preserve all pre-existing source, test, and documentation changes. Never
  discard, overwrite, reformat, stage, or publish unrelated work. If a mixed
  worktree makes the requested scope unclear, stop and confirm it.
- `npm run format:check` is the default formatting command. Never run
  `npm run format` in a mixed worktree; it rewrites the whole repository. When
  formatting is needed, format only the touched files.

## Sources of truth

- `package.json` defines scripts and tool entry points; `.node-version`
  defines the Node version.
- `docs/DEVELOPMENT.md` covers contributor and data-access patterns;
  `docs/architecture.md` covers runtime and data flow; `docs/DESIGN.md` and
  `PRODUCT.md` cover renderer conventions; `docs/SECURITY.md` covers trust,
  network, secret, migration, and storage boundaries; `docs/relay-web.md` and
  `docs/knowledge-base.md` cover their named features. `README.md` is an
  overview, not architecture authority.
- Resolve documentation conflicts against current implementation, config, and
  tests. When behavior changes, update the applicable canonical document in
  the same change; never preserve a stale architecture description.

## Documentation lifecycle

- The tracked Markdown set is exactly the canonical documents listed in
  `docs/README.md`. Update the applicable document in place.
- Never add standalone plans, specifications, implementation notes, audit or
  status reports, mockups, or historical summaries to the repository. Pull
  requests, issues, and Git history hold temporary work and historical
  context.
- Adding a persistent Markdown document requires explicit user approval, and
  the same change must update `docs/README.md` and
  `scripts/documentation-contract.test.mjs` so the exception stays deliberate
  and visible.

## Client, server, and data safety

- Prefer the smallest correct change and add focused regression coverage for
  changed behavior.
- No new npm dependencies without explicit approval, including
  devDependencies.
- Do not introduce abstraction layers over PocketBase or over existing IPC
  channels. New IPC channels require a reason a renderer service module
  cannot do the work.
- The following are compatibility-sensitive boundaries: `src/main`,
  `src/preload`, `src/shared`, renderer services and hooks, PocketBase
  bootstrap/schema, realtime and offline behavior, and `src/main/web`.
  Changing observable behavior at any of them - including server/client mode,
  authentication, reconnect behavior, offline cache/replay, backup/restore,
  or existing data semantics - requires explicit requirements from the user
  and focused verification of the changed behavior. Existing clients must
  retain the ability to connect to a Relay server.
- Ordinary PocketBase CRUD lives in renderer service modules. IPC is reserved
  for system-level or privileged work; define channels and payload validation
  in shared code and preserve trusted-sender validation.
- Relay Web stays limited to an explicitly enabled trusted LAN or approved
  private VPN. Never introduce public exposure, permissive cross-origin
  access, or browser access to desktop secrets and capabilities.
- Never run development builds, migrations, or destructive tests against live
  Relay app data; use a disposable directory or a verified backup copy.
  Preserve existing IDs, relationships, and unknown PocketBase collections.

## Verification

Base gate, required before claiming any source, test, or configuration change
complete:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
git diff --check
```

Additions by scope:

- Electron, preload, IPC, window, or desktop integration changes: add
  `npm run test:electron`.
- Relay Web, browser runtime, gateway, session, or network-boundary changes:
  add `npm run test:web`.
- Windows packaging or bootstrap changes: add `npm run build:win` when the
  environment supports it; otherwise report it as skipped. This command must
  finish its packaged Koffi and better-sqlite3 Windows x64 PE32+ verification.
- Readiness or push-to-test claims: add
  `npm audit --audit-level=high --omit=dev`.

Rules:

- Start with the narrowest tests covering the changed behavior; the gate runs
  at the end, not instead of iteration.
- Invoke the Electron and web suites only through their npm scripts so
  native-module ABI restoration runs.
- Instruction- or documentation-only edits need only targeted Prettier
  checking of the changed Markdown plus `git diff --check`, unless executable
  examples or behavior also changed.
- After a formatter or commit hook changes files, inspect the resulting diff
  and rerun the affected gates.
- A pre-existing failure not caused by the change: report it and continue;
  never fix it unprompted and never fold its fix into the current change.
- Report every skipped or unavailable check plainly. A gate that did not run
  is not a gate that passed.

## Publishing to origin/main

- "Push the changes" authorizes exactly this: the full verified tip enters
  main through a temporary `codex/` branch and a pull request. It never
  authorizes a direct push to main or a partial cherry-pick.
- Before pushing: fetch origin/main and check for remote-only commits. If any
  exist, rebase the work onto origin/main and rerun the applicable
  verification gate. If the rebase conflicts with work outside the requested
  scope, stop and ask for direction.
- Push the exact verified tip to the temporary branch and open a pull request
  targeting main.
- Required checks: Release-compatible pull request title, Build quality gate,
  SonarQube quality gate, Snyk security gate. Only a successful conclusion
  counts; queued, skipped, cancelled, neutral, or stale is failure for merge
  purposes.
- Automatic merge may be enabled once the user has said "push," and the merge
  happens only when every required check is successful. Diagnose and repair
  in-scope failures on the same pull request; stop for user direction if a
  repair needs new authority or touches unrelated work.
- After merge: fetch, fast-forward local main, and confirm local HEAD matches
  origin/main with zero divergence in both directions
  (`git rev-list --left-right --count`). Report the pull request, merge
  commit, check results, and any post-merge packaging still in flight.
