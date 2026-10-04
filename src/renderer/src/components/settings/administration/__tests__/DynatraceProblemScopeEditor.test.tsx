import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  it('discovers a workflow task without needing a manually copied matcher and can return to manual filtering', async () => {
    const execute = vi.fn(async () => ({
      ok: true as const,
      requestId: 'test',
      value: { valid: true, problemCount: 2 },
    }));
    render(
      <DynatraceProblemScopeEditor
        profiles={{ ...profiles, workflowId: 'workflow-test' }}
        execute={execute}
        onFeedback={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Custom DQL/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Follow workflow DQL' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review Scope Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review stored problem scope' });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          workflowId: 'workflow-test',
          workflowDqlTask: '',
          customDqlMatcher: '',
        }),
      }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply Stored Scope' }));
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            value: expect.objectContaining({ workflowDqlTask: '' }),
          }),
        }),
      ),
    );
  });

  it('discards a pending preview when the draft changes', async () => {
    let finish!: (result: {
      ok: true;
      requestId: string;
      value: { valid: true; problemCount: number };
    }) => void;
    const execute = vi.fn(
      () =>
        new Promise<{ ok: true; requestId: string; value: { valid: true; problemCount: number } }>(
          (resolve) => {
            finish = resolve;
          },
        ),
    );
    render(
      <DynatraceProblemScopeEditor profiles={profiles} execute={execute} onFeedback={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review Scope Change' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Retail Stores' }));
    await act(async () =>
      finish({ ok: true, requestId: 'old', value: { valid: true, problemCount: 2 } }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/2 current problems match/)).not.toBeInTheDocument();
  });

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
    fireEvent.click(screen.getByRole('button', { name: 'Review Scope Change' }));

    const dialog = await screen.findByRole('dialog', { name: 'Review stored problem scope' });
    expect(within(dialog).getByText(/2 current problems match/i)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply Stored Scope' }));

    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith('Stored Dynatrace problem scope updated.'),
    );
    expect(execute).toHaveBeenLastCalledWith({
      command: 'administration.setting.replace',
      payload: {
        setting: 'dynatrace.alerting-profiles',
        value: {
          profiles: ['NOC Core', 'Retail Stores'],
          rememberedAlertingProfiles: ['NOC Core', 'Retail Stores'],
          customDqlMatcher: '',
        },
        expectedRevision: 4,
      },
      expectedRevision: null,
    });
  });

  it('restores remembered profiles after reopening a custom DQL scope and never applies them to the DQL preview', async () => {
    const execute = vi.fn(async (request) =>
      request.command === 'administration.dynatrace-problem-scope.test'
        ? { ok: true as const, requestId: 'test', value: { valid: true, problemCount: 2 } }
        : { ok: true as const, requestId: 'save', value: null },
    );
    render(
      <DynatraceProblemScopeEditor
        profiles={{
          ...profiles,
          valueSummary: undefined,
          customDqlMatcher: 'event.kind == "DAVIS_PROBLEM"',
          workflowId: 'workflow-test',
          rememberedAlertingProfiles: ['NOC Core', 'Retail Stores'],
        }}
        execute={execute}
        onFeedback={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: /Custom DQL/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Alerting profiles/ }));
    expect(screen.getByRole('checkbox', { name: 'NOC Core' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Retail Stores' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /All problems/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Custom DQL/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Review Scope Change' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review stored problem scope' });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'administration.dynatrace-problem-scope.test',
        payload: {
          profiles: [],
          customDqlMatcher: 'event.kind == "DAVIS_PROBLEM"',
          workflowId: 'workflow-test',
        },
      }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply Stored Scope' }));
    await waitFor(() =>
      expect(execute).toHaveBeenLastCalledWith(
        expect.objectContaining({
          command: 'administration.setting.replace',
          payload: expect.objectContaining({
            value: {
              profiles: [],
              rememberedAlertingProfiles: ['NOC Core', 'Retail Stores'],
              customDqlMatcher: 'event.kind == "DAVIS_PROBLEM"',
              workflowId: 'workflow-test',
            },
          }),
        }),
      ),
    );
  });

  it('marks the DQL field invalid and describes it by the failed scope test', async () => {
    const execute = vi.fn(async () => ({
      ok: true as const,
      requestId: 'test',
      value: { valid: false, error: 'DQL could not be parsed.' },
    }));
    render(
      <DynatraceProblemScopeEditor
        profiles={{
          ...profiles,
          valueSummary: undefined,
          customDqlMatcher: 'event.kind ==',
          workflowId: 'workflow-test',
        }}
        execute={execute}
        onFeedback={vi.fn()}
      />,
    );
    const field = screen.getByLabelText('Complete DQL filter expression');
    expect(field).not.toBeInvalid();
    fireEvent.click(screen.getByRole('button', { name: 'Review Scope Change' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('DQL could not be parsed.');
    expect(field).toBeInvalid();
    expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(alert.id);
  });
});
