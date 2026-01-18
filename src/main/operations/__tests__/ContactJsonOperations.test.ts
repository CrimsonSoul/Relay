import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getContacts, addContactRecord } from '../ContactJsonOperations';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

vi.mock('fs/promises');
vi.mock('fs');
vi.mock('../../logger', () => ({
  loggers: {
    fileManager: {
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    }
  }
}));

describe('ContactJsonOperations Data Safety', () => {
  const rootDir = '/tmp/relay-data';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw error on transient read failure (EACCES) to prevent data wipe', async () => {
    (existsSync as any).mockReturnValue(true);
    (fs.readFile as any).mockRejectedValue({ code: 'EACCES' });

    // Expect getContacts to throw, NOT return []
    await expect(getContacts(rootDir)).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('should return empty array on file not found (ENOENT)', async () => {
    (existsSync as any).mockReturnValue(false);
    
    const result = await getContacts(rootDir);
    expect(result).toEqual([]);
  });

  it('should return empty array when existsSync is true but readFile returns ENOENT (race condition)', async () => {
    (existsSync as any).mockReturnValue(true);
    (fs.readFile as any).mockRejectedValue({ code: 'ENOENT' });

    const result = await getContacts(rootDir);
    expect(result).toEqual([]);
  });
});
