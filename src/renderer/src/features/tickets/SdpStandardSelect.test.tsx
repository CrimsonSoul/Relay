import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpChangeDialog } from './SdpChangeDialog';
import { SdpStandardSelect } from './SdpStandardSelect';
import { chooseSdpOption, sdpPicker } from './sdpPicker.test-util';
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});
const reply = (field: string, names: string[], hasMore = false) => ({
  success: true,
  data: {
    configured: true,
    status: 'connected',
    options: {
      field,
      hasMore,
      choices: names.map((name, index) => ({
        label: name,
        value: { id: String(index + 1), name },
      })),
    },
  },
});
it('uses group pickers and clears technicians when the selected group changes', async () => {
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
  await chooseSdpOption('Support group', 'NOC');
  await chooseSdpOption('Technician', 'Example');
  expect(invoke).toHaveBeenLastCalledWith({
    action: 'readStandardOptions',
    field: 'technician',
    search: '',
    page: 0,
    groupId: '1',
  });
  expect(sdpPicker('Technician')).toHaveTextContent('Example');
  await chooseSdpOption('Support group', 'SOX');
  expect(sdpPicker('Technician')).toHaveTextContent('Choose…');
  fireEvent.click(sdpPicker('Technician'));
  await screen.findByRole('option', { name: 'Example' });
  expect(invoke).toHaveBeenLastCalledWith({
    action: 'readStandardOptions',
    field: 'technician',
    search: '',
    page: 0,
    groupId: '2',
  });
});
it('opens with its search focused, answers the keyboard and returns focus to the field', async () => {
  globalThis.api = {
    ...original,
    sdpAccount: vi.fn().mockResolvedValue(reply('status', ['Open', 'Closed'])),
  } as BridgeAPI;
  const change = vi.fn();
  render(<SdpStandardSelect field="status" label="Status" value="" required onChange={change} />);
  const status = sdpPicker('Status');
  expect(status).toHaveAttribute('aria-required', 'true');
  expect(status).toHaveTextContent('Choose…');
  fireEvent.click(status);
  const search = screen.getByRole('combobox', { name: 'Search Status choices' });
  await waitFor(() => expect(search).toHaveFocus());
  expect(status).toHaveAttribute('aria-expanded', 'true');
  await screen.findByRole('option', { name: 'Closed' });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(search).toHaveAttribute(
    'aria-activedescendant',
    screen.getByRole('option', { name: 'Closed' }).id,
  );
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(change).toHaveBeenCalledExactlyOnceWith('Closed', '2');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(status).toHaveFocus();
  // Escape closes only the list; an open ticket's shortcuts never see it.
  fireEvent.click(status);
  const shortcut = vi.fn();
  globalThis.addEventListener('keydown', shortcut);
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search Status choices' }), {
    key: 'Escape',
  });
  globalThis.removeEventListener('keydown', shortcut);
  expect(shortcut).not.toHaveBeenCalled();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(status).toHaveFocus();
});
it('searches SDP as the operator types and loads further pages without a button', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValueOnce(reply('technician', ['Alex', 'Blair'], true))
    .mockResolvedValueOnce(reply('technician', ['Casey'], false))
    .mockResolvedValue(reply('technician', ['Morgan'], false));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(<SdpStandardSelect field="technician" label="Technician" value="" onChange={vi.fn()} />);
  fireEvent.click(sdpPicker('Technician'));
  // A first page that does not fill the list continues to the next one.
  await screen.findByRole('option', { name: 'Casey' });
  expect(invoke).toHaveBeenCalledWith({
    action: 'readStandardOptions',
    field: 'technician',
    search: '',
    page: 1,
  });
  expect(screen.queryByRole('button', { name: /More|Search/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Search Technician choices' }), {
    target: { value: ' Mor ' },
  });
  await screen.findByRole('option', { name: 'Morgan' });
  expect(screen.queryByRole('option', { name: 'Alex' })).not.toBeInTheDocument();
  expect(invoke).toHaveBeenLastCalledWith({
    action: 'readStandardOptions',
    field: 'technician',
    search: 'Mor',
    page: 0,
  });
});
it('ignores old responses after the group changes and searches again after a failure', async () => {
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
    .mockResolvedValue(reply('technician', ['New']));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const props = { field: 'technician' as const, label: 'Technician', value: '', onChange: vi.fn() };
  const { rerender } = render(<SdpStandardSelect {...props} groupId="1" />);
  fireEvent.click(sdpPicker('Technician'));
  rerender(<SdpStandardSelect {...props} groupId="2" />);
  finish(reply('technician', ['Stale']));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Choices unavailable. Type to search again.',
  );
  expect(screen.queryByRole('option', { name: 'Stale' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Search Technician choices' }), {
    target: { value: 'New' },
  });
  await screen.findByRole('option', { name: 'New' });
  expect(invoke).toHaveBeenLastCalledWith({
    action: 'readStandardOptions',
    field: 'technician',
    search: 'New',
    page: 0,
    groupId: '2',
  });
});
it('offers clearing a chosen value and Unassigned before SDP’s choices', async () => {
  globalThis.api = {
    ...original,
    sdpAccount: vi.fn().mockResolvedValue(reply('group', ['NOC'])),
  } as BridgeAPI;
  const change = vi.fn();
  render(
    <SdpStandardSelect field="group" label="Group" value="NOC" allowUnassign onChange={change} />,
  );
  fireEvent.click(sdpPicker('Group'));
  const options = await screen.findAllByRole('option');
  expect(options.map((option) => option.textContent)).toEqual(['Clear choice', 'Unassigned']);
  await screen.findByRole('option', { name: 'NOC', selected: true });
  fireEvent.click(screen.getByRole('option', { name: 'Unassigned' }));
  expect(change).toHaveBeenCalledExactlyOnceWith('(Unassigned)', undefined);
  await chooseSdpOption('Group', 'Clear choice');
  expect(change).toHaveBeenLastCalledWith('', undefined);
});
