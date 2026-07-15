/**
 * CollectionBootstrap — ensures all required PocketBase collections exist on server startup.
 *
 * Runs after PB is healthy and authenticated. Checks for each collection by name;
 * creates it with the correct schema and API rules if missing. Existing managed
 * collections are patched non-destructively; unmanaged collections are left untouched.
 */

import { randomBytes } from 'node:crypto';
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
  normalizeOperatorDisplayName,
  type RelayOperatorRecord,
} from '@shared/operators';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_COMMANDS_COLLECTION,
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
} from '@shared/privilegedAccess';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_MAX_CATEGORY_LENGTH,
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_MAX_SOURCE_KEY_LENGTH,
} from '@shared/knowledge';
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
  maxSize?: number;
  mimeTypes?: string[];
  protected?: boolean;
}

interface CollectionDef {
  name: string;
  type: 'base' | 'auth';
  fields: FieldDef[];
  indexes?: string[];
  rules?: CollectionRules;
  auth?: AuthCollectionOptions;
}

type AuthCollectionOptions = {
  authRule: string | null;
  manageRule: string | null;
  passwordAuth: {
    enabled: boolean;
    identityFields: string[];
  };
};

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
  authRule?: string | null;
  manageRule?: string | null;
  passwordAuth?: {
    enabled: boolean;
    identityFields: string[];
  };
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
const PRIVILEGED_ACCOUNT_OPERATOR_INDEX =
  'CREATE UNIQUE INDEX idx_relay_privileged_accounts_operator_id ON relay_privileged_accounts (operatorId)';
const PRIVILEGED_STATE_KEY_INDEX =
  'CREATE UNIQUE INDEX idx_relay_privileged_state_key ON relay_privileged_state (key)';
const PRIVILEGED_DEVICE_ID_INDEX =
  'CREATE UNIQUE INDEX idx_relay_privileged_devices_device_id ON relay_privileged_devices (deviceId)';
const PRIVILEGED_DEVICE_FINGERPRINT_INDEX =
  'CREATE UNIQUE INDEX idx_relay_privileged_devices_fingerprint ON relay_privileged_devices (fingerprint)';
const PRIVILEGED_COMMAND_REQUEST_INDEX =
  'CREATE UNIQUE INDEX idx_relay_privileged_commands_request_id ON relay_privileged_commands (requestId)';
const KNOWLEDGE_DOCUMENT_SOURCE_KEY_INDEX =
  'CREATE UNIQUE INDEX idx_knowledge_documents_source_key ON knowledge_documents (sourceKey)';
const PRIVILEGED_ROSTER_MIGRATION_VERSION = 1;
const PRIVILEGED_MIGRATION_OPERATOR_NAMES = ['Ryan Bledsoe', 'Tristan Bowles'] as const;

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

