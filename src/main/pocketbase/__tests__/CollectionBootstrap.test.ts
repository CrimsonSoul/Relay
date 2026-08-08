import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetFullList = vi.fn();
// Typed with the argument pb.backups.create actually takes, so the recorded
// call carries the backup name the assertion below reads.
const mockBackupCreate = vi.fn(async (_name: string) => undefined);
const mockCreate = vi.fn();
const mockDelete = vi.fn();
const mockGetOne = vi.fn();
const mockUpdate = vi.fn();
const mockCollectionGetFullList = vi.fn();
const mockCollectionGetList = vi.fn();
const mockCollectionCreate = vi.fn();
const mockCollectionUpdate = vi.fn();
const mockCollectionDelete = vi.fn();
const mockPrivilegedStateGetList = vi.fn();
const mockPrivilegedStateGetFullList = vi.fn();
const mockPrivilegedStateCreate = vi.fn();
const mockPrivilegedStateUpdate = vi.fn();
const mockPrivilegedAccountGetList = vi.fn();
const mockPrivilegedAccountGetFullList = vi.fn();
const mockPrivilegedAccountCreate = vi.fn();
const mockPrivilegedAccountUpdate = vi.fn();
const mockKnowledgeStateGetList = vi.fn();
const mockKnowledgeStateCreate = vi.fn();
const mockKnowledgeStateUpdate = vi.fn();
const mockBatchCreate = vi.fn();
const mockBatchSend = vi.fn();
const mockSettingsGetAll = vi.fn();
const mockSettingsUpdate = vi.fn();
const mockCreateBatch = vi.fn(() => ({
  collection: () => ({ create: mockBatchCreate }),
  send: mockBatchSend,
}));

const mockPbCollection = vi.fn((name: string) => {
  if (name === 'relay_privileged_state') {
    return {
      getList: mockPrivilegedStateGetList,
      getFullList: mockPrivilegedStateGetFullList,
      create: mockPrivilegedStateCreate,
      update: mockPrivilegedStateUpdate,
    };
  }
  if (name === 'relay_privileged_accounts') {
    return {
      getList: mockPrivilegedAccountGetList,
      getFullList: mockPrivilegedAccountGetFullList,
      create: mockPrivilegedAccountCreate,
      update: mockPrivilegedAccountUpdate,
    };
  }
  if (name === 'knowledge_library_state') {
    return {
      getList: mockKnowledgeStateGetList,
      create: mockKnowledgeStateCreate,
      update: mockKnowledgeStateUpdate,
    };
  }
  return {
    getFullList: mockCollectionGetFullList,
    getList: mockCollectionGetList,
    create: mockCollectionCreate,
    update: mockCollectionUpdate,
    delete: mockCollectionDelete,
  };
});

const mockPb = {
  collections: {
    getFullList: mockGetFullList,
    create: mockCreate,
    delete: mockDelete,
    getOne: mockGetOne,
    update: mockUpdate,
  },
  settings: {
    getAll: mockSettingsGetAll,
    update: mockSettingsUpdate,
  },
  collection: mockPbCollection,
  createBatch: mockCreateBatch,
  backups: { create: mockBackupCreate },
} as never;

import {
  ensureCollections,
  ensureKnowledgeSearchCollections,
  ensurePocketBaseAuthRateLimit,
} from '../CollectionBootstrap';

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations, so collection-level stubs have to be
  // reset explicitly or a fixture leaks into the next test.
  mockGetFullList.mockReset();
  mockBackupCreate.mockReset().mockResolvedValue(undefined);
  mockGetOne.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockCollectionGetList.mockReset();
  mockCollectionGetFullList.mockReset();
  mockCollectionCreate.mockReset();
  mockPrivilegedStateGetList.mockReset();
  mockPrivilegedStateGetFullList.mockReset();
  mockPrivilegedStateCreate.mockReset();
  mockPrivilegedStateUpdate.mockReset();
  mockPrivilegedAccountGetList.mockReset();
  mockPrivilegedAccountGetFullList.mockReset();
  mockPrivilegedAccountCreate.mockReset();
  mockPrivilegedAccountUpdate.mockReset();
  mockKnowledgeStateGetList.mockReset();
  mockKnowledgeStateCreate.mockReset();
  mockKnowledgeStateUpdate.mockReset();
  mockCollectionGetList.mockResolvedValue({
    totalItems: 1,
    items: [{ id: 'custom', displayName: 'Custom Operator', active: true }],
  });
  mockCollectionGetFullList.mockResolvedValue([]);
  mockCollectionCreate.mockImplementation(async (record: { displayName?: string }) => ({
    id: record.displayName
      ? `operator-${record.displayName.toLocaleLowerCase('en').replace(/[^a-z]+/g, '-')}`
      : 'record-created',
    ...record,
  }));
  mockPrivilegedStateGetList.mockResolvedValue({
    totalItems: 1,
    items: [
      {
        id: 'privileged-state',
        key: 'primary',
        adminOperatorId: 'operator-ryan-bledsoe',
        adminOperatorIds: ['operator-ryan-bledsoe', 'operator-charles-gibbs'],
        publisherOperatorId: null,
        assignmentVersion: 1,
        rosterMigrationVersion: 2,
      },
    ],
  });
  mockPrivilegedStateGetFullList.mockResolvedValue([]);
  mockPrivilegedStateCreate.mockImplementation(async (record: Record<string, unknown>) => ({
    id: 'privileged-state',
    ...record,
  }));
  mockPrivilegedStateUpdate.mockResolvedValue({});
  mockPrivilegedAccountGetList.mockResolvedValue({
    totalItems: 1,
    items: [{ id: 'admin-account', operatorId: 'operator-ryan-bledsoe', role: 'admin' }],
  });
  mockPrivilegedAccountGetFullList.mockResolvedValue([]);
  mockPrivilegedAccountCreate.mockImplementation(async (record: Record<string, unknown>) => ({
    id: `account-${String(record.username ?? 'legacy')}`,
    ...record,
  }));
  mockPrivilegedAccountUpdate.mockResolvedValue({});
  mockKnowledgeStateGetList.mockResolvedValue({
    totalItems: 1,
    items: [{ id: 'knowledge-state', key: 'primary', mode: 'managed', revision: 1 }],
  });
  mockKnowledgeStateCreate.mockResolvedValue({});
  mockKnowledgeStateUpdate.mockResolvedValue({});
  mockBatchSend.mockResolvedValue([]);
  mockSettingsGetAll.mockResolvedValue({
    meta: { appName: 'Relay' },
    logs: { maxDays: 5 },
    batch: { enabled: false, maxRequests: 50, timeout: 9, maxBodySize: 4_096 },
  });
  mockSettingsUpdate.mockResolvedValue({});
});

function mockSuccessfulCollectionCreation(): void {
  mockCreate.mockImplementation(async (value: { name: string }) => ({
    id: `${value.name}-collection-id`,
    name: value.name,
  }));
}

describe('ensurePocketBaseAuthRateLimit', () => {
  it('enables the auth limiter and adds the exact privileged reauthentication route limit', async () => {
    const authRule = {
      label: '*:auth',
      audience: '',
      duration: 3,
      maxRequests: 2,
    };
    const fileRule = {
      label: '*:file',
      audience: '',
      duration: 1,
      maxRequests: 8,
    };
    const privilegedReauthenticationRule = {
      label: 'POST /api/relay/privileged/reauth',
      audience: '@auth',
      duration: 3,
      maxRequests: 2,
    };
    mockSettingsGetAll.mockResolvedValue({
      meta: { appName: 'Relay' },
      batch: { enabled: true, maxRequests: 100, timeout: 9, maxBodySize: 0 },
      rateLimits: {
        enabled: false,
        rules: [authRule, fileRule],
        excludedIPs: ['127.0.0.1'],
      },
    });

    await ensurePocketBaseAuthRateLimit(mockPb);

    expect(mockSettingsUpdate).toHaveBeenCalledOnce();
    expect(mockSettingsUpdate).toHaveBeenCalledWith(
      {
        rateLimits: {
          enabled: true,
          rules: [authRule, fileRule, privilegedReauthenticationRule],
          excludedIPs: ['127.0.0.1'],
        },
      },
      { requestKey: null },
    );
    expect(mockSettingsUpdate.mock.calls[0]?.[0]).not.toHaveProperty('batch');
    expect(mockSettingsUpdate.mock.calls[0]?.[0]).not.toHaveProperty('meta');
  });

  it('adds the privileged route rule even when the auth limiter is already enabled', async () => {
    const authRule = { label: '*:auth', audience: '', duration: 60, maxRequests: 1 };
    mockSettingsGetAll.mockResolvedValue({
      rateLimits: {
        enabled: true,
        rules: [authRule],
      },
    });

    await ensurePocketBaseAuthRateLimit(mockPb);

    expect(mockSettingsUpdate).toHaveBeenCalledWith(
      {
        rateLimits: {
          enabled: true,
          rules: [
            authRule,
            {
              label: 'POST /api/relay/privileged/reauth',
              audience: '@auth',
              duration: 3,
              maxRequests: 2,
            },
          ],
        },
      },
      { requestKey: null },
    );
  });

  it('preserves an existing stricter exact privileged route rule', async () => {
    const authRule = { label: '*:auth', audience: '', duration: 60, maxRequests: 1 };
    const routeRule = {
      label: 'POST /api/relay/privileged/reauth',
      audience: '@auth',
      duration: 10,
      maxRequests: 1,
    };
    mockSettingsGetAll.mockResolvedValue({
      rateLimits: {
        enabled: true,
        rules: [authRule, routeRule],
      },
    });

    await ensurePocketBaseAuthRateLimit(mockPb);

    expect(mockSettingsUpdate).not.toHaveBeenCalled();
  });

  it('fails closed when authoritative settings cannot be read', async () => {
    mockSettingsGetAll.mockRejectedValue(new Error('settings unavailable'));

    await expect(ensurePocketBaseAuthRateLimit(mockPb)).rejects.toThrow(
      'Failed to read required PocketBase authentication rate-limit settings',
    );
    expect(mockSettingsUpdate).not.toHaveBeenCalled();
  });

  it('fails closed when the authoritative limiter cannot be enabled', async () => {
    mockSettingsGetAll.mockResolvedValue({
      rateLimits: {
        enabled: false,
        rules: [{ label: '*:auth', audience: '', duration: 3, maxRequests: 2 }],
      },
    });
    mockSettingsUpdate.mockRejectedValue(new Error('settings unavailable'));

    await expect(ensurePocketBaseAuthRateLimit(mockPb)).rejects.toThrow(
      'Failed to enable required PocketBase authentication rate limits',
    );
  });

  it.each([
    undefined,
    null,
    {},
    { enabled: false },
    { enabled: false, rules: [] },
    { enabled: false, rules: [{ label: '*:file', duration: 1, maxRequests: 8 }] },
    { enabled: false, rules: [{ label: '*:auth ' }] },
    { enabled: false, rules: [{ label: '*:auth', duration: 3, maxRequests: 2 }] },
    {
      enabled: false,
      rules: [{ label: '*:auth', audience: '@auth', duration: 3, maxRequests: 2 }],
    },
    {
      enabled: false,
      rules: [{ label: '*:auth', audience: '', duration: 0, maxRequests: 2 }],
    },
    {
      enabled: false,
      rules: [{ label: '*:auth', audience: '', duration: 3, maxRequests: 0 }],
    },
    {
      enabled: true,
      rules: [{ label: '*:auth', audience: '', duration: '3', maxRequests: 2 }],
    },
  ])('fails closed when no exact authoritative auth rule exists: %j', async (rateLimits) => {
    mockSettingsGetAll.mockResolvedValue({ rateLimits });

    await expect(ensurePocketBaseAuthRateLimit(mockPb)).rejects.toThrow(
      'PocketBase has no authoritative authentication rate-limit rule',
    );
    expect(mockSettingsUpdate).not.toHaveBeenCalled();
  });
});

