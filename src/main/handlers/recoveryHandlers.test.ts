import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@shared/ipc';
import type { RelayRecoveryState } from '@shared/recovery';
import { setupRecoveryHandlers } from './recoveryHandlers';

describe('recovery handlers', () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler;
    }),
  };
  const state: RelayRecoveryState = {
    supported: true,
    status: 'ready',
    mode: 'client',
    currentBuildId: 'r2-current',
    currentVersion: '1.6.0',
    runningBuildId: 'r2-current',
    runningVersion: '1.6.0',
    fallbackActive: false,
    retainedBuilds: [],
  };
  const manager = {
    getState: vi.fn(async () => state),
    rollback: vi.fn(async () => ({ success: true as const, data: true })),
    repair: vi.fn(async () => ({ success: true as const, data: true })),
  };
  const runtime = {
    getView: vi.fn(() => ({
      state: 'active' as const,
      accountId: 'owner-account',
      username: 'owner',
      displayName: 'Relay Owner',
      role: 'owner' as const,
      capabilities: [],
      deviceId: 'device-1',
      expiresAt: '2026-08-24T16:10:00.000Z',
    })),
    reauthenticate: vi.fn(async () => ({
      proofId: 'proof-1',
      expiresAt: '2026-08-24T15:15:00.000Z',
    })),
  };
  const limiter = { tryConsume: vi.fn(() => ({ allowed: true })) };
  const networkLimiter = { tryConsume: vi.fn(() => ({ allowed: true })) };
  const assertTrustedIpcSender = vi.fn(() => true);

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(handlers)) delete handlers[key];
    setupRecoveryHandlers({
      ipcMain: ipcMain as never,
      getManager: () => manager,
      getRuntime: () => runtime as never,
      assertTrustedIpcSender,
      reauthenticationLimiter: limiter as never,
      networkLimiter: networkLimiter as never,
    });
  });

  const invoke = (channel: string, ...args: unknown[]) =>
    handlers[channel]?.({ sender: {} }, ...args);

  it('returns bounded recovery state only to the trusted renderer', async () => {
    await expect(invoke(IPC_CHANNELS.APP_RECOVERY_GET_STATE)).resolves.toEqual(state);
    assertTrustedIpcSender.mockReturnValueOnce(false);
    await expect(invoke(IPC_CHANNELS.APP_RECOVERY_GET_STATE)).resolves.toEqual({
      supported: false,
      status: 'unavailable',
      mode: 'unconfigured',
      currentBuildId: null,
      currentVersion: null,
      runningBuildId: null,
      runningVersion: null,
      fallbackActive: false,
      retainedBuilds: [],
    });
  });

  it('requires an active Owner and reauthenticates in main immediately before rollback', async () => {
    const input = {
      targetBuildId: 'r2-previous',
      password: 'correct horse battery staple',
    };

    await expect(invoke(IPC_CHANNELS.APP_RECOVERY_ROLLBACK, input)).resolves.toEqual({
      success: true,
      data: true,
    });
    expect(runtime.reauthenticate).toHaveBeenCalledWith(input.password);
    expect(manager.rollback).toHaveBeenCalledWith(input.targetBuildId);
    expect(runtime.reauthenticate.mock.invocationCallOrder[0]).toBeLessThan(
      manager.rollback.mock.invocationCallOrder[0]!,
    );
  });

  it('reauthenticates the Owner and rate-limits an exact-release runtime repair', async () => {
    const input = {
      targetBuildId: 'r2-previous',
      password: 'correct horse battery staple',
    };

    await expect(invoke(IPC_CHANNELS.APP_RECOVERY_REPAIR, input)).resolves.toEqual({
      success: true,
      data: true,
    });
    expect(networkLimiter.tryConsume).toHaveBeenCalledOnce();
    expect(runtime.reauthenticate).toHaveBeenCalledWith(input.password);
    expect(manager.repair).toHaveBeenCalledWith(input.targetBuildId);
  });

  it('fails closed for malformed input, non-owners, untrusted senders, and rate limiting', async () => {
    await expect(
      invoke(IPC_CHANNELS.APP_RECOVERY_ROLLBACK, {
        targetBuildId: '../outside',
        password: 'correct horse battery staple',
      }),
    ).resolves.toEqual({ success: false, error: 'invalid-input' });

    runtime.getView.mockReturnValueOnce({
      ...runtime.getView(),
      role: 'admin',
    } as never);
    await expect(
      invoke(IPC_CHANNELS.APP_RECOVERY_ROLLBACK, {
        targetBuildId: 'r2-previous',
        password: 'correct horse battery staple',
      }),
    ).resolves.toEqual({ success: false, error: 'unauthorized' });

    assertTrustedIpcSender.mockReturnValueOnce(false);
    await expect(
      invoke(IPC_CHANNELS.APP_RECOVERY_ROLLBACK, {
        targetBuildId: 'r2-previous',
        password: 'correct horse battery staple',
      }),
    ).resolves.toEqual({ success: false, error: 'untrusted-sender' });

    limiter.tryConsume.mockReturnValueOnce({ allowed: false });
    await expect(
      invoke(IPC_CHANNELS.APP_RECOVERY_ROLLBACK, {
        targetBuildId: 'r2-previous',
        password: 'correct horse battery staple',
      }),
    ).resolves.toEqual({ success: false, error: 'rate-limited', rateLimited: true });
    expect(manager.rollback).not.toHaveBeenCalled();
  });
});
