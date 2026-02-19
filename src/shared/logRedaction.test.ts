import { describe, expect, it } from 'vitest';
import { redactSensitiveData } from './logRedaction';

describe('redactSensitiveData', () => {
  it('redacts sensitive keys recursively', () => {
    const input = {
      token: 'abc',
      nested: {
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
    expect((redacted.arr as Array<Record<string, unknown>>)[0].authorization).toBe('[REDACTED]');
    expect((redacted.arr as Array<Record<string, unknown>>)[1].ok).toBe(true);
  });

  it('handles circular references safely', () => {
    const circular: Record<string, unknown> = { secret: 'dont-log' };
    circular.self = circular;

    const redacted = redactSensitiveData(circular) as Record<string, unknown>;
    expect(redacted.secret).toBe('[REDACTED]');
    expect(redacted.self).toBe('[Circular]');
  });
});
