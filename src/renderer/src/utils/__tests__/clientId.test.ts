import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientId } from '../clientId';

describe('createClientId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the native randomUUID implementation when available', () => {
    const randomUUID = vi.fn(() => 'native-uuid');
    const getRandomValues = vi.fn();
    vi.stubGlobal('crypto', { randomUUID, getRandomValues });

    expect(createClientId()).toBe('native-uuid');
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('creates unique RFC 4122 version 4 UUIDs without randomUUID', () => {
    let seed = 0;
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_, index) => {
          bytes[index] = seed + index;
        });
        seed += 1;
        return bytes;
      },
    });

    const first = createClientId();
    const second = createClientId();
    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    expect(first).toMatch(uuidV4);
    expect(second).toMatch(uuidV4);
    expect(second).not.toBe(first);
  });
});
