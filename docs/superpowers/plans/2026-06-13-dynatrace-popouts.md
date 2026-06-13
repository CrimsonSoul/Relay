# Dynatrace Popouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generic, secure Dynatrace dashboard popouts with Microsoft SSO support, local dashboard settings, sidebar launching, auth-state toasts, and one-minute refresh-friendly window behavior.

**Architecture:** Keep Dynatrace remote content in dedicated main-process `BrowserWindow` instances managed by a new Dynatrace window manager. Store dashboard definitions locally under Relay's fixed app config data directory, expose typed IPC through preload, and render only settings/launcher controls inside Relay's React UI.

**Tech Stack:** Electron main process, typed IPC in `src/shared/ipc.ts`, React renderer components, Vitest unit/renderer tests, existing Relay sidebar/settings styles.

---

## File Structure

- Create `src/shared/dynatrace.ts`: shared types, URL validation, navigation classification, and state helpers.
- Create `src/shared/dynatrace.test.ts`: unit coverage for Dynatrace and Microsoft SSO URL policy.
- Create `src/main/dynatrace/DynatraceDashboardStore.ts`: local JSON storage for configured dashboards.
- Create `src/main/dynatrace/DynatraceDashboardStore.test.ts`: storage, migration, and validation tests.
- Create `src/main/dynatrace/DynatraceWindowManager.ts`: main-process window creation, navigation policy enforcement, state transitions, bounds persistence, session clearing.
- Create `src/main/dynatrace/DynatraceWindowManager.test.ts`: focused BrowserWindow/session/navigation behavior tests.
- Create `src/main/handlers/dynatraceHandlers.ts`: trusted IPC handlers for list/add/update/remove/open/clear session.
- Create `src/main/handlers/dynatraceHandlers.test.ts`: IPC validation and trusted-handler tests.
- Modify `src/shared/ipc.ts`: add Dynatrace types to `BridgeAPI` and `IPC_CHANNELS`.
- Modify `src/preload/index.ts`: expose Dynatrace IPC methods and state subscription.
- Modify `src/main/ipcHandlers.ts`, `src/main/app/appState.ts`, and `src/main/index.ts`: instantiate and register the manager with `configDataDir`.
- Create `src/renderer/src/hooks/useDynatraceDashboards.ts`: renderer state hook with one-shot signed-out toast transition.
- Create `src/renderer/src/hooks/__tests__/useDynatraceDashboards.test.ts`: hook behavior and toast tests.
- Modify `src/renderer/src/components/SettingsModal.tsx`: add dashboard management UI.
- Modify `src/renderer/src/components/__tests__/SettingsModal.test.tsx`: settings behavior tests.
- Create `src/renderer/src/components/sidebar/SidebarDashboards.tsx`: sidebar launcher and multi-dashboard popover.
- Create `src/renderer/src/components/__tests__/sidebar/SidebarDashboards.test.tsx`: launcher tests.
- Modify `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/components/__tests__/Sidebar.test.tsx`, `src/renderer/src/components/sidebar/SidebarIcons.tsx`, and `src/renderer/src/components/sidebar/sidebar.css`: integrate launcher with footer.
- Modify `src/renderer/src/App.tsx` and `src/renderer/src/__tests__/App.test.tsx`: load hook once and pass dashboard props into `Sidebar` and `SettingsModal`.

---

### Task 1: Shared Dynatrace URL Policy

**Files:**
- Create: `src/shared/dynatrace.ts`
- Create: `src/shared/dynatrace.test.ts`

- [ ] **Step 1: Write the failing URL policy tests**

