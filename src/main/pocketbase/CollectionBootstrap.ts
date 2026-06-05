/**
 * CollectionBootstrap — ensures all required PocketBase collections exist on server startup.
 *
 * Runs after PB is healthy and authenticated. Checks for each collection by name;
 * creates it with the correct schema and API rules if missing. Existing managed
 * collections are patched non-destructively; unmanaged collections are left untouched.
 */

import PocketBase from 'pocketbase';
import { loggers } from '../logger';

const logger = loggers.pocketbase;

const AUTH_RULE = '@request.auth.id != ""';

interface FieldDef {
  type: string;
  name: string;
  required?: boolean;
  values?: string[];
  maxSelect?: number;
  onCreate?: boolean;
  onUpdate?: boolean;
}

interface CollectionDef {
  name: string;
  type: 'base';
  fields: FieldDef[];
  indexes?: string[];
}

type ExistingCollection = {
  id: string;
  name: string;
  fields?: FieldDef[];
  indexes?: string[];
  listRule?: string | null;
  viewRule?: string | null;
  createRule?: string | null;
  updateRule?: string | null;
  deleteRule?: string | null;
};

type BoardSettingsRecord = {
  id: string;
  key: string;
  teamOrder?: unknown;
  locked?: boolean;
  created: string;
  updated: string;
};

/** Autodate fields added to every collection for created/updated timestamps. */
const AUTODATE_FIELDS: FieldDef[] = [
  { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
  { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
];

const BOARD_SETTINGS_COLLECTION = 'oncall_board_settings';
const PRIMARY_BOARD_SETTINGS_KEY = 'primary';
const BOARD_SETTINGS_KEY_INDEX =
  'CREATE UNIQUE INDEX idx_oncall_board_settings_key ON oncall_board_settings (key)';

/** All data collections Relay requires. */
const COLLECTIONS: CollectionDef[] = [
  {
    name: 'contacts',
    type: 'base',
    fields: [
      { type: 'text', name: 'name', required: true },
      { type: 'text', name: 'email' },
      { type: 'text', name: 'phone' },
      { type: 'text', name: 'title' },
    ],
  },
  {
    name: 'servers',
    type: 'base',
    fields: [
      { type: 'text', name: 'name', required: true },
      { type: 'text', name: 'businessArea' },
      { type: 'text', name: 'lob' },
      { type: 'text', name: 'comment' },
      { type: 'text', name: 'owner' },
      { type: 'text', name: 'contact' },
      { type: 'text', name: 'os' },
    ],
  },
  {
    name: 'oncall',
    type: 'base',
    fields: [
      { type: 'text', name: 'team', required: true },
      { type: 'text', name: 'role' },
      { type: 'text', name: 'name' },
      { type: 'text', name: 'contact' },
      { type: 'text', name: 'timeWindow' },
      { type: 'number', name: 'sortOrder' },
      { type: 'text', name: 'teamId' },
    ],
  },
  {
    name: 'bridge_groups',
    type: 'base',
    fields: [
      { type: 'text', name: 'name', required: true },
      { type: 'json', name: 'contacts' },
    ],
  },
  {
    name: 'bridge_history',
    type: 'base',
    fields: [
      { type: 'text', name: 'note' },
      { type: 'json', name: 'groups' },
      { type: 'json', name: 'contacts' },
      { type: 'number', name: 'recipientCount' },
    ],
  },
  {
    name: 'alert_history',
    type: 'base',
    fields: [
      {
        type: 'select',
        name: 'severity',
        values: ['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED'],
        maxSelect: 1,
      },
      { type: 'text', name: 'subject' },
      { type: 'text', name: 'bodyHtml' },
      { type: 'text', name: 'sender' },
      { type: 'text', name: 'recipient' },
      { type: 'bool', name: 'pinned' },
      { type: 'text', name: 'label' },
    ],
  },
  {
    name: 'alert_reminders',
    type: 'base',
    fields: [
      { type: 'text', name: 'title', required: true },
      { type: 'text', name: 'note' },
      { type: 'date', name: 'dueAt', required: true },
      {
        type: 'select',
        name: 'status',
        required: true,
        values: ['pending', 'done', 'dismissed'],
        maxSelect: 1,
      },
      { type: 'date', name: 'snoozeUntil' },
      {
        type: 'select',
        name: 'severity',
        values: ['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED'],
        maxSelect: 1,
      },
      { type: 'text', name: 'alertSubject' },
      { type: 'text', name: 'alertBodyHtml' },
      { type: 'text', name: 'createdBy' },
      { type: 'date', name: 'completedAt' },
      { type: 'date', name: 'dismissedAt' },
    ],
  },
  {
    name: 'notes',
    type: 'base',
    fields: [
      {
        type: 'select',
        name: 'entityType',
        required: true,
        values: ['contact', 'server'],
        maxSelect: 1,
      },
      { type: 'text', name: 'entityKey', required: true },
      { type: 'text', name: 'note' },
      { type: 'json', name: 'tags' },
    ],
  },
  {
    name: 'standalone_notes',
    type: 'base',
    fields: [
      { type: 'text', name: 'title' },
      { type: 'text', name: 'content' },
      { type: 'text', name: 'color' },
      { type: 'json', name: 'tags' },
      { type: 'number', name: 'sortOrder' },
    ],
  },
  {
    name: 'oncall_dismissals',
    type: 'base',
    fields: [
      { type: 'text', name: 'alertType', required: true },
      { type: 'text', name: 'dateKey', required: true },
    ],
  },
  {
    name: 'conflict_log',
    type: 'base',
    fields: [
      { type: 'text', name: 'collection', required: true },
      { type: 'text', name: 'recordId', required: true },
      { type: 'json', name: 'overwrittenData', required: true },
      { type: 'text', name: 'overwrittenBy' },
    ],
  },
  {
    name: BOARD_SETTINGS_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'key', required: true },
      { type: 'json', name: 'teamOrder' },
      { type: 'bool', name: 'locked' },
    ],
    indexes: [BOARD_SETTINGS_KEY_INDEX],
  },
];

