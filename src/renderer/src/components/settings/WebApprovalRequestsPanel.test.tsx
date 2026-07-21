import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import { WebApprovalRequestsPanel } from './WebApprovalRequestsPanel';

const request = {
  requestId: 'approval-1',
  operation: 'initial-owner-credential' as const,
  sourceLabel: 'Chrome from 10.0.0.8',
  createdAt: '2026-07-20T12:00:00.000Z',
  expiresAt: '2026-07-20T12:10:00.000Z',
};

describe('WebApprovalRequestsPanel', () => {
  const listWebApprovalRequests = vi.fn();
  const generateWebApprovalCode = vi.fn();
  const cancelWebApprovalRequest = vi.fn();
  let listener: ((requests: (typeof request)[]) => void) | null;

  beforeEach(() => {
    vi.clearAllMocks();
    listener = null;
    listWebApprovalRequests.mockResolvedValue([request]);
    generateWebApprovalCode.mockResolvedValue({
      ok: true,
      value: { request, code: '123456' },
    });
    cancelWebApprovalRequest.mockResolvedValue(true);
    globalThis.api = {
      runtime: ELECTRON_RUNTIME,
      listWebApprovalRequests,
      generateWebApprovalCode,
      cancelWebApprovalRequest,
      onWebApprovalRequestsChanged: vi.fn((callback) => {
        listener = callback;
        return vi.fn();
      }),
    } as never;
  });

  it('lists, generates, and cancels one-use browser approvals on the server desktop', async () => {
    render(<WebApprovalRequestsPanel relayMode="server" />);

    expect(await screen.findByText('Chrome from 10.0.0.8')).toBeVisible();
    expect(screen.getByText('Initial Owner credential')).toBeVisible();
    expect(screen.queryByText('123456')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Generate approval code' }));
    expect(await screen.findByText('123456')).toBeVisible();
    expect(generateWebApprovalCode).toHaveBeenCalledWith('approval-1');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel approval request' }));
    await waitFor(() => expect(cancelWebApprovalRequest).toHaveBeenCalledWith('approval-1'));
    listener?.([]);
    expect(screen.queryByText('Chrome from 10.0.0.8')).toBeNull();
  });

  it('renders nothing outside the server Electron runtime', () => {
    const { rerender } = render(<WebApprovalRequestsPanel relayMode="client" />);
    expect(screen.queryByText('Browser approval requests')).toBeNull();

    globalThis.api = { ...globalThis.api, runtime: WEB_RUNTIME } as never;
    rerender(<WebApprovalRequestsPanel relayMode="server" />);
    expect(screen.queryByText('Browser approval requests')).toBeNull();
    expect(listWebApprovalRequests).not.toHaveBeenCalled();
  });
});
