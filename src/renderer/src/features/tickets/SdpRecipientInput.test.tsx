import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
import { SdpRecipientInput } from './SdpRecipientInput';

const original = globalThis.api;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  globalThis.api = original;
});

function Field({ initial = '' }: Readonly<{ initial?: string }>) {
  const [value, setValue] = useState(initial);
  return (
    <SdpRecipientInput
      ticketId="123"
      label="Cc"
      value={value}
      known={['requester@example.test', 'watcher@example.test']}
      maxLength={12000}
      onChange={setValue}
    />
  );
}
function mockSearch(reply: unknown) {
  const invoke = vi.fn().mockResolvedValue(reply);
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  return invoke;
}
async function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

it("suggests the ticket's people first, then people SDP finds, and fills the chosen address", async () => {
  const invoke = mockSearch({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      recipients: {
        search: 'wa',
        people: [
          { name: 'Wanda Tech', email: 'wanda@example.test' },
          { name: 'Watcher', email: 'WATCHER@example.test' },
        ],
      },
    },
  });
  render(<Field initial="someone@example.test, " />);
  const input = screen.getByRole('combobox', { name: 'Cc' });
  fireEvent.focus(input);
  await type(input, 'someone@example.test, wa');
  expect(invoke).toHaveBeenCalledWith({ action: 'searchRecipients', id: '123', search: 'wa' });
  const options = screen.getAllByRole('option');
  expect(options.map((o) => o.textContent)).toEqual([
    'watcher@example.test',
    'Wanda Techwanda@example.test',
  ]);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(options[1]).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input).toHaveValue('someone@example.test, wanda@example.test, ');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

it('leaves out addresses already entered and closes on Escape without clearing the field', async () => {
  mockSearch({ success: true, data: { configured: true, status: 'connected' } });
  render(<Field />);
  const input = screen.getByRole('combobox', { name: 'Cc' });
  fireEvent.focus(input);
  await type(input, 'watcher@example.test; exa');
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
    'requester@example.test',
  ]);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(input).toHaveValue('watcher@example.test; exa');
});

it('keeps suggesting the ticket people when the Relay server predates recipient search', async () => {
  const invoke = mockSearch({
    success: false,
    error: 'The Relay server needs an update for this action.',
  });
  render(<Field />);
  const input = screen.getByRole('combobox', { name: 'Cc' });
  fireEvent.focus(input);
  await type(input, 'req');
  expect(screen.getByRole('option')).toHaveTextContent('requester@example.test');
  await type(input, 'requ');
  expect(invoke).toHaveBeenCalledOnce();
});
