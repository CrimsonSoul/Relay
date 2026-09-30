import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { classifyHttpFailure, findingError, unavailableError } from './scanner-gate-policy.mjs';
import {
  normalizeSonarApiBase,
  paginateSonarIssues,
  parseSonarProjectKey as parseProjectKey,
  SonarHttpError,
  SonarTransportError,
} from './sonar-api-client.mjs';
import { normalizeSonarIssueStatus } from './sonar-issue-status.mjs';

const EXPECTED_PROJECT_KEY = 'CrimsonSoul_Relay';
const EXPECTED_BRANCH = 'main';
const PAGE_SIZE = 500;
const MAX_ISSUES = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 1_080_000;
const SEARCHED_STATUSES = ['OPEN', 'CONFIRMED', 'ACCEPTED', 'FALSE_POSITIVE'];
const OPEN_STATUSES = new Set(['OPEN', 'CONFIRMED']);
const REVIEWED_STATUS_BY_TRANSITION = Object.freeze({
  accept: 'ACCEPTED',
  falsepositive: 'FALSE_POSITIVE',
});
const REVIEW_COMMENT_BY_RULE = Object.freeze({
  'Web:S6819':
    'Relay reviewed exception: role=status is the W3C live-region pattern for startup progress; output would imply a calculation result.',
  'css:S7924':
    'Relay reviewed exception: browser-computed contrast passes the supported palette matrix.',
  'tssecurity:S5144':
    'Relay reviewed exception: shell.openExternal delegates to the OS after protocol, host, credential, and port allowlisting; Relay performs no server-side request.',
  'typescript:S5976':
    'Relay reviewed exception: these tests retain distinct setup, behavior, and diagnostics.',
  'typescript:S6478':
    'Relay reviewed exception: this function is an ErrorBoundary render callback, not a nested React component.',
  'typescript:S6819':
    'Relay reviewed exception: the explicit ARIA pattern preserves required interaction semantics.',
  'typescript:S7758':
    'Relay reviewed exception: UTF-16 hashing is a persisted compatibility contract.',
  'typescript:S7785':
    'Relay reviewed exception: the explicit async runner prevents a confirmed Electron ESM app.whenReady deadlock on macOS 26.',
  'typescript:S8980':
    'Relay reviewed exception: direct hook state transitions require React act().',
});
const ASYNC_REVIEW_RATIONALES = Object.freeze({
  benchmark:
    'Sequential launches, sampling intervals and readiness polls preserve benchmark timing and avoid concurrent app instances.',
  artifact:
    'Bounded artifact validation reads one entry at a time and stops immediately on an invalid path, size or file count.',
  fixture:
    'Ordered fixture writes and checksum reads preserve record dependencies, deterministic content and bounded memory.',
  scanner:
    'Sequential scanner pagination, polling delays and exact-issue transitions preserve page order, deadlines and fail-closed review.',
  native:
    'The fixed native-module list is inspected serially and stops on the first invalid Windows binary.',
  bootstrap:
    'Bootstrap retries wait before the next attempt; ordered schema and record changes preserve IDs, relationships and migration state.',
  cleanup:
    'Cleanup rechecks ownership and protected paths before each deletion and preserves bounded, best-effort processing.',
  cache: 'Ordered offline replay preserves mutation dependencies and conflict handling.',
  classic:
    'Classic problem lookups use serial batches of 50 to preserve rate bounds, cancellation and result ordering.',
  snapshot:
    'Singleton recovery must re-read the existing record before retrying a conflicting save.',
  stream:
    'Stream cancellation, retry delays and ordered partial writes or chunks enforce byte limits, offsets, rate bounds and bounded memory.',
  knowledgeMigration:
    'Ordered category and document writes preserve relationship IDs, revisions and the existing partial-failure behavior.',
  knowledgeCache:
    'Sequential cache eviction preserves active documents and the running byte-budget calculation.',
  knowledgeCleanup:
    'Serialized staging mutations and audit cleanup retain their existing ownership, expiry and failure boundaries.',
  knowledgeSearch:
    'Cooperative checkpoints intentionally yield during bounded search loops and retain cancellation and merge order.',
  knowledgeIndexer:
    'One indexing/removal job and one bounded passage batch at a time preserve job ownership, cancellation and failure recovery.',
  knowledgeUpload:
    'Upload workers, mutation locks, cancellation drains and chunk checks run in order to preserve concurrency limits and checksum state.',
  knowledgeExtraction:
    'PDF pages and outline nodes are processed in order, releasing each page and retaining text, depth and memory limits.',
  logger:
    'Descending log rotation and ordered queue drains prevent overwrites and preserve entries arriving during awaited writes.',
  backup:
    'Recovery and backup tree inspections remain bounded and stop when validation or size checks fail.',
  retention:
    'Deletion already runs concurrently inside each bounded chunk; awaiting each chunk preserves the configured concurrency limit.',
  privileged:
    'Ordered role migrations and device revocation preserve identity/history relationships and existing partial-failure behavior.',
  ownerDispose:
    'Owners are disposed in deterministic order while cleanup failures are isolated, preserving the original startup error.',
  privilegedPoll:
    'Command and pairing completion polls deliberately wait between attempts within their existing retry bounds.',
  releaseCleanup:
    'Retained-build inspection and stale-staging cleanup validate each owned path before progressing.',
  sdp: 'Ticket reads and writes preserve preflight checks, cancellation, rate limits and the existing bounded worker/batch concurrency.',
  pagination:
    'Each next cursor depends on the preceding verified page; serial section reads preserve pagination bounds and error handling.',
  autoLink:
    'Each workflow link is verified before saving and rechecks the active generation to prevent stale links.',
  export:
    'Sequential exports and statistics reads preserve output order and bound simultaneous collection snapshots.',
  crud: 'Ordered record lookup/update/create and cleanup preserve duplicate handling, partial failures and mutation order.',
  guardedSync:
    'Each bounded write batch rechecks the shared snapshot and connection before proceeding, preserving conflict and concurrency guarantees.',
  collection:
    'Queries are already concurrent in groups of four; serial groups retain the existing request cap.',
  ipcPromise:
    'This IPC adapter retains its existing Promise result and rejection contract while validating input or returning a synchronous snapshot.',
  webPromise:
    "The route handler implements WebRouter's Promise<WebRouteResponse> interface; synchronous results and throws must retain that contract.",
  bridgePromise:
    'This Web fallback implements the shared desktop BridgeAPI Promise contract, including unavailable-operation rejections.',
  queuePromise:
    'The in-memory queue adapter implements the same asynchronous storage contract as its persisted counterpart.',
  callbackPromise:
    'This default or command callback implements an existing Promise-based interface and must preserve resolved values and rejected errors.',
  refetchPromise:
    'Disabled refetch retains the Promise-returning refetch interface used by active collection subscriptions.',
  activationPromise:
    'Session activation retains its public Promise<void> contract even when installation finishes synchronously.',
  operationPromise:
    'This operational service preserves its Promise<IpcResult> interface when returning a controlled refusal.',
  authObserver:
    'The nested observer clears authentication that completes after cancellation or generation replacement; it must observe independently of the awaited attempt.',
  pdfObserver:
    'Render-result observers absorb canvas/text failures immediately while parallel PDF work settles, retaining cancellation and first-error reporting.',
});

const monotonicNow = () => performance.now();

function reviewedIssue(key, rule, path, transition, comment) {
  return Object.freeze({
    key,
    rule,
    component: `${EXPECTED_PROJECT_KEY}:${path}`,
    transition,
    ...(comment === undefined ? {} : { comment }),
  });
}

