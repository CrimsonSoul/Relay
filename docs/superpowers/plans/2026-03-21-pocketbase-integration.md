# PocketBase Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Relay's JSON file storage with an embedded PocketBase sidecar, enabling multi-user server/client access, offline fallback, and realtime sync.

**Architecture:** PocketBase runs as a child process spawned by Electron main. Renderer talks directly to PocketBase REST API via the official JS SDK. Clients cache data locally in SQLite (better-sqlite3) for offline fallback, with a pending-changes queue that syncs on reconnection using last-write-wins with conflict logging.

**Tech Stack:** PocketBase (Go binary), pocketbase JS SDK, better-sqlite3 (offline cache), exceljs (Excel import/export), papaparse (CSV parsing in renderer), Zod (validation)

**Spec:** `docs/superpowers/specs/2026-03-21-pocketbase-integration-design.md`

### Important Implementation Notes

1. **Logger pattern:** The codebase uses `import { loggers } from '../logger'` with pre-configured child loggers. New modules should add children to the `loggers` export in `src/main/logger.ts` (e.g., `pocketbase: logger.createChild('PocketBase')`). Do NOT use `createLogger()` — that function does not exist.
2. **PocketBase migration syntax:** Verify the exact migration JS API for PocketBase v0.25.9 before writing migration files. The field definition format changed significantly in v0.23+. Consult the official PocketBase v0.25.x migration docs.
3. **Node.js modules in renderer:** The renderer runs in a browser context with context isolation. Do NOT import Node.js-only packages (`csv-parse`, `fs`, `path`) in renderer code. Use browser-compatible alternatives: `papaparse` for CSV parsing, `exceljs` (which has browser support via ArrayBuffer). File I/O (save dialog, read file) must go through IPC to the main process.
4. **Auth user creation:** On first server-mode startup, after PocketBase is healthy, the main process must create the `relay_user` auth record via PocketBase's Admin API if it does not already exist. This is NOT handled by the migration files — it requires the configured passphrase from `config.json`.
5. **`isStatic` vs `static`:** The `oncall_layout` collection uses `isStatic` instead of `static` to avoid the JavaScript reserved word. The spec says `static` but the implementation deliberately renames it.
6. **CSP:** The BrowserWindow CSP `connect-src` must be set dynamically based on config mode before the renderer loads. Server mode: `connect-src 'self' http://127.0.0.1:<port>`. Client mode: `connect-src 'self' <serverUrl>`.

---

## File Structure

### New Files — Main Process

| File                                            | Responsibility                                                |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `scripts/download-pocketbase.ts`                | Downloads correct PocketBase binary per platform+arch         |
| `resources/pb_migrations/`                      | PocketBase schema migration JSON files (committed)            |
| `src/main/pocketbase/PocketBaseProcess.ts`      | Spawn, health check, shutdown, crash recovery                 |
| `src/main/pocketbase/PocketBaseProcess.test.ts` | Unit tests for process lifecycle                              |
| `src/main/config/AppConfig.ts`                  | Read/write `data/config.json` (mode, port, secret, serverUrl) |
| `src/main/config/AppConfig.test.ts`             | Unit tests for config management                              |
| `src/main/cache/OfflineCache.ts`                | Local SQLite mirror of PocketBase data (better-sqlite3)       |
| `src/main/cache/PendingChanges.ts`              | Queue offline writes for later sync                           |
| `src/main/cache/SyncManager.ts`                 | Reconnection sync, conflict detection, conflict logging       |
| `src/main/cache/OfflineCache.test.ts`           | Tests for cache read/write                                    |
| `src/main/cache/PendingChanges.test.ts`         | Tests for pending changes queue                               |
| `src/main/cache/SyncManager.test.ts`            | Tests for sync and conflict resolution                        |
| `src/main/migration/JsonMigrator.ts`            | One-time JSON → PocketBase migration                          |
| `src/main/migration/JsonMigrator.test.ts`       | Tests for migration logic                                     |
| `src/main/handlers/cacheHandlers.ts`            | IPC handlers for offline cache reads + pending changes        |
| `src/main/handlers/setupHandlers.ts`            | IPC handlers for first-launch setup flow                      |

### New Files — Renderer

| File                                                | Responsibility                                              |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `src/renderer/src/services/pocketbase.ts`           | SDK instance, init, auth, connection state machine          |
| `src/renderer/src/services/contactService.ts`       | Contacts CRUD via PocketBase SDK                            |
| `src/renderer/src/services/serverService.ts`        | Servers CRUD                                                |
| `src/renderer/src/services/oncallService.ts`        | On-call CRUD + team operations                              |
| `src/renderer/src/services/bridgeGroupService.ts`   | Bridge groups CRUD                                          |
| `src/renderer/src/services/bridgeHistoryService.ts` | Bridge history CRUD                                         |
| `src/renderer/src/services/alertHistoryService.ts`  | Alert history CRUD + pin/label                              |
| `src/renderer/src/services/notesService.ts`         | Notes CRUD                                                  |
| `src/renderer/src/services/savedLocationService.ts` | Saved locations CRUD                                        |
| `src/renderer/src/services/oncallLayoutService.ts`  | On-call layout CRUD                                         |
| `src/renderer/src/services/importExportService.ts`  | JSON/CSV/Excel import and export                            |
| `src/renderer/src/hooks/usePocketBase.ts`           | Connection status, reconnect logic provider                 |
| `src/renderer/src/hooks/useCollection.ts`           | Generic hook: fetch + realtime subscribe + offline fallback |
| `src/renderer/src/components/SetupScreen.tsx`       | First-launch mode/config selection UI                       |
| `src/renderer/src/components/ConnectionStatus.tsx`  | Online/offline/reconnecting indicator                       |

### Modified Files

| File                                                      | Changes                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `package.json`                                            | Add pocketbase, better-sqlite3, exceljs deps; add download-pocketbase script |
| `electron-builder.yml`                                    | Add PocketBase binary as extraResources; enable npmRebuild                   |
| `.gitignore`                                              | Add dev-data/, resources/pocketbase/                                         |
| `src/main/index.ts`                                       | Replace FileManager init with PocketBase process lifecycle                   |
| `src/main/app/appState.ts`                                | Replace fileManager state with PocketBase process + config state             |
| `src/main/ipcHandlers.ts`                                 | Remove data handler setup, add cache + setup handlers                        |
| `src/preload/index.ts`                                    | Remove data API methods, add cache + setup methods                           |
| `src/shared/ipc.ts`                                       | Remove data channel constants, add cache + setup channels                    |
| `src/renderer/src/App.tsx`                                | Wrap with PocketBase provider, remove IPC data flow                          |
| All renderer components using `globalThis.api.*` for data | Replace with service/hook calls                                              |

### Removed Files (Final Cleanup)

| File/Directory                            | Reason                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `src/main/operations/` (entire directory) | Replaced by PocketBase                                                    |
| `src/main/handlers/dataHandlers.ts`       | Data IPC handlers no longer needed                                        |
| `src/main/handlers/dataRecordHandlers.ts` | Record IPC handlers no longer needed                                      |
| `src/main/handlers/featureHandlers.ts`    | Feature IPC handlers (groups, history, notes, locations) no longer needed |
| `src/main/handlers/fileHandlers.ts`       | CSV import handler no longer needed                                       |

---

## Phase 1: Foundation

### Task 1: Add Dependencies and Build Configuration

**Files:**

- Modify: `package.json`
- Modify: `electron-builder.yml`
- Modify: `.gitignore`
- Create: `scripts/download-pocketbase.ts`

- [ ] **Step 1: Install new dependencies**

Run:

```bash
cd /Users/ryan/Apps/Relay
npm install pocketbase better-sqlite3 exceljs papaparse
npm install -D @types/better-sqlite3 @types/papaparse
```

- [ ] **Step 2: Create PocketBase download script**

Create `scripts/download-pocketbase.ts`:

```typescript
import { execSync } from 'child_process';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const PB_VERSION = '0.25.9';
const RESOURCES_DIR = join(__dirname, '..', 'resources', 'pocketbase');

function getPlatformArch(): { os: string; arch: string; ext: string } {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    return { os: 'windows', arch: arch === 'arm64' ? 'arm64' : 'amd64', ext: '.exe' };
  }
  if (platform === 'darwin') {
    return { os: 'darwin', arch: arch === 'arm64' ? 'arm64' : 'amd64', ext: '' };
  }
  return { os: 'linux', arch: arch === 'arm64' ? 'arm64' : 'amd64', ext: '' };
}

async function download(): Promise<void> {
  const { os, arch, ext } = getPlatformArch();
  const binaryName = `pocketbase${ext}`;
  const outputPath = join(RESOURCES_DIR, binaryName);

  if (existsSync(outputPath)) {
    console.log(`PocketBase binary already exists at ${outputPath}`);
    return;
  }

  mkdirSync(RESOURCES_DIR, { recursive: true });

  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_${os}_${arch}.zip`;
  console.log(`Downloading PocketBase ${PB_VERSION} for ${os}/${arch}...`);
  console.log(`URL: ${url}`);

  execSync(`curl -L "${url}" -o "${join(RESOURCES_DIR, 'pb.zip')}"`);
  execSync(`unzip -o "${join(RESOURCES_DIR, 'pb.zip')}" -d "${RESOURCES_DIR}"`);
  unlinkSync(join(RESOURCES_DIR, 'pb.zip'));

  if (ext === '') {
    execSync(`chmod +x "${outputPath}"`);
  }

  console.log(`PocketBase binary saved to ${outputPath}`);
}

