import { describe, it, expect } from 'vitest';
import {
  SearchQuerySchema,
  LogEntrySchema,
  AlertHistoryEntrySchema,
  KnowledgeUploadControlIdSchema,
  KnowledgePdfDownloadRequestSchema,
  KnowledgePdfRequestSchema,
  KnowledgeCoverRequestSchema,
  KnowledgeSearchRequestSchema,
  KnowledgeSearchRequestIdSchema,
  PrivilegedLoginSchema,
  PrivilegedInitialOwnerSetupSchema,
  PrivilegedCredentialSetupSchema,
  PrivilegedPairingTargetAccountSchema,
  PrivilegedPairingCompletionSchema,
  PrivilegedReauthenticationSchema,
  PublicPrivilegedCommandRequestSchema,
  TabNameSchema,
  DataCategorySchema,
  ExportOptionsSchema,
  ServerWebConfigSchema,
} from './ipcValidation';
import { IPC_CHANNELS } from './ipc';

describe('retired roster IPC', () => {
  it('does not publish roster channels', () => {
    const retiredPrefix = ['relay', 'Operator:'].join('');

    expect(Object.values(IPC_CHANNELS).some((channel) => channel.startsWith(retiredPrefix))).toBe(
      false,
    );
  });
});

describe('TabNameSchema', () => {
  it('accepts only current outer navigation tabs', () => {
    expect(TabNameSchema.safeParse('Knowledge').success).toBe(true);
    expect(TabNameSchema.safeParse('Compose').success).toBe(true);
  });

  it.each(['People', 'Servers', 'Notes'])('rejects removed top-level tab %s', (tab) => {
    expect(TabNameSchema.safeParse(tab).success).toBe(false);
  });
});

describe('ServerWebConfigSchema', () => {
  it('accepts a bounded explicit web listener configuration', () => {
    expect(ServerWebConfigSchema.parse({ enabled: true, port: 8091 })).toEqual({
      enabled: true,
      port: 8091,
    });
  });

  it.each([
    { enabled: true, port: 80 },
    { enabled: true, port: 65536 },
    { enabled: 'yes', port: 8091 },
    { enabled: true, port: 8091, host: 'public.example.com' },
  ])('rejects unsafe web listener config %o', (config) => {
    expect(ServerWebConfigSchema.safeParse(config).success).toBe(false);
  });
});

describe('standalone notes retirement', () => {
  it('rejects standalone_notes as a Data Manager category', () => {
    expect(DataCategorySchema.safeParse('standalone_notes').success).toBe(false);
  });

  it('rejects standalone_notes export requests', () => {
    expect(
      ExportOptionsSchema.safeParse({ format: 'json', category: 'standalone_notes' }).success,
    ).toBe(false);
  });
});

describe('SearchQuerySchema', () => {
  it('accepts valid queries', () => {
    expect(SearchQuerySchema.safeParse('New York').success).toBe(true);
    expect(SearchQuerySchema.safeParse('London, UK').success).toBe(true);
    expect(SearchQuerySchema.safeParse('12345').success).toBe(true);
  });

  it('rejects empty strings', () => {
    expect(SearchQuerySchema.safeParse('').success).toBe(false);
  });

  it('rejects extremely long strings', () => {
    expect(SearchQuerySchema.safeParse('a'.repeat(201)).success).toBe(false);
  });

  it('rejects queries with forbidden characters', () => {
    expect(SearchQuerySchema.safeParse('<script>').success).toBe(false);
    expect(SearchQuerySchema.safeParse('{json: true}').success).toBe(false);
  });
});

