/**
 * CollectionBootstrap — ensures all required PocketBase collections exist on server startup.
 *
 * Runs after PB is healthy and authenticated. Checks for each collection by name;
 * creates it with the correct schema and API rules if missing. Existing managed
 * collections are patched non-destructively; unmanaged collections are left untouched.
 */

import PocketBase from 'pocketbase';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_LIBRARY_STATE_COLLECTION,
} from '@shared/knowledge';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
} from '@shared/privilegedAccess';
import { loggers } from '../logger';
import { migrateKnowledgeCategories } from '../knowledge/KnowledgeCategoryMigration';
import { RoleAccountMigration } from '../privileged/RoleAccountMigration';
import {
  BOARD_SETTINGS_COLLECTION,
  COLLECTIONS,
  KNOWN_NAMES,
  KNOWLEDGE_SEARCH_CHUNK_DEFINITION,
  KNOWLEDGE_SEARCH_DOCUMENT_STATUS_FIELDS,
  PRIMARY_BOARD_SETTINGS_KEY,
  PRIVILEGED_ACCOUNT_COMPATIBILITY_DEFINITION,
  PRIVILEGED_ACCOUNT_FINAL_DEFINITION,
  PRIVILEGED_STATE_COMPATIBILITY_DEFINITION,
  PRIVILEGED_STATE_FINAL_DEFINITION,
} from './schema/collectionCatalog';
import {
  ensureManagedCollections,
  patchManagedCollection,
  reconcileManagedFields,
} from './schema/collectionReconciler';
import {
  ensureKnowledgeBatchApi,
  ensurePocketBaseAuthRateLimit,
} from './schema/pocketBaseSettings';
import type { CollectionBootstrapResult, ExistingCollection } from './schema/collectionTypes';

export { ensureKnowledgeBatchApi, ensurePocketBaseAuthRateLimit };
export type { CollectionBootstrapResult } from './schema/collectionTypes';

const LEGACY_ROSTER_COLLECTION = 'relay_operators';
const LEGACY_LOGIN_ROSTER_VIEW = 'relay_login_roster';
const logger = loggers.pocketbase;

type BoardSettingsRecord = {
  id: string;
  key: string;
  teamOrder?: unknown;
  locked?: boolean;
  created: string;
  updated: string;
};

type KnowledgeLibraryStateBootstrapRecord = {
  id: string;
  key: string;
  mode: 'legacy-watch' | 'migrating' | 'managed' | 'recovery-required';
  revision?: number;
};

async function ensureKnowledgeLibraryBootstrap(pb: PocketBase): Promise<void> {
  const states = pb.collection(KNOWLEDGE_LIBRARY_STATE_COLLECTION);
  const result = await states.getList<KnowledgeLibraryStateBootstrapRecord>(1, 2, {
    filter: 'key="primary"',
    requestKey: null,
  });
  if (result.totalItems > result.items.length || result.items.length > 1) {
    throw new Error('Knowledge library state bootstrap found an ambiguous singleton record');
  }

  const current = result.items[0];
  if (!current) {
    await states.create({
      key: 'primary',
      mode: 'managed',
      transitionedAt: new Date().toISOString(),
      transitionedByOperatorId: '',
      safeError: '',
      revision: 1,
    });
    logger.info('Created managed Knowledge library state');
    return;
  }
  if (current.mode !== 'legacy-watch' && current.mode !== 'migrating') return;

  await states.update(current.id, {
    mode: 'managed',
    transitionedAt: new Date().toISOString(),
    transitionedByOperatorId: '',
    safeError: '',
    revision: Math.max(1, current.revision ?? 0) + 1,
  });
  logger.info('Completed Knowledge library transition to PocketBase-only management');
}

async function repairDuplicateBoardSettings(pb: PocketBase, existing: Set<string>): Promise<void> {
  if (!existing.has(BOARD_SETTINGS_COLLECTION)) return;

  let records: BoardSettingsRecord[];
  try {
    records = await pb.collection(BOARD_SETTINGS_COLLECTION).getFullList<BoardSettingsRecord>({
      filter: `key="${PRIMARY_BOARD_SETTINGS_KEY}"`,
      sort: '-updated,-created,-id',
      requestKey: null,
    });
  } catch (error) {
    logger.warn('Failed to inspect on-call board settings before index patch', { error });
    return;
  }

  if (records.length <= 1) return;

  records.sort(compareBoardSettingsNewestFirst);
  const [keep, ...duplicates] = records;
  if (!keep) return;

  const mergedTeamOrder = mergeBoardTeamOrders([keep, ...duplicates]);
  let canDeleteDuplicates = true;
  if (mergedTeamOrder.length > 0 && !arraysEqual(asStringArray(keep.teamOrder), mergedTeamOrder)) {
    try {
      await pb
        .collection(BOARD_SETTINGS_COLLECTION)
        .update(keep.id, { teamOrder: mergedTeamOrder });
    } catch (error) {
      canDeleteDuplicates = false;
      logger.warn('Failed to merge duplicate on-call board settings order', { error });
    }
  }

  if (!canDeleteDuplicates) return;

  for (const duplicate of duplicates) {
    try {
      await pb.collection(BOARD_SETTINGS_COLLECTION).delete(duplicate.id);
    } catch (error) {
      logger.warn('Failed to remove duplicate on-call board settings record', {
        id: duplicate.id,
        error,
      });
    }
  }

  logger.warn('Repaired duplicate on-call board settings records before unique index patch', {
    kept: keep.id,
    removed: duplicates.map((record) => record.id),
  });
}

