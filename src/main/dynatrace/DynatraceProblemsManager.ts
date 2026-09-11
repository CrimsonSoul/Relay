import type PocketBase from 'pocketbase';
import {
  DYNATRACE_PROBLEM_HISTORY_RETENTION_DAYS,
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  DYNATRACE_PROBLEMS_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_KEY,
  MAX_DYNATRACE_ALERTING_PROFILES,
  MAX_DYNATRACE_ALERTING_PROFILE_LENGTH,
  getDynatraceCustomDqlMatcherError,
  getDynatraceWorkflowIdError,
  normalizeDynatraceCustomDqlMatcher,
  type DynatraceProblemRecord,
  type DynatraceProblemScopeInput,
  type DynatraceProblemsPublicSettings,
  type DynatraceProblemsSettingsInput,
  type DynatraceProblemsTestResult,
  normalizeDynatraceEnvironmentUrl,
} from '@shared/dynatraceProblems';
import { getErrorMessage } from '@shared/types';
import { loggers } from '../logger';
import {
  DynatraceProblemsClient,
  getDynatraceRetryAfterMs,
  type DynatraceProblemsQueryScope,
  type DynatraceProblemsFetchResult,
  type DynatraceNotificationTitle,
  type DynatraceNotificationTitlesResult,
  type DynatraceNotificationReadContext,
} from './DynatraceProblemsClient';
import {
  DynatraceProblemsConfigStore,
  type DynatraceProblemsConfig,
} from './DynatraceProblemsConfigStore';

const POLL_INTERVAL_MS = 15_000;
const NOTIFICATION_NAME_WAIT_MS = 10_000;
const NOTIFICATION_POLL_INTERVAL_MS = 60_000;
const RECONCILIATION_INTERVAL_MS = 24 * 60 * 60_000;
const PROFILE_CATALOG_REFRESH_MS = 24 * 60 * 60_000;
const MIN_INCREMENTAL_LOOKBACK_MS = 120 * 60_000;
const INCREMENTAL_OVERLAP_MS = 5 * 60_000;
const EXISTING_LOOKUP_BATCH_SIZE = 100;
const UPSERT_CONCURRENCY = 6;
const HISTORY_RETENTION_MS = DYNATRACE_PROBLEM_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1_000;

type IncomingProblem = Omit<DynatraceProblemRecord, 'id' | 'created' | 'updated'>;
type ExistingProblem = DynatraceProblemRecord;
type ExpiredProblem = Pick<
  DynatraceProblemRecord,
  'id' | 'problemId' | 'status' | 'endTime' | 'scopeExcluded' | 'scopeExcludedAt'
>;
type FilterableProblem = Pick<
  DynatraceProblemRecord,
  'id' | 'problemId' | 'alertingProfiles' | 'scopeExcluded' | 'scopeExcludedAt' | 'environmentUrl'
>;
type RelatedRecord = { id: string; problemId: string };
type SyncRecord = {
  id: string;
  key: string;
  state?: 'disabled' | 'syncing' | 'ok' | 'error';
  lastSuccessAt?: string;
  lastReconciledAt?: string;
  availableAlertingProfiles?: string[];
  profileFieldHealthy?: boolean;
  profileCatalogCount?: number;
  matchedProfileCount?: number;
  consecutiveFailures?: number;
  nextRetryAt?: string;
  staleSince?: string;
  resultTruncated?: boolean;
  reconciliationPending?: boolean;
};
type UpsertStats = { created: number; updated: number; unchanged: number };
type ProfileScopeState = {
  catalog: string[];
  selectedProfiles: string[] | null;
  selectedProfileSet: Set<string> | null;
  profileFieldHealthy: boolean;
  profileCatalogCount: number;
  matchedProfileCount: number;
  validationError: string | null;
};
type ProblemScopeSource = 'unfiltered' | 'alerting-profile' | 'custom-dql' | 'combined';
type ProblemScopeReconciliation =
  | { mode: 'all' }
  | { mode: 'profiles'; selectedProfiles: Set<string> }
  | { mode: 'matched-ids'; matchedProblemIds: Set<string> };

/**
 * Local stand-in for `Map.groupBy`, which is ES2024 and therefore outside the `lib`
 * this project compiles against even though the Electron runtime supports it.
 */
function groupByProblemId<T extends RelatedRecord>(records: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const record of records) {
    const bucket = grouped.get(record.problemId);
    if (bucket) bucket.push(record);
    else grouped.set(record.problemId, [record]);
  }
  return grouped;
}

const PROBLEM_COMPARISON_FIELDS = [
  'id',
  'problemId',
  'displayId',
  'title',
  'status',
  'severity',
  'impactLevel',
  'startTime',
  'endTime',
  'rootCauseName',
  'affectedEntities',
  'impactedEntities',
  'managementZones',
  'alertingProfiles',
  'workflowTitle',
  'workflowDescription',
  'workflowTags',
  'workflowAffectedEntityTypes',
  'scopeExcluded',
  'scopeExcludedAt',
  'environmentUrl',
].join(',');

