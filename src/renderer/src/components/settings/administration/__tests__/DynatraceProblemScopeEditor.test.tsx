import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RelayAdministrationSettingSummary } from '@shared/privilegedAccess';
import { DynatraceProblemScopeEditor } from '../DynatraceProblemScopeEditor';

const profiles: RelayAdministrationSettingSummary = {
  setting: 'dynatrace.alerting-profiles',
  configured: true,
  summary: 'Configured',
  valueSummary: ['NOC Core'],
  availableValues: ['NOC Core', 'Retail Stores'],
  revision: 4,
};

describe('DynatraceProblemScopeEditor', () => {
  it('owns scope testing, confirmation, and replacement', async () => {
    const execute = vi.fn(async (request) =>
      request.command === 'administration.dynatrace-problem-scope.test'
        ? {
            ok: true as const,
            requestId: 'scope-test-request',
            value: { valid: true, problemCount: 2 },
          }
        : { ok: true as const, requestId: 'scope-replace-request', value: null },
    );
    const onFeedback = vi.fn();
    render(
      <DynatraceProblemScopeEditor profiles={profiles} execute={execute} onFeedback={onFeedback} />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Retail Stores' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review scope change' }));

    const dialog = await screen.findByRole('dialog', { name: 'Review stored problem scope' });
    expect(within(dialog).getByText(/2 current problems match/i)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply stored scope' }));

    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith('Stored Dynatrace problem scope updated.'),
    );
    expect(execute).toHaveBeenLastCalledWith({
      command: 'administration.setting.replace',
      payload: {
        setting: 'dynatrace.alerting-profiles',
        value: {
          profiles: ['NOC Core', 'Retail Stores'],
          customDqlMatcher: '',
        },
        expectedRevision: 4,
      },
      expectedRevision: null,
    });
  });
});
