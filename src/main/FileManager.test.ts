import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileManager } from './FileManager';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { BrowserWindow } from 'electron';

// Mock Electron
vi.mock('electron', () => {
  const mockWin = {
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: vi.fn(),
    },
  };

  class MockBrowserWindow {
    constructor() {
      return mockWin;
    }
    static getAllWindows = vi.fn(() => [mockWin]);
  }

  return {
    BrowserWindow: MockBrowserWindow,
    app: {
      getPath: vi.fn(() => '/tmp'),
    },
  };
});

// Mock chokidar
vi.mock('chokidar', () => ({
  watch: () => ({
    on: vi.fn(),
    close: vi.fn(),
  }),
}));

// Mock logger to prevent console noise during tests
vi.mock('./logger', () => ({
  loggers: {
    fileManager: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    ipc: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

// Mock fileLock
vi.mock('./fileLock', () => {
  return {
    atomicWriteWithLock: vi.fn(async (filePath, content) => {
      // Just write directly in mock, but use a temp file + rename to be atomic
      // and avoid race conditions where readFile might see an empty file
      const fs = await import('fs/promises');
      const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2)}.tmp`;
      try {
        await fs.writeFile(tempPath, content, 'utf-8');
        await fs.rename(tempPath, filePath);
      } catch (e) {
        try {
          await fs.unlink(tempPath);
        } catch {
          /* ignore */
        }
        throw e;
      }
    }),
    readWithLock: vi.fn(async (filePath) => {
      const fs = await import('fs/promises');
      try {
        return await fs.readFile(filePath, 'utf-8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    }),
    modifyJsonWithLock: vi.fn(async (filePath, modifier, defaultValue) => {
      const fs = await import('fs/promises');
      let data = defaultValue;
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        data = JSON.parse(content);
      } catch (_e) {
        /* ignore */
      }
      const newData = await modifier(data);
      const content = JSON.stringify(newData, null, 2);

      const tempPath = `${filePath}.${Date.now()}.tmp`;
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, filePath);
    }),
  };
});

describe('FileManager', () => {
  let tmpDir: string;
  let bundledDir: string;
  let fileManager: FileManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-test-'));
    bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-bundled-'));
    // Use the mocked class
    new BrowserWindow();
    fileManager = new FileManager(tmpDir, bundledDir);

    // Mock performBackup to avoid race conditions with directory cleanup
    // We only want to test performBackup explicitly in the "Daily Backups" suite
    vi.spyOn(fileManager, 'performBackup').mockResolvedValue(null);
  });

  afterEach(async () => {
    fileManager.destroy();
    // Wait a bit to ensure file locks are released
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.rm(bundledDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('JSON Contact Operations', () => {
    it('adds a contact to JSON storage', async () => {
      const contact = { name: 'Test User', email: 'test@example.com', phone: '555-123-4567' };
      const success = await fileManager.addContact(contact);
      expect(success).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'contacts.json'), 'utf-8');
      const records = JSON.parse(content);
      expect(records).toHaveLength(1);
      expect(records[0].name).toBe('Test User');
      expect(records[0].email).toBe('test@example.com');
    });

    it('removes a contact by email', async () => {
      // Create initial JSON data
      const records = [
        {
          id: '1',
          name: 'User1',
          email: 'user1@a.com',
          phone: '111',
          title: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: '2',
          name: 'User2',
          email: 'user2@a.com',
          phone: '222',
          title: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      await fs.writeFile(path.join(tmpDir, 'contacts.json'), JSON.stringify(records));

      const removed = await fileManager.removeContact('user1@a.com');
      expect(removed).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'contacts.json'), 'utf-8');
      const updated = JSON.parse(content);
      expect(updated).toHaveLength(1);
      expect(updated[0].email).toBe('user2@a.com');
    });

    it('returns false when removing non-existent contact', async () => {
      const records = [
        {
          id: '1',
          name: 'User1',
          email: 'user1@a.com',
          phone: '111',
          title: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      await fs.writeFile(path.join(tmpDir, 'contacts.json'), JSON.stringify(records));

      const removed = await fileManager.removeContact('nonexistent@a.com');
      expect(removed).toBe(false);
    });
  });

  describe('JSON Server Operations', () => {
    it('adds a server to JSON storage', async () => {
      const server = {
        name: 'TestServer',
        businessArea: 'IT',
        lob: 'Infrastructure',
        comment: 'Test comment',
        owner: 'owner@example.com',
        contact: 'tech@example.com',
        os: 'Linux',
      };

      const success = await fileManager.addServer(server);
      expect(success).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'servers.json'), 'utf-8');
      const records = JSON.parse(content);
      expect(records).toHaveLength(1);
      expect(records[0].name).toBe('TestServer');
    });

    it('removes a server by name', async () => {
      const records = [
        {
          id: '1',
          name: 'Server1',
          businessArea: 'Finance',
          lob: 'Accounting',
          comment: '',
          owner: 'owner1@a.com',
          contact: 'tech1@a.com',
          os: 'Windows',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: '2',
          name: 'Server2',
          businessArea: 'IT',
          lob: 'Infrastructure',
          comment: '',
          owner: 'owner2@a.com',
          contact: 'tech2@a.com',
          os: 'Linux',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      await fs.writeFile(path.join(tmpDir, 'servers.json'), JSON.stringify(records));

      const removed = await fileManager.removeServer('Server1');
      expect(removed).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'servers.json'), 'utf-8');
      const updated = JSON.parse(content);
      expect(updated).toHaveLength(1);
      expect(updated[0].name).toBe('Server2');
    });
  });

  describe('Daily Backups', () => {
    it('creates a backup of current data', async () => {
      // Restore original implementation for this test
      vi.mocked(fileManager.performBackup).mockRestore();

      // Setup initial data
      await fs.writeFile(path.join(tmpDir, 'contacts.json'), '[]');

      // Trigger backup
      await fileManager.performBackup('test');

      // Check if backup folder exists
      const backupDir = path.join(tmpDir, 'backups');
      const backups = await fs.readdir(backupDir);
      expect(backups.length).toBeGreaterThan(0);

      // Get today's local date part manually to match implementation
      const now = new Date();
      const offset = now.getTimezoneOffset() * 60000;
      const today = new Date(now.getTime() - offset).toISOString().slice(0, 10);

      // Expect at least one folder starting with today's date
      const backupFolder = backups.find((b) => b.startsWith(today));
      expect(backupFolder).toBeDefined();

      // Check file content
      const backupContent = await fs.readFile(
        path.join(backupDir, backupFolder!, 'contacts.json'),
        'utf-8',
      );
      expect(backupContent).toBe('[]');
    });

    it('prunes old backups keeping only last 30 days', async () => {
      // Restore original implementation for this test
      vi.mocked(fileManager.performBackup).mockRestore();

      const backupDir = path.join(tmpDir, 'backups');
      await fs.mkdir(backupDir, { recursive: true });

      // Create old backup folders
      const today = new Date();
      const offset = today.getTimezoneOffset() * 60000;
      const localToday = new Date(today.getTime() - offset);

      // 35 days ago (Should be pruned)
      const date35 = new Date(localToday);
      date35.setDate(localToday.getDate() - 35);
      const str35 = date35.toISOString().slice(0, 10) + '_00-00-00';
      await fs.mkdir(path.join(backupDir, str35));

      // 1 day ago (Should be kept)
      const date1 = new Date(localToday);
      date1.setDate(localToday.getDate() - 1);
      const str1 = date1.toISOString().slice(0, 10) + '_00-00-00';
      await fs.mkdir(path.join(backupDir, str1));

      // Trigger backup
      await fileManager.performBackup('auto');

      const backups = await fs.readdir(backupDir);

      expect(backups).not.toContain(str35);
      expect(backups).toContain(str1);

      // Check that a new backup for today was created
      const todayStr = localToday.toISOString().slice(0, 10);
      const newBackup = backups.find((b) => b.startsWith(todayStr));
      expect(newBackup).toBeDefined();
    });
  });
});