describe('ensureCollections', () => {
  it('reuses complete collection metadata from the bootstrap snapshot', async () => {
    mockGetFullList.mockResolvedValue([
      {
        id: 'contacts-id',
        name: 'contacts',
        fields: [],
        indexes: [],
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.id != ""',
        deleteRule: '@request.auth.id != ""',
      },
    ]);
    mockSuccessfulCollectionCreation();
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockGetFullList).toHaveBeenCalledOnce();
    expect(mockGetOne).not.toHaveBeenCalledWith('contacts-id');
    expect(mockUpdate).toHaveBeenCalledWith('contacts-id', expect.any(Object));
  });

  it('falls back to getOne when bootstrap collection metadata is incomplete', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'contacts-id', name: 'contacts' }]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockResolvedValue({ id: 'contacts-id', fields: [], indexes: [] });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockGetOne).toHaveBeenCalledWith('contacts-id');
  });

  it('enables enough PocketBase batch capacity for Wiki indexing without rewriting unrelated settings', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'documents-id', name: 'knowledge_documents' }]);
    mockGetOne.mockResolvedValue({ fields: [], indexes: [] });
    mockSuccessfulCollectionCreation();
    mockUpdate.mockResolvedValue({});

    await ensureKnowledgeSearchCollections(mockPb);

    expect(mockSettingsUpdate).toHaveBeenCalledOnce();
    expect(mockSettingsUpdate).toHaveBeenCalledWith(
      {
        batch: {
          enabled: true,
          maxRequests: 100,
          timeout: 9,
          maxBodySize: 2 * 1024 * 1024,
        },
      },
      { requestKey: null },
    );
    expect(mockSettingsUpdate.mock.calls[0]?.[0]).not.toHaveProperty('meta');
    expect(mockSettingsUpdate.mock.calls[0]?.[0]).not.toHaveProperty('logs');
  });

  it('skips a redundant batch-settings read when required startup already verified it', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'documents-id', name: 'knowledge_documents' }]);
    mockGetOne.mockResolvedValue({ fields: [], indexes: [] });
    mockSuccessfulCollectionCreation();
    mockUpdate.mockResolvedValue({});

    await ensureKnowledgeSearchCollections(mockPb, { batchApiReady: true });

    expect(mockSettingsGetAll).not.toHaveBeenCalled();
    expect(mockSettingsUpdate).not.toHaveBeenCalled();
    expect(mockGetFullList).toHaveBeenCalledOnce();
  });

  it('repairs an undersized nonzero batch body cap even when batching is already enabled', async () => {
    mockSettingsGetAll.mockResolvedValue({
      batch: { enabled: true, maxRequests: 100, timeout: 3, maxBodySize: 64 * 1024 },
    });
    mockGetFullList.mockResolvedValue([{ id: 'documents-id', name: 'knowledge_documents' }]);
    mockGetOne.mockResolvedValue({ fields: [], indexes: [] });
    mockSuccessfulCollectionCreation();
    mockUpdate.mockResolvedValue({});

    await ensureKnowledgeSearchCollections(mockPb);

    expect(mockSettingsUpdate).toHaveBeenCalledWith(
      {
        batch: {
          enabled: true,
          maxRequests: 100,
          timeout: 3,
          maxBodySize: 2 * 1024 * 1024,
        },
      },
      { requestKey: null },
    );
  });

  it.each([0, 4 * 1024 * 1024])(
    'preserves a safe PocketBase batch body cap of %i bytes',
    async (maxBodySize) => {
      mockSettingsGetAll.mockResolvedValue({
        batch: { enabled: true, maxRequests: 100, timeout: 9, maxBodySize },
      });
      mockGetFullList.mockResolvedValue([{ id: 'documents-id', name: 'knowledge_documents' }]);
      mockGetOne.mockResolvedValue({ fields: [], indexes: [] });
      mockSuccessfulCollectionCreation();
      mockUpdate.mockResolvedValue({});

      await ensureKnowledgeSearchCollections(mockPb);

      expect(mockSettingsUpdate).not.toHaveBeenCalled();
    },
  );

  it('creates optional Wiki search storage with authenticated read rules', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'documents-id', name: 'knowledge_documents' }]);
    mockGetOne.mockResolvedValue({ fields: [], indexes: [] });
    mockSuccessfulCollectionCreation();
    mockUpdate.mockResolvedValue({});

    await ensureKnowledgeSearchCollections(mockPb);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'knowledge_search_chunks',
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: null,
        updateRule: null,
        deleteRule: null,
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      'documents-id',
      expect.objectContaining({
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'searchIndexState' }),
          expect.objectContaining({ name: 'searchIndexChecksum' }),
          expect.objectContaining({ name: 'searchIndexVersion' }),
          expect.objectContaining({ name: 'searchIndexedAt' }),
          expect.objectContaining({ name: 'searchIndexError' }),
        ]),
      }),
    );
  });

  it('patches existing optional Wiki search storage without dropping existing fields', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'documents-id', name: 'knowledge_documents' },
      { id: 'chunks-id', name: 'knowledge_search_chunks' },
    ]);
    mockGetOne
      .mockResolvedValueOnce({
        fields: [{ type: 'text', name: 'sourceKey', required: true, max: 512 }],
        indexes: [],
      })
      .mockResolvedValueOnce({
        fields: [
          { type: 'text', name: 'legacyField', max: 40 },
          {
            type: 'relation',
            name: 'documentId',
            required: true,
            maxSelect: 1,
            cascadeDelete: false,
            collectionId: 'documents-id',
          },
          { type: 'text', name: 'checksum', required: true, max: 64 },
          { type: 'text', name: 'text', required: false, max: 3_200 },
          { type: 'text', name: 'normalizedText', required: false, max: 3_200 },
        ],
        indexes: [],
        listRule: null,
        viewRule: null,
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.id != ""',
        deleteRule: '@request.auth.id != ""',
      });
    mockUpdate.mockResolvedValue({});

    await ensureKnowledgeSearchCollections(mockPb);

    const chunkPatch = mockUpdate.mock.calls.find(([id]) => id === 'chunks-id')?.[1] as {
      fields: Array<Record<string, unknown>>;
      indexes: string[];
      listRule: string | null;
      viewRule: string | null;
      createRule: string | null;
      updateRule: string | null;
      deleteRule: string | null;
    };
    expect(chunkPatch).toMatchObject({
      indexes: [
        'CREATE UNIQUE INDEX idx_knowledge_search_chunk_identity ON knowledge_search_chunks (documentId, checksum, pageNumber, passageNumber, indexVersion)',
        'CREATE INDEX idx_knowledge_search_chunk_document ON knowledge_search_chunks (documentId, checksum, indexVersion)',
      ],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(chunkPatch.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'legacyField', max: 40 }),
        expect.objectContaining({ name: 'documentId', cascadeDelete: true }),
        expect.objectContaining({ name: 'text', required: true, max: 1_600 }),
        expect.objectContaining({ name: 'normalizedText', required: true, max: 1_600 }),
      ]),
    );
  });

  it('keeps optional Wiki search storage outside required collection bootstrap', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'chunks-id', name: 'knowledge_search_chunks' }]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    expect(
      mockCreate.mock.calls.some(
        ([definition]) => (definition as { name?: string }).name === 'knowledge_search_chunks',
      ),
    ).toBe(false);
    expect(mockGetOne).not.toHaveBeenCalledWith('chunks-id');
    expect(mockUpdate).not.toHaveBeenCalledWith('chunks-id', expect.anything());
  });

  it('seeds a managed Knowledge library state on a clean PocketBase server', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();
    mockKnowledgeStateGetList.mockResolvedValue({ totalItems: 0, items: [] });

    await ensureCollections(mockPb);

    expect(mockKnowledgeStateCreate).toHaveBeenCalledWith({
      key: 'primary',
      mode: 'managed',
      transitionedAt: expect.any(String),
      transitionedByOperatorId: '',
      safeError: '',
      revision: 1,
    });
  });

  it('creates managed collections in dependency order while preserving unknown collections', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'custom-archive-id', name: 'custom_archive' }]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    expect(
      mockCreate.mock.calls.map(([definition]) => (definition as { name: string }).name),
    ).toEqual([
      'contacts',
      'servers',
      'oncall',
      'bridge_groups',
      'bridge_history',
      'alert_history',
      'alert_reminders',
      'notes',
      'oncall_dismissals',
      'conflict_log',
      'oncall_board_settings',
      'client_presence',
      'cloud_status_snapshot',
      'cloud_status_mist_snapshot',
      'cloud_status_extension_snapshot',
      'relay_privileged_accounts',
      'relay_privileged_state',
      'relay_privileged_devices',
      'relay_privileged_commands',
      'relay_privileged_pairing_challenges',
      'relay_privileged_pairing_requests',
      'knowledge_categories',
      'knowledge_documents',
      'knowledge_upload_batches',
      'knowledge_uploads',
      'knowledge_upload_chunks',
      'knowledge_audit_events',
      'knowledge_library_state',
      'dynatrace_problems',
      'dynatrace_problem_states',
      'dynatrace_problem_notes',
      'dynatrace_problem_sync',
    ]);
    expect(mockGetOne).not.toHaveBeenCalledWith('custom-archive-id');
    expect(mockUpdate).not.toHaveBeenCalledWith('custom-archive-id', expect.anything());
    expect(mockDelete).not.toHaveBeenCalledWith('custom-archive-id');
  });

  it('leaves unknown collections untouched during startup bootstrap', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'col1', name: 'contacts' },
      { id: 'col2', name: 'oncall_layout' },
      { id: 'col3', name: 'servers' },
    ]);
    mockSuccessfulCollectionCreation();
    mockDelete.mockResolvedValue(undefined);
    mockGetOne.mockResolvedValue({ fields: [] });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockDelete).not.toHaveBeenCalledWith('col2');
  });

  it('leaves an existing standalone_notes collection untouched but unmanaged', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'contacts-col', name: 'contacts' },
      { id: 'standalone-archive-col', name: 'standalone_notes' },
    ]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockResolvedValue({ fields: [] });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockGetOne).not.toHaveBeenCalledWith('standalone-archive-col');
    expect(mockUpdate).not.toHaveBeenCalledWith('standalone-archive-col', expect.anything());
    expect(mockDelete).not.toHaveBeenCalledWith('standalone-archive-col');
    expect(
      mockCreate.mock.calls.some(
        ([definition]) => (definition as { name?: string }).name === 'standalone_notes',
      ),
    ).toBe(false);
  });

  it('skips system collections starting with underscore', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'sys1', name: '_superusers' },
      { id: 'sys2', name: '_pb_users_auth_' },
      { id: 'col1', name: 'contacts' },
    ]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockResolvedValue({ fields: [] });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('skips the users collection', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'u1', name: 'users' },
      { id: 'col1', name: 'contacts' },
    ]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockResolvedValue({ fields: [] });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('creates missing collections including alert reminders and privileged access without operators', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockImplementation(async (value: { name: string }) => ({
      id: `${value.name}-collection-id`,
      name: value.name,
    }));

    await ensureCollections(mockPb);

    expect(mockCreate).toHaveBeenCalledTimes(32);
    expect(
      mockCreate.mock.calls.some(
        (call: unknown[]) => (call[0] as { name: string }).name === 'alert_reminders',
      ),
    ).toBe(true);
    expect(
      mockCreate.mock.calls.some(
        (call: unknown[]) => (call[0] as { name: string }).name === 'client_presence',
      ),
    ).toBe(true);
    expect(
      mockCreate.mock.calls.some(
        (call: unknown[]) => (call[0] as { name: string }).name === 'standalone_notes',
      ),
    ).toBe(false);
    expect(
      mockCreate.mock.calls.some(
        (call: unknown[]) => (call[0] as { name: string }).name === 'relay_operators',
      ),
    ).toBe(false);
    for (const name of [
      'relay_privileged_accounts',
      'relay_privileged_state',
      'relay_privileged_devices',
      'relay_privileged_commands',
      'relay_privileged_pairing_challenges',
      'relay_privileged_pairing_requests',
    ]) {
      expect(
        mockCreate.mock.calls.some(
          (call: unknown[]) => (call[0] as { name: string }).name === name,
        ),
      ).toBe(true);
    }
  });

  it('creates a self-readable password auth collection keyed by normalized username', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const definition = mockCreate.mock.calls.find(
      ([value]) => (value as { name: string }).name === 'relay_privileged_accounts',
    )?.[0] as
      | {
          type: string;
          listRule: string | null;
          viewRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          authRule: string;
          manageRule: string | null;
          passwordAuth: { enabled: boolean; identityFields: string[] };
          fields: Array<Record<string, unknown>>;
          indexes: string[];
        }
      | undefined;

    expect(definition).toMatchObject({
      type: 'auth',
      listRule:
        '@request.auth.collectionName = "relay_privileged_accounts" && id = @request.auth.id',
      viewRule:
        '@request.auth.collectionName = "relay_privileged_accounts" && id = @request.auth.id',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      authRule: 'active = true',
      manageRule: null,
      passwordAuth: { enabled: true, identityFields: ['username'] },
    });
    expect(definition?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'username', type: 'text', required: true }),
        expect.objectContaining({ name: 'displayName', type: 'text', required: true }),
        expect.objectContaining({ name: 'operatorId', type: 'text', required: false }),
        expect.objectContaining({ name: 'role', type: 'select', required: false }),
        expect.objectContaining({
          name: 'storedRole',
          type: 'select',
          values: ['administrator', 'publisher'],
          maxSelect: 1,
        }),
        expect.objectContaining({ name: 'legacyOperatorId', type: 'text', required: false }),
        expect.objectContaining({ name: 'active', type: 'bool' }),
        expect.objectContaining({ name: 'mustChangePassword', type: 'bool' }),
        expect.objectContaining({ name: 'credentialVersion', type: 'number' }),
      ]),
    );
    expect(definition?.fields.some((field) => field.name === 'created')).toBe(false);
    expect(definition?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_relay_privileged_accounts_username_nocase ON relay_privileged_accounts (username COLLATE NOCASE)',
    );
  });

  it('creates public role state with account pointers and an identity migration marker', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const definition = mockCreate.mock.calls.find(
      ([value]) => (value as { name: string }).name === 'relay_privileged_state',
    )?.[0] as
      | {
          listRule: string | null;
          viewRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<Record<string, unknown>>;
          indexes: string[];
        }
      | undefined;

    expect(definition).toMatchObject({
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(definition?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'key', type: 'text', required: true }),
        expect.objectContaining({ name: 'ownerAccountId', type: 'text', required: true }),
        expect.objectContaining({ name: 'publisherAccountId', type: 'text' }),
        expect.objectContaining({ name: 'assignmentVersion', type: 'number', required: true }),
        expect.objectContaining({
          name: 'identityMigrationVersion',
          type: 'number',
          required: true,
        }),
        expect.objectContaining({ name: 'updatedByAccountId', type: 'text' }),
        expect.objectContaining({ name: 'adminOperatorId', type: 'text', required: false }),
        expect.objectContaining({ name: 'publisherOperatorId', type: 'text', required: false }),
      ]),
    );
    expect(definition?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_relay_privileged_state_key ON relay_privileged_state (key)',
    );
  });

  it('patches populated legacy auth collections in compatibility and final phases', async () => {
    const collections = [
      { id: 'accounts-col', name: 'relay_privileged_accounts' },
      { id: 'state-col', name: 'relay_privileged_state' },
      { id: 'operators-col', name: 'relay_operators' },
      {
        id: 'login-roster-view',
        name: 'relay_login_roster',
        type: 'view',
        viewQuery: 'SELECT id, displayName FROM relay_operators WHERE active = TRUE',
      },
    ];
    mockGetFullList.mockResolvedValue(collections);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockImplementation(async (id: string) =>
      id === 'accounts-col'
        ? {
            fields: [
              { type: 'text', name: 'operatorId', required: true, max: 200 },
              {
                type: 'select',
                name: 'role',
                required: true,
                values: ['admin', 'publisher', 'operator'],
                maxSelect: 1,
              },
              { type: 'bool', name: 'active' },
              { type: 'bool', name: 'mustChangePassword' },
              { type: 'number', name: 'credentialVersion' },
            ],
            indexes: [
              'CREATE UNIQUE INDEX idx_relay_privileged_accounts_operator_id ON relay_privileged_accounts (operatorId)',
            ],
            authRule: 'active = true',
            manageRule: null,
            passwordAuth: { enabled: true, identityFields: ['operatorId'] },
          }
        : {
            fields: [
              { type: 'text', name: 'key', required: true, max: 40 },
              { type: 'text', name: 'adminOperatorId', required: true, max: 200 },
              { type: 'json', name: 'adminOperatorIds' },
              { type: 'text', name: 'publisherOperatorId', max: 200 },
              { type: 'number', name: 'assignmentVersion', required: true },
            ],
            indexes: [
              'CREATE UNIQUE INDEX idx_relay_privileged_state_key ON relay_privileged_state (key)',
            ],
            listRule: '@request.auth.id != ""',
            viewRule: '@request.auth.id != ""',
            createRule: null,
            updateRule: null,
            deleteRule: null,
          },
    );
    mockUpdate.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    const accounts = [
      {
        id: 'account-ryan',
        operatorId: 'ryan-op',
        role: 'admin',
        active: true,
        mustChangePassword: false,
        credentialVersion: 5,
      },
      {
        id: 'account-charles',
        operatorId: 'charles-op',
        role: 'admin',
        active: true,
        mustChangePassword: false,
        credentialVersion: 3,
      },
    ];
    const states = [
      {
        id: 'privileged-state',
        key: 'primary',
        adminOperatorId: 'ryan-op',
        adminOperatorIds: ['ryan-op', 'charles-op'],
        publisherOperatorId: '',
        assignmentVersion: 2,
      },
    ];
    mockPrivilegedAccountGetFullList.mockImplementation(async () => structuredClone(accounts));
    mockPrivilegedStateGetFullList.mockImplementation(async () => structuredClone(states));
    mockPrivilegedAccountUpdate.mockImplementation(
      async (id: string, data: Record<string, unknown>) => {
        const account = accounts.find((candidate) => candidate.id === id)!;
        Object.assign(account, data);
        return structuredClone(account);
      },
    );
    mockPrivilegedStateUpdate.mockImplementation(
      async (id: string, data: Record<string, unknown>) => {
        const state = states.find((candidate) => candidate.id === id)!;
        Object.assign(state, data);
        return structuredClone(state);
      },
    );
    mockCollectionGetFullList.mockResolvedValue([
      { id: 'ryan-op', displayName: 'Ryan Bledsoe', active: true },
      { id: 'charles-op', displayName: 'Charles Gibbs', active: true },
    ]);

    await ensureCollections(mockPb);

    const accountSchemaPatches = mockUpdate.mock.calls
      .filter(([id]) => id === 'accounts-col')
      .map(([, update]) => update as Record<string, unknown>);
    expect(accountSchemaPatches).toHaveLength(2);
    expect(accountSchemaPatches[0]).not.toHaveProperty('passwordAuth');
    expect(
      (accountSchemaPatches[0]?.fields as Array<Record<string, unknown>>).find(
        ({ name }) => name === 'username',
      ),
    ).toMatchObject({ required: false });
    expect(
      (accountSchemaPatches[0]?.fields as Array<Record<string, unknown>>).find(
        ({ name }) => name === 'role',
      ),
    ).toMatchObject({ values: ['admin', 'publisher', 'operator'] });
    expect(accountSchemaPatches[1]).toMatchObject({
      passwordAuth: { enabled: true, identityFields: ['username'] },
      indexes: [
        'CREATE UNIQUE INDEX idx_relay_privileged_accounts_username_nocase ON relay_privileged_accounts (username COLLATE NOCASE)',
      ],
    });
    expect(
      (accountSchemaPatches[1]?.fields as Array<Record<string, unknown>>).find(
        ({ name }) => name === 'username',
      ),
    ).toMatchObject({ required: true });
    expect(
      (accountSchemaPatches[1]?.fields as Array<Record<string, unknown>>).find(
        ({ name }) => name === 'operatorId',
      ),
    ).toMatchObject({ required: false });
    expect(
      (accountSchemaPatches[1]?.fields as Array<Record<string, unknown>>).find(
        ({ name }) => name === 'role',
      ),
    ).toMatchObject({ values: ['admin', 'publisher'] });
    expect(mockDelete.mock.calls).toEqual([['login-roster-view'], ['operators-col']]);
  });

  it('re-reads collections it already patched before applying the final definitions', async () => {
    // A real getFullList() response is a complete collection object, so the
    // pre-migration listing satisfies hasCompleteCollectionSnapshot() and the
    // final patch would reuse a snapshot taken before the compatibility phase
    // added fields to the same collections.
    const serverCollections: Record<string, Record<string, unknown>> = {
      'accounts-col': {
        id: 'accounts-col',
        name: 'relay_privileged_accounts',
        type: 'auth',
        fields: [
          { id: 'field_operatorId', type: 'text', name: 'operatorId', required: true, max: 200 },
          {
            id: 'field_role',
            type: 'select',
            name: 'role',
            required: true,
            values: ['admin', 'publisher', 'operator'],
            maxSelect: 1,
          },
          { id: 'field_active', type: 'bool', name: 'active' },
          { id: 'field_mustChangePassword', type: 'bool', name: 'mustChangePassword' },
          { id: 'field_credentialVersion', type: 'number', name: 'credentialVersion' },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_relay_privileged_accounts_operator_id ON relay_privileged_accounts (operatorId)',
        ],
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        authRule: 'active = true',
        manageRule: null,
        passwordAuth: { enabled: true, identityFields: ['operatorId'] },
      },
      'state-col': {
        id: 'state-col',
        name: 'relay_privileged_state',
        type: 'base',
        fields: [
          { id: 'field_key', type: 'text', name: 'key', required: true, max: 40 },
          {
            id: 'field_adminOperatorId',
            type: 'text',
            name: 'adminOperatorId',
            required: true,
            max: 200,
          },
          { id: 'field_adminOperatorIds', type: 'json', name: 'adminOperatorIds' },
          {
            id: 'field_publisherOperatorId',
            type: 'text',
            name: 'publisherOperatorId',
            max: 200,
          },
          {
            id: 'field_assignmentVersion',
            type: 'number',
            name: 'assignmentVersion',
            required: true,
          },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_relay_privileged_state_key ON relay_privileged_state (key)',
        ],
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: null,
        updateRule: null,
        deleteRule: null,
      },
      'operators-col': { id: 'operators-col', name: 'relay_operators' },
      'login-roster-view': {
        id: 'login-roster-view',
        name: 'relay_login_roster',
        type: 'view',
        viewQuery: 'SELECT id, displayName FROM relay_operators WHERE active = TRUE',
      },
    };

    mockGetFullList.mockImplementation(async () =>
      structuredClone(Object.values(serverCollections)),
    );
    mockGetOne.mockImplementation(async (id: string) => structuredClone(serverCollections[id]));
    mockSuccessfulCollectionCreation();
    mockDelete.mockResolvedValue(undefined);
    mockUpdate.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      const collection = serverCollections[id];
      if (!collection) throw new Error(`Unknown collection id in update(): ${id}`);
      const storedFields = collection.fields as Array<Record<string, unknown>>;
      const patchFields = patch.fields as Array<Record<string, unknown>> | undefined;
      if (patchFields) {
        const storedByName = new Map(storedFields.map((field) => [field.name, field]));
        for (const field of patchFields) {
          const stored = storedByName.get(field.name);
          if (stored && field.id !== stored.id) {
            // PocketBase matches fields by id: a same-named field submitted
            // without the stored id drops the column and recreates it empty.
            throw new Error(
              `Field ${String(field.name)} on ${String(collection.name)} would be dropped and recreated`,
            );
          }
        }
        collection.fields = patchFields.map((field) => ({
          ...field,
          id: field.id ?? `field_${String(field.name)}`,
        }));
      }
      for (const [key, value] of Object.entries(patch)) {
        if (key !== 'fields') collection[key] = value;
      }
      return structuredClone(collection);
    });

    const accounts = [
      {
        id: 'account-ryan',
        operatorId: 'ryan-op',
        role: 'admin',
        active: true,
        mustChangePassword: false,
        credentialVersion: 5,
      },
      {
        id: 'account-charles',
        operatorId: 'charles-op',
        role: 'admin',
        active: true,
        mustChangePassword: false,
        credentialVersion: 3,
      },
    ];
    const states = [
      {
        id: 'privileged-state',
        key: 'primary',
        adminOperatorId: 'ryan-op',
        adminOperatorIds: ['ryan-op', 'charles-op'],
        publisherOperatorId: '',
        assignmentVersion: 2,
      },
    ];
    mockPrivilegedAccountGetFullList.mockImplementation(async () => structuredClone(accounts));
    mockPrivilegedStateGetFullList.mockImplementation(async () => structuredClone(states));
    mockPrivilegedAccountUpdate.mockImplementation(
      async (id: string, data: Record<string, unknown>) => {
        const account = accounts.find((candidate) => candidate.id === id)!;
        Object.assign(account, data);
        return structuredClone(account);
      },
    );
    mockPrivilegedStateUpdate.mockImplementation(
      async (id: string, data: Record<string, unknown>) => {
        const state = states.find((candidate) => candidate.id === id)!;
        Object.assign(state, data);
        return structuredClone(state);
      },
    );
    mockCollectionGetFullList.mockResolvedValue([
      { id: 'ryan-op', displayName: 'Ryan Bledsoe', active: true },
      { id: 'charles-op', displayName: 'Charles Gibbs', active: true },
    ]);

    await ensureCollections(mockPb);

    const accountPatches = mockUpdate.mock.calls
      .filter(([id]) => id === 'accounts-col')
      .map(([, patch]) => patch as Record<string, unknown>);
    expect(accountPatches).toHaveLength(2);
    // The username column carries the values the migration just wrote, so the
    // final patch has to address it by the id PocketBase assigned in phase one.
    expect(
      (accountPatches[1]?.fields as Array<Record<string, unknown>>).find(
        ({ name }) => name === 'username',
      ),
    ).toMatchObject({ id: 'field_username', required: true });
    const accountsCollection = serverCollections['accounts-col'];
    if (!accountsCollection) throw new Error('accounts-col missing from server collections');
    expect(
      (accountsCollection.fields as Array<Record<string, unknown>>).find(
        ({ name }) => name === 'username',
      ),
    ).toMatchObject({ id: 'field_username' });

    const statePatches = mockUpdate.mock.calls
      .filter(([id]) => id === 'state-col')
      .map(([, patch]) => patch as Record<string, unknown>);
    expect(
      (statePatches.at(-1)?.fields as Array<Record<string, unknown>>).find(
        ({ name }) => name === 'ownerAccountId',
      ),
    ).toMatchObject({ id: 'field_ownerAccountId', required: true });
  });

  it('snapshots the workspace before converting a legacy roster', async () => {
    // The conversion deletes relay_operators and then patches the columns it just
    // populated. Nothing else backs the database up first: the schedule that calls
    // backupIfDue() only starts after ensureCollections returns.
    mockGetFullList.mockResolvedValue([
      { id: 'roster-col', name: 'relay_operators' },
      { id: 'accounts-col', name: 'relay_privileged_accounts' },
    ]);
    mockCreate.mockResolvedValue({ id: 'created-col' });

    await ensureCollections(mockPb).catch(() => undefined);

    expect(mockBackupCreate).toHaveBeenCalledOnce();
    const [backupName] = mockBackupCreate.mock.lastCall ?? [];
    expect(backupName).toMatch(/^pre_role_migration_/);
  });

  it('refuses to convert a legacy roster it could not back up', async () => {
    // Proceeding without a snapshot would make an irreversible migration
    // unrecoverable, so blocking startup is the lesser harm.
    mockGetFullList.mockResolvedValue([
      { id: 'roster-col', name: 'relay_operators' },
      { id: 'accounts-col', name: 'relay_privileged_accounts' },
    ]);
    mockCreate.mockResolvedValue({ id: 'created-col' });
    mockBackupCreate.mockRejectedValue(new Error('no space left on device'));

    await expect(ensureCollections(mockPb)).rejects.toThrow(/could not back up the workspace/i);

    // The roster is the only record of who the operators were; it must survive.
    expect(mockDelete).not.toHaveBeenCalledWith('roster-col');
    expect(mockCollectionDelete).not.toHaveBeenCalled();
  });

  it('does not snapshot on an install that has no legacy roster', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'contacts-id', name: 'contacts' }]);
    mockCreate.mockResolvedValue({ id: 'created-col' });

    await ensureCollections(mockPb).catch(() => undefined);

    expect(mockBackupCreate).not.toHaveBeenCalled();
  });

  it('does not reapply the compatibility auth identity after the roster is retired', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'accounts-col', name: 'relay_privileged_accounts' },
      { id: 'state-col', name: 'relay_privileged_state' },
    ]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockResolvedValue({ fields: [], indexes: [] });
    mockPrivilegedAccountGetFullList.mockResolvedValue([
      {
        id: 'account-ryan',
        username: 'ryan',
        displayName: 'Ryan Bledsoe',
        storedRole: 'administrator',
      },
      {
        id: 'account-charles',
        username: 'charles',
        displayName: 'Charles Gibbs',
        storedRole: 'administrator',
      },
    ]);
    mockPrivilegedStateGetFullList.mockResolvedValue([
      {
        id: 'privileged-state',
        key: 'primary',
        ownerAccountId: 'account-ryan',
        publisherAccountId: '',
        identityMigrationVersion: 1,
      },
    ]);

    await ensureCollections(mockPb);

    const accountSchemaPatches = mockUpdate.mock.calls
      .filter(([id]) => id === 'accounts-col')
      .map(([, update]) => update as { passwordAuth?: { identityFields: string[] } });
    expect(accountSchemaPatches).not.toContainEqual(
      expect.objectContaining({
        passwordAuth: expect.objectContaining({ identityFields: ['operatorId'] }),
      }),
    );
  });

  it('keeps devices server-hidden and scopes command creation to its active privileged account', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const devices = mockCreate.mock.calls.find(
      ([value]) => (value as { name: string }).name === 'relay_privileged_devices',
    )?.[0] as Record<string, unknown> | undefined;
    const commands = mockCreate.mock.calls.find(
      ([value]) => (value as { name: string }).name === 'relay_privileged_commands',
    )?.[0] as
      | (Record<string, unknown> & {
          fields: Array<Record<string, unknown>>;
          indexes: string[];
        })
      | undefined;

    expect(devices).toMatchObject({
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(commands?.listRule).toContain('@request.auth.collectionName');
    expect(commands?.listRule).toContain('accountId = @request.auth.id');
    expect(commands?.createRule).toContain('state = "pending"');
    expect(commands?.createRule).not.toContain('@request.auth.operatorId');
    expect(commands?.createRule).toContain('deviceId != ""');
    expect(commands?.createRule).toContain('signature != ""');
    expect(commands?.createRule).toContain('@collection.relay_privileged_devices.accountId');
    expect(commands?.createRule).toContain('@collection.relay_privileged_devices.deviceId');
    expect(commands?.createRule).toContain('@collection.relay_privileged_devices.state');
    expect(commands).toMatchObject({ updateRule: null, deleteRule: null });
    expect(commands?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'requestId', type: 'text', required: true, max: 128 }),
        expect.objectContaining({ name: 'deviceId', type: 'text', required: false }),
        expect.objectContaining({ name: 'payload', type: 'json', required: false }),
        expect.objectContaining({ name: 'hasExpectedRevision', type: 'bool' }),
        expect.objectContaining({ name: 'bodyHash', type: 'text', required: true, max: 64 }),
        expect.objectContaining({ name: 'signature', type: 'text', required: false }),
        expect.objectContaining({ name: 'proofConsumedAt', type: 'date' }),
        expect.objectContaining({
          name: 'state',
          type: 'select',
          values: ['pending', 'processing', 'succeeded', 'failed'],
        }),
      ]),
    );
    expect(commands?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_relay_privileged_commands_request_id ON relay_privileged_commands (requestId)',
    );
  });

  it('authorizes fresh role accounts by account ID without a legacy operator ID', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const definitionFor = (name: string) =>
      mockCreate.mock.calls.find(([value]) => (value as { name: string }).name === name)?.[0] as
        | {
            createRule?: string | null;
            listRule?: string | null;
            fields: Array<Record<string, unknown>>;
          }
        | undefined;
    const commands = definitionFor('relay_privileged_commands');
    const pairingRequests = definitionFor('relay_privileged_pairing_requests');
    const uploadBatches = definitionFor('knowledge_upload_batches');
    const uploads = definitionFor('knowledge_uploads');

    for (const definition of [commands, pairingRequests, uploadBatches, uploads]) {
      expect(definition?.fields).toContainEqual(
        expect.objectContaining({ name: 'operatorId', required: false }),
      );
      expect(definition?.listRule ?? '').not.toContain('@request.auth.operatorId');
      expect(definition?.createRule ?? '').not.toContain('@request.auth.operatorId');
    }
    expect(commands?.createRule).toContain('accountId = @request.auth.id');
    expect(pairingRequests?.createRule).toContain('accountId = @request.auth.id');
    expect(uploads?.fields).toContainEqual(
      expect.objectContaining({ name: 'replacementDocumentId', required: false }),
    );
  });

  it('keeps challenge secrets server-hidden and scopes one-time pairing requests to the account', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const challenges = mockCreate.mock.calls.find(
      ([value]) => (value as { name: string }).name === 'relay_privileged_pairing_challenges',
    )?.[0] as (Record<string, unknown> & { fields: Array<Record<string, unknown>> }) | undefined;
    const requests = mockCreate.mock.calls.find(
      ([value]) => (value as { name: string }).name === 'relay_privileged_pairing_requests',
    )?.[0] as (Record<string, unknown> & { fields: Array<Record<string, unknown>> }) | undefined;

    expect(challenges).toMatchObject({
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(challenges?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'attempts', type: 'number', required: false }),
      ]),
    );
    expect(requests?.listRule).toContain('accountId = @request.auth.id');
    expect(requests?.createRule).not.toContain('@request.auth.operatorId');
    expect(requests?.createRule).toContain('state = "pending"');
    expect(requests).toMatchObject({ updateRule: null, deleteRule: null });
    expect(requests?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'challengeId', required: true }),
        expect.objectContaining({ name: 'code', required: true, max: 8 }),
        expect.objectContaining({ name: 'publicKey', type: 'json', required: true }),
        expect.objectContaining({ name: 'result', type: 'json' }),
      ]),
    );
  });

  it('creates a protected server-owned knowledge document collection', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockImplementation(async (value: { name: string }) => ({
      id: `${value.name}-collection-id`,
      name: value.name,
    }));

    await ensureCollections(mockPb);

    const categoriesCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'knowledge_categories',
    )?.[0] as
      | {
          listRule: string | null;
          viewRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<Record<string, unknown>>;
          indexes: string[];
        }
      | undefined;

    expect(categoriesCall).toMatchObject({
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(categoriesCall?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'name', type: 'text', required: true, max: 120 }),
        expect.objectContaining({ name: 'normalizedName', type: 'text', required: true }),
        expect.objectContaining({ name: 'sortOrder', type: 'number', required: true }),
        expect.objectContaining({
          name: 'systemKey',
          type: 'select',
          values: ['uncategorized'],
        }),
        expect.objectContaining({ name: 'revision', type: 'number', required: true }),
      ]),
    );

    const knowledgeCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'knowledge_documents',
    )?.[0] as
      | {
          listRule: string | null;
          viewRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<Record<string, unknown>>;
          indexes: string[];
        }
      | undefined;

    expect(knowledgeCall).toMatchObject({
      listRule: '@request.auth.id != "" && lifecycleState = "active"',
      viewRule: '@request.auth.id != "" && lifecycleState = "active"',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(knowledgeCall?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'sourceKey', type: 'text', required: true, max: 512 }),
        expect.objectContaining({ name: 'category', type: 'text', required: true, max: 120 }),
        expect.objectContaining({
          name: 'categoryId',
          type: 'relation',
          collectionId: 'knowledge_categories-collection-id',
          required: false,
        }),
        expect.objectContaining({
          name: 'documentType',
          type: 'select',
          values: ['sop', 'cheatsheet'],
        }),
        expect.objectContaining({ name: 'title', type: 'text', required: true, max: 240 }),
        expect.objectContaining({ name: 'displayTitle', type: 'text', required: false, max: 240 }),
        expect.objectContaining({
          name: 'lifecycleState',
          type: 'select',
          required: false,
          values: ['active', 'trashed'],
        }),
        expect.objectContaining({ name: 'revision', type: 'number', required: false }),
        expect.objectContaining({ name: 'publishedByAccountId', type: 'text', required: false }),
        expect.objectContaining({ name: 'trashedByAccountId', type: 'text', required: false }),
        expect.objectContaining({ name: 'publishedByOperatorId', type: 'text', required: false }),
        expect.objectContaining({ name: 'trashedByOperatorId', type: 'text', required: false }),
        expect.objectContaining({ name: 'trashedAt', type: 'date' }),
        expect.objectContaining({ name: 'outline', type: 'json' }),
        expect.objectContaining({
          name: 'outlineSource',
          type: 'select',
          values: ['native', 'inferred', 'none'],
          maxSelect: 1,
        }),
        expect.objectContaining({
          name: 'pdf',
          type: 'file',
          required: true,
          maxSelect: 1,
          maxSize: 50 * 1024 * 1024,
          mimeTypes: ['application/pdf'],
          protected: true,
        }),
        expect.objectContaining({
          name: 'cover',
          type: 'file',
          required: false,
          maxSize: 2 * 1024 * 1024,
          mimeTypes: ['image/png'],
          protected: true,
        }),
      ]),
    );
    expect(knowledgeCall?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_knowledge_documents_source_key ON knowledge_documents (sourceKey) WHERE lifecycleState = "active"',
    );
    expect(knowledgeCall?.indexes).toContain(
      'CREATE INDEX idx_knowledge_documents_lifecycle ON knowledge_documents (lifecycleState)',
    );

    const uploadsCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'knowledge_uploads',
    )?.[0] as
      | {
          listRule: string | null;
          viewRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<Record<string, unknown>>;
          indexes: string[];
        }
      | undefined;
    expect(uploadsCall).toMatchObject({
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(uploadsCall?.listRule).toContain(
      '@request.auth.collectionName = "relay_privileged_accounts"',
    );
    expect(uploadsCall?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'requestId', required: true }),
        expect.objectContaining({
          name: 'batchId',
          type: 'relation',
          collectionId: 'knowledge_upload_batches-collection-id',
          required: true,
        }),
        expect.objectContaining({
          name: 'pdf',
          type: 'file',
          required: false,
          protected: true,
          maxSize: 50 * 1024 * 1024,
        }),
        expect.objectContaining({
          name: 'cover',
          type: 'file',
          required: false,
          protected: true,
          maxSize: 2 * 1024 * 1024,
        }),
        expect.objectContaining({
          name: 'proposedCategoryId',
          type: 'relation',
          collectionId: 'knowledge_categories-collection-id',
          required: false,
        }),
        expect.objectContaining({
          name: 'proposedDocumentType',
          type: 'select',
          values: ['sop', 'cheatsheet'],
        }),
        expect.objectContaining({ name: 'chunkSize', type: 'number', required: true }),
        expect.objectContaining({ name: 'chunkCount', type: 'number', required: true }),
        expect.objectContaining({ name: 'lastActivityAt', type: 'date', required: true }),
        expect.objectContaining({ name: 'actorDisplayName', type: 'text', required: false }),
        expect.objectContaining({ name: 'operatorId', type: 'text', required: false }),
        expect.objectContaining({ name: 'operatorName', type: 'text', required: false }),
        expect.objectContaining({ name: 'readyAt', type: 'date' }),
        expect.objectContaining({ name: 'expiresAt', type: 'date', required: true }),
      ]),
    );
    expect(uploadsCall?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_knowledge_uploads_request_id ON knowledge_uploads (requestId)',
    );

    const batchCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'knowledge_upload_batches',
    )?.[0] as
      | {
          listRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<Record<string, unknown>>;
          indexes: string[];
        }
      | undefined;
    expect(batchCall).toMatchObject({ createRule: null, updateRule: null, deleteRule: null });
    expect(batchCall?.listRule).toContain('accountId = @request.auth.id');
    expect(batchCall?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'fileCount', type: 'number', required: true }),
        expect.objectContaining({ name: 'totalBytes', type: 'number', required: true }),
        expect.objectContaining({ name: 'lastActivityAt', type: 'date', required: true }),
        expect.objectContaining({ name: 'actorDisplayName', type: 'text', required: false }),
        expect.objectContaining({ name: 'operatorId', type: 'text', required: false }),
        expect.objectContaining({ name: 'operatorName', type: 'text', required: false }),
        expect.objectContaining({ name: 'revision', type: 'number', required: false }),
      ]),
    );
    expect(batchCall?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_knowledge_upload_batches_active_account ON knowledge_upload_batches (accountId) WHERE state = "active"',
    );

    const chunkCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'knowledge_upload_chunks',
    )?.[0] as
      | {
          listRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<Record<string, unknown>>;
          indexes: string[];
        }
      | undefined;
    expect(chunkCall).toMatchObject({ updateRule: null, deleteRule: null });
    expect(chunkCall?.listRule).toContain('accountId = @request.auth.id');
    expect(chunkCall?.createRule).toContain('@collection.knowledge_uploads.accountId');
    expect(chunkCall?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'uploadId',
          type: 'relation',
          collectionId: 'knowledge_uploads-collection-id',
          required: true,
        }),
        expect.objectContaining({
          name: 'batchId',
          type: 'relation',
          collectionId: 'knowledge_upload_batches-collection-id',
          required: true,
        }),
        expect.objectContaining({
          name: 'chunk',
          type: 'file',
          required: true,
          protected: true,
          maxSize: 4 * 1024 * 1024,
        }),
        expect.objectContaining({ name: 'index', type: 'number', required: false }),
      ]),
    );
    expect(chunkCall?.fields.find((field) => field.name === 'chunk')).not.toHaveProperty(
      'mimeTypes',
    );
    expect(chunkCall?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_knowledge_upload_chunk ON knowledge_upload_chunks (uploadId, `index`)',
    );

    for (const call of mockCreate.mock.calls) {
      for (const field of (call[0] as { fields?: Array<Record<string, unknown>> }).fields ?? []) {
        if (field.type === 'relation') {
          expect(field.collectionId).toMatch(/-collection-id$/);
          expect(field.collectionId).not.toBe('knowledge_uploads');
          expect(field.collectionId).not.toBe('knowledge_upload_batches');
          expect(field).not.toHaveProperty('targetCollectionName');
        }
      }
    }

    for (const collection of ['knowledge_audit_events', 'knowledge_library_state']) {
      const call = mockCreate.mock.calls.find(
        (entry: unknown[]) => (entry[0] as { name: string }).name === collection,
      )?.[0] as { listRule: string | null; createRule: string | null } | undefined;
      expect(call).toMatchObject({ listRule: null, createRule: null });
    }
    const auditCall = mockCreate.mock.calls.find(
      (entry: unknown[]) => (entry[0] as { name: string }).name === 'knowledge_audit_events',
    )?.[0] as { fields: Array<Record<string, unknown>> } | undefined;
    expect(auditCall?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'accountId', type: 'text', required: false }),
        expect.objectContaining({ name: 'actorDisplayName', type: 'text', required: false }),
        expect.objectContaining({ name: 'operatorId', type: 'text', required: false }),
        expect.objectContaining({ name: 'operatorName', type: 'text', required: false }),
      ]),
    );
  });

  it('patches an older upload schema before creating collections whose rules depend on it', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'upload-col-id', name: 'knowledge_uploads' }]);
    mockGetOne.mockImplementation(async (id: string) => ({ id, fields: [], indexes: [] }));
    let uploadSchemaPatched = false;
    mockUpdate.mockImplementation(async (id: string) => {
      if (id === 'upload-col-id') uploadSchemaPatched = true;
      return {};
    });
    mockCreate.mockImplementation(async (value: { name: string }) => {
      if (value.name === 'knowledge_upload_chunks' && !uploadSchemaPatched) {
        throw new Error('chunk rules referenced the legacy upload schema');
      }
      return { id: `${value.name}-collection-id`, name: value.name };
    });

    await expect(ensureCollections(mockPb)).resolves.toEqual({ privilegedRuntimeReady: true });

    expect(uploadSchemaPatched).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'knowledge_upload_chunks' }),
    );
  });

  it('patches existing upload manifests non-destructively with resolved relations and resumable states', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'batch-col-id', name: 'knowledge_upload_batches' },
      { id: 'upload-col-id', name: 'knowledge_uploads' },
      { id: 'chunk-col-id', name: 'knowledge_upload_chunks' },
    ]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockImplementation(async (id: string) => {
      if (id !== 'upload-col-id') return { id, fields: [], indexes: [] };
      return {
        id,
        fields: [
          {
            id: 'pdf-field-id',
            name: 'pdf',
            type: 'file',
            required: true,
            maxSelect: 1,
            maxSize: 50 * 1024 * 1024,
            mimeTypes: ['application/pdf'],
            protected: true,
          },
          {
            id: 'state-field-id',
            name: 'state',
            type: 'select',
            required: true,
            values: [
              'queued',
              'uploading',
              'validating',
              'extracting',
              'ready',
              'failed',
              'published',
            ],
            maxSelect: 1,
          },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_knowledge_uploads_request_id ON knowledge_uploads (requestId)',
        ],
      };
    });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    const uploadPatch = mockUpdate.mock.calls.find(([id]) => id === 'upload-col-id')?.[1] as
      { fields?: Array<Record<string, unknown>> } | undefined;
    expect(uploadPatch?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'pdf-field-id',
          name: 'pdf',
          required: false,
          protected: true,
        }),
        expect.objectContaining({
          id: 'state-field-id',
          name: 'state',
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
        }),
        expect.objectContaining({
          name: 'batchId',
          type: 'relation',
          collectionId: 'batch-col-id',
        }),
        expect.objectContaining({
          name: 'replacementDocumentId',
          type: 'text',
          required: false,
          max: 200,
        }),
      ]),
    );
    expect(uploadPatch?.fields?.find(({ name }) => name === 'pdf')).toHaveProperty(
      'id',
      'pdf-field-id',
    );
  });

  it('replaces the legacy Wiki source-key index instead of submitting two indexes with the same name', async () => {
    const oldIndex =
      'CREATE UNIQUE INDEX idx_knowledge_documents_source_key ON knowledge_documents (sourceKey)';
    const activeOnlyIndex = `${oldIndex} WHERE lifecycleState = "active"`;
    mockGetFullList.mockResolvedValue([{ id: 'documents-col-id', name: 'knowledge_documents' }]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockResolvedValue({ id: 'documents-col-id', fields: [], indexes: [oldIndex] });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    const patch = mockUpdate.mock.calls.find(([id]) => id === 'documents-col-id')?.[1] as
      { indexes?: string[] } | undefined;
    expect(patch?.indexes).toContain(activeOnlyIndex);
    expect(patch?.indexes).not.toContain(oldIndex);
    expect(
      patch?.indexes?.filter((index) => index.includes('idx_knowledge_documents_source_key')),
    ).toHaveLength(1);
  });

  it('does not recreate the retired operator collection', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const operatorsCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'relay_operators',
    )?.[0] as
      | {
          listRule: string | null;
          viewRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<{
            name: string;
            type: string;
            required?: boolean;
            max?: number;
            onCreate?: boolean;
            onUpdate?: boolean;
          }>;
          indexes: string[];
        }
      | undefined;

    expect(operatorsCall).toBeUndefined();
    const privilegedAccountsCall = mockCreate.mock.calls.find(
      ([value]) => (value as { name: string }).name === 'relay_privileged_accounts',
    )?.[0] as { fields: Array<{ name: string }> } | undefined;
    expect(
      privilegedAccountsCall?.fields.filter(({ name }) => name === 'mustChangePassword'),
    ).toHaveLength(1);
  });

  it('seeds pending Ryan and Charles role accounts without an operator roster', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    expect(mockPbCollection).not.toHaveBeenCalledWith('relay_operators');
    expect(mockCollectionGetList).not.toHaveBeenCalled();
    expect(mockCollectionCreate.mock.calls.map(([record]) => record)).toEqual([
      {
        name: 'Uncategorized',
        normalizedName: 'uncategorized',
        sortOrder: 100,
        systemKey: 'uncategorized',
        revision: 1,
      },
    ]);
    expect(mockPrivilegedAccountCreate).toHaveBeenCalledTimes(2);
    for (const username of ['ryan', 'charles']) {
      expect(mockPrivilegedAccountCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          email: `${username}@relay.invalid`,
          username,
          storedRole: 'administrator',
          active: false,
          mustChangePassword: true,
          credentialVersion: 0,
          password: expect.any(String),
          passwordConfirm: expect.any(String),
        }),
      );
    }
    for (const [createdAccount] of mockPrivilegedAccountCreate.mock.calls) {
      const credential = createdAccount as { password: string; passwordConfirm: string };
      expect(credential.password).toBe(credential.passwordConfirm);
      expect(credential.password.length).toBeGreaterThanOrEqual(64);
    }
    expect(mockPrivilegedStateCreate).toHaveBeenCalledWith({
      key: 'primary',
      ownerAccountId: 'account-ryan',
      publisherAccountId: '',
      assignmentVersion: 1,
      identityMigrationVersion: 1,
      updatedByAccountId: '',
    });
    expect(mockCreateBatch).not.toHaveBeenCalled();
  });

  it.each([
    [
      'shared',
      'cloud_status_snapshot',
      'CREATE UNIQUE INDEX idx_cloud_status_snapshot_key ON cloud_status_snapshot (key)',
    ],
    [
      'Mist',
      'cloud_status_mist_snapshot',
      'CREATE UNIQUE INDEX idx_cloud_status_mist_snapshot_key ON cloud_status_mist_snapshot (key)',
    ],
    [
      'extension',
      'cloud_status_extension_snapshot',
      'CREATE UNIQUE INDEX idx_cloud_status_extension_snapshot_key ON cloud_status_extension_snapshot (key)',
    ],
  ])('creates the read-only %s cloud status singleton collection', async (_label, name, index) => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const snapshotCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === name,
    )?.[0] as
      | {
          listRule: string | null;
          viewRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<{ name: string; type: string; required?: boolean }>;
          indexes: string[];
        }
      | undefined;

    expect(snapshotCall).toMatchObject({
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(snapshotCall?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'key', type: 'text', required: true }),
        expect.objectContaining({ name: 'providers', type: 'json', required: true }),
        expect.objectContaining({ name: 'errors', type: 'json', required: false }),
        expect.objectContaining({ name: 'lastUpdated', type: 'number', required: true }),
        expect.objectContaining({ name: 'contentHash', type: 'text', required: true }),
      ]),
    );
    expect(snapshotCall?.indexes).toContain(index);
  });

  it('makes existing cloud status errors optional for healthy snapshots', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'cloud-status-col', name: 'cloud_status_snapshot' }]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockResolvedValue({
      fields: [
        { type: 'text', name: 'key', required: true },
        { type: 'json', name: 'providers', required: true },
        { type: 'json', name: 'errors', required: true },
        { type: 'number', name: 'lastUpdated', required: true },
        { type: 'text', name: 'contentHash', required: true },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_cloud_status_snapshot_key ON cloud_status_snapshot (key)'],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    const update = mockUpdate.mock.calls.find(([id]) => id === 'cloud-status-col');
    expect(update).toBeDefined();
    expect(
      (update?.[1] as { fields: Array<{ name: string; required?: boolean }> }).fields,
    ).toContainEqual(expect.objectContaining({ name: 'errors', required: false }));
  });

  it('creates server-owned Dynatrace problem records and append-only local notes', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const problemsCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'dynatrace_problems',
    )?.[0] as
      | {
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          listRule: string | null;
          fields: Array<{ name: string; type: string }>;
        }
      | undefined;
    const notesCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'dynatrace_problem_notes',
    )?.[0] as
      | {
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<{ name: string; type: string; required?: boolean }>;
        }
      | undefined;
    const statesCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'dynatrace_problem_states',
    )?.[0] as
      | {
          fields: Array<{ name: string; type: string; required?: boolean }>;
        }
      | undefined;
    const syncCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'dynatrace_problem_sync',
    )?.[0] as { fields: Array<{ name: string; type: string }> } | undefined;

    expect(problemsCall).toMatchObject({
      listRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(problemsCall?.fields.some((field) => field.name === 'problemId')).toBe(true);
    expect(problemsCall?.fields.some((field) => field.name === 'alertingProfiles')).toBe(true);
    expect(notesCall).toMatchObject({
      createRule: '@request.auth.id != ""',
      updateRule: null,
      deleteRule: null,
    });
    expect(notesCall?.fields).toContainEqual(
      expect.objectContaining({ name: 'operatorId', type: 'text', required: false }),
    );
    expect(notesCall?.fields).toContainEqual(
      expect.objectContaining({ name: 'author', type: 'text', required: false }),
    );
    expect(statesCall?.fields).toContainEqual(
      expect.objectContaining({ name: 'operatorId', type: 'text', required: false }),
    );
    expect(syncCall?.fields).toContainEqual(
      expect.objectContaining({ name: 'lastReconciledAt', type: 'date' }),
    );
  });

  it('makes legacy Dynatrace attribution fields optional without rebuilding records', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'states-col', name: 'dynatrace_problem_states' },
      { id: 'notes-col', name: 'dynatrace_problem_notes' },
    ]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockImplementation(async (id: string) => ({
      fields:
        id === 'states-col'
          ? [
              { type: 'text', name: 'problemId', required: true },
              { type: 'bool', name: 'addressed' },
              { type: 'date', name: 'addressedAt' },
              { type: 'text', name: 'addressedBy' },
            ]
          : [
              { type: 'text', name: 'problemId', required: true },
              { type: 'text', name: 'note', required: true },
              { type: 'text', name: 'author', required: true },
            ],
      indexes: [],
    }));
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    for (const collectionId of ['states-col', 'notes-col']) {
      const update = mockUpdate.mock.calls.find(([id]) => id === collectionId);
      expect(update).toBeDefined();
      expect((update?.[1] as { fields: Array<{ name: string }> }).fields).toContainEqual(
        expect.objectContaining({ name: 'operatorId' }),
      );
    }
    const notesUpdate = mockUpdate.mock.calls.find(([id]) => id === 'notes-col');
    expect(
      (notesUpdate?.[1] as { fields: Array<{ name: string; required?: boolean }> }).fields,
    ).toContainEqual(expect.objectContaining({ name: 'author', required: false }));
    expect(
      mockCreate.mock.calls.some(
        ([definition]) =>
          (definition as { name: string }).name === 'dynatrace_problem_states' ||
          (definition as { name: string }).name === 'dynatrace_problem_notes',
      ),
    ).toBe(false);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('creates alert_reminders with scheduling and status fields', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const reminderCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'alert_reminders',
    );
    expect(reminderCall).toBeDefined();
    const schema = (
      reminderCall![0] as {
        fields: Array<{
          name: string;
          type: string;
          required?: boolean;
          values?: string[];
          maxSelect?: number;
        }>;
      }
    ).fields;

    expect(schema.find((f) => f.name === 'title')).toMatchObject({
      type: 'text',
      required: true,
    });
    expect(schema.find((f) => f.name === 'dueAt')).toMatchObject({
      type: 'date',
      required: true,
    });
    expect(schema.find((f) => f.name === 'status')).toMatchObject({
      type: 'select',
      required: true,
      values: ['pending', 'done', 'dismissed'],
      maxSelect: 1,
    });
    expect(schema.find((f) => f.name === 'snoozeUntil')).toMatchObject({ type: 'date' });
    expect(schema.find((f) => f.name === 'severity')).toMatchObject({
      type: 'select',
      values: ['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED'],
      maxSelect: 1,
    });
    expect(schema.find((f) => f.name === 'alertBodyHtml')).toMatchObject({ type: 'text' });
    expect(schema.find((f) => f.name === 'operatorId')).toMatchObject({
      type: 'text',
      required: false,
    });
    expect(schema.find((f) => f.name === 'createdBy')).toMatchObject({
      type: 'text',
      required: false,
    });
    expect(schema.find((f) => f.name === 'alertSender')).toMatchObject({ type: 'text' });
  });

  it('patches alert reminder attribution fields onto an existing collection', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'reminders-col', name: 'alert_reminders' }]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockResolvedValue({
      fields: [
        { type: 'text', name: 'title', required: true },
        { type: 'text', name: 'createdBy', required: true },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
      indexes: [],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
    });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    const update = mockUpdate.mock.calls.find(([id]) => id === 'reminders-col');
    expect(update).toBeDefined();
    expect((update?.[1] as { fields: Array<{ name: string; type: string }> }).fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'operatorId', type: 'text' }),
        expect.objectContaining({ name: 'createdBy', type: 'text', required: false }),
        expect.objectContaining({ name: 'alertSender', type: 'text' }),
      ]),
    );
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('includes teamId in the oncall collection schema', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const oncallCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'oncall',
    );
    expect(oncallCall).toBeDefined();
    const oncallSchema = (oncallCall![0] as { fields: Array<{ name: string; type: string }> })
      .fields;
    const teamIdField = oncallSchema.find((f) => f.name === 'teamId');
    expect(teamIdField).toBeDefined();
    expect(teamIdField!.type).toBe('text');
  });

  it('creates oncall_board_settings with correct schema', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const settingsCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'oncall_board_settings',
    );
    expect(settingsCall).toBeDefined();
    const schema = (settingsCall![0] as { fields: Array<{ name: string; type: string }> }).fields;
    const keyField = schema.find((f) => f.name === 'key');
    expect(keyField).toBeDefined();
    expect(keyField!.type).toBe('text');
    const teamOrderField = schema.find((f) => f.name === 'teamOrder');
    expect(teamOrderField).toBeDefined();
    expect(teamOrderField!.type).toBe('json');
    const lockedField = schema.find((f) => f.name === 'locked');
    expect(lockedField).toBeDefined();
    expect(lockedField!.type).toBe('bool');
    expect((settingsCall![0] as { indexes: string[] }).indexes).toContain(
      'CREATE UNIQUE INDEX idx_oncall_board_settings_key ON oncall_board_settings (key)',
    );
  });

  it('creates client_presence with client-only heartbeat fields', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const presenceCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'client_presence',
    );
    expect(presenceCall).toBeDefined();
    const schema = (
      presenceCall![0] as {
        fields: Array<{
          name: string;
          type: string;
          required?: boolean;
          values?: string[];
          maxSelect?: number;
        }>;
        indexes: string[];
      }
    ).fields;

    expect(schema.find((f) => f.name === 'sessionId')).toMatchObject({
      type: 'text',
      required: true,
    });
    expect(schema.find((f) => f.name === 'hostname')).toMatchObject({
      type: 'text',
      required: true,
    });
    expect(schema.find((f) => f.name === 'mode')).toMatchObject({
      type: 'select',
      required: true,
      values: ['client'],
      maxSelect: 1,
    });
    expect(schema.find((f) => f.name === 'lastSeen')).toMatchObject({
      type: 'date',
      required: true,
    });
    expect((presenceCall![0] as { indexes: string[] }).indexes).toContain(
      'CREATE UNIQUE INDEX idx_client_presence_session_id ON client_presence (sessionId)',
    );
  });

  it('repairs duplicate oncall board settings before patching the unique index', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'settings-col', name: 'oncall_board_settings' }]);
    mockCollectionGetFullList.mockResolvedValue([
      {
        id: 'older',
        key: 'primary',
        teamOrder: ['alpha', 'charlie'],
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      },
      {
        id: 'newer',
        key: 'primary',
        teamOrder: ['bravo', 'alpha'],
        created: '2024-01-02T00:00:00Z',
        updated: '2024-01-02T00:00:00Z',
      },
    ]);
    mockCollectionUpdate.mockResolvedValue({});
    mockCollectionDelete.mockResolvedValue(undefined);
    mockGetOne.mockResolvedValue({
      fields: [
        { type: 'text', name: 'key', required: true },
        { type: 'json', name: 'teamOrder' },
        { type: 'bool', name: 'locked' },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
      indexes: [],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
    });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockCollectionUpdate).toHaveBeenCalledWith('newer', {
      teamOrder: ['bravo', 'alpha', 'charlie'],
    });
    expect(mockCollectionDelete).toHaveBeenCalledWith('older');
    expect(mockUpdate).toHaveBeenCalledWith('settings-col', {
      indexes: ['CREATE UNIQUE INDEX idx_oncall_board_settings_key ON oncall_board_settings (key)'],
    });
  });

  it('preserves duplicate oncall board settings when merged order cannot be saved', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'settings-col', name: 'oncall_board_settings' }]);
    mockCollectionGetFullList.mockResolvedValue([
      {
        id: 'older',
        key: 'primary',
        teamOrder: ['alpha'],
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      },
      {
        id: 'newer',
        key: 'primary',
        teamOrder: ['bravo'],
        created: '2024-01-02T00:00:00Z',
        updated: '2024-01-02T00:00:00Z',
      },
    ]);
    mockCollectionUpdate.mockRejectedValueOnce(new Error('merge failed'));
    mockGetOne.mockResolvedValue({
      fields: [
        { type: 'text', name: 'key', required: true },
        { type: 'json', name: 'teamOrder' },
        { type: 'bool', name: 'locked' },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
      indexes: [],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
    });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockCollectionDelete).not.toHaveBeenCalled();
  });

  it('patches existing oncall collection to add missing teamId', async () => {
    // oncall exists but is missing teamId
    mockGetFullList.mockResolvedValue([{ id: 'oc-col', name: 'oncall' }]);
    mockSuccessfulCollectionCreation();
    mockDelete.mockResolvedValue(undefined);
    mockGetOne.mockResolvedValue({
      fields: [
        { type: 'text', name: 'team', required: true },
        { type: 'text', name: 'role' },
        { type: 'text', name: 'name' },
        { type: 'text', name: 'contact' },
        { type: 'text', name: 'timeWindow' },
        { type: 'number', name: 'sortOrder' },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
    });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    // Verify that update was called on the oncall collection to add teamId
    expect(mockUpdate).toHaveBeenCalled();
    const updateCall = mockUpdate.mock.calls.find((call: unknown[]) => call[0] === 'oc-col');
    expect(updateCall).toBeDefined();
    const updatedFields = (updateCall![1] as { fields: Array<{ name: string }> }).fields;
    const teamIdField = updatedFields.find((f) => f.name === 'teamId');
    expect(teamIdField).toBeDefined();
  });

  it('patches authenticated API rules on existing collections', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'contacts-col', name: 'contacts' }]);
    mockSuccessfulCollectionCreation();
    mockDelete.mockResolvedValue(undefined);
    mockGetOne.mockResolvedValue({
      fields: [
        { type: 'text', name: 'name', required: true },
        { type: 'text', name: 'email' },
        { type: 'text', name: 'phone' },
        { type: 'text', name: 'title' },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    const updateCall = mockUpdate.mock.calls.find((call: unknown[]) => call[0] === 'contacts-col');
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toMatchObject({
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
    });
  });

  it('rejects when required collections cannot be listed', async () => {
    mockGetFullList.mockRejectedValue(new Error('list unavailable'));

    await expect(ensureCollections(mockPb)).rejects.toThrow(
      'Failed to list PocketBase collections',
    );
  });

  it('rejects when a required missing collection cannot be created', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockRejectedValueOnce(new Error('create denied'));

    await expect(ensureCollections(mockPb)).rejects.toThrow(
      'Failed to create collection: contacts',
    );
  });

  it('rejects when an existing required collection cannot be patched', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'contacts-col', name: 'contacts' }]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockResolvedValue({
      fields: [{ type: 'text', name: 'name', required: true }],
    });
    mockUpdate.mockRejectedValueOnce(new Error('patch denied'));

    await expect(ensureCollections(mockPb)).rejects.toThrow('Failed to patch collection: contacts');
  });
});
