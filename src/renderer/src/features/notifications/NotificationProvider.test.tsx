import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  NotificationProvider,
  useNotifications,
  type NotificationInput,
} from './NotificationProvider';
import { TICKET_NAVIGATION_EVENT } from '../tickets/ticketNavigation';
const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  sound: vi.fn(async () => true),
  desktop: vi.fn(async () => true),
}));
vi.mock('../../components/Toast', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('../../services/pocketbase', () => ({
  getPb: () => ({ baseURL: 'http://notifications.test' }),
}));
const original = globalThis.api;
let state: NonNullable<ReturnType<typeof useNotifications>>;
function Capture() {
  state = useNotifications()!;
  return null;
}
function setup() {
  return render(
    <NotificationProvider>
      <Capture />
    </NotificationProvider>,
  );
}
const notice: NotificationInput = {
  id: 'reply-1',
  source: 'Tickets',
  title: 'Ticket #42',
  message: 'New reply',
  type: 'info',
  target: { source: 'Tickets', ticketId: '123' },
  sound: true,
  options: { delivery: 'ticket' },
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  globalThis.api = {
    runtime: { kind: 'electron' },
    playAlertSound: mocks.sound,
    notifyTicket: mocks.desktop,
  } as never;
});
afterEach(() => {
  cleanup();
  globalThis.api = original;
  vi.useRealTimers();
});
it('deduplicates delivery, keeps a session inbox, and opens the exact ticket from a banner', () => {
  const navigate = vi.fn();
  window.addEventListener(TICKET_NAVIGATION_EVENT, navigate);
  setup();
  act(() => {
    state.publish(notice);
    state.publish(notice);
  });
  expect(state.notices).toHaveLength(1);
  expect(mocks.toast).toHaveBeenCalledOnce();
  expect(mocks.sound).toHaveBeenCalledOnce();
  act(() => {
    void mocks.toast.mock.calls[0]![2].action.onClick();
  });
  expect(state.notices[0]!.read).toBe(true);
  expect(navigate.mock.calls[0]![0].detail).toMatchObject({
    destination: 'ticket',
    ticketId: '123',
  });
  expect(localStorage.getItem('relay:notifications:http://notifications.test')).toBeNull();
  window.removeEventListener(TICKET_NAVIGATION_EVENT, navigate);
});
it('records all sources during snooze without banners, desktop notifications or sounds', () => {
  setup();
  act(() =>
    state.savePreferences({ ...state.preferences, desktop: true, snoozeUntil: Date.now() + 60000 }),
  );
  act(() => {
    state.publish(notice);
    state.publish({ ...notice, id: 'radar-1', source: 'Radar', target: { source: 'Radar' } });
  });
  expect(state.notices).toHaveLength(2);
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(mocks.desktop).not.toHaveBeenCalled();
  expect(mocks.sound).not.toHaveBeenCalled();
});
it('applies shared quiet hours across midnight and resumes delivery after the interval', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 19, 23, 30));
  setup();
  act(() =>
    state.savePreferences({
      ...state.preferences,
      quietHoursEnabled: true,
      quietStart: '22:00',
      quietEnd: '07:00',
    }),
  );
  act(() => state.publish(notice));
  expect(mocks.toast).not.toHaveBeenCalled();
  vi.setSystemTime(new Date(2026, 8, 20, 8, 0));
  act(() => state.publish({ ...notice, id: 'reply-2' }));
  expect(mocks.toast).toHaveBeenCalledOnce();
});
it('keeps quiet-hour times when disabled and continues delivery', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 19, 23, 30));
  setup();
  act(() =>
    state.savePreferences({
      ...state.preferences,
      quietHoursEnabled: false,
      quietStart: '22:00',
      quietEnd: '07:00',
    }),
  );
  act(() => state.publish(notice));
  expect(mocks.toast).toHaveBeenCalledOnce();
  expect(state.preferences.quietStart).toBe('22:00');
});
it('honors quiet hours saved before the explicit toggle existed', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 19, 23, 30));
  const first = setup();
  const legacy = { ...state.preferences, quietHoursEnabled: undefined };
  localStorage.setItem(
    'relay:notifications:http://notifications.test',
    JSON.stringify({ ...legacy, quietStart: '22:00', quietEnd: '07:00' }),
  );
  first.unmount();
  setup();
  act(() => state.publish(notice));
  expect(mocks.toast).not.toHaveBeenCalled();
});
it('scopes mark-read and clear, restores without redelivery, and retains new entries', () => {
  setup();
  act(() => {
    state.publish({ ...notice, at: 1 });
    state.publish({ ...notice, id: 'radar', at: 2, source: 'Radar', target: { source: 'Radar' } });
  });
  act(() => state.markRead(undefined, 'Radar'));
  expect(state.notices.find((n) => n.id === notice.id)?.read).toBe(false);
  act(() => state.clear('Radar', true));
  expect(state.clearedCount).toBe(1);
  act(() => state.publish({ ...notice, id: 'new', at: 3 }));
  mocks.toast.mockClear();
  act(() => state.undoClear());
  expect(state.notices.map((n) => n.id)).toEqual(['new', 'radar', 'reply-1']);
  expect(state.notices[1]?.read).toBe(true);
  expect(state.clearedCount).toBe(0);
  expect(mocks.toast).not.toHaveBeenCalled();
});
it('never restores ticket notices purged by sign-out or an account reset', () => {
  setup();
  act(() => {
    state.publish(notice);
    state.publish({ ...notice, id: 'radar', source: 'Radar', target: { source: 'Radar' } });
  });
  act(() => state.clear(undefined, true));
  act(() => state.clear('Tickets'));
  act(() => state.undoClear());
  expect(state.notices.map((n) => n.source)).toEqual(['Radar']);
});
it('preserves rule channel choices and filters sources without changing other sources', () => {
  setup();
  act(() =>
    state.savePreferences({
      ...state.preferences,
      desktop: true,
      sources: {
        ...state.preferences.sources,
        Radar: { ...state.preferences.sources.Radar, warning: false },
      },
    }),
  );
  act(() => {
    state.publish({ ...notice, toast: false, desktop: false, sound: false });
    state.publish({
      ...notice,
      id: 'radar-2',
      type: 'warning',
      source: 'Radar',
      target: { source: 'Radar' },
    });
  });
  expect(state.notices).toHaveLength(1);
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(mocks.desktop).not.toHaveBeenCalled();
  act(() =>
    state.publish({
      ...notice,
      id: 'problem-1',
      source: 'Problems',
      target: { source: 'Problems' },
    }),
  );
  act(() => state.clear('Tickets'));
  expect(state.notices.map((n) => n.source)).toEqual(['Problems']);
  expect(mocks.desktop).toHaveBeenCalledWith(
    expect.objectContaining({
      body: 'New activity needs attention. Open Relay to review.',
      target: { source: 'Problems' },
    }),
  );
});
it('keeps desktop capabilities unavailable to the browser and bounds inbox history', () => {
  globalThis.api = {
    runtime: { kind: 'web' },
    playAlertSound: mocks.sound,
    notifyTicket: mocks.desktop,
  } as never;
  setup();
  act(() => state.savePreferences({ ...state.preferences, desktop: true, toast: false }));
  act(() => {
    for (let i = 0; i < 205; i++) state.publish({ ...notice, id: `n-${i}` });
  });
  expect(state.notices).toHaveLength(200);
  expect(mocks.desktop).not.toHaveBeenCalled();
  expect(mocks.sound).not.toHaveBeenCalled();
});
it('validates native notification navigation and unregisters its listener', () => {
  let callback: (value: unknown) => void = () => {};
  const off = vi.fn();
  globalThis.api!.onNotificationClick = ((cb: typeof callback) => {
    callback = cb;
    return off;
  }) as never;
  const navigate = vi.fn();
  window.addEventListener(TICKET_NAVIGATION_EVENT, navigate);
  const view = setup();
  act(() => state.publish(notice));
  act(() => callback({ source: 'Tickets', ticketId: 'javascript:bad' }));
  expect(navigate).not.toHaveBeenCalled();
  act(() => callback({ source: 'Tickets', ticketId: '123' }));
  expect(navigate).toHaveBeenCalledOnce();
  expect(state.notices[0]!.read).toBe(true);
  view.unmount();
  expect(off).toHaveBeenCalledOnce();
  window.removeEventListener(TICKET_NAVIGATION_EVENT, navigate);
});
