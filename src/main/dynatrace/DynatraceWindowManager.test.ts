import { BrowserWindow, WebContentsView, session } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DynatraceWindowManager } from './DynatraceWindowManager';
import { DynatraceDashboardStore } from './DynatraceDashboardStore';
import type { DynatraceDashboard } from '../../shared/dynatrace';

const {
  mockApp,
  mockDynatraceSession,
  mockDynatraceView,
  mockDynatraceWebContentsHandlers,
  mockHostWebContentsHandlers,
  mockHostWindowOpenHandlers,
  mockHostWindow,
  mockHostWindowHandlers,
  mockWindowOpenHandlers,
} = vi.hoisted(() => {
  const mockApp = { isPackaged: false };
  const mockDynatraceWebContentsHandlers = new Map<string, (...args: never[]) => void>();
  const mockHostWebContentsHandlers = new Map<string, (...args: never[]) => void>();
  const mockHostWindowHandlers = new Map<string, (...args: never[]) => void>();
  const mockHostWindowOpenHandlers: Array<(details: { url: string }) => { action: 'deny' }> = [];
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
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        mockHostWebContentsHandlers.set(event, handler as (...args: never[]) => void);
        return mockHostWindow.webContents;
      }),
      setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => { action: 'deny' }) => {
        mockHostWindowOpenHandlers.push(handler);
      }),
      session: {},
    },
  };

  return {
    mockApp,
    mockDynatraceSession,
    mockDynatraceView,
    mockDynatraceWebContentsHandlers,
    mockHostWebContentsHandlers,
    mockHostWindowOpenHandlers,
    mockHostWindow,
    mockHostWindowHandlers,
    mockWindowOpenHandlers,
  };
});

