import {
  DYNATRACE_PROBLEMS_COLLECTION,
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_COLLECTION,
} from '@shared/dynatraceProblems';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_COMMANDS_COLLECTION,
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
  RELAY_PRIVILEGED_PAIRING_CHALLENGES_COLLECTION,
  RELAY_PRIVILEGED_PAIRING_REQUESTS_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
} from '@shared/privilegedAccess';
import {
  KNOWLEDGE_AUDIT_EVENTS_COLLECTION,
  KNOWLEDGE_CATEGORIES_COLLECTION,
  KNOWLEDGE_MAX_COVER_BYTES,
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_LIBRARY_STATE_COLLECTION,
  KNOWLEDGE_MAX_CATEGORY_LENGTH,
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_MAX_SOURCE_KEY_LENGTH,
  KNOWLEDGE_UNCATEGORIZED_SYSTEM_KEY,
  KNOWLEDGE_UPLOAD_BATCHES_COLLECTION,
  KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION,
  KNOWLEDGE_UPLOAD_CHUNK_BYTES,
  KNOWLEDGE_UPLOADS_COLLECTION,
} from '@shared/knowledge';
import {
  KNOWLEDGE_SEARCH_CHUNKS_COLLECTION,
  KNOWLEDGE_SEARCH_MAX_PASSAGE_TEXT,
} from '@shared/knowledgeSearch';
import type { CollectionDef, CollectionRules, FieldDef } from './collectionTypes';