Create `src/shared/dynatrace.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  classifyDynatraceNavigation,
  getDynatraceStartUrlError,
  isDynatraceAuthUrl,
} from './dynatrace';

describe('Dynatrace URL policy', () => {
  it('accepts HTTPS Dynatrace dashboard start URLs', () => {
    expect(
      getDynatraceStartUrlError('https://abc12345.live.dynatrace.com/ui/apps/dynatrace.dashboards/dashboard'),
    ).toBeNull();
    expect(getDynatraceStartUrlError('https://apps.dynatrace.com/dashboard/abc')).toBeNull();
  });

  it('rejects non-Dynatrace or non-HTTPS start URLs', () => {
    expect(getDynatraceStartUrlError('http://abc12345.live.dynatrace.com/dashboard')).toBe(
      'Dynatrace dashboard URLs must use HTTPS.',
    );
    expect(getDynatraceStartUrlError('https://example.com/dashboard')).toBe(
      'Enter a Dynatrace URL under dynatrace.com.',
    );
    expect(getDynatraceStartUrlError('not a url')).toBe('Enter a valid URL.');
  });

  it('allows Microsoft SSO only as navigation, not as a start URL', () => {
    expect(getDynatraceStartUrlError('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')).toBe(
      'Enter a Dynatrace URL under dynatrace.com.',
    );
    expect(classifyDynatraceNavigation('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')).toBe(
      'microsoft-auth',
    );
  });

  it('blocks unknown navigation targets and unsafe protocols', () => {
    expect(classifyDynatraceNavigation('https://evil.example/phish')).toBe('blocked');
    expect(classifyDynatraceNavigation('javascript:alert(1)')).toBe('blocked');
    expect(classifyDynatraceNavigation('file:///etc/passwd')).toBe('blocked');
  });

  it('identifies Dynatrace sign-in routes as auth state', () => {
    expect(isDynatraceAuthUrl('https://abc12345.live.dynatrace.com/signin')).toBe(true);
    expect(isDynatraceAuthUrl('https://abc12345.live.dynatrace.com/ui/login')).toBe(true);
    expect(isDynatraceAuthUrl('https://abc12345.live.dynatrace.com/ui/apps/dynatrace.dashboards/dashboard')).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `npx vitest run src/shared/dynatrace.test.ts`

Expected: FAIL because `src/shared/dynatrace.ts` does not exist.

- [ ] **Step 3: Implement shared URL policy and types**

Create `src/shared/dynatrace.ts`:

```ts
export type DynatraceRuntimeState =
  | 'live'
  | 'authenticating'
  | 'blocked'
  | 'load-failed'
  | 'closed';

export type DynatraceNavigationKind = 'dynatrace' | 'microsoft-auth' | 'blocked';

export type DynatraceDashboardBounds = {
  x?: number;
  y?: number;
  width: number;
  height: number;
};

export type DynatraceDashboard = {
  id: string;
  name: string;
  url: string;
  bounds?: DynatraceDashboardBounds;
};

export type DynatraceDashboardState = DynatraceDashboard & {
  state: DynatraceRuntimeState;
  lastUrl?: string;
  error?: string;
};

export type DynatraceDashboardInput = {
  name: string;
  url: string;
};

const MICROSOFT_AUTH_HOSTS = new Set([
  'login.microsoft.com',
  'login.microsoftonline.com',
  'login.windows.net',
  'sts.windows.net',
]);

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:') return parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function isDynatraceHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'dynatrace.com' || host.endsWith('.dynatrace.com');
}

export function isMicrosoftAuthHost(hostname: string): boolean {
  return MICROSOFT_AUTH_HOSTS.has(hostname.toLowerCase());
}

export function getDynatraceStartUrlError(value: string): string | null {
  const parsed = parseHttpUrl(value);
  if (!parsed) return 'Enter a valid URL.';
  if (parsed.protocol !== 'https:') return 'Dynatrace dashboard URLs must use HTTPS.';
  if (!isDynatraceHost(parsed.hostname)) return 'Enter a Dynatrace URL under dynatrace.com.';
  return null;
}

export function classifyDynatraceNavigation(value: string): DynatraceNavigationKind {
  const parsed = parseHttpUrl(value);
  if (!parsed || parsed.protocol !== 'https:') return 'blocked';
  if (isDynatraceHost(parsed.hostname)) return 'dynatrace';
  if (isMicrosoftAuthHost(parsed.hostname)) return 'microsoft-auth';
  return 'blocked';
}