const SERVER_HIDDEN_RULES: CollectionRules = {
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

const PRIVILEGED_COMMAND_ACCOUNT_RULE =
  '@request.auth.collectionName = "relay_privileged_accounts" && @request.auth.active = true && accountId = @request.auth.id';

const PRIVILEGED_COMMAND_RULES: CollectionRules = {
  listRule: PRIVILEGED_COMMAND_ACCOUNT_RULE,
  viewRule: PRIVILEGED_COMMAND_ACCOUNT_RULE,
  createRule: `${PRIVILEGED_COMMAND_ACCOUNT_RULE} && state = "pending"`,
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
      { type: 'text', name: 'operatorId' },
      { type: 'text', name: 'createdBy' },
      { type: 'text', name: 'alertSender' },
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
    name: RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
    type: 'auth',
    fields: [
      { type: 'text', name: 'operatorId', required: true, max: 200 },
      {
        type: 'select',
        name: 'role',
        required: true,
        values: ['admin', 'publisher'],
        maxSelect: 1,
      },
      { type: 'bool', name: 'active' },
      { type: 'bool', name: 'mustChangePassword' },
      { type: 'number', name: 'credentialVersion' },
    ],
    indexes: [PRIVILEGED_ACCOUNT_OPERATOR_INDEX],
    rules: SERVER_HIDDEN_RULES,
    auth: {
      authRule: 'active = true',
      manageRule: null,
      passwordAuth: { enabled: true, identityFields: ['operatorId'] },
    },
  },
  {
    name: RELAY_PRIVILEGED_STATE_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'key', required: true, max: 40 },
      { type: 'text', name: 'adminOperatorId', required: true, max: 200 },
      { type: 'text', name: 'publisherOperatorId', max: 200 },
      { type: 'number', name: 'assignmentVersion', required: true },
      { type: 'number', name: 'rosterMigrationVersion', required: true },
      { type: 'text', name: 'updatedByOperatorId', max: 200 },
      { type: 'date', name: 'updatedAt', required: true },
    ],
    indexes: [PRIVILEGED_STATE_KEY_INDEX],
    rules: SERVER_OWNED_RULES,
  },
  {
    name: RELAY_PRIVILEGED_DEVICES_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'accountId', required: true, max: 200 },
      { type: 'text', name: 'deviceId', required: true, max: 200 },
      { type: 'text', name: 'hostnameSnapshot', required: true, max: 255 },
      { type: 'text', name: 'publicKey', required: true, max: 4_096 },
      { type: 'text', name: 'fingerprint', required: true, max: 64 },
      {
        type: 'select',
        name: 'state',
        required: true,
        values: ['active', 'revoked'],
        maxSelect: 1,
      },
      { type: 'date', name: 'pairedAt', required: true },
      { type: 'date', name: 'lastUsedAt' },
      { type: 'date', name: 'revokedAt' },
      { type: 'text', name: 'revokedByOperatorId', max: 200 },
      { type: 'number', name: 'revision', required: true },
    ],
    indexes: [PRIVILEGED_DEVICE_ID_INDEX, PRIVILEGED_DEVICE_FINGERPRINT_INDEX],
    rules: SERVER_HIDDEN_RULES,
  },
  {
    name: RELAY_PRIVILEGED_COMMANDS_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'requestId', required: true, max: 128 },
      { type: 'text', name: 'accountId', required: true, max: 200 },
      { type: 'text', name: 'deviceId', required: true, max: 200 },
      { type: 'text', name: 'operatorId', required: true, max: 200 },
      {
        type: 'select',
        name: 'roleClaim',
        required: true,
        values: ['admin', 'publisher'],
        maxSelect: 1,
      },
      { type: 'text', name: 'command', required: true, max: 120 },
      { type: 'date', name: 'issuedAt', required: true },
      { type: 'date', name: 'expiresAt', required: true },
      { type: 'number', name: 'expectedRevision' },
      { type: 'json', name: 'payload', required: true },
      { type: 'text', name: 'bodyHash', required: true, max: 64 },
      { type: 'text', name: 'signature', required: true, max: 1_024 },
      {
        type: 'select',
        name: 'state',
        required: true,
        values: ['pending', 'processing', 'succeeded', 'failed'],
        maxSelect: 1,
      },
      { type: 'json', name: 'result' },
      { type: 'text', name: 'safeError', max: 500 },
      { type: 'date', name: 'completedAt' },
    ],
    indexes: [PRIVILEGED_COMMAND_REQUEST_INDEX],
    rules: PRIVILEGED_COMMAND_RULES,
  },
  {
    name: KNOWLEDGE_DOCUMENTS_COLLECTION,
    type: 'base',
    fields: [
      {
        type: 'text',
        name: 'sourceKey',
        required: true,
        max: KNOWLEDGE_MAX_SOURCE_KEY_LENGTH,
      },
      {
        type: 'text',
        name: 'category',
        required: true,
        max: KNOWLEDGE_MAX_CATEGORY_LENGTH,
      },
      { type: 'text', name: 'title', required: true, max: 240 },
      { type: 'text', name: 'fileName', required: true, max: 240 },
      {
        type: 'file',
        name: 'pdf',
        required: true,
        maxSelect: 1,
        maxSize: KNOWLEDGE_MAX_PDF_BYTES,
        mimeTypes: ['application/pdf'],
        protected: true,
      },
      { type: 'text', name: 'checksum', required: true, max: 64 },
      { type: 'number', name: 'byteSize', required: true },
      { type: 'number', name: 'pageCount', required: true },
      { type: 'json', name: 'outline' },
      {
        type: 'select',
        name: 'outlineSource',
        required: true,
        values: ['native', 'inferred', 'none'],
        maxSelect: 1,
      },
      { type: 'date', name: 'sourceModifiedAt', required: true },
      { type: 'date', name: 'indexedAt', required: true },
    ],
    indexes: [KNOWLEDGE_DOCUMENT_SOURCE_KEY_INDEX],
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
      { type: 'text', name: 'operatorId' },
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
      { type: 'text', name: 'operatorId' },
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

function managedFieldsForDefinition(definition: CollectionDef): FieldDef[] {
  return definition.type === 'auth'
    ? [...definition.fields]
    : [...definition.fields, ...AUTODATE_FIELDS];
}

function passwordAuthMatches(
  actual: AuthCollectionOptions['passwordAuth'] | undefined,
  expected: AuthCollectionOptions['passwordAuth'],
): boolean {
  return (
    actual?.enabled === expected.enabled &&
    actual.identityFields.length === expected.identityFields.length &&
    actual.identityFields.every((field, index) => field === expected.identityFields[index])
  );
}

/** Patch a single collection to add missing fields and enforce API rules. Returns true if patched. */
async function patchCollectionDefinition(
  pb: PocketBase,
  colId: string,
  colName: string,
  expectedSchemaFields: FieldDef[],
  expectedIndexes: string[] = [],
  expectedRules: CollectionRules = DEFAULT_AUTH_RULES,
  expectedAuth?: AuthCollectionOptions,
): Promise<boolean> {
  const colFull = (await pb.collections.getOne(colId)) as unknown as ExistingCollection;
  const fields = colFull.fields || [];
  const fieldNames = new Set(fields.map((f) => f.name));
  const missing = expectedSchemaFields.filter((f) => !fieldNames.has(f.name));
  const indexes = colFull.indexes || [];
  const missingIndexes = expectedIndexes.filter((index) => !indexes.includes(index));
  const rulesPatch = Object.fromEntries(
    Object.entries(expectedRules).filter(([key, value]) => {
      return colFull[key as keyof CollectionRules] !== value;
    }),
  );
  const authPatch: Partial<AuthCollectionOptions> = {};
  if (expectedAuth) {
    if (colFull.authRule !== expectedAuth.authRule) authPatch.authRule = expectedAuth.authRule;
    if (colFull.manageRule !== expectedAuth.manageRule)
      authPatch.manageRule = expectedAuth.manageRule;
    if (!passwordAuthMatches(colFull.passwordAuth, expectedAuth.passwordAuth)) {
      authPatch.passwordAuth = expectedAuth.passwordAuth;
    }
  }

  if (
    missing.length === 0 &&
    missingIndexes.length === 0 &&
    Object.keys(rulesPatch).length === 0 &&
    Object.keys(authPatch).length === 0
  ) {
    return false;
  }

  await pb.collections.update(colId, {
    ...(missing.length > 0 ? { fields: [...fields, ...missing] } : {}),
    ...(missingIndexes.length > 0 ? { indexes: [...indexes, ...missingIndexes] } : {}),
    ...rulesPatch,
    ...authPatch,
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
  if (Object.keys(authPatch).length > 0) {
    logger.info(`Patched authentication options on collection: ${colName}`);
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
        fields: managedFieldsForDefinition(def),
        ...(def.indexes ? { indexes: def.indexes } : {}),
        ...(def.rules ?? DEFAULT_AUTH_RULES),
        ...(def.auth ?? {}),
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
          managedFieldsForDefinition(def),
          def.indexes,
          def.rules ?? DEFAULT_AUTH_RULES,
          def.auth,
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

type OperatorBootstrapRecord = Pick<RelayOperatorRecord, 'id' | 'displayName' | 'active'>;

type PrivilegedStateBootstrapRecord = {
  id: string;
  key: string;
  adminOperatorId: string;
  publisherOperatorId?: string;
  assignmentVersion: number;
  rosterMigrationVersion: number;
};

function escapeFilterValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

async function getPrivilegedState(pb: PocketBase): Promise<PrivilegedStateBootstrapRecord | null> {
  const result = await pb
    .collection(RELAY_PRIVILEGED_STATE_COLLECTION)
    .getList<PrivilegedStateBootstrapRecord>(1, 2, {
      filter: 'key="primary"',
      requestKey: null,
    });
  if (result.totalItems > result.items.length || result.items.length > 1) {
    logger.warn('Privileged state bootstrap found an ambiguous singleton record');
    return null;
  }
  return result.items[0] ?? null;
}

function isFreshRosterSeedCandidate(records: OperatorBootstrapRecord[]): boolean {
  if (records.length === 0) return true;
  const initialNames = new Set<string>(INITIAL_RELAY_OPERATOR_NAMES);
  const seen = new Set<string>();
  for (const record of records) {
    if (!record.active || !initialNames.has(record.displayName) || seen.has(record.displayName)) {
      return false;
    }
    seen.add(record.displayName);
  }
  return true;
}

async function migrateRelayOperatorRoster(pb: PocketBase): Promise<OperatorBootstrapRecord | null> {
  const operators = pb.collection(RELAY_OPERATORS_COLLECTION);
  const existing = await operators.getList<OperatorBootstrapRecord>(1, 500, {
    requestKey: null,
  });
  if (existing.totalItems !== existing.items.length) {
    logger.warn('Operator roster migration deferred because the roster snapshot was incomplete');
    return null;
  }

  const recordsByName = new Map<string, OperatorBootstrapRecord[]>();
  for (const record of existing.items) {
    if (!record || typeof record.displayName !== 'string') continue;
    const normalized = normalizeOperatorDisplayName(record.displayName).toLocaleLowerCase('en');
    const records = recordsByName.get(normalized) ?? [];
    records.push(record);
    recordsByName.set(normalized, records);
  }

  const desiredNames = isFreshRosterSeedCandidate(existing.items)
    ? INITIAL_RELAY_OPERATOR_NAMES
    : PRIVILEGED_MIGRATION_OPERATOR_NAMES;
  let createdCount = 0;
  for (const displayName of desiredNames) {
    const normalized = displayName.toLocaleLowerCase('en');
    if ((recordsByName.get(normalized)?.length ?? 0) > 0) continue;
    const created = await operators.create<OperatorBootstrapRecord>({
      displayName,
      active: true,
    });
    if (!created?.id || created.displayName !== displayName) {
      throw new Error('Failed to create required Relay operator profile');
    }
    recordsByName.set(normalized, [created]);
    createdCount += 1;
  }

  const adminCandidates = recordsByName.get('ryan bledsoe') ?? [];
  if (adminCandidates.length !== 1) {
    logger.warn('Operator roster migration cannot identify one Ryan Bledsoe profile');
    return null;
  }
  if (createdCount > 0) {
    logger.info(`Created ${createdCount} operator profile(s) during roster migration`);
  }
  return adminCandidates[0] ?? null;
}

async function ensureInitialAdministratorAccount(
  pb: PocketBase,
  adminOperatorId: string,
): Promise<void> {
  if (!adminOperatorId) return;
  const accounts = pb.collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION);
  const existing = await accounts.getList(1, 2, {
    filter: `operatorId="${escapeFilterValue(adminOperatorId)}"`,
    requestKey: null,
  });
  if (existing.totalItems > 0) return;

  const unreachableCredential = randomBytes(48).toString('base64url');
  await accounts.create({
    operatorId: adminOperatorId,
    role: 'admin',
    active: false,
    mustChangePassword: true,
    credentialVersion: 0,
    password: unreachableCredential,
    passwordConfirm: unreachableCredential,
  });
  logger.info('Created inactive initial Relay administrator account');
}

async function ensurePrivilegedBootstrap(pb: PocketBase): Promise<void> {
  const state = await getPrivilegedState(pb);
  if (state?.rosterMigrationVersion >= PRIVILEGED_ROSTER_MIGRATION_VERSION) {
    await ensureInitialAdministratorAccount(pb, state.adminOperatorId);
    return;
  }

  const adminOperator = await migrateRelayOperatorRoster(pb);
  if (!adminOperator) return;
  await ensureInitialAdministratorAccount(pb, adminOperator.id);

  const stateData = {
    key: 'primary',
    adminOperatorId: adminOperator.id,
    publisherOperatorId: '',
    assignmentVersion: Math.max(1, state?.assignmentVersion ?? 0),
    rosterMigrationVersion: PRIVILEGED_ROSTER_MIGRATION_VERSION,
    updatedByOperatorId: '',
    updatedAt: new Date().toISOString(),
  };
  const states = pb.collection(RELAY_PRIVILEGED_STATE_COLLECTION);
  if (state) {
    await states.update(state.id, stateData);
  } else {
    await states.create(stateData);
  }
  logger.info('Completed privileged operator roster migration');
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
  await ensurePrivilegedBootstrap(pb);
  const unmanaged = warnAboutUnknownCollections(allCols);

  if (created > 0 || unmanaged > 0 || patched > 0) {
    logger.info(
      `Collection bootstrap complete: ${created} created, ${patched} patched, ${unmanaged} unmanaged`,
    );
  } else {
    logger.info('Collection bootstrap: all collections up to date');
  }
}