const KNOWN_NAMES = new Set(COLLECTIONS.map((c) => c.name));

const AUTH_RULE_PATCH = {
  listRule: AUTH_RULE,
  viewRule: AUTH_RULE,
  createRule: AUTH_RULE,
  updateRule: AUTH_RULE,
  deleteRule: AUTH_RULE,
};

/** Patch a single collection to add missing fields and enforce API rules. Returns true if patched. */
async function patchCollectionDefinition(
  pb: PocketBase,
  colId: string,
  colName: string,
  expectedSchemaFields: FieldDef[],
  expectedIndexes: string[] = [],
): Promise<boolean> {
  const colFull = (await pb.collections.getOne(colId)) as unknown as ExistingCollection;
  const fields = colFull.fields || [];
  const fieldNames = new Set(fields.map((f) => f.name));
  const allExpected = [...expectedSchemaFields, ...AUTODATE_FIELDS];
  const missing = allExpected.filter((f) => !fieldNames.has(f.name));
  const indexes = colFull.indexes || [];
  const missingIndexes = expectedIndexes.filter((index) => !indexes.includes(index));
  const rulesPatch = Object.fromEntries(
    Object.entries(AUTH_RULE_PATCH).filter(([key, value]) => {
      return colFull[key as keyof typeof AUTH_RULE_PATCH] !== value;
    }),
  );

  if (missing.length === 0 && missingIndexes.length === 0 && Object.keys(rulesPatch).length === 0) {
    return false;
  }

  await pb.collections.update(colId, {
    ...(missing.length > 0 ? { fields: [...fields, ...missing] } : {}),
    ...(missingIndexes.length > 0 ? { indexes: [...indexes, ...missingIndexes] } : {}),
    ...rulesPatch,
  });

  if (missing.length > 0) {
    logger.info(
      `Patched fields on collection: ${colName} (+${missing.map((f) => f.name).join(', ')})`,
    );
  }
  if (Object.keys(rulesPatch).length > 0) {
    logger.info(`Patched API rules on collection: ${colName}`);
  }
  if (missingIndexes.length > 0) {
    logger.info(`Patched indexes on collection: ${colName} (+${missingIndexes.length})`);
  }
  return true;
}

/** Create collections that don't exist yet. */
async function createMissing(pb: PocketBase, existing: Set<string>): Promise<number> {
  let created = 0;
  for (const def of COLLECTIONS) {
    if (existing.has(def.name)) continue;
    try {
      await pb.collections.create({
        name: def.name,
        type: def.type,
        fields: [...def.fields, ...AUTODATE_FIELDS],
        ...(def.indexes ? { indexes: def.indexes } : {}),
        listRule: AUTH_RULE,
        viewRule: AUTH_RULE,
        createRule: AUTH_RULE,
        updateRule: AUTH_RULE,
        deleteRule: AUTH_RULE,
      });
      created++;
      logger.info(`Created collection: ${def.name}`);
    } catch (err) {
      logger.error(`Failed to create collection: ${def.name}`, { error: err });
      throw new Error(`Failed to create collection: ${def.name}`, { cause: err });
    }
  }
  return created;
}

/** Patch existing collections that are missing schema or autodate fields. */
async function patchExisting(
  pb: PocketBase,
  existing: Set<string>,
  allCols: Array<{ id: string; name: string }>,
): Promise<number> {
  let patched = 0;
  for (const def of COLLECTIONS) {
    if (!existing.has(def.name)) continue;
    const col = allCols.find((c) => c.name === def.name);
    if (!col) continue;
    try {
      if (await patchCollectionDefinition(pb, col.id, def.name, def.fields, def.indexes)) {
        patched++;
      }
    } catch (err) {
      logger.error(`Failed to patch fields on: ${def.name}`, { error: err });
      throw new Error(`Failed to patch collection: ${def.name}`, { cause: err });
    }
  }
  return patched;
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
 * Ensure all required collections exist in PocketBase.
 * Creates missing collections, patches required fields and API rules, and warns about
 * unmanaged collections without deleting them.
 */
export async function ensureCollections(pb: PocketBase): Promise<void> {
  let allCols: Array<{ id: string; name: string }>;
  try {
    allCols = await pb.collections.getFullList();
  } catch (err) {
    logger.error('Failed to list collections', { error: err });
    throw new Error('Failed to list PocketBase collections', { cause: err });
  }

  const existing = new Set(allCols.map((c) => c.name));
  const created = await createMissing(pb, existing);
  await repairDuplicateBoardSettings(pb, existing);
  const patched = await patchExisting(pb, existing, allCols);
  const unmanaged = warnAboutUnknownCollections(allCols);

  if (created > 0 || unmanaged > 0 || patched > 0) {
    logger.info(
      `Collection bootstrap complete: ${created} created, ${patched} patched, ${unmanaged} unmanaged`,
    );
  } else {
    logger.info('Collection bootstrap: all collections up to date');
  }
}
