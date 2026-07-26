import { describe, it, expect } from 'vitest';
import { isCredentialRejection, safePocketBaseAuthFailure } from './pbErrors';

describe('isCredentialRejection', () => {
  it('treats 400/401/403 as credential rejections', () => {
    expect(isCredentialRejection({ status: 400 })).toBe(true);
    expect(isCredentialRejection({ status: 401 })).toBe(true);
    expect(isCredentialRejection({ status: 403 })).toBe(true);
  });

  it('treats network, rate limits, 5xx, and unknown errors as transient', () => {
    expect(isCredentialRejection({ status: 0 })).toBe(false);
    expect(isCredentialRejection({ status: 429 })).toBe(false);
    expect(isCredentialRejection({ status: 500 })).toBe(false);
    expect(isCredentialRejection(new Error('socket hang up'))).toBe(false);
  });
});

describe('safePocketBaseAuthFailure', () => {
  it('classifies a credential rejection without retaining a reflected secret', () => {
    const secret = ['reflected', 'secret', 'sentinel'].join('-');
    const failure = safePocketBaseAuthFailure(
      Object.assign(new Error(`rejected ${secret}`), {
        status: 401,
        response: { message: `rejected ${secret}` },
      }),
    );

    expect(failure).toEqual({ category: 'credential-rejected', status: 401 });
    expect(JSON.stringify(failure)).not.toContain(secret);
  });

  it('uses bounded categories for rate limits, unavailable servers, and unknown errors', () => {
    expect(safePocketBaseAuthFailure({ status: 429 })).toEqual({
      category: 'rate-limited',
      status: 429,
    });
    expect(safePocketBaseAuthFailure({ status: 0 })).toEqual({
      category: 'unavailable',
      status: 0,
    });
    expect(safePocketBaseAuthFailure(new Error('server-controlled text'))).toEqual({
      category: 'unknown',
    });
  });
});
