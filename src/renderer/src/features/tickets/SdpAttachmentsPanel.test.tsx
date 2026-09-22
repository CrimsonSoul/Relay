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
  render(<SdpAttachmentsPanel id="123" number="900123" files={[]} enabled onResult={vi.fn()} />);
  const file = new File(['dummy bytes'], 'example.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('dummy bytes').buffer,
  });
  fireEvent.change(screen.getByLabelText('Add attachment (up to 10 MB)'), {
    target: { files: [file] },
  });
  const confirm = await screen.findByRole('button', { name: 'Upload attachment' });
  expect(screen.getByText('11 B · Ticket 900123')).toBeVisible();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0]![0].action).toBe('prepareChange');
  fireEvent.click(confirm);
  await screen.findByText(/result is uncertain/);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Upload attachment' })).not.toBeInTheDocument();
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
  expect(screen.getByRole('button', { name: 'Add attachment' })).toBeDisabled();
  expect(screen.getByText('Reconnect to SDP to upload or save files.')).toBeVisible();
});

it('keeps long filenames out of button text and explains unavailable downloads', () => {
  const longName =
    'Database-diagnostics-for-primary-cluster-after-scheduled-maintenance-2026-09-20.log';
  render(
    <SdpAttachmentsPanel
      id="123"
      enabled
      files={[
        { id: '1', name: longName, size: 1536, contentType: 'text/plain' },
        { id: '2', name: 'large.zip', size: 11 * 1024 * 1024, contentType: 'application/zip' },
      ]}
      onResult={vi.fn()}
    />,
  );
  expect(screen.getByText(longName)).toBeVisible();
  expect(screen.getByRole('button', { name: `Save ${longName}` })).toHaveTextContent('Save file');
  expect(screen.getByText('2 KB')).toBeVisible();
  expect(screen.getByText('11 MB · Over the 10 MB download limit')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save large.zip' })).toBeDisabled();
});

it('restores keyboard focus to Add attachment when upload review is cancelled', async () => {
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      review:
        command.action === 'prepareChange'
          ? {
              confirmationId: 'f6d1a214-87d9-45ef-9bce-b1a850e5d301',
              expiresAt: Date.now() + 300000,
              mutation: { ...command.mutation, data: '' },
            }
          : undefined,
    },
  }));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(<SdpAttachmentsPanel id="123" number="900123" files={[]} enabled onResult={vi.fn()} />);
  const file = new File(['sample'], 'evidence.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('sample').buffer,
  });
  fireEvent.change(screen.getByLabelText('Add attachment (up to 10 MB)'), {
    target: { files: [file] },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add attachment' })).toHaveFocus());
  expect(invoke).toHaveBeenLastCalledWith({ action: 'cancelChange' });
  expect(invoke.mock.calls.some(([command]) => command.action === 'confirmChange')).toBe(false);
});
