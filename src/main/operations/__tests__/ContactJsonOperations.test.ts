import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock everything needed for fileLock
vi.mock('../../fileLock', () => {
  // Use a factory function to allow individual tests to override
  return {
    readWithLock: vi.fn(),
    modifyJsonWithLock: vi.fn()
  };
});

vi.mock('fs/promises');
vi.mock('fs');
vi.mock('../../logger', () => ({
  loggers: {
    fileManager: {
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn()
    }
  }
}));

import { readWithLock } from '../../fileLock';

// ...

describe('ContactJsonOperations Data Safety', () => {
  const rootDir = '/tmp/relay-data';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw error on transient read failure (EACCES) to prevent data wipe', async () => {
    const error: any = new Error('EACCES');
    error.code = 'EACCES';
    vi.mocked(readWithLock).mockRejectedValue(error);

    const { getContacts: getContactsReimported } = await import('../ContactJsonOperations');

    // Expect getContacts to throw, NOT return []
    await expect(getContactsReimported(rootDir)).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('should return empty array on file not found (ENOENT)', async () => {
    const error: any = new Error('ENOENT');
    error.code = 'ENOENT';
    vi.mocked(readWithLock).mockRejectedValue(error);
    
    const { getContacts: getContactsReimported } = await import('../ContactJsonOperations');
    const result = await getContactsReimported(rootDir);
    expect(result).toEqual([]);
  });

  it('should return empty array when existsSync is true but readFile returns ENOENT (race condition)', async () => {
    const error: any = new Error('ENOENT');
    error.code = 'ENOENT';
    vi.mocked(readWithLock).mockRejectedValue(error);

    const { getContacts: getContactsReimported } = await import('../ContactJsonOperations');
    const result = await getContactsReimported(rootDir);
    expect(result).toEqual([]);
  });
});
