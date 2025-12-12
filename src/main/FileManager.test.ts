
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileManager } from './FileManager';
import fs from 'fs/promises';
import { existsSync } from 'fs';
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

describe('FileManager', () => {
  let tmpDir: string;
  let bundledDir: string;
  let fileManager: FileManager;
  let mockWindow: any;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-test-'));
    bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-bundled-'));
    // Use the mocked class
    mockWindow = new BrowserWindow();
    fileManager = new FileManager(mockWindow as unknown as BrowserWindow, tmpDir, bundledDir);
  });

  afterEach(async () => {
    if (fileManager) fileManager.destroy();
    // Wait a bit to ensure file locks are released?
    try {
        await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {
        // Ignore cleanup errors
    }
  });

  it('adds a contact to an empty directory (creates file)', async () => {
    const contact = { name: 'Test User', email: 'test@example.com', phone: '123' };
    const success = await fileManager.addContact(contact);
    expect(success).toBe(true);

    const content = await fs.readFile(path.join(tmpDir, 'contacts.csv'), 'utf-8');
    expect(content).toContain('Name,Title,Email,Phone');
    expect(content).toContain('Test User');
    expect(content).toContain('test@example.com');
  });

  it('appends a contact to existing file', async () => {
    const initialCsv = 'Name,Title,Email,Phone\nExisting,Role,exist@a.com,555';
    await fs.writeFile(path.join(tmpDir, 'contacts.csv'), initialCsv);

    const contact = { name: 'New User', email: 'new@example.com', phone: '999' };
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

    const contact = { name: 'Fix User', email: 'fix@a.com', phone: '+1555' };
    const success = await fileManager.addContact(contact);
    expect(success).toBe(true);

    const content = await fs.readFile(path.join(tmpDir, 'contacts.csv'), 'utf-8');

    // It will add "Phone" column because "Phone1" doesn't match ['phone', 'phone number']
    expect(content).toContain('Phone');

    // Check if new user is there
    expect(content).toContain('Fix User');
    expect(content).toContain('+1555');
  });

  describe('CSV Import and Phone Number Cleaning', () => {
    it('cleans messy phone numbers on contact load', async () => {
      const messyCsv = 'Name,Email,Phone\nJohn,john@a.com,"Office:79984456 Ext:877-273-9002"';
      await fs.writeFile(path.join(tmpDir, 'contacts.csv'), messyCsv);

      await fileManager.readAndEmit();

      const content = await fs.readFile(path.join(tmpDir, 'contacts.csv'), 'utf-8');
      // Phone should be cleaned and formatted
      expect(content).toContain('79984456, (877) 273-9002');
    });

    it('formats US phone numbers with parentheses', async () => {
      const csv = 'Name,Email,Phone\nJane,jane@a.com,5551234567';
      await fs.writeFile(path.join(tmpDir, 'contacts.csv'), csv);

      await fileManager.readAndEmit();

      const content = await fs.readFile(path.join(tmpDir, 'contacts.csv'), 'utf-8');
      expect(content).toContain('(555) 123-4567');
    });

    it('preserves international phone numbers', async () => {
      const csv = 'Name,Email,Phone\nRaj,raj@a.com,+919904918167';
      await fs.writeFile(path.join(tmpDir, 'contacts.csv'), csv);

      await fileManager.readAndEmit();

      const content = await fs.readFile(path.join(tmpDir, 'contacts.csv'), 'utf-8');
      expect(content).toContain('+919904918167');
    });

    it('cleans phone numbers when adding contacts', async () => {
      const contact = {
        name: 'Test User',
        email: 'test@a.com',
        phone: 'Office: 555-123-4567 Ext: 999'
      };

      await fileManager.addContact(contact);

      const content = await fs.readFile(path.join(tmpDir, 'contacts.csv'), 'utf-8');
      // Should be cleaned and formatted
      expect(content).toContain('(555) 123-4567');
      expect(content).toContain('999');
    });
  });

  describe('Server CSV Header Migration', () => {
    it('migrates legacy server headers to new format', async () => {
      const legacyCsv = 'VM-M,Mailbox,VDP-M,Server Warden,Temp\nServer1,box1,vdp1,warden1,70F';
      await fs.writeFile(path.join(tmpDir, 'servers.csv'), legacyCsv);

      await fileManager.readAndEmit();

      const content = await fs.readFile(path.join(tmpDir, 'servers.csv'), 'utf-8');
      // Should have new headers
      expect(content).toContain('Name,Mailbox,Manager,Warden,Temperature');
      expect(content).toContain('Server1,box1,vdp1,warden1,70F');
    });

    it('keeps modern server headers unchanged', async () => {
      const modernCsv = 'Name,Mailbox,Manager,Warden,Temperature\nServer2,box2,mgr2,ward2,68F';
      await fs.writeFile(path.join(tmpDir, 'servers.csv'), modernCsv);

      await fileManager.readAndEmit();

      const content = await fs.readFile(path.join(tmpDir, 'servers.csv'), 'utf-8');
      // Should remain unchanged
      expect(content).toBe(modernCsv);
    });
  });

  describe('Dummy Data Detection and Import', () => {
    it('detects and clears dummy data before import', async () => {
      // Create dummy data in the working directory
      const dummyContactsCsv = 'Name,Title,Email,Phone\nDummy User,Role,dummy@example.com,555-0000';
      await fs.writeFile(path.join(tmpDir, 'contacts.csv'), dummyContactsCsv);

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
        mailbox: 'MB1',
        vdpManager: 'VDP1',
        warden: 'Warden1',
        temperature: '70F'
      };

      const success = await fileManager.addServer(server);
      expect(success).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'servers.csv'), 'utf-8');
      expect(content).toContain('TestServer');
      expect(content).toContain('MB1');
    });

    it('removes a server by name', async () => {
      const csv = 'Name,Mailbox,Manager,Warden,Temperature\nServer1,MB1,VDP1,W1,70F\nServer2,MB2,VDP2,W2,68F';
      await fs.writeFile(path.join(tmpDir, 'servers.csv'), csv);

      const removed = await fileManager.removeServer('Server1');
      expect(removed).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'servers.csv'), 'utf-8');
      expect(content).not.toContain('Server1');
      expect(content).toContain('Server2');
    });
  });

  describe('Group Management', () => {
    it('creates a new group', async () => {
      const success = await fileManager.addGroup('TestGroup');
      expect(success).toBe(true);

      const groupFile = path.join(tmpDir, 'groups.csv');
      expect(existsSync(groupFile)).toBe(true);

      const content = await fs.readFile(groupFile, 'utf-8');
      expect(content).toContain('TestGroup');
    });

    it('adds members to a group', async () => {
      // Create group first
      await fileManager.addGroup('Team1');

      // Add member
      const success = await fileManager.updateGroupMembership('Team1', 'user@a.com', false);
      expect(success).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'groups.csv'), 'utf-8');
      expect(content).toContain('user@a.com');
    });

    it('removes members from a group', async () => {
      // Create group with members
      const csv = 'GroupName,Members\nTeam1,"user1@a.com, user2@a.com"';
      await fs.writeFile(path.join(tmpDir, 'groups.csv'), csv);

      const success = await fileManager.updateGroupMembership('Team1', 'user1@a.com', true);
      expect(success).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'groups.csv'), 'utf-8');
      expect(content).not.toContain('user1@a.com');
      expect(content).toContain('user2@a.com');
    });

    it('renames a group', async () => {
      const csv = 'GroupName,Members\nOldName,"user@a.com"';
      await fs.writeFile(path.join(tmpDir, 'groups.csv'), csv);

      const success = await fileManager.renameGroup('OldName', 'NewName');
      expect(success).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'groups.csv'), 'utf-8');
      expect(content).not.toContain('OldName');
      expect(content).toContain('NewName');
    });

    it('removes a group', async () => {
      const csv = 'GroupName,Members\nGroup1,"user1@a.com"\nGroup2,"user2@a.com"';
      await fs.writeFile(path.join(tmpDir, 'groups.csv'), csv);

      const success = await fileManager.removeGroup('Group1');
      expect(success).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, 'groups.csv'), 'utf-8');
      expect(content).not.toContain('Group1');
      expect(content).toContain('Group2');
    });
  });
});
