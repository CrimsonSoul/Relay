import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ELECTRON_RUNTIME } from '@shared/runtime';
import { LiveSdpQueues } from './LiveSdpQueues';
vi.mock('../../services/pocketbase', () => ({ getPb: () => ({ baseURL: 'http://draft.test' }) }));
vi.mock('./SdpNativeEditor', () => ({
  SdpNativeEditor: ({ onClose }: Readonly<{ onClose: () => void }>) => (
    <>
      <input aria-label="Draft" defaultValue="" />
      <button onClick={onClose}>Finish draft</button>
    </>
  ),
}));
const original = globalThis.api;
afterEach(() => {
  cleanup();
  globalThis.api = original;
});
it('defers notification navigation while a draft is open and opens it after the draft ends', async () => {
  let view: unknown;
  const invoke = vi.fn().mockImplementation(async (command) => {
    if (command.action === 'status' && view) return { success: true, data: view };
    const id = command.id ?? '123';
    view = {
      configured: true,
      status: 'connected',
      replyActivity: {
        id,
        number: id,
        subject: `Ticket ${id}`,
        status: 'Open',
        priority: 'Low',
        group: 'NOC',
        technician: '',
        createdAt: 1000,
        dueAt: null,
      },
      detail: { id, description: '', conversations: [], page: 0, hasMore: false },
      snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
      detailSnapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
    };
    return { success: true, data: view };
  });
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as never;
  const rendered = render(
    <LiveSdpQueues
      request={{ destination: 'ticket', source: 'sdp', ticketId: '123', sequence: 1 }}
    />,
  );
  await screen.findByRole('heading', { name: 'Ticket 123' });
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Keep this reply' } });
  rendered.rerender(
    <LiveSdpQueues
      request={{ destination: 'ticket', source: 'sdp', ticketId: '999', sequence: 2 }}
    />,
  );
  expect(screen.getByLabelText('Draft')).toHaveValue('Keep this reply');
  expect(invoke).not.toHaveBeenCalledWith({ action: 'readDetail', id: '999', page: 0 });
  expect(
    screen.getByText('Finish or cancel your draft to open the notified ticket.'),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Finish draft' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({ action: 'readDetail', id: '999', page: 0 }),
  );
  await screen.findByRole('heading', { name: 'Ticket 999' });
});
