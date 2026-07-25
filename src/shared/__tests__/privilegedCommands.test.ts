import { describe, expect, it } from 'vitest';
import {
  MAX_PRIVILEGED_COMMAND_BYTES,
  PRIVILEGED_COMMAND_MAX_CLOCK_SKEW_MS,
  PRIVILEGED_COMMAND_MAX_LIFETIME_MS,
  canonicalPrivilegedSigningBytes,
  canonicalizePrivilegedValue,
  getRelayAdministrationSettingValueError,
  isPrivilegedSha256,
  isPublicPrivilegedCommandName,
  normalizePrivilegedCommandPayload,
  validateSignedPrivilegedCommandEnvelope,
  type SignedPrivilegedCommandEnvelope,
} from '../privilegedCommands';

const NOW = Date.parse('2026-07-15T20:00:00.000Z');

function makeEnvelope(
  overrides: Partial<SignedPrivilegedCommandEnvelope<'privileged.status.read'>> = {},
): SignedPrivilegedCommandEnvelope<'privileged.status.read'> {
  return {
    version: 1,
    requestId: 'request-123',
    accountId: 'account-123',
    deviceId: 'device-123',
    roleClaim: 'admin',
    displayNameSnapshot: 'Ryan Bledsoe',
    command: 'privileged.status.read',
    payload: { clientVersion: '1.0.0' },
    payloadHash: 'a'.repeat(64),
    expectedRevision: null,
    issuedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + PRIVILEGED_COMMAND_MAX_LIFETIME_MS).toISOString(),
    signature: 'A'.repeat(86),
    ...overrides,
  };
}

describe('privileged command canonicalization', () => {
  it('sorts object keys recursively while preserving array order', () => {
    expect(
      canonicalizePrivilegedValue({
        z: 1,
        nested: { beta: true, alpha: 'value' },
        list: [{ y: 2, x: 1 }, 'second'],
      }),
    ).toBe('{"list":[{"x":1,"y":2},"second"],"nested":{"alpha":"value","beta":true},"z":1}');
  });

  it('produces the same UTF-8 signing bytes for equivalent objects', () => {
    const first = makeEnvelope({ payload: { clientVersion: '1.0.0' } });
    const second = {
      ...makeEnvelope(),
      payload: Object.fromEntries([['clientVersion', '1.0.0']]),
    } as SignedPrivilegedCommandEnvelope<'privileged.status.read'>;

    expect(canonicalPrivilegedSigningBytes(first)).toEqual(canonicalPrivilegedSigningBytes(second));
    expect(new TextDecoder().decode(canonicalPrivilegedSigningBytes(first))).not.toContain(
      'signature',
    );
  });

  it('rejects undefined, non-finite, and excessively nested values', () => {
    expect(() => canonicalizePrivilegedValue({ value: undefined })).toThrow(/unsupported/i);
    expect(() => canonicalizePrivilegedValue(Number.POSITIVE_INFINITY)).toThrow(/finite/i);

    let nested: unknown = 'end';
    for (let index = 0; index < 20; index += 1) nested = { nested };
    expect(() => canonicalizePrivilegedValue(nested)).toThrow(/nested/i);
  });
});

