# Relay Startup Performance Implementation Plan

> Execute directly with the primary agent in the current checkout, per the repository working agreement. Do not create a worktree or invoke per-task implementer/reviewer loops.

**Goal:** Show a useful Relay startup shell immediately, remove avoidable PocketBase delay, and defer nonessential work until the application is usable without weakening required migration or authentication guarantees.

**Architecture:** Main owns a sequenced startup-state controller and creates the window while required workspace preparation runs. The renderer displays static HTML immediately, loads the React bundle concurrently, and mounts the application only after main publishes `ready`. PocketBase starts with existing credentials first, performs credential repair only after a definitive rejection, and keeps required schema/data migrations on the critical path. Native rendering, client SQLite, search schema, and scheduled maintenance move behind lazy or post-ready boundaries.

**Tech stack:** Electron, TypeScript, React, Vite, PocketBase, Vitest, Playwright.

---

## Slice 1: Startup contract, state controller, and timing recorder

**Files**

- Create: `src/main/app/startupState.ts`
- Create: `src/main/app/startupState.test.ts`
- Create: `src/main/app/startupTimeline.ts`
- Create: `src/main/app/startupTimeline.test.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.test.ts`

1. Write failing tests for the startup controller: initial `launching` snapshot, legal `preparing-data -> ready|failed` transitions, monotonically increasing sequence numbers, fresh generations, stale-generation rejection, bounded user-facing failure text, and subscriber notification.
2. Write failing tests for a monotonic timing recorder that captures each milestone once and emits one bounded summary.
3. Add startup snapshot/event types and optional desktop-only bridge methods to `BridgeAPI`: `getStartupState`, `onStartupStateChanged`, and `markStartupRendererMounted`. Add IPC channel constants.
4. Implement the controller and timing recorder with no Electron dependency, then expose the bridge methods in preload.
5. Run: `npx vitest run src/main/app/startupState.test.ts src/main/app/startupTimeline.test.ts src/preload/index.test.ts`

## Slice 2: Static shell and renderer readiness gate

**Files**

