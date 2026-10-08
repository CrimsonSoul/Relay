import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpChecklistChoice } from './SdpChecklistChoice';
import { chooseSdpOption, sdpPicker } from './sdpPicker.test-util';

const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});
const response = (id: string, name: string, hasMore = false) => ({
  success: true as const,
  data: {
    configured: true,
    status: 'connected' as const,
    resourceChoices: {
      catalog: 'checklist_templates' as const,
      page: 0,
      hasMore,
      choices: [{ id, name }],
    },
  },
});

it('loads authorized choices when opened, names a current selection, and sends the identifier', async () => {
  const invoke = vi.fn().mockResolvedValue(response('7', 'Restart checklist'));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const change = vi.fn();
  render(
    <SdpChecklistChoice
      id="123"
      catalog="checklist_templates"
      label="Checklist"
      value="9"
      onChange={change}
    />,
  );
  const checklist = sdpPicker('Checklist');
  expect(checklist).toHaveTextContent('Current selection');
  expect(invoke).not.toHaveBeenCalled();
  await chooseSdpOption(checklist, 'Restart checklist');
  expect(invoke).toHaveBeenCalledExactlyOnceWith({
    action: 'readResourceChoices',
    id: '123',
    catalog: 'checklist_templates',
    search: '',
    page: 0,
  });
  expect(change).toHaveBeenCalledExactlyOnceWith('7');
  expect(checklist).toHaveTextContent('Restart checklist');
});

it('loads further pages as the list fills and searches SDP with the trimmed text', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValueOnce(response('1', 'First choice', true))
    .mockResolvedValueOnce(response('2', 'Second choice'))
    .mockResolvedValueOnce(response('3', 'Network checklist'));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(
    <SdpChecklistChoice
      id="123"
      catalog="checklist_templates"
      label="Checklist"
      value=""
      onChange={vi.fn()}
    />,
  );
  fireEvent.click(sdpPicker('Checklist'));
  await screen.findByRole('option', { name: 'Second choice' });
  expect(invoke).toHaveBeenLastCalledWith({
    action: 'readResourceChoices',
    id: '123',
    catalog: 'checklist_templates',
    search: '',
    page: 1,
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Search Checklist choices' }), {
    target: { value: '  network  ' },
  });
  await screen.findByRole('option', { name: 'Network checklist' });
  expect(screen.queryByRole('option', { name: 'First choice' })).not.toBeInTheDocument();
  expect(invoke).toHaveBeenLastCalledWith({
    action: 'readResourceChoices',
    id: '123',
    catalog: 'checklist_templates',
    search: 'network',
    page: 0,
  });
});

it('reports denied or failed requests in the list and recovers on a new search', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValueOnce({ success: false })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response('1', 'Recovered checklist'));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(
    <SdpChecklistChoice
      id="123"
      catalog="checklist_templates"
      label="Checklist"
      value=""
      onChange={vi.fn()}
    />,
  );
  fireEvent.click(sdpPicker('Checklist'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Choices unavailable');
  const search = screen.getByRole('combobox', { name: 'Search Checklist choices' });
  fireEvent.change(search, { target: { value: 'first' } });
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('alert')).toHaveTextContent('Choices unavailable');
  fireEvent.change(search, { target: { value: 'retry' } });
  await screen.findByRole('option', { name: 'Recovered checklist' });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('ignores a late response for the previously opened ticket', async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  const pending = new Promise<ReturnType<typeof response>>((resolve) => {
    finish = resolve;
  });
  const invoke = vi
    .fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(response('2', 'Current ticket choice'));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const props = {
    catalog: 'checklist_templates' as const,
    label: 'Checklist',
    value: '',
    onChange: vi.fn(),
  };
  const view = render(<SdpChecklistChoice {...props} id="123" />);
  fireEvent.click(sdpPicker('Checklist'));
  view.rerender(<SdpChecklistChoice {...props} id="456" />);
  await screen.findByRole('option', { name: 'Current ticket choice' });
  await act(async () => {
    finish(response('1', 'Old ticket choice'));
    await pending;
  });
  expect(screen.queryByRole('option', { name: 'Old ticket choice' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Current ticket choice' })).toBeInTheDocument();
});