download().catch((err) => {
  console.error('Failed to download PocketBase:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Add download script to package.json**

Add to `scripts` section of `package.json`:

```json
"download:pocketbase": "npx tsx scripts/download-pocketbase.ts",
"postinstall": "npx tsx scripts/download-pocketbase.ts"
```

- [ ] **Step 4: Update electron-builder.yml**

Change `npmRebuild` from `false` to `true` (required for `better-sqlite3` native addon). APPEND a second entry to the existing `extraResources` list — do NOT remove the existing `from: resources` / `to: data` entry:

```yaml
npmRebuild: true
extraResources:
  - from: resources
    to: data
  - from: 'resources/pocketbase/'
    to: 'pocketbase/'
    filter:
      - '**/*'
```

- [ ] **Step 5: Update .gitignore**

Add:

```
# PocketBase
resources/pocketbase/
dev-data/
```

- [ ] **Step 6: Download PocketBase binary and verify**

Run:

```bash
npm run download:pocketbase
ls -la resources/pocketbase/
```

Expected: PocketBase binary exists in resources/pocketbase/

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json electron-builder.yml .gitignore scripts/download-pocketbase.ts
git commit -m "feat: add PocketBase dependencies and download script"
```

---

### Task 2: App Configuration System

**Files:**

- Create: `src/main/config/AppConfig.ts`
- Create: `src/main/config/AppConfig.test.ts`

- [ ] **Step 1: Write failing tests for AppConfig**

Create `src/main/config/AppConfig.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AppConfig, type RelayConfig } from './AppConfig';

describe('AppConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'relay-config-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when config.json does not exist', () => {
    const config = new AppConfig(tempDir);
    expect(config.load()).toBeNull();
  });

  it('writes and reads server config', () => {
    const config = new AppConfig(tempDir);
    const serverConfig: RelayConfig = {
      mode: 'server',
      port: 8090,
      secret: 'test-secret',
    };
    config.save(serverConfig);
    const loaded = config.load();
    expect(loaded).toEqual(serverConfig);
  });

  it('writes and reads client config', () => {
    const config = new AppConfig(tempDir);
    const clientConfig: RelayConfig = {
      mode: 'client',
      serverUrl: 'http://192.168.1.50:8090',
      secret: 'test-secret',
    };
    config.save(clientConfig);
    const loaded = config.load();
    expect(loaded).toEqual(clientConfig);
  });

  it('creates data directory if it does not exist', () => {
    const nestedDir = join(tempDir, 'nested', 'data');
    const config = new AppConfig(nestedDir);
    config.save({ mode: 'server', port: 8090, secret: 's' });
    expect(config.load()).not.toBeNull();
  });

  it('returns isConfigured() correctly', () => {
    const config = new AppConfig(tempDir);
    expect(config.isConfigured()).toBe(false);
    config.save({ mode: 'server', port: 8090, secret: 's' });
    expect(config.isConfigured()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/config/AppConfig.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AppConfig**

Create `src/main/config/AppConfig.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface ServerConfig {
  mode: 'server';
  port: number;
  secret: string;
}

export interface ClientConfig {
  mode: 'client';
  serverUrl: string;
  secret: string;
}

export type RelayConfig = ServerConfig | ClientConfig;

export class AppConfig {
  private configPath: string;

  constructor(private dataDir: string) {
    this.configPath = join(dataDir, 'config.json');
  }

  load(): RelayConfig | null {
    if (!existsSync(this.configPath)) return null;
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      return JSON.parse(raw) as RelayConfig;
    } catch {
      return null;
    }
  }

  save(config: RelayConfig): void {
    mkdirSync(this.dataDir, { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  isConfigured(): boolean {
    return this.load() !== null;
  }

  getDataDir(): string {
    return this.dataDir;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/config/AppConfig.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/config/
git commit -m "feat: add AppConfig for server/client mode configuration"
```

---

### Task 3: PocketBase Process Lifecycle

**Files:**

- Create: `src/main/pocketbase/PocketBaseProcess.ts`
- Create: `src/main/pocketbase/PocketBaseProcess.test.ts`

- [ ] **Step 1: Write failing tests for PocketBaseProcess**

Create `src/main/pocketbase/PocketBaseProcess.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PocketBaseProcess } from './PocketBaseProcess';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('PocketBaseProcess', () => {
  let pbProcess: PocketBaseProcess;

  beforeEach(() => {
    vi.clearAllMocks();
    pbProcess = new PocketBaseProcess({
      binaryPath: '/fake/pocketbase',
      dataDir: '/fake/data/pb_data',
      migrationsDir: '/fake/data/pb_migrations',
      host: '127.0.0.1',
      port: 8090,
    });
  });

  it('constructs with correct config', () => {
    expect(pbProcess.getUrl()).toBe('http://127.0.0.1:8090');
  });

  it('isRunning returns false before start', () => {
    expect(pbProcess.isRunning()).toBe(false);
  });

  it('getUrl returns the correct URL', () => {
    const pb = new PocketBaseProcess({
      binaryPath: '/fake/pb',
      dataDir: '/fake/data',
      migrationsDir: '/fake/migrations',
      host: '0.0.0.0',
      port: 9090,
    });
    expect(pb.getUrl()).toBe('http://0.0.0.0:9090');
  });

  it('builds correct spawn args', () => {
    expect(pbProcess.getSpawnArgs()).toEqual([
      'serve',
      '--http=127.0.0.1:8090',
      '--dir=/fake/data/pb_data',
      '--migrationsDir=/fake/data/pb_migrations',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/pocketbase/PocketBaseProcess.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PocketBaseProcess**

Create `src/main/pocketbase/PocketBaseProcess.ts`:

```typescript
import { spawn, type ChildProcess } from 'child_process';
import { loggers } from '../logger';
// First add to src/main/logger.ts: pocketbase: logger.createChild('PocketBase')
const logger = loggers.pocketbase;

export interface PocketBaseConfig {
  binaryPath: string;
  dataDir: string;
  migrationsDir: string;
  host: string;
  port: number;
}

export class PocketBaseProcess {
  private child: ChildProcess | null = null;
  private config: PocketBaseConfig;
  private restartCount = 0;
  private maxRestarts = 3;
  private onCrashCallback?: (error: string) => void;

  constructor(config: PocketBaseConfig) {
    this.config = config;
  }

  getUrl(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  getLocalUrl(): string {
    return `http://127.0.0.1:${this.config.port}`;
  }

  getSpawnArgs(): string[] {
    return [
      'serve',
      `--http=${this.config.host}:${this.config.port}`,
      `--dir=${this.config.dataDir}`,
      `--migrationsDir=${this.config.migrationsDir}`,
    ];
  }

  isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  onCrash(callback: (error: string) => void): void {
    this.onCrashCallback = callback;
  }

  async start(): Promise<void> {
    const args = this.getSpawnArgs();
    logger.info('Starting PocketBase', { binary: this.config.binaryPath, args });

    this.child = spawn(this.config.binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child.stdout?.on('data', (data: Buffer) => {
      logger.debug('PocketBase stdout', { output: data.toString().trim() });
    });

    this.child.stderr?.on('data', (data: Buffer) => {
      logger.warn('PocketBase stderr', { output: data.toString().trim() });
    });

    this.child.on('exit', (code, signal) => {
      logger.warn('PocketBase exited', { code, signal });
      this.child = null;

      if (code !== 0 && code !== null) {
        this.handleCrash(`PocketBase exited with code ${code}`);
      }
    });

    await this.waitForHealthy();
    this.restartCount = 0;
    logger.info('PocketBase is healthy', { url: this.getUrl() });
  }

  async stop(): Promise<void> {
    if (!this.child) return;

    logger.info('Stopping PocketBase');

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('PocketBase did not exit gracefully, force killing');
        this.forceKill();
        resolve();
      }, 5000);

      this.child!.on('exit', () => {
        clearTimeout(timeout);
        this.child = null;
        resolve();
      });

      this.gracefulKill();
    });
  }

  private gracefulKill(): void {
    if (!this.child?.pid) return;

    if (process.platform === 'win32') {
      // Windows: taskkill sends WM_CLOSE for graceful shutdown
      spawn('taskkill', ['/PID', this.child.pid.toString()]);
    } else {
      this.child.kill('SIGTERM');
    }
  }

  private forceKill(): void {
    if (!this.child?.pid) return;

    if (process.platform === 'win32') {
      spawn('taskkill', ['/F', '/PID', this.child.pid.toString()]);
    } else {
      this.child.kill('SIGKILL');
    }
    this.child = null;
  }

  private async handleCrash(reason: string): Promise<void> {
    this.restartCount++;
    if (this.restartCount <= this.maxRestarts) {
      logger.warn(`Restarting PocketBase (attempt ${this.restartCount}/${this.maxRestarts})`);
      try {
        await this.start();
      } catch (err) {
        logger.error('Failed to restart PocketBase', { error: err });
        this.onCrashCallback?.(`Failed to restart PocketBase after ${this.restartCount} attempts`);
      }
    } else {
      this.onCrashCallback?.(reason);
    }
  }

  private async waitForHealthy(timeoutMs = 10000): Promise<void> {
    const start = Date.now();
    const healthUrl = `${this.getLocalUrl()}/api/health`;

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(healthUrl);
        if (res.ok) return;
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    throw new Error(`PocketBase failed to become healthy within ${timeoutMs}ms`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/pocketbase/PocketBaseProcess.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/pocketbase/
git commit -m "feat: add PocketBase process lifecycle management"
```

---

## Phase 2: Database Schema

### Task 4: PocketBase Schema Migrations

**Files:**

- Create: `resources/pb_migrations/` directory with migration files

PocketBase uses numbered JSON migration files. These define the collections and fields.

- [ ] **Step 1: Create the migrations directory**

```bash
mkdir -p /Users/ryan/Apps/Relay/resources/pb_migrations
```

- [ ] **Step 2: Create initial schema migration**

Create `resources/pb_migrations/1_initial_schema.js`:

```javascript
/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // contacts
    const contacts = new Collection({
      name: 'contacts',
      type: 'base',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'email', type: 'text' },
        { name: 'phone', type: 'text' },
        { name: 'title', type: 'text' },
      ],
    });
    app.save(contacts);

    // servers
    const servers = new Collection({
      name: 'servers',
      type: 'base',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'businessArea', type: 'text' },
        { name: 'lob', type: 'text' },
        { name: 'comment', type: 'text' },
        { name: 'owner', type: 'text' },
        { name: 'contact', type: 'text' },
        { name: 'os', type: 'text' },
      ],
    });
    app.save(servers);

    // oncall
    const oncall = new Collection({
      name: 'oncall',
      type: 'base',
      fields: [
        { name: 'team', type: 'text', required: true },
        { name: 'role', type: 'text' },
        { name: 'name', type: 'text' },
        { name: 'contact', type: 'text' },
        { name: 'timeWindow', type: 'text' },
        { name: 'sortOrder', type: 'number' },
      ],
    });
    app.save(oncall);

    // bridge_groups
    const bridgeGroups = new Collection({
      name: 'bridge_groups',
      type: 'base',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'contacts', type: 'json' },
      ],
    });
    app.save(bridgeGroups);

    // bridge_history
    const bridgeHistory = new Collection({
      name: 'bridge_history',
      type: 'base',
      fields: [
        { name: 'note', type: 'text' },
        { name: 'groups', type: 'json' },
        { name: 'contacts', type: 'json' },
        { name: 'recipientCount', type: 'number' },
      ],
    });
    app.save(bridgeHistory);

    // alert_history
    const alertHistory = new Collection({
      name: 'alert_history',
      type: 'base',
      fields: [
        {
          name: 'severity',
          type: 'select',
          options: { values: ['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED'] },
        },
        { name: 'subject', type: 'text' },
        { name: 'bodyHtml', type: 'text' },
        { name: 'sender', type: 'text' },
        { name: 'recipient', type: 'text' },
        { name: 'pinned', type: 'bool' },
        { name: 'label', type: 'text' },
      ],
    });
    app.save(alertHistory);

    // notes
    const notes = new Collection({
      name: 'notes',
      type: 'base',
      fields: [
        {
          name: 'entityType',
          type: 'select',
          required: true,
          options: { values: ['contact', 'server'] },
        },
        { name: 'entityKey', type: 'text', required: true },
        { name: 'note', type: 'text' },
        { name: 'tags', type: 'json' },
      ],
    });
    app.save(notes);

    // saved_locations
    const savedLocations = new Collection({
      name: 'saved_locations',
      type: 'base',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'lat', type: 'number' },
        { name: 'lon', type: 'number' },
        { name: 'isDefault', type: 'bool' },
      ],
    });
    app.save(savedLocations);

    // oncall_layout
    const oncallLayout = new Collection({
      name: 'oncall_layout',
      type: 'base',
      fields: [
        { name: 'team', type: 'text', required: true },
        { name: 'x', type: 'number' },
        { name: 'y', type: 'number' },
        { name: 'w', type: 'number' },
        { name: 'h', type: 'number' },
        { name: 'isStatic', type: 'bool' },
      ],
    });
    app.save(oncallLayout);

    // conflict_log
    const conflictLog = new Collection({
      name: 'conflict_log',
      type: 'base',
      fields: [
        { name: 'collection', type: 'text', required: true },
        { name: 'recordId', type: 'text', required: true },
        { name: 'overwrittenData', type: 'json', required: true },
        { name: 'overwrittenBy', type: 'text' },
      ],
    });
    app.save(conflictLog);
  },
  (app) => {
    // Rollback — delete all collections
    const collections = [
      'conflict_log',
      'oncall_layout',
      'saved_locations',
      'notes',
      'alert_history',
      'bridge_history',
      'bridge_groups',
      'oncall',
      'servers',
      'contacts',
    ];
    for (const name of collections) {
      const col = app.findCollectionByNameOrId(name);
      app.delete(col);
    }
  },
);
```

- [ ] **Step 3: Create auth user migration**

Create `resources/pb_migrations/2_auth_setup.js`:

```javascript
/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Create users collection for shared-secret auth
    const users = new Collection({
      name: 'users',
      type: 'auth',
      fields: [{ name: 'name', type: 'text' }],
    });
    app.save(users);

    // Set collection rules: require auth for all data collections
    const protectedCollections = [
      'contacts',
      'servers',
      'oncall',
      'bridge_groups',
      'bridge_history',
      'alert_history',
      'notes',
      'saved_locations',
      'oncall_layout',
      'conflict_log',
    ];

    for (const name of protectedCollections) {
      const col = app.findCollectionByNameOrId(name);
      col.listRule = '@request.auth.id != ""';
      col.viewRule = '@request.auth.id != ""';
      col.createRule = '@request.auth.id != ""';
      col.updateRule = '@request.auth.id != ""';
      col.deleteRule = '@request.auth.id != ""';
      app.save(col);
    }
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    app.delete(users);
  },
);
```

- [ ] **Step 4: Verify migration files are valid JSON/JS**

Run:

```bash
node -e "require('./resources/pb_migrations/1_initial_schema.js')" 2>&1 || echo "Note: migrations are PocketBase JS format, validated at runtime by PocketBase"
ls -la resources/pb_migrations/
```

Expected: Both migration files exist

- [ ] **Step 5: Commit**

```bash
git add resources/pb_migrations/
git commit -m "feat: add PocketBase schema migrations for all collections"
```

---

## Phase 3: Renderer PocketBase Services

### Task 5: PocketBase SDK Init and Connection State

**Files:**

- Create: `src/renderer/src/services/pocketbase.ts`
- Create: `src/renderer/src/hooks/usePocketBase.ts`

- [ ] **Step 1: Create PocketBase service with connection state machine**

Create `src/renderer/src/services/pocketbase.ts`:

```typescript
import PocketBase from 'pocketbase';