- Create: `src/renderer/src/runtime/DesktopStartupGate.tsx`
- Create: `src/renderer/src/runtime/DesktopStartupGate.test.tsx`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/styles/setup.css`

1. Write failing renderer tests proving the desktop gate subscribes before reading the snapshot, ignores older sequences, begins loading `App` immediately, keeps the startup shell while main is not ready, renders a bounded error state on failure, mounts `App` only after ready, and reports renderer-mounted once. Preserve direct web rendering when the desktop startup bridge is absent.
2. Put a dependency-free, system-font startup shell in the HTML root so it paints before React evaluates.
3. Implement the gate with an injected dynamic App loader for deterministic tests. Reconcile subscribe-then-read races using sequence numbers.
4. Run: `npm run test:renderer -- src/renderer/src/runtime/DesktopStartupGate.test.tsx`
5. Run: `npm run build`

## Slice 3: Early-window orchestration and reconfiguration generations

**Files**

- Create: `src/main/app/startupSequence.ts`
- Create: `src/main/app/startupSequence.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/app/windowFactory.ts`
- Modify: `src/main/app/__tests__/windowFactory.test.ts`
- Modify: `src/main/app/runtimeReconfigure.ts`
- Modify: `src/main/app/__tests__/runtimeReconfigure.test.ts`

1. Write failing orchestration tests proving window creation starts without waiting for workspace preparation, `preparing-data` is published before required work, `ready` follows successful preparation, failures publish `failed`, and post-ready work cannot delay ready.
2. Add an optional shell-ready milestone callback to the window factory and register startup IPC before window creation.
3. Refactor main startup to launch window creation and required preparation concurrently through `runStartupSequence`. Keep server and client required initialization behavior intact.
4. Start a fresh controller generation for runtime reconfiguration so late events from the prior run cannot overwrite the new state.
5. Run: `npx vitest run src/main/app/startupSequence.test.ts src/main/app/__tests__/windowFactory.test.ts src/main/app/__tests__/runtimeReconfigure.test.ts`

## Slice 4: Remove heavyweight modules from the main-entry critical path

**Files**

- Modify: `src/main/knowledge/KnowledgeCoverService.ts`
- Modify: `src/main/knowledge/KnowledgeCoverService.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/app/runtimeReconfigure.ts`
- Modify: `src/main/app/__tests__/runtimeReconfigure.test.ts`

1. Write failing tests proving cached/stored knowledge covers do not load the renderer and the cover module is loaded once only when generation is required.
2. Replace the static cover renderer import with a memoized dynamic import.
3. Replace static client-offline infrastructure imports in both startup and runtime reconfiguration with dynamic imports executed only in client mode.
4. Run: `npx vitest run src/main/knowledge/KnowledgeCoverService.test.ts src/main/app/__tests__/runtimeReconfigure.test.ts`
5. Run `npm run build`, then fail if `dist/main/index.js` has a static import of `@napi-rs/canvas`, `pdfjs-dist/legacy/build/pdf.mjs`, or `better-sqlite3`.

## Slice 5: PocketBase health and credential fast path

**Files**

- Modify: `src/main/pocketbase/PocketBaseProcess.ts`
- Modify: `src/main/pocketbase/PocketBaseProcess.test.ts`
- Modify: `src/main/app/pocketbaseBootstrap.ts`
- Modify: `src/main/app/__tests__/pocketbaseBootstrap.test.ts`
- Modify if needed: `src/main/app/pbErrors.ts`

1. Write failing health tests for an immediate probe followed by 20, 40, 80, 160, then capped 200 ms delays within the existing 10-second deadline.
2. Write failing bootstrap tests for: healthy existing credentials never invoke CLI upsert; definitive credential rejection stops PocketBase, runs CLI repair, restarts, and reauthenticates once; timeout/network/internal errors never mutate credentials; failed repair is fatal; milestones fire at process healthy and credential ready.
3. Implement adaptive health polling without changing timeout semantics.
4. Make normal startup `start -> health -> API auth`. Add one narrowly classified recovery path using `isCredentialRejection`; make CLI repair return failure instead of swallowing it.
5. Run: `npx vitest run src/main/pocketbase/PocketBaseProcess.test.ts src/main/app/__tests__/pocketbaseBootstrap.test.ts`

## Slice 6: Reuse the PocketBase collection snapshot safely

**Files**

- Modify: `src/main/pocketbase/CollectionBootstrap.ts`
- Modify: `src/main/pocketbase/__tests__/CollectionBootstrap.test.ts`
- Modify: `src/main/privileged/RoleAccountMigration.ts`
- Modify: `src/main/privileged/__tests__/RoleAccountMigration.test.ts`

1. Write failing tests proving complete collection metadata from `getFullList` avoids per-collection `getOne`, incomplete metadata falls back to `getOne`, and required post-write re-reads still occur.
2. Let collection bootstrap reuse complete snapshot records while retaining the conservative fallback.
3. Pass the same snapshot into role-account migration when safe. Retain all record checks, writes, and post-write validation.
4. Run: `npx vitest run src/main/pocketbase/__tests__/CollectionBootstrap.test.ts src/main/privileged/__tests__/RoleAccountMigration.test.ts`

## Slice 7: Defer optional work, benchmark, and verify end to end

**Files**

- Modify: `src/main/app/pocketbaseBootstrap.ts`
- Modify: `src/main/app/__tests__/pocketbaseBootstrap.test.ts`
- Modify: `src/main/pocketbase/RetentionManager.ts`
- Modify: `src/main/pocketbase/RetentionManager.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/app/runtimeReconfigure.ts`
- Create: `scripts/benchmark-startup.mjs`
- Create: `scripts/benchmark-startup.test.mjs`
- Modify: `tests/e2e/critical-path.spec.ts`
- Modify: `package.json`
- Modify: `docs/DEVELOPMENT.md`

1. Write failing tests proving optional knowledge-search schema work is absent from required PocketBase bootstrap, automatic retention accepts a 30-second initial delay, and stopping the scheduler cancels both the initial timeout and interval.
2. Move search schema initialization into a contained post-ready task before starting the search runtime. Construct maintenance managers before ready for manual operations, but schedule their first automatic run 30 seconds after ready.
3. Emit one bounded startup timing summary with entry, Electron-ready, window-created, shell-ready, data-root, PocketBase-healthy, credentials-ready, schema-ready, workspace-ready, and renderer-mounted milestones.
4. Add a benchmark script that performs one fresh/update-like launch and five isolated warm launches using temporary user-data directories, records milestones, terminates only Electron processes it created, and reports medians. Add deterministic parser/statistics tests.
5. Extend the critical-path Electron test to assert the startup shell can appear before the workspace becomes ready and that a healthy second launch does not use credential repair.
6. Document the benchmark command and interpretation.
7. Run focused tests: `npx vitest run src/main/app/__tests__/pocketbaseBootstrap.test.ts src/main/pocketbase/RetentionManager.test.ts scripts/benchmark-startup.test.mjs`
8. Run full verification: `npm test`, `npm run test:electron`, `npm run test:web`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build`.
9. Re-run the main-entry forbidden-import check, inspect `git diff --check` and `git status --short`, then perform one final code review against the approved design and fix any finding before completion.

## Commit strategy

Commit each independently passing slice with a focused message. Do not push or open a pull request unless requested. Preserve unrelated user changes and stop if an overlapping dirty edit cannot be safely reconciled.
