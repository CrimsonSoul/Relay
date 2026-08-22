import { describe, it, expect } from 'vitest';
import {
  CLOUD_STATUS_PROVIDERS,
  LEGACY_CLOUD_STATUS_PROVIDER_ORDER,
  MIST_CLOUD_STATUS_PROVIDER_ORDER,
  downdetectorUrl,
} from './ipc';

describe('downdetector links', () => {
  it('builds a Downdetector status URL from a slug', () => {
    expect(downdetectorUrl('github')).toBe('https://downdetector.com/status/github/');
  });

  it('defines a slug for every legacy provider', () => {
    for (const provider of LEGACY_CLOUD_STATUS_PROVIDER_ORDER) {
      expect(CLOUD_STATUS_PROVIDERS[provider].downdetectorSlug, provider).toBeTruthy();
    }
  });

  it('does not offer unverified Downdetector pages for Mist regions', () => {
    for (const provider of MIST_CLOUD_STATUS_PROVIDER_ORDER) {
      expect(CLOUD_STATUS_PROVIDERS[provider].downdetectorSlug, provider).toBeUndefined();
    }
  });
});
