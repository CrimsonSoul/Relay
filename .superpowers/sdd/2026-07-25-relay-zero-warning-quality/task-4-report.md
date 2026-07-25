# Task 4 Report: Safe Main, Shared, Web, Renderer, and Script Modernizations

## Status

Complete. The implementation is committed as `0fe850bd` (`refactor: modernize safe sonar findings`).

Task 4 changed 67 production/script files and addressed all 133 baseline issues for the 28 rules assigned to this task. No remote Sonar issue was resolved or rescanned; Task 10 owns remote reconciliation.

## Baseline inventory

Immediately before editing, the Task 4 rules were filtered from `/tmp/relay-sonar-production.tsv` into `/tmp/relay-task4-sonar-before.tsv`.

- Baseline rows: 133
- Distinct rules: 28
- Distinct changed files: 67

| Rule | Issues |
| --- | ---: |
| `javascript:S6594` | 1 |
| `javascript:S7744` | 3 |
| `javascript:S7755` | 1 |
| `javascript:S7778` | 1 |
| `javascript:S7780` | 5 |
| `typescript:S2933` | 1 |
| `typescript:S3863` | 2 |
| `typescript:S4138` | 1 |
| `typescript:S4782` | 4 |
| `typescript:S6571` | 11 |
| `typescript:S6582` | 32 |
| `typescript:S6606` | 2 |
| `typescript:S6644` | 1 |
| `typescript:S6653` | 3 |
| `typescript:S6660` | 2 |
| `typescript:S6754` | 5 |
| `typescript:S6767` | 7 |
| `typescript:S7741` | 1 |
| `typescript:S7744` | 4 |
| `typescript:S7747` | 6 |
| `typescript:S7753` | 1 |
| `typescript:S7761` | 4 |
| `typescript:S7763` | 1 |
| `typescript:S7765` | 6 |
| `typescript:S7768` | 1 |
| `typescript:S7776` | 11 |
| `typescript:S7780` | 13 |
| `typescript:S7781` | 3 |
| **Total** | **133** |

## Implementation summary

- Replaced assigned guard, nullish-assignment, collection membership, iterable, import, DOM dataset, element replacement, string replacement, regular-expression, and raw-string patterns with behavior-equivalent modern forms.
- Preserved code-point excerpt behavior by replacing array spread with `Array.from`, and preserved upload cancellation snapshot behavior by materializing the map iterator with `Array.from`.
- Kept public state arrays and tuple APIs unchanged; only private membership collections became `Set` instances.
- Preserved PocketBase filter escaping and collection snapshot behavior. Repeated filter escaping was moved to a local helper where nested raw templates would otherwise introduce a new lint finding.
- Preserved React persistence behavior by aliasing storage writers (`persistAccent`, `persistOnCallFontScale`, and `persistOrganizerEmail`) while giving React state setters conventional names.
- Split `CloudStatusTab` overview/detail prop types according to actual subcomponent use while retaining every runtime input at `StatusWorkspace`.
- Preserved privileged signing, body-hash, key, account, UID, and migration behavior; no cryptographic or identifier algorithm changed.
- Kept Electron/Web runtime behavior and Electron 42.4 native-module rebuild flow intact.

## Files changed

### Scripts

- `scripts/benchmark-startup.mjs`
- `scripts/download-pocketbase.mjs`
- `scripts/icon/render.cjs`
- `scripts/package-windows.mjs`
- `scripts/seedKnowledge.mjs`
- `scripts/windows-package-contract.mjs`

### Main process

- `src/main/app/relaunch.ts`
- `src/main/dynatrace/DynatraceProblemsClient.ts`
- `src/main/dynatrace/DynatraceProblemsManager.ts`
- `src/main/handlers/offlineMutationHandlers.ts`
- `src/main/handlers/windowHandlers.ts`
- `src/main/knowledge/KnowledgeCoverService.ts`
- `src/main/knowledge/KnowledgePdfService.ts`
- `src/main/knowledge/KnowledgeSearchEngine.ts`
- `src/main/knowledge/KnowledgeSearchIndexer.ts`
- `src/main/knowledge/KnowledgeSearchService.ts`
- `src/main/knowledge/KnowledgeUploadCoordinator.ts`
- `src/main/knowledge/KnowledgeUploadQueueStore.ts`
- `src/main/knowledge/KnowledgeUploadScheduler.ts`
- `src/main/knowledge/KnowledgeUploadService.ts`
- `src/main/knowledge/ManagedKnowledgeService.ts`
- `src/main/knowledge/PocketBaseKnowledgeUploadRepository.ts`
- `src/main/knowledge/registerKnowledgeManagementCommands.ts`
- `src/main/pocketbase/CollectionBootstrap.ts`
- `src/main/pocketbase/mainProcessEventSource.ts`
- `src/main/privileged/PrivilegedAccountManager.ts`
- `src/main/privileged/PrivilegedCommandProcessor.ts`
- `src/main/privileged/PrivilegedDeviceManager.ts`
- `src/main/privileged/PrivilegedPocketBaseClient.ts`
- `src/main/privileged/PrivilegedPocketBaseTransport.ts`
- `src/main/privileged/PublisherAssignmentManager.ts`
- `src/main/privileged/RoleAccountMigration.ts`
- `src/main/privileged/privilegedRuntime.ts`
- `src/main/web/RelayWebGateway.ts`
- `src/main/web/RelayWebServer.ts`
- `src/main/web/WebKnowledgeUploadStaging.ts`
- `src/main/web/WebSessionStore.ts`

