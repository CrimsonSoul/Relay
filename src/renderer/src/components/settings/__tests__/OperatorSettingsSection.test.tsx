import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayOperatorRecord } from '@shared/operators';

const { mockUseOperator, mockUseRelayAdministration } = vi.hoisted(() => ({
  mockUseOperator: vi.fn(),
  mockUseRelayAdministration: vi.fn(),
}));

vi.mock('../../../contexts/OperatorContext', () => ({ useOperator: mockUseOperator }));
vi.mock('../../../hooks/useRelayAdministration', () => ({
  useRelayAdministration: mockUseRelayAdministration,
}));

import { OperatorSettingsSection } from '../OperatorSettingsSection';

const activeOperator: RelayOperatorRecord = {
  id: 'operator-active',
  displayName: 'Alpha Operator',
  active: true,
  created: '2026-07-13T08:00:00.000Z',
  updated: '2026-07-13T08:00:00.000Z',
};
const inactiveOperator: RelayOperatorRecord = {
  ...activeOperator,
  id: 'operator-inactive',
  displayName: 'Former Operator',
  active: false,
};

describe('OperatorSettingsSection', () => {
  beforeEach(() => {
    mockUseOperator.mockReturnValue({
      operators: [activeOperator, inactiveOperator],
      loading: false,
      error: null,
    });
    mockUseRelayAdministration.mockReturnValue({ snapshot: null, canAdminister: false });
  });

  it('shows the synchronized roster grouped by active status', () => {
    render(<OperatorSettingsSection relayMode="client" modeLoading={false} />);

    expect(
      within(screen.getByRole('group', { name: 'Active operators, 1' })).getByText(
        'Alpha Operator',
      ),
    ).toBeVisible();
    expect(
      within(screen.getByRole('group', { name: 'Inactive operators, 1' })).getByText(
        'Former Operator',
      ),
    ).toBeVisible();
  });

  it('keeps normal operator access read-only on server and client workstations', () => {
    render(<OperatorSettingsSection relayMode="server" modeLoading={false} />);

    expect(
      screen.getByText('The synchronized roster is read-only without administrator access.'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /add|rename|deactivate|reactivate/i })).toBeNull();
  });

  it('shows role chips and routes active administrators to the protected workspace', () => {
    mockUseRelayAdministration.mockReturnValue({
      canAdminister: true,
      snapshot: {
        operators: [{ ...activeOperator, revision: 2, role: 'admin' }],
      },
    });
    render(<OperatorSettingsSection relayMode="client" modeLoading={false} />);

    expect(screen.getByText('ADMIN')).toBeVisible();
    expect(
      screen.getByText('Manage names, roles, and access in the Administration section.'),
    ).toBeVisible();
  });

  it('keeps loading, failure, and empty states in the roster surface', () => {
    mockUseOperator.mockReturnValue({ operators: [], loading: true, error: null });
    const { rerender } = render(<OperatorSettingsSection relayMode="server" modeLoading={false} />);
    expect(screen.getByText('Loading operator roster…')).toBeVisible();

    mockUseOperator.mockReturnValue({ operators: [], loading: false, error: new Error('offline') });
    rerender(<OperatorSettingsSection relayMode="server" modeLoading={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load the operator roster. offline',
    );
  });
});
