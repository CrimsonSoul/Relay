import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupDataHandlers } from './dataHandlers';
import { rateLimiters } from '../rateLimiter';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  app: {
    isPackaged: false,
  },
}));

vi.mock('../rateLimiter', () => ({
  rateLimiters: {
    dataMutation: {
      tryConsume: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
    },
    dataReload: {
      tryConsume: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
    },
  },
  checkNetworkRateLimit: vi.fn(() => true),
}));

vi.mock('../logger', () => ({
  loggers: {
    ipc: {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
  },
}));

describe('dataHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  const fileManager = {
    addContact: vi.fn(async () => true),
    removeContact: vi.fn(async () => true),
    updateOnCallTeam: vi.fn(async () => true),
    removeOnCallTeam: vi.fn(async () => true),
    renameOnCallTeam: vi.fn(async () => true),
    reorderOnCallTeams: vi.fn(async () => true),
    saveAllOnCall: vi.fn(async () => true),
    generateDummyData: vi.fn(async () => true),
    addServer: vi.fn(async () => true),
    removeServer: vi.fn(async () => true),
    readAndEmit: vi.fn(async () => undefined),
    getCachedData: vi.fn(() => ({
      groups: [{ id: 'g1' }],
      contacts: [{ email: 'a@example.com' }],
      servers: [{ name: 'srv' }],
      onCall: [{ team: 'SRE' }],
      teamLayout: {},
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimiters.dataMutation.tryConsume).mockReturnValue({
      allowed: true,
      retryAfterMs: 0,
    });
    vi.mocked(rateLimiters.dataReload.tryConsume).mockReturnValue({
      allowed: true,
      retryAfterMs: 0,
    });
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler as (...args: unknown[]) => Promise<unknown>;
    });
    (app as { isPackaged: boolean }).isPackaged = false;
    process.env.NODE_ENV = 'development';

    setupDataHandlers(
      () => null,
      () => fileManager as never,
    );
  });

  it('handles contact add/remove and validates invalid inputs', async () => {
    await expect(
      handlers[IPC_CHANNELS.ADD_CONTACT](
        {},
        {
          name: 'Alice',
          email: 'alice@example.com',
          phone: '555-0100',
          title: 'Ops',
        },
      ),
    ).resolves.toEqual({ success: true });
    await expect(handlers[IPC_CHANNELS.ADD_CONTACT]({}, { name: 'Only Name' })).resolves.toEqual({
      success: false,
      error: 'Invalid contact data',
    });

    await expect(handlers[IPC_CHANNELS.REMOVE_CONTACT]({}, 'alice@example.com')).resolves.toEqual({
      success: true,
    });
    await expect(handlers[IPC_CHANNELS.REMOVE_CONTACT]({}, '')).resolves.toEqual({
      success: false,
      error: 'Invalid email',
    });
  });

  it('handles on-call mutation channels', async () => {
    await expect(
      handlers[IPC_CHANNELS.UPDATE_ONCALL_TEAM]({}, 'SRE', [
        { id: '1', team: 'SRE', role: 'Primary', name: 'Alex', contact: 'a@example.com' },
      ]),
    ).resolves.toEqual({ success: true });

    await expect(handlers[IPC_CHANNELS.UPDATE_ONCALL_TEAM]({}, '', [])).resolves.toEqual({
      success: false,
      error: 'Invalid team name',
    });
    await expect(handlers[IPC_CHANNELS.SAVE_ALL_ONCALL]({}, [{ bad: true }])).resolves.toEqual({
      success: false,
      error: 'Invalid on-call data',
    });

    await expect(handlers[IPC_CHANNELS.REMOVE_ONCALL_TEAM]({}, 'SRE')).resolves.toEqual({
      success: true,
    });
    await expect(handlers[IPC_CHANNELS.RENAME_ONCALL_TEAM]({}, 'SRE', 'Ops')).resolves.toEqual({
      success: true,
    });
    await expect(
      handlers[IPC_CHANNELS.REORDER_ONCALL_TEAMS]({}, ['SRE'], { SRE: ['A', 'B'] }),
    ).resolves.toEqual({ success: true });
  });

  it('handles server mutations and rate-limited reload', async () => {
    await expect(
      handlers[IPC_CHANNELS.ADD_SERVER](
        {},
        {
          name: 'web-01',
          businessArea: 'Infra',
          lob: 'Core',
          comment: '',
          owner: 'owner@example.com',
          contact: 'tech@example.com',
          os: 'Linux',
        },
      ),
    ).resolves.toEqual({ success: true });
    await expect(handlers[IPC_CHANNELS.REMOVE_SERVER]({}, '')).resolves.toEqual({
      success: false,
      error: 'Invalid server name',
    });

    vi.mocked(rateLimiters.dataReload.tryConsume).mockReturnValue({
      allowed: false,
      retryAfterMs: 1,
    });
    await expect(handlers[IPC_CHANNELS.DATA_RELOAD]({})).resolves.toEqual({
      success: false,
      rateLimited: true,
    });
  });

  it('serves initial data and supports dummy-data generation', async () => {
    await expect(handlers[IPC_CHANNELS.DATA_GET_INITIAL]({})).resolves.toMatchObject({
      groups: [{ id: 'g1' }],
      contacts: [{ email: 'a@example.com' }],
      servers: [{ name: 'srv' }],
      onCall: [{ team: 'SRE' }],
    });

    await expect(handlers[IPC_CHANNELS.GENERATE_DUMMY_DATA]({})).resolves.toEqual({
      success: true,
    });

    (app as { isPackaged: boolean }).isPackaged = true;
    await expect(handlers[IPC_CHANNELS.GENERATE_DUMMY_DATA]({})).resolves.toEqual({
      success: false,
      error: 'Not available in production',
    });
  });
});
