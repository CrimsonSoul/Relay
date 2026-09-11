import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayAdministrationSettingSummary } from '@shared/privilegedAccess';
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';

const { mockUsePrivilegedAccess } = vi.hoisted(() => ({
  mockUsePrivilegedAccess: vi.fn(),
}));

vi.mock('../../../../contexts/PrivilegedAccessContext', () => ({
  usePrivilegedAccess: mockUsePrivilegedAccess,
}));

import { DynatraceConnectionSettings } from '../DynatraceConnectionSettings';

const environment: RelayAdministrationSettingSummary = {
  setting: 'dynatrace.environment-url',
  configured: true,
  summary: 'Configured',
  valueSummary: 'https://old.apps.dynatrace.com',
  revision: 3,
};

const token: RelayAdministrationSettingSummary = {
  setting: 'dynatrace.platform-token',
  configured: true,
  summary: 'Configured',
  revision: 2,
};

const oauth = {
  clientId: 'dt0s02.client',
  clientSecret: 'private-client-secret',
  accountUuid: '12345678-1234-1234-1234-123456789012',
};
function enterOAuth() {
  fireEvent.change(screen.getByLabelText('OAuth client ID'), { target: { value: oauth.clientId } });
  fireEvent.change(screen.getByLabelText('OAuth client secret'), {
    target: { value: oauth.clientSecret },
  });
  fireEvent.change(screen.getByLabelText('Dynatrace account UUID'), {
    target: { value: oauth.accountUuid },
  });
}

