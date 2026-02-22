import { describe, expect, it } from 'vitest';
import { redactSensitiveData } from './logRedaction';

describe('redactSensitiveData', () => {
  it('redacts sensitive keys recursively', () => {
    const input = {
      token: 'abc',
      nested: {
        // eslint-disable-next-line sonarjs/no-hardcoded-passwords
        password: 'secret-pass',
        profile: {
          apiKey: 'key-123',
          name: 'Alice',
        },
      },
      arr: [{ authorization: 'Bearer 123' }, { ok: true }],
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
    const circular: Record<string, unknown> = { secret: 'dont-log' };
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
    expect(redacted[0].token).toBe('[REDACTED]');
    expect(redacted[1].name).toBe('Bob');
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
});