vi.mock('electron', () => {
  return {
    app: mockApp,
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
    mockApp.isPackaged = false;
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/');
    mockDynatraceWebContentsHandlers.clear();
    mockHostWebContentsHandlers.clear();
    mockHostWindowOpenHandlers.length = 0;
    mockHostWindowHandlers.clear();
    mockWindowOpenHandlers.length = 0;
    mockHostWindow.isDestroyed.mockReturnValue(false);
    mockHostWindow.getContentBounds.mockReturnValue({ x: 0, y: 0, width: 1440, height: 900 });
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
        title: 'Relay - NOC',
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

  it('loads the packaged Relay shell when the app is packaged', async () => {
    mockApp.isPackaged = true;

    await manager.openDashboard('dt_1');

    const shellUrl = vi.mocked(mockHostWindow.loadURL).mock.calls[0]?.[0] as string;
    expect(shellUrl).toMatch(/^file:/);
    expect(shellUrl).toContain('index.html');
    expect(shellUrl).toContain('popout=dynatrace');
    expect(shellUrl).toContain('name=NOC');

    const allowedPreventDefault = vi.fn();
    mockHostWebContentsHandlers.get('will-navigate')?.(
      { preventDefault: allowedPreventDefault },
      shellUrl,
    );
    expect(allowedPreventDefault).not.toHaveBeenCalled();
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

  it('recreates a dashboard window if the stored entry was already destroyed', async () => {
    await manager.openDashboard('dt_1');
    vi.mocked(mockHostWindow.isDestroyed).mockReturnValueOnce(true);

    await manager.openDashboard('dt_1');

    expect(mockHostWindow.focus).not.toHaveBeenCalled();
    expect(BrowserWindow).toHaveBeenCalledTimes(2);
    expect(WebContentsView).toHaveBeenCalledTimes(2);
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

  it('allows Dynatrace navigations and updates live/auth runtime state', async () => {
    const listener = vi.fn();
    manager.onStateChange(listener);
    await manager.openDashboard('dt_1');
    listener.mockClear();

    const preventDefault = vi.fn();
    mockDynatraceWebContentsHandlers.get('will-navigate')?.(
      { preventDefault },
      'https://abc.live.dynatrace.com/ui/dashboard',
    );
    mockDynatraceWebContentsHandlers.get('did-navigate')?.(
      {},
      'https://abc.live.dynatrace.com/ui/dashboard',
    );

    expect(preventDefault).not.toHaveBeenCalled();
    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'live',
        lastUrl: 'https://abc.live.dynatrace.com/ui/dashboard',
      }),
    );

    mockDynatraceWebContentsHandlers.get('did-navigate-in-page')?.(
      {},
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );

    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'authenticating',
        lastUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      }),
    );
    expect(listener).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: 'dt_1',
        state: 'authenticating',
      }),
    ]);
  });

  it('marks blocked state when a disallowed URL finishes navigating', async () => {
    const listener = vi.fn();
    manager.onStateChange(listener);
    await manager.openDashboard('dt_1');
    listener.mockClear();

    mockDynatraceWebContentsHandlers.get('did-navigate')?.({}, 'https://evil.example/finished');

    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'blocked',
        lastUrl: 'https://evil.example/finished',
      }),
    );
    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'dt_1',
        state: 'blocked',
        lastUrl: 'https://evil.example/finished',
      }),
    ]);
  });

  it('ignores subframe load failures from Dynatrace content', async () => {
    await manager.openDashboard('dt_1');

    mockDynatraceWebContentsHandlers.get('did-fail-load')?.(
      {},
      -3,
      'ERR_ABORTED',
      'https://abc.live.dynatrace.com/frame',
      false,
    );

    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'authenticating',
        lastUrl: 'https://abc.live.dynatrace.com/dashboard',
      }),
    );
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

  it('keeps state steady when an allowed popup navigation is superseded', async () => {
    await manager.openDashboard('dt_1');
    vi.mocked(mockDynatraceView.webContents.loadURL).mockRejectedValueOnce(
      new Error(
        "ERR_ABORTED (-3) loading 'https://login.microsoftonline.com/oauth2/v2.0/authorize'",
      ),
    );

    const result = mockWindowOpenHandlers.at(-1)?.({
      url: 'https://login.microsoftonline.com/oauth2/v2.0/authorize',
    });
    await Promise.resolve();

    expect(result).toEqual({ action: 'deny' });
    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'authenticating',
        lastUrl: 'https://abc.live.dynatrace.com/dashboard',
      }),
    );
  });

  it('blocks disallowed popup URLs from Dynatrace content', async () => {
    await manager.openDashboard('dt_1');

    const result = mockWindowOpenHandlers.at(-1)?.({
      url: 'https://evil.example/phish',
    });

    expect(result).toEqual({ action: 'deny' });
    expect(mockDynatraceView.webContents.loadURL).toHaveBeenCalledTimes(1);
    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'blocked',
        lastUrl: 'https://evil.example/phish',
      }),
    );
  });

  it('blocks host shell navigations outside the Relay renderer', async () => {
    await manager.openDashboard('dt_1');

    const allowedPreventDefault = vi.fn();
    mockHostWebContentsHandlers.get('will-navigate')?.(
      { preventDefault: allowedPreventDefault },
      'http://localhost:5173/?popout=dynatrace&name=NOC',
    );
    expect(allowedPreventDefault).not.toHaveBeenCalled();

    const invalidPreventDefault = vi.fn();
    mockHostWebContentsHandlers.get('will-navigate')?.(
      { preventDefault: invalidPreventDefault },
      'not a url',
    );
    expect(invalidPreventDefault).toHaveBeenCalledTimes(1);

    const blockedPreventDefault = vi.fn();
    mockHostWebContentsHandlers.get('will-navigate')?.(
      { preventDefault: blockedPreventDefault },
      'https://evil.example/shell',
    );
    expect(blockedPreventDefault).toHaveBeenCalledTimes(1);
  });

  it('denies host shell popup attempts', async () => {
    await manager.openDashboard('dt_1');

    const result = mockHostWindowOpenHandlers.at(-1)?.({
      url: 'https://evil.example/popup',
    });

    expect(result).toEqual({ action: 'deny' });
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

    vi.mocked(mockHostWindow.getContentBounds).mockReturnValueOnce({
      x: 0,
      y: 0,
      width: 800,
      height: 40,
    });
    mockHostWindowHandlers.get('maximize')?.();

    expect(mockDynatraceView.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 56,
      width: 800,
      height: 0,
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

  it('does not notify a listener after it unsubscribes from state changes', () => {
    const listener = vi.fn();
    const unsubscribe = manager.onStateChange(listener);

    unsubscribe();
    manager.addDashboard({ name: 'New', url: 'https://abc.live.dynatrace.com/new' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('closes an open dashboard window when the dashboard is removed', async () => {
    await manager.openDashboard('dt_1');
    mockHostWindow.close.mockClear();

    expect(manager.removeDashboard('dt_1')).toBe(true);

    expect(mockHostWindow.close).toHaveBeenCalledTimes(1);
  });
});
