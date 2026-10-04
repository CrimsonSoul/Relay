import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RelayRecoveryState } from '@shared/recovery';

const { mockUsePrivilegedAccess } = vi.hoisted(() => ({ mockUsePrivilegedAccess: vi.fn() }));

vi.mock('../../contexts/PrivilegedAccessContext', () => ({
  usePrivilegedAccess: mockUsePrivilegedAccess,
}));

import { RecoverySettings } from './RecoverySettings';

const recoveryState: RelayRecoveryState = {
  supported: true,
  status: 'ready',
  mode: 'server',
  currentBuildId: 'build-2',
  currentVersion: '2.0.0',
  runningBuildId: 'build-2',
  runningVersion: '2.0.0',
  fallbackActive: false,
  retainedBuilds: [
    {
      buildId: 'build-1',
      version: '1.9.0',
      releaseTag: 'v1.9.0',
      installedAt: '2026-09-01T00:00:00.000Z',
      status: 'runtime-missing',
      rollbackAvailable: false,
      repairAvailable: true,
      githubFallbackAvailable: false,
    },
  ],
};

describe('RecoverySettings', () => {
  const originalApi = globalThis.api;

  afterEach(() => {
    globalThis.api = originalApi;
  });

  it('keeps reporting a successful repair when the follow-up status refresh fails', async () => {
    mockUsePrivilegedAccess.mockReturnValue({ session: { state: 'active', role: 'owner' } });
    const getRecoveryState = vi
      .fn()
      .mockResolvedValueOnce(recoveryState)
      .mockRejectedValueOnce(new Error('ipc failure'));
    globalThis.api = {
      getRecoveryState,
      repairRecoveryBuild: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as typeof globalThis.api;

    render(<RecoverySettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Repair v1.9.0 from GitHub' }));
    fireEvent.change(screen.getByLabelText('Owner password'), {
      target: { value: 'owner-password-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Repair' }));

    await waitFor(() => expect(getRecoveryState).toHaveBeenCalledTimes(2));
    await act(async () => {});

    expect(screen.getByText('v1.9.0 is repaired and ready to roll back.')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
