import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayAdministrationSnapshot } from '@shared/privilegedAccess';

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

const snapshot: RelayAdministrationSnapshot = {
  accounts: [
    {
      accountId: 'account-owner',
      username: 'ryan',
      displayName: 'Ryan Bledsoe',
      storedRole: 'administrator',
      effectiveRole: 'owner',
      active: true,
      credentialState: 'configured',
      mustChangePassword: false,
      credentialVersion: 1,
      revision: 2,
      createdAt: '2026-07-15T18:00:00.000Z',
      updatedAt: '2026-07-15T19:00:00.000Z',
    },
    {
      accountId: 'account-charles',
      username: 'charles',
      displayName: 'Charles Gibbs',
      storedRole: 'administrator',
      effectiveRole: 'admin',
      active: true,
      credentialState: 'configured',
      mustChangePassword: false,
      credentialVersion: 1,
      revision: 1,
      createdAt: '2026-07-15T18:00:00.000Z',
      updatedAt: '2026-07-15T19:00:00.000Z',
    },
    {
      accountId: 'account-publisher',
      username: 'publisher',
      displayName: 'Tristan Bowles',
      storedRole: 'publisher',
      effectiveRole: 'publisher',
      active: true,
      credentialState: 'configured',
      mustChangePassword: false,
      credentialVersion: 1,
      revision: 1,
      createdAt: '2026-07-15T18:00:00.000Z',
      updatedAt: '2026-07-15T19:00:00.000Z',
    },
  ],
  devices: [],
  settings: [],
  ownerAccountId: 'account-owner',
  publisherAccountId: 'account-publisher',
  assignmentRevision: 3,
  generatedAt: '2026-07-15T20:00:00.000Z',
};

describe('AdministrationSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRelayAdministration.mockReturnValue({
      snapshot,
      loading: false,
      error: null,
      canAdminister: true,
      refresh: vi.fn(),
      execute: vi.fn(),
      clearError: vi.fn(),
    });
    mockUsePrivilegedAccess.mockReturnValue({
      session: {
        state: 'active',
        accountId: 'account-owner',
        role: 'owner',
        displayName: 'Ryan Bledsoe',
      },
    });
  });

  it('replaces the former Operator, Publisher, and Accounts rails with one Accounts & roles surface', () => {
    render(<AdministrationSettings relayMode="client" />);

    expect(screen.getByRole('tab', { name: 'Accounts & roles' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByRole('tab', { name: 'Operators' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Publisher' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Accounts' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Devices' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Relay server' })).toBeVisible();
  });

  it.each([
    ['owner', 'OWNER'],
    ['admin', 'ADMIN'],
  ] as const)('shows the authenticated effective %s role in the header', (role, label) => {
    mockUsePrivilegedAccess.mockReturnValue({
      session: {
        state: 'active',
        accountId: `account-${role}`,
        role,
        displayName: 'Authenticated',
      },
    });
    const { container } = render(<AdministrationSettings relayMode="server" />);

    expect(
      within(container.querySelector('.administration-settings__session')!).getByText(label),
    ).toBeVisible();
    expect(screen.getByText('Authenticated')).toBeVisible();
  });

  it('does not infer Owner from the display name', () => {
    mockUsePrivilegedAccess.mockReturnValue({
      session: {
        state: 'active',
        accountId: 'account-not-owner',
        role: 'admin',
        displayName: 'Ryan Bledsoe',
      },
    });
    const { container } = render(<AdministrationSettings relayMode="server" />);

    const sessionHeader = within(container.querySelector('.administration-settings__session')!);
    expect(sessionHeader.getByText('ADMIN')).toBeVisible();
    expect(sessionHeader.queryByText('OWNER')).toBeNull();
  });

  it('does not expose administration to a Publisher session', () => {
    mockUseRelayAdministration.mockReturnValue({
      ...mockUseRelayAdministration(),
      snapshot: null,
      canAdminister: false,
    });
    mockUsePrivilegedAccess.mockReturnValue({
      session: {
        state: 'active',
        accountId: 'account-publisher',
        role: 'publisher',
        displayName: 'Tristan Bowles',
      },
    });
    render(<AdministrationSettings relayMode="client" />);

    expect(screen.queryByRole('heading', { name: 'Relay administration' })).toBeNull();
  });

  it('switches between the three administration surfaces', () => {
    render(<AdministrationSettings relayMode="client" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Devices' }));
    expect(screen.getByRole('heading', { name: 'Paired workstations' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Relay server' }));
    expect(screen.getByRole('heading', { name: 'Relay & Dynatrace' })).toBeVisible();
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
