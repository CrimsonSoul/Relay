# Relay repository instructions

This file applies to the entire Relay repository. Use `~/.codex/AGENTS.md` as
the sole cross-project skill and plugin routing policy; do not duplicate that
routing here.

## Working tree

- Inspect `git status --short --branch` before editing and before any commit or
  push.
- Preserve all pre-existing source, test, and documentation changes. Do not
  discard, overwrite, reformat, stage, or publish unrelated work. If a mixed
  worktree makes the requested scope unclear, stop and confirm it.
- Prefer `npm run format:check`. If formatting is needed in a mixed worktree,
  format only touched files; `npm run format` writes across the repository.

## Sources of truth

- Use `package.json` for scripts and tool entry points and `.node-version` for
  the Node version.
- Use `docs/DEVELOPMENT.md` for contributor and data-access patterns,
  `docs/architecture.md` for runtime and data flow, `docs/DESIGN.md` plus
  `PRODUCT.md` for renderer conventions, and `docs/SECURITY.md` for trust,
  network, secret, migration, and storage boundaries.
- Use `docs/relay-web.md` and `docs/knowledge-base.md` for their feature
  boundaries. Treat `README.md` as an overview, not architecture authority.
- Resolve documentation conflicts against current implementation, config, and
  tests. Update the applicable canonical document when behavior changes; do not
  preserve stale architecture descriptions.

## Client, server, and data safety

- Prefer the smallest correct change and add focused regression coverage for
  changed behavior.
- Treat `src/main`, `src/preload`, `src/shared`, renderer services and hooks,
  PocketBase bootstrap/schema, realtime and offline behavior, and
  `src/main/web` as compatibility-sensitive boundaries.
- Preserve existing clients' ability to connect to a Relay server. Do not
  change server/client mode, authentication, reconnect behavior, offline
  cache/replay, backup/restore, or existing data semantics without explicit
  requirements and focused verification.
- Keep ordinary PocketBase CRUD in renderer service modules. Reserve IPC for
  system-level or privileged work; define channels and payload validation in
  shared code and preserve trusted-sender validation.
- Keep Relay Web limited to an explicitly enabled trusted LAN or approved
  private VPN. Do not introduce public exposure, permissive cross-origin
  access, or browser access to desktop secrets and capabilities.
- Never run development builds, migrations, or destructive tests against live
  Relay app data. Use a disposable directory or consistent backup/copy.
  Preserve existing IDs, relationships, and unknown PocketBase collections.

## Verification

- Start with the narrowest tests that cover the changed behavior.
- Before claiming a source, test, or configuration change complete, run:

  ```bash
  npm run typecheck
  npm run lint
  npm run format:check
  npm test
  npm run build
  git diff --check
  ```

- Before a readiness or push-to-test claim, also run
  `npm audit --audit-level=high --omit=dev`.
- Add `npm run test:electron` for Electron, preload, IPC, window, or desktop
  integration changes; `npm run test:web` for Relay Web, browser runtime,
  gateway, session, or network-boundary changes; and `npm run build:win` for
  Windows packaging/bootstrap changes when the environment supports it.
- Invoke Electron and web suites through their npm scripts so native-module ABI
  restoration runs.
- For instruction- or documentation-only edits, targeted Prettier checking of
  the changed Markdown plus `git diff --check` is sufficient unless executable
  examples or behavior also changed.
- After a formatter or commit hook changes files, inspect the resulting diff
  and rerun affected gates. Report skipped or unavailable checks plainly.

## Pushing to `origin/test`

- "Push the changes to test" means commit the complete intended scope and
  publish the verified local `HEAD` as the full `origin/test` branch tip. Do not
  cherry-pick or partially publish unless the user explicitly requests it.
- Reconfirm branch-tip scope after commit hooks and rerun task-relevant
  verification on the committed result.
- Then run:

  ```bash
  git fetch origin test
  git rev-list --left-right --count origin/test...HEAD
  git push origin HEAD:test
  git rev-parse HEAD origin/test
  git rev-list --left-right --count origin/test...HEAD
  ```

- If the pre-push divergence shows remote-only commits, stop and reconcile
  explicitly. Never force-push without explicit authorization.
- Completion requires matching `HEAD` and `origin/test` revisions plus final
  divergence `0 0`. Report the exact pushed commit and verification performed.
