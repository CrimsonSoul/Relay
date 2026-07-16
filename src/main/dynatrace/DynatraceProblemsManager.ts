import type PocketBase from 'pocketbase';
import {
  DYNATRACE_PROBLEM_HISTORY_RETENTION_DAYS,
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  DYNATRACE_PROBLEMS_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_KEY,
  type DynatraceProblemRecord,
  type DynatraceProblemsPublicSettings,
  type DynatraceProblemsSettingsInput,
  type DynatraceProblemsTestResult,
  normalizeDynatraceEnvironmentUrl,
} from '@shared/dynatraceProblems';
import { getErrorMessage } from '@shared/types';
import { loggers } from '../logger';
import {
  DynatraceProblemsClient,
  type DynatraceProblemsQueryScope,
} from './DynatraceProblemsClient';
import {
  DynatraceProblemsConfigStore,
  type DynatraceProblemsConfig,
} from './DynatraceProblemsConfigStore';

const POLL_INTERVAL_MS = 60_000;
const RECONCILIATION_INTERVAL_MS = 24 * 60 * 60_000;
const PROFILE_CATALOG_REFRESH_MS = RECONCILIATION_INTERVAL_MS;
const MIN_INCREMENTAL_LOOKBACK_MS = 10 * 60_000;
const INCREMENTAL_OVERLAP_MS = 5 * 60_000;
const EXISTING_LOOKUP_BATCH_SIZE = 100;
const UPSERT_CONCURRENCY = 6;
const HISTORY_RETENTION_MS = DYNATRACE_PROBLEM_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1_000;

type IncomingProblem = Omit<DynatraceProblemRecord, 'id' | 'created' | 'updated'>;
type ExistingProblem = DynatraceProblemRecord;
type ExpiredProblem = Pick<DynatraceProblemRecord, 'id' | 'problemId' | 'status' | 'endTime'>;
type FilterableProblem = Pick<DynatraceProblemRecord, 'id' | 'problemId' | 'alertingProfiles'>;
type RelatedRecord = { id: string; problemId: string };
type SyncRecord = {
  id: string;
  key: string;
  lastSuccessAt?: string;
  lastReconciledAt?: string;
  availableAlertingProfiles?: string[];
};
type UpsertStats = { created: number; updated: number; unchanged: number };

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
  'environmentUrl',
].join(',');

function escapeFilter(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function parsedTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
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
    environmentUrl: problem.environmentUrl,
  });
}

export class DynatraceProblemsManager {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private syncInFlight: Promise<number> | null = null;
  private reconciliationRequested = false;
  private availableAlertingProfiles: string[] = [];
  private profileCatalogRefreshedAt = 0;

  constructor(
    private readonly store: DynatraceProblemsConfigStore,
    private readonly getPocketBase: () => PocketBase | null,
    private readonly client = new DynatraceProblemsClient(),
  ) {}

  getSettings(): DynatraceProblemsPublicSettings {
    return this.store.getPublicSettings();
  }

  saveSettings(input: DynatraceProblemsSettingsInput): DynatraceProblemsPublicSettings {
    this.store.save(input);
    this.start(true);
    return this.getSettings();
  }

  async saveAlertingProfiles(alertingProfiles: string[]): Promise<number> {
    this.store.saveAlertingProfiles(alertingProfiles);
    if (this.syncInFlight) await this.syncInFlight.catch(() => undefined);
    return this.syncNow(true);
  }

  async testSettings(input: DynatraceProblemsSettingsInput): Promise<DynatraceProblemsTestResult> {
    const existing = this.store.load();
    const config: DynatraceProblemsConfig = {
      environmentUrl: normalizeDynatraceEnvironmentUrl(input.environmentUrl),
      apiToken: input.apiToken?.trim() || existing?.apiToken || '',
      alertingProfiles: existing?.alertingProfiles ?? null,
    };
    const problemCount = await this.client.testConnection(config);
    return { reachable: true, problemCount };
  }

