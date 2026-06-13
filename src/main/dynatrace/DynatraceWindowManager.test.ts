import { BrowserWindow, session } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DynatraceWindowManager } from './DynatraceWindowManager';
import { DynatraceDashboardStore } from './DynatraceDashboardStore';

vi.mock('electron', () => {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const mockWindow = {
    loadURL: vi.fn(async () => undefined),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    getBounds: vi.fn(() => ({ x: 10, y: 20, width: 1200, height: 800 })),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
      return mockWindow;
    }),
    webContents: {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      session: {},
    },
  };

  return {
    BrowserWindow: vi.fn(function () {
      return mockWindow;
    }),
    session: { fromPartition: vi.fn(() => ({ clearStorageData: vi.fn(async () => undefined) })) },
    shell: { openExternal: vi.fn(async () => undefined) },
  };
});

describe('DynatraceWindowManager', () => {
  let store: Pick<DynatraceDashboardStore, 'list' | 'add' | 'update' | 'remove' | 'setBounds'>;
  let manager: DynatraceWindowManager;

  beforeEach(() => {
    vi.clearAllMocks();
    store = {
      list: vi.fn(() => [
        { id: 'dt_1', name: 'NOC', url: 'https://abc.live.dynatrace.com/dashboard' },
      ]),
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      setBounds: vi.fn(),
    };
    manager = new DynatraceWindowManager({ store: store as DynatraceDashboardStore });
  });

  it('creates an isolated, refresh-friendly BrowserWindow', async () => {
    await manager.openDashboard('dt_1');

    expect(session.fromPartition).toHaveBeenCalledWith('persist:relay-dynatrace');
    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Relay - Dynatrace - NOC',
        webPreferences: expect.objectContaining({
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          backgroundThrottling: false,
          session: expect.anything(),
        }),
      }),
    );
  });

  it('focuses an existing window for the same dashboard', async () => {
    await manager.openDashboard('dt_1');
    await manager.openDashboard('dt_1');
    expect(BrowserWindow).toHaveBeenCalledTimes(1);
  });

  it('clears the Dynatrace session without removing dashboards', async () => {
    await manager.clearSession();
    expect(session.fromPartition).toHaveBeenCalledWith('persist:relay-dynatrace');
  });
});
