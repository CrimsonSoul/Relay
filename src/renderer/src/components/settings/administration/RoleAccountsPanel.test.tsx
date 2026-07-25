import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayAdministrationSnapshot } from '@shared/privilegedAccess';
import { WEB_RUNTIME } from '@shared/runtime';

const { mockUsePrivilegedAccess } = vi.hoisted(() => ({
  mockUsePrivilegedAccess: vi.fn(),
}));

vi.mock('../../../contexts/PrivilegedAccessContext', () => ({
  usePrivilegedAccess: mockUsePrivilegedAccess,
}));

import { RoleAccountsPanel } from './RoleAccountsPanel';

const account = (
  accountId: string,
  username: string,
  displayName: string,
  storedRole: 'administrator' | 'publisher',
  effectiveRole: 'owner' | 'admin' | 'publisher' | null,
  active = true,
) => ({
  accountId,
  username,
  displayName,
  storedRole,
  effectiveRole,
  active,
  credentialState: active ? ('configured' as const) : ('not-configured' as const),
  mustChangePassword: !active,
  credentialVersion: active ? 1 : 0,
  revision: 2,
  createdAt: '2026-07-15T18:00:00.000Z',
  updatedAt: '2026-07-15T19:00:00.000Z',
});

const snapshot: RelayAdministrationSnapshot = {
  accounts: [
    account('account-ryan', 'ryan', 'Ryan Bledsoe', 'administrator', 'owner'),
    account('account-charles', 'charles', 'Charles Gibbs', 'administrator', 'admin'),
    account('account-publisher', 'publisher', 'Tristan Bowles', 'publisher', 'publisher'),
    account('account-old-publisher', 'old-publisher', 'Morgan Lee', 'publisher', null, false),
  ],
  devices: [],
  settings: [],
  ownerAccountId: 'account-ryan',
  publisherAccountId: 'account-publisher',
  assignmentRevision: 3,
  generatedAt: '2026-07-15T20:00:00.000Z',
};

