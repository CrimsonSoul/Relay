import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
    send: electronMocks.send,
  },
}));

describe('preload Knowledge web link bridge', () => {
  let api: BridgeAPI;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    electronMocks.invoke.mockResolvedValue({ ok: true });

    await import('./index');

    expect(electronMocks.exposeInMainWorld).toHaveBeenCalledWith('api', expect.any(Object));
    api = electronMocks.exposeInMainWorld.mock.calls[0][1] as BridgeAPI;
  });

  it('invokes the dedicated Knowledge web link channel with the URL', async () => {
    const url = 'https://docs.example.com/runbook?incident=123';

    expect(api.openKnowledgeWebLink).toBeTypeOf('function');
    await expect(api.openKnowledgeWebLink(url)).resolves.toEqual({ ok: true });
    expect(electronMocks.invoke).toHaveBeenCalledWith('knowledge:openWebLink', url);
  });
});
