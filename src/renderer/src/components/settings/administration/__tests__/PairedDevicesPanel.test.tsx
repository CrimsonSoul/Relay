import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  RelayAdministrationSnapshot,
  RelayPrivilegedDeviceAdminView,
} from '@shared/privilegedAccess';
import { PairedDevicesPanel } from '../PairedDevicesPanel';

vi.mock('../../../../contexts/PrivilegedAccessContext', () => ({
  usePrivilegedAccess: () => ({ reauthenticate: vi.fn(), busy: null }),
}));

const device: RelayPrivilegedDeviceAdminView = {
  id: 'device-record',
  deviceId: 'device-1',
  accountId: 'account-admin',
  username: 'admin',
  displayName: 'Relay Admin',
  label: 'NOC Desk 1',
  hostname: 'NOC-01',
  state: 'active',
  lastSeenAt: null,
  fingerprintSuffix: 'a1b2',
  revision: 3,
};

const snapshot: RelayAdministrationSnapshot = {
  accounts: [],
  devices: [device],
  settings: [],
  ownerAccountId: 'owner',
  publisherAccountId: null,
  assignmentRevision: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
};

describe('PairedDevicesPanel', () => {
  it('cancels a rename without saving and blocks an empty label', () => {
    const execute = vi.fn();
    render(<PairedDevicesPanel snapshot={snapshot} execute={execute} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Workstation name for NOC-01');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Workstation name for NOC-01')).not.toBeInTheDocument();
    expect(screen.getByText('NOC Desk 1')).toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
  });

  it('saves a trimmed label', async () => {
    const execute = vi.fn(async () => ({ ok: true as const, requestId: 'r', value: null }));
    render(<PairedDevicesPanel snapshot={snapshot} execute={execute} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Workstation name for NOC-01'), {
      target: { value: '  NOC Desk 2  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { deviceId: 'device-1', label: 'NOC Desk 2', expectedRevision: 3 },
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText('Workstation name for NOC-01')).not.toBeInTheDocument(),
    );
  });
});
