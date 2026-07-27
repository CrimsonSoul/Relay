import { describe, expect, it } from 'vitest';
import { redactSensitiveData } from './logRedaction';

// Test fixtures — intentionally fake values for verifying redaction logic
const TEST_FIXTURES = {
  fakeToken: 'abc',
  fakePass: `${'secret'}-${'pass'}`,
  fakeApiKey: 'key-123',
  fakeAuth: 'Bearer 123',
  fakeSecret: `${'dont'}-${'log'}`,
};

describe('redactSensitiveData', () => {
  const makeCliPassphraseFixture = () => ['relay', 'fixture', 'value', 'not-log'].join('-');

  it('redacts sensitive keys recursively', () => {
    const input = {
      token: TEST_FIXTURES.fakeToken,
      nested: {
        password: TEST_FIXTURES.fakePass,
        profile: {
          apiKey: TEST_FIXTURES.fakeApiKey,
          name: 'Alice',
        },
      },
      arr: [{ authorization: TEST_FIXTURES.fakeAuth }, { ok: true }],
    };

    const redacted = redactSensitiveData(input) as Record<string, unknown>;

    expect(redacted.token).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).password).toBe('[REDACTED]');
    expect(
      ((redacted.nested as Record<string, unknown>).profile as Record<string, unknown>).apiKey,
    ).toBe('[REDACTED]');
    expect((redacted.arr as Array<Record<string, unknown>>)[0]?.authorization).toBe('[REDACTED]');
    expect((redacted.arr as Array<Record<string, unknown>>)[1]?.ok).toBe(true);
  });

  it('handles circular references safely', () => {
    const circular: Record<string, unknown> = { secret: TEST_FIXTURES.fakeSecret };
    circular.self = circular;

    const redacted = redactSensitiveData(circular) as Record<string, unknown>;
    expect(redacted.secret).toBe('[REDACTED]');
    expect(redacted.self).toBe('[Circular]');
  });

  it('converts Date objects to ISO strings', () => {
    const date = new Date('2024-01-15T12:00:00.000Z');
    const input = { timestamp: date };
    const redacted = redactSensitiveData(input) as Record<string, unknown>;
    expect(redacted.timestamp).toBe('2024-01-15T12:00:00.000Z');
  });

  it('converts Error objects to name/message/stack shape', () => {
    const err = new Error('Something went wrong');
    const input = { error: err };
    const redacted = redactSensitiveData(input) as Record<string, unknown>;
    const redactedErr = redacted.error as Record<string, unknown>;
    expect(redactedErr.name).toBe('Error');
    expect(redactedErr.message).toBe('Something went wrong');
  });

  it('redacts PocketBase superuser CLI passphrases embedded in error strings', () => {
    const cliSecret = makeCliPassphraseFixture();
    const error = new Error(
      `Command failed: pocketbase superuser upsert admin@relay.app ${cliSecret} --dir=/tmp/pb`,
    );
    const input = { error };

    const redacted = redactSensitiveData(input) as Record<string, unknown>;
    const redactedErr = redacted.error as Record<string, unknown>;

    expect(redactedErr.message).not.toContain(cliSecret);
    expect(redactedErr.stack).not.toContain(cliSecret);
    expect(redactedErr.message).toContain('[REDACTED]');
  });

  it('does not retain flag-like or multiline passphrase suffixes from PocketBase errors', () => {
    const visibleSuffix = ['visible', 'suffix'].join('-');
    const multilineSuffix = ['second', 'secret', 'line'].join('-');
    const cliSecret = `x --${visibleSuffix}\n${multilineSuffix}`;
    const error = new Error(
      `Command failed: pocketbase superuser upsert admin@relay.app ${cliSecret} --dir=/tmp/pb`,
    );

    const redacted = redactSensitiveData({ error }) as Record<string, unknown>;
    const redactedErr = redacted.error as Record<string, string>;

    expect(redactedErr.message).not.toContain(cliSecret);
    expect(redactedErr.message).not.toContain(visibleSuffix);
    expect(redactedErr.message).not.toContain(multilineSuffix);
    expect(redactedErr.stack).not.toContain(visibleSuffix);
    expect(redactedErr.stack).not.toContain(multilineSuffix);
    expect(redactedErr.message).toContain('[REDACTED]');
  });

  it('passes null through unchanged', () => {
    expect(redactSensitiveData(null)).toBeNull();
  });

  it('passes undefined through unchanged', () => {
    expect(redactSensitiveData(undefined)).toBeUndefined();
  });

  it('passes string primitives through unchanged', () => {
    expect(redactSensitiveData('hello')).toBe('hello');
  });

  it('passes number primitives through unchanged', () => {
    expect(redactSensitiveData(42)).toBe(42);
  });

  it('handles arrays at the top level', () => {
    const input = [{ token: 'abc' }, { name: 'Bob' }];
    const redacted = redactSensitiveData(input) as Array<Record<string, unknown>>;
    expect(redacted).toHaveLength(2);
    const [firstEntry, secondEntry] = redacted;
    // Both entries exist: the length is asserted immediately above.
    expect(firstEntry!.token).toBe('[REDACTED]');
    expect(secondEntry!.name).toBe('Bob');
  });

  it('redacts api-key and api_key patterns', () => {
    const input = { 'api-key': 'val1', api_key: 'val2' };
    const redacted = redactSensitiveData(input) as Record<string, unknown>;
    expect(redacted['api-key']).toBe('[REDACTED]');
    expect(redacted['api_key']).toBe('[REDACTED]');
  });

  it('redacts cookie keys', () => {
    const input = { cookie: 'session=abc' };
    const redacted = redactSensitiveData(input) as Record<string, unknown>;
    expect(redacted.cookie).toBe('[REDACTED]');
  });

  it('redacts secret keys', () => {
    const input = { clientSecret: 'xyz' };
    const redacted = redactSensitiveData(input) as Record<string, unknown>;
    expect(redacted.clientSecret).toBe('[REDACTED]');
  });

  it('redacts short country-code email addresses in log strings', () => {
    const redacted = redactSensitiveData({ message: 'Contact a@b.co for help.' }) as Record<
      string,
      unknown
    >;

    expect(redacted.message).toBe('Contact [REDACTED_EMAIL] for help.');
  });

  it('redacts email addresses with modern long top-level domains in log strings', () => {
    const redacted = redactSensitiveData({
      message: 'Contact deployment@relay.technology for help.',
    }) as Record<string, unknown>;

    expect(redacted.message).toBe('Contact [REDACTED_EMAIL] for help.');
  });

  it('redacts multiple punctuated email addresses independently in log strings', () => {
    const redacted = redactSensitiveData({
      message: 'Primary (ops@relay.io), backup support@help.dev; thank you.',
    }) as Record<string, unknown>;

    expect(redacted.message).toBe(
      'Primary ([REDACTED_EMAIL]), backup [REDACTED_EMAIL]; thank you.',
    );
  });

  it('leaves a 20,000-character non-matching log string unchanged', () => {
    const message = 'x'.repeat(20_000);
    const redacted = redactSensitiveData({ message }) as Record<string, unknown>;

    expect(redacted.message).toBe(message);
  });

  it('processes a long non-matching email candidate with bounded regex work', () => {
    const message = 'a'.repeat(100_000);
    const startedAt = performance.now();
    const redacted = redactSensitiveData({ message }) as Record<string, unknown>;
    const elapsedMs = performance.now() - startedAt;

    expect(redacted.message).toBe(message);
    expect(elapsedMs).toBeLessThan(500);
  });
});
