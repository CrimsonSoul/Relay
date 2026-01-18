
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileManager } from './FileManager';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { BrowserWindow } from 'electron';

// Mock Electron
vi.mock('electron', () => {
  return {
    BrowserWindow: class {
      isDestroyed = () => false;
      webContents = {
        send: vi.fn()
      };
    },
    app: {
      getPath: () => '/tmp'
    }
  };
});

// Mock chokidar
vi.mock('chokidar', () => ({
  default: {
    watch: () => ({
      on: vi.fn(),
      close: vi.fn()
    })
  }
}));

// Mock logger to prevent console noise during tests
vi.mock('./logger', () => ({
  loggers: {
    fileManager: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    },
    ipc: {
      warn: vi.fn(),
      error: vi.fn()
    }
  }
}));

// Mock fileLock
vi.mock('./fileLock', () => {
  return {
    withFileLock: vi.fn(async (_path, cb) => cb()),
    isFileLocked: vi.fn(async () => false),
    atomicWriteWithLock: vi.fn(async (path, content) => {
        // Just write directly in mock
        const fs = await import('fs/promises');
        await fs.writeFile(path, content, 'utf-8');
    }),
    readWithLock: vi.fn(async (path) => {
        const fs = await import('fs/promises');
        return fs.readFile(path, 'utf-8');
    }),
    modifyWithLock: vi.fn(async (path, modifier) => {
        const fs = await import('fs/promises');
        let content = '';
        try { content = await fs.readFile(path, 'utf-8'); } catch {}
        const newContent = await modifier(content);
        await fs.writeFile(path, newContent, 'utf-8');
    }),
    modifyJsonWithLock: vi.fn(async (path, modifier, defaultValue) => {
        const fs = await import('fs/promises');
        let data = defaultValue;
        try {
            const content = await fs.readFile(path, 'utf-8');
            data = JSON.parse(content);
        } catch {}
        const newData = await modifier(data);
        await fs.writeFile(path, JSON.stringify(newData, null, 2), 'utf-8');
    })
  };
});

