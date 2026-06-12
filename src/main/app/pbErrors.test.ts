import { describe, it, expect } from 'vitest';
import { isCredentialRejection } from './pbErrors';

describe('isCredentialRejection', () => {
  it('treats 400/401/403 as credential rejections', () => {
    expect(isCredentialRejection({ status: 400 })).toBe(true);
    expect(isCredentialRejection({ status: 401 })).toBe(true);
    expect(isCredentialRejection({ status: 403 })).toBe(true);
  });

  it('treats network (status 0), 5xx, and unknown errors as transient', () => {
    expect(isCredentialRejection({ status: 0 })).toBe(false);
    expect(isCredentialRejection({ status: 500 })).toBe(false);
    expect(isCredentialRejection(new Error('socket hang up'))).toBe(false);
  });
});