export function isDynatraceAuthUrl(value: string): boolean {
  const parsed = parseHttpUrl(value);
  if (!parsed || !isDynatraceHost(parsed.hostname)) return false;
  const authText = `${parsed.pathname} ${parsed.search}`.toLowerCase();
  return (
    authText.includes('signin') ||
    authText.includes('sign-in') ||
    authText.includes('login') ||
    authText.includes('/sso') ||
    authText.includes('oauth')
  );
}
```

- [ ] **Step 4: Run the shared test to verify it passes**

Run: `npx vitest run src/shared/dynatrace.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/dynatrace.ts src/shared/dynatrace.test.ts
git commit -m "feat: add Dynatrace URL policy"
```

---

### Task 2: Local Dashboard Store

**Files:**
- Create: `src/main/dynatrace/DynatraceDashboardStore.ts`
- Create: `src/main/dynatrace/DynatraceDashboardStore.test.ts`

- [ ] **Step 1: Write failing store tests**

Create tests that exercise empty-load, add, update, remove, validation, and corrupted JSON recovery:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DynatraceDashboardStore } from './DynatraceDashboardStore';

describe('DynatraceDashboardStore', () => {
  let dir: string;
  let store: DynatraceDashboardStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'relay-dynatrace-'));
    store = new DynatraceDashboardStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads an empty list when the file does not exist', () => {
    expect(store.list()).toEqual([]);
  });

  it('adds a validated dashboard and persists schema version one', () => {
    const saved = store.add({
      name: 'NOC Overview',
      url: 'https://abc12345.live.dynatrace.com/ui/apps/dynatrace.dashboards/dashboard',
    });

    expect(saved.name).toBe('NOC Overview');
    expect(saved.id).toMatch(/^dt_/);
    expect(store.list()).toHaveLength(1);

    const raw = JSON.parse(readFileSync(join(dir, 'dynatrace-dashboards.json'), 'utf8'));
    expect(raw).toMatchObject({ schemaVersion: 1 });
    expect(raw.dashboards[0].url).toBe(saved.url);
  });

  it('updates a dashboard name and URL', () => {
    const saved = store.add({ name: 'Old', url: 'https://abc.live.dynatrace.com/dashboard' });
    const updated = store.update(saved.id, {
      name: 'New',
      url: 'https://apps.dynatrace.com/dashboard/new',
    });

    expect(updated?.name).toBe('New');
    expect(updated?.url).toBe('https://apps.dynatrace.com/dashboard/new');
  });

  it('removes a dashboard by id', () => {
    const saved = store.add({ name: 'Delete me', url: 'https://abc.live.dynatrace.com/dashboard' });
    expect(store.remove(saved.id)).toBe(true);
    expect(store.list()).toEqual([]);
  });

  it('throws a concise error for invalid dashboard URLs', () => {
    expect(() => store.add({ name: 'Bad', url: 'https://example.com' })).toThrow(
      'Enter a Dynatrace URL under dynatrace.com.',
    );
  });

  it('returns an empty list for corrupted JSON without overwriting it during read', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'dynatrace-dashboards.json'), '{ bad json', 'utf8');
    expect(store.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the store test to verify it fails**

Run: `npx vitest run src/main/dynatrace/DynatraceDashboardStore.test.ts`

Expected: FAIL because the store file does not exist.

- [ ] **Step 3: Implement the store**

Create `DynatraceDashboardStore` with this public API:

```ts
export class DynatraceDashboardStore {
  constructor(dataDir: string);
  list(): DynatraceDashboard[];
  add(input: DynatraceDashboardInput): DynatraceDashboard;
  update(id: string, input: DynatraceDashboardInput): DynatraceDashboard | null;
  remove(id: string): boolean;
  setBounds(id: string, bounds: DynatraceDashboardBounds): DynatraceDashboard | null;
}
```

Implementation requirements:

- Store file path: `join(dataDir, 'dynatrace-dashboards.json')`.
- Stored shape: `{ schemaVersion: 1, dashboards: DynatraceDashboard[] }`.
- Generate ids with `crypto.randomUUID()` and prefix them as `dt_${uuid}`.
- Trim names; fallback empty names to `Dynatrace Dashboard`.
- Validate URLs with `getDynatraceStartUrlError`.
- Write atomically with `writeFileSync(tmpPath)` then `renameSync(tmpPath, filePath)`.
- Use `mkdirSync(dataDir, { recursive: true })` before writes.
- On read parse failure, log through `loggers.main.warn` and return `[]`.

- [ ] **Step 4: Run the store test to verify it passes**

Run: `npx vitest run src/main/dynatrace/DynatraceDashboardStore.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/dynatrace/DynatraceDashboardStore.ts src/main/dynatrace/DynatraceDashboardStore.test.ts
git commit -m "feat: store Dynatrace dashboards locally"
```

---

### Task 3: Main-Process Dynatrace Window Manager

**Files:**
- Create: `src/main/dynatrace/DynatraceWindowManager.ts`
- Create: `src/main/dynatrace/DynatraceWindowManager.test.ts`

- [ ] **Step 1: Write failing manager tests**

Cover these behaviors in `DynatraceWindowManager.test.ts`:

```ts
import { BrowserWindow, session, shell } from 'electron';
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
    BrowserWindow: vi.fn(() => mockWindow),
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
```

- [ ] **Step 2: Run the manager test to verify it fails**

Run: `npx vitest run src/main/dynatrace/DynatraceWindowManager.test.ts`

Expected: FAIL because `DynatraceWindowManager` does not exist.

- [ ] **Step 3: Implement the manager**

Public API:

```ts
export class DynatraceWindowManager {
  constructor(options: { store: DynatraceDashboardStore });
  listDashboards(): DynatraceDashboardState[];
  addDashboard(input: DynatraceDashboardInput): DynatraceDashboardState;
  updateDashboard(id: string, input: DynatraceDashboardInput): DynatraceDashboardState | null;
  removeDashboard(id: string): boolean;
  openDashboard(id: string): Promise<boolean>;
  clearSession(): Promise<boolean>;
  onStateChange(listener: (dashboards: DynatraceDashboardState[]) => void): () => void;
}
```

Implementation requirements:

- Maintain `Map<string, BrowserWindow>` for open windows.
- Maintain `Map<string, DynatraceRuntimeState>` plus optional `lastUrl` and `error`.
- Use `session.fromPartition('persist:relay-dynatrace')`.
- Create `BrowserWindow` with the preferences from the design spec and no preload.
- Restore saved bounds when present; otherwise use `width: 1440`, `height: 900`, `backgroundColor: '#060608'`.
- On `will-navigate`, allow `classifyDynatraceNavigation(url) !== 'blocked'`, otherwise `event.preventDefault()` and set state `blocked`.
- On `did-navigate` and `did-navigate-in-page`, set state to `authenticating` for Microsoft auth or Dynatrace auth URLs; set state to `live` for other Dynatrace URLs.
- On `did-fail-load` for the main frame, set state `load-failed`.
- On `closed`, save latest bounds through the store, remove the window from the map, and set state `closed`.
- In `setWindowOpenHandler`, allow Dynatrace/Microsoft URLs in the same window only if Electron supports `action: 'allow'` safely for the request; otherwise deny unknown URLs and call `shell.openExternal(url)` only for explicit user-triggered external actions in a later UI.
- Broadcast state changes only through `onStateChange`; IPC broadcasting is added in Task 4.

- [ ] **Step 4: Run the manager test to verify it passes**

Run: `npx vitest run src/main/dynatrace/DynatraceWindowManager.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/dynatrace/DynatraceWindowManager.ts src/main/dynatrace/DynatraceWindowManager.test.ts
git commit -m "feat: manage Dynatrace popout windows"
```

---

### Task 4: IPC And Preload Bridge

**Files:**
- Create: `src/main/handlers/dynatraceHandlers.ts`
- Create: `src/main/handlers/dynatraceHandlers.test.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/main/app/appState.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write failing IPC tests**

