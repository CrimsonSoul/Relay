import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpBulkDialog } from './SdpBulkDialog';
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});
const tickets = ['123', '456'].map((id) => ({
  id,
  number: id,
  subject: 'Sample ' + id,
  status: 'Open',
  priority: 'Low',
  group: 'NOC' as const,
  technician: 'Example',
  createdAt: 0,
  dueAt: null,
}));
it('reviews explicit targets and displays partial results without retrying', async () => {
  const invoke = vi.fn().mockImplementation(async (c) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(c.action === 'readStandardOptions'
        ? {
            options: {
              field: c.field,
              hasMore: false,
              choices: [{ label: 'Closed', value: { id: '2', name: 'Closed' } }],
            },
          }
        : {}),
      ...(c.action === 'prepareChange'
        ? {
            review: {
              confirmationId: '00000000-0000-4000-8000-000000000001',
              expiresAt: Date.now() + 60000,
              mutation: c.mutation,
            },
          }
        : {
            bulkResult: [
              { id: '123', status: 'confirmed' },
              { id: '456', status: 'uncertain' },
            ],
            message: 'Batch stopped',
          }),
    },
  }));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(<SdpBulkDialog tickets={tickets} onClose={vi.fn()} onResult={vi.fn()} />);
  fireEvent.focus(screen.getByLabelText('Status', { exact: true }));
  await screen.findByRole('option', { name: 'Closed' });
  fireEvent.change(screen.getByLabelText('Status', { exact: true }), {
    target: { value: 'Closed' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review bulk changes' }));
  const confirm = await screen.findByRole('button', { name: 'Confirm 2 live changes' });
  expect(invoke).toHaveBeenCalledWith({
    action: 'prepareChange',
    mutation: { kind: 'bulk', ids: ['123', '456'], fields: { status: 'Closed' } },
  });
  expect(invoke.mock.calls.some(([c]) => c.action === 'confirmChange')).toBe(false);
  fireEvent.click(confirm);
  await screen.findByText('Batch stopped');
  expect(screen.getByText(/Not confirmed — check SDP/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Confirm 2/ })).not.toBeInTheDocument();
  expect(invoke.mock.calls.filter(([c]) => c.action !== 'readStandardOptions')).toHaveLength(2);
});