describe('RoleAccountsPanel', () => {
  const execute = vi.fn().mockResolvedValue({ ok: true, requestId: 'request-1', value: {} });
  const reauthenticate = vi.fn().mockResolvedValue({
    proofId: 'reauth-1',
    expiresAt: '2026-07-15T20:05:00.000Z',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePrivilegedAccess.mockReturnValue({
      session: {
        state: 'active',
        accountId: 'account-ryan',
        role: 'owner',
        displayName: 'Ryan Bledsoe',
      },
      reauthenticate,
      busy: null,
      error: null,
      clearError: vi.fn(),
    });
  });

  it('shows effective role labels and owner-only Administrator controls', () => {
    render(<RoleAccountsPanel snapshot={snapshot} execute={execute} relayMode="client" />);

    expect(screen.getByText('OWNER')).toBeVisible();
    expect(screen.getByText('ADMIN')).toBeVisible();
    expect(screen.getByText('PUBLISHER')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add Administrator' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Transfer ownership to Charles Gibbs' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Deactivate Charles Gibbs' })).toBeVisible();
  });

  it('lets the Owner create an Administrator account', async () => {
    render(<RoleAccountsPanel snapshot={snapshot} execute={execute} relayMode="client" />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Administrator' }));
    fireEvent.change(screen.getByLabelText('Administrator username'), {
      target: { value: 'new-admin' },
    });
    fireEvent.change(screen.getByLabelText('Administrator display name'), {
      target: { value: 'New Administrator' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Administrator' }));

    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        command: 'account.admin.create',
        payload: {
          username: 'new-admin',
          displayName: 'New Administrator',
          expectedStateRevision: 3,
        },
        expectedRevision: null,
      }),
    );
  });

  it('lets Charles as Administrator assign or replace the Publisher without Administrator controls', async () => {
    mockUsePrivilegedAccess.mockReturnValue({
      ...mockUsePrivilegedAccess(),
      session: {
        state: 'active',
        accountId: 'account-charles',
        role: 'admin',
        displayName: 'Charles Gibbs',
      },
    });
    render(<RoleAccountsPanel snapshot={snapshot} execute={execute} relayMode="client" />);

    expect(screen.queryByRole('button', { name: 'Add Administrator' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Transfer ownership/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Replace Publisher' })).toBeVisible();
    expect(screen.getByLabelText('Publisher account')).toHaveClass('tactile-input');

    fireEvent.change(screen.getByLabelText('Publisher account'), {
      target: { value: 'account-old-publisher' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Replace Publisher' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm Publisher change' });
    expect(dialog).toHaveAttribute('data-variant', 'standard');
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'a-long-private-password' } });
    fireEvent.submit(dialog.querySelector('form') ?? dialog);

    await waitFor(() => expect(reauthenticate).toHaveBeenCalledWith('a-long-private-password'));
    expect(execute).toHaveBeenCalledWith({
      command: 'publisher.assign',
      payload: {
        accountId: 'account-old-publisher',
        expectedStateRevision: 3,
        reauthRequestId: 'reauth-1',
      },
      expectedRevision: null,
    });
    expect(password.value).toBe('');
  });

  it('offers an unassigned retained Publisher for assignment without offering another account', () => {
    const retainedPublisherSnapshot: RelayAdministrationSnapshot = {
      ...snapshot,
      accounts: snapshot.accounts.filter(({ accountId }) => accountId !== 'account-old-publisher'),
      publisherAccountId: null,
    };

    render(
      <RoleAccountsPanel
        snapshot={retainedPublisherSnapshot}
        execute={execute}
        relayMode="client"
      />,
    );

    expect(screen.queryByRole('button', { name: 'Add Publisher' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Tristan Bowles (@publisher)' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Assign Publisher' })).toBeVisible();
  });

  it('focus-traps a reauthentication dialog and wipes its password when canceled', () => {
    render(<RoleAccountsPanel snapshot={snapshot} execute={execute} relayMode="client" />);
    fireEvent.change(screen.getByLabelText('Publisher account'), {
      target: { value: 'account-old-publisher' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Replace Publisher' }));

    screen.getByRole('dialog', { name: 'Confirm Publisher change' });
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.change(password, { target: { value: 'must-not-survive' } });
    const confirm = screen.getByRole('button', { name: 'Confirm Publisher change' });
    confirm.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('dialog', { name: 'Confirm Publisher change' })).toContainElement(
      document.activeElement as HTMLElement,
    );
    fireEvent.click(cancel);

    fireEvent.click(screen.getByRole('button', { name: 'Replace Publisher' }));
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('keeps reauthentication failures inside the active dialog with actionable text', async () => {
    mockUsePrivilegedAccess.mockReturnValue({
      ...mockUsePrivilegedAccess(),
      error: 'The password was not accepted. Try again.',
    });
    render(<RoleAccountsPanel snapshot={snapshot} execute={execute} relayMode="client" />);
    fireEvent.change(screen.getByLabelText('Publisher account'), {
      target: { value: 'account-old-publisher' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Replace Publisher' }));

    const dialog = screen.getByRole('dialog', { name: 'Confirm Publisher change' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'The password was not accepted. Try again.',
    );
  });

  it('keeps command failures inside the active reauthentication dialog', async () => {
    execute.mockResolvedValueOnce({ ok: false, error: 'conflict' });
    render(<RoleAccountsPanel snapshot={snapshot} execute={execute} relayMode="client" />);
    fireEvent.change(screen.getByLabelText('Publisher account'), {
      target: { value: 'account-old-publisher' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Replace Publisher' }));
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'a-long-private-password' },
    });
    fireEvent.submit(
      screen.getByRole('dialog').querySelector('form') ?? screen.getByRole('dialog'),
    );

    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(
        /server state changed.*try again/i,
      ),
    );
  });

  it('identifies both accounts in the ownership transfer warning', () => {
    render(<RoleAccountsPanel snapshot={snapshot} execute={execute} relayMode="client" />);
    fireEvent.click(screen.getByRole('button', { name: 'Transfer ownership to Charles Gibbs' }));

    expect(screen.getByRole('dialog')).toHaveTextContent(
      /ownership will move from Ryan Bledsoe to Charles Gibbs/i,
    );
  });

  it('keeps credential setup server-local and explains that reset revokes paired sessions', async () => {
    const setupPrivilegedCredential = vi.fn().mockResolvedValue({ ok: true, value: {} });
    globalThis.api = { setupPrivilegedCredential } as never;
    render(<RoleAccountsPanel snapshot={snapshot} execute={execute} relayMode="server" />);

    expect(screen.getByText(/resets stay on this Relay server PC/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Set credential for Charles Gibbs' }));
    const target = screen.getByRole('group', { name: 'Credential target' });
    expect(within(target).getByText('Charles Gibbs')).toBeVisible();
    expect(within(target).getByText('@charles')).toBeVisible();
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'a-new-admin-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'a-new-admin-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set credential' }));

    await waitFor(() =>
      expect(setupPrivilegedCredential).toHaveBeenCalledWith({
        accountId: 'account-charles',
        // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate fake password asserts the exact administrator credential payload.
        password: 'a-new-admin-password',
        // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Matching fake confirmation asserts both credential fields are forwarded.
        passwordConfirm: 'a-new-admin-password',
      }),
    );
  });

  it('requires the matching desktop approval code for browser credential recovery', async () => {
    const approvalRequest = {
      requestId: 'approval-2',
      operation: 'credential-recovery' as const,
      sourceLabel: 'Safari from 10.0.0.9',
      createdAt: '2026-07-20T12:00:00.000Z',
      expiresAt: '2026-07-20T12:10:00.000Z',
    };
    const setupPrivilegedCredential = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'approval-required', approvalRequest })
      .mockResolvedValueOnce({ ok: true, value: {} });
    globalThis.api = { runtime: WEB_RUNTIME, setupPrivilegedCredential } as never;
    render(<RoleAccountsPanel snapshot={snapshot} execute={execute} relayMode="server" />);
    fireEvent.click(screen.getByRole('button', { name: 'Set credential for Charles Gibbs' }));
    const fillPasswords = () => {
      fireEvent.change(screen.getByLabelText('New password'), {
        target: { value: 'a-new-admin-password' },
      });
      fireEvent.change(screen.getByLabelText('Confirm password'), {
        target: { value: 'a-new-admin-password' },
      });
    };
    fillPasswords();
    fireEvent.click(screen.getByRole('button', { name: 'Set credential' }));
    expect(await screen.findByText(/Approve this credential recovery/i)).toBeVisible();
    fillPasswords();
    fireEvent.change(screen.getByLabelText('Desktop approval code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set credential' }));

    await waitFor(() => expect(setupPrivilegedCredential).toHaveBeenCalledTimes(2));
    expect(setupPrivilegedCredential).toHaveBeenLastCalledWith({
      accountId: 'account-charles',
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate fake password asserts approved recovery payload fidelity.
      password: 'a-new-admin-password',
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Matching fake confirmation asserts approved recovery payload fidelity.
      passwordConfirm: 'a-new-admin-password',
      approvalRequestId: 'approval-2',
      approvalCode: '123456',
    });
  });

  it('renders no protected account controls for Publisher sessions', () => {
    mockUsePrivilegedAccess.mockReturnValue({
      ...mockUsePrivilegedAccess(),
      session: {
        state: 'active',
        accountId: 'account-publisher',
        role: 'publisher',
        displayName: 'Tristan Bowles',
      },
    });
    const { container } = render(
      <RoleAccountsPanel snapshot={snapshot} execute={execute} relayMode="server" />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
