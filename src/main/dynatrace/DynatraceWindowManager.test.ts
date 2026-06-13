import { BrowserWindow, session } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DynatraceWindowManager } from './DynatraceWindowManager';
import { DynatraceDashboardStore } from './DynatraceDashboardStore';
import type { DynatraceDashboard } from '../../shared/dynatrace';

const { mockDynatraceSession, mockWebContentsHandlers, mockWindow, mockWindowHandlers } =
  vi.hoisted(() => {
    const mockWebContentsHandlers = new Map<string, (...args: never[]) => void>();
    const mockWindowHandlers = new Map<string, (...args: never[]) => void>();
    const mockDynatraceSession = {
      clearStorageData: vi.fn(async () => undefined),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
    };
    const mockWindow = {
      close: vi.fn(),
      loadURL: vi.fn(async () => undefined),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      getBounds: vi.fn(() => ({ x: 10, y: 20, width: 1200, height: 800 })),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        mockWindowHandlers.set(event, handler as (...args: never[]) => void);
        return mockWindow;
      }),
      webContents: {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          mockWebContentsHandlers.set(event, handler as (...args: never[]) => void);
          return mockWindow.webContents;
        }),
        setWindowOpenHandler: vi.fn(),
        session: {},
      },
    };

    return { mockDynatraceSession, mockWebContentsHandlers, mockWindow, mockWindowHandlers };
  });

vi.mock('electron', () => {
  return {
    BrowserWindow: vi.fn(function () {
      return mockWindow;
    }),
    session: { fromPartition: vi.fn(() => mockDynatraceSession) },
    shell: { openExternal: vi.fn(async () => undefined) },
  };
});

