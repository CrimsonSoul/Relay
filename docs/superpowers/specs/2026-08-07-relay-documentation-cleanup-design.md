# Relay Living Documentation Cleanup Design

**Date:** 2026-08-07
**Status:** Approved for implementation planning

## Objective

Replace Relay's accumulated historical documentation with a smaller living documentation set that
matches the current application. Git history becomes the archive for completed design specs,
implementation plans, and disconnected prototypes.

The cleanup changes documentation and documentation assets only. It does not change Relay product
behavior, runtime configuration, or application data.

## Source-of-truth order

Every retained statement must be checked against the most authoritative current source available:

1. Current implementation and configuration
2. Focused tests and workflow definitions
3. Canonical living documentation for that subject
4. Root-level overview material

When a durable implementation detail is already clear from a named source file, the documentation
should point to that file instead of duplicating a long, drift-prone description. Unverified or
historical claims are removed rather than softened into guesses.

## Deletions

Delete the following historical and exploratory material in full:

- `docs/superpowers/specs/`
- `docs/superpowers/plans/`
- `docs/ui-mockups/full-redesign/`

This includes this temporary design spec after it has been reviewed and converted into an
implementation plan. The committed version remains available through Git history.

Delete README screenshot assets that are no longer referenced after the gallery is rebuilt. Do not
delete an asset merely because it is old; first determine whether the refreshed README still uses
it.

## Retained living documentation

Retain the following ten Markdown documents, with one clear purpose for each:

| Document                 | Ownership                                                                 |
| ------------------------ | ------------------------------------------------------------------------- |
| `AGENTS.md`              | Repository-local working, safety, verification, and publication rules     |
| `PRODUCT.md`             | Durable product purpose, audience, personality, and design principles     |
| `README.md`              | Concise product overview, current features, setup, commands, and preview   |
| `docs/README.md`         | Index of living documentation and supporting assets                       |
| `docs/architecture.md`   | Runtime model, data ownership, subsystem boundaries, and storage model     |
| `docs/DEVELOPMENT.md`    | Contributor workflows, scripts, tests, and current implementation patterns |
| `docs/DESIGN.md`         | Reusable renderer visual, interaction, responsive, and accessibility rules |
| `docs/SECURITY.md`       | Trust boundaries, enforced controls, secret handling, and security rules   |
| `docs/knowledge-base.md` | Current Wiki administration and recovery procedures                       |
| `docs/relay-web.md`      | Relay Web setup, supported behavior, limitations, and network boundary     |

The retained files may be shortened, reorganized, or rewritten where needed. Their names and
subject boundaries stay stable so existing contributor links remain useful.

## Content rules

### Root overview documents

`README.md` must describe the current seven top-level operational destinations, including
Dispatcher Radar, and distinguish nested Knowledge destinations from sidebar destinations. It
keeps only commands that exist in `package.json` and uses the Node version from `.node-version`.
Its project layout remains high level.

`PRODUCT.md` keeps durable product and UX direction. Feature-specific implementation history,
temporary rollout language, and exact source-code mechanics do not belong there.

### Architecture and development

`docs/architecture.md` explains how the current runtime is divided, where data is authoritative,
and how major boundaries interact. It must include all current primary tabs and current Relay Web,
Radar, Wiki, privileged-access, offline, and server/client boundaries. It should not duplicate
operator procedures or long CI runbooks.

`docs/DEVELOPMENT.md` owns executable contributor guidance: directory conventions, service and IPC
patterns, test entry points, screenshot generation, and local scanner commands. Exact scripts must
match `package.json`. Historical scanner-review counts, past rollout narration, and duplicated
security policy are removed; current enforcement is summarized and linked to the workflow or
security guide.

### Design and security

`docs/DESIGN.md` retains design-system rules that guide future work: tokens, hierarchy, shared tab
chrome, controls, accessibility, responsive behavior, and narrowly necessary feature exceptions.
One-time redesign history and descriptions that merely restate a single component's current DOM are
removed unless they protect a deliberate interaction contract.

`docs/SECURITY.md` owns the security model: trust boundaries, validated IPC, navigation controls,
Relay Web exposure limits, protected identity, Wiki file handling, secrets, backups, and logging.
It may name enforcement files and required CI gates, but it should not duplicate the full local
scanner operating guide or preserve hard-coded reviewed-finding counts that can drift.

### Operator guides

`docs/knowledge-base.md` and `docs/relay-web.md` remain task-oriented. Every menu label,
authorization statement, limit, recovery step, offline rule, and browser limitation must be checked
against the implementation and focused tests. Internal mechanics stay only when operators need
them to make a safe decision.

### Documentation index

`docs/README.md` lists living documentation and supporting screenshots only. It contains no
historical-material section after the archive directories are deleted.

## Screenshot policy

The June screenshot set is not accepted as current merely because its files still exist. Generate
new captures with the existing isolated Electron Playwright harness and select a smaller set that
represents the current product without exposing real credentials or app data.

The README preview and refresh instructions must use the filenames actually emitted by
`tests/e2e/redesign-screenshots.spec.ts`. Remove old image files that are no longer referenced.

If the harness cannot complete or its output cannot be validated, remove the stale preview gallery
and obsolete screenshot assets. Do not retain known-stale visuals or silently substitute captures
from live Relay data.

## Verification

The implementation is complete only when all of the following are freshly verified:

1. The working tree was inspected before editing and unrelated changes were preserved.
2. The historical specs, plans, and full-redesign prototype are absent.
3. Exactly the intended living Markdown documents remain.
4. Every relative Markdown link resolves.
5. Every referenced repository path exists or is explicitly documented as a generated/runtime
   path.
6. Every referenced npm script exists in `package.json`.
7. Version claims match `.node-version`, `package.json`, and `package-lock.json` as applicable.
8. Feature and navigation labels match the renderer and tests.
9. Retained screenshots were freshly generated by the isolated harness and visually inspected.
10. Targeted Prettier checking passes for every changed Markdown file.
11. `git diff --check` passes.
12. `git status --short --branch` shows only the intended documentation cleanup before any commit
    or publication action.

Because this is a documentation-only change, the repository's documentation verification boundary
applies. Product typecheck, lint, unit, and build gates are not required unless the cleanup changes
an executable example, script, test, or runtime file. Screenshot generation may build and launch
Relay only through its disposable-data harness.

## Failure handling

- If a retained claim cannot be confirmed, remove it or replace it with a link to the current source
  of truth.
- If two living documents conflict, resolve the behavior from implementation, configuration, and
  tests, then update both documents according to their ownership boundaries.
- If screenshot generation fails, do not use live Relay data and do not retain the stale gallery;
  report the failure and remove the unverified preview.
- If the cleanup encounters unrelated worktree changes, stop before staging or committing them.
- Deleting historical records does not authorize deleting source, tests, workflows, or runtime
  assets that happen to be referenced by those records.

## Completion result

Relay will have a concise living documentation system with no in-repository historical archive,
no disconnected UI prototype, no stale screenshot instructions, and no known contradiction between
retained documentation and the current repository. Git history remains the only archive for the
deleted planning material.
