import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDevMockData } from '../mockData';

describe('getDevMockData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates browser preview data when randomUUID is unavailable', () => {
    let nextByte = 0;
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(nextByte);
        nextByte += 1;
        return bytes;
      },
    });

    const data = getDevMockData();

    expect(data.contacts.length).toBeGreaterThan(0);
    expect(new Set(data.contacts.map((contact) => contact.raw.id)).size).toBe(data.contacts.length);
  });
});
