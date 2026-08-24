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
        token={undefined}
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
});
