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

const workflowMatcher = `(
  matchesValue(entity_tags, "teams:network")
  or matchesValue(entity_tags, "critical_intf")
  or matchesValue(event.name, "UPS on battery*")
  or matchesPhrase(event.name, "Packet loss on")
  or matchesValue(affected_entity_types, "dt.entity.python:certificate_monitor_certificate")
  or matchesValue(labels.alerting_profile, "*WAN Links")
  or matchesValue(labels.alerting_profile, "*Alerts for NOC")
  or matchesValue(labels.alerting_profile, "Pure Array Latency")
  or matchesValue(labels.alerting_profile, "duo auth proxy on chpw-duoauth01")
)
and not matchesValue(event.status_transition, "UPDATED")
and maintenance.is_under_maintenance == false
and dt.davis.mute.status == "NOT_MUTED"`;

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

  it('presents three mutually exclusive scope methods and a tactile DQL editor', () => {
    render(<AdministrationSettings relayMode="client" />);
    fireEvent.click(screen.getByRole('link', { name: 'Relay server' }));

    expect(screen.getByRole('radio', { name: /all problems/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /alerting profiles/i })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /custom DQL/i })).not.toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: /custom DQL/i }));
    expect(screen.getByLabelText('Complete DQL filter expression')).toHaveClass('tactile-input');
  });

  it('reviews alerting-profile scope changes before applying the non-destructive filter', async () => {
    const execute = vi.fn(async (request) =>
      request.command === 'administration.dynatrace-problem-scope.test'
        ? { ok: true, value: { valid: true, problemCount: 12 } }
        : { ok: true },
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
            availableValues: ['NOC Core', 'Retail Stores'],
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
    expect(screen.getByRole('checkbox', { name: 'NOC Core' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Retail Stores' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review scope change' }));

    const dialog = await screen.findByRole('dialog', { name: 'Review stored problem scope' });
    expect(within(dialog).getByText('Retail Stores')).toBeVisible();
    expect(within(dialog).getByText(/12 current problems match/i)).toBeVisible();
    expect(within(dialog).getByText(/notes and local dispositions are preserved/i)).toBeVisible();
    expect(execute).toHaveBeenNthCalledWith(1, {
      command: 'administration.dynatrace-problem-scope.test',
      payload: { profiles: ['NOC Core', 'Retail Stores'], customDqlMatcher: '' },
      expectedRevision: null,
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply stored scope' }));
    await waitFor(() =>
      expect(execute).toHaveBeenNthCalledWith(2, {
        command: 'administration.setting.replace',
        payload: {
          setting: 'dynatrace.alerting-profiles',
          value: { profiles: ['NOC Core', 'Retail Stores'], customDqlMatcher: '' },
          expectedRevision: 4,
        },
        expectedRevision: null,
      }),
    );
  });

  it('allows only one alerting-profile scope replacement while confirmation is pending', async () => {
    let finishReplacement!: (result: { ok: true }) => void;
    const execute = vi.fn((request) => {
      if (request.command === 'administration.dynatrace-problem-scope.test') {
        return Promise.resolve({ ok: true, value: { valid: true, problemCount: 8 } });
      }
      return new Promise<{ ok: true }>((resolve) => {
        finishReplacement = resolve;
      });
    });
    mockUseRelayAdministration.mockReturnValue({
      snapshot: {
        ...snapshot,
        settings: [
          {
            setting: 'dynatrace.alerting-profiles',
            configured: true,
            summary: '1 selected',
            valueSummary: ['NOC Core'],
            availableValues: ['NOC Core', 'Retail Stores'],
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
    fireEvent.click(screen.getByRole('checkbox', { name: 'Retail Stores' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review scope change' }));

    const dialog = await screen.findByRole('dialog', { name: 'Review stored problem scope' });
    const applyButton = within(dialog).getByRole('button', { name: 'Apply stored scope' });
    fireEvent.click(applyButton);
    fireEvent.click(applyButton);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(applyButton).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();

    finishReplacement({ ok: true });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Review stored problem scope' })).toBeNull(),
    );
  });

  it('tests and submits the complete workflow DQL without combining selected profiles', async () => {
    const execute = vi.fn(async (request) =>
      request.command === 'administration.dynatrace-problem-scope.test'
        ? { ok: true, value: { valid: true, problemCount: 6 } }
        : { ok: true },
    );
    mockUseRelayAdministration.mockReturnValue({
      snapshot: {
        ...snapshot,
        settings: [
          {
            setting: 'dynatrace.alerting-profiles',
            configured: true,
            summary: 'Configured',
            valueSummary: ['NOC Core'],
            availableValues: ['NOC Core', 'Retail Stores'],
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
    fireEvent.click(screen.getByRole('radio', { name: /custom DQL/i }));
    fireEvent.change(screen.getByLabelText('Complete DQL filter expression'), {
      target: { value: workflowMatcher },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test scope' }));

    expect(await screen.findByText(/6 current problems match/i)).toBeVisible();
    expect(screen.getByText(/complete DQL expression is the only filter/i)).toBeVisible();
    expect(execute).toHaveBeenNthCalledWith(1, {
      command: 'administration.dynatrace-problem-scope.test',
      payload: { profiles: [], customDqlMatcher: workflowMatcher },
      expectedRevision: null,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Review scope change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review stored problem scope' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply stored scope' }));

    await waitFor(() =>
      expect(execute).toHaveBeenLastCalledWith({
        command: 'administration.setting.replace',
        payload: {
          setting: 'dynatrace.alerting-profiles',
          value: { profiles: [], customDqlMatcher: workflowMatcher },
          expectedRevision: 4,
        },
        expectedRevision: null,
      }),
    );
  });

  it('accepts zero matches with a visible warning before review', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      value: { valid: true, problemCount: 0 },
    });
    mockUseRelayAdministration.mockReturnValue({
      snapshot: {
        ...snapshot,
        settings: [
          {
            setting: 'dynatrace.alerting-profiles',
            configured: false,
            summary: 'Not configured',
            revision: 0,
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

    render(<AdministrationSettings relayMode="server" />);
    fireEvent.click(screen.getByRole('link', { name: 'Relay server' }));
    fireEvent.click(screen.getByRole('radio', { name: /custom DQL/i }));
    fireEvent.change(screen.getByLabelText('Complete DQL filter expression'), {
      target: { value: 'matchesPhrase(event.name, "No current match")' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test scope' }));

    expect(await screen.findByText(/no current problems match/i)).toBeVisible();
    expect(screen.getByText(/saving will hide all currently visible problems/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Review scope change' })).toBeEnabled();
  });

  it('shows server matcher errors without clearing the administrator draft', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      value: { valid: false, error: 'Dynatrace could not parse line 2.' },
    });
    mockUseRelayAdministration.mockReturnValue({
      snapshot: {
        ...snapshot,
        settings: [
          {
            setting: 'dynatrace.alerting-profiles',
            configured: false,
            summary: 'Not configured',
            revision: 0,
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

    render(<AdministrationSettings relayMode="server" />);
    fireEvent.click(screen.getByRole('link', { name: 'Relay server' }));
    fireEvent.click(screen.getByRole('radio', { name: /custom DQL/i }));
    const matcher = screen.getByLabelText('Complete DQL filter expression');
    fireEvent.change(matcher, { target: { value: 'matchesPhrase(event.name, "broken")' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review scope change' }));

    expect(await screen.findByText('Dynatrace could not parse line 2.')).toBeVisible();
    expect(matcher).toHaveValue('matchesPhrase(event.name, "broken")');
    expect(screen.queryByRole('dialog', { name: 'Review stored problem scope' })).toBeNull();
  });

  it('can explicitly clear both profiles and an existing custom matcher', async () => {
    const execute = vi.fn(async (request) =>
      request.command === 'administration.dynatrace-problem-scope.test'
        ? { ok: true, value: { valid: true, problemCount: 42 } }
        : { ok: true },
    );
    mockUseRelayAdministration.mockReturnValue({
      snapshot: {
        ...snapshot,
        settings: [
          {
            setting: 'dynatrace.alerting-profiles',
            configured: true,
            summary: 'Configured',
            valueSummary: ['NOC Core'],
            customDqlMatcher: workflowMatcher,
            revision: 7,
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

    render(<AdministrationSettings relayMode="server" />);
    fireEvent.click(screen.getByRole('link', { name: 'Relay server' }));
    fireEvent.click(screen.getByRole('radio', { name: /all problems/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Review scope change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review stored problem scope' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply stored scope' }));

    await waitFor(() =>
      expect(execute).toHaveBeenLastCalledWith({
        command: 'administration.setting.replace',
        payload: {
          setting: 'dynatrace.alerting-profiles',
          value: { profiles: [], customDqlMatcher: '' },
          expectedRevision: 7,
        },
        expectedRevision: null,
      }),
    );
  });

  it('defines a compact selector and stacked rows below half-screen widths', () => {
    expect(settingsCss).toMatch(
      /@media \(max-width:\s*980px\)[\s\S]*\.administration-settings__rail\s*{[^}]*display:\s*none/,
    );
    expect(settingsCss).toMatch(
      /@media \(max-width:\s*680px\)[\s\S]*\.administration-row\s*{[^}]*grid-template-columns:\s*1fr/,
    );
    expect(settingsCss).toMatch(
      /@media \(max-width:\s*680px\)[\s\S]*\.administration-scope-methods\s*{[^}]*grid-template-columns:\s*1fr/,
    );
  });
});
