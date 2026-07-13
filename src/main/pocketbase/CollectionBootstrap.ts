/**
 * CollectionBootstrap — ensures all required PocketBase collections exist on server startup.
 *
 * Runs after PB is healthy and authenticated. Checks for each collection by name;
 * creates it with the correct schema and API rules if missing. Existing managed
 * collections are patched non-destructively; unmanaged collections are left untouched.
 */

import PocketBase from 'pocketbase';
import {
  DYNATRACE_PROBLEMS_COLLECTION,
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_COLLECTION,
} from '@shared/dynatraceProblems';
import {
  INITIAL_RELAY_OPERATOR_NAMES,
  MAX_OPERATOR_DISPLAY_NAME_LENGTH,
  RELAY_OPERATORS_COLLECTION,
} from '@shared/operators';
import { loggers } from '../logger';

const logger = loggers.pocketbase;

const AUTH_RULE = '@request.auth.id != ""';

interface FieldDef {
  type: string;
  name: string;
  required?: boolean;
  values?: string[];
  maxSelect?: number;
  max?: number;
  onCreate?: boolean;
  onUpdate?: boolean;
}

interface CollectionDef {
  name: string;
  type: 'base';
  fields: FieldDef[];
  indexes?: string[];
  rules?: CollectionRules;
}

type CollectionRules = {
  listRule: string | null;
  viewRule: string | null;
  createRule: string | null;
  updateRule: string | null;
  deleteRule: string | null;
};

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
const CLIENT_PRESENCE_COLLECTION = 'client_presence';
const CLIENT_PRESENCE_SESSION_INDEX =
  'CREATE UNIQUE INDEX idx_client_presence_session_id ON client_presence (sessionId)';
const CLOUD_STATUS_SNAPSHOT_KEY_INDEX =
  'CREATE UNIQUE INDEX idx_cloud_status_snapshot_key ON cloud_status_snapshot (key)';
const DYNATRACE_PROBLEM_ID_INDEX =
  'CREATE UNIQUE INDEX idx_dynatrace_problem_id ON dynatrace_problems (problemId)';
const DYNATRACE_PROBLEM_STATE_ID_INDEX =
  'CREATE UNIQUE INDEX idx_dynatrace_problem_state_id ON dynatrace_problem_states (problemId)';
const DYNATRACE_PROBLEM_NOTES_ID_INDEX =
  'CREATE INDEX idx_dynatrace_problem_notes_id ON dynatrace_problem_notes (problemId)';
const DYNATRACE_PROBLEM_SYNC_KEY_INDEX =
  'CREATE UNIQUE INDEX idx_dynatrace_problem_sync_key ON dynatrace_problem_sync (key)';
const RELAY_OPERATOR_DISPLAY_NAME_INDEX =
  'CREATE UNIQUE INDEX idx_relay_operators_display_name_nocase ON relay_operators (displayName COLLATE NOCASE)';

const DEFAULT_AUTH_RULES: CollectionRules = {
  listRule: AUTH_RULE,
  viewRule: AUTH_RULE,
  createRule: AUTH_RULE,
  updateRule: AUTH_RULE,
  deleteRule: AUTH_RULE,
};

