import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileManager } from './FileManager';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BrowserWindow } from 'electron';

// Mock Electron
vi.mock('electron', () => {
  class MockBrowserWindow {
    public readonly isDestroyed = vi.fn(() => false);
    public readonly webContents = {
      send: vi.fn(),
    };

    public static readonly getAllWindows = vi.fn(() => [mockWin]);
  }
  const mockWin = new MockBrowserWindow();

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
      const fs = await import('node:fs/promises');
      const tempPath = `${filePath}.${Date.now()}.${crypto.randomUUID()}.tmp`;
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
      const fs = await import('node:fs/promises');
      try {
        return await fs.readFile(filePath, 'utf-8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    }),
    modifyJsonWithLock: vi.fn(async (filePath, modifier, defaultValue) => {
      const fs = await import('node:fs/promises');
      let data = defaultValue;
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        data = JSON.parse(content);
        // eslint-disable-next-line sonarjs/no-ignored-exceptions
      } catch (_error) {
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
    // Mock BrowserWindow instantiation
    const browserWindow = new BrowserWindow();
    expect(browserWindow).toBeDefined();
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
          id: 'server-1',
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
          id: 'server-2',
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

    it('returns false when removing non-existent server', async () => {
      await fs.writeFile(path.join(tmpDir, 'servers.json'), '[]');
      const removed = await fileManager.removeServer('Missing');
      expect(removed).toBe(false);
    });
  });

  describe('On-call JSON Operations', () => {
    it('updates an existing team and preserves other teams', async () => {
      const initialRows = [
        {
          id: 'a1',
          team: 'Team A',
          role: 'Primary',
          name: 'Alice',
          contact: 'alice@test.com',
          timeWindow: '24/7',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'b1',
          team: 'Team B',
          role: 'Primary',
          name: 'Bob',
          contact: 'bob@test.com',
          timeWindow: 'Weekdays',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      await fs.writeFile(path.join(tmpDir, 'oncall.json'), JSON.stringify(initialRows));
      await fileManager.readAndEmit();

      const success = await fileManager.updateOnCallTeam('Team A', [
        {
          id: 'a2',
          team: 'Team A',
          role: 'Secondary',
          name: 'Avery',
          contact: 'avery@test.com',
          timeWindow: 'Weekends',
        },
      ]);

      expect(success).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'oncall.json'), 'utf-8');
      const updated = JSON.parse(content);
      expect(
        updated.some((r: { team: string; id: string }) => r.team === 'Team A' && r.id === 'a2'),
      ).toBe(true);
      expect(
        updated.some((r: { team: string; id: string }) => r.team === 'Team B' && r.id === 'b1'),
      ).toBe(true);
    });

    it('renames and removes teams in oncall.json', async () => {
      const rows = [
        {
          id: 'r1',
          team: 'Old Team',
          role: 'Primary',
          name: 'Op One',
          contact: 'op1@test.com',
          timeWindow: '24/7',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      await fs.writeFile(path.join(tmpDir, 'oncall.json'), JSON.stringify(rows));
      await fileManager.readAndEmit();

      const renamed = await fileManager.renameOnCallTeam('Old Team', 'New Team');
      expect(renamed).toBe(true);

      const afterRename = JSON.parse(await fs.readFile(path.join(tmpDir, 'oncall.json'), 'utf-8'));
      expect(afterRename[0].team).toBe('New Team');

      const removed = await fileManager.removeOnCallTeam('New Team');
      expect(removed).toBe(true);

      const afterRemove = JSON.parse(await fs.readFile(path.join(tmpDir, 'oncall.json'), 'utf-8'));
      expect(afterRemove).toEqual([]);
    });

    it('reorders teams and writes team layout', async () => {
      const rows = [
        {
          id: 'a1',
          team: 'Team A',
          role: 'Primary',
          name: 'A',
          contact: 'a@test.com',
          timeWindow: '24/7',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'b1',
          team: 'Team B',
          role: 'Primary',
          name: 'B',
          contact: 'b@test.com',
          timeWindow: '24/7',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      await fs.writeFile(path.join(tmpDir, 'oncall.json'), JSON.stringify(rows));
      await fileManager.readAndEmit();

      const layout = {
        'Team B': { x: 0, y: 0, w: 6, h: 4 },
        'Team A': { x: 6, y: 0, w: 6, h: 4 },
      };

      const success = await fileManager.reorderOnCallTeams(['Team B', 'Team A'], layout);
      expect(success).toBe(true);

      const onCallContent = JSON.parse(
        await fs.readFile(path.join(tmpDir, 'oncall.json'), 'utf-8'),
      );
      expect(onCallContent[0].team).toBe('Team B');

      const rawLayout = await fs.readFile(path.join(tmpDir, 'oncall_layout.json'), 'utf-8');
      const layoutContent = JSON.parse(rawLayout.replace(/^\uFEFF/u, ''));
      expect(layoutContent).toEqual(layout);
    });

    it('saves all on-call rows', async () => {
      const rows = [
        {
          id: 'x1',
          team: 'X',
          role: 'Primary',
          name: 'Xena',
          contact: 'x@test.com',
          timeWindow: '24/7',
        },
      ];

      const success = await fileManager.saveAllOnCall(rows);
      expect(success).toBe(true);

      const content = JSON.parse(await fs.readFile(path.join(tmpDir, 'oncall.json'), 'utf-8'));
      expect(content).toHaveLength(1);
      expect(content[0].team).toBe('X');
    });
  });

  describe('getCachedData and bundledDataPath', () => {
    it('exposes bundledDataPath from the underlying service', () => {
      expect(fileManager.bundledDataPath).toBe(bundledDir);
    });

    it('getCachedData returns the current cache snapshot', async () => {
      const cache = fileManager.getCachedData();
      expect(cache).toBeDefined();
      // After readAndEmit with no data files the cache should have empty arrays
      await fileManager.readAndEmit();
      const afterCache = fileManager.getCachedData();
      expect(afterCache).toBeDefined();
    });
  });

  describe('loadLayout edge cases', () => {
    it('reads a valid oncall_layout.json from disk', async () => {
      const layout = { 'Team A': { x: 0, y: 0, w: 6, h: 4 } };
      await fs.writeFile(path.join(tmpDir, 'oncall_layout.json'), JSON.stringify(layout));
      await fileManager.readAndEmit();
      // No error thrown is sufficient — the layout was read
      const cache = fileManager.getCachedData();
      expect(cache).toBeDefined();
    });

    it('handles oncall_layout.json with invalid JSON gracefully', async () => {
      await fs.writeFile(path.join(tmpDir, 'oncall_layout.json'), 'NOT_JSON!!!');
      // Should not throw — falls back to empty layout
      await expect(fileManager.readAndEmit()).resolves.toBeUndefined();
    });

    it('handles oncall_layout.json with content that fails schema validation', async () => {
      // Valid JSON but not a valid TeamLayout (not a plain object of widgets)
      await fs.writeFile(path.join(tmpDir, 'oncall_layout.json'), JSON.stringify([1, 2, 3]));
      await expect(fileManager.readAndEmit()).resolves.toBeUndefined();
    });
  });

  describe('readAndEmit error path', () => {
    it('does not throw when a data file read fails', async () => {
      // Write invalid JSON to contacts.json to trigger a parse error inside loadContacts
      await fs.writeFile(path.join(tmpDir, 'contacts.json'), 'INVALID_JSON');
      // readAndEmit catches the error internally and should not propagate
      await expect(fileManager.readAndEmit()).resolves.toBeUndefined();
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
