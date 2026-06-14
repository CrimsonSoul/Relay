import { app, BrowserWindow, session, WebContentsView, type Session } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  classifyDynatraceNavigation,
  isDynatraceAuthUrl,
  type DynatraceDashboard,
  type DynatraceDashboardInput,
  type DynatraceDashboardState,
  type DynatraceRuntimeState,
} from '../../shared/dynatrace';
import { getErrorMessage } from '../../shared/types';
import { describeUrlForLog } from '../../shared/urlSecurity';
import { setupWindowListeners } from '../handlers/windowHandlers';
import { loggers } from '../logger';
import { isAllowedRendererFileUrl } from '../utils/trustedSender';
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
};

function isNavigationAbortError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes('ERR_ABORTED') || message.includes('(-3)');
}

function isAllowedDevRendererUrl(url: string, rendererUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(rendererUrl).origin;
  } catch {
    return false;
  }
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

function getDynatraceSession(): Session {
  const dynatraceSession = session.fromPartition(DYNATRACE_SESSION_PARTITION);
  hardenDynatraceSession(dynatraceSession);
  return dynatraceSession;
}

function hardenDynatraceSession(dynatraceSession: Session): void {
  dynatraceSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    loggers.security.warn('Blocked Dynatrace permission request', {
      permission,
      requestingUrl: details.requestingUrl,
    });
    callback(false);
  });

  dynatraceSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    loggers.security.warn('Blocked Dynatrace permission check', {
      permission,
      requestingOrigin,
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
    const dashboard = this.options.store.list().find((candidate) => candidate.id === id);
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
      title: `Relay - Dynatrace - ${dashboard.name}`,
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
    this.layoutDashboardView(window, view);

    this.windows.set(id, { window, view });
    this.updateRuntime(id, 'authenticating', { lastUrl: dashboard.url });
    this.attachHostWindowHandlers(id, window, view);
    this.attachDynatraceContentHandlers(id, view);
    try {
      await window.loadURL(buildDynatraceShellUrl(dashboard));
      await view.webContents.loadURL(dashboard.url);
    } catch (error) {
      if (isNavigationAbortError(error)) {
        loggers.main.info('Dynatrace initial navigation was superseded; keeping popout open', {
          id,
          error: getErrorMessage(error),
        });
        return true;
      }

      this.updateRuntime(id, 'load-failed', {
        lastUrl: dashboard.url,
        error: getErrorMessage(error),
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

  onStateChange(listener: (dashboards: DynatraceDashboardState[]) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private attachHostWindowHandlers(id: string, window: BrowserWindow, view: WebContentsView): void {
    setupWindowListeners(window);

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
      this.layoutDashboardView(window, view);
    };
    window.on('resize', layout);
    window.on('maximize', layout);
    window.on('unmaximize', layout);

    window.on('close', () => {
      this.persistBounds(id, window);
    });

    window.on('closed', () => {
      this.windows.delete(id);
      this.updateRuntime(id, 'closed');
    });
  }

  private attachDynatraceContentHandlers(id: string, view: WebContentsView): void {
    const { webContents } = view;

    webContents.on('will-navigate', (event, url) => {
      this.applyNavigationPolicy(id, event, url);
    });

    webContents.on('will-redirect', (event, url) => {
      this.applyNavigationPolicy(id, event, url);
    });

    webContents.on('did-navigate', (_event, url) => {
      this.updateStateForNavigatedUrl(id, url);
    });

    webContents.on('did-navigate-in-page', (_event, url) => {
      this.updateStateForNavigatedUrl(id, url);
    });

    webContents.on(
      'did-fail-load',
      (_event, _errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        this.updateRuntime(id, 'load-failed', {
          lastUrl: validatedURL,
          error: errorDescription,
        });
      },
    );

    webContents.setWindowOpenHandler(({ url }) => {
      if (classifyDynatraceNavigation(url) !== 'blocked') {
        void webContents.loadURL(url).catch((error) => {
          if (isNavigationAbortError(error)) {
            loggers.main.info('Dynatrace popup navigation was superseded; keeping popout open', {
              id,
              error: getErrorMessage(error),
            });
            return;
          }

          this.updateRuntime(id, 'load-failed', {
            lastUrl: url,
            error: getErrorMessage(error),
          });
        });
      } else {
        this.updateRuntime(id, 'blocked', { lastUrl: url });
      }

      return { action: 'deny' };
    });
  }

  private layoutDashboardView(window: BrowserWindow, view: WebContentsView): void {
    const bounds = window.getContentBounds();
    view.setBounds({
      x: 0,
      y: DYNATRACE_CHROME_HEIGHT,
      width: bounds.width,
      height: Math.max(0, bounds.height - DYNATRACE_CHROME_HEIGHT),
    });
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
      this.options.store.setBounds(id, bounds);
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
    this.runtime.set(id, { state, ...details });
    this.broadcastStateChange();
  }

  private broadcastStateChange(): void {
    const dashboards = this.listDashboards();
    for (const listener of this.stateListeners) {
      listener(dashboards);
    }
  }
}
