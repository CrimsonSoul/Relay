import { BrowserWindow, WebContentsView, session } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DynatraceWindowManager } from './DynatraceWindowManager';
import { DynatraceDashboardStore } from './DynatraceDashboardStore';
import { INFRA_HEALTH_DASHBOARD, type DynatraceDashboard } from '../../shared/dynatrace';

const {
  mockApp,
  mockHistory,
  mockMenu,
  mockMenuPopup,
  mockDynatraceSession,
  mockDynatraceView,
  mockDynatraceWebContentsHandlers,
  mockHostWebContentsHandlers,
  mockHostWindowOpenHandlers,
  mockHostWindow,
  mockHostWindowHandlers,
  mockMainInfo,
  mockSecurityWarn,
  mockWindowOpenHandlers,
} = vi.hoisted(() => {
  const mockApp = { isPackaged: false };
  const mockDynatraceWebContentsHandlers = new Map<string, (...args: unknown[]) => void>();
  const mockHostWebContentsHandlers = new Map<string, (...args: unknown[]) => void>();
  const mockHostWindowHandlers = new Map<string, (...args: unknown[]) => void>();
  const mockHostWindowOpenHandlers: Array<(details: { url: string }) => { action: 'deny' }> = [];
  const mockWindowOpenHandlers: Array<(details: { url: string }) => { action: 'deny' }> = [];
  const mockMainInfo = vi.fn();
  const mockSecurityWarn = vi.fn();
  const mockDynatraceSession = {
    clearStorageData: vi.fn(async () => undefined),
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
  };

  const mockHistory = {
    canGoBack: vi.fn(() => false),
    canGoForward: vi.fn(() => false),
    goBack: vi.fn(),
    goForward: vi.fn(),
  };
  const mockDynatraceView = {
    setBounds: vi.fn(),
    webContents: {
      navigationHistory: mockHistory,
      reload: vi.fn(),
      close: vi.fn(),
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn(async () => undefined),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        mockDynatraceWebContentsHandlers.set(event, handler);
        return mockDynatraceView.webContents;
      }),
      setVisualZoomLevelLimits: vi.fn(async () => undefined),
      setZoomFactor: vi.fn(),
      setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => { action: 'deny' }) => {
        mockWindowOpenHandlers.push(handler);
      }),
      session: {},
    },
  };

  const mockHostWindow = {
    close: vi.fn(),
    loadURL: vi.fn(async (_url: string) => undefined),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    setFullScreen: vi.fn(),
    getBounds: vi.fn(() => ({ x: 10, y: 20, width: 1200, height: 800 })),
    getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 1440, height: 900 })),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      mockHostWindowHandlers.set(event, handler);
      return mockHostWindow;
    }),
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
    webContents: {
      send: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        mockHostWebContentsHandlers.set(event, handler);
        return mockHostWindow.webContents;
      }),
      setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => { action: 'deny' }) => {
        mockHostWindowOpenHandlers.push(handler);
      }),
      session: {},
    },
  };

  const mockMenuPopup = vi.fn();
  const mockMenu = {
    buildFromTemplate: vi.fn((_items: Electron.MenuItemConstructorOptions[]) => ({
      popup: mockMenuPopup,
    })),
  };

  return {
    mockApp,
    mockHistory,
    mockMenu,
    mockMenuPopup,
    mockDynatraceSession,
    mockDynatraceView,
    mockDynatraceWebContentsHandlers,
    mockHostWebContentsHandlers,
    mockHostWindowOpenHandlers,
    mockHostWindow,
    mockHostWindowHandlers,
    mockMainInfo,
    mockSecurityWarn,
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
    Menu: mockMenu,
    clipboard: { writeText: vi.fn() },
    shell: { openExternal: vi.fn(async () => undefined) },
  };
});

vi.mock('../logger', () => ({
  loggers: {
    main: {
      info: mockMainInfo,
      warn: vi.fn(),
    },
    security: {
      warn: mockSecurityWarn,
    },
  },
}));

