import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpAlertControls, useSdpAlerts } from './SdpAlerts';
function SdpAlerts({
  connected,
  resetKey = 0,
}: Readonly<{ connected: boolean; resetKey?: number }>) {
  const state = useSdpAlerts(connected, resetKey);
  return <SdpAlertControls state={state} onRules={() => {}} />;
}
vi.mock('../../services/pocketbase', () => ({ getPb: () => ({ baseURL: 'http://monitor.test' }) }));
vi.mock('../../hooks/useCollection', () => ({ useCollection: () => ({ data: [] }) }));
const original = globalThis.api;
afterEach(() => {
  cleanup();
  globalThis.api = original;
  vi.useRealTimers();
});
it('starts automatically, heartbeats with a snapshot cursor, and unsubscribes on pause and disconnect', async () => {
  vi.useFakeTimers();
  const invoke = vi.fn().mockResolvedValue({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      monitoring: { state: 'live', nextCheckAt: 30000 },
      monitor: { tickets: [], fetchedAt: 1000, truncated: false, generation: 'a' },
    },
  });
  globalThis.api = { sdpAccount: invoke } as unknown as BridgeAPI;
  const view = render(<SdpAlerts connected />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(invoke).toHaveBeenCalledWith({ action: 'monitorQueues', after: undefined });
  expect(screen.getByRole('button', { name: 'Stop monitoring' })).toBeEnabled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(invoke).toHaveBeenLastCalledWith({ action: 'monitorQueues', after: 1000 });
  fireEvent.click(screen.getByRole('button', { name: 'Stop monitoring' }));
  expect(invoke).toHaveBeenLastCalledWith({ action: 'monitorQueues', enabled: false });
  const count = invoke.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(invoke).toHaveBeenCalledTimes(count);
  fireEvent.click(screen.getByRole('button', { name: 'Monitor queues' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  view.rerender(<SdpAlerts connected={false} />);
  expect(invoke).toHaveBeenLastCalledWith({ action: 'monitorQueues', enabled: false });
});
it.each([
  ['invalid', 'Relay could not read an SDP queue response.'],
  ['throttled', 'SDP requested a pause before more API calls.'],
  ['timeout', 'The queue scan took too long.'],
  ['outage', 'SDP could not be reached.'],
])('shows %s backoff without losing the connection', async (failure, message) => {
  vi.useFakeTimers();
  const invoke = vi.fn().mockResolvedValue({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      monitoring: { state: 'backoff', failure, nextCheckAt: Date.now() + 120000 },
    },
  });
  globalThis.api = { sdpAccount: invoke } as unknown as BridgeAPI;
  render(<SdpAlerts connected />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByRole('status')).toHaveTextContent('Next check');
  expect(screen.getByRole('status')).toHaveTextContent(message);
  expect(screen.getByRole('button', { name: 'Stop monitoring' })).toBeEnabled();
});
it('clearing saved data pauses monitoring and prevents automatic repopulation', async () => {
  vi.useFakeTimers();
  const invoke = vi
    .fn()
    .mockResolvedValue({ success: true, data: { configured: true, status: 'connected' } });
  globalThis.api = { sdpAccount: invoke } as unknown as BridgeAPI;
  const view = render(<SdpAlerts connected resetKey={0} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  view.rerender(<SdpAlerts connected resetKey={1} />);
  expect(screen.getByRole('button', { name: 'Monitor queues' })).toBeEnabled();
  expect(invoke).toHaveBeenLastCalledWith({ action: 'monitorQueues', enabled: false });
  const count = invoke.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(90000);
  });
  expect(invoke).toHaveBeenCalledTimes(count);
});