export const REVIEWED_ISSUES = Object.freeze([
  // Compatibility-sensitive UTF-16 hashes.
  reviewedIssue(
    'AZ-alMNnTAUVQ8sYgogo',
    'typescript:S7758',
    'src/renderer/src/stores/collectionStore.ts',
    'falsepositive',
  ),
  reviewedIssue(
    'AZ7H_5Gegw1m044Cse53',
    'typescript:S7758',
    'src/renderer/src/utils/ics.ts',
    'falsepositive',
  ),

  // Browser-measured contrast false positives.
  reviewedIssue(
    'AZ-alM3UTAUVQ8sYgoim',
    'css:S7924',
    'src/renderer/src/components/settings/settings.css',
    'falsepositive',
  ),
  reviewedIssue(
    'AZ-alM3UTAUVQ8sYgoin',
    'css:S7924',
    'src/renderer/src/components/settings/settings.css',
    'falsepositive',
  ),
  reviewedIssue(
    'AZ-alM3UTAUVQ8sYgoio',
    'css:S7924',
    'src/renderer/src/components/settings/settings.css',
    'falsepositive',
  ),

  // shell.openExternal delegates an allowlisted URL to the OS; it is not an SSRF sink.
  reviewedIssue(
    'AZ-gb17s7Nsapz3kouHt',
    'tssecurity:S5144',
    'src/main/handlers/window/externalLinkHandlers.ts',
    'falsepositive',
  ),

  // Electron ESM startup must finish module evaluation before awaiting app readiness.
  reviewedIssue('AZ-gb19K7Nsapz3kouHu', 'typescript:S7785', 'src/main/index.ts', 'accept'),

  // ErrorBoundary invokes this as a render callback, not as a nested React component.
  reviewedIssue(
    'AZ-alMTTTAUVQ8sYgog2',
    'typescript:S6478',
    'src/renderer/src/features/knowledge/KnowledgeWorkspace.tsx',
    'accept',
  ),

  // Explicit ARIA patterns whose native substitutions would weaken behavior.
  reviewedIssue('AZ-alM5ATAUVQ8sYgoiw', 'Web:S6819', 'src/renderer/index.html', 'accept'),
  reviewedIssue(
    'AZytnJJ1sZaVqOVfTofc',
    'typescript:S6819',
    'src/renderer/src/components/HeaderSearch.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMJcTAUVQ8sYgogf',
    'typescript:S6819',
    'src/renderer/src/components/ConnectionManager.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMI8TAUVQ8sYgogc',
    'typescript:S6819',
    'src/renderer/src/components/SettingsModal.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMAkTAUVQ8sYgogB',
    'typescript:S6819',
    'src/renderer/src/components/settings/administration/RelayServerPanel.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMBCTAUVQ8sYgogD',
    'typescript:S6819',
    'src/renderer/src/components/settings/administration/RoleAccountsPanel.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMVhTAUVQ8sYgohB',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgeLibrary.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMXRTAUVQ8sYgohM',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMXRTAUVQ8sYgohQ',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/management/KnowledgeUploadsSection.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMWYTAUVQ8sYgohI',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgePassageResultList.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMWYTAUVQ8sYgohJ',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgePassageResultList.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMWYTAUVQ8sYgohK',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgePassageResultList.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMWATAUVQ8sYgohH',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMTuTAUVQ8sYgog3',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgeTab.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMfrTAUVQ8sYgohp',
    'typescript:S6819',
    'src/renderer/src/tabs/CloudStatusTab.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMfrTAUVQ8sYgohq',
    'typescript:S6819',
    'src/renderer/src/tabs/CloudStatusTab.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMfrTAUVQ8sYgohy',
    'typescript:S6819',
    'src/renderer/src/tabs/CloudStatusTab.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMkRTAUVQ8sYgoh-',
    'typescript:S6819',
    'src/renderer/src/tabs/DynatraceProblemsTab.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMGbTAUVQ8sYgogX',
    'typescript:S6819',
    'src/renderer/src/components/oncall/OnCallDisplayControl.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMBCTAUVQ8sYgogC',
    'typescript:S6819',
    'src/renderer/src/components/settings/administration/RoleAccountsPanel.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMVGTAUVQ8sYgog_',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgeCategoryManager.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMWATAUVQ8sYgohE',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMWATAUVQ8sYgohF',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMULTAUVQ8sYgog6',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgeTree.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMULTAUVQ8sYgog7',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgeTree.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMkRTAUVQ8sYgoh9',
    'typescript:S6819',
    'src/renderer/src/tabs/DynatraceProblemsTab.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMLQTAUVQ8sYgogj',
    'typescript:S6819',
    'src/renderer/src/components/WebReauthenticationOverlay.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMXRTAUVQ8sYgohV',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/management/KnowledgeTrashSection.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMWATAUVQ8sYgohG',
    'typescript:S6819',
    'src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMFHTAUVQ8sYgogS',
    'typescript:S6819',
    'src/renderer/src/components/HeaderSearch.tsx',
    'accept',
  ),

  // Tests intentionally kept independent or requiring a direct-hook act().
  reviewedIssue(
    'AZ-alLj7TAUVQ8sYgoeM',
    'typescript:S5976',
    'src/main/handlers/windowHandlers.test.ts',
    'accept',
  ),
  reviewedIssue(
    'AZ-alLj7TAUVQ8sYgoeN',
    'typescript:S5976',
    'src/main/handlers/windowHandlers.test.ts',
    'accept',
  ),
  reviewedIssue(
    'AZ-alLj7TAUVQ8sYgoeO',
    'typescript:S5976',
    'src/main/handlers/windowHandlers.test.ts',
    'accept',
  ),
  reviewedIssue(
    'AZ-alLj7TAUVQ8sYgoeP',
    'typescript:S5976',
    'src/main/handlers/windowHandlers.test.ts',
    'accept',
  ),
  reviewedIssue(
    'AZ-alLfyTAUVQ8sYgoeB',
    'typescript:S5976',
    'src/main/utils/pathValidation.test.ts',
    'accept',
  ),
  reviewedIssue(
    'AZ-alL6XTAUVQ8sYgofT',
    'typescript:S5976',
    'src/renderer/src/components/__tests__/SetupScreen.test.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMlJTAUVQ8sYgoh_',
    'typescript:S5976',
    'src/renderer/src/hooks/__tests__/useCollection.test.ts',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMaFTAUVQ8sYgohd',
    'typescript:S5976',
    'src/renderer/src/tabs/__tests__/AlertForm.test.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMaFTAUVQ8sYgohe',
    'typescript:S5976',
    'src/renderer/src/tabs/__tests__/AlertForm.test.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMc4TAUVQ8sYgohk',
    'typescript:S5976',
    'src/renderer/src/tabs/__tests__/AlertsTab.test.tsx',
    'accept',
  ),
  reviewedIssue(
    'AZ-alMl2TAUVQ8sYgoiA',
    'typescript:S8980',
    'src/renderer/src/hooks/__tests__/useAssembler.test.ts',
    'accept',
  ),
  // Individually reviewed async findings. New issue keys and metadata remain blocking.
  reviewedIssue(
    'AaDz9mbP2vql0hCdurer',
    'javascript:S9382',
    'scripts/benchmark-runtime.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.benchmark,
  ),
  reviewedIssue(
    'AaDz9mbP2vql0hCdures',
    'javascript:S9382',
    'scripts/benchmark-runtime.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.benchmark,
  ),
  reviewedIssue(
    'AaDz9mbP2vql0hCduret',
    'javascript:S9382',
    'scripts/benchmark-runtime.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.benchmark,
  ),
  reviewedIssue(
    'AaDz9mbP2vql0hCdureu',
    'javascript:S9382',
    'scripts/benchmark-runtime.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.benchmark,
  ),
  reviewedIssue(
    'AaDz9mam2vql0hCdurei',
    'javascript:S9382',
    'scripts/benchmark-startup.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.benchmark,
  ),
  reviewedIssue(
    'AaDz9mam2vql0hCdurej',
    'javascript:S9382',
    'scripts/benchmark-startup.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.benchmark,
  ),
  reviewedIssue(
    'AaDz9mam2vql0hCdurek',
    'javascript:S9382',
    'scripts/benchmark-startup.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.benchmark,
  ),
  reviewedIssue(
    'AaDz9mam2vql0hCdurel',
    'javascript:S9382',
    'scripts/benchmark-startup.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.benchmark,
  ),
  reviewedIssue(
    'AaDz9mam2vql0hCdurem',
    'javascript:S9382',
    'scripts/benchmark-startup.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.benchmark,
  ),
  reviewedIssue(
    'AaDz9mam2vql0hCduren',
    'javascript:S9382',
    'scripts/benchmark-startup.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.benchmark,
  ),
  reviewedIssue(
    'AaDz9ma82vql0hCdureo',
    'javascript:S9382',
    'scripts/ciReuseArtifactValidation.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.artifact,
  ),
  reviewedIssue(
    'AaDz9ma82vql0hCdurep',
    'javascript:S9382',
    'scripts/ciReuseArtifactValidation.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.artifact,
  ),
  reviewedIssue(
    'AaDz9ma82vql0hCdureq',
    'javascript:S9382',
    'scripts/ciReuseArtifactValidation.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.artifact,
  ),
  reviewedIssue(
    'AaDz9mXd2vql0hCdureI',
    'javascript:S9382',
    'scripts/knowledge-upload-soak.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mXd2vql0hCdureJ',
    'javascript:S9382',
    'scripts/knowledge-upload-soak.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mXd2vql0hCdureK',
    'javascript:S9382',
    'scripts/knowledge-upload-soak.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mXd2vql0hCdureL',
    'javascript:S9382',
    'scripts/knowledge-upload-soak.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mXd2vql0hCdureM',
    'javascript:S9382',
    'scripts/knowledge-upload-soak.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mXd2vql0hCdureN',
    'javascript:S9382',
    'scripts/knowledge-upload-soak.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mX42vql0hCdureP',
    'javascript:S9382',
    'scripts/package-windows.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mX42vql0hCdureQ',
    'javascript:S9382',
    'scripts/package-windows.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mXr2vql0hCdureO',
    'javascript:S9382',
    'scripts/run-sonar-ci.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.scanner,
  ),
  reviewedIssue(
    'AaDz9mZd2vql0hCdureU',
    'javascript:S9382',
    'scripts/seed.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mZd2vql0hCdureV',
    'javascript:S9382',
    'scripts/seed.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mZd2vql0hCdureW',
    'javascript:S9382',
    'scripts/seed.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mZd2vql0hCdureX',
    'javascript:S9382',
    'scripts/seed.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mZd2vql0hCdureY',
    'javascript:S9382',
    'scripts/seed.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mZd2vql0hCdureZ',
    'javascript:S9382',
    'scripts/seed.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mZd2vql0hCdurea',
    'javascript:S9382',
    'scripts/seed.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mZd2vql0hCdureb',
    'javascript:S9382',
    'scripts/seed.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mZd2vql0hCdurec',
    'javascript:S9382',
    'scripts/seed.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mZd2vql0hCdured',
    'javascript:S9382',
    'scripts/seed.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mZd2vql0hCduree',
    'javascript:S9382',
    'scripts/seed.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mZd2vql0hCduref',
    'javascript:S9382',
    'scripts/seed.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mZd2vql0hCdureg',
    'javascript:S9382',
    'scripts/seed.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mZd2vql0hCdureh',
    'javascript:S9382',
    'scripts/seed.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mXD2vql0hCdureF',
    'javascript:S9382',
    'scripts/seedKnowledge.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mXD2vql0hCdureG',
    'javascript:S9382',
    'scripts/seedKnowledge.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.fixture,
  ),
  reviewedIssue(
    'AaDz9mcb2vql0hCdurev',
    'javascript:S9382',
    'scripts/sonar-api-client.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.scanner,
  ),
  reviewedIssue(
    'AaDz9mcr2vql0hCdurew',
    'javascript:S9382',
    'scripts/sonar-quality-gate.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.scanner,
  ),
  reviewedIssue(
    'AaDz9mcr2vql0hCdurex',
    'javascript:S9382',
    'scripts/sonar-quality-gate.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.scanner,
  ),
  reviewedIssue(
    'AaDz9mYo2vql0hCdureS',
    'javascript:S9382',
    'scripts/sonar-reviewed-issues.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.scanner,
  ),
  reviewedIssue(
    'AaDz9mY-2vql0hCdureT',
    'javascript:S9382',
    'scripts/startup-benchmark-utils.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.benchmark,
  ),
  reviewedIssue(
    'AaDz9mXP2vql0hCdureH',
    'javascript:S9382',
    'scripts/verify-windows-native-modules.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.native,
  ),
  reviewedIssue(
    'AaDz9mWy2vql0hCdureE',
    'javascript:S9382',
    'scripts/wait-for-coverage.mjs',
    'accept',
    ASYNC_REVIEW_RATIONALES.scanner,
  ),
  reviewedIssue(
    'AaDz9lla2vql0hCdurbN',
    'typescript:S7503',
    'src/main/handlers/authHandlers.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.ipcPromise,
  ),
  reviewedIssue(
    'AaDz9lla2vql0hCdurbO',
    'typescript:S7503',
    'src/main/handlers/authHandlers.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.ipcPromise,
  ),
  reviewedIssue(
    'AaDz9lkL2vql0hCdurbG',
    'typescript:S7503',
    'src/main/handlers/backupHandlers.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.ipcPromise,
  ),
  reviewedIssue(
    'AaDz9lkL2vql0hCdurbH',
    'typescript:S7503',
    'src/main/handlers/backupHandlers.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.ipcPromise,
  ),
  reviewedIssue(
    'AaDz9lku2vql0hCdurbI',
    'typescript:S7503',
    'src/main/handlers/dynatraceHandlers.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.ipcPromise,
  ),
  reviewedIssue(
    'AaDz9lku2vql0hCdurbJ',
    'typescript:S7503',
    'src/main/handlers/dynatraceHandlers.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.ipcPromise,
  ),
  reviewedIssue(
    'AaDz9lku2vql0hCdurbK',
    'typescript:S7503',
    'src/main/handlers/dynatraceHandlers.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.ipcPromise,
  ),
  reviewedIssue(
    'AaDz9lku2vql0hCdurbL',
    'typescript:S7503',
    'src/main/handlers/dynatraceHandlers.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.ipcPromise,
  ),
  reviewedIssue(
    'AaDz9ljH2vql0hCdurbE',
    'typescript:S7503',
    'src/main/handlers/releaseUpdateHandlers.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.ipcPromise,
  ),
  reviewedIssue(
    'AaDz9ljl2vql0hCdurbF',
    'typescript:S7503',
    'src/main/handlers/window/clipboardHandlers.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.ipcPromise,
  ),
  reviewedIssue(
    'AaDz9lzX2vql0hCdurcE',
    'typescript:S7503',
    'src/main/knowledge/KnowledgeUploadCapacity.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.callbackPromise,
  ),
  reviewedIssue(
    'AaDz9lxk2vql0hCdurb7',
    'typescript:S7503',
    'src/main/knowledge/registerKnowledgeManagementCommands.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.callbackPromise,
  ),
  reviewedIssue(
    'AaDz9lw22vql0hCdurb5',
    'typescript:S7503',
    'src/main/privileged/PrivilegedCommandProcessor.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.callbackPromise,
  ),
  reviewedIssue(
    'AaDz9lwM2vql0hCdurbw',
    'typescript:S7503',
    'src/main/privileged/privilegedRuntime.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.callbackPromise,
  ),
  reviewedIssue(
    'AaDz9lwM2vql0hCdurbx',
    'typescript:S7503',
    'src/main/privileged/privilegedRuntime.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.callbackPromise,
  ),
  reviewedIssue(
    'AaDz9lwM2vql0hCdurby',
    'typescript:S7503',
    'src/main/privileged/privilegedRuntime.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.callbackPromise,
  ),
  reviewedIssue(
    'AaDz9lwM2vql0hCdurbz',
    'typescript:S7503',
    'src/main/privileged/privilegedRuntime.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.callbackPromise,
  ),
  reviewedIssue(
    'AaDz9lwM2vql0hCdurb0',
    'typescript:S7503',
    'src/main/privileged/privilegedRuntime.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.callbackPromise,
  ),
  reviewedIssue(
    'AaDz9lp12vql0hCdurba',
    'typescript:S7503',
    'src/main/releases/ReleaseUpdateManager.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.callbackPromise,
  ),
  reviewedIssue(
    'AaDz9lrE2vql0hCdurbh',
    'typescript:S7503',
    'src/main/releases/productionRecoveryRestart.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.callbackPromise,
  ),
  reviewedIssue(
    'AaDz9l3x2vql0hCdurcy',
    'typescript:S7503',
    'src/main/services/operationalServices.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.operationPromise,
  ),
  reviewedIssue(
    'AaDz9lhN2vql0hCdura_',
    'typescript:S7503',
    'src/main/web/WebKnowledgeSession.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.queuePromise,
  ),
  reviewedIssue(
    'AaDz9lhN2vql0hCdurbA',
    'typescript:S7503',
    'src/main/web/WebKnowledgeSession.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.queuePromise,
  ),
  reviewedIssue(
    'AaDz9lf32vql0hCdurau',
    'typescript:S7503',
    'src/main/web/routes/knowledgeRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lf32vql0hCdurav',
    'typescript:S7503',
    'src/main/web/routes/knowledgeRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lgW2vql0hCdura0',
    'typescript:S7503',
    'src/main/web/routes/operationalRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lgW2vql0hCdura1',
    'typescript:S7503',
    'src/main/web/routes/operationalRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lgW2vql0hCdura2',
    'typescript:S7503',
    'src/main/web/routes/operationalRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lgW2vql0hCdura3',
    'typescript:S7503',
    'src/main/web/routes/operationalRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lgW2vql0hCdura4',
    'typescript:S7503',
    'src/main/web/routes/operationalRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lgW2vql0hCdura5',
    'typescript:S7503',
    'src/main/web/routes/operationalRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lgW2vql0hCdura6',
    'typescript:S7503',
    'src/main/web/routes/operationalRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lgW2vql0hCdura7',
    'typescript:S7503',
    'src/main/web/routes/operationalRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lgW2vql0hCdura8',
    'typescript:S7503',
    'src/main/web/routes/operationalRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lgW2vql0hCdura9',
    'typescript:S7503',
    'src/main/web/routes/operationalRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lgm2vql0hCdura-',
    'typescript:S7503',
    'src/main/web/routes/privilegedRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lgF2vql0hCduraw',
    'typescript:S7503',
    'src/main/web/routes/sessionRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lgF2vql0hCdurax',
    'typescript:S7503',
    'src/main/web/routes/sessionRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lgF2vql0hCduray',
    'typescript:S7503',
    'src/main/web/routes/sessionRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9lgF2vql0hCduraz',
    'typescript:S7503',
    'src/main/web/routes/sessionRoutes.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.webPromise,
  ),
  reviewedIssue(
    'AaDz9mPp2vql0hCdurdp',
    'typescript:S7503',
    'src/renderer/src/hooks/useCollection.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.refetchPromise,
  ),
  reviewedIssue(
    'AaDz9mBh2vql0hCdurdh',
    'typescript:S7503',
    'src/renderer/src/runtime/WebSessionClient.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.activationPromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdH',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdI',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdJ',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdK',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdL',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdM',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdN',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdO',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdP',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdQ',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdR',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdS',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdT',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdU',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdV',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdW',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdX',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdY',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdZ',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurda',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdb',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdc',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdd',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurde',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdf',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mBJ2vql0hCdurdg',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/desktopFallbackApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mAg2vql0hCdurc2',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/knowledgeWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mA82vql0hCdurc7',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/operationalWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mA82vql0hCdurc8',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/operationalWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mA82vql0hCdurc9',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/operationalWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mA82vql0hCdurc-',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/operationalWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mA82vql0hCdurc_',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/operationalWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mA82vql0hCdurdA',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/operationalWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mA82vql0hCdurdB',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/operationalWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mA82vql0hCdurdC',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/operationalWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mA82vql0hCdurdD',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/operationalWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mA82vql0hCdurdE',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/operationalWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mA82vql0hCdurdF',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/operationalWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mA82vql0hCdurdG',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/operationalWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mAs2vql0hCdurc3',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/privilegedWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mAs2vql0hCdurc4',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/privilegedWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mAs2vql0hCdurc5',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/privilegedWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9mAs2vql0hCdurc6',
    'typescript:S7503',
    'src/renderer/src/runtime/webBridge/privilegedWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bridgePromise,
  ),
  reviewedIssue(
    'AaDz9ll-2vql0hCdurbR',
    'typescript:S9381',
    'src/main/pocketbase/RelayAppUserAuthCoordinator.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.authObserver,
  ),
  reviewedIssue(
    'AaDz9mJs2vql0hCdurdl',
    'typescript:S9381',
    'src/renderer/src/features/knowledge/KnowledgePdfPage.tsx',
    'accept',
    ASYNC_REVIEW_RATIONALES.pdfObserver,
  ),
  reviewedIssue(
    'AaDz9mJs2vql0hCdurdm',
    'typescript:S9381',
    'src/renderer/src/features/knowledge/KnowledgePdfPage.tsx',
    'accept',
    ASYNC_REVIEW_RATIONALES.pdfObserver,
  ),
  reviewedIssue(
    'AaDz9lXK2vql0hCdurag',
    'typescript:S9382',
    'src/main/app/pocketbaseBootstrap.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bootstrap,
  ),
  reviewedIssue(
    'AaDz9lXK2vql0hCdurah',
    'typescript:S9382',
    'src/main/app/pocketbaseBootstrap.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bootstrap,
  ),
  reviewedIssue(
    'AaDz9lXK2vql0hCdurai',
    'typescript:S9382',
    'src/main/app/pocketbaseBootstrap.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bootstrap,
  ),
  reviewedIssue(
    'AaDz9lah2vql0hCduraj',
    'typescript:S9382',
    'src/main/app/windowsRuntimeCleanup.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.cleanup,
  ),
  reviewedIssue(
    'AaDz9lah2vql0hCdurak',
    'typescript:S9382',
    'src/main/app/windowsRuntimeCleanup.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.cleanup,
  ),
  reviewedIssue(
    'AaDz9lah2vql0hCdural',
    'typescript:S9382',
    'src/main/app/windowsRuntimeCleanup.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.cleanup,
  ),
  reviewedIssue(
    'AaDz9lah2vql0hCduram',
    'typescript:S9382',
    'src/main/app/windowsRuntimeCleanup.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.cleanup,
  ),
  reviewedIssue(
    'AaDz9lah2vql0hCduran',
    'typescript:S9382',
    'src/main/app/windowsRuntimeCleanup.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.cleanup,
  ),
  reviewedIssue(
    'AaDz9lah2vql0hCdurao',
    'typescript:S9382',
    'src/main/app/windowsRuntimeCleanup.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.cleanup,
  ),
  reviewedIssue(
    'AaDz9lrw2vql0hCdurbk',
    'typescript:S9382',
    'src/main/cache/SyncManager.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.cache,
  ),
  reviewedIssue(
    'AaDz9lud2vql0hCdurbq',
    'typescript:S9382',
    'src/main/dynatrace/DynatraceClassicProblemsClient.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.classic,
  ),
  reviewedIssue(
    'AaDz9lud2vql0hCdurbr',
    'typescript:S9382',
    'src/main/dynatrace/DynatraceClassicProblemsClient.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.classic,
  ),
  reviewedIssue(
    'AaDz9lil2vql0hCdurbD',
    'typescript:S9382',
    'src/main/handlers/cloudStatus/CloudStatusSnapshotStore.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.snapshot,
  ),
  reviewedIssue(
    'AaDz9lhk2vql0hCdurbB',
    'typescript:S9382',
    'src/main/handlers/cloudStatus/crowdstrikeProvider.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.stream,
  ),
  reviewedIssue(
    'AaDz9liO2vql0hCdurbC',
    'typescript:S9382',
    'src/main/handlers/cloudStatus/proofpointProvider.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.stream,
  ),
  reviewedIssue(
    'AaDz9llE2vql0hCdurbM',
    'typescript:S9382',
    'src/main/handlers/pocketbaseConnectionHandlers.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bootstrap,
  ),
  reviewedIssue(
    'AaDz9l0S2vql0hCdurcJ',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeCategoryMigration.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeMigration,
  ),
  reviewedIssue(
    'AaDz9l0S2vql0hCdurcK',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeCategoryMigration.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeMigration,
  ),
  reviewedIssue(
    'AaDz9lyS2vql0hCdurb8',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeCoverService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeCache,
  ),
  reviewedIssue(
    'AaDz9lyS2vql0hCdurb9',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeCoverService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeCache,
  ),
  reviewedIssue(
    'AaDz9lyS2vql0hCdurb-',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeCoverService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeCache,
  ),
  reviewedIssue(
    'AaDz9lyS2vql0hCdurb_',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeCoverService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeCache,
  ),
  reviewedIssue(
    'AaDz9l1N2vql0hCdurcW',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeManagementCleanup.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeCleanup,
  ),
  reviewedIssue(
    'AaDz9l1N2vql0hCdurcX',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeManagementCleanup.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeCleanup,
  ),
  reviewedIssue(
    'AaDz9l1N2vql0hCdurcY',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeManagementCleanup.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeCleanup,
  ),
  reviewedIssue(
    'AaDz9l1A2vql0hCdurcR',
    'typescript:S9382',
    'src/main/knowledge/KnowledgePdfService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeCache,
  ),
  reviewedIssue(
    'AaDz9l1A2vql0hCdurcS',
    'typescript:S9382',
    'src/main/knowledge/KnowledgePdfService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeCache,
  ),
  reviewedIssue(
    'AaDz9l1A2vql0hCdurcT',
    'typescript:S9382',
    'src/main/knowledge/KnowledgePdfService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeCache,
  ),
  reviewedIssue(
    'AaDz9l1A2vql0hCdurcU',
    'typescript:S9382',
    'src/main/knowledge/KnowledgePdfService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeCache,
  ),
  reviewedIssue(
    'AaDz9l1A2vql0hCdurcV',
    'typescript:S9382',
    'src/main/knowledge/KnowledgePdfService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeCache,
  ),
  reviewedIssue(
    'AaDz9l1v2vql0hCdurcd',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeSearchEngine.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeSearch,
  ),
  reviewedIssue(
    'AaDz9l1v2vql0hCdurce',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeSearchEngine.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeSearch,
  ),
  reviewedIssue(
    'AaDz9l1v2vql0hCdurcf',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeSearchEngine.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeSearch,
  ),
  reviewedIssue(
    'AaDz9l1v2vql0hCdurcg',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeSearchEngine.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeSearch,
  ),
  reviewedIssue(
    'AaDz9l1v2vql0hCdurch',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeSearchEngine.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeSearch,
  ),
  reviewedIssue(
    'AaDz9l1v2vql0hCdurci',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeSearchEngine.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeSearch,
  ),
  reviewedIssue(
    'AaDz9l1v2vql0hCdurcj',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeSearchEngine.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeSearch,
  ),
  reviewedIssue(
    'AaDz9l1v2vql0hCdurck',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeSearchEngine.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeSearch,
  ),
  reviewedIssue(
    'AaDz9l1v2vql0hCdurcl',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeSearchEngine.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeSearch,
  ),
  reviewedIssue(
    'AaDz9l1v2vql0hCdurcm',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeSearchEngine.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeSearch,
  ),
  reviewedIssue(
    'AaDz9l1c2vql0hCdurcZ',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeSearchIndexer.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeIndexer,
  ),
  reviewedIssue(
    'AaDz9l1c2vql0hCdurca',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeSearchIndexer.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeIndexer,
  ),
  reviewedIssue(
    'AaDz9l1c2vql0hCdurcb',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeSearchIndexer.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeIndexer,
  ),
  reviewedIssue(
    'AaDz9l1c2vql0hCdurcc',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeSearchIndexer.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeIndexer,
  ),
  reviewedIssue(
    'AaDz9l2G2vql0hCdurcn',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeUploadCoordinator.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeUpload,
  ),
  reviewedIssue(
    'AaDz9l2G2vql0hCdurco',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeUploadCoordinator.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeUpload,
  ),
  reviewedIssue(
    'AaDz9l2G2vql0hCdurcp',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeUploadCoordinator.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeUpload,
  ),
  reviewedIssue(
    'AaDz9l2G2vql0hCdurcq',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeUploadCoordinator.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeUpload,
  ),
  reviewedIssue(
    'AaDz9l0E2vql0hCdurcI',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeUploadScheduler.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeUpload,
  ),
  reviewedIssue(
    'AaDz9lyt2vql0hCdurcA',
    'typescript:S9382',
    'src/main/knowledge/KnowledgeUploadService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeUpload,
  ),
  reviewedIssue(
    'AaDz9l0w2vql0hCdurcN',
    'typescript:S9382',
    'src/main/knowledge/ManagedKnowledgeService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeMigration,
  ),
  reviewedIssue(
    'AaDz9l0w2vql0hCdurcO',
    'typescript:S9382',
    'src/main/knowledge/ManagedKnowledgeService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeMigration,
  ),
  reviewedIssue(
    'AaDz9l0w2vql0hCdurcP',
    'typescript:S9382',
    'src/main/knowledge/ManagedKnowledgeService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeMigration,
  ),
  reviewedIssue(
    'AaDz9l0w2vql0hCdurcQ',
    'typescript:S9382',
    'src/main/knowledge/ManagedKnowledgeService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeMigration,
  ),
  reviewedIssue(
    'AaDz9lz02vql0hCdurcH',
    'typescript:S9382',
    'src/main/knowledge/PocketBaseKnowledgeUploadRepository.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeUpload,
  ),
  reviewedIssue(
    'AaDz9lzM2vql0hCdurcD',
    'typescript:S9382',
    'src/main/knowledge/knowledgeChunking.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.stream,
  ),
  reviewedIssue(
    'AaDz9lzm2vql0hCdurcF',
    'typescript:S9382',
    'src/main/knowledge/knowledgeExtractor.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeExtraction,
  ),
  reviewedIssue(
    'AaDz9lzm2vql0hCdurcG',
    'typescript:S9382',
    'src/main/knowledge/knowledgeExtractor.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeExtraction,
  ),
  reviewedIssue(
    'AaDz9ly-2vql0hCdurcB',
    'typescript:S9382',
    'src/main/knowledge/knowledgeOutline.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeExtraction,
  ),
  reviewedIssue(
    'AaDz9ly-2vql0hCdurcC',
    'typescript:S9382',
    'src/main/knowledge/knowledgeOutline.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeExtraction,
  ),
  reviewedIssue(
    'AaDz9l0e2vql0hCdurcL',
    'typescript:S9382',
    'src/main/knowledge/knowledgeSearchExtraction.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeExtraction,
  ),
  reviewedIssue(
    'AaDz9l0e2vql0hCdurcM',
    'typescript:S9382',
    'src/main/knowledge/knowledgeSearchExtraction.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.knowledgeExtraction,
  ),
  reviewedIssue(
    'AaDz9l2h2vql0hCdurcs',
    'typescript:S9382',
    'src/main/logger.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.logger,
  ),
  reviewedIssue(
    'AaDz9l2h2vql0hCdurct',
    'typescript:S9382',
    'src/main/logger.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.logger,
  ),
  reviewedIssue(
    'AaDz9l2h2vql0hCdurcu',
    'typescript:S9382',
    'src/main/logger.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.logger,
  ),
  reviewedIssue(
    'AaDz9l2h2vql0hCdurcv',
    'typescript:S9382',
    'src/main/logger.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.logger,
  ),
  reviewedIssue(
    'AaDz9l2h2vql0hCdurcw',
    'typescript:S9382',
    'src/main/logger.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.logger,
  ),
  reviewedIssue(
    'AaDz9l2h2vql0hCdurcx',
    'typescript:S9382',
    'src/main/logger.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.logger,
  ),
  reviewedIssue(
    'AaDz9lol2vql0hCdurbW',
    'typescript:S9382',
    'src/main/pocketbase/BackupManager.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.backup,
  ),
  reviewedIssue(
    'AaDz9lol2vql0hCdurbX',
    'typescript:S9382',
    'src/main/pocketbase/BackupManager.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.backup,
  ),
  reviewedIssue(
    'AaDz9loK2vql0hCdurbT',
    'typescript:S9382',
    'src/main/pocketbase/CollectionBootstrap.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bootstrap,
  ),
  reviewedIssue(
    'AaDz9loK2vql0hCdurbU',
    'typescript:S9382',
    'src/main/pocketbase/CollectionBootstrap.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bootstrap,
  ),
  reviewedIssue(
    'AaDz9loK2vql0hCdurbV',
    'typescript:S9382',
    'src/main/pocketbase/CollectionBootstrap.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bootstrap,
  ),
  reviewedIssue(
    'AaDz9lo42vql0hCdurbY',
    'typescript:S9382',
    'src/main/pocketbase/PocketBaseProcess.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bootstrap,
  ),
  reviewedIssue(
    'AaDz9lmN2vql0hCdurbS',
    'typescript:S9382',
    'src/main/pocketbase/RetentionManager.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.retention,
  ),
  reviewedIssue(
    'AaDz9llr2vql0hCdurbP',
    'typescript:S9382',
    'src/main/pocketbase/schema/collectionReconciler.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bootstrap,
  ),
  reviewedIssue(
    'AaDz9llr2vql0hCdurbQ',
    'typescript:S9382',
    'src/main/pocketbase/schema/collectionReconciler.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.bootstrap,
  ),
  reviewedIssue(
    'AaDz9lvj2vql0hCdurbs',
    'typescript:S9382',
    'src/main/privileged/PrivilegedAccountManager.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.privileged,
  ),
  reviewedIssue(
    'AaDz9lv22vql0hCdurbt',
    'typescript:S9382',
    'src/main/privileged/PrivilegedPocketBaseTransport.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.privilegedPoll,
  ),
  reviewedIssue(
    'AaDz9lv22vql0hCdurbu',
    'typescript:S9382',
    'src/main/privileged/PrivilegedPocketBaseTransport.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.privilegedPoll,
  ),
  reviewedIssue(
    'AaDz9lxO2vql0hCdurb6',
    'typescript:S9382',
    'src/main/privileged/PublisherAssignmentManager.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.privileged,
  ),
  reviewedIssue(
    'AaDz9lwf2vql0hCdurb1',
    'typescript:S9382',
    'src/main/privileged/RoleAccountMigration.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.privileged,
  ),
  reviewedIssue(
    'AaDz9lwf2vql0hCdurb2',
    'typescript:S9382',
    'src/main/privileged/RoleAccountMigration.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.privileged,
  ),
  reviewedIssue(
    'AaDz9lwf2vql0hCdurb3',
    'typescript:S9382',
    'src/main/privileged/RoleAccountMigration.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.privileged,
  ),
  reviewedIssue(
    'AaDz9lwf2vql0hCdurb4',
    'typescript:S9382',
    'src/main/privileged/RoleAccountMigration.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.privileged,
  ),
  reviewedIssue(
    'AaDz9lwM2vql0hCdurbv',
    'typescript:S9382',
    'src/main/privileged/privilegedRuntime.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.ownerDispose,
  ),
  reviewedIssue(
    'AaDz9lqP2vql0hCdurbd',
    'typescript:S9382',
    'src/main/releases/RecoveryManager.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.releaseCleanup,
  ),
  reviewedIssue(
    'AaDz9lqu2vql0hCdurbf',
    'typescript:S9382',
    'src/main/releases/RecoverySnapshot.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.backup,
  ),
  reviewedIssue(
    'AaDz9lqu2vql0hCdurbg',
    'typescript:S9382',
    'src/main/releases/RecoverySnapshot.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.backup,
  ),
  reviewedIssue(
    'AaDz9lqf2vql0hCdurbe',
    'typescript:S9382',
    'src/main/releases/RelayReleaseArchive.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.stream,
  ),
  reviewedIssue(
    'AaDz9lre2vql0hCdurbi',
    'typescript:S9382',
    'src/main/releases/ReleaseAssetDownloader.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.stream,
  ),
  reviewedIssue(
    'AaDz9lre2vql0hCdurbj',
    'typescript:S9382',
    'src/main/releases/ReleaseAssetDownloader.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.stream,
  ),
  reviewedIssue(
    'AaDz9lp12vql0hCdurbb',
    'typescript:S9382',
    'src/main/releases/ReleaseUpdateManager.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.releaseCleanup,
  ),
  reviewedIssue(
    'AaDz9lp12vql0hCdurbc',
    'typescript:S9382',
    'src/main/releases/ReleaseUpdateManager.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.releaseCleanup,
  ),
  reviewedIssue(
    'AaDz9lpe2vql0hCdurbZ',
    'typescript:S9382',
    'src/main/releases/ReleaseUpdateService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.stream,
  ),
  reviewedIssue(
    'AaDz9ltR2vql0hCdurbn',
    'typescript:S9382',
    'src/main/sdp/SdpBulk.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.sdp,
  ),
  reviewedIssue(
    'AaDz9lt_2vql0hCdurbp',
    'typescript:S9382',
    'src/main/sdp/SdpChanges.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.sdp,
  ),
  reviewedIssue(
    'AaDz9ltB2vql0hCdurbl',
    'typescript:S9382',
    'src/main/sdp/SdpProvider.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.sdp,
  ),
  reviewedIssue(
    'AaDz9ltB2vql0hCdurbm',
    'typescript:S9382',
    'src/main/sdp/SdpProvider.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.sdp,
  ),
  reviewedIssue(
    'AaDz9ltd2vql0hCdurbo',
    'typescript:S9382',
    'src/main/sdp/SdpReplies.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.sdp,
  ),
  reviewedIssue(
    'AaDz9lfl2vql0hCduraq',
    'typescript:S9382',
    'src/main/web/WebKnowledgeUploadStaging.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.stream,
  ),
  reviewedIssue(
    'AaDz9lfl2vql0hCdurar',
    'typescript:S9382',
    'src/main/web/WebKnowledgeUploadStaging.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.stream,
  ),
  reviewedIssue(
    'AaDz9lfl2vql0hCduras',
    'typescript:S9382',
    'src/main/web/WebKnowledgeUploadStaging.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.stream,
  ),
  reviewedIssue(
    'AaDz9lfl2vql0hCdurat',
    'typescript:S9382',
    'src/main/web/WebKnowledgeUploadStaging.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.stream,
  ),
  reviewedIssue(
    'AaDz9mDm2vql0hCdurdj',
    'typescript:S9382',
    'src/renderer/src/features/knowledge/useKnowledgeManagement.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.pagination,
  ),
  reviewedIssue(
    'AaDz9mDm2vql0hCdurdk',
    'typescript:S9382',
    'src/renderer/src/features/knowledge/useKnowledgeManagement.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.pagination,
  ),
  reviewedIssue(
    'AaDz9mKs2vql0hCdurdn',
    'typescript:S9382',
    'src/renderer/src/features/tickets/sdpWorkflowAutoLink.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.autoLink,
  ),
  reviewedIssue(
    'AaDz9mKs2vql0hCdurdo',
    'typescript:S9382',
    'src/renderer/src/features/tickets/sdpWorkflowAutoLink.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.autoLink,
  ),
  reviewedIssue(
    'AaDz9mP72vql0hCdurdq',
    'typescript:S9382',
    'src/renderer/src/hooks/useDataManager.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.export,
  ),
  reviewedIssue(
    'AaDz9mP72vql0hCdurdr',
    'typescript:S9382',
    'src/renderer/src/hooks/useDataManager.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.export,
  ),
  reviewedIssue(
    'AaDz9mAg2vql0hCdurcz',
    'typescript:S9382',
    'src/renderer/src/runtime/webBridge/knowledgeWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.stream,
  ),
  reviewedIssue(
    'AaDz9mAg2vql0hCdurc0',
    'typescript:S9382',
    'src/renderer/src/runtime/webBridge/knowledgeWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.stream,
  ),
  reviewedIssue(
    'AaDz9mAg2vql0hCdurc1',
    'typescript:S9382',
    'src/renderer/src/runtime/webBridge/knowledgeWebApi.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.stream,
  ),
  reviewedIssue(
    'AaDz9mRb2vql0hCdurd0',
    'typescript:S9382',
    'src/renderer/src/services/alertHistoryService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mSR2vql0hCdureA',
    'typescript:S9382',
    'src/renderer/src/services/bridgeHistoryService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mQn2vql0hCdurds',
    'typescript:S9382',
    'src/renderer/src/services/contactService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mQn2vql0hCdurdt',
    'typescript:S9382',
    'src/renderer/src/services/contactService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mQn2vql0hCdurdu',
    'typescript:S9382',
    'src/renderer/src/services/contactService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mSt2vql0hCdureB',
    'typescript:S9382',
    'src/renderer/src/services/importExportService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mSt2vql0hCdureC',
    'typescript:S9382',
    'src/renderer/src/services/importExportService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mSt2vql0hCdureD',
    'typescript:S9382',
    'src/renderer/src/services/importExportService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mRM2vql0hCdurdy',
    'typescript:S9382',
    'src/renderer/src/services/oncallBoardSettingsService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mRM2vql0hCdurdz',
    'typescript:S9382',
    'src/renderer/src/services/oncallBoardSettingsService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mRr2vql0hCdurd1',
    'typescript:S9382',
    'src/renderer/src/services/oncallService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mRr2vql0hCdurd2',
    'typescript:S9382',
    'src/renderer/src/services/oncallService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mRr2vql0hCdurd3',
    'typescript:S9382',
    'src/renderer/src/services/oncallService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mRr2vql0hCdurd4',
    'typescript:S9382',
    'src/renderer/src/services/oncallService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mRr2vql0hCdurd5',
    'typescript:S9382',
    'src/renderer/src/services/oncallService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mRr2vql0hCdurd6',
    'typescript:S9382',
    'src/renderer/src/services/oncallService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mRr2vql0hCdurd7',
    'typescript:S9382',
    'src/renderer/src/services/oncallService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mQ02vql0hCdurdv',
    'typescript:S9382',
    'src/renderer/src/services/serverService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mQ02vql0hCdurdw',
    'typescript:S9382',
    'src/renderer/src/services/serverService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mQ02vql0hCdurdx',
    'typescript:S9382',
    'src/renderer/src/services/serverService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.crud,
  ),
  reviewedIssue(
    'AaDz9mR-2vql0hCdurd8',
    'typescript:S9382',
    'src/renderer/src/services/serverSyncService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.guardedSync,
  ),
  reviewedIssue(
    'AaDz9mR-2vql0hCdurd9',
    'typescript:S9382',
    'src/renderer/src/services/serverSyncService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.guardedSync,
  ),
  reviewedIssue(
    'AaDz9mR-2vql0hCdurd-',
    'typescript:S9382',
    'src/renderer/src/services/serverSyncService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.guardedSync,
  ),
  reviewedIssue(
    'AaDz9mR-2vql0hCdurd_',
    'typescript:S9382',
    'src/renderer/src/services/serverSyncService.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.guardedSync,
  ),
  reviewedIssue(
    'AaDz9mCL2vql0hCdurdi',
    'typescript:S9382',
    'src/renderer/src/stores/collectionStore.ts',
    'accept',
    ASYNC_REVIEW_RATIONALES.collection,
  ),
]);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function boundedString(value, maximumLength = 1_024) {
  return nonEmptyString(value) && value.length <= maximumLength;
}

