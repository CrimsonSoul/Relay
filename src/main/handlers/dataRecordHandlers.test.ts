import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupDataRecordHandlers } from './dataRecordHandlers';
import { ipcMain } from 'electron';
import * as operations from '../operations';
import { IPC_CHANNELS } from '@shared/ipc';

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

// Mock operations
vi.mock('../operations', () => ({
  getContacts: vi.fn(),
  addContactRecord: vi.fn(),
  updateContactRecord: vi.fn(),
  deleteContactRecord: vi.fn(),
  getServers: vi.fn(),
  addServerRecord: vi.fn(),
  updateServerRecord: vi.fn(),
  deleteServerRecord: vi.fn(),
  getOnCall: vi.fn(),
  getGroups: vi.fn(),
  exportData: vi.fn(),
  importData: vi.fn(),
}));

// Mock rateLimiter
vi.mock('../rateLimiter', () => ({
  rateLimiters: {
    dataMutation: {
      tryConsume: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
    },
  },
}));

// Mock logger
vi.mock('../logger', () => ({
  loggers: {
    ipc: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe('dataRecordHandlers', () => {
  const handlers: Record<string, Function> = {};
  const dataRoot = '/test/data';
  const getDataRoot = async () => dataRoot;

  beforeEach(() => {
    vi.clearAllMocks();

    // Capture handlers registered with ipcMain.handle
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    setupDataRecordHandlers(getDataRoot);
  });

  describe('GET_CONTACTS', () => {
    it('should call getContacts with data root', async () => {
      const mockContacts = [{ name: 'Test' }];
      vi.mocked(operations.getContacts).mockResolvedValue(
        mockContacts as Awaited<ReturnType<typeof operations.getContacts>>,
      );

      const result = await handlers[IPC_CHANNELS.GET_CONTACTS]();

      expect(operations.getContacts).toHaveBeenCalledWith(dataRoot);
      expect(result).toEqual(mockContacts);
    });
  });

  describe('ADD_CONTACT_RECORD', () => {
    it('should validate and add contact record', async () => {
      const contact = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '1234567890',
        title: 'Engineer',
      };
      const mockResult = { id: '1' };
      vi.mocked(operations.addContactRecord).mockResolvedValue(
        mockResult as Awaited<ReturnType<typeof operations.addContactRecord>>,
      );

      const result = await handlers[IPC_CHANNELS.ADD_CONTACT_RECORD]({}, contact);

      expect(operations.addContactRecord).toHaveBeenCalledWith(dataRoot, contact);
      expect(result).toEqual({ success: true, data: mockResult });
    });

    it('should return error for invalid contact data', async () => {
      const invalidContact = { name: 'John' }; // Missing email

      const result = await handlers[IPC_CHANNELS.ADD_CONTACT_RECORD]({}, invalidContact);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid contact data');
      expect(operations.addContactRecord).not.toHaveBeenCalled();
    });
  });

  describe('UPDATE_CONTACT_RECORD', () => {
    it('should validate and update contact record', async () => {
      const id = '123';
      const updates = { title: 'Senior Engineer' };
      vi.mocked(operations.updateContactRecord).mockResolvedValue(true);

      const result = await handlers[IPC_CHANNELS.UPDATE_CONTACT_RECORD]({}, id, updates);

      expect(operations.updateContactRecord).toHaveBeenCalledWith(dataRoot, id, updates);
      expect(result.success).toBe(true);
    });

    it('should block updates with extra fields (strict schema)', async () => {
      const id = '123';
      const updates = { title: 'Senior Engineer', malicious: 'field' };

      const result = await handlers[IPC_CHANNELS.UPDATE_CONTACT_RECORD]({}, id, updates);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid update data');
    });
  });
});