export type ConnectionState = 'connecting' | 'online' | 'offline' | 'reconnecting';

type StateListener = (state: ConnectionState) => void;

let pb: PocketBase | null = null;
let connectionState: ConnectionState = 'connecting';
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
const stateListeners = new Set<StateListener>();

export function initPocketBase(url: string): PocketBase {
  pb = new PocketBase(url);
  connectionState = 'connecting';
  return pb;
}

export function getPb(): PocketBase {
  if (!pb) throw new Error('PocketBase not initialized. Call initPocketBase() first.');
  return pb;
}

export function getConnectionState(): ConnectionState {
  return connectionState;
}

export function onConnectionStateChange(listener: StateListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

function setConnectionState(state: ConnectionState): void {
  if (connectionState === state) return;
  connectionState = state;
  stateListeners.forEach((fn) => fn(state));
}

export async function authenticate(secret: string): Promise<boolean> {
  try {
    await getPb().collection('users').authWithPassword('relay', secret);
    setConnectionState('online');
    startHealthCheck();
    return true;
  } catch {
    return false;
  }
}

export function startHealthCheck(intervalMs = 30000): void {
  stopHealthCheck();
  healthCheckInterval = setInterval(async () => {
    try {
      const res = await fetch(`${getPb().baseURL}/api/health`);
      if (res.ok && connectionState !== 'online') {
        setConnectionState('reconnecting');
        // Re-authenticate if needed
        if (!getPb().authStore.isValid) {
          // Auth will be re-attempted by the reconnection logic
          return;
        }
        setConnectionState('online');
      } else if (!res.ok && connectionState === 'online') {
        setConnectionState('offline');
      }
    } catch {
      if (connectionState === 'online') {
        setConnectionState('offline');
      }
    }
  }, intervalMs);
}

export function stopHealthCheck(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

export function handleApiError(error: unknown): void {
  // Network errors transition to offline
  if (error instanceof TypeError && (error as TypeError).message.includes('fetch')) {
    setConnectionState('offline');
  }
}

export function isOnline(): boolean {
  return connectionState === 'online';
}
```

- [ ] **Step 2: Create usePocketBase hook**

Create `src/renderer/src/hooks/usePocketBase.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import {
  initPocketBase,
  authenticate,
  getConnectionState,
  onConnectionStateChange,
  stopHealthCheck,
  type ConnectionState,
} from '../services/pocketbase';

export function usePocketBase(url: string | null, secret: string | null) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url || !secret) return;

    const pb = initPocketBase(url);

    const unsubscribe = onConnectionStateChange(setState);

    authenticate(secret).then((ok) => {
      if (!ok) {
        setError('Authentication failed. Check your passphrase.');
      }
    });

    return () => {
      unsubscribe();
      stopHealthCheck();
    };
  }, [url, secret]);

  return { connectionState: state, error };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/services/pocketbase.ts src/renderer/src/hooks/usePocketBase.ts
git commit -m "feat: add PocketBase SDK init, auth, and connection state management"
```

---

### Task 6: Generic Collection Hook

**Files:**

- Create: `src/renderer/src/hooks/useCollection.ts`

- [ ] **Step 1: Create the generic useCollection hook**

This hook handles: initial fetch, realtime subscriptions, offline fallback, and local state updates.

Create `src/renderer/src/hooks/useCollection.ts`:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import { type RecordModel } from 'pocketbase';
import { getPb, isOnline, onConnectionStateChange, handleApiError } from '../services/pocketbase';

interface UseCollectionOptions {
  sort?: string;
  filter?: string;
  /** IPC channel name for offline cache fallback */
  offlineCacheChannel?: string;
}

interface UseCollectionResult<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useCollection<T extends RecordModel>(
  collectionName: string,
  options: UseCollectionOptions = {},
): UseCollectionResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const subscriptionRef = useRef<(() => void) | null>(null);

  const fetchData = useCallback(async () => {
    try {
      if (isOnline()) {
        const records = await getPb()
          .collection(collectionName)
          .getFullList<T>({
            sort: options.sort || '-created',
            filter: options.filter || '',
          });
        setData(records);
        setError(null);
      } else if (options.offlineCacheChannel) {
        // Offline: read from local cache via IPC
        const cached = await window.api?.cacheRead?.(collectionName);
        if (cached) setData(cached as T[]);
      }
    } catch (err) {
      handleApiError(err);
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      // Try offline cache as fallback
      if (options.offlineCacheChannel) {
        try {
          const cached = await window.api?.cacheRead?.(collectionName);
          if (cached) setData(cached as T[]);
        } catch {
          // Cache also failed
        }
      }
    } finally {
      setLoading(false);
    }
  }, [collectionName, options.sort, options.filter, options.offlineCacheChannel]);

  // Subscribe to realtime changes
  useEffect(() => {
    if (!isOnline()) {
      fetchData();
      return;
    }

    fetchData();

    // Realtime subscription
    getPb()
      .collection(collectionName)
      .subscribe('*', (e) => {
        setData((prev) => {
          switch (e.action) {
            case 'create':
              return [...prev, e.record as T];
            case 'update':
              return prev.map((r) => (r.id === e.record.id ? (e.record as T) : r));
            case 'delete':
              return prev.filter((r) => r.id !== e.record.id);
            default:
              return prev;
          }
        });

        // Update offline cache
        window.api?.cacheWrite?.(collectionName, e.action, e.record);
      })
      .then((unsubscribe) => {
        subscriptionRef.current = unsubscribe;
      })
      .catch((err) => {
        handleApiError(err);
      });

    return () => {
      subscriptionRef.current?.();
      subscriptionRef.current = null;
    };
  }, [collectionName, fetchData]);

  // Re-fetch when coming back online
  useEffect(() => {
    const unsubscribe = onConnectionStateChange((state) => {
      if (state === 'online') {
        fetchData();
      }
    });
    return unsubscribe;
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/hooks/useCollection.ts
git commit -m "feat: add generic useCollection hook with realtime + offline fallback"
```

---

### Task 7: Collection Service Layer

**Files:**

- Create: `src/renderer/src/services/contactService.ts`
- Create: `src/renderer/src/services/serverService.ts`
- Create: `src/renderer/src/services/oncallService.ts`
- Create: `src/renderer/src/services/bridgeGroupService.ts`
- Create: `src/renderer/src/services/bridgeHistoryService.ts`
- Create: `src/renderer/src/services/alertHistoryService.ts`
- Create: `src/renderer/src/services/notesService.ts`
- Create: `src/renderer/src/services/savedLocationService.ts`
- Create: `src/renderer/src/services/oncallLayoutService.ts`

- [ ] **Step 1: Create contactService**

Create `src/renderer/src/services/contactService.ts`:

```typescript
import { getPb, isOnline, handleApiError } from './pocketbase';

export interface ContactRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  created: string;
  updated: string;
}

export type ContactInput = Omit<ContactRecord, 'id' | 'created' | 'updated'>;

export async function addContact(data: ContactInput): Promise<ContactRecord> {
  try {
    return await getPb().collection('contacts').create<ContactRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function updateContact(
  id: string,
  data: Partial<ContactInput>,
): Promise<ContactRecord> {
  try {
    return await getPb().collection('contacts').update<ContactRecord>(id, data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function deleteContact(id: string): Promise<boolean> {
  try {
    return await getPb().collection('contacts').delete(id);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function findContactByEmail(email: string): Promise<ContactRecord | null> {
  try {
    const result = await getPb()
      .collection('contacts')
      .getFirstListItem<ContactRecord>(`email="${email}"`);
    return result;
  } catch {
    return null;
  }
}

export async function bulkUpsertContacts(
  contacts: ContactInput[],
): Promise<{ imported: number; updated: number; errors: string[] }> {
  let imported = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const contact of contacts) {
    try {
      const existing = contact.email ? await findContactByEmail(contact.email) : null;
      if (existing) {
        await updateContact(existing.id, contact);
        updated++;
      } else {
        await addContact(contact);
        imported++;
      }
    } catch (err) {
      errors.push(`Failed to import ${contact.name}: ${err}`);
    }
  }

  return { imported, updated, errors };
}
```

- [ ] **Step 2: Create serverService**

Create `src/renderer/src/services/serverService.ts`:

```typescript
import { getPb, handleApiError } from './pocketbase';

export interface ServerRecord {
  id: string;
  name: string;
  businessArea: string;
  lob: string;
  comment: string;
  owner: string;
  contact: string;
  os: string;
  created: string;
  updated: string;
}

export type ServerInput = Omit<ServerRecord, 'id' | 'created' | 'updated'>;

export async function addServer(data: ServerInput): Promise<ServerRecord> {
  try {
    return await getPb().collection('servers').create<ServerRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function updateServer(id: string, data: Partial<ServerInput>): Promise<ServerRecord> {
  try {
    return await getPb().collection('servers').update<ServerRecord>(id, data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function deleteServer(id: string): Promise<boolean> {
  try {
    return await getPb().collection('servers').delete(id);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function findServerByName(name: string): Promise<ServerRecord | null> {
  try {
    return await getPb().collection('servers').getFirstListItem<ServerRecord>(`name="${name}"`);
  } catch {
    return null;
  }
}

export async function bulkUpsertServers(
  servers: ServerInput[],
): Promise<{ imported: number; updated: number; errors: string[] }> {
  let imported = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const server of servers) {
    try {
      const existing = await findServerByName(server.name);
      if (existing) {
        await updateServer(existing.id, server);
        updated++;
      } else {
        await addServer(server);
        imported++;
      }
    } catch (err) {
      errors.push(`Failed to import ${server.name}: ${err}`);
    }
  }

  return { imported, updated, errors };
}
```

- [ ] **Step 3: Create oncallService**

Create `src/renderer/src/services/oncallService.ts`:

```typescript
import { getPb, handleApiError } from './pocketbase';

export interface OnCallRecord {
  id: string;
  team: string;
  role: string;
  name: string;
  contact: string;
  timeWindow: string;
  sortOrder: number;
  created: string;
  updated: string;
}

export type OnCallInput = Omit<OnCallRecord, 'id' | 'created' | 'updated'>;

export async function addOnCall(data: OnCallInput): Promise<OnCallRecord> {
  try {
    return await getPb().collection('oncall').create<OnCallRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function updateOnCall(id: string, data: Partial<OnCallInput>): Promise<OnCallRecord> {
  try {
    return await getPb().collection('oncall').update<OnCallRecord>(id, data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function deleteOnCall(id: string): Promise<boolean> {
  try {
    return await getPb().collection('oncall').delete(id);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function deleteOnCallByTeam(team: string): Promise<boolean> {
  try {
    const records = await getPb()
      .collection('oncall')
      .getFullList<OnCallRecord>({ filter: `team="${team}"` });
    for (const record of records) {
      await getPb().collection('oncall').delete(record.id);
    }
    return true;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function replaceTeamRecords(
  team: string,
  records: Omit<OnCallInput, 'team'>[],
): Promise<boolean> {
  try {
    await deleteOnCallByTeam(team);
    for (let i = 0; i < records.length; i++) {
      await addOnCall({ ...records[i], team, sortOrder: i });
    }
    return true;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function renameTeam(oldName: string, newName: string): Promise<boolean> {
  try {
    const records = await getPb()
      .collection('oncall')
      .getFullList<OnCallRecord>({ filter: `team="${oldName}"` });
    for (const record of records) {
      await updateOnCall(record.id, { team: newName });
    }
    return true;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function reorderTeams(teamOrder: string[]): Promise<boolean> {
  // This reorders all records such that teams appear in teamOrder sequence
  // Records within each team keep their existing sortOrder
  try {
    const all = await getPb().collection('oncall').getFullList<OnCallRecord>({ sort: 'sortOrder' });
    let globalSort = 0;
    for (const teamName of teamOrder) {
      const teamRecords = all.filter((r) => r.team === teamName);
      for (const record of teamRecords) {
        await updateOnCall(record.id, { sortOrder: globalSort++ });
      }
    }
    return true;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
```