function escapeFilter(value: string): string {
  return value.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`);
}

function parsedTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function previousProfileHealth(sync: SyncRecord | null) {
  return {
    profileFieldHealthy: sync?.profileFieldHealthy ?? true,
    profileCatalogCount: sync?.profileCatalogCount ?? 0,
    matchedProfileCount: sync?.matchedProfileCount ?? 0,
  };
}

function shouldReconcile(sync: SyncRecord | null, now: number, forced: boolean): boolean {
  if (forced) return true;
  const lastReconciledAt = parsedTimestamp(sync?.lastReconciledAt);
  const lastSuccessAt = parsedTimestamp(sync?.lastSuccessAt);
  return (
    lastReconciledAt === null ||
    lastSuccessAt === null ||
    now - lastReconciledAt >= RECONCILIATION_INTERVAL_MS
  );
}

function incrementalLookbackMinutes(sync: SyncRecord | null, now: number): number {
  const lastSuccessAt = parsedTimestamp(sync?.lastSuccessAt) ?? now - MIN_INCREMENTAL_LOOKBACK_MS;
  const elapsed = Math.max(0, now - lastSuccessAt) + INCREMENTAL_OVERLAP_MS;
  const bounded = Math.min(
    RECONCILIATION_INTERVAL_MS,
    Math.max(MIN_INCREMENTAL_LOOKBACK_MS, elapsed),
  );
  return Math.ceil(bounded / 60_000);
}

function scopeSource(config: DynatraceProblemsConfig): ProblemScopeSource {
  const profilesConfigured = Boolean(config.alertingProfiles?.length);
  const matcherConfigured = Boolean(config.customDqlMatcher);
  if (matcherConfigured) return 'custom-dql';
  if (profilesConfigured) return 'alerting-profile';
  return 'unfiltered';
}

function normalizeProblemScopeInput(input: DynatraceProblemScopeInput): DynatraceProblemScopeInput {
  const alertingProfiles = [
    ...new Set(input.alertingProfiles.map((profile) => profile.trim()).filter(Boolean)),
  ];
  if (
    alertingProfiles.length > MAX_DYNATRACE_ALERTING_PROFILES ||
    alertingProfiles.some((profile) => profile.length > MAX_DYNATRACE_ALERTING_PROFILE_LENGTH)
  ) {
    throw new Error('Select only valid Dynatrace alerting profiles.');
  }
  const matcherError = getDynatraceCustomDqlMatcherError(input.customDqlMatcher);
  if (matcherError) throw new Error(matcherError);
  const customDqlMatcher = normalizeDynatraceCustomDqlMatcher(input.customDqlMatcher);
  const workflowId = input.workflowId?.trim();
  if (workflowId !== undefined) {
    const workflowError = getDynatraceWorkflowIdError(workflowId);
    if (workflowError) throw new Error(workflowError);
  }
  return {
    alertingProfiles: customDqlMatcher ? [] : alertingProfiles,
    customDqlMatcher,
    ...(workflowId !== undefined ? { workflowId } : {}),
  };
}

function applyAlertingProfileScope(
  problems: IncomingProblem[],
  selectedProfiles: Set<string> | null,
): IncomingProblem[] {
  if (!selectedProfiles) return problems;
  return problems.filter((problem) =>
    problem.alertingProfiles.some((profile) => selectedProfiles.has(profile)),
  );
}

function createFullProblemScopeReconciliation(
  config: DynatraceProblemsConfig,
  selectedProfiles: Set<string> | null,
  problems: IncomingProblem[],
): ProblemScopeReconciliation {
  if (config.customDqlMatcher) {
    return {
      mode: 'matched-ids',
      matchedProblemIds: new Set(problems.map((problem) => problem.problemId)),
    };
  }
  if (selectedProfiles) return { mode: 'profiles', selectedProfiles };
  return { mode: 'all' };
}

function problemFingerprint(problem: IncomingProblem | ExistingProblem): string {
  const entities = (values: DynatraceProblemRecord['affectedEntities']) =>
    [...(values ?? [])].sort((a, b) =>
      `${a.id}\u0000${a.type}\u0000${a.name}`.localeCompare(
        `${b.id}\u0000${b.type}\u0000${b.name}`,
      ),
    );
  const zones = [...(problem.managementZones ?? [])].sort((a, b) =>
    `${a.id}\u0000${a.name}`.localeCompare(`${b.id}\u0000${b.name}`),
  );
  return JSON.stringify({
    problemId: problem.problemId,
    displayId: problem.displayId,
    title: problem.title,
    status: problem.status,
    severity: problem.severity,
    impactLevel: problem.impactLevel,
    startTime: problem.startTime,
    endTime: problem.endTime,
    rootCauseName: problem.rootCauseName,
    affectedEntities: entities(problem.affectedEntities),
    impactedEntities: entities(problem.impactedEntities),
    managementZones: zones,
    alertingProfiles: [...(problem.alertingProfiles ?? [])].sort((a, b) => a.localeCompare(b)),
    workflowTitle: problem.workflowTitle ?? '',
    workflowDescription: problem.workflowDescription ?? '',
    workflowTags: [...(problem.workflowTags ?? [])].sort((a, b) => a.localeCompare(b)),
    workflowAffectedEntityTypes: [...(problem.workflowAffectedEntityTypes ?? [])].sort((a, b) =>
      a.localeCompare(b),
    ),
    scopeExcluded: problem.scopeExcluded === true,
    scopeExcludedAt: problem.scopeExcludedAt ?? '',
    environmentUrl: problem.environmentUrl,
  });
}

function problemOutsideScope(
  problem: FilterableProblem,
  scope: ProblemScopeReconciliation,
  environmentUrl: string,
): boolean {
  if (problem.environmentUrl && problem.environmentUrl !== environmentUrl) return true;
  if (scope.mode === 'profiles')
    return !problem.alertingProfiles?.some((profile) => scope.selectedProfiles.has(profile));
  if (scope.mode === 'matched-ids') return !scope.matchedProblemIds.has(problem.problemId);
  return false;
}

function problemQueryScope(options: {
  reconciliation: boolean;
  previousSync: SyncRecord | null;
  now: number;
}): DynatraceProblemsQueryScope {
  return options.reconciliation
    ? { mode: 'reconcile' }
    : {
        mode: 'incremental',
        lookbackMinutes: incrementalLookbackMinutes(options.previousSync, options.now),
      };
}

function assertSyncCurrent(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new Error('Dynatrace configuration changed during synchronization.');
}

function warnIncompleteWorkflowMetadata(
  config: DynatraceProblemsConfig,
  complete: boolean | undefined,
): void {
  if (config.customDqlMatcher && complete === false) {
    loggers.main.warn(
      'Dynatrace workflow metadata was incomplete; canonical problem state was synchronized while stored enrichment was preserved',
    );
  }
}

async function awaitWrites(writes: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(writes);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}

export class DynatraceProblemsManager {
  private configurationGeneration = 0;
  private pausedForRestore = false;
  private notificationReconciliationPending = true;
  private readonly settingsWrites = new Set<Promise<void>>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private syncInFlight: Promise<number> | null = null;
  private reconciliationRequested = false;
  private availableAlertingProfiles: string[] = [];
  private profileCatalogRefreshedAt = 0;
  private scheduledRetryAt = 0;
  private liveSyncInFlight: Promise<number> | null = null;
  private notificationSyncInFlight: Promise<void> | null = null;
  private notificationReadAt = 0;
  private nextHistoryAttemptAt = 0;
  private liveEnabled = false;
  private initialHistoryCheck: Promise<void> | null = null;
  private writesTail: Promise<void> = Promise.resolve();
  private readonly liveProblems = new Map<string, IncomingProblem>();
  private readonly liveMatchedIds = new Set<string>();

  constructor(
    private readonly store: DynatraceProblemsConfigStore,
    private readonly getPocketBase: () => PocketBase | null,
    private readonly client = new DynatraceProblemsClient(),
    private readonly canPruneHistory: () => boolean = () => true,
  ) {}

  getSettings(): DynatraceProblemsPublicSettings {
    return this.store.getPublicSettings();
  }

  getAdministrativeScope(): DynatraceProblemScopeInput {
    return this.store.getAdministrativeScope();
  }

  getAvailableAlertingProfileCatalog(): string[] {
    const selectedProfiles = [...(this.store.load()?.alertingProfiles ?? [])].sort((a, b) =>
      a.localeCompare(b),
    );
    const selectedProfileSet = new Set(selectedProfiles);
    const discoveredProfiles = this.availableAlertingProfiles
      .filter((profile) => !selectedProfileSet.has(profile))
      .sort((a, b) => a.localeCompare(b));
    return [...selectedProfiles, ...discoveredProfiles].slice(0, MAX_DYNATRACE_ALERTING_PROFILES);
  }

  saveSettings(input: DynatraceProblemsSettingsInput): DynatraceProblemsPublicSettings {
    this.store.save(input);
    this.configurationGeneration += 1;
    this.resetLiveScope();
    this.start(true);
    return this.getSettings();
  }

  async saveAlertingProfiles(alertingProfiles: string[]): Promise<number> {
    return this.saveProblemScope({
      alertingProfiles,
      customDqlMatcher: '',
    });
  }

  async testProblemScope(input: DynatraceProblemScopeInput): Promise<number> {
    const existing = this.store.load();
    if (!existing) throw new Error('Configure Dynatrace Problems before testing problem scope.');
    const normalized = normalizeProblemScopeInput(input);
    if (normalized.customDqlMatcher && !(normalized.workflowId ?? existing.workflowId)) {
      throw new Error(
        'Enter the NOC workflow ID to enable live DQL filtering without waiting for Grail.',
      );
    }
    return this.client.countMatchingProblems({
      ...existing,
      alertingProfiles: normalized.alertingProfiles.length ? normalized.alertingProfiles : null,
      customDqlMatcher: normalized.customDqlMatcher || null,
      ...(normalized.workflowId !== undefined ? { workflowId: normalized.workflowId } : {}),
    });
  }

  async saveProblemScope(input: DynatraceProblemScopeInput): Promise<number> {
    if (this.syncInFlight) await this.syncInFlight.catch(() => undefined);
    const normalized = normalizeProblemScopeInput(input);
    const problemCount = await this.testProblemScope(normalized);
    if (this.syncInFlight) await this.syncInFlight.catch(() => undefined);
    this.store.saveProblemScope(normalized);
    this.configurationGeneration += 1;
    this.resetLiveScope();
    if (this.liveEnabled)
      void this.syncLiveNow().catch((error) =>
        loggers.main.warn('Live problem scope refresh failed', { error }),
      );
    void this.syncNow(true).catch((error) => {
      loggers.main.warn('Saved Dynatrace problem scope; reconciliation will retry', { error });
    });
    return problemCount;
  }

  async testSettings(input: DynatraceProblemsSettingsInput): Promise<DynatraceProblemsTestResult> {
    const existing = this.store.load();
    const config: DynatraceProblemsConfig = {
      environmentUrl: normalizeDynatraceEnvironmentUrl(input.environmentUrl),
      apiToken: input.apiToken?.trim() || existing?.apiToken || '',
      alertingProfiles: existing?.alertingProfiles ?? null,
      customDqlMatcher: existing?.customDqlMatcher ?? null,
    };
    const problemCount = await this.client.testConnection(config);
    return { reachable: true, problemCount };
  }

  clearSettings(): boolean {
    if (this.pausedForRestore) return false;
    this.stop();
    const cleared = this.store.clear();
    if (cleared) {
      const generation = ++this.configurationGeneration;
      this.resetLiveScope();
      this.reconciliationRequested = false;
      this.availableAlertingProfiles = [];
      this.profileCatalogRefreshedAt = 0;
      const write = (async () => {
        await this.syncInFlight?.catch(() => undefined);
        await this.liveSyncInFlight?.catch(() => undefined);
        await this.notificationSyncInFlight?.catch(() => undefined);
        if (generation !== this.configurationGeneration) return;
        await this.writeSyncState('disabled', {
          error: '',
          availableAlertingProfiles: [],
          selectedAlertingProfiles: [],
          profileFilterConfigured: false,
          scopeSource: 'unfiltered',
          profileFieldHealthy: true,
          profileCatalogCount: 0,
          matchedProfileCount: 0,
          consecutiveFailures: 0,
          nextRetryAt: '',
          staleSince: '',
          resultTruncated: false,
          reconciliationPending: false,
        });
      })();
      this.settingsWrites.add(write);
      void write
        .finally(() => this.settingsWrites.delete(write))
        .catch((error) => loggers.main.warn('Failed to clear Dynatrace sync state', { error }));
    }
    return cleared;
  }

  start(forceReconciliation = false): void {
    this.pausedForRestore = false;
    this.stop();
    if (!this.store.load()) {
      void this.syncNow(forceReconciliation).catch((error) =>
        loggers.main.warn('Initial Dynatrace Problems sync failed', { error }),
      );
      return;
    }
    void this.syncLiveNow().catch((error) =>
      loggers.main.warn('Initial live Dynatrace Problems sync failed', { error }),
    );
    this.nextHistoryAttemptAt = Date.now() + RECONCILIATION_INTERVAL_MS;
    this.initialHistoryCheck = this.reconcileHistoryIfDue(forceReconciliation)
      .catch((error) =>
        loggers.main.warn('Initial Dynatrace history reconciliation failed', { error }),
      )
      .finally(() => {
        this.initialHistoryCheck = null;
      });
    this.pollTimer = setInterval(() => {
      if (Date.now() >= this.scheduledRetryAt) {
        void this.syncLiveNow().catch((error) =>
          loggers.main.warn('Scheduled live Dynatrace Problems sync failed', { error }),
        );
      }
      if (Date.now() >= this.nextHistoryAttemptAt) {
        this.nextHistoryAttemptAt = Date.now() + RECONCILIATION_INTERVAL_MS;
        void this.syncNow(true).catch((error) =>
          loggers.main.warn('Dynatrace history reconciliation failed', { error }),
        );
      }
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async stopForRestore(): Promise<void> {
    this.pausedForRestore = true;
    this.reconciliationRequested = false;
    this.stop();
    await this.initialHistoryCheck;
    await this.syncInFlight?.catch(() => undefined);
    await this.liveSyncInFlight?.catch(() => undefined);
    await this.notificationSyncInFlight?.catch(() => undefined);
    await this.writesTail;
    await Promise.allSettled(this.settingsWrites);
  }

  syncNow(forceReconciliation = false): Promise<number> {
    if (this.pausedForRestore)
      return Promise.reject(new Error('Dynatrace sync is paused for backup restore.'));
    if (this.liveEnabled && !forceReconciliation && !this.reconciliationRequested)
      return this.syncLiveNow();
    if (forceReconciliation) this.reconciliationRequested = true;
    if (this.syncInFlight) return this.syncInFlight;

    const reconcile = this.reconciliationRequested;
    this.reconciliationRequested = false;
    const writes = [...this.settingsWrites];
    this.syncInFlight = Promise.allSettled(writes)
      .then(() => this.performSync(reconcile))
      .finally(() => {
        this.syncInFlight = null;
        if (this.reconciliationRequested && !this.pausedForRestore) {
          void this.syncNow().catch((error) => {
            loggers.main.warn('Queued Dynatrace Problems reconciliation failed', { error });
          });
        }
      });
    return this.syncInFlight;
  }

  syncLiveNow(): Promise<number> {
    if (this.pausedForRestore)
      return Promise.reject(new Error('Dynatrace sync is paused for backup restore.'));
    if (this.liveSyncInFlight) return this.liveSyncInFlight;
    this.liveEnabled = true;
    this.liveSyncInFlight = Promise.allSettled(this.settingsWrites)
      .then(() => this.performSync(false, true))
      .finally(() => {
        this.liveSyncInFlight = null;
      });
    return this.liveSyncInFlight;
  }

  private async reconcileHistoryIfDue(force: boolean): Promise<void> {
    const generation = this.configurationGeneration;
    const pb = this.getPocketBase();
    if (!pb) return;
    const sync = await this.readSyncRecord(pb);
    if (this.pausedForRestore || generation !== this.configurationGeneration) return;
    if (shouldReconcile(sync, Date.now(), force || sync?.reconciliationPending === true)) {
      await this.syncNow(true);
    } else {
      this.nextHistoryAttemptAt =
        (parsedTimestamp(sync?.lastReconciledAt) ?? Date.now()) + RECONCILIATION_INTERVAL_MS;
    }
  }

  private resetLiveScope(): void {
    this.liveProblems.clear();
    this.liveMatchedIds.clear();
    this.notificationReadAt = 0;
    this.notificationReconciliationPending = true;
    this.scheduledRetryAt = 0;
  }

  private async serializeWrites<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.writesTail;
    let release!: () => void;
    this.writesTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  private async performSync(forceReconciliation: boolean, liveOnly = false): Promise<number> {
    const generation = this.configurationGeneration;
    const isCurrent = () => generation === this.configurationGeneration;
    const config = this.store.load();
    if (!config) {
      await this.writeSyncState('disabled', { error: '' });
      return 0;
    }

    const pb = this.getPocketBase();
    if (!pb) throw new Error('Relay server data store is not available.');

    const now = Date.now();
    const attemptedAt = new Date(now).toISOString();
    const previousSync = await this.readSyncRecord(pb);
    if (!isCurrent()) return 0;
    if (this.waitForRetry(previousSync, forceReconciliation)) return 0;
    const reconciliation =
      !liveOnly &&
      shouldReconcile(
        previousSync,
        now,
        forceReconciliation || previousSync?.reconciliationPending === true,
      );
    liveOnly = liveOnly || !reconciliation;
    const queryScope = problemQueryScope({ reconciliation, previousSync, now });
    if (!liveOnly && !this.liveEnabled)
      await this.serializeWrites(() =>
        this.writeSyncState('syncing', { lastAttemptAt: attemptedAt, error: '' }),
      );

    let { profileFieldHealthy, profileCatalogCount, matchedProfileCount } =
      previousProfileHealth(previousSync);

    try {
      const profileScope = await this.prepareProfileScope(
        config,
        previousSync,
        reconciliation,
        forceReconciliation,
        liveOnly,
      );
      assertSyncCurrent(isCurrent);
      const { catalog, selectedProfileSet } = profileScope;
      ({ profileFieldHealthy, profileCatalogCount, matchedProfileCount } = profileScope);
      if (profileScope.validationError) throw new Error(profileScope.validationError);
      const result = await this.fetchSyncProblems(pb, config, queryScope, liveOnly);
      assertSyncCurrent(isCurrent);
      if (reconciliation && config.customDqlMatcher && result.resultTruncated) {
        throw new Error(
          'Dynatrace returned a truncated custom-scope reconciliation. Existing Relay data was preserved.',
        );
      }
      return await this.serializeWrites(async () => {
        assertSyncCurrent(isCurrent);
        const scopedProblems = config.customDqlMatcher
          ? await this.applyCustomDqlScope(
              pb,
              result.problems,
              result.changedProblems,
              reconciliation,
              result.workflowMetadataComplete !== false,
            )
          : applyAlertingProfileScope(result.problems, selectedProfileSet);
        const problems = this.mergeLiveProblems(scopedProblems, result.problems, liveOnly);
        const observedProfiles = problems.flatMap((problem) => problem.alertingProfiles);
        this.availableAlertingProfiles = [...new Set([...catalog, ...observedProfiles])].sort(
          (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }),
        );

        assertSyncCurrent(isCurrent);
        const upsertStats = await this.upsertProblems(pb, problems, reconciliation, [], isCurrent);
        assertSyncCurrent(isCurrent);
        const { scopeExcludedCount, retentionPrunedCount } =
          await this.reconcileFetchedProblemScope(
            pb,
            config,
            reconciliation,
            selectedProfileSet,
            problems,
            isCurrent,
          );
        assertSyncCurrent(isCurrent);
        await this.writeSuccessfulSync(
          pb,
          config,
          result,
          profileScope,
          reconciliation,
          attemptedAt,
        );
        if (liveOnly) this.scheduledRetryAt = 0;
        if (reconciliation) this.nextHistoryAttemptAt = Date.now() + RECONCILIATION_INTERVAL_MS;
        this.startNotificationRead(pb, config, queryScope, isCurrent);
        warnIncompleteWorkflowMetadata(config, result.workflowMetadataComplete);
        loggers.main.info('Dynatrace Problems synchronized', {
          mode: queryScope.mode,
          fetchedCount: problems.length,
          ...upsertStats,
          scopeExcludedCount,
          retentionPrunedCount,
        });
        return problems.length;
      });
    } catch (error) {
      if (!isCurrent()) return 0;
      const message = getErrorMessage(error);
      this.scheduleRetry(error, liveOnly);
      await this.serializeWrites(async () => {
        if (!isCurrent()) return;
        if (!liveOnly && this.liveEnabled) {
          const current = await this.readSyncRecord(pb);
          await this.writeSyncState(current?.state ?? 'syncing', { reconciliationPending: true });
          return;
        }
        await this.writeSyncState('error', {
          lastAttemptAt: attemptedAt,
          error: message,
          scopeSource: scopeSource(config),
          profileFieldHealthy,
          profileCatalogCount,
          matchedProfileCount,
          consecutiveFailures: (previousSync?.consecutiveFailures ?? 0) + 1,
          nextRetryAt: new Date(this.scheduledRetryAt).toISOString(),
          staleSince: previousSync?.staleSince || attemptedAt,
          reconciliationPending: reconciliation || previousSync?.reconciliationPending === true,
        });
      });
      throw error;
    }
  }

  private scheduleRetry(error: unknown, liveOnly: boolean): void {
    const retryDelay = Math.max(POLL_INTERVAL_MS, getDynatraceRetryAfterMs(error) ?? 0);
    if (liveOnly || !this.liveEnabled) this.scheduledRetryAt = Date.now() + retryDelay;
    else this.nextHistoryAttemptAt = Date.now() + Math.max(5 * 60_000, retryDelay);
  }

  private waitForRetry(previousSync: SyncRecord | null, forceReconciliation: boolean): boolean {
    const persistedRetryAt = parsedTimestamp(previousSync?.nextRetryAt);
    if (!forceReconciliation && persistedRetryAt !== null && persistedRetryAt > Date.now()) {
      this.scheduledRetryAt = persistedRetryAt;
      return true;
    }
    return false;
  }

  private async fetchSyncProblems(
    pb: PocketBase,
    config: DynatraceProblemsConfig,
    queryScope: DynatraceProblemsQueryScope,
    liveOnly: boolean,
  ): Promise<DynatraceProblemsFetchResult> {
    const tracked = liveOnly
      ? await pb
          .collection(DYNATRACE_PROBLEMS_COLLECTION)
          .getFullList<Pick<ExistingProblem, 'problemId'>>({
            filter: `status="OPEN" && scopeExcluded!=true && environmentUrl="${escapeFilter(config.environmentUrl)}"`,
            fields: 'problemId',
            requestKey: null,
          })
      : [];
    return liveOnly
      ? await this.client.fetchLiveProblems(
          config,
          queryScope,
          tracked.map(({ problemId }) => problemId),
        )
      : await this.client.fetchProblems(config, queryScope);
  }

  private mergeLiveProblems(
    scopedProblems: IncomingProblem[],
    matchedProblems: IncomingProblem[],
    liveOnly: boolean,
  ): IncomingProblem[] {
    const problemsById = new Map(scopedProblems.map((problem) => [problem.problemId, problem]));
    if (liveOnly) {
      for (const problem of scopedProblems) this.liveProblems.set(problem.problemId, problem);
      for (const problem of matchedProblems) this.liveMatchedIds.add(problem.problemId);
      this.pruneLiveProblems();
    } else {
      // A delayed historical response cannot overwrite fresher API state or revoke a
      // match observed directly from a workflow before its event was stored in Grail.
      for (const [id, live] of this.liveProblems) {
        if (problemsById.has(id) || this.liveMatchedIds.has(id)) problemsById.set(id, live);
      }
    }
    return [...problemsById.values()].map((problem) => ({
      ...problem,
      scopeExcluded: false,
      scopeExcludedAt: '',
    }));
  }

  private pruneLiveProblems(): void {
    for (const [id, problem] of this.liveProblems) {
      if (
        problem.status === 'CLOSED' &&
        problem.endTime < Date.now() - MIN_INCREMENTAL_LOOKBACK_MS
      ) {
        this.liveProblems.delete(id);
        this.liveMatchedIds.delete(id);
      }
    }
  }

  private async writeSuccessfulSync(
    pb: PocketBase,
    config: DynatraceProblemsConfig,
    result: DynatraceProblemsFetchResult,
    profileScope: ProfileScopeState,
    reconciliation: boolean,
    attemptedAt: string,
  ): Promise<void> {
    const successAt = new Date().toISOString();
    const currentSync = await this.readSyncRecord(pb);
    if (reconciliation && this.liveEnabled) {
      await this.writeSyncState(currentSync?.state ?? 'syncing', {
        lastReconciledAt: successAt,
        availableAlertingProfiles: this.availableAlertingProfiles,
        resultTruncated: result.resultTruncated === true,
        reconciliationPending: false,
      });
    } else {
      await this.writeSyncState(result.scopeError ? 'error' : 'ok', {
        lastAttemptAt: attemptedAt,
        lastSuccessAt: successAt,
        ...(reconciliation ? { lastReconciledAt: successAt } : {}),
        error: result.scopeError ?? '',
        availableAlertingProfiles: this.availableAlertingProfiles,
        selectedAlertingProfiles: profileScope.selectedProfiles ?? [],
        profileFilterConfigured: profileScope.selectedProfiles !== null,
        scopeSource: scopeSource(config),
        profileFieldHealthy: profileScope.profileFieldHealthy,
        profileCatalogCount: profileScope.profileCatalogCount,
        matchedProfileCount: profileScope.matchedProfileCount,
        consecutiveFailures: 0,
        nextRetryAt: '',
        staleSince: '',
        resultTruncated:
          result.resultTruncated === true ||
          (!reconciliation && currentSync?.resultTruncated === true),
        reconciliationPending: reconciliation
          ? false
          : (currentSync?.reconciliationPending ?? false),
      });
    }
  }

  private startNotificationRead(
    pb: PocketBase,
    config: DynatraceProblemsConfig,
    scope: DynatraceProblemsQueryScope,
    isCurrent: () => boolean,
  ): void {
    if (
      this.notificationSyncInFlight ||
      Date.now() - this.notificationReadAt < NOTIFICATION_POLL_INTERVAL_MS
    )
      return;
    this.notificationReadAt = Date.now();
    this.notificationSyncInFlight = this.readNotificationTitles(config, scope)
      .then(async (titles) => {
        if (!titles || !isCurrent()) return;
        await this.serializeWrites(async () => {
          if (!isCurrent()) return;
          await this.syncNotificationTitles(pb, titles.titles, config.environmentUrl, isCurrent);
          this.notificationReconciliationPending = !titles.complete;
        });
      })
      .catch((error) =>
        loggers.main.warn('Dynatrace background email names unavailable', { error }),
      )
      .finally(() => {
        this.notificationSyncInFlight = null;
      });
  }

  private async readNotificationTitles(
    config: DynatraceProblemsConfig,
    scope: DynatraceProblemsQueryScope,
  ): Promise<DynatraceNotificationTitlesResult | null> {
    const titleScope = this.notificationReconciliationPending
      ? { mode: 'reconcile' as const }
      : scope;
    this.notificationReconciliationPending = true;
    const controller = new AbortController();
    const collected = new Map<string, DynatraceNotificationTitle>();
    const context: DynatraceNotificationReadContext = {
      signal: controller.signal,
      remainingExecutions: 25,
      onTitles: (titles) => {
        if (!controller.signal.aborted) collectNotificationTitles(collected, titles);
      },
    };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<DynatraceNotificationTitlesResult>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve({ titles: [...collected.values()], complete: false });
      }, NOTIFICATION_NAME_WAIT_MS);
    });
    try {
      return await Promise.race([
        this.client.fetchNotificationTitles(config, titleScope, context),
        deadline,
      ]);
    } catch {
      // No permission, old workflow, or an incomplete read must never stop lifecycle polling.
      // Retry a full title reconciliation, including alerts outside the incremental lookback.
      loggers.main.warn(
        'Workflow email names unavailable; existing names retained. Check business-event and workflow execution read access.',
      );
      return collected.size ? { titles: [...collected.values()], complete: false } : null;
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  private async syncNotificationTitles(
    pb: PocketBase,
    titles: DynatraceNotificationTitle[],
    environmentUrl: string,
    isCurrent: () => boolean,
  ): Promise<void> {
    const collection = pb.collection(DYNATRACE_PROBLEMS_COLLECTION);
    for (let offset = 0; offset < titles.length; offset += EXISTING_LOOKUP_BATCH_SIZE) {
      const batch = titles.slice(offset, offset + EXISTING_LOOKUP_BATCH_SIZE);
      const existing = await collection.getFullList<DynatraceProblemRecord>({
        filter: batch.map(({ problemId }) => `problemId="${escapeFilter(problemId)}"`).join(' || '),
        fields: 'id,problemId,scopeExcluded,notificationUpdatedAt,environmentUrl',
        requestKey: null,
      });
      const byId = new Map(existing.map((problem) => [problem.problemId, problem]));
      for (const title of batch) {
        if (!isCurrent()) return;
        const problem = byId.get(title.problemId);
        if (
          !problem ||
          (problem.environmentUrl && problem.environmentUrl !== environmentUrl) ||
          problem.scopeExcluded ||
          title.notificationUpdatedAt <= (problem.notificationUpdatedAt ?? 0)
        )
          continue;
        await collection.update(
          problem.id,
          {
            notificationTitle: title.notificationTitle,
            notificationStatus: title.notificationStatus,
            notificationUpdatedAt: title.notificationUpdatedAt,
          },
          { requestKey: null },
        );
      }
    }
  }

  private async reconcileFetchedProblemScope(
    pb: PocketBase,
    config: DynatraceProblemsConfig,
    reconciliation: boolean,
    selectedProfiles: Set<string> | null,
    problems: IncomingProblem[],
    isCurrent: () => boolean,
  ): Promise<{ scopeExcludedCount: number; retentionPrunedCount: number }> {
    if (reconciliation) {
      const scope = createFullProblemScopeReconciliation(config, selectedProfiles, problems);
      const scopeExcludedCount = await this.reconcileProblemScope(
        pb,
        scope,
        config.environmentUrl,
        isCurrent,
      );
      const retentionPrunedCount = isCurrent() ? await this.pruneExpiredHistory(pb, isCurrent) : 0;
      return { scopeExcludedCount, retentionPrunedCount };
    }
    return { scopeExcludedCount: 0, retentionPrunedCount: 0 };
  }

  private async applyCustomDqlScope(
    pb: PocketBase,
    matchedProblems: IncomingProblem[],
    changedProblems: IncomingProblem[] | null | undefined,
    reconciliation: boolean,
    workflowMetadataComplete: boolean,
  ): Promise<IncomingProblem[]> {
    if ((reconciliation || !changedProblems) && workflowMetadataComplete) return matchedProblems;

    const observedProblems = [
      ...new Map(
        [...matchedProblems, ...(changedProblems ?? [])].map((problem) => [
          problem.problemId,
          problem,
        ]),
      ).values(),
    ];
    const existing = await this.loadExistingProblems(pb, observedProblems, false);
    const observedEnvironment = observedProblems[0]?.environmentUrl;
    const sameEnvironment = existing.filter(
      (problem) => !problem.environmentUrl || problem.environmentUrl === observedEnvironment,
    );
    const existingByProblemId = new Map(
      sameEnvironment.map((problem) => [problem.problemId, problem]),
    );
    const qualifiedProblemIds = new Set(matchedProblems.map((problem) => problem.problemId));
    for (const problem of sameEnvironment) {
      if (problem.scopeExcluded !== true) qualifiedProblemIds.add(problem.problemId);
    }

    const selected = new Map(
      matchedProblems.map((problem) => {
        const workflowSource = workflowMetadataComplete
          ? problem
          : existingByProblemId.get(problem.problemId);
        return [
          problem.problemId,
          {
            ...problem,
            workflowTitle: workflowSource?.workflowTitle ?? '',
            workflowDescription: workflowSource?.workflowDescription ?? '',
            workflowTags: workflowSource?.workflowTags ?? [],
            workflowAffectedEntityTypes: workflowSource?.workflowAffectedEntityTypes ?? [],
          },
        ] as const;
      }),
    );
    for (const problem of changedProblems ?? []) {
      if (!qualifiedProblemIds.has(problem.problemId)) continue;
      const workflowSource =
        selected.get(problem.problemId) ?? existingByProblemId.get(problem.problemId);
      selected.set(problem.problemId, {
        ...problem,
        workflowTitle: workflowSource?.workflowTitle ?? '',
        workflowDescription: workflowSource?.workflowDescription ?? '',
        workflowTags: workflowSource?.workflowTags ?? [],
        workflowAffectedEntityTypes: workflowSource?.workflowAffectedEntityTypes ?? [],
      });
    }
    return [...selected.values()];
  }

  private async prepareProfileScope(
    config: DynatraceProblemsConfig,
    previousSync: SyncRecord | null,
    reconciliation: boolean,
    forceReconciliation: boolean,
    liveOnly = false,
  ): Promise<ProfileScopeState> {
    if (this.profileCatalogRefreshedAt === 0) {
      this.availableAlertingProfiles = previousSync?.availableAlertingProfiles ?? [];
      this.profileCatalogRefreshedAt = parsedTimestamp(previousSync?.lastReconciledAt) ?? 0;
    }
    const selectedProfiles = config.alertingProfiles;
    const catalog = liveOnly
      ? this.availableAlertingProfiles
      : await this.getAvailableAlertingProfiles(
          config,
          forceReconciliation,
          reconciliation && selectedProfiles !== null,
        );
    let profileFieldHealthy = previousSync?.profileFieldHealthy ?? true;
    if (reconciliation && selectedProfiles) {
      profileFieldHealthy = (await this.client.inspectAlertingProfileField(config)).healthy;
    }
    const catalogSet = new Set(catalog);
    const matchedProfileCount = selectedProfiles
      ? selectedProfiles.filter((profile) => catalogSet.has(profile)).length
      : catalog.length;
    let validationError: string | null = null;
    if (reconciliation && selectedProfiles && !profileFieldHealthy) {
      validationError =
        'Dynatrace did not return alerting-profile metadata. Existing Relay data was preserved.';
    } else if (reconciliation && selectedProfiles && matchedProfileCount === 0) {
      validationError =
        'Configured Dynatrace alerting profiles were not found. Existing Relay data was preserved.';
    }
    return {
      catalog,
      selectedProfiles,
      selectedProfileSet: selectedProfiles ? new Set(selectedProfiles) : null,
      profileFieldHealthy,
      profileCatalogCount: catalog.length,
      matchedProfileCount,
      validationError,
    };
  }

  private async getAvailableAlertingProfiles(
    config: DynatraceProblemsConfig,
    forceRefresh = false,
    requireFresh = false,
  ): Promise<string[]> {
    if (
      !forceRefresh &&
      !requireFresh &&
      this.profileCatalogRefreshedAt > 0 &&
      Date.now() - this.profileCatalogRefreshedAt < PROFILE_CATALOG_REFRESH_MS
    ) {
      return this.availableAlertingProfiles;
    }
    try {
      const profiles = await this.client.fetchAlertingProfiles(config);
      this.availableAlertingProfiles = profiles;
    } catch (error) {
      loggers.main.warn('Could not refresh the Dynatrace alerting profile catalog', { error });
      if (requireFresh) throw error;
    } finally {
      this.profileCatalogRefreshedAt = Date.now();
    }
    return this.availableAlertingProfiles;
  }

  private async upsertProblems(
    pb: PocketBase,
    problems: IncomingProblem[],
    reconciliation: boolean,
    titles: DynatraceNotificationTitle[],
    isCurrent: () => boolean,
  ): Promise<UpsertStats> {
    const stats: UpsertStats = { created: 0, updated: 0, unchanged: 0 };
    if (problems.length === 0) return stats;

    const existing = await this.loadExistingProblems(pb, problems, reconciliation);
    const recordByProblem = new Map(existing.map((record) => [record.problemId, record]));
    const titleByProblem = new Map(titles.map((title) => [title.problemId, title]));
    // One shared iterator hands each problem to exactly one worker, which keeps the
    // concurrency limit while giving every worker a properly typed (never undefined) item.
    const queue = problems[Symbol.iterator]();

    const worker = async () => {
      for (const incoming of queue) {
        if (!isCurrent()) return;
        const existingRecord = recordByProblem.get(incoming.problemId);
        const problem = {
          workflowTitle: existingRecord?.workflowTitle,
          workflowDescription: existingRecord?.workflowDescription,
          workflowTags: existingRecord?.workflowTags,
          workflowAffectedEntityTypes: existingRecord?.workflowAffectedEntityTypes,
          ...incoming,
        };
        if (
          existingRecord?.environmentUrl &&
          existingRecord.environmentUrl !== problem.environmentUrl
        ) {
          throw new Error(
            'A Dynatrace problem ID belongs to a different environment. Existing history was preserved.',
          );
        }
        if (existingRecord && problemFingerprint(existingRecord) === problemFingerprint(problem)) {
          stats.unchanged += 1;
          continue;
        }
        if (existingRecord) {
          await pb.collection(DYNATRACE_PROBLEMS_COLLECTION).update(existingRecord.id, problem, {
            requestKey: null,
          });
          stats.updated += 1;
        } else {
          const created = await pb
            .collection(DYNATRACE_PROBLEMS_COLLECTION)
            .create<ExistingProblem>(
              { ...problem, ...titleByProblem.get(problem.problemId) },
              { requestKey: null },
            );
          recordByProblem.set(problem.problemId, created);
          stats.created += 1;
        }
      }
    };

    await awaitWrites(
      Array.from({ length: Math.min(UPSERT_CONCURRENCY, problems.length) }, () => worker()),
    );
    return stats;
  }

  private async loadExistingProblems(
    pb: PocketBase,
    problems: IncomingProblem[],
    reconciliation: boolean,
  ): Promise<ExistingProblem[]> {
    const collection = pb.collection(DYNATRACE_PROBLEMS_COLLECTION);
    if (reconciliation) {
      return collection.getFullList<ExistingProblem>({
        fields: PROBLEM_COMPARISON_FIELDS,
        requestKey: null,
      });
    }

    const existing: ExistingProblem[] = [];
    const problemIds = [...new Set(problems.map((problem) => problem.problemId))];
    for (let index = 0; index < problemIds.length; index += EXISTING_LOOKUP_BATCH_SIZE) {
      const batch = problemIds.slice(index, index + EXISTING_LOOKUP_BATCH_SIZE);
      const filter = batch
        .map((problemId) => `problemId="${escapeFilter(problemId)}"`)
        .join(' || ');
      existing.push(
        ...(await collection.getFullList<ExistingProblem>({
          filter,
          fields: PROBLEM_COMPARISON_FIELDS,
          requestKey: null,
        })),
      );
    }
    return existing;
  }

  private async pruneExpiredHistory(pb: PocketBase, isCurrent: () => boolean): Promise<number> {
    if (!this.canPruneHistory()) return 0;
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    const cutoffIso = new Date(cutoff).toISOString();
    const collection = pb.collection(DYNATRACE_PROBLEMS_COLLECTION);
    const [expired, abandoned] = await Promise.all([
      collection.getFullList<ExpiredProblem>({
        filter: `status="CLOSED" && endTime>0 && endTime<${cutoff}`,
        fields: 'id,problemId,status,endTime,scopeExcluded,scopeExcludedAt',
        requestKey: null,
      }),
      collection.getFullList<ExpiredProblem>({
        filter: `scopeExcluded=true && scopeExcludedAt<"${escapeFilter(cutoffIso)}"`,
        fields: 'id,problemId,status,endTime,scopeExcluded,scopeExcludedAt',
        requestKey: null,
      }),
    ]);
    const confirmedExpired = expired.filter(
      (problem) => problem.status === 'CLOSED' && problem.endTime > 0 && problem.endTime < cutoff,
    );
    const confirmedAbandoned = abandoned.filter(
      (problem) =>
        problem.scopeExcluded === true &&
        (parsedTimestamp(problem.scopeExcludedAt) ?? Number.POSITIVE_INFINITY) < cutoff,
    );
    const unique = new Map(
      [...confirmedExpired, ...confirmedAbandoned].map((problem) => [problem.id, problem]),
    );
    return isCurrent()
      ? this.deleteProblemsWithRelatedRecords(
          pb,
          [...unique.values()],
          () => isCurrent() && this.canPruneHistory(),
        )
      : 0;
  }

  private async reconcileProblemScope(
    pb: PocketBase,
    scope: ProblemScopeReconciliation,
    environmentUrl: string,
    isCurrent: () => boolean,
  ): Promise<number> {
    const problems = await this.loadFilterableProblems(pb);
    const excludedAt = new Date().toISOString();
    let excludedCount = 0;
    for (const problem of problems) {
      if (!isCurrent()) return excludedCount;
      const shouldExclude = problemOutsideScope(problem, scope, environmentUrl);
      if (shouldExclude) excludedCount += 1;
      const missingExcludedAt = shouldExclude && parsedTimestamp(problem.scopeExcludedAt) === null;
      const staleIncludedAt = !shouldExclude && Boolean(problem.scopeExcludedAt);
      if (problem.scopeExcluded === shouldExclude && !missingExcludedAt && !staleIncludedAt)
        continue;
      await pb.collection(DYNATRACE_PROBLEMS_COLLECTION).update(
        problem.id,
        {
          scopeExcluded: shouldExclude,
          scopeExcludedAt: shouldExclude ? excludedAt : '',
        },
        { requestKey: null },
      );
    }
    return excludedCount;
  }

  private async loadFilterableProblems(pb: PocketBase): Promise<FilterableProblem[]> {
    const collection = pb.collection(DYNATRACE_PROBLEMS_COLLECTION);
    return collection.getFullList<FilterableProblem>({
      fields: 'id,problemId,alertingProfiles,scopeExcluded,scopeExcludedAt,environmentUrl',
      requestKey: null,
    });
  }

  private async deleteProblemsWithRelatedRecords(
    pb: PocketBase,
    problems: Array<Pick<DynatraceProblemRecord, 'id' | 'problemId'>>,
    isCurrent: () => boolean = () => true,
  ): Promise<number> {
    if (problems.length === 0) return 0;
    const problemIds = new Set(problems.map((problem) => problem.problemId));
    const [allNotes, allStates] = await Promise.all([
      pb.collection(DYNATRACE_PROBLEM_NOTES_COLLECTION).getFullList<RelatedRecord>({
        fields: 'id,problemId',
        requestKey: null,
      }),
      pb.collection(DYNATRACE_PROBLEM_STATES_COLLECTION).getFullList<RelatedRecord>({
        fields: 'id,problemId',
        requestKey: null,
      }),
    ]);
    const notesByProblem = groupByProblemId(
      allNotes.filter((note) => problemIds.has(note.problemId)),
    );
    const statesByProblem = groupByProblemId(
      allStates.filter((state) => problemIds.has(state.problemId)),
    );
    // See upsertProblems: one shared iterator, N workers, no index bookkeeping.
    const queue = problems[Symbol.iterator]();
    const worker = async () => {
      for (const problem of queue) {
        if (!isCurrent()) return;
        await awaitWrites([
          ...(notesByProblem.get(problem.problemId) ?? []).map((note) =>
            pb.collection(DYNATRACE_PROBLEM_NOTES_COLLECTION).delete(note.id, {
              requestKey: null,
            }),
          ),
          ...(statesByProblem.get(problem.problemId) ?? []).map((state) =>
            pb.collection(DYNATRACE_PROBLEM_STATES_COLLECTION).delete(state.id, {
              requestKey: null,
            }),
          ),
        ]);
        await pb.collection(DYNATRACE_PROBLEMS_COLLECTION).delete(problem.id, {
          requestKey: null,
        });
      }
    };
    await awaitWrites(
      Array.from({ length: Math.min(UPSERT_CONCURRENCY, problems.length) }, () => worker()),
    );
    return problems.length;
  }

  private async writeSyncState(
    state: 'disabled' | 'syncing' | 'ok' | 'error',
    patch: {
      lastAttemptAt?: string;
      lastSuccessAt?: string;
      lastReconciledAt?: string;
      error?: string;
      availableAlertingProfiles?: string[];
      selectedAlertingProfiles?: string[];
      profileFilterConfigured?: boolean;
      scopeSource?: ProblemScopeSource;
      profileFieldHealthy?: boolean;
      profileCatalogCount?: number;
      matchedProfileCount?: number;
      consecutiveFailures?: number;
      nextRetryAt?: string;
      staleSince?: string;
      resultTruncated?: boolean;
      reconciliationPending?: boolean;
    },
  ): Promise<void> {
    const pb = this.getPocketBase();
    if (!pb) return;

    const collection = pb.collection(DYNATRACE_PROBLEM_SYNC_COLLECTION);
    try {
      const existing = await collection.getFirstListItem<SyncRecord>(
        `key="${escapeFilter(DYNATRACE_PROBLEM_SYNC_KEY)}"`,
        { requestKey: null },
      );
      await collection.update(existing.id, { state, ...patch }, { requestKey: null });
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status !== 404) {
        loggers.main.warn('Failed to update Dynatrace Problems sync state', { error });
        return;
      }
      try {
        await collection.create(
          { key: DYNATRACE_PROBLEM_SYNC_KEY, state, ...patch },
          { requestKey: null },
        );
      } catch (createError) {
        loggers.main.warn('Failed to create Dynatrace Problems sync state', {
          error: createError,
        });
      }
    }
  }

  private async readSyncRecord(pb: PocketBase): Promise<SyncRecord | null> {
    try {
      return await pb
        .collection(DYNATRACE_PROBLEM_SYNC_COLLECTION)
        .getFirstListItem<SyncRecord>(`key="${escapeFilter(DYNATRACE_PROBLEM_SYNC_KEY)}"`, {
          requestKey: null,
        });
    } catch (error) {
      if ((error as { status?: number })?.status === 404) return null;
      loggers.main.warn('Failed to read Dynatrace Problems sync checkpoint', { error });
      return null;
    }
  }
}

function collectNotificationTitles(
  collected: Map<string, DynatraceNotificationTitle>,
  titles: DynatraceNotificationTitle[],
): void {
  for (const title of titles) {
    if (
      title.notificationUpdatedAt > (collected.get(title.problemId)?.notificationUpdatedAt ?? 0)
    ) {
      collected.set(title.problemId, title);
    }
  }
}
