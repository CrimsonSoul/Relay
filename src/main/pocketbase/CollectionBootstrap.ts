/**
 * CollectionBootstrap — ensures all required PocketBase collections exist on server startup.
 *
 * Runs after PB is healthy and authenticated. Checks for each collection by name;
 * creates it with the correct schema and API rules if missing. Existing collections
 * are left untouched (no destructive updates).
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
    name: 'saved_locations',
    type: 'base',
    fields: [
      { type: 'text', name: 'name', required: true },
      { type: 'number', name: 'lat' },
      { type: 'number', name: 'lon' },
      { type: 'bool', name: 'isDefault' },
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
];

const KNOWN_NAMES = new Set(COLLECTIONS.map((c) => c.name));

/**
 * Ensure all required collections exist in PocketBase.
 * Creates missing collections with correct fields and auth rules.
 * Prunes stale collections not in the schema (skips system and users collections).
 */
export async function ensureCollections(pb: PocketBase): Promise<void> {
  let existingCollections: Array<{ id: string; name: string }>;
  try {
    existingCollections = await pb.collections.getFullList();
  } catch (err) {
    logger.error('Failed to list collections', { error: err });
    return;
  }

  const existing = new Set(existingCollections.map((c) => c.name));

  // --- Create missing collections ---
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

  // --- Patch existing collections missing autodate fields ---
  let patched = 0;
  for (const def of COLLECTIONS) {
    if (!existing.has(def.name)) continue;
    try {
      const col = existingCollections.find((c) => c.name === def.name) as { id: string; name: string; fields?: Array<{ name: string }> } | undefined;
      if (!col) continue;
      const colFull = await pb.collections.getOne(col.id);
      const fieldNames = new Set(((colFull as unknown as { fields: Array<{ name: string }> }).fields || []).map((f: { name: string }) => f.name));
      if (!fieldNames.has('created') || !fieldNames.has('updated')) {
        const existingFields = (colFull as unknown as { fields: FieldDef[] }).fields || [];
        await pb.collections.update(col.id, {
          fields: [...existingFields, ...AUTODATE_FIELDS.filter((f) => !fieldNames.has(f.name))],
        });
        patched++;
        logger.info(`Patched autodate fields on collection: ${def.name}`);
      }
    } catch (err) {
      logger.error(`Failed to patch autodate fields on: ${def.name}`, { error: err });
    }
  }

  // --- Prune stale collections ---
  // Identify unknown collections not in the schema (excluding system and users).
  const staleCols = existingCollections.filter(
    (col) => !col.name.startsWith('_') && col.name !== 'users' && !KNOWN_NAMES.has(col.name),
  );

  if (staleCols.length > 0) {
    const staleNames = staleCols.map((c) => c.name);
    logger.warn(
      `About to prune ${staleCols.length} unknown collection(s) not in schema: ${staleNames.join(', ')}. ` +
        'If this is unexpected, restore from a PocketBase backup.',
    );
  }

  let pruned = 0;
  for (const col of staleCols) {
    try {
      await pb.collections.delete(col.id);
      pruned++;
      logger.warn(`Pruned stale collection: ${col.name}`);
    } catch (err) {
      logger.error(`Failed to prune collection: ${col.name}`, { error: err });
    }
  }

  if (created > 0 || pruned > 0 || patched > 0) {
    logger.info(`Collection bootstrap complete: ${created} created, ${patched} patched, ${pruned} pruned`);
  } else {
    logger.info('Collection bootstrap: all collections up to date');
  }
}
