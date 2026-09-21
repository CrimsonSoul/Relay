import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpTicketRelationsPanel } from './SdpTicketRelationsPanel';
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});
const ticket = {
  id: '123',
  number: 'IN-1',
  subject: 'Main ticket',
  status: 'Open',
  priority: 'Low',
  group: 'NOC' as const,
  technician: '',
  createdAt: 1,
  dueAt: null,
};
function setup(allowed = true) {
  const invoke = vi.fn().mockImplementation(async (c) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(c.action === 'readTicketRelations'
        ? {
            ticketRelations: {
              id: '123',
              linked: [{ id: '789', number: 'IN-3', subject: 'Related' }],
              candidate: c.number ? { id: '456', number: 'IN-2', subject: 'Duplicate' } : null,
              canLink: allowed,
              canUnlink: allowed,
              canMerge: allowed,
              hasMore: false,
            },
          }
        : {}),
      ...(c.action === 'prepareChange'
        ? {
            review: {
              confirmationId: 'review-id',
              mutation: c.mutation,
              expiresAt: Date.now() + 300000,
            },
          }
        : {}),
      ...(c.action === 'confirmChange'
        ? { message: 'Confirmed', changeResult: { id: '123', number: 'IN-1', kind: 'relation' } }
        : {}),
    },
  }));
  globalThis.api = { sdpAccount: invoke } as unknown as BridgeAPI;
  const onResult = vi.fn();
  render(<SdpTicketRelationsPanel ticket={ticket} enabled onResult={onResult} />);
  return { invoke, onResult };
}
it('searches by ticket number and requires a review with explicit merge direction before submitting once', async () => {
  const { invoke, onResult } = setup();
  await screen.findByText('IN-3: Related');
  fireEvent.change(screen.getByLabelText('Ticket number'), { target: { value: 'IN-2' } });
  fireEvent.click(screen.getByText('Find ticket'));
  await screen.findByText('IN-2: Duplicate');
  fireEvent.click(screen.getByText('Merge duplicate into IN-1'));
  await screen.findByText(/Merge IN-2 into IN-1/);
  expect(invoke).toHaveBeenCalledWith({
    action: 'prepareChange',
    mutation: { kind: 'relation', id: '123', targetId: '456', operation: 'merge' },
  });
  expect(invoke.mock.calls.some(([c]) => c.action === 'confirmChange')).toBe(false);
  fireEvent.click(screen.getByText('Confirm merge'));
  await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
  expect(invoke.mock.calls.filter(([c]) => c.action === 'confirmChange')).toHaveLength(1);
  expect(screen.queryByText('Confirm merge')).toBeNull();
});
it('prepares unlink without merging or deleting either ticket', async () => {
  const { invoke } = setup();
  fireEvent.click(await screen.findByText('Unlink IN-3'));
  await screen.findByText('Confirm unlink');
  expect(invoke).toHaveBeenCalledWith({
    action: 'prepareChange',
    mutation: { kind: 'relation', id: '123', targetId: '789', operation: 'unlink' },
  });
  fireEvent.click(screen.getByText('Cancel'));
  await screen.findByText('Find ticket');
  expect(invoke.mock.calls.some(([c]) => c.action === 'confirmChange')).toBe(false);
});
it('hides mutation controls when SDP does not grant permission', async () => {
  const { invoke } = setup(false);
  await screen.findByText('IN-3: Related');
  expect(screen.queryByText('Find ticket')).toBeNull();
  expect(screen.queryByText('Unlink IN-3')).toBeNull();
  expect(invoke).toHaveBeenCalledTimes(1);
});