- [ ] **Step 4: Create bridgeGroupService**

Create `src/renderer/src/services/bridgeGroupService.ts`:

```typescript
import { getPb, handleApiError } from './pocketbase';

export interface BridgeGroupRecord {
  id: string;
  name: string;
  contacts: string[];
  created: string;
  updated: string;
}

export type BridgeGroupInput = Omit<BridgeGroupRecord, 'id' | 'created' | 'updated'>;

export async function addGroup(data: BridgeGroupInput): Promise<BridgeGroupRecord> {
  try {
    return await getPb().collection('bridge_groups').create<BridgeGroupRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function updateGroup(
  id: string,
  data: Partial<BridgeGroupInput>,
): Promise<BridgeGroupRecord> {
  try {
    return await getPb().collection('bridge_groups').update<BridgeGroupRecord>(id, data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function deleteGroup(id: string): Promise<boolean> {
  try {
    return await getPb().collection('bridge_groups').delete(id);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
```

- [ ] **Step 5: Create bridgeHistoryService**

Create `src/renderer/src/services/bridgeHistoryService.ts`:

```typescript
import { getPb, handleApiError } from './pocketbase';

export interface BridgeHistoryRecord {
  id: string;
  note: string;
  groups: string[];
  contacts: string[];
  recipientCount: number;
  created: string;
  updated: string;
}

export type BridgeHistoryInput = Omit<BridgeHistoryRecord, 'id' | 'created' | 'updated'>;

export async function addBridgeHistory(data: BridgeHistoryInput): Promise<BridgeHistoryRecord> {
  try {
    return await getPb().collection('bridge_history').create<BridgeHistoryRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function deleteBridgeHistory(id: string): Promise<boolean> {
  try {
    return await getPb().collection('bridge_history').delete(id);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function clearBridgeHistory(): Promise<boolean> {
  try {
    const all = await getPb().collection('bridge_history').getFullList();
    for (const record of all) {
      await getPb().collection('bridge_history').delete(record.id);
    }
    return true;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
```

- [ ] **Step 6: Create alertHistoryService**

Create `src/renderer/src/services/alertHistoryService.ts`:

```typescript
import { getPb, handleApiError } from './pocketbase';

export interface AlertHistoryRecord {
  id: string;
  severity: 'ISSUE' | 'MAINTENANCE' | 'INFO' | 'RESOLVED';
  subject: string;
  bodyHtml: string;
  sender: string;
  recipient: string;
  pinned: boolean;
  label: string;
  created: string;
  updated: string;
}

export type AlertHistoryInput = Omit<AlertHistoryRecord, 'id' | 'created' | 'updated'>;

export async function addAlertHistory(data: AlertHistoryInput): Promise<AlertHistoryRecord> {
  try {
    return await getPb().collection('alert_history').create<AlertHistoryRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function deleteAlertHistory(id: string): Promise<boolean> {
  try {
    return await getPb().collection('alert_history').delete(id);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function clearAlertHistory(): Promise<boolean> {
  try {
    const all = await getPb().collection('alert_history').getFullList({ filter: 'pinned=false' });
    for (const record of all) {
      await getPb().collection('alert_history').delete(record.id);
    }
    return true;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function pinAlertHistory(id: string, pinned: boolean): Promise<boolean> {
  try {
    await getPb().collection('alert_history').update(id, { pinned });
    return true;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function updateAlertLabel(id: string, label: string): Promise<boolean> {
  try {
    await getPb().collection('alert_history').update(id, { label });
    return true;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
```

- [ ] **Step 7: Create notesService**

Create `src/renderer/src/services/notesService.ts`:

```typescript
import { getPb, handleApiError } from './pocketbase';

export interface NoteRecord {
  id: string;
  entityType: 'contact' | 'server';
  entityKey: string;
  note: string;
  tags: string[];
  created: string;
  updated: string;
}

export async function getNote(
  entityType: 'contact' | 'server',
  entityKey: string,
): Promise<NoteRecord | null> {
  try {
    const key = entityKey.toLowerCase();
    return await getPb()
      .collection('notes')
      .getFirstListItem<NoteRecord>(`entityType="${entityType}" && entityKey="${key}"`);
  } catch {
    return null;
  }
}

export async function setNote(
  entityType: 'contact' | 'server',
  entityKey: string,
  note: string,
  tags: string[],
): Promise<NoteRecord> {
  const key = entityKey.toLowerCase();
  try {
    const existing = await getNote(entityType, key);
    if (existing) {
      return await getPb().collection('notes').update<NoteRecord>(existing.id, { note, tags });
    }
    return await getPb()
      .collection('notes')
      .create<NoteRecord>({ entityType, entityKey: key, note, tags });
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
```

- [ ] **Step 8: Create savedLocationService**

Create `src/renderer/src/services/savedLocationService.ts`:

```typescript
import { getPb, handleApiError } from './pocketbase';

export interface SavedLocationRecord {
  id: string;
  name: string;
  lat: number;
  lon: number;
  isDefault: boolean;
  created: string;
  updated: string;
}

export type SavedLocationInput = Omit<SavedLocationRecord, 'id' | 'created' | 'updated'>;

export async function addLocation(data: SavedLocationInput): Promise<SavedLocationRecord> {
  try {
    return await getPb().collection('saved_locations').create<SavedLocationRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function updateLocation(
  id: string,
  data: Partial<SavedLocationInput>,
): Promise<SavedLocationRecord> {
  try {
    return await getPb().collection('saved_locations').update<SavedLocationRecord>(id, data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function deleteLocation(id: string): Promise<boolean> {
  try {
    return await getPb().collection('saved_locations').delete(id);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function setDefaultLocation(id: string): Promise<boolean> {
  try {
    // Clear all defaults first
    const all = await getPb()
      .collection('saved_locations')
      .getFullList<SavedLocationRecord>({ filter: 'isDefault=true' });
    for (const loc of all) {
      await getPb().collection('saved_locations').update(loc.id, { isDefault: false });
    }
    // Set the new default
    await getPb().collection('saved_locations').update(id, { isDefault: true });
    return true;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
```

- [ ] **Step 9: Create oncallLayoutService**

Create `src/renderer/src/services/oncallLayoutService.ts`:

```typescript
import { getPb, handleApiError } from './pocketbase';

export interface OncallLayoutRecord {
  id: string;
  team: string;
  x: number;
  y: number;
  w: number;
  h: number;
  isStatic: boolean;
  created: string;
  updated: string;
}

export type OncallLayoutInput = Omit<OncallLayoutRecord, 'id' | 'created' | 'updated'>;

export async function getLayout(): Promise<Record<string, OncallLayoutInput>> {
  try {
    const records = await getPb().collection('oncall_layout').getFullList<OncallLayoutRecord>();
    const layout: Record<string, OncallLayoutInput> = {};
    for (const r of records) {
      layout[r.team] = { team: r.team, x: r.x, y: r.y, w: r.w, h: r.h, isStatic: r.isStatic };
    }
    return layout;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function saveLayout(
  teamLayouts: Record<string, Omit<OncallLayoutInput, 'team'>>,
): Promise<boolean> {
  try {
    for (const [team, layout] of Object.entries(teamLayouts)) {
      try {
        const existing = await getPb()
          .collection('oncall_layout')
          .getFirstListItem<OncallLayoutRecord>(`team="${team}"`);
        await getPb().collection('oncall_layout').update(existing.id, layout);
      } catch {
        await getPb()
          .collection('oncall_layout')
          .create({ team, ...layout });
      }
    }
    return true;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
```

- [ ] **Step 10: Commit all services**

```bash
git add src/renderer/src/services/ src/renderer/src/hooks/useCollection.ts
git commit -m "feat: add PocketBase service layer for all collections"
```

---

## Phase 4: Offline Support

### Task 8: Offline Cache (Client Mode)

**Files:**

- Create: `src/main/cache/OfflineCache.ts`
- Create: `src/main/cache/OfflineCache.test.ts`

- [ ] **Step 1: Write failing tests for OfflineCache**

Create `src/main/cache/OfflineCache.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { OfflineCache } from './OfflineCache';

describe('OfflineCache', () => {
  let tempDir: string;
  let cache: OfflineCache;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'relay-cache-'));
    cache = new OfflineCache(join(tempDir, 'cache.db'));
  });

  afterEach(() => {
    cache.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('stores and retrieves records for a collection', () => {
    const records = [
      { id: '1', name: 'Alice', created: '2026-01-01', updated: '2026-01-01' },
      { id: '2', name: 'Bob', created: '2026-01-01', updated: '2026-01-01' },
    ];
    cache.writeCollection('contacts', records);
    const result = cache.readCollection('contacts');
    expect(result).toEqual(records);
  });

  it('returns empty array for unknown collection', () => {
    expect(cache.readCollection('nonexistent')).toEqual([]);
  });

  it('overwrites collection data on re-write', () => {
    cache.writeCollection('contacts', [{ id: '1', name: 'Alice' }]);
    cache.writeCollection('contacts', [{ id: '2', name: 'Bob' }]);
    const result = cache.readCollection('contacts');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Bob');
  });

  it('handles single record updates', () => {
    cache.writeCollection('contacts', [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ]);
    cache.updateRecord('contacts', 'update', { id: '1', name: 'Alice Updated' });
    const result = cache.readCollection('contacts');
    expect(result.find((r: any) => r.id === '1').name).toBe('Alice Updated');
  });

  it('handles single record create', () => {
    cache.writeCollection('contacts', [{ id: '1', name: 'Alice' }]);
    cache.updateRecord('contacts', 'create', { id: '2', name: 'Bob' });
    expect(cache.readCollection('contacts')).toHaveLength(2);
  });

  it('handles single record delete', () => {
    cache.writeCollection('contacts', [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ]);
    cache.updateRecord('contacts', 'delete', { id: '1' });
    expect(cache.readCollection('contacts')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/cache/OfflineCache.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement OfflineCache**

Create `src/main/cache/OfflineCache.ts`:

```typescript
import Database from 'better-sqlite3';

export class OfflineCache {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        collection TEXT NOT NULL,
        record_id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (collection, record_id)
      )
    `);
  }

  writeCollection(collection: string, records: Record<string, unknown>[]): void {
    const deleteStmt = this.db.prepare('DELETE FROM cache WHERE collection = ?');
    const insertStmt = this.db.prepare(
      'INSERT INTO cache (collection, record_id, data) VALUES (?, ?, ?)',
    );

    const transaction = this.db.transaction(() => {
      deleteStmt.run(collection);
      for (const record of records) {
        const id = (record as { id?: string }).id || '';
        insertStmt.run(collection, id, JSON.stringify(record));
      }
    });

    transaction();
  }

  readCollection(collection: string): Record<string, unknown>[] {
    const stmt = this.db.prepare('SELECT data FROM cache WHERE collection = ?');
    const rows = stmt.all(collection) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data));
  }

  updateRecord(
    collection: string,
    action: 'create' | 'update' | 'delete',
    record: Record<string, unknown>,
  ): void {
    const id = (record as { id?: string }).id || '';

    switch (action) {
      case 'create':
      case 'update':
        this.db
          .prepare('INSERT OR REPLACE INTO cache (collection, record_id, data) VALUES (?, ?, ?)')
          .run(collection, id, JSON.stringify(record));
        break;
      case 'delete':
        this.db
          .prepare('DELETE FROM cache WHERE collection = ? AND record_id = ?')
          .run(collection, id);
        break;
    }
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/cache/OfflineCache.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/cache/OfflineCache.ts src/main/cache/OfflineCache.test.ts
git commit -m "feat: add OfflineCache for local SQLite data mirror"
```

