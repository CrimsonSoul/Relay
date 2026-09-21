import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpChecklistChoice } from './SdpChecklistChoice';

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

it('loads authorized choices, preserves a current selection, and sends the selected identifier', async () => {
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
  expect(screen.getByLabelText('Checklist')).toBeDisabled();
  expect(await screen.findByRole('option', { name: 'Restart checklist' })).toHaveValue('7');
  expect(screen.getByLabelText('Checklist')).toHaveValue('9');
  expect(screen.getByRole('option', { name: 'Current selection' })).toHaveValue('9');
  expect(invoke).toHaveBeenCalledExactlyOnceWith({
    action: 'readResourceChoices',
    id: '123',
    catalog: 'checklist_templates',
    search: '',
    page: 0,
  });
  fireEvent.change(screen.getByLabelText('Checklist'), { target: { value: '7' } });
  expect(change).toHaveBeenCalledExactlyOnceWith('7');
  expect(screen.getByRole('button', { name: 'Previous choices' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'More choices' })).toBeDisabled();
});

it('pages choices and resets pagination when an analyst submits a trimmed search', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValueOnce(response('1', 'First choice', true))
    .mockResolvedValueOnce(response('2', 'Second choice', true))
    .mockResolvedValueOnce(response('1', 'First choice', true))
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
  await screen.findByRole('option', { name: 'First choice' });
  fireEvent.click(screen.getByRole('button', { name: 'More choices' }));
  await screen.findByRole('option', { name: 'Second choice' });
  expect(invoke).toHaveBeenLastCalledWith({
    action: 'readResourceChoices',
    id: '123',
    catalog: 'checklist_templates',
    search: '',
    page: 1,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Previous choices' }));
  await screen.findByRole('option', { name: 'First choice' });
  fireEvent.change(screen.getByLabelText('Search checklist'), { target: { value: '  network  ' } });
  expect(invoke).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole('button', { name: 'Search choices' }));
  await screen.findByRole('option', { name: 'Network checklist' });
  expect(invoke).toHaveBeenLastCalledWith({
    action: 'readResourceChoices',
    id: '123',
    catalog: 'checklist_templates',
    search: 'network',
    page: 0,
  });
  expect(screen.getByRole('button', { name: 'Previous choices' })).toBeDisabled();
});

it('disables selection on denied or failed requests and can recover after a new search', async () => {
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
  expect(await screen.findByRole('alert')).toHaveTextContent('Check your SDP permissions');
  expect(screen.getByLabelText('Checklist')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Search checklist'), { target: { value: 'first' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search choices' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Choices could not be loaded'),
  );
  fireEvent.change(screen.getByLabelText('Search checklist'), { target: { value: 'retry' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search choices' }));
  await screen.findByRole('option', { name: 'Recovered checklist' });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Checklist')).toBeEnabled();
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
  view.rerender(<SdpChecklistChoice {...props} id="456" />);
  await screen.findByRole('option', { name: 'Current ticket choice' });
  await act(async () => {
    finish(response('1', 'Old ticket choice'));
    await pending;
  });
  expect(screen.queryByRole('option', { name: 'Old ticket choice' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Current ticket choice' })).toBeInTheDocument();
});