Create `src/main/handlers/dynatraceHandlers.test.ts` to register handlers and assert:

```ts
import { ipcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupDynatraceHandlers } from './dynatraceHandlers';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../utils/trustedSender', () => ({
  assertTrustedIpcSender: () => true,
}));

describe('setupDynatraceHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const manager = {
    listDashboards: vi.fn(() => []),
    addDashboard: vi.fn(),
    updateDashboard: vi.fn(),
    removeDashboard: vi.fn(),
    openDashboard: vi.fn(),
    clearSession: vi.fn(),
    onStateChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(handlers)) delete handlers[key];
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler as (...args: unknown[]) => unknown;
      return ipcMain;
    });
    setupDynatraceHandlers(manager as never);
  });

  it('registers dashboard list and mutation handlers', () => {
    expect(handlers[IPC_CHANNELS.DYNATRACE_LIST_DASHBOARDS]).toBeTypeOf('function');
    expect(handlers[IPC_CHANNELS.DYNATRACE_ADD_DASHBOARD]).toBeTypeOf('function');
    expect(handlers[IPC_CHANNELS.DYNATRACE_OPEN_DASHBOARD]).toBeTypeOf('function');
    expect(handlers[IPC_CHANNELS.DYNATRACE_CLEAR_SESSION]).toBeTypeOf('function');
  });

  it('returns dashboard state from the manager', async () => {
    await handlers[IPC_CHANNELS.DYNATRACE_LIST_DASHBOARDS]({});
    expect(manager.listDashboards).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run IPC tests to verify they fail**

Run: `npx vitest run src/main/handlers/dynatraceHandlers.test.ts`

Expected: FAIL because the handler and channel constants do not exist.

- [ ] **Step 3: Extend shared IPC types**

Add to `BridgeAPI` in `src/shared/ipc.ts`:

```ts
  // Dynatrace dashboards
  listDynatraceDashboards: () => Promise<DynatraceDashboardState[]>;
  addDynatraceDashboard: (input: DynatraceDashboardInput) => Promise<IpcResult<DynatraceDashboardState>>;
  updateDynatraceDashboard: (
    id: string,
    input: DynatraceDashboardInput,
  ) => Promise<IpcResult<DynatraceDashboardState>>;
  removeDynatraceDashboard: (id: string) => Promise<IpcResult>;
  openDynatraceDashboard: (id: string) => Promise<boolean>;
  clearDynatraceSession: () => Promise<IpcResult>;
  onDynatraceDashboardsChanged: (callback: (dashboards: DynatraceDashboardState[]) => void) => () => void;