export { parseProjectKey };

function branchArgumentValue(argv, index) {
  const argument = argv[index];
  if (argument.startsWith('--branch=')) {
    return { consumed: 1, value: argument.slice('--branch='.length) };
  }
  if (argument === '--branch') {
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.startsWith('--')) {
      throw new Error('Missing value for --branch.');
    }
    return { consumed: 2, value };
  }
  throw new Error(`Unknown argument: ${argument}`);
}

export function parseReviewedArgs(argv) {
  let branch;
  let apply = false;
  for (let index = 0; index < argv.length;) {
    if (argv[index] === '--apply') {
      if (apply) throw new Error('Duplicate --apply argument.');
      apply = true;
      index += 1;
      continue;
    }
    const parsed = branchArgumentValue(argv, index);
    if (branch !== undefined) throw new Error('Duplicate --branch argument.');
    branch = parsed.value;
    index += parsed.consumed;
  }
  if (branch !== EXPECTED_BRANCH) {
    throw new Error('Reviewed Sonar issue reconciliation is restricted to branch main.');
  }
  if (!apply) {
    throw new Error('Reviewed Sonar issue reconciliation requires the explicit --apply latch.');
  }
  return { apply: true, branch: EXPECTED_BRANCH };
}

export function validateReviewedIssueManifest(reviewedIssues = REVIEWED_ISSUES) {
  if (!Array.isArray(reviewedIssues) || reviewedIssues.length !== 320) {
    throw new Error('The reviewed Sonar issue manifest must contain exactly 320 issues.');
  }
  const keys = new Set();
  const counts = { accept: 0, falsepositive: 0 };
  for (const issue of reviewedIssues) {
    if (
      issue === null ||
      typeof issue !== 'object' ||
      Array.isArray(issue) ||
      !boundedString(issue.key, 128) ||
      !boundedString(issue.rule, 128) ||
      !boundedString(issue.component) ||
      !Object.hasOwn(REVIEWED_STATUS_BY_TRANSITION, issue.transition) ||
      (Object.hasOwn(issue, 'comment') && !boundedString(issue.comment)) ||
      (!Object.hasOwn(REVIEW_COMMENT_BY_RULE, issue.rule) && !boundedString(issue.comment))
    ) {
      throw new Error('The reviewed Sonar issue manifest contains invalid metadata.');
    }
    if (keys.has(issue.key)) {
      throw new Error(`The reviewed Sonar issue manifest repeats key ${issue.key}.`);
    }
    if (!issue.component.startsWith(`${EXPECTED_PROJECT_KEY}:`)) {
      throw new Error(`Reviewed Sonar issue ${issue.key} belongs to an unexpected project.`);
    }
    keys.add(issue.key);
    counts[issue.transition] += 1;
  }
  if (counts.accept !== 314 || counts.falsepositive !== 6) {
    throw new Error(
      'The reviewed Sonar issue manifest must contain 314 accepts and 6 false positives.',
    );
  }
  return reviewedIssues;
}

