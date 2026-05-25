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
}

type ExistingCollection = {
  id: string;
  name: string;
  fields?: FieldDef[];
  listRule?: string | null;
  viewRule?: string | null;
  createRule?: string | null;
  updateRule?: string | null;
  deleteRule?: string | null;
};

/** Autodate fields added to every collection for created/updated timestamps. */
const AUTODATE_FIELDS: FieldDef[] = [
  { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
  { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
];

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
    name: 'oncall_board_settings',
    type: 'base',
    fields: [
      { type: 'text', name: 'key', required: true },
      { type: 'json', name: 'teamOrder' },
      { type: 'bool', name: 'locked' },
    ],
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
): Promise<boolean> {
  const colFull = (await pb.collections.getOne(colId)) as unknown as ExistingCollection;
  const fields = colFull.fields || [];
  const fieldNames = new Set(fields.map((f) => f.name));
  const allExpected = [...expectedSchemaFields, ...AUTODATE_FIELDS];
  const missing = allExpected.filter((f) => !fieldNames.has(f.name));
  const rulesPatch = Object.fromEntries(
    Object.entries(AUTH_RULE_PATCH).filter(([key, value]) => {
      return colFull[key as keyof typeof AUTH_RULE_PATCH] !== value;
    }),
  );

  if (missing.length === 0 && Object.keys(rulesPatch).length === 0) return false;

  await pb.collections.update(colId, {
    ...(missing.length > 0 ? { fields: [...fields, ...missing] } : {}),
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
      if (await patchCollectionDefinition(pb, col.id, def.name, def.fields)) patched++;
    } catch (err) {
      logger.error(`Failed to patch fields on: ${def.name}`, { error: err });
    }
  }
  return patched;
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
    return;
  }

  const existing = new Set(allCols.map((c) => c.name));
  const created = await createMissing(pb, existing);
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
