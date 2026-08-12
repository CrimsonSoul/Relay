import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const settingsCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/settings/settings.css'),
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

    expect(screen.getByRole('link', { name: 'Accounts & roles' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('link', { name: 'Operators' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Publisher' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Accounts' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Devices' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Relay server' })).toBeVisible();
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
    fireEvent.click(screen.getByRole('link', { name: 'Devices' }));
    expect(screen.getByRole('heading', { name: 'Paired workstations' })).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Relay server' }));
    expect(screen.getByRole('heading', { name: 'Relay & Dynatrace' })).toBeVisible();
  });

  it('uses the shared confirmation shell for paired-device revocation', () => {
    mockUseRelayAdministration.mockReturnValue({
      snapshot: {
        ...snapshot,
        devices: [
          {
            id: 'device-record-1',
            deviceId: 'device-1',
            accountId: 'account-owner',
            username: 'ryan',
            displayName: 'Ryan Bledsoe',
            label: 'NOC workstation',
            hostname: 'noc-01',
            state: 'active',
            lastSeenAt: '2026-07-15T20:00:00.000Z',
            fingerprintSuffix: 'ABCD',
            revision: 1,
          },
        ],
      },
      loading: false,
      error: null,
      canAdminister: true,
      refresh: vi.fn(),
      execute: vi.fn(),
      clearError: vi.fn(),
    });

    render(<AdministrationSettings relayMode="client" />);
    fireEvent.click(screen.getByRole('link', { name: 'Devices' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(screen.getByRole('dialog', { name: 'Revoke NOC workstation?' })).toHaveAttribute(
      'data-variant',
      'confirmation',
    );
  });

  it('uses the shared standard shell for platform-token replacement', () => {
    mockUseRelayAdministration.mockReturnValue({
      snapshot: {
        ...snapshot,
        settings: [
          {
            setting: 'dynatrace.platform-token',
            configured: true,
            summary: 'Configured',
            revision: 1,
          },
        ],
      },
      loading: false,
      error: null,
      canAdminister: true,
      refresh: vi.fn(),
      execute: vi.fn(),
      clearError: vi.fn(),
    });

    render(<AdministrationSettings relayMode="client" />);
    fireEvent.click(screen.getByRole('link', { name: 'Relay server' }));
    fireEvent.change(screen.getByLabelText('Replacement platform token'), {
      target: { value: 'replacement-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review token replacement' }));

    expect(
      screen.getByRole('dialog', { name: 'Confirm platform token replacement' }),
    ).toHaveAttribute('data-variant', 'standard');
  });

  it('labels the navigation and current panel with matching accessible identities', () => {
    const { container } = render(<AdministrationSettings relayMode="client" />);

    expect(screen.getByRole('navigation', { name: 'Administration sections' })).toBeVisible();
    expect(screen.getByLabelText('Administration section')).toHaveClass('tactile-input');
    expect(container.querySelector('#administration-panel-roles')).toHaveAttribute(
      'aria-labelledby',
      'administration-nav-roles',
    );
  });

  it('uses the shared tactile field for multiline administration values', () => {
    render(<AdministrationSettings relayMode="client" />);
    fireEvent.click(screen.getByRole('link', { name: 'Relay server' }));

    expect(screen.getByLabelText('Selected alerting profiles · one per line')).toHaveClass(
      'tactile-input',
    );
  });

  it('reviews alerting-profile scope changes before applying the non-destructive filter', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    mockUseRelayAdministration.mockReturnValue({
      snapshot: {
        ...snapshot,
        settings: [
          {
            setting: 'dynatrace.alerting-profiles',
            configured: true,
            summary: '1 selected',
            valueSummary: ['NOC Core'],
            revision: 4,
          },
        ],
      },
      loading: false,
      error: null,
      canAdminister: true,
      refresh: vi.fn(),
      execute,
      clearError: vi.fn(),
    });

    render(<AdministrationSettings relayMode="client" />);
    fireEvent.click(screen.getByRole('link', { name: 'Relay server' }));
    fireEvent.change(screen.getByLabelText('Selected alerting profiles · one per line'), {
      target: { value: 'NOC Core\nRetail Stores' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review scope change' }));

    const dialog = screen.getByRole('dialog', { name: 'Review stored problem scope' });
    expect(within(dialog).getByText('Retail Stores')).toBeVisible();
    expect(within(dialog).getByText(/notes and local dispositions are preserved/i)).toBeVisible();
    expect(execute).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply stored scope' }));
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        command: 'administration.setting.replace',
        payload: {
          setting: 'dynatrace.alerting-profiles',
          value: { profiles: ['NOC Core', 'Retail Stores'] },
          expectedRevision: 4,
        },
        expectedRevision: null,
      }),
    );
  });

  it('allows only one alerting-profile scope replacement while confirmation is pending', async () => {
    let finishReplacement!: (result: { ok: true }) => void;
    const execute = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          finishReplacement = resolve;
        }),
    );
    mockUseRelayAdministration.mockReturnValue({
      snapshot: {
        ...snapshot,
        settings: [
          {
            setting: 'dynatrace.alerting-profiles',
            configured: true,
            summary: '1 selected',
            valueSummary: ['NOC Core'],
            revision: 4,
          },
        ],
      },
      loading: false,
      error: null,
      canAdminister: true,
      refresh: vi.fn(),
      execute,
      clearError: vi.fn(),
    });

    render(<AdministrationSettings relayMode="client" />);
    fireEvent.click(screen.getByRole('link', { name: 'Relay server' }));
    fireEvent.change(screen.getByLabelText('Selected alerting profiles · one per line'), {
      target: { value: 'NOC Core\nRetail Stores' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review scope change' }));

    const dialog = screen.getByRole('dialog', { name: 'Review stored problem scope' });
    const applyButton = within(dialog).getByRole('button', { name: 'Apply stored scope' });
    fireEvent.click(applyButton);
    fireEvent.click(applyButton);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(applyButton).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();

    finishReplacement({ ok: true });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Review stored problem scope' })).toBeNull(),
    );
  });

  it('defines a compact selector and stacked rows below half-screen widths', () => {
    expect(settingsCss).toMatch(
      /@media \(max-width:\s*980px\)[\s\S]*\.administration-settings__rail\s*{[^}]*display:\s*none/,
    );
    expect(settingsCss).toMatch(
      /@media \(max-width:\s*680px\)[\s\S]*\.administration-row\s*{[^}]*grid-template-columns:\s*1fr/,
    );
  });
});
