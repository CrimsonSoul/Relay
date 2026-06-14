import { BrowserWindow, WebContentsView, session } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DynatraceWindowManager } from './DynatraceWindowManager';
import { DynatraceDashboardStore } from './DynatraceDashboardStore';
import type { DynatraceDashboard } from '../../shared/dynatrace';

const {
  mockDynatraceSession,
  mockDynatraceView,
  mockDynatraceWebContentsHandlers,
  mockHostWindow,
  mockHostWindowHandlers,
  mockWindowOpenHandlers,
} = vi.hoisted(() => {
  const mockDynatraceWebContentsHandlers = new Map<string, (...args: never[]) => void>();
  const mockHostWindowHandlers = new Map<string, (...args: never[]) => void>();
  const mockWindowOpenHandlers: Array<(details: { url: string }) => { action: 'deny' }> = [];
  const mockDynatraceSession = {
    clearStorageData: vi.fn(async () => undefined),
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
  };

  const mockDynatraceView = {
    setBounds: vi.fn(),
    webContents: {
      loadURL: vi.fn(async () => undefined),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        mockDynatraceWebContentsHandlers.set(event, handler as (...args: never[]) => void);
        return mockDynatraceView.webContents;
      }),
      setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => { action: 'deny' }) => {
        mockWindowOpenHandlers.push(handler);
      }),
      session: {},
    },
  };

  const mockHostWindow = {
    close: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    getBounds: vi.fn(() => ({ x: 10, y: 20, width: 1200, height: 800 })),
    getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 1440, height: 900 })),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      mockHostWindowHandlers.set(event, handler as (...args: never[]) => void);
      return mockHostWindow;
    }),
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
    webContents: {
      on: vi.fn((_event: string, _handler: (...args: unknown[]) => void) => {
        return mockHostWindow.webContents;
      }),
      setWindowOpenHandler: vi.fn(),
      session: {},
    },
  };

  return {
    mockDynatraceSession,
    mockDynatraceView,
    mockDynatraceWebContentsHandlers,
    mockHostWindow,
    mockHostWindowHandlers,
    mockWindowOpenHandlers,
  };
});

