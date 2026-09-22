import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTicketNotificationHandler } from './ticketNotificationHandler';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  trusted: vi.fn(() => true),
  supported: vi.fn(() => true),
  show: vi.fn(),
  on: vi.fn(),
}));
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  Notification: class {
    static readonly isSupported = mocks.supported;
    show = mocks.show;
    on = mocks.on;
  },
}));
vi.mock('../../utils/trustedSender', () => ({ assertTrustedIpcSender: mocks.trusted }));

describe('ticket desktop notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.trusted.mockReturnValue(true);
    mocks.supported.mockReturnValue(true);
  });
  it('requires a trusted sender, bounded payload, and native support', () => {
    registerTicketNotificationHandler(() => null);
    const handler = mocks.handle.mock.calls[0]![1];
    expect(handler({}, { title: 'Ticket', body: 'x'.repeat(301) })).toBe(false);
    mocks.trusted.mockReturnValue(false);
    expect(handler({}, { title: 'Ticket', body: 'Synthetic' })).toBe(false);
    mocks.trusted.mockReturnValue(true);
    mocks.supported.mockReturnValue(false);
    expect(handler({}, { title: 'Ticket', body: 'Synthetic' })).toBe(false);
    expect(
      handler(
        {},
        {
          title: 'Ticket',
          body: 'x',
          target: { source: 'Tickets', ticketId: 'https://evil.test' },
        },
      ),
    ).toBe(false);
    expect(mocks.show).not.toHaveBeenCalled();
  });
  it('rate limits notifications and brings the existing window forward on click', () => {
    const window = {
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() },
    };
    registerTicketNotificationHandler(() => window as never);
    const handler = mocks.handle.mock.calls[0]![1];
    expect(
      handler(
        {},
        {
          title: 'Relay',
          body: 'Synthetic ticket changed.',
          target: { source: 'Tickets', ticketId: '123' },
        },
      ),
    ).toBe(true);
    expect(handler({}, { title: 'Relay', body: 'Synthetic ticket changed.' })).toBe(false);
    mocks.on.mock.calls[0]![1]();
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(window.webContents.send).toHaveBeenCalledWith('ticket:notify', {
      source: 'Tickets',
      ticketId: '123',
    });
  });
});
