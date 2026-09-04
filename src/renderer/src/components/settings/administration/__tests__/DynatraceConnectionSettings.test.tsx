import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayAdministrationSettingSummary } from '@shared/privilegedAccess';

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

  it('submits the first URL and token together after password confirmation', async () => {
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
    fireEvent.change(screen.getByLabelText('Replacement platform token'), {
      target: { value: 'dt0s16.first-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review token replacement' }));
    expect(execute).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Administrator password'), {
      target: { value: 'administrator-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Replace token' }));
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        command: 'administration.setting.replace',
        payload: {
          setting: 'dynatrace.platform-token',
          value: {
            apiToken: 'dt0s16.first-token',
            environmentUrl: 'https://first.apps.dynatrace.com',
          },
          expectedRevision: 0,
          reauthRequestId: 'first-token-proof',
        },
        expectedRevision: null,
      }),
    );
    expect(screen.getByLabelText('Replacement platform token')).toHaveValue('');
  });

  it('requires a valid first URL and disables the URL-only save before setup', () => {
    render(
      <DynatraceConnectionSettings
        environment={{ ...environment, configured: false, valueSummary: undefined }}
        token={{ ...token, configured: false }}
        execute={vi.fn()}
        onFeedback={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Replacement platform token'), {
      target: { value: 'dt0s16.first-token' },
    });
    expect(screen.getByRole('button', { name: 'Replace URL' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review token replacement' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Replacement URL'), {
      target: { value: 'https://untrusted.example.com' },
    });
    expect(screen.getByRole('button', { name: 'Review token replacement' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Replacement URL'), {
      target: { value: 'https://first.apps.dynatrace.com' },
    });
    expect(screen.getByRole('button', { name: 'Review token replacement' })).toBeEnabled();
  });

  it('returns to token entry after failed reauthentication without submitting an empty retry', async () => {
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
    fireEvent.change(screen.getByLabelText('Replacement platform token'), {
      target: { value: 'dt0s16.replacement-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review token replacement' }));
    fireEvent.change(screen.getByLabelText('Administrator password'), {
      target: { value: 'incorrect-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Replace token' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Replacement platform token')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Review token replacement' })).toBeDisabled();
  });
});