vi.mock('electron', () => {
  return {
    app: { isPackaged: false },
    BrowserWindow: vi.fn(function () {
      return mockHostWindow;
    }),
    WebContentsView: vi.fn(function () {
      return mockDynatraceView;
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
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/');
    mockDynatraceWebContentsHandlers.clear();
    mockHostWindowHandlers.clear();
    mockWindowOpenHandlers.length = 0;
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

  it('creates a Relay-framed host window with an isolated Dynatrace view', async () => {
    await manager.openDashboard('dt_1');

    expect(session.fromPartition).toHaveBeenCalledWith('persist:relay-dynatrace');
    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Relay - Dynatrace - NOC',
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 24, y: 16 },
        webPreferences: expect.objectContaining({
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        }),
      }),
    );
    expect(WebContentsView).toHaveBeenCalledWith(
      expect.objectContaining({
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
    expect(mockHostWindow.contentView.addChildView).toHaveBeenCalledWith(mockDynatraceView);
    expect(mockHostWindow.loadURL).toHaveBeenCalledWith(
      expect.stringContaining('popout=dynatrace'),
    );
    expect(mockHostWindow.loadURL).toHaveBeenCalledWith(expect.stringContaining('name=NOC'));
    expect(mockDynatraceView.webContents.loadURL).toHaveBeenCalledWith(
      'https://abc.live.dynatrace.com/dashboard',
    );
    expect(mockHostWindow.loadURL).not.toHaveBeenCalledWith(
      'https://abc.live.dynatrace.com/dashboard',
    );
  });

  it('denies permission requests and checks on the Dynatrace session', async () => {
    await manager.openDashboard('dt_1');

    expect(mockDynatraceSession.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(mockDynatraceSession.setPermissionCheckHandler).toHaveBeenCalledTimes(1);

    const requestHandler = mockDynatraceSession.setPermissionRequestHandler.mock.calls[0]?.[0];
    const checkHandler = mockDynatraceSession.setPermissionCheckHandler.mock.calls[0]?.[0];
    const requestCallback = vi.fn();

    requestHandler?.(mockDynatraceView.webContents, 'geolocation', requestCallback, {
      requestingUrl: 'https://abc.live.dynatrace.com/dashboard',
    });
    expect(requestCallback).toHaveBeenCalledWith(false);
    expect(
      checkHandler?.(mockDynatraceView.webContents, 'media', 'https://abc.live.dynatrace.com'),
    ).toBe(false);
    expect(
      checkHandler?.(
        mockDynatraceView.webContents,
        'clipboard-read',
        'https://abc.live.dynatrace.com',
      ),
    ).toBe(false);
  });

  it('focuses an existing window for the same dashboard', async () => {
    await manager.openDashboard('dt_1');
    await manager.openDashboard('dt_1');
    expect(BrowserWindow).toHaveBeenCalledTimes(1);
    expect(WebContentsView).toHaveBeenCalledTimes(1);
    expect(mockHostWindow.focus).toHaveBeenCalledTimes(1);
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
    mockDynatraceWebContentsHandlers.get('will-navigate')?.(
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
    mockDynatraceWebContentsHandlers.get('will-redirect')?.(
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

    mockDynatraceWebContentsHandlers.get('did-fail-load')?.(
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
    vi.mocked(mockDynatraceView.webContents.loadURL).mockRejectedValueOnce(
      new Error('navigation failed'),
    );

    await expect(manager.openDashboard('dt_1')).resolves.toBe(false);

    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'load-failed',
        lastUrl: 'https://abc.live.dynatrace.com/dashboard',
        error: 'navigation failed',
      }),
    );
  });

  it('keeps the dashboard window open when the initial load is aborted by a redirect', async () => {
    vi.mocked(mockDynatraceView.webContents.loadURL).mockRejectedValueOnce(
      new Error('ERR_ABORTED (-3) loading https://abc.live.dynatrace.com/dashboard'),
    );

    await expect(manager.openDashboard('dt_1')).resolves.toBe(true);

    expect(mockHostWindow.close).not.toHaveBeenCalled();
    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'authenticating',
        lastUrl: 'https://abc.live.dynatrace.com/dashboard',
      }),
    );
  });

  it('retries with a fresh window after an initial dashboard load fails', async () => {
    vi.mocked(mockDynatraceView.webContents.loadURL).mockRejectedValueOnce(
      new Error('navigation failed'),
    );

    await expect(manager.openDashboard('dt_1')).resolves.toBe(false);
    await expect(manager.openDashboard('dt_1')).resolves.toBe(true);

    expect(mockHostWindow.close).toHaveBeenCalledTimes(1);
    expect(mockHostWindow.focus).not.toHaveBeenCalled();
    expect(BrowserWindow).toHaveBeenCalledTimes(2);
    expect(mockDynatraceView.webContents.loadURL).toHaveBeenCalledTimes(2);
  });

  it('sets load-failed when an allowed popup URL load fails', async () => {
    await manager.openDashboard('dt_1');
    vi.mocked(mockDynatraceView.webContents.loadURL).mockRejectedValueOnce(
      new Error('popup failed'),
    );

    const result = mockWindowOpenHandlers.at(-1)?.({
      url: 'https://login.microsoftonline.com/oauth2/v2.0/authorize',
    });
    await Promise.resolve();

    expect(result).toEqual({ action: 'deny' });
    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'load-failed',
        lastUrl: 'https://login.microsoftonline.com/oauth2/v2.0/authorize',
        error: 'popup failed',
      }),
    );
  });

  it('persists bounds on close and cleans up on closed', async () => {
    const listener = vi.fn();
    manager.onStateChange(listener);
    await manager.openDashboard('dt_1');
    listener.mockClear();

    mockHostWindowHandlers.get('close')?.();
    expect(store.setBounds).toHaveBeenCalledWith('dt_1', {
      x: 10,
      y: 20,
      width: 1200,
      height: 800,
    });

    mockHostWindowHandlers.get('closed')?.();
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
    mockHostWindowHandlers.get('close')?.();
    mockHostWindowHandlers.get('closed')?.();
    await manager.openDashboard('dt_1');

    expect(BrowserWindow).toHaveBeenCalledTimes(2);
  });

  it('keeps the Dynatrace view below the Relay chrome when the host resizes', async () => {
    await manager.openDashboard('dt_1');

    expect(mockDynatraceView.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 56,
      width: 1440,
      height: 844,
    });

    vi.mocked(mockHostWindow.getContentBounds).mockReturnValueOnce({
      x: 0,
      y: 0,
      width: 1200,
      height: 720,
    });
    mockHostWindowHandlers.get('resize')?.();

    expect(mockDynatraceView.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 56,
      width: 1200,
      height: 664,
    });
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
