import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpQueueFilterBar } from './SdpQueueFilterBar';
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});
const reply = (names: string[], hasMore = false) => ({
  success: true,
  data: {
    configured: true,
    status: 'connected',
    options: {
      field: 'technician',
      hasMore,
      choices: names.map((name, index) => ({ label: name, value: { id: String(index), name } })),
    },
  },
});
const ticket = {
  id: '123',
  number: '810129',
  subject: 'Synthetic ticket',
  status: 'Open',
  priority: 'Low',
  group: 'NOC',
  technician: 'Page Technician',
  createdAt: 1000,
  dueAt: null,
};

it('searches SDP from the top of a filter list and keeps loading as the list fills', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValueOnce(reply(['Alex'], true))
    .mockResolvedValueOnce(reply(['Blair']))
    .mockResolvedValue(reply(['Morgan']));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(<SdpQueueFilterBar tickets={[ticket]} disabled={false} connected onApply={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Technician All' }));
  const search = screen.getByRole('searchbox', { name: 'Search technician' });
  expect(search).toHaveFocus();
  await screen.findByRole('checkbox', { name: 'Blair' });
  expect(invoke).toHaveBeenCalledWith({
    action: 'readStandardOptions',
    field: 'technician',
    search: '',
    page: 1,
  });
  // Values on the loaded page stay available beside SDP's list.
  expect(screen.getByRole('checkbox', { name: 'Page Technician' })).toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'mor' } });
  await screen.findByRole('checkbox', { name: 'Morgan' });
  expect(invoke).toHaveBeenLastCalledWith({
    action: 'readStandardOptions',
    field: 'technician',
    search: 'mor',
    page: 0,
  });
  expect(screen.queryByRole('checkbox', { name: 'Alex' })).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Page Technician' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Morgan' }));
  expect(screen.getByRole('button', { name: 'Technician Morgan' })).toBeVisible();
});

it('filters page values locally when SDP is not connected', () => {
  const invoke = vi.fn();
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(
    <SdpQueueFilterBar
      tickets={[ticket, { ...ticket, id: '2', technician: 'Second Person' }]}
      disabled={false}
      connected={false}
      onApply={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Technician All' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search technician' }), {
    target: { value: 'second' },
  });
  expect(screen.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent)).toEqual([
    'Second Person',
  ]);
  expect(invoke).not.toHaveBeenCalled();
});