describe('DynatraceWindowManager', () => {
  let store: Pick<DynatraceDashboardStore, 'list' | 'add' | 'update' | 'remove' | 'setBounds'>;
  let manager: DynatraceWindowManager;
  let dashboards: DynatraceDashboard[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockWebContentsHandlers.clear();
    mockWindowHandlers.clear();
    dashboards = [{ id: 'dt_1', name: 'NOC', url: 'https://abc.live.dynatrace.com/dashboard' }];
    store = {
      list: vi.fn(() => dashboards),
      add: vi.fn((input) => {
        const dashboard = { id: 'dt_2', ...input };
        dashboards = [...dashboards, dashboard];
        return dashboard;
      }),
      update: vi.fn((id, input) => {
        const index = dashboards.findIndex((dashboard) => dashboard.id === id);
        if (index === -1) return null;
        const dashboard = { ...dashboards[index], ...input };
        dashboards = dashboards.with(index, dashboard);
        return dashboard;
      }),
      remove: vi.fn((id) => {
        const initialLength = dashboards.length;
        dashboards = dashboards.filter((dashboard) => dashboard.id !== id);
        return dashboards.length < initialLength;
      }),
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
    expect(vi.mocked(BrowserWindow).mock.calls[0]?.[0].webPreferences).not.toHaveProperty(
      'preload',
    );
  });

  it('denies permission requests and checks on the Dynatrace session', async () => {
    await manager.openDashboard('dt_1');

    expect(mockDynatraceSession.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(mockDynatraceSession.setPermissionCheckHandler).toHaveBeenCalledTimes(1);

    const requestHandler = mockDynatraceSession.setPermissionRequestHandler.mock.calls[0]?.[0];
    const checkHandler = mockDynatraceSession.setPermissionCheckHandler.mock.calls[0]?.[0];
    const requestCallback = vi.fn();

    requestHandler?.(mockWindow.webContents, 'geolocation', requestCallback, {
      requestingUrl: 'https://abc.live.dynatrace.com/dashboard',
    });
    expect(requestCallback).toHaveBeenCalledWith(false);
    expect(checkHandler?.(mockWindow.webContents, 'media', 'https://abc.live.dynatrace.com')).toBe(
      false,
    );
    expect(
      checkHandler?.(mockWindow.webContents, 'clipboard-read', 'https://abc.live.dynatrace.com'),
    ).toBe(false);
  });

  it('focuses an existing window for the same dashboard', async () => {
    await manager.openDashboard('dt_1');
    await manager.openDashboard('dt_1');
    expect(BrowserWindow).toHaveBeenCalledTimes(1);
    expect(mockWindow.focus).toHaveBeenCalledTimes(1);
  });

  it('clears the Dynatrace session without removing dashboards', async () => {
    await expect(manager.clearSession()).resolves.toBe(true);
    expect(session.fromPartition).toHaveBeenCalledWith('persist:relay-dynatrace');
    expect(mockDynatraceSession.clearStorageData).toHaveBeenCalledTimes(1);
    expect(store.remove).not.toHaveBeenCalled();
    expect(manager.listDashboards()).toEqual([
      expect.objectContaining({
        id: 'dt_1',
        name: 'NOC',
        url: 'https://abc.live.dynatrace.com/dashboard',
      }),
    ]);
  });

  it('blocks disallowed navigations and broadcasts blocked state', async () => {
    const listener = vi.fn();
    manager.onStateChange(listener);
    await manager.openDashboard('dt_1');
    listener.mockClear();

    const preventDefault = vi.fn();
    mockWebContentsHandlers.get('will-navigate')?.(
      { preventDefault },
      'https://evil.example/dashboard',
    );

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(manager.listDashboards()).toEqual([
      expect.objectContaining({
        id: 'dt_1',
        state: 'blocked',
        lastUrl: 'https://evil.example/dashboard',
      }),
    ]);
    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'dt_1',
        state: 'blocked',
        lastUrl: 'https://evil.example/dashboard',
      }),
    ]);
  });

  it('blocks disallowed redirects and broadcasts blocked state', async () => {
    const listener = vi.fn();
    manager.onStateChange(listener);
    await manager.openDashboard('dt_1');
    listener.mockClear();

    const preventDefault = vi.fn();
    mockWebContentsHandlers.get('will-redirect')?.(
      { preventDefault },
      'https://evil.example/redirected',
    );

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'blocked',
        lastUrl: 'https://evil.example/redirected',
      }),
    );
    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'dt_1',
        state: 'blocked',
        lastUrl: 'https://evil.example/redirected',
      }),
    ]);
  });

  it('sets load-failed state for main-frame failures', async () => {
    const listener = vi.fn();
    manager.onStateChange(listener);
    await manager.openDashboard('dt_1');
    listener.mockClear();

    mockWebContentsHandlers.get('did-fail-load')?.(
      {},
      -105,
      'NAME_NOT_RESOLVED',
      'https://abc.live.dynatrace.com/dashboard',
      true,
    );

    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'load-failed',
        lastUrl: 'https://abc.live.dynatrace.com/dashboard',
        error: 'NAME_NOT_RESOLVED',
      }),
    );
    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'dt_1',
        state: 'load-failed',
        error: 'NAME_NOT_RESOLVED',
      }),
    ]);
  });

  it('returns false and sets load-failed when initial dashboard load fails', async () => {
    vi.mocked(mockWindow.loadURL).mockRejectedValueOnce(new Error('navigation failed'));

    await expect(manager.openDashboard('dt_1')).resolves.toBe(false);

    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'load-failed',
        lastUrl: 'https://abc.live.dynatrace.com/dashboard',
        error: 'navigation failed',
      }),
    );
  });

  it('persists bounds on close and cleans up on closed', async () => {
    const listener = vi.fn();
    manager.onStateChange(listener);
    await manager.openDashboard('dt_1');
    listener.mockClear();

    mockWindowHandlers.get('close')?.();
    expect(store.setBounds).toHaveBeenCalledWith('dt_1', {
      x: 10,
      y: 20,
      width: 1200,
      height: 800,
    });

    mockWindowHandlers.get('closed')?.();
    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({ id: 'dt_1', state: 'closed' }),
    );
    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'dt_1', state: 'closed' }),
    ]);
  });

  it('cleans up closed windows even when bounds persistence fails', async () => {
    vi.mocked(store.setBounds).mockImplementation(() => {
      throw new Error('disk full');
    });

    await manager.openDashboard('dt_1');
    mockWindowHandlers.get('close')?.();
    mockWindowHandlers.get('closed')?.();
    await manager.openDashboard('dt_1');

    expect(BrowserWindow).toHaveBeenCalledTimes(2);
  });

  it('broadcasts dashboard add, update, and remove changes', () => {
    const listener = vi.fn();
    manager.onStateChange(listener);

    manager.addDashboard({ name: 'New', url: 'https://abc.live.dynatrace.com/new' });
    expect(listener).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'dt_1' }),
      expect.objectContaining({ id: 'dt_2', name: 'New' }),
    ]);

    manager.updateDashboard('dt_1', {
      name: 'Updated',
      url: 'https://abc.live.dynatrace.com/updated',
    });
    expect(listener).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: 'dt_1',
        name: 'Updated',
        url: 'https://abc.live.dynatrace.com/updated',
      }),
      expect.objectContaining({ id: 'dt_2' }),
    ]);

    manager.removeDashboard('dt_1');
    expect(listener).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'dt_2' })]);
  });
});
