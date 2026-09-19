import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpAttachmentsPanel } from './SdpAttachmentsPanel';
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});
it('requires a separate confirmation after selecting an attachment and never retries an uncertain upload', async () => {
  const invoke = vi.fn().mockImplementation(async (command) => {
    if (command.action === 'confirmChange') throw new Error('connection lost');
    return {
      success: true,
      data: {
        configured: true,
        status: 'connected',
        review: {
          confirmationId: 'f6d1a214-87d9-45ef-9bce-b1a850e5d301',
          expiresAt: Date.now() + 300000,
          mutation: { ...command.mutation, data: '' },
        },
      },
    };
  });
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(<SdpAttachmentsPanel id="123" files={[]} enabled onResult={vi.fn()} />);
  const file = new File(['dummy bytes'], 'example.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('dummy bytes').buffer,
  });
  fireEvent.change(screen.getByLabelText('Add attachment (up to 10 MB)'), {
    target: { files: [file] },
  });
  const confirm = await screen.findByRole('button', { name: 'Confirm live change' });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0]![0].action).toBe('prepareChange');
  fireEvent.click(confirm);
  await screen.findByText(/result is uncertain/);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Confirm live change' })).not.toBeInTheDocument();
});
it('downloads only the chosen attachment and disables file access for an outage copy', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValue({ success: true, data: { message: 'Download cancelled.' } });
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const props = {
    id: '123',
    files: [{ id: '4', name: 'example.txt', size: 20, contentType: 'text/plain' }],
    onResult: vi.fn(),
  };
  const { rerender } = render(<SdpAttachmentsPanel {...props} enabled />);
  fireEvent.click(screen.getByRole('button', { name: 'Save example.txt' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({
      action: 'downloadAttachment',
      id: '123',
      attachmentId: '4',
    }),
  );
  await screen.findByText('Download cancelled.');
  rerender(<SdpAttachmentsPanel {...props} enabled={false} />);
  expect(screen.getByRole('button', { name: 'Save example.txt' })).toBeDisabled();
  expect(screen.getByLabelText('Add attachment (up to 10 MB)')).toBeDisabled();
});
