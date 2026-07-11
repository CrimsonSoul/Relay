import { describe, expect, it } from 'vitest';
import {
  getDynatraceApiTokenError,
  getDynatraceEnvironmentUrlError,
  normalizeDynatraceEnvironmentUrl,
} from './dynatraceProblems';

describe('Dynatrace Problems validation', () => {
  it('accepts and normalizes a Dynatrace SaaS environment origin', () => {
    expect(getDynatraceEnvironmentUrlError('https://abc123.apps.dynatrace.com')).toBeNull();
    expect(normalizeDynatraceEnvironmentUrl(' https://abc123.apps.dynatrace.com/ ')).toBe(
      'https://abc123.apps.dynatrace.com',
    );
    expect(normalizeDynatraceEnvironmentUrl('https://abc123.live.dynatrace.com')).toBe(
      'https://abc123.apps.dynatrace.com',
    );
  });

  it('rejects insecure, credentialed, public, and path-bearing URLs', () => {
    const insecureUrl = new URL('https://abc123.apps.dynatrace.com');
    insecureUrl.protocol = 'http:';
    for (const value of [
      insecureUrl.origin,
      'https://user:pass@abc123.apps.dynatrace.com',
      'https://example.com',
      'https://abc123.apps.dynatrace.com/api/v2/problems',
      'https://abc123.apps.dynatrace.com/?token=secret',
    ]) {
      expect(getDynatraceEnvironmentUrlError(value)).not.toBeNull();
      expect(normalizeDynatraceEnvironmentUrl(value)).toBe('');
    }
  });

  it('rejects blank, whitespace-bearing, and oversized platform tokens', () => {
    expect(getDynatraceApiTokenError('')).toMatch(/enter/i);
    expect(getDynatraceApiTokenError('token with spaces')).toMatch(/whitespace/i);
    expect(getDynatraceApiTokenError('x'.repeat(4097))).toMatch(/too long/i);
    expect(getDynatraceApiTokenError('dt0s16.example-token')).toBeNull();
  });
});