function validateIssue(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !boundedString(value.key, 128) ||
    !boundedString(value.rule, 128) ||
    !boundedString(value.component) ||
    !nonEmptyString(value.status) ||
    (value.issueStatus !== undefined &&
      value.issueStatus !== null &&
      typeof value.issueStatus !== 'string') ||
    (value.resolution !== undefined &&
      value.resolution !== null &&
      typeof value.resolution !== 'string')
  ) {
    throw new Error('Sonar returned invalid issue metadata.');
  }
  const status = normalizeSonarIssueStatus(value);
  if (!SEARCHED_STATUSES.includes(status)) {
    throw new Error(`Sonar returned unsupported status for issue ${value.key}.`);
  }
  return {
    key: value.key,
    rule: value.rule,
    component: value.component,
    status,
  };
}

function validateRequestTimeout(requestTimeoutMs) {
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw new Error('Sonar request timeout must be between 1 and 60000 milliseconds.');
  }
}

function validateTiming(timeoutMs, now) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error('Sonar reconciliation timeout must be between 1 and 1080000 milliseconds.');
  }
  if (typeof now !== 'function') throw new TypeError('Sonar timing function is required.');
}

function remainingTime(deadline, now, operation) {
  const remaining = Math.floor(deadline - now());
  if (remaining <= 0) throw unavailableError(`${operation} exceeded its deadline.`);
  return remaining;
}

