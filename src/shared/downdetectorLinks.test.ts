import { describe, it, expect } from 'vitest';
import { CLOUD_STATUS_PROVIDERS, CLOUD_STATUS_PROVIDER_ORDER, downdetectorUrl } from './ipc';

describe('downdetector links', () => {
  it('builds a Downdetector status URL from a slug', () => {
    expect(downdetectorUrl('github')).toBe('https://downdetector.com/status/github/');
  });

  it('defines a slug for every provider', () => {
    for (const provider of CLOUD_STATUS_PROVIDER_ORDER) {
      expect(CLOUD_STATUS_PROVIDERS[provider].downdetectorSlug, provider).toBeTruthy();
    }
  });
});