function compareBoardSettingsNewestFirst(a: BoardSettingsRecord, b: BoardSettingsRecord): number {
  const updated = b.updated.localeCompare(a.updated);
  if (updated !== 0) return updated;
  const created = b.created.localeCompare(a.created);
  if (created !== 0) return created;
  return b.id.localeCompare(a.id);
}

function mergeBoardTeamOrders(records: BoardSettingsRecord[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    for (const teamId of asStringArray(record.teamOrder)) {
      if (seen.has(teamId)) continue;
      seen.add(teamId);
      merged.push(teamId);
    }
  }

  return merged;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Warn about collections Relay does not manage. Startup never deletes user data. */
function warnAboutUnknownCollections(allCols: Array<{ id: string; name: string }>): number {
  const staleCols = allCols.filter(
    (col) => !col.name.startsWith('_') && col.name !== 'users' && !KNOWN_NAMES.has(col.name),
  );
  if (staleCols.length > 0) {
    logger.warn(
      `Found ${staleCols.length} unmanaged collection(s): ${staleCols.map((c) => c.name).join(', ')}. ` +
        'Relay leaves unmanaged collections untouched during startup.',
    );
  }
  return staleCols.length;
}

/**
 * Ensure derived Wiki search storage without making it part of the required
 * PocketBase bootstrap. Callers intentionally treat failures as best-effort.
 */
export async function ensureKnowledgeSearchCollections(
  pb: PocketBase,
  options: { batchApiReady?: boolean } = {},
): Promise<void> {
  if (!options.batchApiReady) await ensureKnowledgeBatchApi(pb);

  let allCols: ExistingCollection[];
  try {
    allCols = await pb.collections.getFullList<ExistingCollection>();
  } catch (err) {
    logger.error('Failed to list collections for optional Wiki search storage', { error: err });
    throw new Error('Failed to list PocketBase collections for optional Wiki search storage', {
      cause: err,
    });
  }

  const documents = allCols.find(({ name }) => name === KNOWLEDGE_DOCUMENTS_COLLECTION);
  if (!documents) {
    throw new Error('Cannot bootstrap optional Wiki search storage without knowledge_documents');
  }

  try {
    const existing = Array.isArray(documents.fields)
      ? documents
      : ((await pb.collections.getOne(documents.id)) as unknown as ExistingCollection);
    const reconciled = reconcileManagedFields(
      existing.fields ?? [],
      KNOWLEDGE_SEARCH_DOCUMENT_STATUS_FIELDS,
    );
    if (reconciled.added.length > 0 || reconciled.changed.length > 0) {
      await pb.collections.update(documents.id, { fields: reconciled.fields });
      logger.info(
        `Patched optional Wiki search fields on ${KNOWLEDGE_DOCUMENTS_COLLECTION} (+${reconciled.added.map((field) => field.name).join(', ')})`,
      );
    }
  } catch (err) {
    logger.error('Failed to patch optional Wiki search document fields', { error: err });
    throw new Error('Failed to patch optional Wiki search document fields', { cause: err });
  }

  const existing = new Set(allCols.map(({ name }) => name));
  const collectionIds = new Map(allCols.map(({ id, name }) => [name, id]));
  await ensureManagedCollections(pb, existing, allCols, collectionIds, [
    KNOWLEDGE_SEARCH_CHUNK_DEFINITION,
  ]);
}

/**
 * Snapshot the database immediately before the one-time legacy role conversion.
 *
 * The conversion deletes `relay_operators` — the only record of who the
 * operators were — and then patches the very columns it just populated. That
 * patch has been wrong before: it re-sent already-created fields without the ids
 * PocketBase assigned, dropping and recreating the username column *after* the
 * roster was gone. Nothing else backs the database up first; the maintenance
 * schedule that calls `backupIfDue()` only starts once `ensureCollections`
 * returns, so a failure here had nothing to restore from.
 *
 * This runs at most once per install — only while a legacy roster is present —
 * and refuses to continue if the snapshot cannot be written. Blocking startup is
 * the lesser harm: the alternative is an irreversible migration with no way back.
 */
async function snapshotBeforeRoleAccountMigration(pb: PocketBase): Promise<void> {
  const name = `pre_role_migration_${new Date().toISOString().replaceAll(/[:.]/g, '-')}.zip`;
  try {
    await pb.backups.create(name, { requestKey: null });
    logger.info('Captured pre-migration backup', { name });
  } catch (error) {
    logger.error('Could not capture the pre-migration backup', { error, name });
    throw new Error(
      'Relay could not back up the workspace before upgrading its accounts, so the upgrade was ' +
        'stopped. Free disk space in the Relay data folder and restart Relay to try again.',
      { cause: error },
    );
  }
}

/**
 * Confirm the conversion's own output survived the final-definition patch.
 *
 * The defect this guards against was silent: the accounts were still there, just
 * with empty usernames, so nobody could sign in and nothing said why. Checking
 * here turns that into a loud failure next to the backup taken moments earlier,
 * while the operator still has an obvious way back.
 */
async function assertMigratedUsernamesSurvived(pb: PocketBase): Promise<void> {
  const accounts = await pb
    .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
    .getFullList<{ id: string; username?: unknown }>({ requestKey: null });
  const blank = accounts.filter(
    (account) => typeof account.username !== 'string' || account.username.trim() === '',
  );
  if (blank.length === 0) return;

  logger.error('Account upgrade left usernames empty', {
    blankCount: blank.length,
    totalCount: accounts.length,
  });
  throw new Error(
    `Relay upgraded its accounts but ${blank.length} of ${accounts.length} lost their sign-in ` +
      'name, so startup was stopped before the change could be used. Restore the ' +
      'pre_role_migration backup from the Relay data folder and report this.',
  );
}

/**
 * Ensure all required collections exist in PocketBase.
 * Creates missing collections, patches required fields and API rules, and warns about
 * unmanaged collections without deleting them.
 */
export async function ensureCollections(pb: PocketBase): Promise<CollectionBootstrapResult> {
  let allCols: ExistingCollection[];
  try {
    allCols = await pb.collections.getFullList<ExistingCollection>();
  } catch (err) {
    logger.error('Failed to list collections', { error: err });
    throw new Error('Failed to list PocketBase collections', { cause: err });
  }

  const existing = new Set(allCols.map((c) => c.name));
  // Before the first schema write, not merely before the conversion: the
  // compatibility patch below already reshapes a legacy database.
  if (existing.has(LEGACY_ROSTER_COLLECTION)) await snapshotBeforeRoleAccountMigration(pb);
  const collectionIds = new Map(allCols.map((collection) => [collection.name, collection.id]));
  await repairDuplicateBoardSettings(pb, existing);
  const bootstrapDefinitions = COLLECTIONS.map((definition) => {
    if (
      definition.name === RELAY_PRIVILEGED_ACCOUNTS_COLLECTION &&
      existing.has(definition.name) &&
      existing.has(LEGACY_ROSTER_COLLECTION)
    ) {
      return PRIVILEGED_ACCOUNT_COMPATIBILITY_DEFINITION;
    }
    if (
      definition.name === RELAY_PRIVILEGED_STATE_COLLECTION &&
      existing.has(definition.name) &&
      existing.has(LEGACY_ROSTER_COLLECTION)
    ) {
      return PRIVILEGED_STATE_COMPATIBILITY_DEFINITION;
    }
    return definition;
  });
  const managed = await ensureManagedCollections(
    pb,
    existing,
    allCols,
    collectionIds,
    bootstrapDefinitions,
  );
  let { patched } = managed;
  const migration = await new RoleAccountMigration({ pb }).run(allCols);
  let migrationDeferredReason: string | null = null;
  if (migration.status === 'deferred') {
    logger.warn(`Role account migration deferred: ${migration.reason}`);
    migrationDeferredReason = migration.reason;
  } else {
    for (const definition of [
      PRIVILEGED_ACCOUNT_FINAL_DEFINITION,
      PRIVILEGED_STATE_FINAL_DEFINITION,
    ]) {
      // These collections were already patched above with their compatibility
      // definitions, so the listing snapshot no longer describes them. Re-read
      // each one instead: the fields phase one created must be re-sent with the
      // ids PocketBase gave them, or the columns holding the usernames the
      // migration just wrote are dropped and recreated empty.
      if (
        await patchManagedCollection(pb, definition, allCols, collectionIds, {
          reuseSnapshot: false,
        })
      ) {
        patched += 1;
      }
    }
    if (migration.status === 'migrated') {
      await assertMigratedUsernamesSurvived(pb);
      allCols = allCols.filter(
        ({ name }) => name !== LEGACY_ROSTER_COLLECTION && name !== LEGACY_LOGIN_ROSTER_VIEW,
      );
    }
  }
  await ensureKnowledgeLibraryBootstrap(pb);
  await migrateKnowledgeCategories(pb);
  const unmanaged = warnAboutUnknownCollections(allCols);

  if (managed.created > 0 || unmanaged > 0 || patched > 0) {
    logger.info(
      `Collection bootstrap complete: ${managed.created} created, ${patched} patched, ${unmanaged} unmanaged`,
    );
  } else {
    logger.info('Collection bootstrap: all collections up to date');
  }
  return migrationDeferredReason
    ? { privilegedRuntimeReady: false, reason: migrationDeferredReason }
    : { privilegedRuntimeReady: true };
}