describe('DynatraceConnectionSettings', () => {
  beforeEach(() => {
    mockUsePrivilegedAccess.mockReturnValue({
      reauthenticate: vi.fn(),
      busy: null,
    });
  });

  it('owns environment URL replacement and reports successful feedback', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const onFeedback = vi.fn();
    render(
      <DynatraceConnectionSettings
        environment={environment}
        token={token}
        execute={execute}
        onFeedback={onFeedback}
      />,
    );

    fireEvent.change(screen.getByLabelText('Replacement URL'), {
      target: { value: 'https://new.apps.dynatrace.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Replace URL' }));

    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        command: 'administration.setting.replace',
        payload: {
          setting: 'dynatrace.environment-url',
          value: { environmentUrl: 'https://new.apps.dynatrace.com' },
          expectedRevision: 3,
        },
        expectedRevision: null,
      }),
    );
    expect(onFeedback).toHaveBeenCalledWith('Dynatrace environment URL updated.');
  });

  it('submits the first URL and OAuth credentials together after password confirmation', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const reauthenticate = vi.fn().mockResolvedValue({ proofId: 'first-token-proof' });
    mockUsePrivilegedAccess.mockReturnValue({ reauthenticate, busy: null });
    render(
      <DynatraceConnectionSettings
        environment={{ ...environment, configured: false, valueSummary: undefined, revision: 0 }}
        token={{ ...token, configured: false, revision: 0 }}
        execute={execute}
        onFeedback={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Replacement URL'), {
      target: { value: 'https://first.apps.dynatrace.com' },
    });
    enterOAuth();
    fireEvent.click(screen.getByRole('button', { name: 'Review OAuth replacement' }));
    expect(execute).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Administrator password'), {
      target: { value: 'administrator-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and save OAuth client' }));
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        command: 'administration.setting.replace',
        payload: {
          setting: 'dynatrace.platform-token',
          value: {
            oauth,
            environmentUrl: 'https://first.apps.dynatrace.com',
          },
          expectedRevision: 0,
          reauthRequestId: 'first-token-proof',
        },
        expectedRevision: null,
      }),
    );
    expect(screen.getByLabelText('OAuth client secret')).toHaveValue('');
  });

  it('disables configured Dynatrace only through a reauthenticated revision-bound command', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const reauthenticate = vi.fn().mockResolvedValue({ proofId: 'clear-proof' });
    mockUsePrivilegedAccess.mockReturnValue({ reauthenticate, busy: null });
    render(
      <DynatraceConnectionSettings
        environment={environment}
        token={token}
        execute={execute}
        onFeedback={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disable Dynatrace Problems' }));
    expect(execute).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Administrator password'), {
      target: { value: 'administrator-password' },
    });
    fireEvent.submit(screen.getByLabelText('Administrator password').closest('form')!);
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        command: 'administration.setting.replace',
        payload: {
          setting: 'dynatrace.platform-token',
          value: { clear: true },
          expectedRevision: 2,
          reauthRequestId: 'clear-proof',
        },
        expectedRevision: null,
      }),
    );
  });

  it.each([true, false])(
    'keeps a credential change busy until the server finishes (success: %s)',
    async (ok) => {
      let finish!: (value: PrivilegedCommandResult) => void;
      const execute = vi.fn(
        () =>
          new Promise<PrivilegedCommandResult>((resolve) => {
            finish = resolve;
          }),
      );
      const reauthenticate = vi.fn().mockResolvedValue({ proofId: 'slow-change-proof' });
      const onFeedback = vi.fn();
      mockUsePrivilegedAccess.mockReturnValue({ reauthenticate, busy: null });
      render(
        <DynatraceConnectionSettings
          environment={environment}
          token={token}
          execute={execute}
          onFeedback={onFeedback}
        />,
      );
      enterOAuth();
      fireEvent.click(screen.getByRole('button', { name: 'Review OAuth replacement' }));
      fireEvent.change(screen.getByLabelText('Administrator password'), {
        target: { value: 'administrator-password' },
      });
      const form = screen.getByLabelText('Administrator password').closest('form')!;
      fireEvent.submit(form);
      fireEvent.submit(form);
      await waitFor(() => expect(execute).toHaveBeenCalledOnce());
      expect(reauthenticate).toHaveBeenCalledOnce();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Verify and save OAuth client' })).toHaveAttribute(
        'aria-busy',
        'true',
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.getByRole('dialog')).toBeVisible();
      expect(onFeedback).not.toHaveBeenCalled();
      finish(
        ok
          ? { ok: true, requestId: 'slow-change', value: null }
          : { ok: false, requestId: 'slow-change', error: 'server-error' },
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByLabelText('OAuth client secret')).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Review OAuth replacement' })).toBeDisabled();
      expect(onFeedback).toHaveBeenCalledTimes(ok ? 1 : 0);
    },
  );

  it('requires a valid first URL and disables the URL-only save before setup', () => {
    render(
      <DynatraceConnectionSettings
        environment={{ ...environment, configured: false, valueSummary: undefined }}
        token={{ ...token, configured: false }}
        execute={vi.fn()}
        onFeedback={vi.fn()}
      />,
    );
    enterOAuth();
    expect(screen.getByRole('button', { name: 'Replace URL' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review OAuth replacement' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Replacement URL'), {
      target: { value: 'https://untrusted.example.com' },
    });
    expect(screen.getByRole('button', { name: 'Review OAuth replacement' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Replacement URL'), {
      target: { value: 'https://first.apps.dynatrace.com' },
    });
    expect(screen.getByRole('button', { name: 'Review OAuth replacement' })).toBeEnabled();
  });

  it('returns to OAuth entry after failed reauthentication without submitting an empty retry', async () => {
    const execute = vi.fn();
    mockUsePrivilegedAccess.mockReturnValue({
      reauthenticate: vi.fn().mockResolvedValue(null),
      busy: null,
    });
    render(
      <DynatraceConnectionSettings
        environment={environment}
        token={token}
        execute={execute}
        onFeedback={vi.fn()}
      />,
    );
    enterOAuth();
    fireEvent.click(screen.getByRole('button', { name: 'Review OAuth replacement' }));
    fireEvent.change(screen.getByLabelText('Administrator password'), {
      target: { value: 'incorrect-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and save OAuth client' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByLabelText('OAuth client secret')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Review OAuth replacement' })).toBeDisabled();
  });
});
