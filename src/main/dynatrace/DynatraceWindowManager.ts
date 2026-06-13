import { BrowserWindow, session, type Session } from 'electron';
import {
  classifyDynatraceNavigation,
  isDynatraceAuthUrl,
  type DynatraceDashboard,
  type DynatraceDashboardInput,
  type DynatraceDashboardState,
  type DynatraceRuntimeState,
} from '../../shared/dynatrace';
import { getErrorMessage } from '../../shared/types';
import { loggers } from '../logger';
import { DynatraceDashboardStore } from './DynatraceDashboardStore';

const DYNATRACE_SESSION_PARTITION = 'persist:relay-dynatrace';
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
  private readonly windows = new Map<string, BrowserWindow>();
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
    if (existing && !existing.isDestroyed()) {
      existing.close();
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
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return true;
    }
    this.windows.delete(id);

    const dynatraceSession = getDynatraceSession();
    const window = new BrowserWindow({
      ...(dashboard.bounds ?? DEFAULT_WINDOW_OPTIONS),
      backgroundColor: DEFAULT_WINDOW_OPTIONS.backgroundColor,
      title: `Relay - Dynatrace - ${dashboard.name}`,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
        session: dynatraceSession,
      },
    });

    this.windows.set(id, window);
    this.updateRuntime(id, 'authenticating', { lastUrl: dashboard.url });
    this.attachWindowHandlers(id, window);
    try {
      await window.loadURL(dashboard.url);
    } catch (error) {
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

  private attachWindowHandlers(id: string, window: BrowserWindow): void {
    window.webContents.on('will-navigate', (event, url) => {
      this.applyNavigationPolicy(id, event, url);
    });

    window.webContents.on('will-redirect', (event, url) => {
      this.applyNavigationPolicy(id, event, url);
    });

    window.webContents.on('did-navigate', (_event, url) => {
      this.updateStateForNavigatedUrl(id, url);
    });

    window.webContents.on('did-navigate-in-page', (_event, url) => {
      this.updateStateForNavigatedUrl(id, url);
    });

    window.webContents.on(
      'did-fail-load',
      (_event, _errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        this.updateRuntime(id, 'load-failed', {
          lastUrl: validatedURL,
          error: errorDescription,
        });
      },
    );

    window.webContents.setWindowOpenHandler(({ url }) => {
      if (classifyDynatraceNavigation(url) !== 'blocked') {
        void window.loadURL(url).catch((error) => {
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

    window.on('close', () => {
      this.persistBounds(id, window);
    });

    window.on('closed', () => {
      this.windows.delete(id);
      this.updateRuntime(id, 'closed');
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
