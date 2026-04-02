import { getPb, handleApiError, isOnline, requireOnline } from './pocketbase';
import type { OnCallRecord } from './oncallService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BoardSettingsRecord {
  id: string;
  key: string;
  teamOrder: string[];
  locked: boolean;
  created: string;
  updated: string;
}

export type BoardStatus = 'ready' | 'migrating' | 'invalid' | 'unavailable-offline';

export interface BoardSettingsInitializationResult {
  /** The authoritative settings record, if one was found or created. */
  record: BoardSettingsRecord | null;
  /** Shortcut to record.id for realtime subscription targeting. */
  recordId: string | null;
  /** Effective team order after reconciliation against live rows. */
  effectiveTeamOrder: string[];
  /** Effective lock state. Defaults to true (locked-for-safety) in non-ready states. */
  effectiveLocked: boolean;
  /** Board status enum for consumers. */
  status: BoardStatus;
  /** Deterministic error/recovery descriptors for toasts. */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COLLECTION = 'oncall_board_settings';
const ONCALL_COLLECTION = 'oncall';
const PRIMARY_KEY = 'primary';

/** Canonical form of a team name for backfill-derived teamId generation. */
export function canonicalizeTeamName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Derive first-seen team order from oncall rows (already sorted by sortOrder,created).
 * Returns unique teamIds in the order they first appear.
 */
function deriveTeamOrder(rows: OnCallRecord[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const row of rows) {
    const tid = row.teamId;
    if (tid && !seen.has(tid)) {
      seen.add(tid);
      order.push(tid);
    }
  }
  return order;
}

/**
 * Reconcile a stored teamOrder against the set of live teamIds.
 * - Removes stale ids not present in liveIds.
 * - Appends new liveIds not present in stored order.
 */
function reconcileTeamOrder(stored: string[], liveIds: Set<string>): string[] {
  const kept = stored.filter((id) => liveIds.has(id));
  const storedSet = new Set(stored);
  const appended = [...liveIds].filter((id) => !storedSet.has(id));
  return [...kept, ...appended];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateSettingsRecord(record: BoardSettingsRecord, errors: string[]): boolean {
  let valid = true;
  if (Array.isArray(record.teamOrder)) {
    const seen = new Set<string>();
    for (const id of record.teamOrder) {
      if (typeof id !== 'string') {
        errors.push('Invalid teamOrder: contains non-string entry');
        valid = false;
        break;
      }
      if (seen.has(id)) {
        errors.push(`Invalid teamOrder: duplicate entry "${id}"`);
        valid = false;
        break;
      }
      seen.add(id);
    }
  } else {
    errors.push('Invalid teamOrder: expected array');
    valid = false;
  }
  if (typeof record.locked !== 'boolean') {
    errors.push('Invalid locked: expected boolean');
    valid = false;
  }
  return valid;
}

// ---------------------------------------------------------------------------
// Result builders
// ---------------------------------------------------------------------------

function lockedResult(
  status: BoardStatus,
  errors: string[],
  record: BoardSettingsRecord | null = null,
): BoardSettingsInitializationResult {
  return {
    record,
    recordId: record?.id ?? null,
    effectiveTeamOrder: [],
    effectiveLocked: true,
    status,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Pre-backfill validation
// ---------------------------------------------------------------------------

/**
 * Validate oncall rows for blank team names and canonical collisions
 * before attempting backfill. Returns an error result if invalid, null if OK.
 */
function validatePreBackfill(oncallRows: OnCallRecord[]): BoardSettingsInitializationResult | null {
  const blankTeamRows = oncallRows.filter((r) => !r.teamId && !r.team.trim());
  if (blankTeamRows.length > 0) {
    return lockedResult('invalid', [
      `Found ${blankTeamRows.length} row(s) with blank team names — cannot derive teamId`,
    ]);
  }

  const needsBackfill = oncallRows.filter((r) => !r.teamId);
  if (needsBackfill.length === 0) return null;

  const canonicalMap = new Map<string, Set<string>>();
  for (const row of needsBackfill) {
    const canonical = canonicalizeTeamName(row.team);
    const existing = canonicalMap.get(canonical) || new Set();
    existing.add(row.team);
    canonicalMap.set(canonical, existing);
  }

  const existingTeamIds = new Set(oncallRows.filter((r) => r.teamId).map((r) => r.teamId));

  for (const [canonical, teamNames] of canonicalMap) {
    if (teamNames.size > 1) {
      return lockedResult('invalid', [
        `Canonical team name collision: "${canonical}" maps to: ${[...teamNames].join(', ')}`,
      ]);
    }
    if (existingTeamIds.has(canonical)) {
      return lockedResult('invalid', [
        `Canonical team name collision: "${canonical}" collides with existing teamId`,
      ]);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Fetch settings with offline handling
// ---------------------------------------------------------------------------

async function fetchPrimarySettings(): Promise<
  | { ok: true; records: BoardSettingsRecord[] }
  | { ok: false; result: BoardSettingsInitializationResult }
> {
  try {
    const records = await getPb()
      .collection(COLLECTION)
      .getFullList<BoardSettingsRecord>({ filter: 'key="primary"', requestKey: null });
    return { ok: true, records };
  } catch (err) {
    handleApiError(err);
    if (!isOnline()) {
      return {
        ok: false,
        result: lockedResult('unavailable-offline', ['Cannot fetch board settings while offline']),
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Bootstrap: create-or-refetch settings record
// ---------------------------------------------------------------------------

async function bootstrapSettingsRecord(
  oncallRows: OnCallRecord[],
): Promise<
  | { ok: true; record: BoardSettingsRecord }
  | { ok: false; result: BoardSettingsInitializationResult }
> {
  const derivedOrder = deriveTeamOrder(oncallRows);
  try {
    const record = await getPb().collection(COLLECTION).create<BoardSettingsRecord>({
      key: PRIMARY_KEY,
      teamOrder: derivedOrder,
      locked: false,
    });
    return { ok: true, record };
  } catch {
    // Concurrent bootstrap — another client created the record first
    return refetchAfterConflict();
  }
}

async function refetchAfterConflict(): Promise<
  | { ok: true; record: BoardSettingsRecord }
  | { ok: false; result: BoardSettingsInitializationResult }
> {
  try {
    const refetched = await getPb()
      .collection(COLLECTION)
      .getFullList<BoardSettingsRecord>({ filter: 'key="primary"', requestKey: null });
    if (refetched.length === 0) {
      return {
        ok: false,
        result: lockedResult('invalid', [
          'Failed to create or fetch board settings after bootstrap conflict',
        ]),
      };
    }
    return { ok: true, record: refetched[0]! };
  } catch (refetchErr) {
    handleApiError(refetchErr);
    return {
      ok: false,
      result: lockedResult('invalid', [
        'Failed to refetch board settings after bootstrap conflict',
      ]),
    };
  }
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

/**
 * Backfill teamId on legacy rows that are missing it.
 * Returns the list of rows with teamId populated (in-place mutation for caller convenience)
 * and a boolean indicating whether all backfills succeeded.
 */
async function backfillTeamIds(
  rows: OnCallRecord[],
  errors: string[],
): Promise<{ rows: OnCallRecord[]; allSucceeded: boolean }> {
  // Check for blank team names first
  const blankTeamRows = rows.filter((r) => !r.teamId && !r.team.trim());
  if (blankTeamRows.length > 0) {
    errors.push(
      `Found ${blankTeamRows.length} row(s) with blank team names — cannot derive teamId`,
    );
    return { rows, allSucceeded: false };
  }

  // Check for canonical collisions among rows needing backfill
  const needsBackfill = rows.filter((r) => !r.teamId);
  if (needsBackfill.length === 0) return { rows, allSucceeded: true };

  const canonicalMap = new Map<string, string[]>();
  for (const row of needsBackfill) {
    const canonical = canonicalizeTeamName(row.team);
    const existing = canonicalMap.get(canonical) || [];
    existing.push(row.team);
    canonicalMap.set(canonical, existing);
  }
  // Also include rows that already have teamId — check existing teamIds don't collide
  // with newly derived canonical names
  const existingTeamIds = new Set(rows.filter((r) => r.teamId).map((r) => r.teamId));

  for (const [canonical, teamNames] of canonicalMap) {
    const uniqueNames = new Set(teamNames);
    if (uniqueNames.size > 1) {
      errors.push(
        `Canonical team name collision: "${canonical}" maps to: ${[...uniqueNames].join(', ')}`,
      );
      return { rows, allSucceeded: false };
    }
    if (existingTeamIds.has(canonical)) {
      errors.push(`Canonical team name collision: "${canonical}" collides with existing teamId`);
      return { rows, allSucceeded: false };
    }
  }

  // Perform backfill
  let allSucceeded = true;
  for (const row of needsBackfill) {
    const canonical = canonicalizeTeamName(row.team);
    try {
      await getPb().collection(ONCALL_COLLECTION).update(row.id, { teamId: canonical });
      row.teamId = canonical;
    } catch (err) {
      handleApiError(err);
      errors.push(`Failed to backfill teamId for row ${row.id} (team: "${row.team}")`);
      allSucceeded = false;
    }
  }

  return { rows, allSucceeded };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the singleton primary board settings record, or null if none exists.
 */
export async function getPrimaryBoardSettings(): Promise<BoardSettingsRecord | null> {
  try {
    const records = await getPb()
      .collection(COLLECTION)
      .getFullList<BoardSettingsRecord>({ filter: 'key="primary"', requestKey: null });
    return records.length > 0 ? records[0]! : null;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

/**
 * Update the primary board settings record with a partial update.
 * Only the provided fields are changed; untouched fields are preserved.
 */
export async function updatePrimaryBoardSettings(
  recordId: string,
  updates: Partial<Pick<BoardSettingsRecord, 'teamOrder' | 'locked'>>,
): Promise<BoardSettingsRecord> {
  requireOnline();
  try {
    return await getPb().collection(COLLECTION).update<BoardSettingsRecord>(recordId, updates);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

/**
 * Initialize board settings for the on-call board.
 *
 * Self-heal duplicate primary settings records by keeping the first and deleting extras.
 * Mutates the array in-place to contain only the kept record.
 */
async function deduplicateSettings(records: BoardSettingsRecord[]): Promise<void> {
  const [keep, ...extras] = records;
  for (const dup of extras) {
    try {
      await getPb().collection(COLLECTION).delete(dup.id);
    } catch {
      // Best-effort cleanup — if delete fails, continue with the first record.
    }
  }
  records.length = 1;
  records[0] = keep!;
}

/**
 * - Backfills legacy rows missing `teamId`
 * - Looks up or creates the singleton `primary` board settings record
 * - Reconciles `teamOrder` against live on-call rows
 * - Returns status and effective settings for consumers
 */
export async function initializeBoardSettings(
  oncallRows: OnCallRecord[],
): Promise<BoardSettingsInitializationResult> {
  // --- Pre-backfill validation ---
  const preBackfillError = validatePreBackfill(oncallRows);
  if (preBackfillError) return preBackfillError;

  // --- Backfill legacy rows ---
  const needsBackfill = oncallRows.filter((r) => !r.teamId);
  if (needsBackfill.length > 0) {
    const errors: string[] = [];
    const backfillResult = await backfillTeamIds(oncallRows, errors);
    if (!backfillResult.allSucceeded) {
      const status: BoardStatus = errors.some((e) => e.includes('blank') || e.includes('collision'))
        ? 'invalid'
        : 'migrating';
      return lockedResult(status, errors);
    }
  }

  // --- Fetch existing settings ---
  const fetchResult = await fetchPrimarySettings();
  if (!fetchResult.ok) return fetchResult.result;
  const { records } = fetchResult;

  // --- Handle duplicate primary records ---
  if (records.length > 1) {
    await deduplicateSettings(records);
  }

  // --- Bootstrap or use existing ---
  let settingsRecord: BoardSettingsRecord;
  if (records.length === 0) {
    const bootstrapResult = await bootstrapSettingsRecord(oncallRows);
    if (!bootstrapResult.ok) return bootstrapResult.result;
    settingsRecord = bootstrapResult.record;
  } else {
    settingsRecord = records[0]!;
  }

  // --- Validate the record ---
  const validationErrors: string[] = [];
  if (!validateSettingsRecord(settingsRecord, validationErrors)) {
    return lockedResult('invalid', validationErrors, settingsRecord);
  }

  // --- Reconcile team order ---
  const liveTeamIds = new Set(deriveTeamOrder(oncallRows));
  const effectiveTeamOrder = reconcileTeamOrder(settingsRecord.teamOrder, liveTeamIds);

  return {
    record: settingsRecord,
    recordId: settingsRecord.id,
    effectiveTeamOrder,
    effectiveLocked: settingsRecord.locked,
    status: 'ready',
    errors: [],
  };
}
