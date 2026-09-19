import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpChangeDialog } from './SdpChangeDialog';
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});
it('requires the default template requester before reviewing a major incident', () => {
  const invoke = vi.fn();
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(<SdpChangeDialog mode="major" onClose={vi.fn()} onResult={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Test incident' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
  expect(screen.getByRole('status')).toHaveTextContent('Enter a requester email');
  expect(invoke).not.toHaveBeenCalled();
});
it('reviews a real create before sending its one-use confirmation, then prevents resubmission', async () => {
  const id = 'f6d1a214-87d9-45ef-9bce-b1a850e5d301';
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(command.action === 'prepareChange'
        ? {
            review: {
              confirmationId: id,
              expiresAt: Date.now() + 300000,
              mutation: command.mutation,
            },
          }
        : {
            changeResult: { id: '123', number: '789', kind: 'create' },
            message: 'Change confirmed by SDP.',
          }),
    },
  }));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const result = vi.fn();
  render(<SdpChangeDialog mode="major" onClose={vi.fn()} onResult={result} />);
  fireEvent.change(screen.getByLabelText('Subject'), {
    target: { value: 'Synthetic major incident' },
  });
  fireEvent.change(screen.getByLabelText('Requester email'), {
    target: { value: 'test@example.test' },
  });
  expect(screen.getByRole('checkbox', { name: 'Major Incident' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
  const confirm = await screen.findByRole('button', { name: 'Confirm live change' });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0]?.[0]).toMatchObject({
    action: 'prepareChange',
    mutation: {
      majorIncident: true,
      templateId: '142866000146669084',
      requesterEmail: 'test@example.test',
      fields: {
        subject: 'Synthetic major incident',
        requestType: 'Incident',
        impact: 'Single User',
        urgency: 'Medium',
      },
    },
  });
  expect(screen.getByText(/Major Incident: Yes/)).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Review live change' })).toHaveTextContent(
    'Synthetic major incident',
  );
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
  expect(invoke).toHaveBeenLastCalledWith({ action: 'confirmChange', confirmationId: id });
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Confirm live change' })).not.toBeInTheDocument();
});
it('does not claim success or offer an automatic retry after a lost write response', async () => {
  const invoke = vi.fn().mockImplementation(async (command) => {
    if (command.action === 'confirmChange') throw new Error('Connection lost');
    return {
      success: true,
      data: {
        configured: true,
        status: 'connected',
        review: {
          confirmationId: 'f6d1a214-87d9-45ef-9bce-b1a850e5d301',
          expiresAt: Date.now() + 300000,
          mutation: command.mutation,
        },
      },
    };
  });
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const result = vi.fn();
  render(<SdpChangeDialog mode="create" onClose={vi.fn()} onResult={result} />);
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm live change' }));
  expect(await screen.findByRole('status')).toHaveTextContent('uncertain');
  expect(result).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledTimes(2);
});