export async function fetchCurrentSonarIssues({
  fetcher = globalThis.fetch,
  hostUrl,
  projectKey,
  token,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = monotonicNow,
}) {
  if (typeof fetcher !== 'function') throw new Error('A Fetch implementation is required.');
  if (projectKey !== EXPECTED_PROJECT_KEY) {
    throw new Error('sonar.projectKey does not match the reviewed Sonar issue manifest.');
  }
  if (!nonEmptyString(token)) throw new Error('SONAR_TOKEN is required.');
  try {
    return await paginateSonarIssues({
      fetcher,
      baseUrl: hostUrl,
      token,
      searchParams: {
        branch: EXPECTED_BRANCH,
        componentKeys: projectKey,
        issueStatuses: SEARCHED_STATUSES.join(','),
      },
      pageSize: PAGE_SIZE,
      maxIssues: MAX_ISSUES,
      requestTimeoutMs,
      timeoutMs,
      now,
      validateIssue,
    });
  } catch (error) {
    if (error instanceof SonarHttpError) throw classifyHttpFailure('Sonar API', error.status);
    if (error instanceof SonarTransportError) {
      throw unavailableError(error.message, { cause: error });
    }
    throw error;
  }
}

function assertIssueMetadata(issue, expected) {
  if (issue.rule !== expected.rule) {
    throw new Error(`Reviewed Sonar issue ${issue.key} no longer matches its expected rule.`);
  }
  if (issue.component !== expected.component) {
    throw new Error(`Reviewed Sonar issue ${issue.key} no longer matches its expected component.`);
  }
}

