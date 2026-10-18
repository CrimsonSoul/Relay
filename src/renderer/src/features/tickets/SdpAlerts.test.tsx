import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { ELECTRON_RUNTIME } from '@shared/runtime';
import { defaultTicketPreferences } from '@shared/serviceDesk';
import { resetSdpNotifications, SdpAlertControls, useSdpAlerts } from './SdpAlerts';
import type { SdpStatusOutcome } from './sdpStatusPoller';

const mocks = vi.hoisted(() => ({
  subscribers: new Set<() => ((outcome: SdpStatusOutcome) => void) | undefined>(),
  notifications: { publish: vi.fn(), clear: vi.fn() },
}));
vi.mock('./sdpStatusPoller', () => ({
  subscribeSdpStatus: (subscriber: () => ((outcome: SdpStatusOutcome) => void) | undefined) => {
    mocks.subscribers.add(subscriber);
    return () => mocks.subscribers.delete(subscriber);
  },
}));
vi.mock('../notifications/NotificationProvider', () => ({
  useNotifications: () => mocks.notifications,
}));
vi.mock('../../services/pocketbase', () => ({ getPb: () => ({ baseURL: 'http://monitor.test' }) }));
vi.mock('../../hooks/useCollection', () => ({ useCollection: () => ({ data: [] }) }));
function SdpAlerts() {
  const state = useSdpAlerts();
  return <SdpAlertControls state={state} onRules={() => {}} />;
}
/** One shared status check reaching every subscriber, as the poller delivers it. */
function status(outcome: SdpStatusOutcome) {
  act(() => {
    for (const subscriber of [...mocks.subscribers]) subscriber()?.(outcome);
  });
}
const signedIn: SdpStatusOutcome = {
  result: { success: true, data: { configured: true, status: 'connected' } },
};
const signedOut: SdpStatusOutcome = {
  result: { success: true, data: { configured: true, status: 'disconnected' } },
};
const flush = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const ticket = {
  id: '1',
  number: '100',
  subject: 'Private subject',
  status: 'Open',
  priority: 'Low',
  group: 'NOC',
  technician: 'Example technician',
  createdAt: 100,
  dueAt: null,
};
const monitor = (fetchedAt: number, tickets: object[]) => ({
  success: true,
  data: {
    configured: true,
    status: 'connected',
    monitoring: { state: 'live', nextCheckAt: fetchedAt + 30000 },
    monitor: { tickets, fetchedAt, truncated: false, generation: 'a' },
  },
});
function saveRule() {
  localStorage.setItem(
    'relay:sdp-alert-rules:http://monitor.test',
    JSON.stringify({
      ...defaultTicketPreferences(),
      rules: [
        {
          id: 'rule',
          name: 'Every change',
          enabled: true,
          events: ['created', 'priority'],
          match: 'all',
          conditions: [],
          inbox: true,
          toast: true,
          desktop: false,
          sound: false,
          cooldownMinutes: 0,
        },
      ],
    }),
  );
}
const original = globalThis.api;
const useApi = (invoke: ReturnType<typeof vi.fn>) => {
  globalThis.api = { runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as unknown as BridgeAPI;
};
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  mocks.notifications.publish.mockReset();
  mocks.notifications.clear.mockReset();
});
afterEach(() => {
  cleanup();
  mocks.subscribers.clear();
  globalThis.api = original;
  vi.useRealTimers();
});
it('starts automatically, heartbeats with a snapshot cursor, and unsubscribes on pause and disconnect', async () => {
  const invoke = vi.fn().mockResolvedValue(monitor(1000, []));
  useApi(invoke);
  render(<SdpAlerts />);
  status(signedIn);
  await flush();
  expect(invoke).toHaveBeenCalledWith({ action: 'monitorQueues', after: undefined });
  expect(screen.getByRole('button', { name: 'Stop Monitoring' })).toBeEnabled();
  await flush(5000);
  expect(invoke).toHaveBeenLastCalledWith({ action: 'monitorQueues', after: 1000 });
  // The check time and count are visible but outside the live region; only state is announced.
  expect(screen.getByText(/^0 tickets checked · /)).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/^Monitoring queues$/);
  fireEvent.click(screen.getByRole('button', { name: 'Stop Monitoring' }));
  expect(invoke).toHaveBeenLastCalledWith({ action: 'monitorQueues', enabled: false });
  const count = invoke.mock.calls.length;
  await flush(30000);
  expect(invoke).toHaveBeenCalledTimes(count);
  fireEvent.click(screen.getByRole('button', { name: 'Monitor Queues' }));
  await flush();
  status(signedOut);
  expect(invoke).toHaveBeenLastCalledWith({ action: 'monitorQueues', enabled: false });
  expect(screen.getByRole('button', { name: 'Monitor Queues' })).toBeDisabled();
});
it('keeps monitoring through a failed status check and remembers Stop across sign-ins', async () => {
  const invoke = vi.fn().mockResolvedValue(monitor(1000, []));
  useApi(invoke);
  render(<SdpAlerts />);
  status(signedIn);
  await flush();
  const clears = mocks.notifications.clear.mock.calls.length;
  // A transport failure or a refused check is not a sign-out.
  status({ error: new Error('IPC failed') });
  status({ result: { success: false, error: 'Busy' } });
  await flush();
  expect(screen.getByRole('button', { name: 'Stop Monitoring' })).toBeEnabled();
  expect(invoke).not.toHaveBeenCalledWith({ action: 'monitorQueues', enabled: false });
  expect(mocks.notifications.clear).toHaveBeenCalledTimes(clears);
  fireEvent.click(screen.getByRole('button', { name: 'Stop Monitoring' }));
  status(signedOut);
  status(signedIn);
  await flush(10000);
  expect(screen.getByRole('button', { name: 'Monitor Queues' })).toBeEnabled();
  expect(invoke).toHaveBeenLastCalledWith({ action: 'monitorQueues', enabled: false });
});
it('keeps the inbox and last snapshot through a failed check, then alerts on what changed', async () => {
  saveRule();
  const invoke = vi
    .fn()
    .mockResolvedValueOnce(monitor(1000, [ticket]))
    .mockRejectedValueOnce(new Error('Relay server unreachable'))
    .mockResolvedValueOnce({
      success: true,
      data: {
        configured: true,
        status: 'connected',
        monitoring: { state: 'backoff', failure: 'outage', nextCheckAt: 20000 },
      },
    })
    .mockResolvedValue(monitor(4000, [{ ...ticket, priority: 'High' }]));
  useApi(invoke);
  render(<SdpAlerts />);
  status(signedIn);
  await flush();
  const clears = mocks.notifications.clear.mock.calls.length;
  await flush(5000);
  expect(screen.getByRole('status')).toHaveTextContent(/Reconnecting automatically/);
  await flush(5000);
  expect(screen.getByRole('status')).toHaveTextContent('SDP could not be reached.');
  expect(mocks.notifications.publish).not.toHaveBeenCalled();
  await flush(5000);
  expect(mocks.notifications.clear).toHaveBeenCalledTimes(clears);
  expect(mocks.notifications.publish).toHaveBeenCalledOnce();
  expect(mocks.notifications.publish.mock.calls[0]![0]).toMatchObject({
    title: 'Ticket #100',
    message: 'Every change · priority',
    interrupt: undefined,
  });
});
it('marks VIP arrivals to interrupt quiet hours and snooze, and other rules not', async () => {
  saveRule();
  const invoke = vi
    .fn()
    .mockResolvedValueOnce(monitor(1000, []))
    .mockResolvedValue(
      monitor(2000, [
        { ...ticket, id: '7', number: '107', createdAt: 1500, vip: true },
        { ...ticket, id: '8', number: '108', createdAt: 1500 },
      ]),
    );
  useApi(invoke);
  render(<SdpAlerts />);
  status(signedIn);
  await flush();
  await flush(5000);
  const published = mocks.notifications.publish.mock.calls.map(([input]) => input);
  expect(published).toHaveLength(2);
  expect(published[0]).toMatchObject({ title: 'VIP ticket #107', interrupt: true });
  expect(published[1]).toMatchObject({ title: 'Ticket #108' });
  expect(published[1].interrupt).toBeUndefined();
});
it.each([
  ['invalid', 'Relay could not read an SDP queue response.'],
  ['throttled', 'SDP requested a pause before more API calls.'],
  ['timeout', 'The queue scan took too long.'],
  ['outage', 'SDP could not be reached.'],
])('shows %s backoff without losing the connection', async (failure, message) => {
  const invoke = vi.fn().mockResolvedValue({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      monitoring: { state: 'backoff', failure, nextCheckAt: Date.now() + 120000 },
    },
  });
  useApi(invoke);
  render(<SdpAlerts />);
  status(signedIn);
  await flush();
  expect(screen.getByText(/Next check/)).toHaveTextContent(message);
  expect(screen.getByRole('status')).toHaveTextContent(new RegExp(`^${message}$`));
  expect(screen.getByRole('button', { name: 'Stop Monitoring' })).toBeEnabled();
});
it('clearing saved data pauses monitoring and prevents automatic repopulation', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValue({ success: true, data: { configured: true, status: 'connected' } });
  useApi(invoke);
  render(<SdpAlerts />);
  status(signedIn);
  await flush();
  act(() => resetSdpNotifications());
  expect(screen.getByRole('button', { name: 'Monitor Queues' })).toBeEnabled();
  expect(invoke).toHaveBeenLastCalledWith({ action: 'monitorQueues', enabled: false });
  expect(mocks.notifications.clear).toHaveBeenLastCalledWith('Tickets');
  const count = invoke.mock.calls.length;
  status(signedIn);
  await flush(90000);
  expect(invoke).toHaveBeenCalledTimes(count);
});