const SERVER_OWNED_RULES: CollectionRules = {
  listRule: AUTH_RULE,
  viewRule: AUTH_RULE,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

const LOCAL_STATE_RULES: CollectionRules = {
  listRule: AUTH_RULE,
  viewRule: AUTH_RULE,
  createRule: AUTH_RULE,
  updateRule: AUTH_RULE,
  deleteRule: null,
};

const APPEND_ONLY_RULES: CollectionRules = {
  listRule: AUTH_RULE,
  viewRule: AUTH_RULE,
  createRule: AUTH_RULE,
  updateRule: null,
  deleteRule: null,
};

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
  {
    name: CLIENT_PRESENCE_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'sessionId', required: true },
      { type: 'text', name: 'hostname', required: true },
      {
        type: 'select',
        name: 'mode',
        required: true,
        values: ['client'],
        maxSelect: 1,
      },
      { type: 'date', name: 'lastSeen', required: true },
    ],
    indexes: [CLIENT_PRESENCE_SESSION_INDEX],
  },
  {
    name: 'cloud_status_snapshot',
    type: 'base',
    fields: [
      { type: 'text', name: 'key', required: true },
      { type: 'json', name: 'providers', required: true },
      { type: 'json', name: 'errors', required: true },
      { type: 'number', name: 'lastUpdated', required: true },
      { type: 'text', name: 'contentHash', required: true },
    ],
    indexes: [CLOUD_STATUS_SNAPSHOT_KEY_INDEX],
    rules: SERVER_OWNED_RULES,
  },
  {
    name: RELAY_OPERATORS_COLLECTION,
    type: 'base',
    fields: [
      {
        type: 'text',
        name: 'displayName',
        required: true,
        max: MAX_OPERATOR_DISPLAY_NAME_LENGTH,
      },
      { type: 'bool', name: 'active' },
    ],
    indexes: [RELAY_OPERATOR_DISPLAY_NAME_INDEX],
    rules: SERVER_OWNED_RULES,
  },
  {
    name: DYNATRACE_PROBLEMS_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'problemId', required: true },
      { type: 'text', name: 'displayId' },
      { type: 'text', name: 'title', required: true },
      {
        type: 'select',
        name: 'status',
        required: true,
        values: ['OPEN', 'CLOSED'],
        maxSelect: 1,
      },
      {
        type: 'select',
        name: 'severity',
        required: true,
        values: [
          'AVAILABILITY',
          'CUSTOM_ALERT',
          'ERROR',
          'INFO',
          'MONITORING_UNAVAILABLE',
          'PERFORMANCE',
          'RESOURCE_CONTENTION',
        ],
        maxSelect: 1,
      },
      {
        type: 'select',
        name: 'impactLevel',
        required: true,
        values: ['APPLICATION', 'ENVIRONMENT', 'INFRASTRUCTURE', 'SERVICES'],
        maxSelect: 1,
      },
      { type: 'number', name: 'startTime', required: true },
      { type: 'number', name: 'endTime', required: true },
      { type: 'text', name: 'rootCauseName' },
      { type: 'json', name: 'affectedEntities' },
      { type: 'json', name: 'impactedEntities' },
      { type: 'json', name: 'managementZones' },
      { type: 'json', name: 'alertingProfiles' },
      { type: 'text', name: 'environmentUrl', required: true },
      { type: 'date', name: 'syncedAt', required: true },
    ],
    indexes: [DYNATRACE_PROBLEM_ID_INDEX],
    rules: SERVER_OWNED_RULES,
  },
  {
    name: DYNATRACE_PROBLEM_STATES_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'problemId', required: true },
      { type: 'bool', name: 'addressed' },
      { type: 'date', name: 'addressedAt' },
      { type: 'text', name: 'addressedBy' },
    ],
    indexes: [DYNATRACE_PROBLEM_STATE_ID_INDEX],
    rules: LOCAL_STATE_RULES,
  },
  {
    name: DYNATRACE_PROBLEM_NOTES_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'problemId', required: true },
      { type: 'text', name: 'note', required: true },
      { type: 'text', name: 'author', required: true },
    ],
    indexes: [DYNATRACE_PROBLEM_NOTES_ID_INDEX],
    rules: APPEND_ONLY_RULES,
  },
  {
    name: DYNATRACE_PROBLEM_SYNC_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'key', required: true },
      {
        type: 'select',
        name: 'state',
        required: true,
        values: ['disabled', 'syncing', 'ok', 'error'],
        maxSelect: 1,
      },
      { type: 'date', name: 'lastAttemptAt' },
      { type: 'date', name: 'lastSuccessAt' },
      { type: 'date', name: 'lastReconciledAt' },
      { type: 'text', name: 'error' },
      { type: 'json', name: 'availableAlertingProfiles' },
      { type: 'json', name: 'selectedAlertingProfiles' },
      { type: 'bool', name: 'profileFilterConfigured' },
    ],
    indexes: [DYNATRACE_PROBLEM_SYNC_KEY_INDEX],
    rules: SERVER_OWNED_RULES,
  },
];

const KNOWN_NAMES = new Set(COLLECTIONS.map((c) => c.name));

/** Patch a single collection to add missing fields and enforce API rules. Returns true if patched. */
async function patchCollectionDefinition(
  pb: PocketBase,
  colId: string,
  colName: string,
  expectedSchemaFields: FieldDef[],
  expectedIndexes: string[] = [],
  expectedRules: CollectionRules = DEFAULT_AUTH_RULES,
): Promise<boolean> {
  const colFull = (await pb.collections.getOne(colId)) as unknown as ExistingCollection;
  const fields = colFull.fields || [];
  const fieldNames = new Set(fields.map((f) => f.name));
  const allExpected = [...expectedSchemaFields, ...AUTODATE_FIELDS];
  const missing = allExpected.filter((f) => !fieldNames.has(f.name));
  const indexes = colFull.indexes || [];
  const missingIndexes = expectedIndexes.filter((index) => !indexes.includes(index));
  const rulesPatch = Object.fromEntries(
    Object.entries(expectedRules).filter(([key, value]) => {
      return colFull[key as keyof CollectionRules] !== value;
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
        ...(def.rules ?? DEFAULT_AUTH_RULES),
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
      if (
        await patchCollectionDefinition(
          pb,
          col.id,
          def.name,
          def.fields,
          def.indexes,
          def.rules ?? DEFAULT_AUTH_RULES,
        )
      ) {
        patched++;
      }
    } catch (err) {
      logger.error(`Failed to patch fields on: ${def.name}`, { error: err });
      throw new Error(`Failed to patch collection: ${def.name}`, { cause: err });
    }
  }
  return patched;
}

async function seedRelayOperatorsIfEmpty(pb: PocketBase): Promise<void> {
  const operators = pb.collection(RELAY_OPERATORS_COLLECTION);
  const existing = await operators.getList(1, 1);
  if (existing.totalItems > 0) return;

  const batch = pb.createBatch();
  const batchOperators = batch.collection(RELAY_OPERATORS_COLLECTION);
  for (const displayName of INITIAL_RELAY_OPERATOR_NAMES) {
    batchOperators.create({ displayName, active: true });
  }
  await batch.send();
  logger.info(`Seeded ${INITIAL_RELAY_OPERATOR_NAMES.length} Relay operator profiles`);
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
  await seedRelayOperatorsIfEmpty(pb);
  const unmanaged = warnAboutUnknownCollections(allCols);

  if (created > 0 || unmanaged > 0 || patched > 0) {
    logger.info(
      `Collection bootstrap complete: ${created} created, ${patched} patched, ${unmanaged} unmanaged`,
    );
  } else {
    logger.info('Collection bootstrap: all collections up to date');
  }
}