function reviewComment(expected) {
  const comment = expected.comment ?? REVIEW_COMMENT_BY_RULE[expected.rule];
  if (!comment) {
    throw new Error(`Reviewed Sonar issue ${expected.key} has no audit rationale.`);
  }
  return comment;
}

function unexpectedIssueMessage(issues) {
  const keys = issues
    .map((issue) => issue.key)
    .sort((left, right) => left.localeCompare(right, 'en'));
  const visible = keys.slice(0, 20).join(', ');
  const remainder = keys.length > 20 ? ` and ${keys.length - 20} more` : '';
  return `Sonar returned unreviewed open or confirmed issues: ${visible}${remainder}.`;
}

function collectUnreviewedIssue(issue, state) {
  if (OPEN_STATUSES.has(issue.status)) state.unexpectedOpen.push(issue);
  else state.ignoredReviewed.push(issue.key);
}

function collectExpectedIssue(issue, expected, state) {
  if (state.observedReviewedKeys.has(issue.key)) {
    throw new Error(`Sonar returned duplicate issue key ${issue.key}.`);
  }
  state.observedReviewedKeys.add(issue.key);
  assertIssueMetadata(issue, expected);
  if (OPEN_STATUSES.has(issue.status)) {
    state.transitions.push({
      key: issue.key,
      transition: expected.transition,
      comment: reviewComment(expected),
    });
    return;
  }

  const expectedStatus = REVIEWED_STATUS_BY_TRANSITION[expected.transition];
  if (issue.status !== expectedStatus) {
    throw new Error(`Reviewed Sonar issue ${issue.key} has an unexpected reviewed status.`);
  }
  state.alreadyReviewed.push(issue.key);
}

