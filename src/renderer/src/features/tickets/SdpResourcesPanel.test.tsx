import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpResourcesPanel } from './SdpResourcesPanel';
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});
it('loads tasks on demand and reviews a live task before confirming it', async () => {
  let status = 'Open';
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(command.action === 'readResources'
        ? {
            resources: {
              id: '123',
              resource: 'tasks',
              page: 0,
              hasMore: false,
              rows: [
                {
                  id: '4',
                  title: 'Investigate',
                  status,
                  fields: { title: 'Investigate', status },
                },
              ],
            },
          }
        : {}),
      ...(command.action === 'prepareChange'
        ? {
            review: {
              confirmationId: 'f6d1a214-87d9-45ef-9bce-b1a850e5d301',
              expiresAt: Date.now() + 300000,
              mutation: command.mutation,
            },
          }
        : {}),
    },
  }));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const result = vi.fn();
  render(<SdpResourcesPanel id="123" enabled onResult={result} />);
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
  await screen.findByRole('heading', { name: 'Investigate' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Closed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review Change' }));
  const confirm = await screen.findByRole('button', { name: 'Confirm Live Change' });
  expect(invoke).toHaveBeenLastCalledWith(
    expect.objectContaining({
      action: 'prepareChange',
      mutation: expect.objectContaining({
        recordId: '4',
        fields: { status: 'Closed' },
      }),
    }),
  );
  expect(invoke.mock.calls.some(([command]) => command.action === 'confirmChange')).toBe(false);
  status = 'Closed';
  fireEvent.click(confirm);
  await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect((await screen.findAllByText('Closed')).length).toBeGreaterThan(0);
  expect(invoke.mock.calls.filter(([command]) => command.action === 'readResources')).toHaveLength(
    2,
  );
});
it('does not load or expose writes on an outage copy', () => {
  const invoke = vi.fn();
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(<SdpResourcesPanel id="123" enabled={false} onResult={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Tasks' })).toBeDisabled();
  expect(invoke).not.toHaveBeenCalled();
});
