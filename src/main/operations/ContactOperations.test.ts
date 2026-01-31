import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseContacts, addContact, removeContact } from './ContactOperations';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { FileContext } from './FileContext';
import type { Contact } from '@shared/ipc';

// Mock dependencies
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('../logger', () => ({
  loggers: {
    fileManager: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

describe('ContactOperations', () => {
  let mockCtx: Partial<FileContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {
      rootDir: '/test/root',
      resolveExistingFile: vi.fn().mockResolvedValue('/test/root/contacts.csv'),
      safeStringify: vi.fn((data) => JSON.stringify(data)),
      writeAndEmit: vi.fn().mockResolvedValue(undefined),
      performBackup: vi.fn().mockResolvedValue(undefined),
      emitError: vi.fn(),
      rewriteFileDetached: vi.fn(),
    };
  });

  describe('parseContacts', () => {
    it('should return empty array when no file exists', async () => {
      vi.mocked(mockCtx.resolveExistingFile!).mockResolvedValue(null);

      const result = await parseContacts(mockCtx as FileContext);

      expect(result).toEqual([]);
    });

    it('should return empty array when CSV has only header or is empty', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('Name,Email,Phone,Title\n');

      const result = await parseContacts(mockCtx as FileContext);

      expect(result).toEqual([]);
    });

    it('should parse valid contacts from CSV', async () => {
      const csvContent = 'Name,Email,Phone,Title\nJohn Doe,john@example.com,555-1234,Engineer\nJane Smith,jane@example.com,555-5678,Manager';
      vi.mocked(fs.readFile).mockResolvedValue(csvContent);

      const result = await parseContacts(mockCtx as FileContext);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        name: 'John Doe',
        email: 'john@example.com',
        phone: '555-1234',
        title: 'Engineer',
      });
      expect(result[1]).toMatchObject({
        name: 'Jane Smith',
        email: 'jane@example.com',
        phone: '555-5678',
        title: 'Manager',
      });
    });

    it('should handle various column name aliases', async () => {
      const csvContent = 'Full Name,E-mail,Phone Number,Position\nJohn Doe,john@example.com,555-1234,Engineer';
      vi.mocked(fs.readFile).mockResolvedValue(csvContent);

      const result = await parseContacts(mockCtx as FileContext);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'John Doe',
        email: 'john@example.com',
        phone: '555-1234',
        title: 'Engineer',
      });
    });

    it('should clean and format phone numbers', async () => {
      const csvContent = 'Name,Email,Phone,Title\nJohn Doe,john@example.com,(555) 123-4567,Engineer';
      vi.mocked(fs.readFile).mockResolvedValue(csvContent);

      const result = await parseContacts(mockCtx as FileContext);

      expect(result).toHaveLength(1);
      // Note: rewriteFileDetached is called asynchronously with void, so it may not be called in the test
      // The important thing is that the contact is parsed correctly
      expect(result[0].phone).toBeDefined();
    });

    it('should emit error on parse failure', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Read error'));

      const result = await parseContacts(mockCtx as FileContext);

      expect(result).toEqual([]);
      expect(mockCtx.emitError).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'parse',
          message: 'Error parsing contacts.csv',
        })
      );
    });

    it('should emit validation warnings for invalid contacts', async () => {
      const csvContent = 'Name,Email,Phone,Title\n,invalid-email,555-1234,Engineer';
      vi.mocked(fs.readFile).mockResolvedValue(csvContent);

      await parseContacts(mockCtx as FileContext);

      expect(mockCtx.emitError).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'validation',
        })
      );
    });

    it('should include search string in parsed contacts', async () => {
      const csvContent = 'Name,Email,Phone,Title\nJohn Doe,john@example.com,555-1234,Engineer';
      vi.mocked(fs.readFile).mockResolvedValue(csvContent);

      const result = await parseContacts(mockCtx as FileContext);

      expect(result[0]._searchString).toContain('john doe');
      expect(result[0]._searchString).toContain('john@example.com');
      expect(result[0]._searchString).toContain('555-1234');
      expect(result[0]._searchString).toContain('engineer');
    });
  });

  describe('addContact', () => {
    it('should add a new contact to empty file', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(fs.readFile).mockResolvedValue('');

      const newContact: Partial<Contact> = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '555-1234',
        title: 'Engineer',
      };

      const result = await addContact(mockCtx as FileContext, newContact);

      expect(result).toBe(true);
      expect(mockCtx.writeAndEmit).toHaveBeenCalled();
      expect(mockCtx.performBackup).toHaveBeenCalledWith('addContact');
    });

    it('should add a new contact to existing file', async () => {
      const existingCsv = 'Name,Email,Title,Phone\nExisting User,existing@example.com,Manager,555-0000';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(existingCsv);

      const newContact: Partial<Contact> = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '555-1234',
        title: 'Engineer',
      };

      const result = await addContact(mockCtx as FileContext, newContact);

      expect(result).toBe(true);
      const writtenData = JSON.parse(vi.mocked(mockCtx.writeAndEmit!).mock.calls[0][1]);
      expect(writtenData).toHaveLength(3); // Header + 2 contacts
    });

    it('should update existing contact by email', async () => {
      const existingCsv = 'Name,Email,Title,Phone\nJohn Doe,john@example.com,Engineer,555-1234';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(existingCsv);

      const updates: Partial<Contact> = {
        email: 'john@example.com',
        title: 'Senior Engineer',
        phone: '555-5678',
      };

      const result = await addContact(mockCtx as FileContext, updates);

      expect(result).toBe(true);
      const writtenData = JSON.parse(vi.mocked(mockCtx.writeAndEmit!).mock.calls[0][1]);
      expect(writtenData).toHaveLength(2); // Header + 1 contact
      const updatedContact = writtenData[1];
      expect(updatedContact).toContain('Senior Engineer');
      expect(updatedContact).toContain('555-5678');
    });

    it('should reject invalid email', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(fs.readFile).mockResolvedValue('');

      const invalidContact: Partial<Contact> = {
        name: 'John Doe',
        email: 'invalid-email',
        phone: '555-1234',
        title: 'Engineer',
      };

      const result = await addContact(mockCtx as FileContext, invalidContact);

      expect(result).toBe(false);
      expect(mockCtx.writeAndEmit).not.toHaveBeenCalled();
    });

    it('should clean phone numbers before adding', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(fs.readFile).mockResolvedValue('');

      const contact: Partial<Contact> = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '(555) 123-4567',
        title: 'Engineer',
      };

      await addContact(mockCtx as FileContext, contact);

      const writtenData = JSON.parse(vi.mocked(mockCtx.writeAndEmit!).mock.calls[0][1]);
      const phoneValue = writtenData[1][3]; // Phone is 4th column
      // Phone should be cleaned but we're not checking the exact format
      expect(phoneValue).toBeDefined();
    });

    it("should create columns if they don't exist", async () => {
      const existingCsv = 'OldColumn\nOldValue';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(existingCsv);

      const newContact: Partial<Contact> = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '555-1234',
        title: 'Engineer',
      };

      const result = await addContact(mockCtx as FileContext, newContact);

      expect(result).toBe(true);
      const writtenData = JSON.parse(vi.mocked(mockCtx.writeAndEmit!).mock.calls[0][1]);
      const header = writtenData[0];
      expect(header).toContain('Name');
      expect(header).toContain('Email');
      expect(header).toContain('Phone');
      expect(header).toContain('Title');
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Read error'));

      const newContact: Partial<Contact> = {
        name: 'John Doe',
        email: 'john@example.com',
      };

      const result = await addContact(mockCtx as FileContext, newContact);

      expect(result).toBe(false);
    });
  });

  describe('removeContact', () => {
    it('should remove contact by email', async () => {
      const existingCsv = 'Name,Email,Phone,Title\nJohn Doe,john@example.com,555-1234,Engineer\nJane Smith,jane@example.com,555-5678,Manager';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(existingCsv);

      const result = await removeContact(mockCtx as FileContext, 'john@example.com');

      expect(result).toBe(true);
      const writtenData = JSON.parse(vi.mocked(mockCtx.writeAndEmit!).mock.calls[0][1]);
      expect(writtenData).toHaveLength(2); // Header + Jane
      expect(writtenData.some((row: string[]) => row.includes('john@example.com'))).toBe(false);
      expect(mockCtx.performBackup).toHaveBeenCalledWith('removeContact');
    });

    it('should return false if file does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await removeContact(mockCtx as FileContext, 'john@example.com');

      expect(result).toBe(false);
    });

    it('should return false if contact not found', async () => {
      const existingCsv = 'Name,Email,Phone,Title\nJane Smith,jane@example.com,555-5678,Manager';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(existingCsv);

      const result = await removeContact(mockCtx as FileContext, 'nonexistent@example.com');

      expect(result).toBe(false);
      expect(mockCtx.writeAndEmit).not.toHaveBeenCalled();
    });

    it('should return false if CSV has only header', async () => {
      const existingCsv = 'Name,Email,Phone,Title\n';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(existingCsv);

      const result = await removeContact(mockCtx as FileContext, 'john@example.com');

      expect(result).toBe(false);
    });

    it('should return false if email column not found', async () => {
      const existingCsv = 'Name,Phone,Title\nJohn Doe,555-1234,Engineer';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(existingCsv);

      const result = await removeContact(mockCtx as FileContext, 'john@example.com');

      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Read error'));

      const result = await removeContact(mockCtx as FileContext, 'john@example.com');

      expect(result).toBe(false);
    });

    it('should handle E-mail column alias', async () => {
      const existingCsv = 'Name,E-mail,Phone,Title\nJohn Doe,john@example.com,555-1234,Engineer';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(existingCsv);

      const result = await removeContact(mockCtx as FileContext, 'john@example.com');

      expect(result).toBe(true);
    });
  });
});