function collectObservedIssue(issueValue, expectedByKey, state) {
  const issue = validateIssue(issueValue);
  const expected = expectedByKey.get(issue.key);
  if (expected) collectExpectedIssue(issue, expected, state);
  else collectUnreviewedIssue(issue, state);
}

function sortByIssueKey(values) {
  values.sort((left, right) => {
    const leftKey = typeof left === 'string' ? left : left.key;
    const rightKey = typeof right === 'string' ? right : right.key;
    return leftKey.localeCompare(rightKey, 'en');
  });
}

export function planReviewedIssueReconciliation(issues, reviewedIssues = REVIEWED_ISSUES) {
  validateReviewedIssueManifest(reviewedIssues);
  if (!Array.isArray(issues)) throw new Error('Sonar issues must be an array.');
  const expectedByKey = new Map(reviewedIssues.map((issue) => [issue.key, issue]));
  const state = {
    observedReviewedKeys: new Set(),
    transitions: [],
    alreadyReviewed: [],
    ignoredReviewed: [],
    unexpectedOpen: [],
  };

  for (const issueValue of issues) {
    collectObservedIssue(issueValue, expectedByKey, state);
  }

  if (state.unexpectedOpen.length > 0) {
    throw findingError(unexpectedIssueMessage(state.unexpectedOpen));
  }

  const fixedOrMissing = reviewedIssues
    .filter((issue) => !state.observedReviewedKeys.has(issue.key))
    .map((issue) => issue.key);
  for (const values of [
    state.transitions,
    state.alreadyReviewed,
    fixedOrMissing,
    state.ignoredReviewed,
  ]) {
    sortByIssueKey(values);
  }
  return {
    transitions: state.transitions,
    alreadyReviewed: state.alreadyReviewed,
    fixedOrMissing,
    ignoredReviewed: state.ignoredReviewed,
  };
}

