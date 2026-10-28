import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  session,
  WebContentsView,
  type Session,
  type WebContents,
} from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  classifyDynatraceNavigation,
  findBuiltInDynatraceDashboard,
  isDynatraceAuthUrl,
  type DynatraceDashboard,
  type DynatraceDashboardInput,
  type DynatraceDashboardState,
  type DynatraceNavigationAction,
  type DynatraceNavigationState,
  type DynatraceRuntimeState,
} from '../../shared/dynatrace';
import { IPC_CHANNELS } from '../../shared/ipc';
import { getErrorMessage } from '../../shared/types';
import { describeUrlForLog } from '../../shared/urlSecurity';
import { setupWindowListeners } from '../handlers/windowHandlers';
import { loggers } from '../logger';
import { isAllowedDevRendererUrl, isAllowedRendererFileUrl } from '../utils/trustedSender';
import { configureWindowsTaskbarWindow } from '../app/windowsTaskbarIdentity';
import { DynatraceDashboardStore } from './DynatraceDashboardStore';

const mainDir = dirname(fileURLToPath(import.meta.url));
const DYNATRACE_SESSION_PARTITION = 'persist:relay-dynatrace';
const DYNATRACE_CHROME_HEIGHT = 56;
const DEFAULT_WINDOW_OPTIONS = {
  width: 1440,
  height: 900,
  backgroundColor: '#060608',
} as const;

type RuntimeDetails = {
  state: DynatraceRuntimeState;
  lastUrl?: string;
  error?: string;
};

type DynatraceWindowEntry = {
  window: BrowserWindow;
  view: WebContentsView;
  /** The page asked for full screen (a dashboard's full-screen button): the view covers the frame. */
  pageFullScreen: boolean;
};

/**
 * The only powers a Dynatrace page gets, and only from Dynatrace itself: element full screen for
 * dashboards, and write-only clipboard for its copy buttons. Everything else stays denied.
 */
const DYNATRACE_PAGE_PERMISSIONS: ReadonlySet<string> = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
]);

function isGrantedDynatracePermission(permission: string, requestingUrl: string): boolean {
  return (
    DYNATRACE_PAGE_PERMISSIONS.has(permission) &&
    classifyDynatraceNavigation(requestingUrl) === 'dynatrace'
  );
}

const CHROMIUM_NAVIGATION_ERROR_PATTERN = /^(?:Error:\s*)?(ERR_[A-Z0-9_]{1,63})(?=\s|$)/;
const SAFE_NAVIGATION_ERROR_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
/** Chromium's net::ERR_ABORTED, reported when a navigation is superseded or cancelled. */
const NAVIGATION_ABORTED = -3;

function describeNavigationError(error: unknown): string {
  const message = getErrorMessage(error).trim();
  const chromiumError = CHROMIUM_NAVIGATION_ERROR_PATTERN.exec(message)?.[1];
  if (chromiumError) return chromiumError;
  if (SAFE_NAVIGATION_ERROR_PATTERN.test(message)) return message;
  return 'Navigation failed';
}

function isNavigationAbortError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return describeNavigationError(message) === 'ERR_ABORTED';
}

function buildDynatraceShellUrl(dashboard: DynatraceDashboard): string {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    url.searchParams.set('popout', 'dynatrace');
    url.searchParams.set('name', dashboard.name);
    return url.href;
  }

  const indexPath = join(mainDir, '../renderer/index.html');
  const url = pathToFileURL(indexPath);
  url.searchParams.set('popout', 'dynatrace');
  url.searchParams.set('name', dashboard.name);
  return url.href;
}

function isAllowedDynatraceShellUrl(url: string): boolean {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return isAllowedDevRendererUrl(url, process.env.ELECTRON_RENDERER_URL);
  }
  return isAllowedRendererFileUrl(url, join(mainDir, '../renderer'));
}