describe('privileged command validation', () => {
  it('accepts a strict current signed envelope', () => {
    expect(validateSignedPrivilegedCommandEnvelope(makeEnvelope(), NOW)).toEqual({
      ok: true,
      envelope: makeEnvelope(),
    });
  });

  it('rejects expired, overlong, and far-future envelopes', () => {
    expect(
      validateSignedPrivilegedCommandEnvelope(
        makeEnvelope({ expiresAt: new Date(NOW - 1).toISOString() }),
        NOW,
      ),
    ).toEqual({ ok: false, error: 'expired' });
    expect(
      validateSignedPrivilegedCommandEnvelope(
        makeEnvelope({
          expiresAt: new Date(NOW + PRIVILEGED_COMMAND_MAX_LIFETIME_MS + 1).toISOString(),
        }),
        NOW,
      ),
    ).toEqual({ ok: false, error: 'invalid-request' });
    expect(
      validateSignedPrivilegedCommandEnvelope(
        makeEnvelope({
          issuedAt: new Date(NOW + PRIVILEGED_COMMAND_MAX_CLOCK_SKEW_MS + 1).toISOString(),
          expiresAt: new Date(
            NOW + PRIVILEGED_COMMAND_MAX_CLOCK_SKEW_MS + PRIVILEGED_COMMAND_MAX_LIFETIME_MS,
          ).toISOString(),
        }),
        NOW,
      ),
    ).toEqual({ ok: false, error: 'invalid-request' });
  });

  it('rejects malformed hashes, request IDs, payloads, and unknown keys', () => {
    expect(isPrivilegedSha256('a'.repeat(64))).toBe(true);
    expect(isPrivilegedSha256('A'.repeat(64))).toBe(false);

    expect(
      validateSignedPrivilegedCommandEnvelope(makeEnvelope({ payloadHash: 'A'.repeat(64) }), NOW),
    ).toEqual({ ok: false, error: 'invalid-request' });
    expect(
      validateSignedPrivilegedCommandEnvelope(makeEnvelope({ requestId: 'x'.repeat(129) }), NOW),
    ).toEqual({ ok: false, error: 'invalid-request' });
    expect(
      validateSignedPrivilegedCommandEnvelope(
        makeEnvelope({ payload: { clientVersion: '' } }),
        NOW,
      ),
    ).toEqual({ ok: false, error: 'invalid-request' });
    expect(
      validateSignedPrivilegedCommandEnvelope({ ...makeEnvelope(), unknown: true }, NOW),
    ).toEqual({ ok: false, error: 'invalid-request' });
  });

  it('keeps internal reauthentication commands out of the public command surface', () => {
    expect(isPublicPrivilegedCommandName('privileged.status.read')).toBe(true);
    expect(isPublicPrivilegedCommandName('administration.snapshot.read')).toBe(true);
    expect(isPublicPrivilegedCommandName('account.admin.create')).toBe(true);
    expect(isPublicPrivilegedCommandName('account.publisher.create')).toBe(true);
    expect(isPublicPrivilegedCommandName('ownership.transfer')).toBe(true);
    expect(isPublicPrivilegedCommandName('operator.create')).toBe(false);
    expect(isPublicPrivilegedCommandName('publisher.assign')).toBe(true);
    expect(isPublicPrivilegedCommandName('administration.setting.replace')).toBe(true);
    expect(isPublicPrivilegedCommandName('knowledge.upload.batch.begin')).toBe(true);
    expect(isPublicPrivilegedCommandName('knowledge.upload.file.begin')).toBe(true);
    expect(isPublicPrivilegedCommandName('knowledge.upload.status')).toBe(true);
    expect(isPublicPrivilegedCommandName('knowledge.upload.file.finalize')).toBe(true);
    expect(isPublicPrivilegedCommandName('knowledge.upload.file.cancel')).toBe(true);
    expect(isPublicPrivilegedCommandName('knowledge.upload.batch.cancel')).toBe(true);
    expect(isPublicPrivilegedCommandName('knowledge.category.create')).toBe(true);
    expect(isPublicPrivilegedCommandName('knowledge.category.name.set')).toBe(true);
    expect(isPublicPrivilegedCommandName('knowledge.category.order.set')).toBe(true);
    expect(isPublicPrivilegedCommandName('knowledge.category.delete')).toBe(true);
    expect(isPublicPrivilegedCommandName('knowledge.document.metadata.set')).toBe(true);
    expect(isPublicPrivilegedCommandName('knowledge.documents.category.assign')).toBe(true);
    expect(isPublicPrivilegedCommandName('knowledge.document.search-index.retry')).toBe(true);
    expect(isPublicPrivilegedCommandName('privileged.reauth.confirm')).toBe(false);
  });

  it('normalizes search-index retry with an exact bounded document identifier payload', () => {
    expect(
      normalizePrivilegedCommandPayload('knowledge.document.search-index.retry', {
        documentId: 'document_1',
      }),
    ).toEqual({ documentId: 'document_1' });
    expect(
      normalizePrivilegedCommandPayload('knowledge.document.search-index.retry', {
        documentId: 'document_1',
        expectedRevision: 2,
      }),
    ).toBeNull();
    expect(
      normalizePrivilegedCommandPayload('knowledge.document.search-index.retry', {
        documentId: '',
      }),
    ).toBeNull();
    expect(
      normalizePrivilegedCommandPayload('knowledge.document.search-index.retry', {}),
    ).toBeNull();
    expect(
      normalizePrivilegedCommandPayload('knowledge.document.search-index.retry', {
        documentId: 42,
      }),
    ).toBeNull();
    expect(
      normalizePrivilegedCommandPayload('knowledge.document.search-index.retry', {
        documentId: 'document with spaces',
      }),
    ).toBeNull();
    expect(
      normalizePrivilegedCommandPayload('knowledge.document.search-index.retry', {
        documentId: 'x'.repeat(201),
      }),
    ).toBeNull();
  });

  it('normalizes stable category and document metadata commands', () => {
    expect(
      normalizePrivilegedCommandPayload('knowledge.document.publish', {
        uploadId: 'upload_1',
        title: ' Network Quick Guide ',
        category: ' Network ',
        documentType: 'cheatsheet',
      }),
    ).toEqual({
      uploadId: 'upload_1',
      title: 'Network Quick Guide',
      category: 'Network',
      documentType: 'cheatsheet',
    });
    expect(
      normalizePrivilegedCommandPayload('knowledge.document.publish', {
        uploadId: 'upload_1',
        title: 'Network Quick Guide',
        category: 'Network',
        documentType: 'reference',
      }),
    ).toBeNull();
    expect(
      normalizePrivilegedCommandPayload('knowledge.category.create', {
        name: '  Access   and Identity ',
        afterCategoryId: null,
      }),
    ).toEqual({ name: 'Access and Identity', afterCategoryId: null });
    expect(
      normalizePrivilegedCommandPayload('knowledge.category.name.set', {
        categoryId: 'cat_access',
        name: ' Access ',
        expectedRevision: 2,
      }),
    ).toEqual({ categoryId: 'cat_access', name: 'Access', expectedRevision: 2 });
    expect(
      normalizePrivilegedCommandPayload('knowledge.category.order.set', {
        orderedCategoryIds: ['cat_access', 'cat_network'],
        expectedRevisions: { cat_access: 2, cat_network: 4 },
      }),
    ).toEqual({
      orderedCategoryIds: ['cat_access', 'cat_network'],
      expectedRevisions: { cat_access: 2, cat_network: 4 },
    });
    expect(
      normalizePrivilegedCommandPayload('knowledge.category.delete', {
        categoryId: 'cat_network',
        replacementCategoryId: 'cat_access',
        expectedRevision: 4,
        expectedDocumentRevisions: { doc_1: 3 },
      }),
    ).toEqual({
      categoryId: 'cat_network',
      replacementCategoryId: 'cat_access',
      expectedRevision: 4,
      expectedDocumentRevisions: { doc_1: 3 },
    });
    expect(
      normalizePrivilegedCommandPayload('knowledge.document.metadata.set', {
        documentId: 'doc_1',
        title: ' Oracle SOP ',
        categoryId: 'cat_access',
        documentType: 'sop',
        expectedRevision: 3,
      }),
    ).toEqual({
      documentId: 'doc_1',
      title: 'Oracle SOP',
      categoryId: 'cat_access',
      documentType: 'sop',
      expectedRevision: 3,
    });
    expect(
      normalizePrivilegedCommandPayload('knowledge.documents.category.assign', {
        categoryId: 'cat_access',
        documents: [{ documentId: 'doc_1', expectedRevision: 3 }],
      }),
    ).toEqual({
      categoryId: 'cat_access',
      documents: [{ documentId: 'doc_1', expectedRevision: 3 }],
    });
  });

  it('rejects unsafe category and document metadata commands', () => {
    expect(
      normalizePrivilegedCommandPayload('knowledge.category.order.set', {
        orderedCategoryIds: ['cat_access', 'cat_access'],
        expectedRevisions: { cat_access: 2 },
      }),
    ).toBeNull();
    expect(
      normalizePrivilegedCommandPayload('knowledge.category.delete', {
        categoryId: 'cat_access',
        replacementCategoryId: 'cat_access',
        expectedRevision: 2,
        expectedDocumentRevisions: {},
      }),
    ).toBeNull();
    expect(
      normalizePrivilegedCommandPayload('knowledge.document.metadata.set', {
        documentId: 'doc_1',
        title: 'Oracle SOP',
        categoryId: 'cat_access',
        documentType: 'reference',
        expectedRevision: 3,
      }),
    ).toBeNull();
    expect(
      normalizePrivilegedCommandPayload('knowledge.documents.category.assign', {
        categoryId: 'cat_access',
        documents: Array.from({ length: 101 }, (_, index) => ({
          documentId: `doc_${index}`,
          expectedRevision: 1,
        })),
      }),
    ).toBeNull();
  });

  it('keeps replacement payloads limited to the upload and stable document identity', () => {
    expect(
      normalizePrivilegedCommandPayload('knowledge.document.replace', {
        uploadId: 'upload_1',
        documentId: 'doc_1',
        expectedRevision: 3,
      }),
    ).toEqual({
      uploadId: 'upload_1',
      documentId: 'doc_1',
      expectedRevision: 3,
    });
    expect(
      normalizePrivilegedCommandPayload('knowledge.document.replace', {
        uploadId: 'upload_1',
        documentId: 'doc_1',
        expectedRevision: 3,
        title: 'Replacement title',
        category: 'Replacement category',
      }),
    ).toBeNull();
  });

  it('normalizes every resumable upload command with exact bounded payloads', () => {
    expect(
      normalizePrivilegedCommandPayload('knowledge.upload.batch.begin', {
        requestId: 'upload-request-1',
        fileCount: 100,
        totalBytes: 100 * 50 * 1024 * 1024,
      }),
    ).toEqual({
      requestId: 'upload-request-1',
      fileCount: 100,
      totalBytes: 100 * 50 * 1024 * 1024,
    });
    expect(
      normalizePrivilegedCommandPayload('knowledge.upload.file.begin', {
        batchId: 'batch1',
        fileName: '  Checkout   Runbook.pdf ',
        byteSize: 50 * 1024 * 1024,
        checksum: 'a'.repeat(64),
        chunkCount: 13,
      }),
    ).toEqual({
      batchId: 'batch1',
      fileName: 'Checkout Runbook.pdf',
      byteSize: 50 * 1024 * 1024,
      checksum: 'a'.repeat(64),
      chunkCount: 13,
    });
    expect(
      normalizePrivilegedCommandPayload('knowledge.upload.file.begin', {
        batchId: 'batch1',
        fileName: 'Replacement.pdf',
        byteSize: 5,
        checksum: 'a'.repeat(64),
        chunkCount: 1,
        replacementDocumentId: 'document-1',
      }),
    ).toEqual({
      batchId: 'batch1',
      fileName: 'Replacement.pdf',
      byteSize: 5,
      checksum: 'a'.repeat(64),
      chunkCount: 1,
      replacementDocumentId: 'document-1',
    });
    expect(
      normalizePrivilegedCommandPayload('knowledge.upload.status', { batchId: 'batch1' }),
    ).toEqual({
      batchId: 'batch1',
    });
    for (const command of [
      'knowledge.upload.file.finalize',
      'knowledge.upload.file.cancel',
    ] as const) {
      expect(
        normalizePrivilegedCommandPayload(command, { uploadId: 'upload1', expectedRevision: 2 }),
      ).toEqual({ uploadId: 'upload1', expectedRevision: 2 });
    }
    expect(
      normalizePrivilegedCommandPayload('knowledge.upload.batch.cancel', {
        batchId: 'batch1',
        expectedRevision: 3,
      }),
    ).toEqual({ batchId: 'batch1', expectedRevision: 3 });
  });

  it('accepts a maximum-length Knowledge PDF filename measured in Unicode code points', () => {
    const fileName = `${'a'.repeat(235)}😀.pdf`;

    expect(
      normalizePrivilegedCommandPayload('knowledge.upload.file.begin', {
        batchId: 'batch1',
        fileName,
        byteSize: 5,
        checksum: 'a'.repeat(64),
        chunkCount: 1,
      }),
    ).toEqual({
      batchId: 'batch1',
      fileName,
      byteSize: 5,
      checksum: 'a'.repeat(64),
      chunkCount: 1,
    });
  });

  it('rejects unsafe or inconsistent resumable upload payloads', () => {
    const validFile = {
      batchId: 'batch1',
      fileName: 'Runbook.pdf',
      byteSize: 4 * 1024 * 1024 + 1,
      checksum: 'a'.repeat(64),
      chunkCount: 2,
    };
    expect(
      normalizePrivilegedCommandPayload('knowledge.upload.file.begin', {
        ...validFile,
        fileName: '../Runbook.pdf',
      }),
    ).toBeNull();
    expect(
      normalizePrivilegedCommandPayload('knowledge.upload.file.begin', {
        ...validFile,
        fileName: 'Runbook\u0000.pdf',
      }),
    ).toBeNull();
    expect(
      normalizePrivilegedCommandPayload('knowledge.upload.file.begin', {
        ...validFile,
        checksum: 'A'.repeat(64),
      }),
    ).toBeNull();
    expect(
      normalizePrivilegedCommandPayload('knowledge.upload.file.begin', {
        ...validFile,
        chunkCount: 1,
      }),
    ).toBeNull();
    expect(
      normalizePrivilegedCommandPayload('knowledge.upload.file.begin', {
        ...validFile,
        localSourcePath: '/private/runbook.pdf',
      }),
    ).toBeNull();
  });

  it.each([
    ['administration.snapshot.read', {}],
    [
      'account.admin.create',
      { username: ' JANE.OPERATOR ', displayName: '  Jane   Operator ', expectedStateRevision: 2 },
    ],
    [
      'account.publisher.create',
      { username: 'publisher', displayName: ' Knowledge Publisher ', expectedStateRevision: 2 },
    ],
    [
      'account.display-name.update',
      { accountId: 'account-2', displayName: 'Jane Operator', expectedRevision: 3 },
    ],
    ['account.active.set', { accountId: 'account-2', active: false, expectedRevision: 3 }],
    [
      'ownership.transfer',
      { accountId: 'account-2', expectedStateRevision: 4, reauthRequestId: 'reauth-owner' },
    ],
    [
      'publisher.assign',
      { accountId: 'account-2', expectedStateRevision: 4, reauthRequestId: 'reauth-1' },
    ],
    [
      'privileged.device.rename',
      { deviceId: 'device-2', label: ' Work laptop ', expectedRevision: 2 },
    ],
    [
      'privileged.device.revoke',
      { deviceId: 'device-2', expectedRevision: 2, reauthRequestId: 'reauth-1' },
    ],
    [
      'administration.setting.replace',
      {
        setting: 'dynatrace.environment-url',
        value: { environmentUrl: 'https://abc123.apps.dynatrace.com' },
        expectedRevision: 1,
      },
    ],
    [
      'administration.setting.replace',
      {
        setting: 'dynatrace.platform-token',
        value: { apiToken: 'dt0s16.example-token' },
        expectedRevision: 1,
        reauthRequestId: 'reauth-1',
      },
    ],
    [
      'administration.setting.replace',
      {
        setting: 'dynatrace.alerting-profiles',
        value: { profiles: ['NOC Core', 'Payments'] },
        expectedRevision: 1,
      },
    ],
  ] as const)('strictly accepts the %s payload', (command, payload) => {
    const result = validateSignedPrivilegedCommandEnvelope(
      { ...makeEnvelope(), command, payload } as SignedPrivilegedCommandEnvelope,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok && command === 'account.admin.create') {
      expect(result.envelope.payload).toEqual({
        username: 'jane.operator',
        displayName: 'Jane Operator',
        expectedStateRevision: 2,
      });
    }
    if (result.ok && command === 'privileged.device.rename') {
      expect(result.envelope.payload).toEqual({
        deviceId: 'device-2',
        label: 'Work laptop',
        expectedRevision: 2,
      });
    }
  });

  it.each([
    ['administration.snapshot.read', { unexpected: true }],
    ['account.admin.create', { username: 'x', displayName: '', expectedStateRevision: 2 }],
    [
      'account.display-name.update',
      { accountId: 'account-2', displayName: 'Jane', expectedRevision: -1 },
    ],
    ['account.active.set', { accountId: 'account-2', active: 'false', expectedRevision: 3 }],
    ['publisher.assign', { accountId: 'account-2', expectedStateRevision: 4, reauthRequestId: '' }],
    [
      'privileged.device.rename',
      { deviceId: 'device-2', label: 'x'.repeat(81), expectedRevision: 2 },
    ],
    [
      'administration.setting.replace',
      {
        setting: 'backup.destination',
        value: { path: '/private/company' },
        expectedRevision: 1,
      },
    ],
    [
      'administration.setting.replace',
      {
        setting: 'dynatrace.environment-url',
        value: { environmentUrl: 'http://example.com', token: 'leak' },
        expectedRevision: 1,
      },
    ],
  ] as const)('rejects malformed or unsupported %s payloads', (command, payload) => {
    expect(
      validateSignedPrivilegedCommandEnvelope(
        { ...makeEnvelope(), command, payload } as SignedPrivilegedCommandEnvelope,
        NOW,
      ),
    ).toEqual({ ok: false, error: 'invalid-request' });
  });

  it('validates only the explicit setting value map', () => {
    expect(
      getRelayAdministrationSettingValueError('dynatrace.environment-url', {
        environmentUrl: 'https://abc123.apps.dynatrace.com',
      }),
    ).toBeNull();
    expect(
      getRelayAdministrationSettingValueError('dynatrace.platform-token', {
        apiToken: 'dt0s16.example-token',
      }),
    ).toBeNull();
    expect(
      getRelayAdministrationSettingValueError('dynatrace.platform-token', {
        apiToken: 'dt0s16.example-token',
        environmentUrl: 'https://abc123.apps.dynatrace.com',
      }),
    ).toBeNull();
    expect(
      getRelayAdministrationSettingValueError('dynatrace.alerting-profiles', {
        profiles: ['NOC Core'],
      }),
    ).toBeNull();
    expect(
      getRelayAdministrationSettingValueError('dynatrace.alerting-profiles', {
        profiles: ['NOC Core', 'NOC Core'],
      }),
    ).toMatch(/duplicate/i);
  });

  it('publishes the approved command size bound', () => {
    expect(MAX_PRIVILEGED_COMMAND_BYTES).toBe(64 * 1024);
  });
});
