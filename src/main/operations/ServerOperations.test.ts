import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addServer, removeServer } from './ServerOperations';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { FileContext } from './FileContext';

// Mock fs and fs/promises
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

// Mock logger
vi.mock('../logger', () => ({
  loggers: {
    fileManager: {
      info: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe('ServerOperations', () => {
  const mockCtx: Partial<FileContext> = {
    rootDir: '/test/root',
    safeStringify: vi.fn((data) => JSON.stringify(data)),
    writeAndEmit: vi.fn().mockResolvedValue(undefined),
    performBackup: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addServer', () => {
    it('should add a new server', async () => {
      const existingCsv = 'VM-M,Business Area,LOB,Comment,Owner,IT Contact,OS\n';
      vi.mocked(fs.readFile).mockResolvedValue(existingCsv);
      vi.mocked(existsSync).mockReturnValue(true);

      const newServer = { name: 'server1', os: 'linux' };
      const result = await addServer(mockCtx as FileContext, newServer);

      expect(result).toBe(true);
      expect(mockCtx.writeAndEmit).toHaveBeenCalledWith(
        expect.stringContaining('servers.csv'),
        expect.stringContaining('server1')
      );
    });

    it('should update an existing server by name', async () => {
      const existingCsv = 'VM-M,Business Area,LOB,Comment,Owner,IT Contact,OS\nserver1,area1,lob1,comm,own,cont,linux';
      vi.mocked(fs.readFile).mockResolvedValue(existingCsv);
      vi.mocked(existsSync).mockReturnValue(true);

      const updates = { name: 'server1', os: 'windows' };
      await addServer(mockCtx as FileContext, updates);

      const writtenData = JSON.parse(vi.mocked(mockCtx.writeAndEmit!).mock.calls[0][1]);
      const server = writtenData.find((r: string[]) => r[0] === 'server1');
      expect(server[6]).toBe('windows'); // OS column
    });
  });

  describe('removeServer', () => {
    it('should remove a server by name', async () => {
      const existingCsv = 'VM-M,Business Area,LOB,Comment,Owner,IT Contact,OS\nserver1,area1,lob1,comm,own,cont,linux\nserver2,area2,lob2,comm,own,cont,linux';
      vi.mocked(fs.readFile).mockResolvedValue(existingCsv);
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await removeServer(mockCtx as FileContext, 'server1');

      expect(result).toBe(true);
      const writtenData = JSON.parse(vi.mocked(mockCtx.writeAndEmit!).mock.calls[0][1]);
      expect(writtenData.length).toBe(2); // Header + server2
      expect(writtenData.some((r: string[]) => r[0] === 'server1')).toBe(false);
    });

    it('should return false if server not found', async () => {
      const existingCsv = 'VM-M,Business Area,LOB,Comment,Owner,IT Contact,OS\nserver1,area1,lob1,comm,own,cont,linux';
      vi.mocked(fs.readFile).mockResolvedValue(existingCsv);
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await removeServer(mockCtx as FileContext, 'nonexistent');
      expect(result).toBe(false);
    });
  });
});
