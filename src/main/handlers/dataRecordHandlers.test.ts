import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupDataRecordHandlers } from './dataRecordHandlers';
import { ipcMain } from 'electron';
import * as operations from '../operations';
import { IPC_CHANNELS } from '@shared/ipc';
import { rateLimiters } from '../rateLimiter';

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
  addOnCallRecord: vi.fn(),
  updateOnCallRecord: vi.fn(),
  deleteOnCallRecord: vi.fn(),
  deleteOnCallByTeam: vi.fn(),
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
    vi.mocked(rateLimiters.dataMutation.tryConsume).mockReturnValue({
      allowed: true,
      retryAfterMs: 0,
    });

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

  describe('GET_SERVERS', () => {
    it('returns empty array when getServers throws', async () => {
      vi.mocked(operations.getServers).mockImplementation(() => {
        throw new Error('fail');
      });

      const result = await handlers[IPC_CHANNELS.GET_SERVERS]();

      expect(result).toEqual([]);
    });
  });

  describe('Server record mutations', () => {
    it('validates add/update/delete server flows', async () => {
      const server = {
        name: 'web-01',
        businessArea: 'Infra',
        lob: 'Core',
        comment: '',
        owner: 'owner@example.com',
        contact: 'tech@example.com',
        os: 'Linux',
      };
      vi.mocked(operations.addServerRecord).mockResolvedValue({ id: 's1' } as never);
      vi.mocked(operations.updateServerRecord).mockResolvedValue(true);
      vi.mocked(operations.deleteServerRecord).mockResolvedValue(true);

      await expect(handlers[IPC_CHANNELS.ADD_SERVER_RECORD]({}, server)).resolves.toEqual({
        success: true,
        data: { id: 's1' },
      });
      await expect(
        handlers[IPC_CHANNELS.UPDATE_SERVER_RECORD]({}, 's1', { os: 'Windows' }),
      ).resolves.toEqual({ success: true });
      await expect(handlers[IPC_CHANNELS.DELETE_SERVER_RECORD]({}, 's1')).resolves.toEqual({
        success: true,
      });

      await expect(
        handlers[IPC_CHANNELS.UPDATE_SERVER_RECORD]({}, '', { os: 'Linux' }),
      ).resolves.toEqual({ success: false, error: 'Invalid ID' });
    });
  });

  describe('On-call channels', () => {
    it('handles get/add/update/delete on-call records and team delete', async () => {
      vi.mocked(operations.getOnCall).mockResolvedValue([{ id: 'o1' }] as never);
      vi.mocked(operations.addOnCallRecord).mockResolvedValue({ id: 'o2' } as never);
      vi.mocked(operations.updateOnCallRecord).mockResolvedValue(true);
      vi.mocked(operations.deleteOnCallRecord).mockResolvedValue(true);
      vi.mocked(operations.deleteOnCallByTeam).mockResolvedValue(true);

      await expect(handlers[IPC_CHANNELS.GET_ONCALL]()).resolves.toEqual([{ id: 'o1' }]);
      await expect(
        handlers[IPC_CHANNELS.ADD_ONCALL_RECORD](
          {},
          {
            team: 'SRE',
            role: 'Primary',
            name: 'Alex',
            contact: 'alex@example.com',
            timeWindow: '24x7',
          },
        ),
      ).resolves.toEqual({ success: true, data: { id: 'o2' } });
      await expect(
        handlers[IPC_CHANNELS.UPDATE_ONCALL_RECORD]({}, 'o2', { role: 'Secondary' }),
      ).resolves.toEqual({ success: true });
      await expect(handlers[IPC_CHANNELS.DELETE_ONCALL_RECORD]({}, 'o2')).resolves.toEqual({
        success: true,
      });
      await expect(handlers[IPC_CHANNELS.DELETE_ONCALL_BY_TEAM]({}, 'SRE')).resolves.toEqual({
        success: true,
      });
      await expect(handlers[IPC_CHANNELS.DELETE_ONCALL_BY_TEAM]({}, '')).resolves.toEqual({
        success: false,
        error: 'Invalid team name',
      });
    });
  });

  describe('Data manager channels', () => {
    it('handles export/import validation and success', async () => {
      vi.mocked(operations.exportData).mockResolvedValue(true);
      vi.mocked(operations.importData).mockResolvedValue({
        success: true,
        imported: 3,
        updated: 0,
        skipped: 0,
        errors: [],
      });

      await expect(
        handlers[IPC_CHANNELS.EXPORT_DATA]({}, { category: 'contacts', format: 'json' }),
      ).resolves.toEqual({ success: true });
      await expect(handlers[IPC_CHANNELS.EXPORT_DATA]({}, { nope: true })).resolves.toEqual({
        success: false,
        error: 'Invalid export options',
      });

      await expect(handlers[IPC_CHANNELS.IMPORT_DATA]({}, 'contacts')).resolves.toEqual({
        success: true,
        data: {
          success: true,
          imported: 3,
          updated: 0,
          skipped: 0,
          errors: [],
        },
      });
      await expect(handlers[IPC_CHANNELS.IMPORT_DATA]({}, 'bad-category')).resolves.toEqual({
        success: false,
        error: 'Invalid category',
      });
    });

    it('returns rate-limited import response', async () => {
      vi.mocked(rateLimiters.dataMutation.tryConsume).mockReturnValue({
        allowed: false,
        retryAfterMs: 1000,
      });

      await expect(handlers[IPC_CHANNELS.IMPORT_DATA]({}, 'contacts')).resolves.toEqual({
        success: false,
        rateLimited: true,
        error: 'Rate limited',
      });
    });
  });

  describe('GET_DATA_STATS', () => {
    it('aggregates counts and lastUpdated values', async () => {
      vi.mocked(operations.getContacts).mockResolvedValue([
        { updatedAt: 10 },
        { updatedAt: 20 },
      ] as never);
      vi.mocked(operations.getServers).mockResolvedValue([{ updatedAt: 30 }] as never);
      vi.mocked(operations.getOnCall).mockResolvedValue([] as never);
      vi.mocked(operations.getGroups).mockResolvedValue([{ updatedAt: 15 }] as never);

      await expect(handlers[IPC_CHANNELS.GET_DATA_STATS]()).resolves.toEqual({
        contacts: { count: 2, lastUpdated: 20 },
        servers: { count: 1, lastUpdated: 30 },
        oncall: { count: 0, lastUpdated: 0 },
        groups: { count: 1, lastUpdated: 15 },
      });
    });

    it('returns empty stats when loading fails', async () => {
      vi.mocked(operations.getContacts).mockRejectedValue(new Error('oops'));

      await expect(handlers[IPC_CHANNELS.GET_DATA_STATS]()).resolves.toEqual({
        contacts: { count: 0, lastUpdated: 0 },
        servers: { count: 0, lastUpdated: 0 },
        oncall: { count: 0, lastUpdated: 0 },
        groups: { count: 0, lastUpdated: 0 },
      });
    });
  });
});