---

### Task 9: Pending Changes Queue

**Files:**

- Create: `src/main/cache/PendingChanges.ts`
- Create: `src/main/cache/PendingChanges.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/cache/PendingChanges.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PendingChanges, type PendingChange } from './PendingChanges';

describe('PendingChanges', () => {
  let tempDir: string;
  let pending: PendingChanges;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'relay-pending-'));
    pending = new PendingChanges(join(tempDir, 'pending.db'));
  });

  afterEach(() => {
    pending.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts with empty queue', () => {
    expect(pending.getAll()).toEqual([]);
  });

  it('enqueues and retrieves changes in order', () => {
    pending.enqueue('contacts', 'create', { id: '1', name: 'Alice' });
    pending.enqueue('contacts', 'update', { id: '1', name: 'Alice B' });
    pending.enqueue('servers', 'create', { id: '2', name: 'srv1' });

    const all = pending.getAll();
    expect(all).toHaveLength(3);
    expect(all[0].collection).toBe('contacts');
    expect(all[0].action).toBe('create');
    expect(all[2].collection).toBe('servers');
  });

  it('removes a specific change after processing', () => {
    pending.enqueue('contacts', 'create', { id: '1', name: 'Alice' });
    pending.enqueue('contacts', 'update', { id: '1', name: 'Alice B' });

    const all = pending.getAll();
    pending.remove(all[0].id);

    expect(pending.getAll()).toHaveLength(1);
  });

  it('clears all pending changes', () => {
    pending.enqueue('contacts', 'create', { id: '1', name: 'Alice' });
    pending.enqueue('servers', 'create', { id: '2', name: 'srv1' });

    pending.clear();
    expect(pending.getAll()).toEqual([]);
  });

  it('stores the snapshot of the record at time of change', () => {
    pending.enqueue('contacts', 'update', { id: '1', name: 'Updated', email: 'a@b.com' });
    const all = pending.getAll();
    expect(all[0].data).toEqual({ id: '1', name: 'Updated', email: 'a@b.com' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/cache/PendingChanges.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PendingChanges**

Create `src/main/cache/PendingChanges.ts`:

```typescript
import Database from 'better-sqlite3';

export interface PendingChange {
  id: number;
  collection: string;
  action: 'create' | 'update' | 'delete';
  data: Record<string, unknown>;
  timestamp: number;
}

export class PendingChanges {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection TEXT NOT NULL,
        action TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);
  }

  enqueue(
    collection: string,
    action: 'create' | 'update' | 'delete',
    data: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        'INSERT INTO pending_changes (collection, action, data, timestamp) VALUES (?, ?, ?, ?)',
      )
      .run(collection, action, JSON.stringify(data), Date.now());
  }

  getAll(): PendingChange[] {
    const rows = this.db.prepare('SELECT * FROM pending_changes ORDER BY id ASC').all() as Array<{
      id: number;
      collection: string;
      action: string;
      data: string;
      timestamp: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      collection: row.collection,
      action: row.action as PendingChange['action'],
      data: JSON.parse(row.data),
      timestamp: row.timestamp,
    }));
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM pending_changes WHERE id = ?').run(id);
  }

  clear(): void {
    this.db.exec('DELETE FROM pending_changes');
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/cache/PendingChanges.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/cache/PendingChanges.ts src/main/cache/PendingChanges.test.ts
git commit -m "feat: add PendingChanges queue for offline write buffering"
```

---

### Task 10: Sync Manager and Conflict Resolution

**Files:**

- Create: `src/main/cache/SyncManager.ts`
- Create: `src/main/cache/SyncManager.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/cache/SyncManager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager } from './SyncManager';
import type { PendingChange } from './PendingChanges';

// Mock PocketBase client
const mockPb = {
  collection: vi.fn(),
};