describe('DynatraceWindowManager', () => {
  let store: Pick<
    DynatraceDashboardStore,
    'list' | 'add' | 'update' | 'remove' | 'setBounds' | 'getBuiltInBounds' | 'setBuiltInBounds'
  >;
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
    mockHostWindow.isFullScreen.mockReturnValue(false);
    mockHistory.canGoBack.mockReturnValue(false);
    mockHistory.canGoForward.mockReturnValue(false);
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
      getBuiltInBounds: vi.fn(() => null),
      setBuiltInBounds: vi.fn(),
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

  it('opens the built-in Infra Health app without a stored dashboard', async () => {
    await expect(manager.openDashboard(INFRA_HEALTH_DASHBOARD.id)).resolves.toBe(true);

    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Relay - Infra Health' }),
    );
    expect(mockDynatraceView.webContents.loadURL).toHaveBeenCalledWith(
      'https://wuc80896.apps.dynatrace.com/ui/apps/my.cwgs.infrahealth/',
    );
    expect(manager.listDashboards().map((dashboard) => dashboard.id)).toEqual(['dt_1']);
  });

  it('keeps the persistent Dynatrace page scale at 100% after navigation settles', async () => {
    await manager.openDashboard('dt_1');

    expect(mockDynatraceView.webContents.setZoomFactor).toHaveBeenCalledWith(1);
    expect(mockDynatraceView.webContents.setVisualZoomLevelLimits).toHaveBeenCalledWith(1, 1);

    mockDynatraceView.webContents.setZoomFactor.mockClear();
    mockDynatraceWebContentsHandlers.get('did-stop-loading')?.();

    expect(mockDynatraceView.webContents.setZoomFactor).toHaveBeenCalledWith(1);
  });

  it('loads the packaged Relay shell when the app is packaged', async () => {
    mockApp.isPackaged = true;

    await manager.openDashboard('dt_1');

    const shellUrlCall = vi.mocked(mockHostWindow.loadURL).mock.calls[0];
    if (!shellUrlCall) throw new Error('Expected the host window to load the Relay shell.');
    const [shellUrl] = shellUrlCall;
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

  it('grants Dynatrace pages full screen and clipboard writes, and nothing to other origins', async () => {
    await manager.openDashboard('dt_1');

    const requestHandler = mockDynatraceSession.setPermissionRequestHandler.mock.calls[0]?.[0];
    const checkHandler = mockDynatraceSession.setPermissionCheckHandler.mock.calls[0]?.[0];
    const request = (permission: string, requestingUrl: string) => {
      const callback = vi.fn();
      requestHandler?.(mockDynatraceView.webContents, permission, callback, { requestingUrl });
      return callback.mock.calls[0]?.[0];
    };
    const check = (permission: string, origin: string) =>
      checkHandler?.(mockDynatraceView.webContents, permission, origin);

    const dynatrace = 'https://abc.live.dynatrace.com/dashboard';
    expect(request('fullscreen', dynatrace)).toBe(true);
    expect(request('clipboard-sanitized-write', dynatrace)).toBe(true);
    expect(check('fullscreen', 'https://abc.live.dynatrace.com')).toBe(true);
    expect(check('clipboard-sanitized-write', 'https://abc.live.dynatrace.com')).toBe(true);

    expect(request('clipboard-read', dynatrace)).toBe(false);
    expect(request('fullscreen', 'https://login.microsoftonline.com/common')).toBe(false);
    expect(request('fullscreen', dynatrace.replace('https', 'http'))).toBe(false);
    expect(check('clipboard-sanitized-write', 'https://dynatrace.com.example.net')).toBe(false);
  });

  it('lets page full screen cover the frame and restores the frame and window afterwards', async () => {
    await manager.openDashboard('dt_1');
    mockDynatraceView.setBounds.mockClear();

    mockDynatraceWebContentsHandlers.get('enter-html-full-screen')?.();
    expect(mockHostWindow.setFullScreen).toHaveBeenCalledWith(true);
    expect(mockDynatraceView.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
    });

    mockHostWindowHandlers.get('resize')?.();
    expect(mockDynatraceView.setBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({ y: 0, height: 900 }),
    );

    mockDynatraceWebContentsHandlers.get('leave-html-full-screen')?.();
    expect(mockHostWindow.setFullScreen).toHaveBeenLastCalledWith(false);
    expect(mockDynatraceView.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 56,
      width: 1440,
      height: 844,
    });
  });

  it('keeps a window the operator made full screen when the page leaves full screen', async () => {
    await manager.openDashboard('dt_1');
    mockHostWindow.isFullScreen.mockReturnValue(true);

    mockDynatraceWebContentsHandlers.get('enter-html-full-screen')?.();
    mockDynatraceWebContentsHandlers.get('leave-html-full-screen')?.();

    expect(mockHostWindow.setFullScreen).not.toHaveBeenCalled();
  });

  it('runs Back, Forward and Reload only for the popout whose frame asked', async () => {
    await manager.openDashboard('dt_1');

    expect(manager.navigate(mockHostWindow.webContents as never, 'back')).toBe(false);
    expect(mockHistory.goBack).not.toHaveBeenCalled();

    mockHistory.canGoBack.mockReturnValue(true);
    mockHistory.canGoForward.mockReturnValue(true);
    expect(manager.navigate(mockHostWindow.webContents as never, 'back')).toBe(true);
    expect(manager.navigate(mockHostWindow.webContents as never, 'forward')).toBe(true);
    expect(manager.navigate(mockHostWindow.webContents as never, 'reload')).toBe(true);
    expect(mockHistory.goBack).toHaveBeenCalledTimes(1);
    expect(mockHistory.goForward).toHaveBeenCalledTimes(1);
    expect(mockDynatraceView.webContents.reload).toHaveBeenCalledTimes(1);

    expect(manager.navigate({} as never, 'reload')).toBe(false);
    expect(mockDynatraceView.webContents.reload).toHaveBeenCalledTimes(1);
  });

  it('tells the frame where the page can go after each navigation and frame load', async () => {
    await manager.openDashboard('dt_1');
    mockHistory.canGoBack.mockReturnValue(true);

    mockDynatraceWebContentsHandlers.get('did-navigate-in-page')?.(
      {},
      'https://abc.live.dynatrace.com/dashboard#tile',
    );
    expect(mockHostWindow.webContents.send).toHaveBeenLastCalledWith('dynatrace:navigationState', {
      canGoBack: true,
      canGoForward: false,
    });

    mockHostWindow.webContents.send.mockClear();
    mockHostWebContentsHandlers.get('did-finish-load')?.();
    expect(mockHostWindow.webContents.send).toHaveBeenCalledTimes(1);
  });

  it('maps browser navigation keys on the page to the page history', async () => {
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      await manager.openDashboard('dt_1');
      mockHistory.canGoBack.mockReturnValue(true);
      const press = (input: Partial<Electron.Input>) => {
        const event = { preventDefault: vi.fn() };
        mockDynatraceWebContentsHandlers.get('before-input-event')?.(event, {
          type: 'keyDown',
          key: '',
          meta: false,
          control: false,
          alt: false,
          shift: false,
          ...input,
        });
        return event.preventDefault.mock.calls.length > 0;
      };

      expect(press({ key: '[', meta: true })).toBe(true);
      expect(mockHistory.goBack).toHaveBeenCalledTimes(1);
      expect(press({ key: 'r', meta: true })).toBe(true);
      expect(mockDynatraceView.webContents.reload).toHaveBeenCalledTimes(1);
      expect(press({ key: 'c', meta: true })).toBe(false);
      expect(press({ key: '[', control: true })).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', { value: platform });
    }
  });

  it('offers copy, paste and page history on right-click, and copies only Dynatrace links', async () => {
    await manager.openDashboard('dt_1');
    const params = {
      isEditable: true,
      selectionText: '',
      linkURL: 'https://abc.live.dynatrace.com/ui/problems',
      editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
    };

    mockDynatraceWebContentsHandlers.get('context-menu')?.({}, params);
    const labels = mockMenu.buildFromTemplate.mock.calls[0]?.[0].map(
      (item) => item.label ?? item.type,
    );
    expect(labels).toEqual([
      'Cut',
      'Copy',
      'Paste',
      'Select All',
      'Copy Link',
      'separator',
      'Back',
      'Forward',
      'Reload',
    ]);
    expect(mockMenuPopup).toHaveBeenCalledWith({ window: mockHostWindow });

    mockDynatraceWebContentsHandlers.get('context-menu')?.(
      {},
      { ...params, isEditable: false, linkURL: 'https://evil.example.com/' },
    );
    const second = mockMenu.buildFromTemplate.mock.calls[1]?.[0].map((item) => item.label);
    expect(second).not.toContain('Copy Link');
  });

  it('logs only permission origins while preserving fail-closed denial', async () => {
    await manager.openDashboard('dt_1');
    mockSecurityWarn.mockClear();

    const requestHandler = mockDynatraceSession.setPermissionRequestHandler.mock.calls[0]?.[0];
    const checkHandler = mockDynatraceSession.setPermissionCheckHandler.mock.calls[0]?.[0];
    const requestCallback = vi.fn();

    requestHandler?.(mockDynatraceView.webContents, 'geolocation', requestCallback, {
      requestingUrl:
        'https://operator:password@abc.live.dynatrace.com/ui/dashboard?code=request-secret#fragment-secret',
    });
    expect(requestCallback).toHaveBeenCalledWith(false);
    expect(mockSecurityWarn).toHaveBeenCalledWith('Blocked Dynatrace permission request', {
      permission: 'geolocation',
      requestingOrigin: 'https://abc.live.dynatrace.com',
    });

    expect(
      checkHandler?.(
        mockDynatraceView.webContents,
        'media',
        'https://login.microsoftonline.com/common/oauth2?state=check-secret#fragment-secret',
      ),
    ).toBe(false);
    expect(mockSecurityWarn).toHaveBeenCalledWith('Blocked Dynatrace permission check', {
      permission: 'media',
      requestingOrigin: 'https://login.microsoftonline.com',
    });
    expect(JSON.stringify(mockSecurityWarn.mock.calls)).not.toContain('request-secret');
    expect(JSON.stringify(mockSecurityWarn.mock.calls)).not.toContain('check-secret');
    expect(JSON.stringify(mockSecurityWarn.mock.calls)).not.toContain('password');
  });

  it('reopens Infra Health where it was left without storing it as a dashboard', async () => {
    vi.mocked(store.getBuiltInBounds).mockReturnValue({ x: 5, y: 6, width: 1000, height: 700 });

    await manager.openDashboard(INFRA_HEALTH_DASHBOARD.id);
    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({ x: 5, y: 6, width: 1000, height: 700 }),
    );

    mockHostWindowHandlers.get('close')?.();
    expect(store.setBuiltInBounds).toHaveBeenCalledWith(INFRA_HEALTH_DASHBOARD.id, {
      x: 10,
      y: 20,
      width: 1200,
      height: 800,
    });
    expect(store.setBounds).not.toHaveBeenCalled();
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
        lastUrl: 'https://evil.example',
      }),
    ]);
    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'dt_1',
        state: 'blocked',
        lastUrl: 'https://evil.example',
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
        lastUrl: 'https://abc.live.dynatrace.com',
      }),
    );

    mockDynatraceWebContentsHandlers.get('did-navigate-in-page')?.(
      {},
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );

    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'authenticating',
        lastUrl: 'https://login.microsoftonline.com',
      }),
    );
    expect(listener).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: 'dt_1',
        state: 'authenticating',
      }),
    ]);
  });

  it('publishes only navigation origins to dashboard listeners', async () => {
    const listener = vi.fn();
    manager.onStateChange(listener);
    await manager.openDashboard('dt_1');
    listener.mockClear();

    mockDynatraceWebContentsHandlers.get('did-navigate')?.(
      {},
      'https://abc.live.dynatrace.com/ui/dashboard?token=dynatrace-secret#private-fragment',
    );
    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'live',
        lastUrl: 'https://abc.live.dynatrace.com',
      }),
    );

    mockDynatraceWebContentsHandlers.get('did-navigate-in-page')?.(
      {},
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=auth-secret&code_challenge=challenge-secret#auth-fragment',
    );
    const published = listener.mock.calls.at(-1)?.[0];
    expect(published).toEqual([
      expect.objectContaining({
        state: 'authenticating',
        lastUrl: 'https://login.microsoftonline.com',
      }),
    ]);
    expect(JSON.stringify(published)).not.toContain('auth-secret');
    expect(JSON.stringify(published)).not.toContain('challenge-secret');
    expect(JSON.stringify(published)).not.toContain('auth-fragment');
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
        lastUrl: 'https://evil.example',
      }),
    );
    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'dt_1',
        state: 'blocked',
        lastUrl: 'https://evil.example',
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
        lastUrl: 'https://abc.live.dynatrace.com',
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
        lastUrl: 'https://evil.example',
      }),
    );
    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'dt_1',
        state: 'blocked',
        lastUrl: 'https://evil.example',
      }),
    ]);
  });

  it('keeps the blocked state when Chromium reports the blocked navigation as aborted', async () => {
    await manager.openDashboard('dt_1');
    mockDynatraceWebContentsHandlers.get('will-redirect')?.(
      { preventDefault: vi.fn() },
      'https://evil.example/redirected',
    );

    mockDynatraceWebContentsHandlers.get('did-fail-load')?.(
      {},
      -3,
      'ERR_ABORTED',
      'https://evil.example/redirected',
      true,
    );

    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({ state: 'blocked', lastUrl: 'https://evil.example' }),
    );
  });

  it('sets load-failed state for main-frame failures', async () => {
    const listener = vi.fn();
    manager.onStateChange(listener);
    await manager.openDashboard('dt_1');
    listener.mockClear();

    mockDynatraceWebContentsHandlers.get('did-fail-load')?.(
      {},
      -105,
      'ERR_NAME_NOT_RESOLVED while loading https://abc.live.dynatrace.com/dashboard?token=DID_FAIL_SECRET#private',
      'https://abc.live.dynatrace.com/dashboard?token=DID_FAIL_SECRET#private',
      true,
    );

    const state = manager.listDashboards()[0];
    expect(state).toEqual(
      expect.objectContaining({
        state: 'load-failed',
        lastUrl: 'https://abc.live.dynatrace.com',
        error: 'ERR_NAME_NOT_RESOLVED',
      }),
    );
    expect(JSON.stringify(state)).not.toContain('DID_FAIL_SECRET');
    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'dt_1',
        state: 'load-failed',
        error: 'ERR_NAME_NOT_RESOLVED',
      }),
    ]);
    expect(JSON.stringify(listener.mock.calls)).not.toContain('DID_FAIL_SECRET');
  });

  it('returns false and sets load-failed when initial dashboard load fails', async () => {
    vi.mocked(mockDynatraceView.webContents.loadURL).mockRejectedValueOnce(
      new Error(
        'ERR_CONNECTION_RESET while loading https://abc.live.dynatrace.com/dashboard?token=INITIAL_SECRET#private',
      ),
    );

    await expect(manager.openDashboard('dt_1')).resolves.toBe(false);

    const state = manager.listDashboards()[0];
    expect(state).toEqual(
      expect.objectContaining({
        state: 'load-failed',
        lastUrl: 'https://abc.live.dynatrace.com',
        error: 'ERR_CONNECTION_RESET',
      }),
    );
    expect(JSON.stringify(state)).not.toContain('INITIAL_SECRET');
  });

  it('does not promote a URL query value that resembles a Chromium error code', async () => {
    vi.mocked(mockDynatraceView.webContents.loadURL).mockRejectedValueOnce(
      new Error(
        'navigation failed while loading https://abc.live.dynatrace.com/dashboard?token=ERR_QUERY_SECRET#private',
      ),
    );

    await expect(manager.openDashboard('dt_1')).resolves.toBe(false);

    const state = manager.listDashboards()[0];
    expect(state).toEqual(
      expect.objectContaining({
        state: 'load-failed',
        lastUrl: 'https://abc.live.dynatrace.com',
        error: 'Navigation failed',
      }),
    );
    expect(JSON.stringify(state)).not.toContain('ERR_QUERY_SECRET');
  });

  it('keeps the dashboard window open when the initial load is aborted by a redirect', async () => {
    vi.mocked(mockDynatraceView.webContents.loadURL).mockRejectedValueOnce(
      new Error(
        'ERR_ABORTED (-3) loading https://abc.live.dynatrace.com/dashboard?token=ABORT_SECRET#private',
      ),
    );

    await expect(manager.openDashboard('dt_1')).resolves.toBe(true);

    expect(mockHostWindow.close).not.toHaveBeenCalled();
    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'authenticating',
        lastUrl: 'https://abc.live.dynatrace.com',
      }),
    );
    expect(mockMainInfo).toHaveBeenCalledWith(
      'Dynatrace initial navigation was superseded; keeping popout open',
      expect.objectContaining({ id: 'dt_1', error: 'ERR_ABORTED' }),
    );
    expect(JSON.stringify(mockMainInfo.mock.calls)).not.toContain('ABORT_SECRET');
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
      new Error(
        'ERR_FAILED while loading https://login.microsoftonline.com/oauth2/v2.0/authorize?code=POPUP_SECRET#private',
      ),
    );

    const result = mockWindowOpenHandlers.at(-1)?.({
      url: 'https://login.microsoftonline.com/oauth2/v2.0/authorize',
    });
    await Promise.resolve();

    expect(result).toEqual({ action: 'deny' });
    const state = manager.listDashboards()[0];
    expect(state).toEqual(
      expect.objectContaining({
        state: 'load-failed',
        lastUrl: 'https://login.microsoftonline.com',
        error: 'ERR_FAILED',
      }),
    );
    expect(JSON.stringify(state)).not.toContain('POPUP_SECRET');
  });

  it('keeps state steady when an allowed popup navigation is superseded', async () => {
    await manager.openDashboard('dt_1');
    vi.mocked(mockDynatraceView.webContents.loadURL).mockRejectedValueOnce(
      new Error(
        "ERR_ABORTED (-3) loading 'https://login.microsoftonline.com/oauth2/v2.0/authorize?code=POPUP_ABORT_SECRET#private'",
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
        lastUrl: 'https://abc.live.dynatrace.com',
      }),
    );
    expect(mockMainInfo).toHaveBeenCalledWith(
      'Dynatrace popup navigation was superseded; keeping popout open',
      expect.objectContaining({ id: 'dt_1', error: 'ERR_ABORTED' }),
    );
    expect(JSON.stringify(mockMainInfo.mock.calls)).not.toContain('POPUP_ABORT_SECRET');
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
        lastUrl: 'https://evil.example',
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

  it('keeps the load-failed reason when the failed window finishes closing', async () => {
    vi.mocked(mockDynatraceView.webContents.loadURL).mockRejectedValueOnce(
      new Error('ERR_NAME_NOT_RESOLVED while loading https://abc.live.dynatrace.com/dashboard'),
    );

    await expect(manager.openDashboard('dt_1')).resolves.toBe(false);
    // openDashboard closes the window it just failed to load; a bare 'closed'
    // here would replace the only explanation the user ever sees.
    mockHostWindowHandlers.get('closed')?.();

    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({
        state: 'load-failed',
        lastUrl: 'https://abc.live.dynatrace.com',
        error: 'ERR_NAME_NOT_RESOLVED',
      }),
    );
  });

  it('does not resurrect runtime state for a dashboard that was already removed', async () => {
    const listener = vi.fn();
    manager.onStateChange(listener);
    await manager.openDashboard('dt_1');
    expect(manager.removeDashboard('dt_1')).toBe(true);
    listener.mockClear();

    // 'closed' lands after removeDashboard dropped both entries; re-recording
    // state would leak a runtime entry nothing can read or delete again.
    mockHostWindowHandlers.get('closed')?.();

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps a reopened popout when the window it replaced finishes closing', async () => {
    const closing = { ...mockHostWindow, isDestroyed: vi.fn(() => false) };
    vi.mocked(BrowserWindow).mockImplementationOnce(function () {
      return closing;
    } as never);
    await manager.openDashboard('dt_1');
    const closedHandler = mockHostWindowHandlers.get('closed');
    // The first window is destroyed but its asynchronous 'closed' has not arrived yet.
    closing.isDestroyed.mockReturnValue(true);
    await manager.openDashboard('dt_1');

    closedHandler?.();

    expect(manager.listDashboards()[0]).toEqual(
      expect.objectContaining({ id: 'dt_1', state: 'authenticating' }),
    );
    await manager.openDashboard('dt_1');
    expect(BrowserWindow).toHaveBeenCalledTimes(2);
    expect(mockHostWindow.focus).toHaveBeenCalledTimes(1);
  });

  it('closes the Dynatrace view contents when the host window closes', async () => {
    await manager.openDashboard('dt_1');
    expect(mockDynatraceView.webContents.close).not.toHaveBeenCalled();

    mockHostWindowHandlers.get('closed')?.();

    expect(mockDynatraceView.webContents.close).toHaveBeenCalledTimes(1);
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
