import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { historyField, historyOperation, SdpHistoryPanel } from './SdpHistoryPanel';
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
  expect(screen.getByRole('button', { name: 'Newer History' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Older History' }));
  await screen.findByRole('button', { name: 'Newer History' });
  await waitFor(() => expect(screen.getByRole('definition')).toHaveTextContent('Open → Closed'));
  expect(invoke).toHaveBeenLastCalledWith({ action: 'readHistory', id: '123', page: 1 });
  rerender(<SdpHistoryPanel id="123" enabled={false} />);
  expect(screen.queryByRole('definition')).not.toBeInTheDocument();
});
it('reads SDP operations and fields as words, grouped by day, with set and cleared values', async () => {
  const at = new Date(2026, 9, 6, 18, 46).getTime();
  globalThis.api = {
    ...original,
    sdpAccount: vi.fn().mockResolvedValue({
      success: true,
      data: {
        configured: true,
        status: 'connected',
        history: {
          id: '123',
          page: 0,
          hasMore: false,
          entries: [
            {
              id: '3',
              author: 'Example',
              at,
              operation: 'edit',
              description: '',
              changes: [
                { field: 'start_time', before: '-', after: 'Oct 6, 2026 06:46 PM' },
                { field: 'technician', before: 'Example', after: '' },
              ],
            },
            {
              id: '2',
              author: 'Example',
              at: at - 4000,
              operation: 'request_note_add',
              description: '',
              changes: [{ field: 'note', before: '', after: 'juniper' }],
            },
          ],
        },
      },
    }),
  } as BridgeAPI;
  render(<SdpHistoryPanel id="123" enabled />);
  const day = await screen.findByRole('region', { name: /Oct 6|Today|Yesterday/ });
  const entries = within(day).getAllByRole('listitem');
  expect(within(entries[0]!).getByRole('heading', { name: 'Edited' })).toBeInTheDocument();
  expect(within(entries[0]!).getByText('Start time').nextSibling).toHaveTextContent(
    /^Oct 6, 2026 06:46 PM$/,
  );
  expect(within(entries[0]!).getByText('Technician').nextSibling).toHaveTextContent(
    'Cleared (was Example)',
  );
  expect(within(entries[1]!).getByRole('heading', { name: 'Note added' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Older History' })).not.toBeInTheDocument();
});
it('names operations and fields in plain words', () => {
  expect(historyOperation('add')).toBe('Created');
  expect(historyOperation('workflow_instance_created')).toBe('Workflow started');
  expect(historyOperation('request_note_add')).toBe('Note added');
  expect(historyOperation('worklog_delete')).toBe('Worklog deleted');
  expect(historyOperation('MERGE')).toBe('Merge');
  expect(historyField('start_time')).toBe('Start time');
});