describe('SyncManager', () => {
  let syncManager: SyncManager;

  beforeEach(() => {
    vi.clearAllMocks();
    syncManager = new SyncManager(mockPb as any);
  });

  it('applies a create change without conflict', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'new-1' });
    mockPb.collection.mockReturnValue({ create: mockCreate });

    const change: PendingChange = {
      id: 1,
      collection: 'contacts',
      action: 'create',
      data: { name: 'Alice', email: 'alice@example.com' },
      timestamp: Date.now(),
    };

    const result = await syncManager.applyChange(change);
    expect(result.conflict).toBe(false);
    expect(mockCreate).toHaveBeenCalledWith({ name: 'Alice', email: 'alice@example.com' });
  });

  it('detects conflict on update when server record is newer', async () => {
    const serverRecord = {
      id: '1',
      name: 'Server Version',
      updated: '2026-03-21T12:00:00Z',
    };
    const mockGetOne = vi.fn().mockResolvedValue(serverRecord);
    const mockUpdate = vi.fn().mockResolvedValue({ id: '1', name: 'Client Version' });
    const mockCreate = vi.fn().mockResolvedValue({});
    mockPb.collection.mockReturnValue({
      getOne: mockGetOne,
      update: mockUpdate,
      create: mockCreate,
    });

    const change: PendingChange = {
      id: 2,
      collection: 'contacts',
      action: 'update',
      data: { id: '1', name: 'Client Version' },
      // Timestamp before server update
      timestamp: new Date('2026-03-21T11:00:00Z').getTime(),
    };

    const result = await syncManager.applyChange(change);
    expect(result.conflict).toBe(true);
    expect(result.overwrittenData).toEqual(serverRecord);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('applies delete without conflict', async () => {
    const mockDelete = vi.fn().mockResolvedValue(true);
    mockPb.collection.mockReturnValue({ delete: mockDelete });

    const change: PendingChange = {
      id: 3,
      collection: 'contacts',
      action: 'delete',
      data: { id: '1' },
      timestamp: Date.now(),
    };

    const result = await syncManager.applyChange(change);
    expect(result.conflict).toBe(false);
    expect(mockDelete).toHaveBeenCalledWith('1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/cache/SyncManager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SyncManager**

Create `src/main/cache/SyncManager.ts`:

```typescript
import type PocketBase from 'pocketbase';
import type { PendingChange } from './PendingChanges';
import { loggers } from '../logger';
// Add to src/main/logger.ts: sync: logger.createChild('Sync')
const logger = loggers.sync;

export interface SyncResult {
  conflict: boolean;
  overwrittenData?: Record<string, unknown>;
}

export class SyncManager {
  constructor(private pb: PocketBase) {}

  async applyChange(change: PendingChange): Promise<SyncResult> {
    const { collection, action, data } = change;
    const recordId = (data as { id?: string }).id;

    switch (action) {
      case 'create':
        return this.applyCreate(collection, data);
      case 'update':
        return this.applyUpdate(collection, recordId!, data, change.timestamp);
      case 'delete':
        return this.applyDelete(collection, recordId!);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  private async applyCreate(
    collection: string,
    data: Record<string, unknown>,
  ): Promise<SyncResult> {
    // Strip id so PocketBase generates a new one
    const { id, ...createData } = data as { id?: string } & Record<string, unknown>;
    await this.pb.collection(collection).create(createData);
    return { conflict: false };
  }

  private async applyUpdate(
    collection: string,
    recordId: string,
    data: Record<string, unknown>,
    clientTimestamp: number,
  ): Promise<SyncResult> {
    let conflict = false;
    let overwrittenData: Record<string, unknown> | undefined;

    try {
      // Fetch the current server version
      const serverRecord = await this.pb.collection(collection).getOne(recordId);
      const serverUpdated = new Date(serverRecord.updated).getTime();

      if (serverUpdated > clientTimestamp) {
        // Server was modified after client went offline — conflict
        conflict = true;
        overwrittenData = { ...serverRecord };

        // Log conflict
        await this.pb.collection('conflict_log').create({
          collection,
          recordId,
          overwrittenData: serverRecord,
          overwrittenBy: 'client',
        });

        logger.warn('Conflict detected during sync', { collection, recordId });
      }
    } catch {
      // Record not found on server — might have been deleted
      // Apply as create instead
      const { id, ...createData } = data as { id?: string } & Record<string, unknown>;
      await this.pb.collection(collection).create(createData);
      return { conflict: false };
    }

    // Apply the client's version (last-write-wins)
    const { id, created, updated, ...updateData } = data as Record<string, unknown>;
    await this.pb.collection(collection).update(recordId, updateData);

    return { conflict, overwrittenData };
  }

  private async applyDelete(collection: string, recordId: string): Promise<SyncResult> {
    try {
      await this.pb.collection(collection).delete(recordId);
    } catch {
      // Already deleted — not a conflict
    }
    return { conflict: false };
  }

  async syncAll(
    changes: PendingChange[],
    onProgress?: (processed: number, total: number) => void,
  ): Promise<{ total: number; conflicts: number; errors: string[] }> {
    let conflicts = 0;
    const errors: string[] = [];

    for (let i = 0; i < changes.length; i++) {
      try {
        const result = await this.applyChange(changes[i]);
        if (result.conflict) conflicts++;
      } catch (err) {
        errors.push(`Failed to sync ${changes[i].collection}/${changes[i].action}: ${err}`);
        logger.error('Sync error', { change: changes[i], error: err });
      }
      onProgress?.(i + 1, changes.length);
    }

    return { total: changes.length, conflicts, errors };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/cache/SyncManager.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/cache/SyncManager.ts src/main/cache/SyncManager.test.ts
git commit -m "feat: add SyncManager with last-write-wins conflict resolution"
```

---

## Phase 5: JSON Migration

### Task 11: One-Time JSON to PocketBase Migrator

**Files:**

- Create: `src/main/migration/JsonMigrator.ts`
- Create: `src/main/migration/JsonMigrator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/migration/JsonMigrator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JsonMigrator } from './JsonMigrator';

const mockPb = {
  collection: vi.fn(),
};

describe('JsonMigrator', () => {
  let migrator: JsonMigrator;

  beforeEach(() => {
    vi.clearAllMocks();
    migrator = new JsonMigrator(mockPb as any);
  });

  it('transforms contact timestamps to PocketBase format', () => {
    const contact = {
      id: 'contact-1',
      name: 'Alice',
      email: 'alice@example.com',
      phone: '555-0100',
      title: 'Engineer',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };

    const result = migrator.transformContact(contact);
    expect(result).toEqual({
      name: 'Alice',
      email: 'alice@example.com',
      phone: '555-0100',
      title: 'Engineer',
    });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('createdAt');
    expect(result).not.toHaveProperty('updatedAt');
  });

  it('flattens notes structure into individual records', () => {
    const notes = {
      contacts: {
        'alice@example.com': { note: 'Great person', tags: ['team'], updatedAt: 123 },
      },
      servers: {
        'web-01': { note: 'Primary server', tags: ['prod'], updatedAt: 456 },
      },
    };

    const result = migrator.transformNotes(notes);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      entityType: 'contact',
      entityKey: 'alice@example.com',
      note: 'Great person',
      tags: ['team'],
    });
    expect(result[1]).toEqual({
      entityType: 'server',
      entityKey: 'web-01',
      note: 'Primary server',
      tags: ['prod'],
    });
  });

  it('generates sortOrder for oncall records based on array position', () => {
    const oncallRecords = [
      {
        id: 'oc-1',
        team: 'NOC',
        name: 'Alice',
        role: 'Lead',
        contact: '',
        timeWindow: '',
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'oc-2',
        team: 'NOC',
        name: 'Bob',
        role: 'Backup',
        contact: '',
        timeWindow: '',
        createdAt: 0,
        updatedAt: 0,
      },
    ];

    const result = migrator.transformOnCall(oncallRecords);
    expect(result[0].sortOrder).toBe(0);
    expect(result[1].sortOrder).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/migration/JsonMigrator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement JsonMigrator**

Create `src/main/migration/JsonMigrator.ts`:

```typescript
import { existsSync, readFileSync, renameSync, copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type PocketBase from 'pocketbase';
import { loggers } from '../logger';
// Add to src/main/logger.ts: migration: logger.createChild('Migration')
const logger = loggers.migration;

interface LegacyContact {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface LegacyServer {
  id: string;
  name: string;
  businessArea: string;
  lob: string;
  comment: string;
  owner: string;
  contact: string;
  os: string;
  createdAt: number;
  updatedAt: number;
}

interface LegacyOnCall {
  id: string;
  team: string;
  role: string;
  name: string;
  contact: string;
  timeWindow?: string;
  createdAt: number;
  updatedAt: number;
}

interface LegacyNotes {
  contacts: Record<string, { note: string; tags: string[]; updatedAt: number }>;
  servers: Record<string, { note: string; tags: string[]; updatedAt: number }>;
}

export class JsonMigrator {
  constructor(private pb: PocketBase) {}

  transformContact(c: LegacyContact): Record<string, unknown> {
    return { name: c.name, email: c.email, phone: c.phone, title: c.title };
  }

  transformServer(s: LegacyServer): Record<string, unknown> {
    return {
      name: s.name,
      businessArea: s.businessArea,
      lob: s.lob,
      comment: s.comment,
      owner: s.owner,
      contact: s.contact,
      os: s.os,
    };
  }

  transformOnCall(records: LegacyOnCall[]): Array<Record<string, unknown>> {
    return records.map((r, i) => ({
      team: r.team,
      role: r.role,
      name: r.name,
      contact: r.contact,
      timeWindow: r.timeWindow || '',
      sortOrder: i,
    }));
  }

  transformNotes(notes: LegacyNotes): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];

    if (notes.contacts) {
      for (const [key, value] of Object.entries(notes.contacts)) {
        result.push({
          entityType: 'contact',
          entityKey: key,
          note: value.note,
          tags: value.tags,
        });
      }
    }

    if (notes.servers) {
      for (const [key, value] of Object.entries(notes.servers)) {
        result.push({
          entityType: 'server',
          entityKey: key,
          note: value.note,
          tags: value.tags,
        });
      }
    }

    return result;
  }

  async migrate(legacyDataDir: string): Promise<{
    success: boolean;
    summary: Record<string, number>;
    errors: string[];
  }> {
    const summary: Record<string, number> = {};
    const errors: string[] = [];

    // Back up all JSON files first
    const backupDir = join(legacyDataDir, 'pre-migration-backup');
    mkdirSync(backupDir, { recursive: true });

    const jsonFiles = [
      'contacts.json',
      'servers.json',
      'oncall.json',
      'bridgeGroups.json',
      'bridgeHistory.json',
      'alertHistory.json',
      'notes.json',
      'savedLocations.json',
      'oncall_layout.json',
    ];

    for (const file of jsonFiles) {
      const src = join(legacyDataDir, file);
      if (existsSync(src)) {
        copyFileSync(src, join(backupDir, file));
      }
    }

    logger.info('Legacy data backed up', { backupDir });

    // Migrate each collection
    const migrations: Array<{
      file: string;
      collection: string;
      transform: (data: unknown) => Array<Record<string, unknown>>;
    }> = [
      {
        file: 'contacts.json',
        collection: 'contacts',
        transform: (data) => (data as LegacyContact[]).map((c) => this.transformContact(c)),
      },
      {
        file: 'servers.json',
        collection: 'servers',
        transform: (data) => (data as LegacyServer[]).map((s) => this.transformServer(s)),
      },
      {
        file: 'oncall.json',
        collection: 'oncall',
        transform: (data) => this.transformOnCall(data as LegacyOnCall[]),
      },
      {
        file: 'bridgeGroups.json',
        collection: 'bridge_groups',
        transform: (data) =>
          (data as Array<{ id: string; name: string; contacts: string[] }>).map((g) => ({
            name: g.name,
            contacts: g.contacts,
          })),
      },
      {
        file: 'bridgeHistory.json',
        collection: 'bridge_history',
        transform: (data) =>
          (data as Array<Record<string, unknown>>).map(({ id, timestamp, ...rest }) => rest),
      },
      {
        file: 'alertHistory.json',
        collection: 'alert_history',
        transform: (data) =>
          (data as Array<Record<string, unknown>>).map(({ id, timestamp, ...rest }) => rest),
      },
      {
        file: 'notes.json',
        collection: 'notes',
        transform: (data) => this.transformNotes(data as LegacyNotes),
      },
      {
        file: 'savedLocations.json',
        collection: 'saved_locations',
        transform: (data) =>
          (data as Array<Record<string, unknown>>).map(
            ({ id, createdAt, updatedAt, ...rest }) => rest,
          ),
      },
    ];

    for (const m of migrations) {
      const filePath = join(legacyDataDir, m.file);
      if (!existsSync(filePath)) continue;

      try {
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const records = m.transform(parsed);

        // Idempotent: delete existing collection data if JSON file exists (un-renamed)
        const existing = await this.pb.collection(m.collection).getFullList();
        for (const record of existing) {
          await this.pb.collection(m.collection).delete(record.id);
        }

        // Insert all records
        for (const record of records) {
          await this.pb.collection(m.collection).create(record);
        }

        summary[m.collection] = records.length;

        // Rename source file to mark as migrated
        renameSync(filePath, `${filePath}.migrated`);

        logger.info(`Migrated ${m.collection}`, { count: records.length });
      } catch (err) {
        errors.push(`Failed to migrate ${m.file}: ${err}`);
        logger.error(`Migration failed for ${m.file}`, { error: err });
      }
    }

    // Handle oncall_layout separately (different structure)
    const layoutPath = join(legacyDataDir, 'oncall_layout.json');
    if (existsSync(layoutPath)) {
      try {
        const raw = readFileSync(layoutPath, 'utf-8');
        const layout = JSON.parse(raw) as Record<
          string,
          { x: number; y: number; w?: number; h?: number; static?: boolean }
        >;

        const existing = await this.pb.collection('oncall_layout').getFullList();
        for (const record of existing) {
          await this.pb.collection('oncall_layout').delete(record.id);
        }

        let count = 0;
        for (const [team, pos] of Object.entries(layout)) {
          await this.pb.collection('oncall_layout').create({
            team,
            x: pos.x,
            y: pos.y,
            w: pos.w || 1,
            h: pos.h || 1,
            isStatic: pos.static || false,
          });
          count++;
        }

        summary['oncall_layout'] = count;
        renameSync(layoutPath, `${layoutPath}.migrated`);
      } catch (err) {
        errors.push(`Failed to migrate oncall_layout.json: ${err}`);
      }
    }

    return { success: errors.length === 0, summary, errors };
  }

  static hasLegacyData(legacyDataDir: string): boolean {
    const files = [
      'contacts.json',
      'servers.json',
      'oncall.json',
      'bridgeGroups.json',
      'notes.json',
    ];
    return files.some((f) => existsSync(join(legacyDataDir, f)));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/migration/JsonMigrator.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/migration/
git commit -m "feat: add JsonMigrator for one-time JSON to PocketBase migration"
```

---

## Phase 6: Import/Export

### Task 12: Import/Export Service

**Files:**

- Create: `src/renderer/src/services/importExportService.ts`

- [ ] **Step 1: Create importExportService**

Create `src/renderer/src/services/importExportService.ts`:

```typescript
import { getPb } from './pocketbase';
import ExcelJS from 'exceljs';
import Papa from 'papaparse'; // Browser-compatible CSV parser (do NOT use csv-parse in renderer)

const ALL_COLLECTIONS = [
  'contacts',
  'servers',
  'oncall',
  'bridge_groups',
  'bridge_history',
  'alert_history',
  'notes',
  'saved_locations',
] as const;

type CollectionName = (typeof ALL_COLLECTIONS)[number];

// ---- EXPORT ----

export async function exportToJson(collection: CollectionName | 'all'): Promise<string> {
  if (collection === 'all') {
    const result: Record<string, unknown[]> = {};
    for (const col of ALL_COLLECTIONS) {
      result[col] = await getPb().collection(col).getFullList();
    }
    return JSON.stringify({ ...result, exportedAt: new Date().toISOString() }, null, 2);
  }
  const records = await getPb().collection(collection).getFullList();
  return JSON.stringify(records, null, 2);
}

export async function exportToCsv(collection: CollectionName): Promise<string> {
  const records = await getPb().collection(collection).getFullList();
  if (records.length === 0) return '';

  const headers = Object.keys(records[0]).filter(
    (k) => !['collectionId', 'collectionName', 'expand'].includes(k),
  );

  const escapeCell = (value: unknown): string => {
    const str = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
    // Formula injection protection
    if (/^[=+\-@\t\r]/.test(str)) {
      return `"'${str.replace(/"/g, '""')}"`;
    }
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.join(',')];
  for (const record of records) {
    lines.push(headers.map((h) => escapeCell(record[h])).join(','));
  }
  return lines.join('\n');
}

export async function exportToExcel(collection: CollectionName | 'all'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const collections = collection === 'all' ? [...ALL_COLLECTIONS] : [collection];

  for (const col of collections) {
    const records = await getPb().collection(col).getFullList();
    if (records.length === 0) continue;

    const sheet = workbook.addWorksheet(col);
    const headers = Object.keys(records[0]).filter(
      (k) => !['collectionId', 'collectionName', 'expand'].includes(k),
    );

    // Add header row with formatting
    const headerRow = sheet.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add data rows
    for (const record of records) {
      const values = headers.map((h) => {
        const val = record[h];
        return typeof val === 'object' ? JSON.stringify(val) : val;
      });
      sheet.addRow(values);
    }

    // Auto-width columns
    sheet.columns.forEach((column) => {
      let maxLength = 10;
      column.eachCell?.({ includeEmpty: false }, (cell) => {
        const length = cell.value ? String(cell.value).length : 0;
        maxLength = Math.min(Math.max(maxLength, length), 50);
      });
      column.width = maxLength + 2;
    });
  }

  return (await workbook.xlsx.writeBuffer()) as Buffer;
}

// ---- IMPORT ----

export async function importFromJson(
  collection: CollectionName,
  jsonString: string,
): Promise<{ imported: number; updated: number; errors: string[] }> {
  const records = JSON.parse(jsonString) as Array<Record<string, unknown>>;
  return bulkUpsert(collection, records);
}

export async function importFromCsv(
  collection: CollectionName,
  csvString: string,
): Promise<{ imported: number; updated: number; errors: string[] }> {
  const parsed = Papa.parse(csvString, {
    header: true,
    skipEmptyLines: true,
    trimHeaders: true,
  });
  return bulkUpsert(collection, parsed.data as Array<Record<string, unknown>>);
}

export async function importFromExcel(
  collection: CollectionName,
  buffer: ArrayBuffer,
): Promise<{ imported: number; updated: number; errors: string[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) return { imported: 0, updated: 0, errors: ['No worksheet found'] };

  const headers: string[] = [];
  sheet.getRow(1).eachCell((cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value);
  });

  const records: Array<Record<string, unknown>> = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header
    const record: Record<string, unknown> = {};
    row.eachCell((cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (header) record[header] = cell.value;
    });
    records.push(record);
  });

  return bulkUpsert(collection, records);
}

// ---- SHARED UPSERT LOGIC ----

const UNIQUE_KEYS: Record<string, string> = {
  contacts: 'email',
  servers: 'name',
  oncall: '',
  bridge_groups: 'name',
  bridge_history: '',
  alert_history: '',
  notes: 'entityKey',
  saved_locations: 'name',
};

async function bulkUpsert(
  collection: CollectionName,
  records: Array<Record<string, unknown>>,
): Promise<{ imported: number; updated: number; errors: string[] }> {
  let imported = 0;
  let updated = 0;
  const errors: string[] = [];
  const uniqueKey = UNIQUE_KEYS[collection];

  for (const record of records) {
    // Strip metadata fields
    const {
      id,
      created,
      updated: _updated,
      collectionId,
      collectionName,
      expand,
      ...data
    } = record;

    try {
      if (uniqueKey && data[uniqueKey]) {
        try {
          const existing = await getPb()
            .collection(collection)
            .getFirstListItem(`${uniqueKey}="${data[uniqueKey]}"`);
          await getPb().collection(collection).update(existing.id, data);
          updated++;
          continue;
        } catch {
          // Not found — create new
        }
      }
      await getPb().collection(collection).create(data);
      imported++;
    } catch (err) {
      errors.push(`Row error: ${err}`);
    }
  }

  return { imported, updated, errors };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/services/importExportService.ts
git commit -m "feat: add import/export service supporting JSON, CSV, and Excel"
```

---

## Phase 7: Setup UI and Connection Status

### Task 13: Setup Screen and Connection Status Components

**Files:**

- Create: `src/renderer/src/components/SetupScreen.tsx`
- Create: `src/renderer/src/components/ConnectionStatus.tsx`

- [ ] **Step 1: Create SetupScreen component**

Create `src/renderer/src/components/SetupScreen.tsx`:

```tsx
import { useState } from 'react';

interface SetupScreenProps {
  onComplete: (config: {
    mode: 'server' | 'client';
    port?: number;
    serverUrl?: string;
    secret: string;
  }) => void;
}

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [mode, setMode] = useState<'server' | 'client' | null>(null);
  const [port, setPort] = useState('8090');
  const [serverUrl, setServerUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!secret.trim()) {
      setError('Passphrase is required');
      return;
    }

    if (mode === 'server') {
      const portNum = parseInt(port, 10);
      if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
        setError('Port must be between 1024 and 65535');
        return;
      }
      onComplete({ mode: 'server', port: portNum, secret });
    } else if (mode === 'client') {
      if (!serverUrl.trim()) {
        setError('Server URL is required');
        return;
      }
      onComplete({ mode: 'client', serverUrl: serverUrl.trim(), secret });
    }
  };

  if (!mode) {
    return (
      <div className="setup-screen">
        <h1>Relay Setup</h1>
        <p>How will this instance be used?</p>
        <div className="setup-options">
          <button onClick={() => setMode('server')} className="setup-option">
            <h2>Server Mode</h2>
            <p>This is the primary NOC station. Other clients will connect to this instance.</p>
          </button>
          <button onClick={() => setMode('client')} className="setup-option">
            <h2>Client Mode</h2>
            <p>Connect to an existing Relay server on the network.</p>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-screen">
      <h1>Relay Setup — {mode === 'server' ? 'Server' : 'Client'} Mode</h1>
      <button onClick={() => setMode(null)} className="setup-back">
        Back
      </button>
      <form onSubmit={handleSubmit}>
        {mode === 'server' && (
          <label>
            Port:
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              min={1024}
              max={65535}
            />
          </label>
        )}
        {mode === 'client' && (
          <label>
            Server URL:
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://192.168.1.50:8090"
            />
          </label>
        )}
        <label>
          Passphrase:
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Shared passphrase"
          />
        </label>
        {error && <p className="setup-error">{error}</p>}
        <button type="submit">Save and Continue</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Create ConnectionStatus component**

Create `src/renderer/src/components/ConnectionStatus.tsx`:

```tsx
import { useState, useEffect } from 'react';
import {
  getConnectionState,
  onConnectionStateChange,
  type ConnectionState,
} from '../services/pocketbase';

export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionState>(getConnectionState());

  useEffect(() => {
    return onConnectionStateChange(setState);
  }, []);

  if (state === 'online') return null;

  const labels: Record<ConnectionState, string> = {
    connecting: 'Connecting...',
    online: 'Connected',
    offline: 'Offline — using cached data',
    reconnecting: 'Reconnecting...',
  };

  const colors: Record<ConnectionState, string> = {
    connecting: '#f59e0b',
    online: '#10b981',
    offline: '#ef4444',
    reconnecting: '#f59e0b',
  };

  return (
    <div
      className="connection-status"
      style={{
        position: 'fixed',
        bottom: 8,
        right: 8,
        padding: '4px 12px',
        borderRadius: 4,
        backgroundColor: colors[state],
        color: 'white',
        fontSize: 12,
        fontWeight: 500,
        zIndex: 9999,
      }}
    >
      {labels[state]}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SetupScreen.tsx src/renderer/src/components/ConnectionStatus.tsx
git commit -m "feat: add SetupScreen and ConnectionStatus UI components"
```

---

## Phase 8: Main Process Integration

### Task 14: Wire Up PocketBase in Main Process

**Files:**

- Modify: `src/main/index.ts`
- Modify: `src/main/app/appState.ts`
- Create: `src/main/handlers/cacheHandlers.ts`
- Create: `src/main/handlers/setupHandlers.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/ipc.ts`

This is the largest task — it wires the PocketBase process into the Electron main process and updates the IPC layer. Because this touches many files, the implementer should read each file fully before modifying.

- [ ] **Step 1: Add new IPC channels to src/shared/ipc.ts**

Add the following channel constants alongside the existing ones. Do NOT remove the old data channels yet — that happens in the cleanup phase.

```typescript
// Add to IPC_CHANNELS:
// Setup
SETUP_GET_CONFIG: 'setup:getConfig',
SETUP_SAVE_CONFIG: 'setup:saveConfig',
SETUP_IS_CONFIGURED: 'setup:isConfigured',

// Cache (offline mode)
CACHE_READ: 'cache:read',
CACHE_WRITE: 'cache:write',

// PocketBase
PB_GET_URL: 'pb:getUrl',
PB_GET_SECRET: 'pb:getSecret',
```

- [ ] **Step 2: Create setupHandlers.ts**

Create `src/main/handlers/setupHandlers.ts`:

```typescript
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type { AppConfig } from '../config/AppConfig';

export function setupSetupHandlers(appConfig: AppConfig): void {
  ipcMain.handle(IPC_CHANNELS.SETUP_GET_CONFIG, () => {
    return appConfig.load();
  });

  ipcMain.handle(IPC_CHANNELS.SETUP_SAVE_CONFIG, (_event, config) => {
    appConfig.save(config);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SETUP_IS_CONFIGURED, () => {
    return appConfig.isConfigured();
  });
}
```

- [ ] **Step 3: Create cacheHandlers.ts**

Create `src/main/handlers/cacheHandlers.ts`:

```typescript
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type { OfflineCache } from '../cache/OfflineCache';
import type { PendingChanges } from '../cache/PendingChanges';

export function setupCacheHandlers(
  getCache: () => OfflineCache | null,
  getPending: () => PendingChanges | null,
): void {
  ipcMain.handle(IPC_CHANNELS.CACHE_READ, (_event, collection: string) => {
    const cache = getCache();
    if (!cache) return [];
    return cache.readCollection(collection);
  });

  ipcMain.handle(
    IPC_CHANNELS.CACHE_WRITE,
    (_event, collection: string, action: string, record: Record<string, unknown>) => {
      const cache = getCache();
      if (!cache) return;
      cache.updateRecord(collection, action as 'create' | 'update' | 'delete', record);
    },
  );
}
```

- [ ] **Step 4: Update preload to expose new IPC methods**

Add to `src/preload/index.ts` alongside existing methods:

```typescript
// Setup
getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.SETUP_GET_CONFIG),
saveConfig: (config: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SETUP_SAVE_CONFIG, config),
isConfigured: () => ipcRenderer.invoke(IPC_CHANNELS.SETUP_IS_CONFIGURED),

// Cache (offline)
cacheRead: (collection: string) => ipcRenderer.invoke(IPC_CHANNELS.CACHE_READ, collection),
cacheWrite: (collection: string, action: string, record: unknown) =>
  ipcRenderer.invoke(IPC_CHANNELS.CACHE_WRITE, collection, action, record),

// PocketBase
getPbUrl: () => ipcRenderer.invoke(IPC_CHANNELS.PB_GET_URL),
getPbSecret: () => ipcRenderer.invoke(IPC_CHANNELS.PB_GET_SECRET),
```

- [ ] **Step 5: Modify src/main/index.ts to start PocketBase**

This requires reading the current `index.ts` and replacing the FileManager initialization with PocketBase startup. Key changes:

1. Import `AppConfig`, `PocketBaseProcess`, `BackupManager`, `RetentionManager`
2. In the `app.whenReady()` block, after resolving `appRoot`:
   - Create `AppConfig` with `join(appRoot, 'data')`
   - If configured and server mode: create and start `PocketBaseProcess`
   - **Create the `relay_user` auth record if it doesn't exist:**
     ```typescript
     // After PocketBase is healthy, create auth user via Admin API
     const PocketBase = (await import('pocketbase')).default;
     const adminPb = new PocketBase(pbProcess.getLocalUrl());
     // Authenticate as admin (first-run creates admin automatically)
     try {
       const users = await adminPb.collection('users').getFullList();
       if (users.length === 0) {
         await adminPb.collection('users').create({
           username: 'relay',
           password: config.secret,
           passwordConfirm: config.secret,
           name: 'Relay User',
         });
       }
     } catch (err) {
       logger.error('Failed to create auth user', { error: err });
     }
     ```
   - Register `PB_GET_URL` and `PB_GET_SECRET` IPC handlers
   - If legacy data detected: run `JsonMigrator`
   - Start `BackupManager` with scheduled daily backups:
     ```typescript
     const backupManager = new BackupManager(join(appRoot, 'data'));
     // Schedule daily backup
     setInterval(() => backupManager.backup(), 24 * 60 * 60 * 1000);
     backupManager.backup(); // Initial backup on startup
     ```
   - Start `RetentionManager` scheduled cleanup
3. In `app.on('before-quit')`: stop PocketBase process, stop retention manager
4. Set CSP `connect-src` dynamically based on config:
   ```typescript
   // In BrowserWindow webPreferences or session handler:
   const pbUrl = config.mode === 'server' ? `http://127.0.0.1:${config.port}` : config.serverUrl;
   // Add to existing CSP: connect-src 'self' ${pbUrl}
   ```
5. Update `appState.ts` to hold the new state shape:
   ```typescript
   // Replace fileManager with:
   pbProcess: PocketBaseProcess | null;
   appConfig: AppConfig;
   offlineCache: OfflineCache | null; // client mode only
   pendingChanges: PendingChanges | null; // client mode only
   backupManager: BackupManager | null; // server mode only
   retentionManager: RetentionManager | null; // server mode only
   ```

The exact edits depend on the current structure of `index.ts`. The implementer should read the file fully, identify the FileManager init block (around lines 144-152), and replace it with the PocketBase lifecycle above.

- [ ] **Step 6: Update ipcHandlers.ts to register new handlers**

Add calls to `setupSetupHandlers` and `setupCacheHandlers` in the handler registration function.

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No type errors (or only pre-existing ones)

- [ ] **Step 8: Commit**

```bash
git add src/main/ src/preload/ src/shared/
git commit -m "feat: wire PocketBase process lifecycle into Electron main"
```

---

## Phase 9: Renderer Integration

### Task 15: Wrap App with PocketBase Provider

**Files:**

- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Read App.tsx fully to understand current structure**

Read: `src/renderer/src/App.tsx`

- [ ] **Step 2: Add PocketBase initialization to App**

Wrap the existing `MainApp` component. On startup:

1. Check if configured via `window.api.isConfigured()`
2. If not configured: show `SetupScreen`
3. If configured: get PB URL and secret via IPC, init PocketBase SDK, authenticate
4. Show `ConnectionStatus` indicator
5. Replace `useAppData` hook (which uses IPC) with PocketBase-based data loading

The implementer should identify the current `useAppData` hook call and replace it with `usePocketBase` + per-collection `useCollection` hooks.

- [ ] **Step 3: Run dev server and verify app loads**

Run: `npm run dev`
Expected: App launches, shows setup screen on first launch (no config.json yet)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/
git commit -m "feat: integrate PocketBase SDK in renderer with setup flow"
```

---

### Task 16: Migrate Renderer Components from IPC to Services

**Files:**

- Modify: All renderer components that currently use `globalThis.api.*` for data operations

This is a search-and-replace task across the renderer. The implementer should:

1. Search for all `globalThis.api.` calls related to data (contacts, servers, oncall, groups, history, notes, locations, alerts)
2. Replace each with the corresponding service function import
3. Replace subscription patterns (`window.api.subscribeToData`) with `useCollection` hooks
4. Keep non-data `globalThis.api.*` calls (window management, dialogs, platform detection)

- [ ] **Step 1: Find all data API call sites**

Run:

```bash
grep -rn "globalThis.api\.\|window.api\." src/renderer/ --include="*.tsx" --include="*.ts" | grep -v "node_modules"
```

- [ ] **Step 2: Migrate each component**

For each component found in step 1, replace data IPC calls with service imports. Example pattern:

Before:

```typescript
const result = await globalThis.api.addContact(contact);
```

After:

```typescript
import { addContact } from '../services/contactService';
const result = await addContact(contact);
```

Before:

```typescript
const contacts = appData.contacts;
```

After:

```typescript
const { data: contacts } = useCollection<ContactRecord>('contacts');
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Run dev server and smoke test**

Run: `npm run dev`
Expected: All tabs load, data displays, CRUD operations work

- [ ] **Step 5: Commit**

```bash
git add src/renderer/
git commit -m "feat: migrate all renderer components from IPC to PocketBase services"
```

---

## Phase 10: Backup and Retention

### Task 17: Backup and Retention Enforcement

**Files:**

- Create: `src/main/pocketbase/BackupManager.ts`
- Create: `src/main/pocketbase/RetentionManager.ts`

- [ ] **Step 1: Create BackupManager**

Create `src/main/pocketbase/BackupManager.ts`:

```typescript
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { loggers } from '../logger';
// Add to src/main/logger.ts: backup: logger.createChild('Backup')
const logger = loggers.backup;

export class BackupManager {
  private backupsDir: string;
  private dbPath: string;
  private maxBackups = 10;

  constructor(dataDir: string) {
    this.backupsDir = join(dataDir, 'backups');
    this.dbPath = join(dataDir, 'pb_data', 'data.db');
    mkdirSync(this.backupsDir, { recursive: true });
  }

  backup(): string | null {
    if (!existsSync(this.dbPath)) {
      logger.warn('No database file to back up');
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(this.backupsDir, `${timestamp}.db`);

    try {
      copyFileSync(this.dbPath, backupPath);
      logger.info('Backup created', { path: backupPath });
      this.pruneOldBackups();
      return backupPath;
    } catch (err) {
      logger.error('Backup failed', { error: err });
      return null;
    }
  }

  private pruneOldBackups(): void {
    const files = readdirSync(this.backupsDir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => ({
        name: f,
        path: join(this.backupsDir, f),
        mtime: statSync(join(this.backupsDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const file of files.slice(this.maxBackups)) {
      rmSync(file.path);
      logger.info('Pruned old backup', { path: file.path });
    }
  }

  listBackups(): Array<{ name: string; date: Date; size: number }> {
    if (!existsSync(this.backupsDir)) return [];
    return readdirSync(this.backupsDir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const stat = statSync(join(this.backupsDir, f));
        return { name: f, date: stat.mtime, size: stat.size };
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }
}
```

- [ ] **Step 2: Create RetentionManager**

Create `src/main/pocketbase/RetentionManager.ts`:

```typescript
import type PocketBase from 'pocketbase';
import { loggers } from '../logger';
// Add to src/main/logger.ts: retention: logger.createChild('Retention')
const logger = loggers.retention;

export class RetentionManager {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private pb: PocketBase) {}

  async runCleanup(): Promise<void> {
    await this.cleanBridgeHistory();
    await this.cleanAlertHistory();
    await this.cleanConflictLog();
    logger.info('Retention cleanup complete');
  }

  startSchedule(intervalMs = 24 * 60 * 60 * 1000): void {
    this.runCleanup().catch((err) => logger.error('Cleanup failed', { error: err }));
    this.interval = setInterval(() => {
      this.runCleanup().catch((err) => logger.error('Scheduled cleanup failed', { error: err }));
    }, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async cleanBridgeHistory(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const old = await this.pb
        .collection('bridge_history')
        .getFullList({ filter: `created < "${thirtyDaysAgo}"` });
      for (const record of old) {
        await this.pb.collection('bridge_history').delete(record.id);
      }

      // Enforce max 100
      const all = await this.pb.collection('bridge_history').getFullList({ sort: '-created' });
      for (const record of all.slice(100)) {
        await this.pb.collection('bridge_history').delete(record.id);
      }
    } catch (err) {
      logger.error('Bridge history cleanup failed', { error: err });
    }
  }

  private async cleanAlertHistory(): Promise<void> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    try {
      // Delete unpinned older than 90 days
      const old = await this.pb
        .collection('alert_history')
        .getFullList({ filter: `pinned = false && created < "${ninetyDaysAgo}"` });
      for (const record of old) {
        await this.pb.collection('alert_history').delete(record.id);
      }

      // Enforce max 50 unpinned
      const unpinned = await this.pb
        .collection('alert_history')
        .getFullList({ filter: 'pinned = false', sort: '-created' });
      for (const record of unpinned.slice(50)) {
        await this.pb.collection('alert_history').delete(record.id);
      }

      // Enforce max 100 pinned
      const pinned = await this.pb
        .collection('alert_history')
        .getFullList({ filter: 'pinned = true', sort: '-created' });
      for (const record of pinned.slice(100)) {
        await this.pb.collection('alert_history').delete(record.id);
      }
    } catch (err) {
      logger.error('Alert history cleanup failed', { error: err });
    }
  }

  private async cleanConflictLog(): Promise<void> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const old = await this.pb
        .collection('conflict_log')
        .getFullList({ filter: `created < "${ninetyDaysAgo}"` });
      for (const record of old) {
        await this.pb.collection('conflict_log').delete(record.id);
      }
    } catch (err) {
      logger.error('Conflict log cleanup failed', { error: err });
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/pocketbase/BackupManager.ts src/main/pocketbase/RetentionManager.ts
git commit -m "feat: add BackupManager and RetentionManager for data lifecycle"
```

---

## Phase 11: Cleanup

### Task 18: Remove Old JSON Data Layer

**Files:**

- Delete: `src/main/operations/` (entire directory)
- Delete: `src/main/handlers/dataHandlers.ts`
- Delete: `src/main/handlers/dataRecordHandlers.ts`
- Delete: `src/main/handlers/featureHandlers.ts`
- Delete: `src/main/handlers/fileHandlers.ts`
- Review: `src/main/handlers/authHandlers.ts` — check if it handles auth that is now replaced by PocketBase's built-in auth. If so, delete or refactor. If it handles credential encryption for other features (email, etc.), keep it.
- Modify: `src/main/ipcHandlers.ts` (remove references to deleted handlers)
- Modify: `src/preload/index.ts` (remove old data API methods)
- Modify: `src/shared/ipc.ts` (remove old data channel constants)
- Modify: `package.json` (remove chokidar)
- Modify: `src/main/logger.ts` (add new child loggers: pocketbase, sync, migration, backup, retention)

- [ ] **Step 1: Delete old operations directory**

```bash
rm -rf src/main/operations/
```

- [ ] **Step 2: Delete old data handler files**

```bash
rm -f src/main/handlers/dataHandlers.ts
rm -f src/main/handlers/dataRecordHandlers.ts
rm -f src/main/handlers/featureHandlers.ts
rm -f src/main/handlers/fileHandlers.ts
```

- [ ] **Step 3: Remove handler registrations from ipcHandlers.ts**

Remove the imports and calls for the deleted handlers. Keep: configHandlers, weatherHandlers, locationHandlers, windowHandlers, cloudStatusHandlers, loggerHandlers. Add: setupHandlers, cacheHandlers.

- [ ] **Step 4: Remove old data API methods from preload**

Remove all data CRUD methods from `src/preload/index.ts` that are now handled by PocketBase SDK. Keep: window management, native dialogs, platform info, cache methods, setup methods.

- [ ] **Step 5: Remove old IPC channel constants from src/shared/ipc.ts**

Remove all data-related channel constants. Keep: window, weather, location, cloud status, logger channels. Keep: the new setup, cache, and PB channels.

- [ ] **Step 6: Remove chokidar dependency**

```bash
npm uninstall chokidar
```

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No type errors. Fix any remaining references to deleted code.

- [ ] **Step 8: Run unit tests**

Run: `npm run test:unit`
Expected: All remaining tests pass. Old tests in operations/**tests**/ were deleted with the directory.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: remove JSON data layer, chokidar, and old IPC handlers"
```

---

## Phase 12: Integration Testing

### Task 19: End-to-End Smoke Test

- [ ] **Step 1: Start PocketBase in dev mode**

```bash
npm run dev
```

- [ ] **Step 2: Verify first-launch setup flow**

1. App should show SetupScreen (no config.json exists)
2. Select "Server Mode", set port 8090, enter a passphrase
3. Config saves, PocketBase starts, app transitions to main UI

- [ ] **Step 3: Verify CRUD on each tab**

1. **People tab:** Create a contact, edit it, delete it
2. **Servers tab:** Create a server, edit it, delete it
3. **On-Call tab:** Add a team, add members, reorder, delete
4. **Compose tab:** Create a bridge group, compose a message, verify history
5. **Weather tab:** Save a location, set as default, delete

- [ ] **Step 4: Verify realtime sync**

1. Open a second Electron window (if supported) or use PocketBase admin UI
2. Add a record in one window
3. Verify it appears in the other within seconds

- [ ] **Step 5: Verify backup**

1. Trigger a backup from the UI
2. Check `data/backups/` for the backup file

- [ ] **Step 6: Verify import/export**

1. Export contacts as JSON → verify file contents
2. Export contacts as Excel → open in spreadsheet, verify formatting
3. Import a test CSV → verify records appear

- [ ] **Step 7: Verify client mode (if possible)**

1. Build a second instance configured as client pointing at the dev server
2. Verify data loads from server
3. Stop the server → verify offline indicator appears
4. Make a change while offline → restart server → verify sync

- [ ] **Step 8: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during integration testing"
```

---

## Deferred Items (Post-MVP)

These items from the spec are intentionally deferred to keep the initial implementation focused:

1. **Conflict log viewer UI** — The spec describes a viewable conflict log with "Restore this version" functionality. The `conflict_log` collection and `SyncManager` write logic are implemented, but no renderer component for viewing/restoring conflicts is included in this plan. Add as a follow-up task once the core integration is stable.

2. **SSE `onerror`/`onclose` wiring** — The health check heartbeat covers offline detection, but explicitly wiring SSE connection lifecycle events (`onerror`, `onclose`) from PocketBase's realtime subscriptions into the connection state machine would improve responsiveness. Can be added once the basic realtime flow is working.

---

## Task Dependency Summary

```
Task 1 (deps + build config)
  → Task 2 (app config)
    → Task 3 (PB process lifecycle)
      → Task 4 (schema migrations)
        → Task 14 (main process wiring)

Task 5 (PB SDK + connection state)
  → Task 6 (useCollection hook)
    → Task 7 (service layer)
      → Task 15 (App.tsx integration)
        → Task 16 (component migration)

Task 8 (offline cache)
  → Task 9 (pending changes)
    → Task 10 (sync manager)
      → Task 14 (main process wiring)

Task 11 (JSON migrator) → Task 14

Task 12 (import/export) → Task 16

Task 13 (setup + status UI) → Task 15

Task 17 (backup + retention) → Task 14

Task 18 (cleanup) → Task 16, Task 17

Task 19 (integration test) → Task 18
```

**Parallelizable tracks:**

- Track A: Tasks 1 → 2 → 3 → 4 (foundation)
- Track B: Tasks 5 → 6 → 7 (renderer services) — can start after Task 1
- Track C: Tasks 8 → 9 → 10 (offline support) — can start after Task 1
- Track D: Task 11 (migration) — can start after Task 4
- Track E: Task 12 (import/export) — can start after Task 7
- Track F: Task 13 (UI components) — can start after Task 5

Tracks converge at Task 14 (wiring), then Task 15/16 (renderer integration), then Task 18 (cleanup), then Task 19 (testing).
