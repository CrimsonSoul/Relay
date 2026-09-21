import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpHistoryPanel } from './SdpHistoryPanel';
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});
it('renders history as text, pages independently and clears it when access is lost', async () => {
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      history: {
        id: '123',
        page: command.page,
        hasMore: true,
        entries: [
          {
            id: '7',
            author: 'Example',
            at: 0,
            operation: 'edit',
            description: '<img src=x onerror=evil()>',
            changes: [{ field: 'Status', before: 'Open', after: 'Closed' }],
          },
        ],
      },
    },
  }));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const { container, rerender } = render(<SdpHistoryPanel id="123" enabled />);
  await screen.findByText('<img src=x onerror=evil()>');
  expect(container.querySelector('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Next history' }));
  await screen.findByText('Open → Closed');
  expect(invoke).toHaveBeenLastCalledWith({ action: 'readHistory', id: '123', page: 1 });
  rerender(<SdpHistoryPanel id="123" enabled={false} />);
  expect(screen.queryByText('Open → Closed')).not.toBeInTheDocument();
});
