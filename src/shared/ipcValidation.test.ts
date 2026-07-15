import { describe, it, expect } from 'vitest';
import {
  SearchQuerySchema,
  LogEntrySchema,
  AlertHistoryEntrySchema,
  KnowledgePdfRequestSchema,
  PrivilegedLoginSchema,
  PrivilegedPairingCompletionSchema,
  PrivilegedReauthenticationSchema,
  PublicPrivilegedCommandRequestSchema,
} from './ipcValidation';

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

describe('privileged IPC schemas', () => {
  const password = 'Test-access-value-123!';

  it('accepts bounded login and reauthentication inputs without trimming passwords', () => {
    expect(
      PrivilegedLoginSchema.parse({ operatorId: 'operator-admin', password: ` ${password} ` }),
    ).toEqual({ operatorId: 'operator-admin', password: ` ${password} ` });
    expect(PrivilegedReauthenticationSchema.parse({ password })).toEqual({ password });
  });

  it.each([
    { operatorId: '', password },
    { operatorId: 'operator-admin', password: 'short' },
    { operatorId: 'operator-admin', password: 'x'.repeat(129) },
    { operatorId: 'operator-admin', password, token: 'unexpected' },
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

  it('allows only public status commands and rejects internal reauthentication construction', () => {
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
  });
});
