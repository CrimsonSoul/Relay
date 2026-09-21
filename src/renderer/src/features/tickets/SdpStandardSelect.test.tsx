import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpChangeDialog } from './SdpChangeDialog';
import { SdpStandardSelect } from './SdpStandardSelect';
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});
it('uses group dropdowns and clears technicians when the selected group changes', async () => {
  const invoke = vi.fn().mockImplementation(async (c) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      options: {
        field: c.field,
        hasMore: false,
        choices: (c.field === 'group'
          ? [
              { id: '1', name: 'NOC' },
              { id: '2', name: 'SOX' },
            ]
          : [{ id: '3', name: 'Example' }]
        ).map((value) => ({ label: value.name, value })),
      },
    },
  }));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(<SdpChangeDialog mode="create" onClose={vi.fn()} onResult={vi.fn()} />);
  const group = screen.getByRole('combobox', { name: 'Support group' });
  fireEvent.focus(group);
  await screen.findByRole('option', { name: 'NOC' });
  fireEvent.change(group, { target: { value: 'NOC' } });
  const technician = screen.getByRole('combobox', { name: 'Technician' });
  fireEvent.focus(technician);
  await screen.findByRole('option', { name: 'Example' });
  expect(invoke).toHaveBeenLastCalledWith({
    action: 'readStandardOptions',
    field: 'technician',
    search: '',
    page: 0,
    groupId: '1',
  });
  fireEvent.change(technician, { target: { value: 'Example' } });
  fireEvent.change(group, { target: { value: 'SOX' } });
  expect(technician).toHaveValue('');
  expect(screen.queryByRole('option', { name: 'Example' })).not.toBeInTheDocument();
  fireEvent.focus(technician);
  await screen.findByRole('option', { name: 'Example' });
  expect(invoke).toHaveBeenLastCalledWith({
    action: 'readStandardOptions',
    field: 'technician',
    search: '',
    page: 0,
    groupId: '2',
  });
});
it('ignores old lookup responses after dependencies change and allows search after failure', async () => {
  let finish!: (v: unknown) => void;
  const invoke = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error())
    .mockResolvedValue({
      success: true,
      data: {
        configured: true,
        status: 'connected',
        options: {
          field: 'technician',
          choices: [{ label: 'New', value: { id: '2', name: 'New' } }],
          hasMore: false,
        },
      },
    });
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const props = { field: 'technician' as const, label: 'Technician', value: '', onChange: vi.fn() };
  const { rerender } = render(<SdpStandardSelect {...props} groupId="1" />);
  fireEvent.focus(screen.getByRole('combobox'));
  rerender(<SdpStandardSelect {...props} groupId="2" />);
  finish({
    success: true,
    data: {
      options: {
        field: 'technician',
        choices: [{ label: 'Stale', value: 'Stale' }],
        hasMore: false,
      },
    },
  });
  fireEvent.focus(screen.getByRole('combobox'));
  await screen.findByRole('alert');
  expect(screen.queryByRole('option', { name: 'Stale' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(screen.getByRole('option', { name: 'New' })).toBeInTheDocument());
  expect(invoke).toHaveBeenLastCalledWith({
    action: 'readStandardOptions',
    field: 'technician',
    search: 'New',
    page: 0,
    groupId: '2',
  });
});