const AUTH_RULE = '@request.auth.id != ""';
/** Autodate fields added to every collection for created/updated timestamps. */
export const AUTODATE_FIELDS: FieldDef[] = [
  { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
  { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
];

export const BOARD_SETTINGS_COLLECTION = 'oncall_board_settings';
export const PRIMARY_BOARD_SETTINGS_KEY = 'primary';
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
export const PRIVILEGED_ACCOUNT_USERNAME_INDEX =
  'CREATE UNIQUE INDEX idx_relay_privileged_accounts_username_nocase ON relay_privileged_accounts (username COLLATE NOCASE)';
export const PRIVILEGED_ACCOUNT_OPERATOR_INDEX =
  'CREATE UNIQUE INDEX idx_relay_privileged_accounts_operator_id ON relay_privileged_accounts (operatorId)';
const PRIVILEGED_STATE_KEY_INDEX =
  'CREATE UNIQUE INDEX idx_relay_privileged_state_key ON relay_privileged_state (key)';
const PRIVILEGED_DEVICE_ID_INDEX =
  'CREATE UNIQUE INDEX idx_relay_privileged_devices_device_id ON relay_privileged_devices (deviceId)';
const PRIVILEGED_DEVICE_FINGERPRINT_INDEX =
  'CREATE UNIQUE INDEX idx_relay_privileged_devices_fingerprint ON relay_privileged_devices (fingerprint)';
const PRIVILEGED_COMMAND_REQUEST_INDEX =
  'CREATE UNIQUE INDEX idx_relay_privileged_commands_request_id ON relay_privileged_commands (requestId)';
const PRIVILEGED_PAIRING_CHALLENGE_INDEX =
  'CREATE UNIQUE INDEX idx_relay_privileged_pairing_challenges_id ON relay_privileged_pairing_challenges (challengeId)';
const PRIVILEGED_PAIRING_REQUEST_INDEX =
  'CREATE UNIQUE INDEX idx_relay_privileged_pairing_requests_id ON relay_privileged_pairing_requests (requestId)';
const KNOWLEDGE_DOCUMENT_SOURCE_KEY_INDEX =
  'CREATE UNIQUE INDEX idx_knowledge_documents_source_key ON knowledge_documents (sourceKey) WHERE lifecycleState = "active"';
const KNOWLEDGE_DOCUMENT_LIFECYCLE_INDEX =
  'CREATE INDEX idx_knowledge_documents_lifecycle ON knowledge_documents (lifecycleState)';
const KNOWLEDGE_CATEGORY_NAME_INDEX =
  'CREATE UNIQUE INDEX idx_knowledge_categories_name_nocase ON knowledge_categories (normalizedName COLLATE NOCASE)';
const KNOWLEDGE_CATEGORY_ORDER_INDEX =
  'CREATE INDEX idx_knowledge_categories_order ON knowledge_categories (sortOrder, name)';
const KNOWLEDGE_UPLOAD_REQUEST_INDEX =
  'CREATE UNIQUE INDEX idx_knowledge_uploads_request_id ON knowledge_uploads (requestId)';
const KNOWLEDGE_UPLOAD_BATCH_REQUEST_INDEX =
  'CREATE UNIQUE INDEX idx_knowledge_upload_batches_request_id ON knowledge_upload_batches (requestId)';
const KNOWLEDGE_UPLOAD_BATCH_ACTIVE_ACCOUNT_INDEX =
  'CREATE UNIQUE INDEX idx_knowledge_upload_batches_active_account ON knowledge_upload_batches (accountId) WHERE state = "active"';
const KNOWLEDGE_UPLOAD_CHUNK_INDEX =
  'CREATE UNIQUE INDEX idx_knowledge_upload_chunk ON knowledge_upload_chunks (uploadId, `index`)';
const KNOWLEDGE_LIBRARY_STATE_KEY_INDEX =
  'CREATE UNIQUE INDEX idx_knowledge_library_state_key ON knowledge_library_state (key)';
const KNOWLEDGE_SEARCH_CHUNK_UNIQUE_INDEX =
  'CREATE UNIQUE INDEX idx_knowledge_search_chunk_identity ON knowledge_search_chunks (documentId, checksum, pageNumber, passageNumber, indexVersion)';
const KNOWLEDGE_SEARCH_CHUNK_DOCUMENT_INDEX =
  'CREATE INDEX idx_knowledge_search_chunk_document ON knowledge_search_chunks (documentId, checksum, indexVersion)';
export const DEFAULT_AUTH_RULES: CollectionRules = {
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

const ACTIVE_KNOWLEDGE_RULE = '@request.auth.id != "" && lifecycleState = "active"';
const ACTIVE_KNOWLEDGE_RULES: CollectionRules = {
  listRule: ACTIVE_KNOWLEDGE_RULE,
  viewRule: ACTIVE_KNOWLEDGE_RULE,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

export const KNOWLEDGE_SEARCH_DOCUMENT_STATUS_FIELDS: FieldDef[] = [
  {
    type: 'select',
    name: 'searchIndexState',
    required: false,
    values: ['pending', 'ready', 'failed'],
    maxSelect: 1,
  },
  { type: 'text', name: 'searchIndexChecksum', required: false, max: 64 },
  { type: 'number', name: 'searchIndexVersion', required: false },
  { type: 'date', name: 'searchIndexedAt', required: false },
  {
    type: 'select',
    name: 'searchIndexError',
    required: false,
    values: ['no-searchable-text', 'extraction-failed', 'storage-unavailable'],
    maxSelect: 1,
  },
];

const KNOWLEDGE_UPLOAD_ACCOUNT_RULE =
  '@request.auth.collectionName = "relay_privileged_accounts" && @request.auth.active = true && accountId = @request.auth.id';
const KNOWLEDGE_UPLOAD_RULES: CollectionRules = {
  listRule: KNOWLEDGE_UPLOAD_ACCOUNT_RULE,
  viewRule: KNOWLEDGE_UPLOAD_ACCOUNT_RULE,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

const KNOWLEDGE_UPLOAD_BATCH_RULES: CollectionRules = {
  listRule: KNOWLEDGE_UPLOAD_ACCOUNT_RULE,
  viewRule: KNOWLEDGE_UPLOAD_ACCOUNT_RULE,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

const KNOWLEDGE_UPLOAD_CHUNK_ACCOUNT_RULE =
  '@request.auth.collectionName = "relay_privileged_accounts" && @request.auth.active = true && accountId = @request.auth.id && @collection.knowledge_uploads.id ?= uploadId && @collection.knowledge_uploads.accountId ?= @request.auth.id && @collection.knowledge_uploads.deviceId ?= deviceId && @collection.knowledge_uploads.batchId ?= batchId && @collection.knowledge_uploads.state ?= "uploading" && @collection.knowledge_upload_batches.id ?= batchId && @collection.knowledge_upload_batches.accountId ?= @request.auth.id && @collection.knowledge_upload_batches.state ?= "active"';
const KNOWLEDGE_UPLOAD_CHUNK_RULES: CollectionRules = {
  listRule: KNOWLEDGE_UPLOAD_CHUNK_ACCOUNT_RULE,
  viewRule: KNOWLEDGE_UPLOAD_CHUNK_ACCOUNT_RULE,
  createRule: KNOWLEDGE_UPLOAD_CHUNK_ACCOUNT_RULE,
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

const PRIVILEGED_ACCOUNT_SELF_RULE =
  '@request.auth.collectionName = "relay_privileged_accounts" && id = @request.auth.id';

const PRIVILEGED_ACCOUNT_RULES: CollectionRules = {
  listRule: PRIVILEGED_ACCOUNT_SELF_RULE,
  viewRule: PRIVILEGED_ACCOUNT_SELF_RULE,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

const PRIVILEGED_COMMAND_ACCOUNT_RULE =
  '@request.auth.collectionName = "relay_privileged_accounts" && @request.auth.active = true && accountId = @request.auth.id';

const PRIVILEGED_COMMAND_RULES: CollectionRules = {
  listRule: PRIVILEGED_COMMAND_ACCOUNT_RULE,
  viewRule: PRIVILEGED_COMMAND_ACCOUNT_RULE,
  createRule: `${PRIVILEGED_COMMAND_ACCOUNT_RULE} && deviceId != "" && signature != "" && state = "pending" && @collection.relay_privileged_devices.accountId ?= accountId && @collection.relay_privileged_devices.deviceId ?= deviceId && @collection.relay_privileged_devices.state ?= "active"`,
  updateRule: null,
  deleteRule: null,
};

const PRIVILEGED_PAIRING_REQUEST_RULE =
  '@request.auth.collectionName = "relay_privileged_accounts" && @request.auth.active = true && accountId = @request.auth.id';

const PRIVILEGED_PAIRING_REQUEST_RULES: CollectionRules = {
  listRule: PRIVILEGED_PAIRING_REQUEST_RULE,
  viewRule: PRIVILEGED_PAIRING_REQUEST_RULE,
  createRule: `${PRIVILEGED_PAIRING_REQUEST_RULE} && state = "pending"`,
  updateRule: null,
  deleteRule: null,
};

function relation(name: string, targetCollectionName: string, required: boolean): FieldDef {
  return {
    type: 'relation',
    name,
    required,
    maxSelect: 1,
    cascadeDelete: false,
    targetCollectionName,
  };
}

export const KNOWLEDGE_SEARCH_CHUNK_DEFINITION: CollectionDef = {
  name: KNOWLEDGE_SEARCH_CHUNKS_COLLECTION,
  type: 'base',
  fields: [
    { ...relation('documentId', KNOWLEDGE_DOCUMENTS_COLLECTION, true), cascadeDelete: true },
    { type: 'text', name: 'checksum', required: true, max: 64 },
    { type: 'number', name: 'pageNumber', required: true },
    { type: 'number', name: 'passageNumber', required: true },
    { type: 'text', name: 'headingId', max: 200 },
    { type: 'text', name: 'heading', max: 240 },
    { type: 'text', name: 'text', required: true, max: KNOWLEDGE_SEARCH_MAX_PASSAGE_TEXT },
    {
      type: 'text',
      name: 'normalizedText',
      required: true,
      max: KNOWLEDGE_SEARCH_MAX_PASSAGE_TEXT,
    },
    { type: 'number', name: 'normalizedStart', required: false },
    { type: 'number', name: 'normalizedEnd', required: true },
    { type: 'number', name: 'indexVersion', required: true },
    { type: 'date', name: 'indexedAt', required: true },
  ],
  indexes: [KNOWLEDGE_SEARCH_CHUNK_UNIQUE_INDEX, KNOWLEDGE_SEARCH_CHUNK_DOCUMENT_INDEX],
  rules: SERVER_OWNED_RULES,
};

export const PRIVILEGED_ACCOUNT_FINAL_DEFINITION: CollectionDef = {
  name: RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  type: 'auth',
  fields: [
    { type: 'text', name: 'username', required: true, max: 64 },
    { type: 'text', name: 'displayName', required: true, max: 120 },
    {
      type: 'select',
      name: 'storedRole',
      required: true,
      values: ['administrator', 'publisher'],
      maxSelect: 1,
    },
    { type: 'text', name: 'operatorId', required: false, max: 200 },
    {
      type: 'select',
      name: 'role',
      required: false,
      values: ['admin', 'publisher'],
      maxSelect: 1,
    },
    { type: 'text', name: 'legacyOperatorId', required: false, max: 200 },
    { type: 'bool', name: 'active' },
    { type: 'bool', name: 'mustChangePassword' },
    { type: 'number', name: 'credentialVersion' },
    { type: 'number', name: 'revision', required: false },
  ],
  indexes: [PRIVILEGED_ACCOUNT_USERNAME_INDEX],
  rules: PRIVILEGED_ACCOUNT_RULES,
  auth: {
    authRule: 'active = true',
    manageRule: null,
    passwordAuth: { enabled: true, identityFields: ['username'] },
  },
};

export const PRIVILEGED_ACCOUNT_COMPATIBILITY_DEFINITION: CollectionDef = {
  ...PRIVILEGED_ACCOUNT_FINAL_DEFINITION,
  fields: PRIVILEGED_ACCOUNT_FINAL_DEFINITION.fields.map((field) => ({
    ...field,
    ...(field.name === 'username' || field.name === 'displayName' || field.name === 'storedRole'
      ? { required: false }
      : {}),
    ...(field.name === 'operatorId' || field.name === 'role' ? { required: true } : {}),
    ...(field.name === 'role' ? { values: ['admin', 'publisher', 'operator'] } : {}),
  })),
  indexes: [],
  auth: {
    authRule: 'active = true',
    manageRule: null,
    passwordAuth: { enabled: true, identityFields: ['operatorId'] },
  },
};

export const PRIVILEGED_STATE_FINAL_DEFINITION: CollectionDef = {
  name: RELAY_PRIVILEGED_STATE_COLLECTION,
  type: 'base',
  fields: [
    { type: 'text', name: 'key', required: true, max: 40 },
    { type: 'text', name: 'ownerAccountId', required: true, max: 200 },
    { type: 'text', name: 'publisherAccountId', max: 200 },
    { type: 'number', name: 'assignmentVersion', required: true },
    { type: 'number', name: 'identityMigrationVersion', required: true },
    { type: 'text', name: 'updatedByAccountId', max: 200 },
    { type: 'text', name: 'adminOperatorId', required: false, max: 200 },
    { type: 'json', name: 'adminOperatorIds', required: false },
    { type: 'text', name: 'publisherOperatorId', required: false, max: 200 },
    { type: 'number', name: 'rosterMigrationVersion', required: false },
    { type: 'text', name: 'updatedByOperatorId', required: false, max: 200 },
    { type: 'date', name: 'updatedAt', required: false },
  ],
  indexes: [PRIVILEGED_STATE_KEY_INDEX],
  rules: SERVER_OWNED_RULES,
};

export const PRIVILEGED_STATE_COMPATIBILITY_DEFINITION: CollectionDef = {
  ...PRIVILEGED_STATE_FINAL_DEFINITION,
  fields: PRIVILEGED_STATE_FINAL_DEFINITION.fields.map((field) => ({
    ...field,
    ...(field.name === 'ownerAccountId' || field.name === 'identityMigrationVersion'
      ? { required: false }
      : {}),
  })),
};

/** All data collections Relay requires. */
export const COLLECTIONS: CollectionDef[] = [
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
      { type: 'text', name: 'operatorId', required: false },
      { type: 'text', name: 'createdBy', required: false },
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
      // Healthy snapshots use an empty array, which PocketBase treats as blank.
      { type: 'json', name: 'errors', required: false },
      { type: 'number', name: 'lastUpdated', required: true },
      { type: 'text', name: 'contentHash', required: true },
    ],
    indexes: [CLOUD_STATUS_SNAPSHOT_KEY_INDEX],
    rules: SERVER_OWNED_RULES,
  },
  PRIVILEGED_ACCOUNT_FINAL_DEFINITION,
  PRIVILEGED_STATE_FINAL_DEFINITION,
  {
    name: RELAY_PRIVILEGED_DEVICES_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'accountId', required: true, max: 200 },
      { type: 'text', name: 'deviceId', required: true, max: 200 },
      { type: 'text', name: 'hostnameSnapshot', required: true, max: 255 },
      { type: 'text', name: 'label', required: true, max: 80 },
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
      { type: 'text', name: 'revokedByAccountId', max: 200 },
      // Newly paired devices start at revision zero.
      { type: 'number', name: 'revision', required: false },
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
      { type: 'text', name: 'deviceId', required: false, max: 200 },
      { type: 'text', name: 'operatorId', required: false, max: 200 },
      { type: 'text', name: 'displayNameSnapshot', required: false, max: 120 },
      {
        type: 'select',
        name: 'roleClaim',
        required: true,
        values: ['owner', 'admin', 'publisher'],
        maxSelect: 1,
      },
      { type: 'text', name: 'command', required: true, max: 120 },
      { type: 'date', name: 'issuedAt', required: true },
      { type: 'date', name: 'expiresAt', required: true },
      { type: 'number', name: 'expectedRevision' },
      { type: 'bool', name: 'hasExpectedRevision' },
      // Read-only commands intentionally use an empty object. PocketBase treats
      // `{}` as empty for required JSON fields, so command validity is enforced
      // by the signed-command parser instead of the storage schema.
      { type: 'json', name: 'payload', required: false },
      { type: 'text', name: 'bodyHash', required: true, max: 64 },
      { type: 'text', name: 'signature', required: false, max: 1_024 },
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
      { type: 'date', name: 'proofConsumedAt' },
    ],
    indexes: [PRIVILEGED_COMMAND_REQUEST_INDEX],
    rules: PRIVILEGED_COMMAND_RULES,
  },
  {
    name: RELAY_PRIVILEGED_PAIRING_CHALLENGES_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'challengeId', required: true, max: 200 },
      { type: 'text', name: 'accountId', required: true, max: 200 },
      { type: 'text', name: 'secretHash', required: true, max: 64 },
      { type: 'date', name: 'expiresAt', required: true },
      // PocketBase treats zero as empty for required numeric fields. Pairing
      // challenges intentionally begin with zero failed attempts.
      { type: 'number', name: 'attempts', required: false },
      {
        type: 'select',
        name: 'status',
        required: true,
        values: ['pending', 'consuming', 'completed', 'expired', 'locked'],
        maxSelect: 1,
      },
      { type: 'text', name: 'fingerprint', max: 64 },
      { type: 'text', name: 'deviceId', max: 200 },
    ],
    indexes: [PRIVILEGED_PAIRING_CHALLENGE_INDEX],
    rules: SERVER_HIDDEN_RULES,
  },
  {
    name: RELAY_PRIVILEGED_PAIRING_REQUESTS_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'requestId', required: true, max: 200 },
      { type: 'text', name: 'accountId', required: true, max: 200 },
      { type: 'text', name: 'operatorId', required: false, max: 200 },
      { type: 'text', name: 'displayNameSnapshot', required: false, max: 120 },
      { type: 'text', name: 'challengeId', required: true, max: 200 },
      { type: 'text', name: 'code', required: true, max: 8 },
      { type: 'json', name: 'publicKey', required: true },
      { type: 'text', name: 'fingerprint', required: true, max: 64 },
      { type: 'text', name: 'hostname', required: true, max: 255 },
      { type: 'text', name: 'deviceLabel', required: true, max: 80 },
      {
        type: 'select',
        name: 'state',
        required: true,
        values: ['pending', 'completed', 'failed'],
        maxSelect: 1,
      },
      { type: 'json', name: 'result' },
      { type: 'text', name: 'safeError', max: 80 },
      { type: 'date', name: 'completedAt' },
    ],
    indexes: [PRIVILEGED_PAIRING_REQUEST_INDEX],
    rules: PRIVILEGED_PAIRING_REQUEST_RULES,
  },
  {
    name: KNOWLEDGE_CATEGORIES_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'name', required: true, max: KNOWLEDGE_MAX_CATEGORY_LENGTH },
      {
        type: 'text',
        name: 'normalizedName',
        required: true,
        max: KNOWLEDGE_MAX_CATEGORY_LENGTH,
      },
      { type: 'number', name: 'sortOrder', required: true },
      {
        type: 'select',
        name: 'systemKey',
        values: [KNOWLEDGE_UNCATEGORIZED_SYSTEM_KEY],
        maxSelect: 1,
      },
      { type: 'number', name: 'revision', required: true },
    ],
    indexes: [KNOWLEDGE_CATEGORY_NAME_INDEX, KNOWLEDGE_CATEGORY_ORDER_INDEX],
    rules: SERVER_OWNED_RULES,
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
      relation('categoryId', KNOWLEDGE_CATEGORIES_COLLECTION, false),
      {
        type: 'select',
        name: 'documentType',
        required: false,
        values: ['sop', 'cheatsheet'],
        maxSelect: 1,
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
      {
        type: 'file',
        name: 'cover',
        required: false,
        maxSelect: 1,
        maxSize: KNOWLEDGE_MAX_COVER_BYTES,
        mimeTypes: ['image/png'],
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
      {
        type: 'select',
        name: 'lifecycleState',
        required: false,
        values: ['active', 'trashed'],
        maxSelect: 1,
      },
      { type: 'text', name: 'displayTitle', required: false, max: 240 },
      { type: 'number', name: 'revision', required: false },
      { type: 'text', name: 'publishedByAccountId', required: false, max: 200 },
      { type: 'text', name: 'publishedByOperatorId', required: false, max: 200 },
      { type: 'text', name: 'publishedByName', max: 120 },
      { type: 'date', name: 'publishedAt' },
      { type: 'text', name: 'trashedByAccountId', required: false, max: 200 },
      { type: 'text', name: 'trashedByOperatorId', required: false, max: 200 },
      { type: 'text', name: 'trashedByName', max: 120 },
      { type: 'date', name: 'trashedAt' },
    ],
    indexes: [KNOWLEDGE_DOCUMENT_SOURCE_KEY_INDEX, KNOWLEDGE_DOCUMENT_LIFECYCLE_INDEX],
    rules: ACTIVE_KNOWLEDGE_RULES,
  },
  {
    name: KNOWLEDGE_UPLOAD_BATCHES_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'requestId', required: true, max: 128 },
      { type: 'text', name: 'accountId', required: true, max: 200 },
      { type: 'text', name: 'deviceId', required: true, max: 200 },
      { type: 'text', name: 'actorDisplayName', required: false, max: 120 },
      { type: 'text', name: 'operatorId', required: false, max: 200 },
      { type: 'text', name: 'operatorName', required: false, max: 120 },
      { type: 'number', name: 'fileCount', required: true },
      { type: 'number', name: 'totalBytes', required: true },
      {
        type: 'select',
        name: 'state',
        required: true,
        values: ['active', 'ready', 'cancelled', 'expired', 'completed'],
        maxSelect: 1,
      },
      { type: 'date', name: 'createdAt', required: true },
      { type: 'date', name: 'lastActivityAt', required: true },
      { type: 'date', name: 'expiresAt', required: true },
      // New upload batches start at revision zero, which PocketBase treats as empty.
      { type: 'number', name: 'revision', required: false },
    ],
    indexes: [KNOWLEDGE_UPLOAD_BATCH_REQUEST_INDEX, KNOWLEDGE_UPLOAD_BATCH_ACTIVE_ACCOUNT_INDEX],
    rules: KNOWLEDGE_UPLOAD_BATCH_RULES,
  },
  {
    name: KNOWLEDGE_UPLOADS_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'requestId', required: true, max: 128 },
      relation('batchId', KNOWLEDGE_UPLOAD_BATCHES_COLLECTION, true),
      { type: 'text', name: 'accountId', required: true, max: 200 },
      { type: 'text', name: 'deviceId', required: true, max: 200 },
      { type: 'text', name: 'actorDisplayName', required: false, max: 120 },
      { type: 'text', name: 'operatorId', required: false, max: 200 },
      { type: 'text', name: 'operatorName', required: false, max: 120 },
      { type: 'text', name: 'fileName', required: true, max: 240 },
      {
        type: 'file',
        name: 'pdf',
        required: false,
        maxSelect: 1,
        maxSize: KNOWLEDGE_MAX_PDF_BYTES,
        mimeTypes: ['application/pdf'],
        protected: true,
      },
      {
        type: 'file',
        name: 'cover',
        required: false,
        maxSelect: 1,
        maxSize: KNOWLEDGE_MAX_COVER_BYTES,
        mimeTypes: ['image/png'],
        protected: true,
      },
      { type: 'text', name: 'checksum', required: true, max: 64 },
      { type: 'number', name: 'byteSize', required: true },
      { type: 'number', name: 'chunkSize', required: true },
      { type: 'number', name: 'chunkCount', required: true },
      { type: 'number', name: 'pageCount' },
      { type: 'json', name: 'outline' },
      {
        type: 'select',
        name: 'outlineSource',
        values: ['native', 'inferred', 'none'],
        maxSelect: 1,
      },
      { type: 'text', name: 'proposedTitle', max: 240 },
      { type: 'text', name: 'proposedCategory', max: KNOWLEDGE_MAX_CATEGORY_LENGTH },
      relation('proposedCategoryId', KNOWLEDGE_CATEGORIES_COLLECTION, false),
      {
        type: 'select',
        name: 'proposedDocumentType',
        required: false,
        values: ['sop', 'cheatsheet'],
        maxSelect: 1,
      },
      { type: 'text', name: 'replacementDocumentId', required: false, max: 200 },
      { type: 'text', name: 'duplicateDocumentId', max: 200 },
      {
        type: 'select',
        name: 'state',
        required: true,
        values: [
          'queued',
          'uploading',
          'assembling',
          'extracting',
          'ready',
          'failed',
          'cancelled',
          'published',
        ],
        maxSelect: 1,
      },
      { type: 'text', name: 'safeError', max: 80 },
      { type: 'date', name: 'lastActivityAt', required: true },
      { type: 'date', name: 'readyAt' },
      { type: 'date', name: 'expiresAt', required: true },
      { type: 'number', name: 'revision', required: false },
    ],
    indexes: [KNOWLEDGE_UPLOAD_REQUEST_INDEX],
    rules: KNOWLEDGE_UPLOAD_RULES,
  },
  {
    name: KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION,
    type: 'base',
    fields: [
      relation('uploadId', KNOWLEDGE_UPLOADS_COLLECTION, true),
      relation('batchId', KNOWLEDGE_UPLOAD_BATCHES_COLLECTION, true),
      { type: 'text', name: 'accountId', required: true, max: 200 },
      { type: 'text', name: 'deviceId', required: true, max: 200 },
      // Chunk indexes are zero-based; PocketBase treats numeric zero as empty.
      { type: 'number', name: 'index', required: false },
      { type: 'number', name: 'byteSize', required: true },
      { type: 'text', name: 'checksum', required: true, max: 64 },
      {
        type: 'file',
        name: 'chunk',
        required: true,
        maxSelect: 1,
        maxSize: KNOWLEDGE_UPLOAD_CHUNK_BYTES,
        protected: true,
      },
    ],
    indexes: [KNOWLEDGE_UPLOAD_CHUNK_INDEX],
    rules: KNOWLEDGE_UPLOAD_CHUNK_RULES,
  },
  {
    name: KNOWLEDGE_AUDIT_EVENTS_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'requestId', required: true, max: 128 },
      { type: 'text', name: 'action', required: true, max: 80 },
      { type: 'text', name: 'targetId', max: 200 },
      { type: 'text', name: 'fileName', max: 240 },
      { type: 'text', name: 'title', max: 240 },
      { type: 'text', name: 'category', max: KNOWLEDGE_MAX_CATEGORY_LENGTH },
      { type: 'text', name: 'accountId', required: false, max: 200 },
      { type: 'text', name: 'actorDisplayName', required: false, max: 120 },
      { type: 'text', name: 'operatorId', required: false, max: 200 },
      { type: 'text', name: 'operatorName', required: false, max: 120 },
      { type: 'date', name: 'occurredAt', required: true },
      { type: 'json', name: 'details' },
    ],
    rules: SERVER_HIDDEN_RULES,
  },
  {
    name: KNOWLEDGE_LIBRARY_STATE_COLLECTION,
    type: 'base',
    fields: [
      { type: 'text', name: 'key', required: true, max: 40 },
      {
        type: 'select',
        name: 'mode',
        required: true,
        values: ['legacy-watch', 'migrating', 'managed', 'recovery-required'],
        maxSelect: 1,
      },
      { type: 'date', name: 'transitionedAt', required: true },
      { type: 'text', name: 'transitionedByOperatorId', max: 200 },
      { type: 'text', name: 'safeError', max: 200 },
      { type: 'number', name: 'revision', required: false },
      { type: 'number', name: 'categoryMigrationVersion', required: false },
    ],
    indexes: [KNOWLEDGE_LIBRARY_STATE_KEY_INDEX],
    rules: SERVER_HIDDEN_RULES,
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
      { type: 'text', name: 'operatorId', required: false },
      { type: 'text', name: 'addressedBy', required: false },
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
      { type: 'text', name: 'operatorId', required: false },
      { type: 'text', name: 'author', required: false },
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

export const KNOWN_NAMES = new Set([
  ...COLLECTIONS.map((c) => c.name),
  KNOWLEDGE_SEARCH_CHUNKS_COLLECTION,
]);