  clearSettings(): boolean {
    this.stop();
    const cleared = this.store.clear();
    if (cleared) {
      this.availableAlertingProfiles = [];
      this.profileCatalogRefreshedAt = 0;
      void this.writeSyncState('disabled', {
        error: '',
        availableAlertingProfiles: [],
        selectedAlertingProfiles: [],
        profileFilterConfigured: false,
      });
    }
    return cleared;
  }

  start(forceReconciliation = false): void {
    this.stop();
    if (!this.store.load()) {
      void this.writeSyncState('disabled', { error: '' });
      return;
    }

    void this.syncNow(forceReconciliation).catch((error) => {
      loggers.main.warn('Initial Dynatrace Problems sync failed', { error });
    });
    this.pollTimer = setInterval(() => {
      void this.syncNow().catch((error) => {
        loggers.main.warn('Scheduled Dynatrace Problems sync failed', { error });
      });
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  syncNow(forceReconciliation = false): Promise<number> {
    if (forceReconciliation) this.reconciliationRequested = true;
    if (this.syncInFlight) return this.syncInFlight;

    const reconcile = this.reconciliationRequested;
    this.reconciliationRequested = false;
    this.syncInFlight = this.performSync(reconcile).finally(() => {
      this.syncInFlight = null;
      if (this.reconciliationRequested) {
        void this.syncNow().catch((error) => {
          loggers.main.warn('Queued Dynatrace Problems reconciliation failed', { error });
        });
      }
    });
    return this.syncInFlight;
  }

  private async performSync(forceReconciliation: boolean): Promise<number> {
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
    const reconciliation = shouldReconcile(previousSync, now, forceReconciliation);
    const queryScope: DynatraceProblemsQueryScope = reconciliation
      ? { mode: 'reconcile' }
      : { mode: 'incremental', lookbackMinutes: incrementalLookbackMinutes(previousSync, now) };
    await this.writeSyncState('syncing', { lastAttemptAt: attemptedAt, error: '' });

    try {
      if (this.availableAlertingProfiles.length === 0) {
        this.availableAlertingProfiles = previousSync?.availableAlertingProfiles ?? [];
        this.profileCatalogRefreshedAt = parsedTimestamp(previousSync?.lastReconciledAt) ?? 0;
      }
      const catalog = reconciliation
        ? await this.getAvailableAlertingProfiles(config, forceReconciliation)
        : this.availableAlertingProfiles;
      const result = await this.client.fetchProblems(config, queryScope);
      const selectedProfiles = config.alertingProfiles;
      const selectedProfileSet = new Set(selectedProfiles ?? []);
      const problems = selectedProfiles
        ? result.problems.filter((problem) =>
            problem.alertingProfiles.some((profile) => selectedProfileSet.has(profile)),
          )
        : result.problems;
      const observedProfiles = problems.flatMap((problem) => problem.alertingProfiles);
      this.availableAlertingProfiles = [...new Set([...catalog, ...observedProfiles])].sort(
        (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }),
      );

      const upsertStats = await this.upsertProblems(pb, problems, reconciliation);
      const profilePrunedCount =
        reconciliation && selectedProfiles
          ? await this.pruneProblemsOutsideProfiles(pb, selectedProfileSet)
          : 0;
      const retentionPrunedCount = reconciliation ? await this.pruneExpiredHistory(pb) : 0;
      const successAt = new Date().toISOString();
      await this.writeSyncState('ok', {
        lastAttemptAt: attemptedAt,
        lastSuccessAt: successAt,
        ...(reconciliation ? { lastReconciledAt: successAt } : {}),
        error: '',
        availableAlertingProfiles: this.availableAlertingProfiles,
        selectedAlertingProfiles: selectedProfiles ?? [],
        profileFilterConfigured: selectedProfiles !== null,
      });
      loggers.main.info('Dynatrace Problems synchronized', {
        mode: queryScope.mode,
        fetchedCount: problems.length,
        ...upsertStats,
        profilePrunedCount,
        retentionPrunedCount,
      });
      return problems.length;
    } catch (error) {
      const message = getErrorMessage(error);
      await this.writeSyncState('error', { lastAttemptAt: attemptedAt, error: message });
      throw error;
    }
  }

  private async getAvailableAlertingProfiles(
    config: DynatraceProblemsConfig,
    forceRefresh = false,
  ): Promise<string[]> {
    if (
      !forceRefresh &&
      this.availableAlertingProfiles.length > 0 &&
      Date.now() - this.profileCatalogRefreshedAt < PROFILE_CATALOG_REFRESH_MS
    ) {
      return this.availableAlertingProfiles;
    }
    try {
      const profiles = await this.client.fetchAlertingProfiles(config);
      this.availableAlertingProfiles = profiles;
      this.profileCatalogRefreshedAt = Date.now();
    } catch (error) {
      loggers.main.warn('Could not refresh the Dynatrace alerting profile catalog', { error });
    }
    return this.availableAlertingProfiles;
  }

  private async upsertProblems(
    pb: PocketBase,
    problems: IncomingProblem[],
    reconciliation: boolean,
  ): Promise<UpsertStats> {
    const stats: UpsertStats = { created: 0, updated: 0, unchanged: 0 };
    if (problems.length === 0) return stats;

    const existing = await this.loadExistingProblems(pb, problems, reconciliation);
    const recordByProblem = new Map(existing.map((record) => [record.problemId, record]));
    let cursor = 0;

    const worker = async () => {
      while (cursor < problems.length) {
        const index = cursor;
        cursor += 1;
        const problem = problems[index];
        const existingRecord = recordByProblem.get(problem.problemId);
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
            .create<ExistingProblem>(problem, { requestKey: null });
          recordByProblem.set(problem.problemId, created);
          stats.created += 1;
        }
      }
    };

    await Promise.all(
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

  private async pruneExpiredHistory(pb: PocketBase): Promise<number> {
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    const expired = await pb.collection(DYNATRACE_PROBLEMS_COLLECTION).getFullList<ExpiredProblem>({
      filter: `status="CLOSED" && endTime>0 && endTime<${cutoff}`,
      fields: 'id,problemId,status,endTime',
      requestKey: null,
    });
    const confirmedExpired = expired.filter(
      (problem) => problem.status === 'CLOSED' && problem.endTime > 0 && problem.endTime < cutoff,
    );
    return this.deleteProblemsWithRelatedRecords(pb, confirmedExpired);
  }

  private async pruneProblemsOutsideProfiles(
    pb: PocketBase,
    selectedProfiles: Set<string>,
  ): Promise<number> {
    const problems = await pb
      .collection(DYNATRACE_PROBLEMS_COLLECTION)
      .getFullList<FilterableProblem>({
        fields: 'id,problemId,alertingProfiles',
        requestKey: null,
      });
    const excluded = problems.filter(
      (problem) => !problem.alertingProfiles?.some((profile) => selectedProfiles.has(profile)),
    );
    return this.deleteProblemsWithRelatedRecords(pb, excluded);
  }

  private async deleteProblemsWithRelatedRecords(
    pb: PocketBase,
    problems: Array<Pick<DynatraceProblemRecord, 'id' | 'problemId'>>,
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
    const notesByProblem = Map.groupBy(
      allNotes.filter((note) => problemIds.has(note.problemId)),
      (note) => note.problemId,
    );
    const statesByProblem = Map.groupBy(
      allStates.filter((state) => problemIds.has(state.problemId)),
      (state) => state.problemId,
    );
    let cursor = 0;
    const worker = async () => {
      while (cursor < problems.length) {
        const problem = problems[cursor];
        cursor += 1;
        await Promise.all([
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
    await Promise.all(
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