```

Import the Dynatrace types from `./dynatrace`.

Add to `IPC_CHANNELS`:

```ts
  DYNATRACE_LIST_DASHBOARDS: 'dynatrace:listDashboards',
  DYNATRACE_ADD_DASHBOARD: 'dynatrace:addDashboard',
  DYNATRACE_UPDATE_DASHBOARD: 'dynatrace:updateDashboard',
  DYNATRACE_REMOVE_DASHBOARD: 'dynatrace:removeDashboard',
  DYNATRACE_OPEN_DASHBOARD: 'dynatrace:openDashboard',
  DYNATRACE_CLEAR_SESSION: 'dynatrace:clearSession',
  DYNATRACE_DASHBOARDS_CHANGED: 'dynatrace:dashboardsChanged',
```

- [ ] **Step 4: Implement handlers and preload**

In `src/main/handlers/dynatraceHandlers.ts`, use `assertTrustedIpcSender` for every handler and return `IpcResult` objects for mutations. On manager state changes, call `broadcastToAllWindows(IPC_CHANNELS.DYNATRACE_DASHBOARDS_CHANGED, dashboards)`.

In `src/preload/index.ts`, wire each method with `ipcRenderer.invoke` and wire `onDynatraceDashboardsChanged` with `ipcRenderer.on` plus cleanup via `removeListener`.

In `src/main/index.ts`, after `setAppConfig(new AppConfig(configDataDir))`, create:

```ts
const dynatraceStore = new DynatraceDashboardStore(configDataDir);
setDynatraceWindowManager(new DynatraceWindowManager({ store: dynatraceStore }));
```

Extend `setupIpc` and `setupIpcHandlers` to accept `getDynatraceWindowManager`.

- [ ] **Step 5: Run IPC tests and typecheck**

Run:

```bash
npx vitest run src/main/handlers/dynatraceHandlers.test.ts
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/handlers/dynatraceHandlers.ts src/main/handlers/dynatraceHandlers.test.ts src/main/ipcHandlers.ts src/main/app/appState.ts src/main/index.ts
git commit -m "feat: expose Dynatrace dashboard IPC"
```

---

### Task 5: Renderer Dynatrace Hook

**Files:**
- Create: `src/renderer/src/hooks/useDynatraceDashboards.ts`
- Create: `src/renderer/src/hooks/__tests__/useDynatraceDashboards.test.ts`

- [ ] **Step 1: Write failing hook tests**

Test loading, realtime updates, open calls, mutation refresh, and one-shot signed-out toast:

```ts
import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDynatraceDashboards } from '../useDynatraceDashboards';
import type { DynatraceDashboardState } from '@shared/dynatrace';

const live: DynatraceDashboardState = {
  id: 'dt_1',
  name: 'NOC',
  url: 'https://abc.live.dynatrace.com/dashboard',
  state: 'live',
};

const auth: DynatraceDashboardState = { ...live, state: 'authenticating' };

describe('useDynatraceDashboards', () => {
  let listener: ((dashboards: DynatraceDashboardState[]) => void) | null = null;
  const showToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    listener = null;
    globalThis.api = {
      ...globalThis.api,
      listDynatraceDashboards: vi.fn().mockResolvedValue([live]),
      openDynatraceDashboard: vi.fn().mockResolvedValue(true),
      addDynatraceDashboard: vi.fn().mockResolvedValue({ success: true, data: live }),
      updateDynatraceDashboard: vi.fn().mockResolvedValue({ success: true, data: live }),
      removeDynatraceDashboard: vi.fn().mockResolvedValue({ success: true }),
      clearDynatraceSession: vi.fn().mockResolvedValue({ success: true }),
      onDynatraceDashboardsChanged: vi.fn((callback) => {
        listener = callback;
        return vi.fn();
      }),
    };
  });

  it('loads dashboards from the bridge API', async () => {
    const { result } = renderHook(() => useDynatraceDashboards(showToast));
    await waitFor(() => expect(result.current.dashboards).toEqual([live]));
  });

  it('shows one toast when a dashboard transitions from live to authenticating', async () => {
    renderHook(() => useDynatraceDashboards(showToast));
    await waitFor(() => expect(listener).toBeTypeOf('function'));

    act(() => listener?.([live]));
    act(() => listener?.([auth]));
    act(() => listener?.([auth]));

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('Dynatrace dashboard signed out', 'warning');
  });

  it('opens dashboards through the bridge API', async () => {
    const { result } = renderHook(() => useDynatraceDashboards(showToast));
    await act(async () => result.current.openDashboard('dt_1'));
    expect(globalThis.api.openDynatraceDashboard).toHaveBeenCalledWith('dt_1');
  });
});
```

- [ ] **Step 2: Run hook tests to verify they fail**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useDynatraceDashboards.test.ts --config vitest.renderer.config.ts`

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the hook**

