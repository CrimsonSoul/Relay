import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
import type { RelayOperatorRecord } from '@shared/operators';

const { mockUseOperator } = vi.hoisted(() => ({
  mockUseOperator: vi.fn(),
}));

vi.mock('../../../contexts/OperatorContext', () => ({
  useOperator: mockUseOperator,
}));

import { OperatorSettingsSection } from '../OperatorSettingsSection';

const componentsCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/components.css'),
  'utf8',
);

const ACTIVE_UPDATED = '2026-07-13 08:00:00.000Z';
const INACTIVE_UPDATED = '2026-07-13 09:00:00.000Z';

const activeOperator: RelayOperatorRecord = {
  id: 'operator-active',
  displayName: 'Alpha Operator',
  active: true,
  created: ACTIVE_UPDATED,
  updated: ACTIVE_UPDATED,
};

const inactiveOperator: RelayOperatorRecord = {
  id: 'operator-inactive',
  displayName: 'Former Operator',
  active: false,
  created: INACTIVE_UPDATED,
  updated: INACTIVE_UPDATED,
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setRoster({
  operators = [activeOperator, inactiveOperator],
  loading = false,
  error = null,
}: {
  operators?: RelayOperatorRecord[];
  loading?: boolean;
  error?: Error | null;
} = {}) {
  mockUseOperator.mockReturnValue({ operators, loading, error });
}

function setApi(overrides: Partial<BridgeAPI> = {}) {
  globalThis.api = {
    createRelayOperator: vi.fn().mockResolvedValue({ success: true, data: activeOperator }),
    renameRelayOperator: vi.fn().mockResolvedValue({ success: true, data: activeOperator }),
    setRelayOperatorActive: vi.fn().mockResolvedValue({ success: true, data: activeOperator }),
    ...overrides,
  } as BridgeAPI;
}

function renderSection(relayMode: 'server' | 'client' | null = 'server', modeLoading = false) {
  return render(<OperatorSettingsSection relayMode={relayMode} modeLoading={modeLoading} />);
}

describe('OperatorSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRoster();
    setApi();
  });

  it('shows one divided roster surface grouped by active status without permanent delete', () => {
    setRoster({
      operators: [
        activeOperator,
        { ...activeOperator, id: 'operator-bravo', displayName: 'Bravo Operator' },
        inactiveOperator,
      ],
    });

    renderSection();

    const activeGroup = screen.getByRole('group', { name: 'Active operators, 2' });
    const inactiveGroup = screen.getByRole('group', { name: 'Inactive operators, 1' });
    expect(within(activeGroup).getByText('Alpha Operator')).toBeVisible();
    expect(within(activeGroup).getByText('Bravo Operator')).toBeVisible();
    expect(within(inactiveGroup).getByText('Former Operator')).toBeVisible();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('keeps the operator workspace full-width with accessible actions and stacked narrow rows', () => {
    expect(componentsCss).toMatch(
      /\.settings-page \.settings-body--operators\s*{[^}]*grid-template-columns:\s*1fr/s,
    );
    expect(componentsCss).toMatch(
      /\.operator-settings__action\.tactile-button\s*{[^}]*min-height:\s*44px/s,
    );
    expect(componentsCss).toMatch(
      /@media \(max-width:\s*600px\).*\.operator-settings__row\s*{[^}]*grid-template-columns:\s*1fr/s,
    );
  });

  it('keeps the roster visible but replaces mutation controls on Relay clients', () => {
    renderSection('client');

    expect(screen.getByText('Alpha Operator')).toBeVisible();
    expect(screen.getByText('Former Operator')).toBeVisible();
    expect(
      screen.getByText('Operator management is available only on the Relay server.'),
    ).toBeVisible();
    expect(screen.queryByLabelText('New operator name')).toBeNull();
    expect(screen.queryByRole('button', { name: /rename|deactivate|reactivate/i })).toBeNull();
  });

  it('keeps loading, error, and empty states inside the roster flow', () => {
    setRoster({ loading: true });
    const { rerender } = renderSection();
    expect(screen.getByText('Loading operator roster…')).toBeVisible();

    setRoster({ operators: [], error: new Error('Relay is offline') });
    rerender(<OperatorSettingsSection relayMode="server" modeLoading={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load the operator roster. Relay is offline',
    );

    setRoster({ operators: [] });
    rerender(<OperatorSettingsSection relayMode="server" modeLoading={false} />);
    expect(screen.getByText('No operators have been added yet.')).toBeVisible();
  });

  it('validates a new display name before calling IPC', () => {
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Add operator' }));

    const input = screen.getByLabelText('New operator name');
    const error = screen.getByText('Enter an operator display name.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', error.id);
    expect(globalThis.api?.createRelayOperator).not.toHaveBeenCalled();
  });

  it('adds a normalized operator and exposes pending and success state locally', async () => {
    const deferred = createDeferred<Awaited<ReturnType<BridgeAPI['createRelayOperator']>>>();
    const createRelayOperator = vi.fn().mockReturnValue(deferred.promise);
    setApi({ createRelayOperator });
    renderSection();

    const input = screen.getByLabelText('New operator name');
    fireEvent.change(input, { target: { value: '  New   Operator  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add operator' }));

    expect(createRelayOperator).toHaveBeenCalledWith({ displayName: 'New Operator' });
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
    expect(input).toBeDisabled();

    await act(async () => {
      deferred.resolve({
        success: true,
        data: { ...activeOperator, id: 'new-operator', displayName: 'New Operator' },
      });
      await deferred.promise;
    });

    expect(input).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('Added New Operator.');
  });

  it('keeps add input available and announces duplicate IPC feedback', async () => {
    setApi({
      createRelayOperator: vi.fn().mockResolvedValue({
        success: false,
        error: 'An operator with this display name already exists.',
      }),
    });
    renderSection();

    const input = screen.getByLabelText('New operator name');
    fireEvent.change(input, { target: { value: 'Alpha Operator' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add operator' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'An operator with this display name already exists.',
      ),
    );
    expect(input).toHaveValue('Alpha Operator');
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('renames one row inline with the literal current revision and exits on success', async () => {
    const renameRelayOperator = vi.fn().mockResolvedValue({
      success: true,
      data: { ...activeOperator, displayName: 'Renamed Operator' },
    });
    setApi({ renameRelayOperator });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Alpha Operator' }));
    const input = screen.getByRole('textbox', { name: 'Rename Alpha Operator' });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '  Renamed   Operator ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(renameRelayOperator).toHaveBeenCalledWith({
        id: 'operator-active',
        displayName: 'Renamed Operator',
        expectedUpdated: ACTIVE_UPDATED,
      }),
    );
    expect(screen.queryByRole('textbox', { name: 'Rename Alpha Operator' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Renamed Alpha Operator to Renamed Operator.',
    );
    expect(screen.getByRole('button', { name: 'Rename Alpha Operator' })).toHaveFocus();
  });

  it('cancels inline rename with Escape and restores focus to that row', () => {
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Alpha Operator' }));
    const input = screen.getByRole('textbox', { name: 'Rename Alpha Operator' });
    fireEvent.change(input, { target: { value: 'Unsaved name' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('textbox', { name: 'Rename Alpha Operator' })).toBeNull();
    expect(globalThis.api?.renameRelayOperator).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Rename Alpha Operator' })).toHaveFocus();
  });

  it('retains the add value and focus after a rejected bridge call, then retries', async () => {
    const createRelayOperator = vi
      .fn()
      .mockRejectedValueOnce(new Error())
      .mockResolvedValueOnce({
        success: true,
        data: { ...activeOperator, id: 'new-operator', displayName: 'New Operator' },
      });
    setApi({ createRelayOperator });
    renderSection();

    const input = screen.getByLabelText('New operator name');
    fireEvent.change(input, { target: { value: 'New Operator' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add operator' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not add the operator.'),
    );
    expect(input).toHaveValue('New Operator');
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Add operator' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Added New Operator.'),
    );
    expect(createRelayOperator).toHaveBeenCalledTimes(2);
  });

  it('retains inline rename after a rejected bridge call, then retries and restores focus', async () => {
    const renameRelayOperator = vi
      .fn()
      .mockRejectedValueOnce(new Error())
      .mockResolvedValueOnce({
        success: true,
        data: { ...activeOperator, displayName: 'Retry Operator' },
      });
    setApi({ renameRelayOperator });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Alpha Operator' }));
    const input = screen.getByRole('textbox', { name: 'Rename Alpha Operator' });
    fireEvent.change(input, { target: { value: 'Retry Operator' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not rename the operator.'),
    );
    expect(input).toHaveValue('Retry Operator');
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Renamed Alpha Operator to Retry Operator.',
      ),
    );
    expect(screen.getByRole('button', { name: 'Rename Alpha Operator' })).toHaveFocus();
    expect(renameRelayOperator).toHaveBeenCalledTimes(2);
  });

  it('preserves the inline rename value and focus on stale-write failure', async () => {
    setApi({
      renameRelayOperator: vi.fn().mockResolvedValue({
        success: false,
        error: 'This operator changed since it was loaded. Refresh and try again.',
      }),
    });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Alpha Operator' }));
    const input = screen.getByRole('textbox', { name: 'Rename Alpha Operator' });
    fireEvent.change(input, { target: { value: 'Retry Operator' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This operator changed since it was loaded. Refresh and try again.',
      ),
    );
    expect(input).toHaveValue('Retry Operator');
    expect(input).toHaveFocus();
  });

  it('confirms deactivation, explains retained history, and sends the current revision', async () => {
    const setRelayOperatorActive = vi.fn().mockResolvedValue({
      success: true,
      data: { ...activeOperator, active: false },
    });
    setApi({ setRelayOperatorActive });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Alpha Operator' }));

    expect(screen.getByRole('dialog', { name: 'Deactivate Alpha Operator?' })).toBeVisible();
    expect(screen.getByText(/Existing history stays attributed to Alpha Operator/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    await waitFor(() =>
      expect(setRelayOperatorActive).toHaveBeenCalledWith({
        id: 'operator-active',
        active: false,
        expectedUpdated: ACTIVE_UPDATED,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Deactivate Alpha Operator?' })).toBeNull(),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Deactivated Alpha Operator.');
  });

  it('keeps deactivation confirmation open when IPC fails', async () => {
    setApi({
      setRelayOperatorActive: vi.fn().mockResolvedValue({
        success: false,
        error: 'This operator changed since it was loaded. Refresh and try again.',
      }),
    });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Alpha Operator' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    const dialog = screen.getByRole('dialog', { name: 'Deactivate Alpha Operator?' });
    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'This operator changed since it was loaded. Refresh and try again.',
      ),
    );
    expect(dialog).toBeVisible();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeEnabled();
  });

  it('shows rejected deactivation inside the modal and allows a successful retry', async () => {
    const setRelayOperatorActive = vi
      .fn()
      .mockRejectedValueOnce(new Error())
      .mockResolvedValueOnce({ success: true, data: { ...activeOperator, active: false } });
    setApi({ setRelayOperatorActive });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Alpha Operator' }));
    const dialog = screen.getByRole('dialog', { name: 'Deactivate Alpha Operator?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'Could not deactivate the operator.',
      ),
    );
    expect(within(dialog).getByRole('button', { name: 'Deactivate' })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Deactivated Alpha Operator.');
    expect(setRelayOperatorActive).toHaveBeenCalledTimes(2);
  });

  it('reactivates inline with the literal current revision and busy state', async () => {
    const deferred = createDeferred<Awaited<ReturnType<BridgeAPI['setRelayOperatorActive']>>>();
    const setRelayOperatorActive = vi.fn().mockReturnValue(deferred.promise);
    setApi({ setRelayOperatorActive });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Reactivate Former Operator' }));

    expect(setRelayOperatorActive).toHaveBeenCalledWith({
      id: 'operator-inactive',
      active: true,
      expectedUpdated: INACTIVE_UPDATED,
    });
    expect(screen.getByRole('button', { name: 'Reactivating Former Operator…' })).toBeDisabled();

    await act(async () => {
      deferred.resolve({ success: true, data: { ...inactiveOperator, active: true } });
      await deferred.promise;
    });

    expect(screen.getByRole('status')).toHaveTextContent('Reactivated Former Operator.');
  });

  it('announces rejected reactivation locally and allows retry', async () => {
    const setRelayOperatorActive = vi
      .fn()
      .mockRejectedValueOnce(new Error())
      .mockResolvedValueOnce({ success: true, data: { ...inactiveOperator, active: true } });
    setApi({ setRelayOperatorActive });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Reactivate Former Operator' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not reactivate the operator.'),
    );
    const retry = screen.getByRole('button', { name: 'Reactivate Former Operator' });
    expect(retry).toBeEnabled();

    fireEvent.click(retry);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Reactivated Former Operator.'),
    );
    expect(setRelayOperatorActive).toHaveBeenCalledTimes(2);
  });
});
