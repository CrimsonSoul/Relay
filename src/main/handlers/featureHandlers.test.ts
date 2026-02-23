import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import * as operations from '../operations';
import { setupFeatureHandlers } from './featureHandlers';
import { rateLimiters } from '../rateLimiter';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('../operations', () => ({
  getGroups: vi.fn(),
  saveGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  getBridgeHistory: vi.fn(),
  addBridgeHistory: vi.fn(),
  deleteBridgeHistory: vi.fn(),
  clearBridgeHistory: vi.fn(),
  getNotes: vi.fn(),
  setContactNote: vi.fn(),
  setServerNote: vi.fn(),
  getSavedLocations: vi.fn(),
  saveLocation: vi.fn(),
  deleteLocation: vi.fn(),
  setDefaultLocation: vi.fn(),
  clearDefaultLocation: vi.fn(),
  updateLocation: vi.fn(),
}));

vi.mock('../rateLimiter', () => ({
  rateLimiters: {
    dataMutation: {
      tryConsume: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
    },
  },
}));

vi.mock('../logger', () => ({
  loggers: {
    ipc: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe('featureHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  // eslint-disable-next-line sonarjs/publicly-writable-directories
  const getDataRoot = vi.fn(async () => '/tmp/relay');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimiters.dataMutation.tryConsume).mockReturnValue({
      allowed: true,
      retryAfterMs: 0,
    });
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler as (...args: unknown[]) => Promise<unknown>;
    });
    setupFeatureHandlers(getDataRoot);
  });

  it('returns groups and falls back to empty on failure', async () => {
    vi.mocked(operations.getGroups).mockResolvedValue([{ name: 'NOC' }] as never);
    await expect(handlers[IPC_CHANNELS.GET_GROUPS]()).resolves.toEqual([{ name: 'NOC' }]);

    vi.mocked(operations.getGroups).mockRejectedValue(new Error('boom'));
    await expect(handlers[IPC_CHANNELS.GET_GROUPS]()).resolves.toEqual([]);
  });

  it('validates and saves group payloads', async () => {
    vi.mocked(operations.saveGroup).mockResolvedValue({
      id: 'g1',
      name: 'NOC',
      contacts: [],
    } as never);

    await expect(handlers[IPC_CHANNELS.SAVE_GROUP]({}, { invalid: true })).resolves.toEqual({
      success: false,
      error: 'Invalid group data',
    });

    await expect(
      handlers[IPC_CHANNELS.SAVE_GROUP]({}, { name: 'NOC', contacts: ['a@example.com'] }),
    ).resolves.toEqual({
      success: true,
      data: { id: 'g1', name: 'NOC', contacts: [] },
    });
  });

  it('handles group updates and deletions with id checks', async () => {
    vi.mocked(operations.updateGroup).mockResolvedValue(true);
    vi.mocked(operations.deleteGroup).mockResolvedValue(true);

    await expect(handlers[IPC_CHANNELS.UPDATE_GROUP]({}, '', { name: 'x' })).resolves.toEqual({
      success: false,
      error: 'Invalid ID',
    });
    await expect(
      handlers[IPC_CHANNELS.UPDATE_GROUP]({}, 'g1', { name: 'Ops', contacts: ['a@example.com'] }),
    ).resolves.toEqual({ success: true });

    await expect(handlers[IPC_CHANNELS.DELETE_GROUP]({}, '')).resolves.toEqual({
      success: false,
      error: 'Invalid ID',
    });
    await expect(handlers[IPC_CHANNELS.DELETE_GROUP]({}, 'g1')).resolves.toEqual({ success: true });
  });

  it('handles bridge history channels', async () => {
    vi.mocked(operations.getBridgeHistory).mockResolvedValue([{ id: 'b1' }] as never);
    vi.mocked(operations.addBridgeHistory).mockResolvedValue({ id: 'b1' } as never);
    vi.mocked(operations.deleteBridgeHistory).mockResolvedValue(true);
    vi.mocked(operations.clearBridgeHistory).mockResolvedValue(true);

    await expect(handlers[IPC_CHANNELS.GET_BRIDGE_HISTORY]()).resolves.toEqual([{ id: 'b1' }]);
    await expect(
      handlers[IPC_CHANNELS.ADD_BRIDGE_HISTORY](
        {},
        {
          note: 'Bridge started',
          groups: ['Dispatch'],
          contacts: ['ops@example.com'],
          recipientCount: 1,
        },
      ),
    ).resolves.toEqual({ success: true, data: { id: 'b1' } });

    await expect(handlers[IPC_CHANNELS.DELETE_BRIDGE_HISTORY]({}, 'b1')).resolves.toEqual({
      success: true,
    });
    await expect(handlers[IPC_CHANNELS.CLEAR_BRIDGE_HISTORY]({})).resolves.toEqual({
      success: true,
    });
  });

  it('validates notes handlers and enforces note limits', async () => {
    vi.mocked(operations.getNotes).mockResolvedValue({ contacts: {}, servers: {} } as never);
    vi.mocked(operations.setContactNote).mockResolvedValue(true);
    vi.mocked(operations.setServerNote).mockResolvedValue(true);

    await expect(handlers[IPC_CHANNELS.GET_NOTES]()).resolves.toEqual({
      contacts: {},
      servers: {},
    });
    await expect(handlers[IPC_CHANNELS.SET_CONTACT_NOTE]({}, '', 'note', [])).resolves.toEqual({
      success: false,
      error: 'Invalid parameters',
    });
    await expect(
      handlers[IPC_CHANNELS.SET_CONTACT_NOTE]({}, 'a@example.com', 'hello', ['team']),
    ).resolves.toEqual({ success: true });

    await expect(handlers[IPC_CHANNELS.SET_SERVER_NOTE]({}, 'srv', 'note', ['x'])).resolves.toEqual(
      {
        success: true,
      },
    );
    await expect(
      handlers[IPC_CHANNELS.SET_SERVER_NOTE]({}, 'srv', 'a'.repeat(10001), []),
    ).resolves.toEqual({
      success: false,
      error: 'Invalid parameters',
    });
  });

  it('handles saved location channels including invalid payloads', async () => {
    vi.mocked(operations.getSavedLocations).mockResolvedValue([{ id: 'l1' }] as never);
    vi.mocked(operations.saveLocation).mockResolvedValue({ id: 'l2' } as never);
    vi.mocked(operations.deleteLocation).mockResolvedValue(true);
    vi.mocked(operations.setDefaultLocation).mockResolvedValue(true);
    vi.mocked(operations.clearDefaultLocation).mockResolvedValue(true);
    vi.mocked(operations.updateLocation).mockResolvedValue(true);

    await expect(handlers[IPC_CHANNELS.GET_SAVED_LOCATIONS]()).resolves.toEqual([{ id: 'l1' }]);
    await expect(
      handlers[IPC_CHANNELS.SAVE_LOCATION](
        {},
        { name: 'Austin', lat: 30.2, lon: -97.7, isDefault: true },
      ),
    ).resolves.toEqual({ success: true, data: { id: 'l2' } });

    await expect(handlers[IPC_CHANNELS.DELETE_LOCATION]({}, '')).resolves.toEqual({
      success: false,
      error: 'Invalid ID',
    });
    await expect(handlers[IPC_CHANNELS.DELETE_LOCATION]({}, 'l1')).resolves.toEqual({
      success: true,
    });
    await expect(handlers[IPC_CHANNELS.SET_DEFAULT_LOCATION]({}, 'l1')).resolves.toEqual({
      success: true,
    });
    await expect(handlers[IPC_CHANNELS.CLEAR_DEFAULT_LOCATION]({}, 'l1')).resolves.toEqual({
      success: true,
    });

    await expect(handlers[IPC_CHANNELS.UPDATE_LOCATION]({}, 'l1', { lat: 999 })).resolves.toEqual({
      success: false,
      error: 'Invalid update data',
    });
    await expect(
      handlers[IPC_CHANNELS.UPDATE_LOCATION]({}, 'l1', { name: 'Austin 2' }),
    ).resolves.toEqual({ success: true });
  });

  it('returns rate-limited response when mutation limit denies', async () => {
    vi.mocked(rateLimiters.dataMutation.tryConsume).mockReturnValue({
      allowed: false,
      retryAfterMs: 5000,
    });

    await expect(handlers[IPC_CHANNELS.DELETE_GROUP]({}, 'g1')).resolves.toEqual({
      success: false,
      rateLimited: true,
    });
  });

  it('safeMutation wrapper converts thrown errors to IPC failure results', async () => {
    vi.mocked(operations.saveLocation).mockRejectedValue(new Error('db unavailable'));

    await expect(
      handlers[IPC_CHANNELS.SAVE_LOCATION]({}, { name: 'Austin', lat: 30.2, lon: -97.7 }),
    ).resolves.toEqual({ success: false, error: 'db unavailable' });
  });

  it('UPDATE_GROUP returns error when update payload fails schema validation', async () => {
    // Pass a name that exceeds max length to trigger schema validation failure
    await expect(handlers[IPC_CHANNELS.UPDATE_GROUP]({}, 'g1', { name: 123 })).resolves.toEqual({
      success: false,
      error: 'Invalid update data',
    });
  });

  it('GET_BRIDGE_HISTORY falls back to empty array on exception', async () => {
    vi.mocked(operations.getBridgeHistory).mockRejectedValue(new Error('disk error'));
    await expect(handlers[IPC_CHANNELS.GET_BRIDGE_HISTORY]()).resolves.toEqual([]);
  });

  it('ADD_BRIDGE_HISTORY returns error when entry fails schema validation', async () => {
    // Pass payload that does not match BridgeHistoryEntrySchema
    await expect(
      handlers[IPC_CHANNELS.ADD_BRIDGE_HISTORY]({}, { invalidKey: true }),
    ).resolves.toEqual({ success: false, error: 'Invalid entry data' });
  });
});