Expose:

```ts
export function useDynatraceDashboards(showToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void): {
  dashboards: DynatraceDashboardState[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addDashboard: (input: DynatraceDashboardInput) => Promise<boolean>;
  updateDashboard: (id: string, input: DynatraceDashboardInput) => Promise<boolean>;
  removeDashboard: (id: string) => Promise<boolean>;
  openDashboard: (id: string) => Promise<boolean>;
  clearSession: () => Promise<boolean>;
}
```

Implementation requirements:

- Load once on mount.
- Subscribe to `onDynatraceDashboardsChanged`.
- Keep previous state by id in a `useRef`.
- Emit one warning toast only when a dashboard changes from `live` to `authenticating`.
- Do not toast again while it remains `authenticating`.
- Reset the transition guard when that dashboard returns to `live`, `closed`, `blocked`, or `load-failed`.
- Show error toasts for failed add/update/remove/clear operations.

- [ ] **Step 4: Run hook tests to verify they pass**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useDynatraceDashboards.test.ts --config vitest.renderer.config.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useDynatraceDashboards.ts src/renderer/src/hooks/__tests__/useDynatraceDashboards.test.ts
git commit -m "feat: load Dynatrace dashboards in renderer"
```

---

### Task 6: Settings Management UI

**Files:**
- Modify: `src/renderer/src/components/SettingsModal.tsx`
- Modify: `src/renderer/src/components/__tests__/SettingsModal.test.tsx`
- Modify: `src/renderer/src/styles/components.css`

- [ ] **Step 1: Write failing Settings tests**

Add tests that pass `dynatraceDashboards` and callbacks into `SettingsModal`:

```tsx
it('shows Dynatrace dashboard settings and opens a saved dashboard', async () => {
  const onOpenDynatraceDashboard = vi.fn();
  render(
    <SettingsModal
      {...defaultProps}
      dynatrace={{
        dashboards: [{ id: 'dt_1', name: 'NOC', url: 'https://abc.live.dynatrace.com/dashboard', state: 'closed' }],
        addDashboard: vi.fn(),
        updateDashboard: vi.fn(),
        removeDashboard: vi.fn(),
        openDashboard: onOpenDynatraceDashboard,
        clearSession: vi.fn(),
      }}
    />,
  );

  expect(screen.getByText('Dynatrace Dashboards')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open NOC' }));
  expect(onOpenDynatraceDashboard).toHaveBeenCalledWith('dt_1');
});

it('adds a Dynatrace dashboard from Settings', async () => {
  const addDashboard = vi.fn().mockResolvedValue(true);
  render(
    <SettingsModal
      {...defaultProps}
      dynatrace={{
        dashboards: [],
        addDashboard,
        updateDashboard: vi.fn(),
        removeDashboard: vi.fn(),
        openDashboard: vi.fn(),
        clearSession: vi.fn(),
      }}
    />,
  );

  fireEvent.change(screen.getByLabelText('Dashboard name'), { target: { value: 'NOC' } });
  fireEvent.change(screen.getByLabelText('Dashboard URL'), {
    target: { value: 'https://abc.live.dynatrace.com/dashboard' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add dashboard' }));

  await waitFor(() =>
    expect(addDashboard).toHaveBeenCalledWith({
      name: 'NOC',
      url: 'https://abc.live.dynatrace.com/dashboard',
    }),
  );
});
```

- [ ] **Step 2: Run Settings tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/__tests__/SettingsModal.test.tsx --config vitest.renderer.config.ts`

Expected: FAIL because `SettingsModal` has no Dynatrace props or UI.

- [ ] **Step 3: Implement Settings UI**

Add an optional `dynatrace` prop to `SettingsModal`:

```ts
type DynatraceSettingsProps = {
  dashboards: DynatraceDashboardState[];
  addDashboard: (input: DynatraceDashboardInput) => Promise<boolean>;
  updateDashboard: (id: string, input: DynatraceDashboardInput) => Promise<boolean>;
  removeDashboard: (id: string) => Promise<boolean>;
  openDashboard: (id: string) => Promise<boolean>;
  clearSession: () => Promise<boolean>;
};
```

Render a new settings section after PocketBase:

- Heading: `Dynatrace Dashboards`.
- Existing dashboards as compact rows with name, state, URL, `Open`, `Edit`, and `Remove`.
- Add form with labels `Dashboard name` and `Dashboard URL`.
- Inline validation using `getDynatraceStartUrlError`.
- `Clear Dynatrace session` button.
- Use existing `settings-section`, `settings-data-path`, `settings-copy-row`, and `settings-inline-action` classes where possible.

- [ ] **Step 4: Run Settings tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/__tests__/SettingsModal.test.tsx --config vitest.renderer.config.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SettingsModal.tsx src/renderer/src/components/__tests__/SettingsModal.test.tsx src/renderer/src/styles/components.css
git commit -m "feat: configure Dynatrace dashboards in settings"
```

---

### Task 7: Sidebar Dashboard Launcher

**Files:**
- Create: `src/renderer/src/components/sidebar/SidebarDashboards.tsx`
- Create: `src/renderer/src/components/__tests__/sidebar/SidebarDashboards.test.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/components/__tests__/Sidebar.test.tsx`
- Modify: `src/renderer/src/components/sidebar/SidebarIcons.tsx`
- Modify: `src/renderer/src/components/sidebar/sidebar.css`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/__tests__/App.test.tsx`

- [ ] **Step 1: Write failing sidebar launcher tests**

Create `SidebarDashboards.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarDashboards } from '../../sidebar/SidebarDashboards';

const dashboard = {
  id: 'dt_1',
  name: 'NOC',
  url: 'https://abc.live.dynatrace.com/dashboard',
  state: 'live' as const,
};

describe('SidebarDashboards', () => {
  it('renders nothing when there are no dashboards', () => {
    const { container } = render(<SidebarDashboards dashboards={[]} onOpenDashboard={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('opens the only dashboard directly', () => {
    const onOpenDashboard = vi.fn();
    render(<SidebarDashboards dashboards={[dashboard]} onOpenDashboard={onOpenDashboard} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Dynatrace dashboard NOC' }));
    expect(onOpenDashboard).toHaveBeenCalledWith('dt_1');
  });

  it('shows a popover for multiple dashboards', () => {
    render(
      <SidebarDashboards
        dashboards={[dashboard, { ...dashboard, id: 'dt_2', name: 'Infra', state: 'authenticating' }]}
        onOpenDashboard={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Dynatrace dashboards' }));
    expect(screen.getByText('NOC')).toBeInTheDocument();
    expect(screen.getByText('Infra')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Signed out')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run sidebar tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/__tests__/sidebar/SidebarDashboards.test.tsx --config vitest.renderer.config.ts`

Expected: FAIL because `SidebarDashboards` does not exist.

- [ ] **Step 3: Implement launcher and integrate it**

Implement `SidebarDashboards`:

- If `dashboards.length === 0`, return `null`.
- If one dashboard, render a `sidebar-button sidebar-dashboards` button with label `Dashboards`.
- If multiple dashboards, render the same button and a fixed/portal-safe popover aligned to the sidebar footer.
- State labels:
  - `live` -> `Live`
  - `authenticating` -> `Signed out`
  - `blocked` -> `Blocked`
  - `load-failed` -> `Load failed`
  - `closed` -> `Closed`
- Reuse existing sidebar sizing and hover rules.

Update `Sidebar` props:

```ts
dynatraceDashboards?: DynatraceDashboardState[];
onOpenDynatraceDashboard?: (id: string) => void;
```

Place the launcher inside `.sidebar-footer` after `SidebarClientStatus` and before `Settings`.

Update `App.tsx`:

- Call `useDynatraceDashboards(showToast)` once in `MainApp`.
- Pass the returned dashboard list and `openDashboard` into `Sidebar`.
- Pass the full Dynatrace action bundle into `SettingsModal`.

- [ ] **Step 4: Run sidebar and App tests**

Run:

```bash
npx vitest run src/renderer/src/components/__tests__/sidebar/SidebarDashboards.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/__tests__/App.test.tsx --config vitest.renderer.config.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/sidebar/SidebarDashboards.tsx src/renderer/src/components/__tests__/sidebar/SidebarDashboards.test.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/sidebar/SidebarIcons.tsx src/renderer/src/components/sidebar/sidebar.css src/renderer/src/App.tsx src/renderer/src/__tests__/App.test.tsx
git commit -m "feat: launch Dynatrace dashboards from sidebar"
```

---

### Task 8: Full Verification And Manual QA

**Files:**
- Modify tests only if failures expose missing coverage from Tasks 1-7.

- [ ] **Step 1: Run focused Dynatrace test set**

Run:

```bash
npx vitest run src/shared/dynatrace.test.ts src/main/dynatrace/DynatraceDashboardStore.test.ts src/main/dynatrace/DynatraceWindowManager.test.ts src/main/handlers/dynatraceHandlers.test.ts
npx vitest run src/renderer/src/hooks/__tests__/useDynatraceDashboards.test.ts src/renderer/src/components/__tests__/SettingsModal.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/sidebar/SidebarDashboards.test.tsx src/renderer/src/__tests__/App.test.tsx --config vitest.renderer.config.ts
```

Expected: PASS.

- [ ] **Step 2: Run project-wide verification**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Expected: every command exits `0`.

- [ ] **Step 3: Run Electron smoke test**

Run: `npm run test:electron`

Expected: PASS, or document any unrelated existing Electron test instability with the failing test name and error text.

- [ ] **Step 4: Manual Dynatrace verification**

In the live Electron app:

- Open Settings.
- Add a real `https://*.dynatrace.com` dashboard URL.
- Confirm the sidebar `Dashboards` button appears above `Settings`.
- Click the sidebar launcher and confirm the Dynatrace popout opens.
- Sign in through Microsoft SSO.
- Leave the popout unfocused and confirm Dynatrace's own one-minute refresh continues.
- Close and reopen Relay and confirm the Dynatrace session remains signed in.
- Sign out or wait for the Dynatrace sign-in page and confirm Relay shows exactly one `Dynatrace dashboard signed out` toast.

- [ ] **Step 5: Final commit if verification required changes**

If Task 8 changed files:

```bash
git status --short
git add src/shared/dynatrace.ts src/shared/dynatrace.test.ts src/main/dynatrace/DynatraceDashboardStore.ts src/main/dynatrace/DynatraceDashboardStore.test.ts src/main/dynatrace/DynatraceWindowManager.ts src/main/dynatrace/DynatraceWindowManager.test.ts src/main/handlers/dynatraceHandlers.ts src/main/handlers/dynatraceHandlers.test.ts src/shared/ipc.ts src/preload/index.ts src/main/ipcHandlers.ts src/main/app/appState.ts src/main/index.ts src/renderer/src/hooks/useDynatraceDashboards.ts src/renderer/src/hooks/__tests__/useDynatraceDashboards.test.ts src/renderer/src/components/SettingsModal.tsx src/renderer/src/components/__tests__/SettingsModal.test.tsx src/renderer/src/styles/components.css src/renderer/src/components/sidebar/SidebarDashboards.tsx src/renderer/src/components/__tests__/sidebar/SidebarDashboards.test.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/sidebar/SidebarIcons.tsx src/renderer/src/components/sidebar/sidebar.css src/renderer/src/App.tsx src/renderer/src/__tests__/App.test.tsx
git commit -m "test: verify Dynatrace dashboard popouts"
```

If Task 8 changed no files, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Generic public app with no hardcoded tenant URLs: Task 1 validates hosts, Task 2 stores user-provided URLs, Task 4 IPC carries generic dashboard records.
- Dedicated Electron popouts without iframe/webview/injection: Task 3 creates separate `BrowserWindow` instances with no preload.
- Local dashboard settings: Task 2 stores JSON under fixed app config data dir; Task 6 exposes add/edit/remove.
- Sidebar placement: Task 7 places `Dashboards` between Clients and Settings and hides it with zero dashboards.
- Microsoft SSO support: Task 1 allows Microsoft auth navigation; Task 3 enforces navigation policy.
- One-minute refresh reliability: Task 3 sets `backgroundThrottling: false`; Task 8 manually verifies.
- Auth expiry detection and one toast: Task 3 emits `authenticating`; Task 5 turns live-to-auth transition into one warning toast.
- Security policy and blocked navigation: Tasks 1 and 3 enforce protocol/host policy.
- Session clearing: Tasks 3, 4, and 6 implement and expose clearing without deleting dashboards.

Placeholder scan:

- No red-flag fill-in markers, incomplete task labels, or unnamed files remain in this plan.

Type consistency:

- Shared types use `DynatraceDashboardState`, `DynatraceDashboardInput`, and `DynatraceRuntimeState` throughout.
- IPC names use the `DYNATRACE_*` prefix throughout shared, preload, handler, hook, and UI tasks.
