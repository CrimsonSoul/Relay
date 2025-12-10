
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
  let fileManager: FileManager;
  let mockWindow: any;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-test-'));
    // Use the mocked class
    mockWindow = new BrowserWindow();
    fileManager = new FileManager(mockWindow as unknown as BrowserWindow, tmpDir);
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
});
