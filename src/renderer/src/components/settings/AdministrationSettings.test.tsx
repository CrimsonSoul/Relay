import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseRelayAdministration, mockUsePrivilegedAccess } = vi.hoisted(() => ({
  mockUseRelayAdministration: vi.fn(),
  mockUsePrivilegedAccess: vi.fn(),
}));

vi.mock('../../hooks/useRelayAdministration', () => ({
  useRelayAdministration: mockUseRelayAdministration,
}));
vi.mock('../../contexts/PrivilegedAccessContext', () => ({
  usePrivilegedAccess: mockUsePrivilegedAccess,
}));

import { AdministrationSettings } from './AdministrationSettings';

const componentsCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/components.css'),
  'utf8',
);

const snapshot = {
  operators: [
    {
      id: 'operator-admin',
      displayName: 'Ryan Bledsoe',
      active: true,
      revision: 2,
      role: 'admin',
      created: '2026-07-15T18:00:00.000Z',
      updated: '2026-07-15T19:00:00.000Z',
    },
    {
      id: 'operator-charles',
      displayName: 'Charles Gibbs',
      active: true,
      revision: 1,
      role: 'admin',
      created: '2026-07-15T18:00:00.000Z',
      updated: '2026-07-15T19:00:00.000Z',
    },
    {
      id: 'operator-publisher',
      displayName: 'Tristan Bowles',
      active: true,
      revision: 1,
      role: 'publisher',
      created: '2026-07-15T18:00:00.000Z',
      updated: '2026-07-15T19:00:00.000Z',
    },
    {
      id: 'operator-normal',
      displayName: 'Ryan Bell',
      active: true,
      revision: 0,
      role: null,
      created: '2026-07-15T18:00:00.000Z',
      updated: '2026-07-15T19:00:00.000Z',
    },
  ],
  privilegedAccounts: [
    {
      accountId: 'account-owner',
      operatorId: 'operator-admin',
      role: 'admin',
      active: true,
      credentialState: 'configured',
      mustChangePassword: false,
      credentialVersion: 1,
      updatedAt: '2026-07-15T19:00:00.000Z',
    },
    {
      accountId: 'account-charles',
      operatorId: 'operator-charles',
      role: 'admin',
      active: false,
      credentialState: 'not-configured',
      mustChangePassword: true,
      credentialVersion: 0,
      updatedAt: null,
    },
  ],
  devices: [],
  settings: [
    {
      setting: 'dynatrace.platform-token',
      configured: true,
      summary: 'Configured',
      revision: 1,
    },
  ],
  adminOperatorId: 'operator-admin',
  publisherOperatorId: 'operator-publisher',
  assignmentRevision: 3,
  generatedAt: '2026-07-15T20:00:00.000Z',
};

describe('AdministrationSettings', () => {
  const execute = vi.fn().mockResolvedValue({ ok: true, requestId: 'request-1', value: {} });
  const reauthenticate = vi.fn().mockResolvedValue({
    proofId: 'reauth-1',
    expiresAt: '2026-07-15T20:05:00.000Z',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRelayAdministration.mockReturnValue({
      snapshot,
      loading: false,
      error: null,
      canAdminister: true,
      refresh: vi.fn(),
      execute,
      clearError: vi.fn(),
    });
    mockUsePrivilegedAccess.mockReturnValue({
      session: { state: 'active', role: 'admin', operatorName: 'Ryan Bledsoe' },
      busy: null,
      reauthenticate,
    });
  });

  it('shows the authenticated administration workspace and role chips', () => {
    render(<AdministrationSettings relayMode="client" />);

    expect(screen.getByRole('heading', { name: 'Relay administration' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Operators' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('Ryan Bledsoe')).toHaveLength(2);
    expect(screen.getByText('OWNER')).toBeVisible();
    expect(screen.getAllByText('ADMIN')).toHaveLength(2);
    expect(screen.getByText('PUBLISHER')).toBeVisible();
    expect(screen.getByText('Charles Gibbs')).toBeVisible();
  });

  it('keeps every administrator out of the publisher picker and identifies account ownership', () => {
    render(<AdministrationSettings relayMode="server" />);

    fireEvent.click(screen.getByRole('tab', { name: 'Publisher' }));
    expect(screen.queryByRole('option', { name: 'Ryan Bledsoe' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Charles Gibbs' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
    expect(screen.getByText('Relay owner')).toBeVisible();
    expect(screen.getByText('Relay administrator')).toBeVisible();
  });

  it('does not expose administrator controls to a publisher session', () => {
    mockUseRelayAdministration.mockReturnValue({
      ...mockUseRelayAdministration(),
      snapshot: null,
      canAdminister: false,
    });
    mockUsePrivilegedAccess.mockReturnValue({
      ...mockUsePrivilegedAccess(),
      session: { state: 'active', role: 'publisher', operatorName: 'Tristan Bowles' },
    });

    render(<AdministrationSettings relayMode="client" />);

    expect(screen.queryByRole('heading', { name: 'Relay administration' })).toBeNull();
  });

  it('requires a fresh password before changing the designated publisher', async () => {
    render(<AdministrationSettings relayMode="client" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Publisher' }));
    fireEvent.change(screen.getByLabelText('Designated Knowledge Publisher'), {
      target: { value: 'operator-normal' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review publisher change' }));

    expect(screen.getByRole('dialog', { name: 'Confirm publisher change' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Administrator password'), {
      target: { value: 'a-long-private-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Assign publisher' }));

    await waitFor(() => expect(reauthenticate).toHaveBeenCalledWith('a-long-private-password'));
    expect(execute).toHaveBeenCalledWith({
      command: 'publisher.assign',
      payload: {
        operatorId: 'operator-normal',
        expectedStateRevision: 3,
        reauthRequestId: 'reauth-1',
      },
      expectedRevision: null,
    });
    expect(screen.queryByRole('dialog', { name: 'Confirm publisher change' })).toBeNull();
  });

  it('defines a compact selector and stacked rows below half-screen widths', () => {
    expect(componentsCss).toMatch(
      /@media \(max-width:\s*980px\)[\s\S]*\.administration-settings__rail\s*{[^}]*display:\s*none/,
    );
    expect(componentsCss).toMatch(
      /@media \(max-width:\s*680px\)[\s\S]*\.administration-row\s*{[^}]*grid-template-columns:\s*1fr/,
    );
  });
});