describe('FileManager', () => {
  let tmpDir: string;
  let bundledDir: string;
  let fileManager: FileManager;
  let mockWindow: BrowserWindow;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-test-'));
    bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-bundled-'));
    // Use the mocked class
    mockWindow = new BrowserWindow();
    fileManager = new FileManager(mockWindow as unknown as BrowserWindow, tmpDir, bundledDir);
    
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

  it('adds a contact to an empty directory (creates file)', async () => {
    const contact = { name: 'Test User', email: 'test@example.com', phone: '555-123-4567' };
    const success = await fileManager.addContact(contact);
    expect(success).toBe(true);

    const content = await fs.readFile(path.join(tmpDir, 'contacts.csv'), 'utf-8');
    expect(content).toContain('\uFEFFName,Title,Email,Phone');
    expect(content).toContain('Test User');
    expect(content).toContain('test@example.com');
  });

  it('appends a contact to existing file', async () => {
    const initialCsv = 'Name,Title,Email,Phone\nExisting,Role,exist@a.com,555';
    await fs.writeFile(path.join(tmpDir, 'contacts.csv'), initialCsv);

    const contact = { name: 'New User', email: 'new@example.com', phone: '555-987-6543' };
    const success = await fileManager.addContact(contact);
    expect(success).toBe(true);

    const content = await fs.readFile(path.join(tmpDir, 'contacts.csv'), 'utf-8');
    expect(content).toContain('Existing');
    expect(content).toContain('New User');
  });

  it('handles "Phone1" column scenario (user reported bug)', async () => {
    // User has "Phone1" in the file, but we look for "Phone".
    // This should Create a NEW "Phone" column if it doesn't match?
    // Or if "Phone1" is NOT mapped, it adds "Phone".

    const initialCsv = 'Name,Email,Phone1\nUser,u@a.com,(+1) 234';
    await fs.writeFile(path.join(tmpDir, 'contacts.csv'), initialCsv);

    const contact = { name: 'Fix User', email: 'fix@a.com', phone: '+1 555-123-4567' };
    const success = await fileManager.addContact(contact);
    expect(success).toBe(true);

    const content = await fs.readFile(path.join(tmpDir, 'contacts.csv'), 'utf-8');

    // It will add "Phone" column because "Phone1" doesn't match ['phone', 'phone number']
    expect(content).toContain('Phone');

    // Check if new user is there
    expect(content).toContain('Fix User');
    // Phone gets stored (may be formatted or raw depending on length)
    expect(content).toContain('123-4567');
  });

  describe('CSV Import and Phone Number Cleaning', () => {
    const waitForContent = async (filePath: string, content: string, timeout = 2000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          const c = await fs.readFile(filePath, 'utf-8');
          if (c.includes(content)) return c;
        } catch {
          // Ignore read errors during polling
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return await fs.readFile(filePath, 'utf-8');
    };

    it('cleans messy phone numbers on contact load', async () => {
      const messyCsv = 'Name,Email,Phone\nJohn,john@a.com,"Office:79984456 Ext:877-273-9002"';
      await fs.writeFile(path.join(tmpDir, 'contacts.csv'), messyCsv);

      await fileManager.readAndEmit();

      const content = await waitForContent(path.join(tmpDir, 'contacts.csv'), '(7) 998-4456, (877) 273-9002');
      expect(content).toContain('(7) 998-4456, (877) 273-9002');
    });

    it('formats US phone numbers with parentheses', async () => {
      const csv = 'Name,Email,Phone\nJane,jane@a.com,5551234567';
      await fs.writeFile(path.join(tmpDir, 'contacts.csv'), csv);

      await fileManager.readAndEmit();

      const content = await waitForContent(path.join(tmpDir, 'contacts.csv'), '(555) 123-4567');
      expect(content).toContain('(555) 123-4567');
    });

    it('preserves international phone numbers', async () => {
      const csv = 'Name,Email,Phone\nRaj,raj@a.com,+919904918167';
      await fs.writeFile(path.join(tmpDir, 'contacts.csv'), csv);

      await fileManager.readAndEmit();

      const content = await waitForContent(path.join(tmpDir, 'contacts.csv'), '(91) 990 491 8167');
      expect(content).toContain('(91) 990 491 8167');
    });

    it('cleans phone numbers when adding contacts', async () => {
      const contact = {
        name: 'Test User',
        email: 'test@a.com',
        phone: '555-123-4567 x999'
      };

      await fileManager.addContact(contact);

      const content = await fs.readFile(path.join(tmpDir, 'contacts.csv'), 'utf-8');
      expect(content).toContain('(555) 123-4567');
      expect(content).toContain('999');
    });

    it('handles legacy contact CSV with "Phone Number" column', async () => {
      const legacyCsv = 'Name,Title,Email,Phone Number\nLegacy User,Manager,legacy@a.com,555-987-6543';
      await fs.writeFile(path.join(tmpDir, 'contacts.csv'), legacyCsv);

      await fileManager.readAndEmit();

      const content = await waitForContent(path.join(tmpDir, 'contacts.csv'), '(555) 987-6543');
      expect(content).toContain('Legacy User');
      expect(content).toContain('(555) 987-6543');
    });

    it('preserves contact data with special characters and quotes', async () => {
      const complexCsv = 'Name,Title,Email,Phone\n"Smith, John","VP of Sales & Marketing",john@example.com,"Office: 555-123-4567"';
      await fs.writeFile(path.join(tmpDir, 'contacts.csv'), complexCsv);

      await fileManager.readAndEmit();

      // No rewrite expected here unless phone needs formatting?
      // "Office: 555-123-4567" -> might not change if phone parser keeps it raw or formats valid part
      // Check for name persistence
      const content = await fs.readFile(path.join(tmpDir, 'contacts.csv'), 'utf-8');
      expect(content).toContain('Smith, John');
      expect(content).toContain('VP of Sales & Marketing');
      expect(content).toContain('john@example.com');
    });
  });

  describe('Server CSV Header Migration', () => {
    it('keeps modern server headers unchanged', async () => {
      const modernCsv = 'Name,Business Area,LOB,Comment,Owner,IT Contact,OS\nServer2,IT,Infrastructure,Prod,owner2@a.com,tech2@a.com,Linux';
      await fs.writeFile(path.join(tmpDir, 'servers.csv'), modernCsv);

      await fileManager.readAndEmit();

      const content = await fs.readFile(path.join(tmpDir, 'servers.csv'), 'utf-8');
      // Should remain unchanged (headers already standard)
      expect(content).toContain('Server2');
      expect(content).toContain('Name,Business Area,LOB');
    });
  });

  describe('Dummy Data Detection and Import', () => {
    it('detects and clears dummy data before import', async () => {
      // Create dummy data in the working directory
      const dummyContactsCsv = 'Name,Title,Email,Phone\nDummy User,Role,dummy@example.com,555-0000';
      await fs.writeFile(path.join(tmpDir, 'contacts.csv'), dummyContactsCsv);
      // Also create it in bundledDir so isDummyData returns true
      await fs.writeFile(path.join(bundledDir, 'contacts.csv'), dummyContactsCsv);

      // Create a source CSV for import
      const sourceTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-import-'));
      const sourceCsv = 'Name,Email,Phone\nReal User,real@example.com,555-1111';
      const sourcePath = path.join(sourceTmpDir, 'import.csv');
      await fs.writeFile(sourcePath, sourceCsv);

      try {
        // Import should detect if current data is dummy and clear it
        await fileManager.importContactsWithMapping(sourcePath);

        const content = await fs.readFile(path.join(tmpDir, 'contacts.csv'), 'utf-8');
        expect(content).toContain('Real User');
        expect(content).not.toContain('Dummy User'); // verify dummy data is gone
      } finally {
        await fs.rm(sourceTmpDir, { recursive: true, force: true });
      }
    });

    it('preserves existing data when importing non-dummy contacts', async () => {
      const existingCsv = 'Name,Email,Phone\nExisting User,exist@example.com,555-2222';
      await fs.writeFile(path.join(tmpDir, 'contacts.csv'), existingCsv);

      const sourceTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-import-'));
      const sourceCsv = 'Name,Email,Phone\nNew User,new@example.com,555-3333';
      const sourcePath = path.join(sourceTmpDir, 'import.csv');
      await fs.writeFile(sourcePath, sourceCsv);

      try {
        await fileManager.importContactsWithMapping(sourcePath);

        const content = await fs.readFile(path.join(tmpDir, 'contacts.csv'), 'utf-8');
        // Both should be present
        expect(content).toContain('Existing User');
        expect(content).toContain('New User');
      } finally {
        await fs.rm(sourceTmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('Contact Management', () => {
    it('removes a contact by email', async () => {
      const csv = 'Name,Email,Phone\nUser1,user1@a.com,111\nUser2,user2@a.com,222';
      await fs.writeFile(path.join(tmpDir, 'contacts.csv'), csv);

      const removed = await fileManager.removeContact('user1@a.com');
      expect(removed).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'contacts.csv'), 'utf-8');
      expect(content).not.toContain('User1');
      expect(content).toContain('User2');
    });

    it('returns false when removing non-existent contact', async () => {
      const csv = 'Name,Email,Phone\nUser1,user1@a.com,111';
      await fs.writeFile(path.join(tmpDir, 'contacts.csv'), csv);

      const removed = await fileManager.removeContact('nonexistent@a.com');
      expect(removed).toBe(false);
    });
  });

  describe('Server Management', () => {
    it('adds a server to empty file', async () => {
      const server = {
        name: 'TestServer',
        businessArea: 'IT',
        lob: 'Infrastructure',
        comment: 'Test comment',
        owner: 'owner@example.com',
        contact: 'tech@example.com',
        osType: 'Linux'
      };

      const success = await fileManager.addServer(server);
      expect(success).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'servers.csv'), 'utf-8');
      expect(content).toContain('TestServer');
      expect(content).toContain('IT');
      expect(content).toContain('Infrastructure');
    });

    it('removes a server by name', async () => {
      const csv = 'Name,Business Area,LOB,Comment,Owner,IT Contact,OS\nServer1,Finance,Accounting,Note1,owner1@a.com,tech1@a.com,Windows\nServer2,IT,Infrastructure,Note2,owner2@a.com,tech2@a.com,Linux';
      await fs.writeFile(path.join(tmpDir, 'servers.csv'), csv);

      const removed = await fileManager.removeServer('Server1');
      expect(removed).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'servers.csv'), 'utf-8');
      expect(content).not.toContain('Server1');
      expect(content).toContain('Server2');
    });
  });

  // Note: Group management tests removed - CSV-based groups.csv system was replaced
  // by JSON-based bridgeGroups.json system. See PresetOperations.ts for the new
  // group CRUD operations (getGroups, saveGroup, updateGroup, deleteGroup).
  // New group operations are tested via integration/e2e tests.
  describe('Daily Backups', () => {
    it('creates a backup of current data', async () => {
      // Restore original implementation for this test
      vi.mocked(fileManager.performBackup).mockRestore();

      // Setup initial data
      await fs.writeFile(path.join(tmpDir, 'contacts.csv'), 'test data');

      // Trigger backup (access method)
      // Note: We access the private/protected method or the public one we just restored
      await fileManager.performBackup('test');

      // Check if backup folder exists
      const backupDir = path.join(tmpDir, 'backups');
      const backups = await fs.readdir(backupDir);
      expect(backups.length).toBeGreaterThan(0);

      // Get today's local date part manually to match implementation
      const now = new Date();
      const offset = now.getTimezoneOffset() * 60000;
      const today = (new Date(now.getTime() - offset)).toISOString().slice(0, 10);

      // Expect at least one folder starting with today's date
      const backupFolder = backups.find(b => b.startsWith(today));
      expect(backupFolder).toBeDefined();

      // Check file content
      const backupContent = await fs.readFile(path.join(backupDir, backupFolder!, 'contacts.csv'), 'utf-8');
      expect(backupContent).toBe('test data');
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
      const newBackup = backups.find(b => b.startsWith(todayStr));
      expect(newBackup).toBeDefined();
    });
  });
});
