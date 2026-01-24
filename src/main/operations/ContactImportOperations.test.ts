import { describe, it, expect, vi, beforeEach } from 'vitest';
import { importContactsWithMapping } from './ContactImportOperations';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { FileContext } from './FileContext';

// Mock fs and fs/promises
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    unlink: vi.fn(),
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

describe('ContactImportOperations', () => {
  const mockCtx: Partial<FileContext> = {
    rootDir: '/test/root',
    isDummyData: vi.fn().mockResolvedValue(false),
    safeStringify: vi.fn((data) => JSON.stringify(data)),
    writeAndEmit: vi.fn().mockResolvedValue(undefined),
    performBackup: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should import contacts and merge with existing ones', async () => {
    const sourceCsv = 'Name,Email,Phone,Title\nNew User,new@example.com,1234567890,Engineer';
    const existingCsv = 'Name,Email,Phone,Title\nExisting User,existing@example.com,0987654321,Manager';
    
    vi.mocked(fs.readFile).mockImplementation(async (path: any) => {
      if (path === 'source.csv') return sourceCsv;
      return existingCsv;
    });
    vi.mocked(existsSync).mockReturnValue(true);

    const result = await importContactsWithMapping(mockCtx as FileContext, 'source.csv');

    expect(result).toBe(true);
    expect(mockCtx.writeAndEmit).toHaveBeenCalledWith(
      expect.stringContaining('contacts.csv'),
      expect.stringContaining('new@example.com')
    );
    expect(mockCtx.writeAndEmit).toHaveBeenCalledWith(
      expect.stringContaining('contacts.csv'),
      expect.stringContaining('existing@example.com')
    );
  });

  it('should update existing contacts by email', async () => {
    const sourceCsv = 'Name,Email,Phone,Title\nUpdated User,existing@example.com,1111111111,Senior Engineer';
    const existingCsv = 'Name,Email,Phone,Title\nExisting User,existing@example.com,0987654321,Manager';
    
    vi.mocked(fs.readFile).mockImplementation(async (path: any) => {
      if (path === 'source.csv') return sourceCsv;
      return existingCsv;
    });
    vi.mocked(existsSync).mockReturnValue(true);

    await importContactsWithMapping(mockCtx as FileContext, 'source.csv');

    // The output should contain 'Updated User' instead of 'Existing User' for that email
    const writtenData = JSON.parse(vi.mocked(mockCtx.writeAndEmit!).mock.calls[0][1]);
    const updatedUser = writtenData.find((r: string[]) => r[1] === 'existing@example.com');
    expect(updatedUser[0]).toBe('Updated User');
    expect(updatedUser[3]).toBe('Senior Engineer');
  });

  it('should clear dummy data before import', async () => {
    vi.mocked(mockCtx.isDummyData!).mockResolvedValue(true);
    vi.mocked(fs.readFile).mockResolvedValue('Name,Email,Phone,Title\nUser,u@e.c,1,T');
    vi.mocked(existsSync).mockReturnValue(false); // After unlink

    await importContactsWithMapping(mockCtx as FileContext, 'source.csv');

    expect(fs.unlink).toHaveBeenCalled();
  });

  it('should fail if no email column is found', async () => {
    const sourceCsv = 'Name,Phone,Title\nNew User,123,Eng';
    vi.mocked(fs.readFile).mockResolvedValue(sourceCsv);

    const result = await importContactsWithMapping(mockCtx as FileContext, 'source.csv');

    expect(result).toBe(false);
  });
});