### Renderer

- `src/renderer/src/App.tsx`
- `src/renderer/src/components/DynatraceProblemNotificationManager.tsx`
- `src/renderer/src/components/SettingsModal.tsx`
- `src/renderer/src/components/SetupScreen.tsx`
- `src/renderer/src/components/data-manager/DataManagerBackups.tsx`
- `src/renderer/src/components/sidebar/SidebarDashboards.tsx`
- `src/renderer/src/features/knowledge/KnowledgeContinuousPdf.tsx`
- `src/renderer/src/features/knowledge/KnowledgeLibrary.tsx`
- `src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx`
- `src/renderer/src/features/knowledge/KnowledgeTab.tsx`
- `src/renderer/src/features/knowledge/knowledgeLinkResolver.ts`
- `src/renderer/src/features/knowledge/knowledgeModel.ts`
- `src/renderer/src/features/knowledge/useKnowledgeDocumentSearch.ts`
- `src/renderer/src/features/knowledge/useKnowledgeManagement.ts`
- `src/renderer/src/features/knowledge/useKnowledgePassageSearch.ts`
- `src/renderer/src/hooks/useOnCallManager.ts`
- `src/renderer/src/runtime/WebSessionGate.tsx`
- `src/renderer/src/runtime/browserActions.ts`
- `src/renderer/src/tabs/AlertsTab.tsx`
- `src/renderer/src/tabs/CloudStatusTab.tsx`
- `src/renderer/src/tabs/alerts/AlertBodyEditor.tsx`
- `src/renderer/src/tabs/assembler/ScheduleBridgeModal.tsx`
- `src/renderer/src/theme/accent.ts`
- `src/renderer/src/utils/ics.ts`
- `src/renderer/src/utils/timeParsing.ts`

### Shared

- `src/shared/dynatrace.ts`
- `src/shared/knowledge.ts`
- `src/shared/knowledgeSearch.ts`
- `src/shared/privilegedAccess.ts`
- `src/shared/webApi.ts`

## Verification

### Focused characterization suites

- Main/shared/script focused run: 41 files and 695 tests selected. The first run exposed one unsafe optional-chain rewrite in `KnowledgeSearchService.stopSubscriptions`; the explicit non-null guard was restored, and the affected suite then passed 39/39. The other 40 selected files and 656 tests passed in the original run.
- Renderer focused run: 27 files passed, 689 tests passed.
- Targeted ESLint over all 67 Task 4 files: passed with zero findings.

### Required full gates

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | Passed: 154 unit files / 2,029 tests; 4 cache files / 79 tests; 211 renderer files / 2,877 tests |
| `npm run test:web` | Passed after local browser installation: build passed and Chrome, Edge, and Safari projects passed 3/3 |
| `npm run format:check` | Passed |
| `git diff --check` | Passed |
| `npm run build` | Passed as part of `npm run test:web` |
| Task 4 targeted `npx eslint ...` | Passed |
| `npm run lint` | Ran; full-repository gate remains red on 95 errors and 1 warning assigned to later zero-warning tasks. No Task 4-touched production/script file remained in the targeted lint output. |

The first `npm run test:web` attempt built successfully but could not launch because Playwright's pinned Chromium and WebKit binaries were absent. `npx playwright install chromium webkit` installed the required local test browsers, and the unchanged test command then passed all three projects. The runner restored `better-sqlite3` to the current Node ABI after Electron 42.4 testing.

## Deliberately left for later tasks

- Task 5 behavior-sensitive `S6551`, `S7758`, `S7737`, and `S107` findings.
- Task 6 semantic changes.
- Task 7 test-only findings.
- Task 8 CSS findings.
- Task 9 chunking warning and chunk work. The build still reports the expected greater-than-500-kB chunk warning.
- Task 10 remote Sonar refresh, issue-key reconciliation, and resolution.

No test, CSS, chunking, remote Sonar, or behavior-sensitive Task 5 finding was edited in this task.

## Self-review

- Reviewed the complete 67-file diff against the 133-row filtered inventory.
- Confirmed no exported array/tuple was converted to a `Set`; Set migrations were private lookup collections.
- Confirmed raw strings preserve the exact PocketBase, DQL, PDF, Windows path, and ICS escape values under focused tests.
- Confirmed optional-chain rewrites preserve null guards. The one comparison-of-absent-values regression found by characterization tests was corrected before commit.
- Confirmed map iteration retains a snapshot where callbacks can mutate scheduler state.
- Confirmed `CloudStatusTab` still receives and forwards all overview/detail runtime inputs.
- Confirmed commit hooks ran scoped ESLint fix and Prettier over the staged Task 4 files; the committed tree is formatted and targeted-lint clean.

## Concerns

- Full repository lint cannot be green until the deliberately out-of-scope later-task findings are completed.
- Remote Sonar has not been refreshed, so the 133 issue closures are based on exact baseline inventory plus local targeted lint and characterization coverage; Task 10 must confirm server-side closure.
- Playwright browser binaries were installed in the local user cache solely to make `npm run test:web` executable.
