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
import { loggers } from '../logger';
import { RoleAccountMigration } from '../privileged/RoleAccountMigration';
import { migrateKnowledgeCategories } from '../knowledge/KnowledgeCategoryMigration';

const LEGACY_ROSTER_COLLECTION = 'relay_operators';
const LEGACY_LOGIN_ROSTER_VIEW = 'relay_login_roster';
const logger = loggers.pocketbase;

const AUTH_RULE = '@request.auth.id != ""';

interface FieldDef {
  id?: string;
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
  collectionId?: string;
  cascadeDelete?: boolean;
  /** Internal dependency name. It is resolved to collectionId before PocketBase sees the field. */
  targetCollectionName?: string;
}

interface CollectionDef {
  name: string;
  type: 'base' | 'auth';
  fields: FieldDef[];
  indexes?: string[];
  rules?: CollectionRules;
  auth?: AuthCollectionOptions;
}

export type CollectionBootstrapResult =
  | { privilegedRuntimeReady: true }
  | { privilegedRuntimeReady: false; reason: string };

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
const PRIVILEGED_ACCOUNT_USERNAME_INDEX =
  'CREATE UNIQUE INDEX idx_relay_privileged_accounts_username_nocase ON relay_privileged_accounts (username COLLATE NOCASE)';
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
const KNOWLEDGE_SEARCH_BATCH_MAX_REQUESTS = 100;
const KNOWLEDGE_SEARCH_BATCH_MIN_BODY_BYTES = 2 * 1024 * 1024;
const POCKETBASE_DEFAULT_BATCH_TIMEOUT_SECONDS = 3;

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

