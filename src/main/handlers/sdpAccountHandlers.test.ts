import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupSdpAccountHandlers } from './sdpAccountHandlers';
import { IPC_CHANNELS } from '@shared/ipc';
const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  once: vi.fn(),
  trusted: vi.fn(() => true),
  open: vi.fn(),
  invoke: vi.fn(),
  server: vi.fn(),
  packaged: false,
  save: vi.fn(),
  write: vi.fn(),
}));
vi.mock('electron', () => ({
  app: {
    once: mocks.once,
    get isPackaged() {
      return mocks.packaged;
    },
  },
  ipcMain: { handle: mocks.handle },
  shell: { openExternal: mocks.open },
  dialog: { showSaveDialog: mocks.save },
}));
vi.mock('node:fs/promises', () => ({ writeFile: mocks.write }));
vi.mock('../sdp/SdpRuntime', () => ({
  sdpBackend: { invoke: mocks.invoke },
  sdpServerCommand: mocks.server,
}));
vi.mock('../utils/trustedSender', () => ({ assertTrustedIpcSender: mocks.trusted }));
const sender = {};
function setup(role?: string) {
  setupSdpAccountHandlers(
    () => ({ webContents: sender }) as never,
    () => ({ getView: () => ({ state: 'active', role }) }) as never,
  );
  return {
    account: mocks.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.SDP_ACCOUNT)![1],
    server: mocks.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.SDP_SERVER)![1],
  };
}
describe('SDP account and administration IPC boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.packaged = false;
    mocks.trusted.mockReturnValue(true);
    mocks.invoke.mockResolvedValue({ view: { configured: true, status: 'disconnected' } });
    mocks.server.mockResolvedValue({ configured: false });
  });
  it('rejects web, subframe and popout callers', async () => {
    const { account, server } = setup('owner');
    expect((await account({ sender: {} }, { action: 'status' })).success).toBe(false);
    mocks.trusted.mockReturnValue(false);
    expect((await server({ sender }, { action: 'status' })).success).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.server).not.toHaveBeenCalled();
  });
  it('rejects client setup and arbitrary ticket identifiers on the user channel', async () => {
    const { account } = setup();
    for (const command of [
      { action: 'configure', client: { clientId: '1000.TEST', clientSecret: 'private' } },
      { action: 'readTestTicket', ticketId: '999' },
    ])
      expect((await account({ sender }, command)).success).toBe(false);
    expect((await account({ sender }, { action: 'status' })).success).toBe(true);
  });
  it('requires an existing active owner or admin session for server configuration', async () => {
    const { server } = setup();
    expect((await server({ sender }, { action: 'status' })).success).toBe(false);
    expect(mocks.server).not.toHaveBeenCalled();
    mocks.handle.mockClear();
    const admin = setup('admin');
    expect((await admin.server({ sender }, { action: 'status' })).success).toBe(true);
  });
  it('keeps cache clearing out of packaged builds', async () => {
    const { account } = setup();
    mocks.packaged = true;
    expect((await account({ sender }, { action: 'clearCopies' })).success).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
    const result = await account({ sender }, { action: 'status' });
    expect(result.data.testControls).toBe(false);
    mocks.packaged = false;
    expect((await account({ sender }, { action: 'status' })).data.testControls).toBe(true);
  });
});

it('keeps attachment bytes in the desktop process and saves only after the native dialog accepts', async () => {
  const { account } = setup();
  const data = Buffer.from('dummy attachment').toString('base64');
  mocks.invoke.mockResolvedValue({
    view: {
      configured: true,
      status: 'connected',
      attachmentFile: { name: 'example.txt', contentType: 'text/plain', data },
    },
  });
  mocks.save.mockResolvedValueOnce({ canceled: true });
  const command = { action: 'downloadAttachment', id: '123', attachmentId: '4' };
  const cancelled = await account({ sender }, command);
  expect(cancelled.data.message).toBe('Download cancelled.');
  expect(JSON.stringify(cancelled)).not.toContain(data);
  expect(mocks.write).not.toHaveBeenCalled();
  mocks.save.mockResolvedValueOnce({ canceled: false, filePath: '/chosen/example.txt' });
  const saved = await account({ sender }, command);
  expect(saved.data.message).toBe('Attachment saved.');
  expect(saved.data.attachmentFile).toBeUndefined();
  expect(mocks.write).toHaveBeenCalledWith('/chosen/example.txt', Buffer.from('dummy attachment'), {
    mode: 0o600,
  });
});
