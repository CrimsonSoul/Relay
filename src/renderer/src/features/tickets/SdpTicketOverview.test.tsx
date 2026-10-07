import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpTicketOverview } from './SdpTicketOverview';
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});
const ticket = {
  id: '123',
  number: '810129',
  subject: 'Synthetic ticket',
  status: 'Open',
  priority: 'Low',
  group: 'NOC' as const,
  technician: '',
  createdAt: 1000,
  dueAt: null,
};
it('shows the key properties as text and never reads or changes SDP', () => {
  const invoke = vi.fn();
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(<SdpTicketOverview ticket={ticket} />);
  const values = Object.fromEntries(
    screen
      .getAllByRole('term')
      .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
  );
  expect(values).toMatchObject({
    Status: 'Open',
    Priority: 'Low',
    'Support group': 'NOC',
    Technician: 'No technician',
  });
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(invoke).not.toHaveBeenCalled();
});