const COMMAND_SHORTCUTS: Readonly<Record<string, DynatraceNavigationAction>> = {
  '[': 'back',
  ']': 'forward',
  r: 'reload',
};
const ALT_SHORTCUTS: Readonly<Record<string, DynatraceNavigationAction>> = {
  arrowleft: 'back',
  arrowright: 'forward',
};

/** ⌘[ / ⌘] / ⌘R on macOS; Ctrl+[ / ] / R, Alt+← / → and F5 elsewhere. */
function navigationShortcut(input: Electron.Input): DynatraceNavigationAction | null {
  if (input.type !== 'keyDown' || input.shift) return null;
  const key = input.key.toLowerCase();
  const isMac = process.platform === 'darwin';
  const command = isMac ? input.meta : input.control;
  const otherModifier = isMac ? input.control : input.meta;
  if (otherModifier) return null;

  if (command && !input.alt) return COMMAND_SHORTCUTS[key] ?? null;
  if (isMac || command) return null;
  if (input.alt) return ALT_SHORTCUTS[key] ?? null;
  return key === 'f5' ? 'reload' : null;
}

function getDynatraceSession(): Session {
  const dynatraceSession = session.fromPartition(DYNATRACE_SESSION_PARTITION);
  hardenDynatraceSession(dynatraceSession);
  return dynatraceSession;
}

function hardenDynatraceSession(dynatraceSession: Session): void {
  dynatraceSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (isGrantedDynatracePermission(permission, details.requestingUrl)) {
      callback(true);
      return;
    }
    loggers.security.warn('Blocked Dynatrace permission request', {
      permission,
      requestingOrigin: describeUrlForLog(details.requestingUrl),
    });
    callback(false);
  });

  dynatraceSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (isGrantedDynatracePermission(permission, requestingOrigin)) return true;
    loggers.security.warn('Blocked Dynatrace permission check', {
      permission,
      requestingOrigin: describeUrlForLog(requestingOrigin),
    });
    return false;
  });
}

export class DynatraceWindowManager {
  private readonly windows = new Map<string, DynatraceWindowEntry>();
  private readonly runtime = new Map<string, RuntimeDetails>();
  private readonly stateListeners = new Set<(dashboards: DynatraceDashboardState[]) => void>();

  constructor(private readonly options: { store: DynatraceDashboardStore }) {}

  listDashboards(): DynatraceDashboardState[] {
    return this.options.store.list().map((dashboard) => this.toDashboardState(dashboard));
  }

  addDashboard(input: DynatraceDashboardInput): DynatraceDashboardState {
    const dashboard = this.options.store.add(input);
    const state = this.toDashboardState(dashboard);
    this.broadcastStateChange();
    return state;
  }

  updateDashboard(id: string, input: DynatraceDashboardInput): DynatraceDashboardState | null {
    const dashboard = this.options.store.update(id, input);
    if (!dashboard) return null;

    const state = this.toDashboardState(dashboard);
    this.broadcastStateChange();
    return state;
  }

  removeDashboard(id: string): boolean {
    const removed = this.options.store.remove(id);
    if (!removed) return false;

    const existing = this.windows.get(id);
    if (existing && !existing.window.isDestroyed()) {
      existing.window.close();
    }
    this.windows.delete(id);
    this.runtime.delete(id);
    this.broadcastStateChange();
    return true;
  }