describe('LogEntrySchema', () => {
  it('accepts valid log entries', () => {
    const valid = {
      level: 'INFO',
      module: 'App',
      message: 'Test message',
      data: { key: 'value' },
    };
    expect(LogEntrySchema.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid log levels', () => {
    expect(
      LogEntrySchema.safeParse({ level: 'VERBOSE', module: 'App', message: 'm' }).success,
    ).toBe(false);
  });

  it('rejects messages over 5000 chars', () => {
    expect(
      LogEntrySchema.safeParse({ level: 'INFO', module: 'App', message: 'a'.repeat(5001) }).success,
    ).toBe(false);
  });

  it('rejects modules over 100 chars', () => {
    expect(
      LogEntrySchema.safeParse({ level: 'INFO', module: 'a'.repeat(101), message: 'm' }).success,
    ).toBe(false);
  });
});

describe('AlertHistoryEntrySchema', () => {
  it('accepts alert body HTML with an embedded compressed image', () => {
    const image = 'data:image/jpeg;base64,' + 'a'.repeat(180000);
    const result = AlertHistoryEntrySchema.safeParse({
      severity: 'INFO',
      subject: 'Dashboard snapshot',
      bodyHtml: `<p><img src="${image}" alt="Dashboard" class="alert-body-image"></p>`,
      sender: 'NOC',
      recipient: 'All Employees',
    });

    expect(result.success).toBe(true);
  });
});

describe('KnowledgePdfRequestSchema', () => {
  const valid = { documentId: 'abc123DEF456', checksum: 'a'.repeat(64) };

  it('accepts a PocketBase document ID and lowercase SHA-256 checksum', () => {
    expect(KnowledgePdfRequestSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    { ...valid, documentId: '../secret' },
    { ...valid, documentId: 'has spaces' },
    { ...valid, documentId: 'a'.repeat(201) },
    { ...valid, checksum: 'A'.repeat(64) },
    { ...valid, checksum: 'a'.repeat(63) },
    { ...valid, checksum: '../'.padEnd(64, 'a') },
  ])('rejects malformed knowledge PDF requests: %o', (request) => {
    expect(KnowledgePdfRequestSchema.safeParse(request).success).toBe(false);
  });

  it('rejects unexpected request fields', () => {
    expect(
      KnowledgePdfRequestSchema.safeParse({ ...valid, path: 'outside-source-root' }).success,
    ).toBe(false);
  });
});

describe('KnowledgePdfDownloadRequestSchema', () => {
  const valid = {
    documentId: 'abc123DEF456',
    checksum: 'a'.repeat(64),
    fileName: 'Authored Operator Guide.pdf',
  };

  it('accepts the authored PDF filename alongside the verified document identity', () => {
    expect(KnowledgePdfDownloadRequestSchema.parse(valid)).toEqual(valid);
  });

  it.each(['Ops: East.pdf', 'Shift*Recovery.pdf', '.Hidden guide.pdf', '....pdf'])(
    'accepts an existing upload-compatible authored filename: %s',
    (fileName) => {
      expect(KnowledgePdfDownloadRequestSchema.safeParse({ ...valid, fileName }).success).toBe(
        true,
      );
    },
  );

  it.each([
    { ...valid, fileName: '../secret.pdf' },
    { ...valid, fileName: 'C:\\secret.pdf' },
    { ...valid, fileName: 'Guide.txt' },
    { ...valid, fileName: `Guide\u0000.pdf` },
    { ...valid, fileName: `${'a'.repeat(241)}.pdf` },
    { ...valid, path: '/renderer/controlled/path.pdf' },
  ])('rejects unsafe or non-PDF download requests: %o', (request) => {
    expect(KnowledgePdfDownloadRequestSchema.safeParse(request).success).toBe(false);
  });
});

describe('KnowledgeCoverRequestSchema', () => {
  it('accepts only a strict document id and lowercase checksum', () => {
    const valid = { documentId: 'abc123', checksum: 'b'.repeat(64) };
    expect(KnowledgeCoverRequestSchema.parse(valid)).toEqual(valid);
    expect(
      KnowledgeCoverRequestSchema.safeParse({ ...valid, documentId: '../escape' }).success,
    ).toBe(false);
    expect(KnowledgeCoverRequestSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });
});

describe('KnowledgeUploadControlIdSchema', () => {
  it('accepts bounded local, batch, and upload identifiers', () => {
    expect(KnowledgeUploadControlIdSchema.parse('batch-request_1')).toBe('batch-request_1');
  });

  it.each(['', '../source.pdf', 'a'.repeat(201), { id: 'upload-1' }])(
    'rejects unsafe upload control identifiers: %o',
    (value) => {
      expect(KnowledgeUploadControlIdSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('KnowledgeSearchRequestSchema', () => {
  const valid = {
    requestId: 'search-request_1',
    query: '  ＲＦ failover  ',
    scope: { kind: 'all' as const },
    categoryId: null,
    documentType: null,
    limit: 20,
  };

  it('strictly parses a bounded global request and normalizes query and limit', () => {
    expect(KnowledgeSearchRequestSchema.parse(valid)).toEqual({
      ...valid,
      query: 'rf failover',
    });
  });

  it('accepts a strict document scope and caps its limit at fifty', () => {
    expect(
      KnowledgeSearchRequestSchema.parse({
        ...valid,
        scope: { kind: 'document', documentId: 'document-1' },
        categoryId: 'operations',
        documentType: 'sop',
        limit: 500,
      }),
    ).toMatchObject({ scope: { kind: 'document', documentId: 'document-1' }, limit: 50 });
  });

  it.each([
    { ...valid, requestId: '../escape' },
    { ...valid, requestId: 'a'.repeat(201) },
    { ...valid, query: '😀'.repeat(121) },
    { ...valid, query: '\uFDFA'.repeat(8) },
    { ...valid, query: 'the and of' },
    { ...valid, scope: { kind: 'document', documentId: '../escape' } },
    { ...valid, scope: { kind: 'all', documentId: 'unexpected' } },
    { ...valid, categoryId: '../escape' },
    { ...valid, documentType: 'pdf' },
    { ...valid, limit: 0 },
    { ...valid, filter: 'title ~ "secret"' },
  ])('rejects malformed or renderer-controlled search payloads: %o', (value) => {
    expect(KnowledgeSearchRequestSchema.safeParse(value).success).toBe(false);
  });

  it('shares the bounded identifier contract for cancellation', () => {
    expect(KnowledgeSearchRequestIdSchema.parse('search-request_1')).toBe('search-request_1');
    expect(KnowledgeSearchRequestIdSchema.safeParse('../escape').success).toBe(false);
  });
});

describe('privileged IPC schemas', () => {
  // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate fake credential exercises password schema preservation and bounds.
  const password = 'Test-access-value-123!';

  it('accepts bounded login and reauthentication inputs without trimming passwords', () => {
    expect(
      PrivilegedLoginSchema.parse({ username: '  Ryan.Admin ', password: ` ${password} ` }),
    ).toEqual({ username: 'ryan.admin', password: ` ${password} ` });
    expect(PrivilegedReauthenticationSchema.parse({ password })).toEqual({ password });
  });

  it('normalizes first-Owner usernames without exposing account IDs or changing passwords', () => {
    expect(
      PrivilegedInitialOwnerSetupSchema.parse({
        username: '  Ryan ',
        password: ` ${password} `,
        passwordConfirm: ` ${password} `,
      }),
    ).toEqual({
      username: 'ryan',
      password: ` ${password} `,
      passwordConfirm: ` ${password} `,
    });
    expect(
      PrivilegedInitialOwnerSetupSchema.safeParse({
        accountId: 'account-ryan',
        password,
        passwordConfirm: password,
      }).success,
    ).toBe(false);
    expect(
      PrivilegedInitialOwnerSetupSchema.safeParse({
        username: 'Ryan Owner',
        password,
        passwordConfirm: password,
      }).success,
    ).toBe(false);
    expect(
      PrivilegedInitialOwnerSetupSchema.safeParse({
        username: 'ryan',
        password,
        passwordConfirm: `${password}-different`,
      }).success,
    ).toBe(false);
    expect(
      PrivilegedInitialOwnerSetupSchema.safeParse({
        username: 'ryan',
        password,
        passwordConfirm: password,
        remote: true,
      }).success,
    ).toBe(false);
  });

  it('strictly validates local credential setup and preserves password bytes', () => {
    expect(
      PrivilegedCredentialSetupSchema.parse({
        accountId: 'account-admin',
        password: ` ${password} `,
        passwordConfirm: ` ${password} `,
      }),
    ).toEqual({
      accountId: 'account-admin',
      password: ` ${password} `,
      passwordConfirm: ` ${password} `,
    });
    expect(
      PrivilegedCredentialSetupSchema.safeParse({
        accountId: 'account-admin',
        password,
        passwordConfirm: `${password}-different`,
      }).success,
    ).toBe(false);
    expect(
      PrivilegedCredentialSetupSchema.safeParse({
        accountId: 'account-admin',
        password,
        passwordConfirm: password,
        remote: true,
      }).success,
    ).toBe(false);
    expect(
      PrivilegedCredentialSetupSchema.safeParse({
        operatorId: 'operator-admin',
        password,
        passwordConfirm: password,
      }).success,
    ).toBe(false);
  });

  it.each([
    { username: '', password },
    { username: 'ryan', password: 'short' },
    { username: 'ryan', password: 'x'.repeat(129) },
    { username: 'ryan admin', password },
    { username: 'ryan', password, token: 'unexpected' },
    { operatorId: 'operator-admin', password },
  ])('rejects malformed or unknown login fields: %o', (input) => {
    expect(PrivilegedLoginSchema.safeParse(input).success).toBe(false);
  });

  it('strictly validates pairing completion input', () => {
    const valid = {
      challengeId: 'challenge-1',
      code: 'ABCD2345',
      deviceLabel: 'Ryan work laptop',
    };
    expect(PrivilegedPairingCompletionSchema.parse(valid)).toEqual(valid);
    expect(
      PrivilegedPairingCompletionSchema.safeParse({ ...valid, code: 'TOO-SHORT' }).success,
    ).toBe(false);
    expect(
      PrivilegedPairingCompletionSchema.safeParse({ ...valid, hostname: 'spoofed' }).success,
    ).toBe(false);
  });

  it('accepts only bounded privileged account IDs for pairing targets', () => {
    expect(PrivilegedPairingTargetAccountSchema.parse('account-publisher')).toBe(
      'account-publisher',
    );
    expect(PrivilegedPairingTargetAccountSchema.safeParse('../publisher').success).toBe(false);
    expect(PrivilegedPairingTargetAccountSchema.safeParse('a'.repeat(201)).success).toBe(false);
    expect(
      PrivilegedPairingTargetAccountSchema.safeParse({ accountId: 'account-admin' }).success,
    ).toBe(false);
  });

  it('allows strict public commands and rejects internal reauthentication construction', () => {
    expect(
      PublicPrivilegedCommandRequestSchema.parse({
        command: 'privileged.status.read',
        payload: { clientVersion: '1.0.0' },
        expectedRevision: null,
      }),
    ).toEqual({
      command: 'privileged.status.read',
      payload: { clientVersion: '1.0.0' },
      expectedRevision: null,
    });
    expect(
      PublicPrivilegedCommandRequestSchema.safeParse({
        command: 'privileged.reauth.confirm',
        payload: { authenticatedAt: new Date().toISOString() },
        expectedRevision: null,
      }).success,
    ).toBe(false);
    expect(
      PublicPrivilegedCommandRequestSchema.safeParse({
        command: ['operator', 'rename'].join('.'),
        payload: { accountId: 'account-2', displayName: 'Morgan Lee', expectedRevision: 3 },
        expectedRevision: null,
      }).success,
    ).toBe(false);
    expect(
      PublicPrivilegedCommandRequestSchema.safeParse({
        command: 'administration.snapshot.read',
        payload: { revealSecrets: true },
        expectedRevision: null,
      }).success,
    ).toBe(false);
    expect(
      PublicPrivilegedCommandRequestSchema.parse({
        command: 'knowledge.upload.file.begin',
        payload: {
          batchId: 'batch-1',
          fileName: 'Runbook.pdf',
          byteSize: 4 * 1024 * 1024,
          checksum: 'a'.repeat(64),
          chunkCount: 1,
        },
        expectedRevision: null,
      }),
    ).toMatchObject({
      command: 'knowledge.upload.file.begin',
      payload: { fileName: 'Runbook.pdf', chunkCount: 1 },
    });
    expect(
      PublicPrivilegedCommandRequestSchema.safeParse({
        command: 'knowledge.upload.file.begin',
        payload: {
          batchId: 'batch-1',
          fileName: '../Runbook.pdf',
          byteSize: 1,
          checksum: 'a'.repeat(64),
          chunkCount: 1,
        },
        expectedRevision: null,
      }).success,
    ).toBe(false);
  });
});