const ACTIVE_KNOWLEDGE_RULE = '@request.auth.id != "" && lifecycleState = "active"';
const ACTIVE_KNOWLEDGE_RULES: CollectionRules = {
  listRule: ACTIVE_KNOWLEDGE_RULE,
  viewRule: ACTIVE_KNOWLEDGE_RULE,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

const KNOWLEDGE_SEARCH_DOCUMENT_STATUS_FIELDS: FieldDef[] = [
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

const KNOWLEDGE_SEARCH_CHUNK_DEFINITION: CollectionDef = {
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

const PRIVILEGED_ACCOUNT_FINAL_DEFINITION: CollectionDef = {
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

const PRIVILEGED_ACCOUNT_COMPATIBILITY_DEFINITION: CollectionDef = {
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

const PRIVILEGED_STATE_FINAL_DEFINITION: CollectionDef = {
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

const PRIVILEGED_STATE_COMPATIBILITY_DEFINITION: CollectionDef = {
  ...PRIVILEGED_STATE_FINAL_DEFINITION,
  fields: PRIVILEGED_STATE_FINAL_DEFINITION.fields.map((field) => ({
    ...field,
    ...(field.name === 'ownerAccountId' || field.name === 'identityMigrationVersion'
      ? { required: false }
      : {}),
  })),
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

const KNOWN_NAMES = new Set([
  ...COLLECTIONS.map((c) => c.name),
  KNOWLEDGE_SEARCH_CHUNKS_COLLECTION,
]);

function managedFieldsForDefinition(definition: CollectionDef): FieldDef[] {
  return definition.type === 'auth'
    ? [...definition.fields]
    : [...definition.fields, ...AUTODATE_FIELDS];
}

function serializeManagedFields(
  definition: CollectionDef,
  collectionIds: ReadonlyMap<string, string>,
): FieldDef[] {
  return managedFieldsForDefinition(definition).map((field) => {
    const { targetCollectionName, ...serialized } = field;
    if (!targetCollectionName) return serialized;
    const collectionId = collectionIds.get(targetCollectionName);
    if (!collectionId) {
      throw new Error(
        `Cannot resolve relation ${definition.name}.${field.name} to ${targetCollectionName}`,
      );
    }
    return { ...serialized, collectionId };
  });
}

function fieldValueMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      actual.every((value, index) => value === expected[index])
    );
  }
  if (expected === false && actual === undefined) return true;
  return actual === expected;
}

function reconcileManagedFields(
  fields: FieldDef[],
  expectedSchemaFields: FieldDef[],
): { fields: FieldDef[]; added: FieldDef[]; changed: FieldDef[] } {
  const expectedByName = new Map(expectedSchemaFields.map((field) => [field.name, field]));
  const added = expectedSchemaFields.filter(
    (expected) => !fields.some((field) => field.name === expected.name),
  );
  const changed: FieldDef[] = [];
  const reconciled = fields.map((field) => {
    const expected = expectedByName.get(field.name);
    if (!expected) return field;
    const differs = Object.entries(expected).some(([key, expectedValue]) =>
      fieldValueMatches(field[key as keyof FieldDef], expectedValue) ? false : true,
    );
    if (!differs) return field;
    const replacement = { ...field, ...expected };
    changed.push(replacement);
    return replacement;
  });
  return { fields: [...reconciled, ...added], added, changed };
}

function passwordAuthMatches(
  actual: AuthCollectionOptions['passwordAuth'] | undefined,
  expected: AuthCollectionOptions['passwordAuth'],
): boolean {
  return (
    actual?.enabled === expected.enabled &&
    Array.isArray(actual?.identityFields) &&
    actual.identityFields.length === expected.identityFields.length &&
    actual.identityFields.every((field, index) => field === expected.identityFields[index])
  );
}

function hasCompleteCollectionSnapshot(
  collection: ExistingCollection,
  expectedAuth?: AuthCollectionOptions,
): boolean {
  if (!Array.isArray(collection.fields) || !Array.isArray(collection.indexes)) return false;
  for (const rule of ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'] as const) {
    if (!Object.prototype.hasOwnProperty.call(collection, rule)) return false;
  }
  if (!expectedAuth) return true;
  return (
    Object.prototype.hasOwnProperty.call(collection, 'authRule') &&
    Object.prototype.hasOwnProperty.call(collection, 'manageRule') &&
    typeof collection.passwordAuth?.enabled === 'boolean' &&
    Array.isArray(collection.passwordAuth.identityFields)
  );
}

function buildAuthPatch(
  colFull: ExistingCollection,
  expectedAuth?: AuthCollectionOptions,
): Partial<AuthCollectionOptions> {
  if (!expectedAuth) return {};
  const authPatch: Partial<AuthCollectionOptions> = {};
  if (colFull.authRule !== expectedAuth.authRule) authPatch.authRule = expectedAuth.authRule;
  if (colFull.manageRule !== expectedAuth.manageRule)
    authPatch.manageRule = expectedAuth.manageRule;
  if (!passwordAuthMatches(colFull.passwordAuth, expectedAuth.passwordAuth)) {
    authPatch.passwordAuth = expectedAuth.passwordAuth;
  }
  return authPatch;
}

function reconcileManagedIndexes(
  colName: string,
  indexes: string[],
  expectedIndexes: string[],
): { indexes: string[]; changed: boolean; added: number } {
  const initiallyRetainedIndexes =
    colName === RELAY_PRIVILEGED_ACCOUNTS_COLLECTION &&
    expectedIndexes.includes(PRIVILEGED_ACCOUNT_USERNAME_INDEX)
      ? indexes.filter((index) => index !== PRIVILEGED_ACCOUNT_OPERATOR_INDEX)
      : indexes;
  const expectedByName = new Map(
    expectedIndexes.map((index) => [managedIndexName(index), index] as const),
  );
  const retainedIndexes = initiallyRetainedIndexes.filter((index) => {
    const expected = expectedByName.get(managedIndexName(index));
    return expected === undefined || expected === index;
  });
  const missingIndexes = expectedIndexes.filter((index) => !retainedIndexes.includes(index));
  return {
    indexes: [...retainedIndexes, ...missingIndexes],
    changed: retainedIndexes.length !== indexes.length || missingIndexes.length > 0,
    added: missingIndexes.length,
  };
}

function managedIndexName(definition: string): string {
  return /\bINDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i.exec(definition)?.[1] ?? definition;
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
  snapshot?: ExistingCollection,
): Promise<boolean> {
  const colFull =
    snapshot ?? ((await pb.collections.getOne(colId)) as unknown as ExistingCollection);
  const fields = colFull.fields || [];
  const reconciledFields = reconcileManagedFields(fields, expectedSchemaFields);
  const indexes = colFull.indexes || [];
  const reconciledIndexes = reconcileManagedIndexes(colName, indexes, expectedIndexes);
  const rulesPatch = Object.fromEntries(
    Object.entries(expectedRules).filter(([key, value]) => {
      return colFull[key as keyof CollectionRules] !== value;
    }),
  );
  const authPatch = buildAuthPatch(colFull, expectedAuth);

  if (
    reconciledFields.added.length === 0 &&
    reconciledFields.changed.length === 0 &&
    !reconciledIndexes.changed &&
    Object.keys(rulesPatch).length === 0 &&
    Object.keys(authPatch).length === 0
  ) {
    return false;
  }

  await pb.collections.update(colId, {
    ...(reconciledFields.added.length > 0 || reconciledFields.changed.length > 0
      ? { fields: reconciledFields.fields }
      : {}),
    ...(reconciledIndexes.changed ? { indexes: reconciledIndexes.indexes } : {}),
    ...rulesPatch,
    ...authPatch,
  });

  if (reconciledFields.added.length > 0) {
    logger.info(
      `Patched fields on collection: ${colName} (+${reconciledFields.added.map((f) => f.name).join(', ')})`,
    );
  }
  if (reconciledFields.changed.length > 0) {
    logger.info(
      `Updated field definitions on collection: ${colName} (${reconciledFields.changed.map((f) => f.name).join(', ')})`,
    );
  }
  if (Object.keys(rulesPatch).length > 0) {
    logger.info(`Patched API rules on collection: ${colName}`);
  }
  if (reconciledIndexes.changed) {
    logger.info(`Patched indexes on collection: ${colName} (+${reconciledIndexes.added})`);
  }
  if (Object.keys(authPatch).length > 0) {
    logger.info(`Patched authentication options on collection: ${colName}`);
  }
  return true;
}

/**
 * Create or patch managed collections in declaration order.
 *
 * PocketBase validates collection rules when they are saved. Processing each
 * definition completely before moving to the next one ensures that rules on a
 * new dependent collection can reference fields added to an older collection
 * during the same startup migration.
 */
async function createManagedCollection(
  pb: PocketBase,
  def: CollectionDef,
  existing: Set<string>,
  collectionIds: Map<string, string>,
): Promise<void> {
  try {
    const createdCollection = await pb.collections.create({
      name: def.name,
      type: def.type,
      fields: serializeManagedFields(def, collectionIds),
      ...(def.indexes ? { indexes: def.indexes } : {}),
      ...(def.rules ?? DEFAULT_AUTH_RULES),
      ...(def.auth ?? {}),
    });
    const createdId = (createdCollection as unknown as { id?: unknown }).id;
    if (typeof createdId !== 'string' || !createdId) {
      throw new Error(`PocketBase did not return an ID for collection: ${def.name}`);
    }
    collectionIds.set(def.name, createdId);
    existing.add(def.name);
    logger.info(`Created collection: ${def.name}`);
  } catch (err) {
    logger.error(`Failed to create collection: ${def.name}`, { error: err });
    throw new Error(`Failed to create collection: ${def.name}`, { cause: err });
  }
}

async function patchManagedCollection(
  pb: PocketBase,
  def: CollectionDef,
  allCols: ExistingCollection[],
  collectionIds: ReadonlyMap<string, string>,
): Promise<boolean> {
  const col = allCols.find((candidate) => candidate.name === def.name);
  if (!col) return false;
  try {
    return await patchCollectionDefinition(
      pb,
      col.id,
      def.name,
      serializeManagedFields(def, collectionIds),
      def.indexes,
      def.rules ?? DEFAULT_AUTH_RULES,
      def.auth,
      hasCompleteCollectionSnapshot(col, def.auth) ? col : undefined,
    );
  } catch (err) {
    logger.error(`Failed to patch fields on: ${def.name}`, { error: err });
    throw new Error(`Failed to patch collection: ${def.name}`, { cause: err });
  }
}

async function ensureManagedCollections(
  pb: PocketBase,
  existing: Set<string>,
  allCols: ExistingCollection[],
  collectionIds: Map<string, string>,
  definitions: readonly CollectionDef[],
): Promise<{ created: number; patched: number }> {
  let created = 0;
  let patched = 0;
  for (const def of definitions) {
    if (!existing.has(def.name)) {
      await createManagedCollection(pb, def, existing, collectionIds);
      created++;
      continue;
    }

    if (await patchManagedCollection(pb, def, allCols, collectionIds)) patched++;
  }
  return { created, patched };
}

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

function finiteNumber(value: unknown, fallback: number, minimum: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : fallback;
}

export async function ensureKnowledgeBatchApi(pb: PocketBase): Promise<void> {
  let settings: Record<string, unknown>;
  try {
    settings = await pb.settings.getAll({ requestKey: null });
  } catch (err) {
    logger.error('Failed to read required PocketBase batch settings', {
      error: err,
    });
    throw new Error('Failed to read required PocketBase batch settings', {
      cause: err,
    });
  }

  const current =
    settings.batch && typeof settings.batch === 'object'
      ? (settings.batch as Record<string, unknown>)
      : {};
  const currentMaxRequests = finiteNumber(current.maxRequests, 0, 0);
  const currentMaxBodySize = finiteNumber(current.maxBodySize, 0, 0);
  const bodyCapFitsWriteBatch =
    currentMaxBodySize === 0 || currentMaxBodySize >= KNOWLEDGE_SEARCH_BATCH_MIN_BODY_BYTES;
  if (
    current.enabled === true &&
    currentMaxRequests >= KNOWLEDGE_SEARCH_BATCH_MAX_REQUESTS &&
    bodyCapFitsWriteBatch
  ) {
    return;
  }

  const batch = {
    enabled: true,
    maxRequests: Math.max(currentMaxRequests, KNOWLEDGE_SEARCH_BATCH_MAX_REQUESTS),
    timeout: finiteNumber(
      current.timeout,
      POCKETBASE_DEFAULT_BATCH_TIMEOUT_SECONDS,
      Number.EPSILON,
    ),
    // PocketBase uses 0 for its ~128 MiB default. Preserve that sentinel;
    // otherwise make sure a full 100-passage write batch fits.
    maxBodySize:
      currentMaxBodySize === 0
        ? 0
        : Math.max(currentMaxBodySize, KNOWLEDGE_SEARCH_BATCH_MIN_BODY_BYTES),
  };
  try {
    // Send only the complete nested batch value. PocketBase requires maxRequests
    // and timeout, while unrelated application settings must remain untouched.
    await pb.settings.update({ batch }, { requestKey: null });
    logger.info('Enabled required PocketBase batch API');
  } catch (err) {
    logger.error('Failed to enable required PocketBase batch API', {
      error: err,
    });
    throw new Error('Failed to enable required PocketBase batch API', {
      cause: err,
    });
  }
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
export async function ensureKnowledgeSearchCollections(pb: PocketBase): Promise<void> {
  await ensureKnowledgeBatchApi(pb);

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
      if (await patchManagedCollection(pb, definition, allCols, collectionIds)) patched += 1;
    }
    if (migration.status === 'migrated') {
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