  async openDashboard(id: string): Promise<boolean> {
    const dashboard = this.findDashboard(id);
    if (!dashboard) return false;

    const existing = this.windows.get(id);
    if (existing && !existing.window.isDestroyed()) {
      existing.window.focus();
      return true;
    }
    this.windows.delete(id);

    const dynatraceSession = getDynatraceSession();
    const window = new BrowserWindow({
      ...(dashboard.bounds ?? DEFAULT_WINDOW_OPTIONS),
      backgroundColor: DEFAULT_WINDOW_OPTIONS.backgroundColor,
      title: `Relay - ${dashboard.name}`,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 24, y: 16 },
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(mainDir, '../preload/index.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
      },
    });
    configureWindowsTaskbarWindow(window, {
      platform: process.platform,
      isPackaged: app.isPackaged,
      execPath: process.execPath,
    });
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
        session: dynatraceSession,
      },
    });
    window.contentView.addChildView(view);
    const entry: DynatraceWindowEntry = { window, view, pageFullScreen: false };
    this.layoutDashboardView(entry);

    this.windows.set(id, entry);
    this.updateRuntime(id, 'authenticating', { lastUrl: dashboard.url });
    this.attachHostWindowHandlers(id, entry);
    this.attachDynatraceContentHandlers(id, entry);
    try {
      await window.loadURL(buildDynatraceShellUrl(dashboard));
      await view.webContents.loadURL(dashboard.url);
    } catch (error) {
      if (isNavigationAbortError(error)) {
        loggers.main.info('Dynatrace initial navigation was superseded; keeping popout open', {
          id,
          error: describeNavigationError(error),
        });
        return true;
      }

      this.updateRuntime(id, 'load-failed', {
        lastUrl: dashboard.url,
        error: describeNavigationError(error),
      });
      this.windows.delete(id);
      if (!window.isDestroyed()) {
        window.close();
      }
      return false;
    }
    return true;
  }

  async clearSession(): Promise<boolean> {
    const dynatraceSession = getDynatraceSession();
    await dynatraceSession.clearStorageData();
    return true;
  }

  /** Back, Forward or Reload from the frame of the popout whose shell sent it. */
  navigate(sender: WebContents, action: DynatraceNavigationAction): boolean {
    const entry = [...this.windows.values()].find(
      (candidate) => !candidate.window.isDestroyed() && candidate.window.webContents === sender,
    );
    if (!entry) return false;
    return this.runNavigation(entry, action);
  }

  onStateChange(listener: (dashboards: DynatraceDashboardState[]) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private attachHostWindowHandlers(id: string, entry: DynatraceWindowEntry): void {
    const { window, view } = entry;
    setupWindowListeners(window);
    this.attachNavigationShortcuts(entry, window.webContents);

    // A reloaded frame starts with both history buttons disabled until it hears otherwise.
    window.webContents.on('did-finish-load', () => {
      this.sendNavigationState(entry);
    });

    window.webContents.on('will-navigate', (event, url) => {
      if (isAllowedDynatraceShellUrl(url)) return;
      loggers.security.warn(`Blocked Dynatrace shell navigation to: ${describeUrlForLog(url)}`);
      event.preventDefault();
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      loggers.security.warn(
        `Blocked Dynatrace shell window.open attempt: ${describeUrlForLog(url)}`,
      );
      return { action: 'deny' };
    });

    const layout = () => {
      this.layoutDashboardView(entry);
    };
    window.on('resize', layout);
    window.on('maximize', layout);
    window.on('unmaximize', layout);

    window.on('close', () => {
      this.persistBounds(id, window);
    });

    window.on('closed', () => {
      // A host window does not own its child view's contents; without this the Dynatrace
      // renderer process outlives the popout.
      if (!view.webContents.isDestroyed()) view.webContents.close();

      // A popout reopened while this one was still closing owns the id and its state now.
      const current = this.windows.get(id);
      if (current && current.window !== window) return;
      this.windows.delete(id);

      // 'closed' arrives asynchronously, so removeDashboard() has already dropped
      // the store and runtime entries by the time it fires. Recording state here
      // would resurrect an id nothing can ever read or delete again.
      if (!this.options.store.list().some((dashboard) => dashboard.id === id)) return;

      // A load failure is terminal and carries the only explanation the user gets
      // (DNS failure, VPN down). openDashboard() closes the window it just failed
      // to load, so a bare 'closed' here would erase that reason immediately.
      if (this.runtime.get(id)?.state === 'load-failed') return;

      this.updateRuntime(id, 'closed');
    });
  }

  private attachDynatraceContentHandlers(id: string, entry: DynatraceWindowEntry): void {
    const { window, view } = entry;
    const { webContents } = view;
    const applyStablePageScale = () => {
      webContents.setZoomFactor(1);
      void webContents.setVisualZoomLevelLimits(1, 1).catch((error) => {
        loggers.main.warn('Failed to lock Dynatrace page zoom', {
          error: getErrorMessage(error),
        });
      });
    };

    applyStablePageScale();
    webContents.on('did-stop-loading', applyStablePageScale);

    webContents.on('will-navigate', (event, url) => {
      this.applyNavigationPolicy(id, event, url);
    });

    webContents.on('will-redirect', (event, url) => {
      this.applyNavigationPolicy(id, event, url);
    });

    webContents.on('did-navigate', (_event, url) => {
      this.updateStateForNavigatedUrl(id, url);
      this.sendNavigationState(entry);
    });

    webContents.on('did-navigate-in-page', (_event, url) => {
      this.updateStateForNavigatedUrl(id, url);
      this.sendNavigationState(entry);
    });

    // Element full screen (a dashboard's full-screen button) covers Relay's frame and fills the
    // display; leaving it restores the frame and the window state the operator had.
    let leaveWindowFullScreen = false;
    webContents.on('enter-html-full-screen', () => {
      entry.pageFullScreen = true;
      leaveWindowFullScreen = !window.isFullScreen();
      if (leaveWindowFullScreen) window.setFullScreen(true);
      this.layoutDashboardView(entry);
    });
    webContents.on('leave-html-full-screen', () => {
      entry.pageFullScreen = false;
      if (leaveWindowFullScreen && !window.isDestroyed()) window.setFullScreen(false);
      leaveWindowFullScreen = false;
      this.layoutDashboardView(entry);
    });

    this.attachNavigationShortcuts(entry, webContents);
    webContents.on('context-menu', (_event, params) => {
      this.showPageContextMenu(entry, params);
    });

    webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        // ERR_ABORTED (-3) is a superseded or blocked navigation, not a failure: the blocked
        // state or the page that replaced it is already shown.
        if (!isMainFrame || errorCode === NAVIGATION_ABORTED) return;
        this.updateRuntime(id, 'load-failed', {
          lastUrl: validatedURL,
          error: describeNavigationError(errorDescription),
        });
      },
    );

    webContents.setWindowOpenHandler(({ url }) => {
      if (classifyDynatraceNavigation(url) !== 'blocked') {
        void webContents.loadURL(url).catch((error) => {
          if (isNavigationAbortError(error)) {
            loggers.main.info('Dynatrace popup navigation was superseded; keeping popout open', {
              id,
              error: describeNavigationError(error),
            });
            return;
          }

          this.updateRuntime(id, 'load-failed', {
            lastUrl: url,
            error: describeNavigationError(error),
          });
        });
      } else {
        this.updateRuntime(id, 'blocked', { lastUrl: url });
      }

      return { action: 'deny' };
    });
  }

  private layoutDashboardView({ window, view, pageFullScreen }: DynatraceWindowEntry): void {
    const bounds = window.getContentBounds();
    const top = pageFullScreen ? 0 : DYNATRACE_CHROME_HEIGHT;
    view.setBounds({
      x: 0,
      y: top,
      width: bounds.width,
      height: Math.max(0, bounds.height - top),
    });
  }

  private runNavigation(
    { view }: DynatraceWindowEntry,
    action: DynatraceNavigationAction,
  ): boolean {
    const { webContents } = view;
    if (webContents.isDestroyed()) return false;
    const history = webContents.navigationHistory;
    if (action === 'back') {
      if (!history.canGoBack()) return false;
      history.goBack();
    } else if (action === 'forward') {
      if (!history.canGoForward()) return false;
      history.goForward();
    } else {
      webContents.reload();
    }
    return true;
  }

  private sendNavigationState({ window, view }: DynatraceWindowEntry): void {
    if (window.isDestroyed() || view.webContents.isDestroyed()) return;
    const history = view.webContents.navigationHistory;
    const state: DynatraceNavigationState = {
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
    };
    window.webContents.send(IPC_CHANNELS.DYNATRACE_NAVIGATION_STATE, state);
  }

  /** Browser keys work whether the frame or the Dynatrace page has focus. */
  private attachNavigationShortcuts(entry: DynatraceWindowEntry, webContents: WebContents): void {
    webContents.on('before-input-event', (event, input) => {
      const action = navigationShortcut(input);
      if (!action) return;
      event.preventDefault();
      this.runNavigation(entry, action);
    });
  }

  private showPageContextMenu(
    entry: DynatraceWindowEntry,
    params: Electron.ContextMenuParams,
  ): void {
    const history = entry.view.webContents.navigationHistory;
    const items: Electron.MenuItemConstructorOptions[] = [];

    if (params.isEditable) {
      items.push(
        { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
        { label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText) {
      items.push({ label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy });
    }

    if (params.linkURL && classifyDynatraceNavigation(params.linkURL) !== 'blocked') {
      items.push({ label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) });
    }

    if (items.length > 0) items.push({ type: 'separator' });
    items.push(
      {
        label: 'Back',
        enabled: history.canGoBack(),
        click: () => this.runNavigation(entry, 'back'),
      },
      {
        label: 'Forward',
        enabled: history.canGoForward(),
        click: () => this.runNavigation(entry, 'forward'),
      },
      { label: 'Reload', click: () => this.runNavigation(entry, 'reload') },
    );

    Menu.buildFromTemplate(items).popup({ window: entry.window });
  }

  private findDashboard(id: string): DynatraceDashboard | undefined {
    const builtIn = findBuiltInDynatraceDashboard(id);
    if (builtIn) {
      const bounds = this.options.store.getBuiltInBounds(id);
      return bounds ? { ...builtIn, bounds } : builtIn;
    }
    return this.options.store.list().find((candidate) => candidate.id === id);
  }

  private applyNavigationPolicy(
    id: string,
    event: { preventDefault: () => void },
    url: string,
  ): void {
    if (classifyDynatraceNavigation(url) !== 'blocked') return;

    event.preventDefault();
    this.updateRuntime(id, 'blocked', { lastUrl: url });
  }

  private persistBounds(id: string, window: BrowserWindow): void {
    try {
      const bounds = window.getBounds();
      if (findBuiltInDynatraceDashboard(id)) {
        this.options.store.setBuiltInBounds(id, bounds);
      } else {
        this.options.store.setBounds(id, bounds);
      }
    } catch (error) {
      loggers.main.warn('Failed to persist Dynatrace dashboard bounds', {
        id,
        error: getErrorMessage(error),
      });
    }
  }

  private updateStateForNavigatedUrl(id: string, url: string): void {
    const navigationKind = classifyDynatraceNavigation(url);
    if (navigationKind === 'blocked') {
      this.updateRuntime(id, 'blocked', { lastUrl: url });
      return;
    }

    const state =
      navigationKind === 'microsoft-auth' || isDynatraceAuthUrl(url) ? 'authenticating' : 'live';
    this.updateRuntime(id, state, { lastUrl: url });
  }

  private toDashboardState(dashboard: DynatraceDashboard): DynatraceDashboardState {
    const runtime = this.runtime.get(dashboard.id);
    return {
      ...dashboard,
      state: runtime?.state ?? 'closed',
      ...(runtime?.lastUrl ? { lastUrl: runtime.lastUrl } : {}),
      ...(runtime?.error ? { error: runtime.error } : {}),
    };
  }

  private updateRuntime(
    id: string,
    state: DynatraceRuntimeState,
    details: Omit<RuntimeDetails, 'state'> = {},
  ): void {
    this.runtime.set(id, {
      state,
      ...details,
      ...(details.lastUrl ? { lastUrl: describeUrlForLog(details.lastUrl) } : {}),
      ...(details.error ? { error: describeNavigationError(details.error) } : {}),
    });
    this.broadcastStateChange();
  }

  private broadcastStateChange(): void {
    const dashboards = this.listDashboards();
    for (const listener of this.stateListeners) {
      listener(dashboards);
    }
  }
}
