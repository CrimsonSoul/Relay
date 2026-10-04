import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  constructManager: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => 'relay-user-data', relaunch: vi.fn(), quit: vi.fn() },
}));
vi.mock('../logger', () => ({ loggers: { main: { warn: vi.fn() } } }));
vi.mock('../releases/RecoveryManager', () => ({
  RecoveryManager: class {
    getState: () => unknown;
    constructor() {
      this.getState = mocks.constructManager();
    }
  },
}));

import { createRecoveryHandlerRuntime } from './recoveryHandlerRuntime';

describe('createRecoveryHandlerRuntime', () => {
  it('retries creating the production recovery manager after a failed attempt', async () => {
    const recoveredState = { supported: true, status: 'ready' };
    mocks.constructManager
      .mockImplementationOnce(() => {
        throw new Error('catalog unreadable');
      })
      .mockImplementation(() => () => recoveredState);
    const runtime = createRecoveryHandlerRuntime({
      getRuntime: () => null,
      assertTrustedIpcSender: () => true,
    });
    const event = {} as IpcMainInvokeEvent;

    await expect(runtime.getState(event)).resolves.toMatchObject({ status: 'unavailable' });
    await expect(runtime.getState(event)).resolves.toBe(recoveredState);
  });
});