async function applyTransition(fetcher, base, token, item, requestTimeoutMs) {
  const url = new URL('api/issues/do_transition', base);
  const body = new URLSearchParams({
    comment: item.comment,
    issue: item.key,
    transition: item.transition,
  });
  let response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    throw unavailableError(`Sonar transition failed for reviewed issue ${item.key}.`, {
      cause: error,
    });
  }
  if (!response?.ok) {
    throw classifyHttpFailure(`Sonar transition for reviewed issue ${item.key}`, response?.status);
  }
}

export async function reconcileReviewedSonarIssues({
  fetcher = globalThis.fetch,
  hostUrl,
  projectKey,
  token,
  reviewedIssues = REVIEWED_ISSUES,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = monotonicNow,
}) {
  validateRequestTimeout(requestTimeoutMs);
  validateTiming(timeoutMs, now);
  const base = normalizeSonarApiBase(hostUrl);
  const deadline = now() + timeoutMs;
  const searchTimeoutMs = remainingTime(deadline, now, 'Sonar reviewed-issue reconciliation');
  const issues = await fetchCurrentSonarIssues({
    fetcher,
    hostUrl: base,
    projectKey,
    token,
    requestTimeoutMs,
    timeoutMs: searchTimeoutMs,
    now,
  });
  const plan = planReviewedIssueReconciliation(issues, reviewedIssues);
  const transitioned = [];
  for (const item of plan.transitions) {
    const remaining = remainingTime(deadline, now, 'Sonar reviewed-issue reconciliation');
    await applyTransition(fetcher, base, token, item, Math.min(requestTimeoutMs, remaining));
    transitioned.push(item.key);
  }
  return {
    ...plan,
    transitioned,
  };
}

export function formatReconciliationSummary(result) {
  const lines = [
    `Sonar reviewed issue reconciliation for branch main: transitioned=${result.transitioned.length} already_reviewed=${result.alreadyReviewed.length} fixed_or_missing=${result.fixedOrMissing.length}`,
  ];
  if (result.transitioned.length > 0) {
    lines.push(`Transitioned: ${result.transitioned.join(', ')}`);
  }
  if (result.alreadyReviewed.length > 0) {
    lines.push(`Already reviewed: ${result.alreadyReviewed.join(', ')}`);
  }
  if (result.fixedOrMissing.length > 0) {
    lines.push(`Fixed or missing: ${result.fixedOrMissing.join(', ')}`);
  }
  return lines.join('\n');
}

export async function runSonarReviewedIssues({
  argv = process.argv.slice(2),
  env = process.env,
  fetcher = globalThis.fetch,
  readProperties = () =>
    readFileSync(new URL('../sonar-project.properties', import.meta.url), 'utf8'),
  write = (line) => process.stdout.write(`${line}\n`),
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = monotonicNow,
} = {}) {
  const token = env.SONAR_TOKEN;
  if (!nonEmptyString(token)) throw new Error('SONAR_TOKEN is required.');
  parseReviewedArgs(argv);
  const projectKey = parseProjectKey(readProperties());
  const result = await reconcileReviewedSonarIssues({
    fetcher,
    hostUrl: env.SONAR_HOST_URL || 'https://sonarcloud.io',
    projectKey,
    token,
    requestTimeoutMs,
    timeoutMs,
    now,
  });
  write(formatReconciliationSummary(result));
  return result;
}

export function safeMessage(error, token) {
  const message =
    error instanceof Error ? error.message : 'Unknown Sonar reviewed-issue reconciliation failure.';
  return nonEmptyString(token) ? message.replaceAll(token, '[REDACTED]') : message;
}

async function main() {
  try {
    await runSonarReviewedIssues();
  } catch (error) {
    process.stderr.write(
      `Sonar reviewed-issue reconciliation failed: ${safeMessage(error, process.env.SONAR_TOKEN)}\n`,
    );
    process.exitCode = 1;
  }
}

validateReviewedIssueManifest();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
