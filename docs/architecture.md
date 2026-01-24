# Operators Atelier architecture

This document captures deeper implementation guidance for the Electron + Vite desktop app, focusing on data handling, IPC contracts, UI tab behaviors, authentication flows, and test coverage.

## Table of Contents
- [Environment and Setup](#environment-and-setup)
- [Styling Philosophy](#styling-philosophy-analog-precision)
- [Data Handling & Persistence](#data-handling--persistence)
- [Business Logic Layer](#business-logic-layer-srcmainoperations)
- [IPC API](#ipc-api-main--renderer)
- [Tab Behaviors](#tab-behaviors)
- [Authentication & Security](#authentication--security)
- [Testing Strategy](#testing-strategy)
- [State Management Strategy](#state-management-strategy)
- [Database Migration Path](#database-migration-path)
- [Feature Flag System](#feature-flag-system)
- [Memory Management & Performance](#memory-management--performance)
- [Implementation Notes](#implementation-notes)

## Environment and setup
- **Stack**: Electron 34 + React 18 + TypeScript 5.9.
- **Build**: Vite + electron-vite.
- **Development**: `npm run dev` starts Vite in watch mode and boots Electron with hot reload. Keep the console open to monitor main-process logs.
- **Production build**: `npm run build` outputs bundled renderer assets and packages an Electron binary. Run the packaged app to verify IPC wiring outside the dev server.
- **Linting/formatting**: Adopt project defaults (e.g., ESLint/Prettier) to keep main/renderer code style consistent.

## Styling philosophy: Analog Precision
- **Typography & scale**: Use readable sans-serif faces with strict spacing increments (4/8 px). Emphasize labels and numeric readouts.
- **Color**: Prefer muted neutrals for backgrounds, with sparing use of accent colors for alerts and primary actions. Avoid gradients; use solid fills and 1 px keylines for separation.
- **Components**: Buttons and toggles should feel "instrumented"—clear borders, high-contrast focus states, minimal radius. Avoid excessive shadows; rely on consistent elevation tokens.
- **Motion**: Animations should be short (<150 ms) and driven by state change significance (e.g., confirming an action). No looping or decorative motion.

## Data Handling & Persistence
Relay uses a local-first architecture with JSON-based storage for high performance and privacy.

- **Data Root**: Data is stored in the user's data directory (configurable).
- **JSON Storage**: Contacts, servers, on-call schedules, and groups are stored in dedicated JSON files (e.g., `contacts.json`, `servers.json`).
- **Legacy CSV**: Support for importing legacy CSV files (`contacts.csv`, `servers.csv`) is maintained, with migration tools available.
- **Atomic Writes**: All file writes are atomic (using temporary files and rename) to prevent data corruption.
- **Backups**: Automatic backups are created during critical operations (migrations, bulk imports).

## Business Logic Layer (`src/main/operations`)
To maintain clean separation of concerns, business logic is decoupled from IPC handlers and placed in `src/main/operations`.

- **Modular Design**: Each domain (Contacts, Servers, On-Call) has its own operation modules (e.g., `ContactJsonOperations.ts`, `ServerOperations.ts`).
- **Testability**: Operations are pure functions or classes that can be unit tested without mocking Electron IPC.
- **Reusability**: Operations can be called by multiple IPC handlers or internal maintenance tasks.

## IPC API (main ↔ renderer)
- **Principles**: Narrow, declarative channels; validate payloads; never expose `remote` or Node globals to the renderer.
- **Structure**: Handlers are organized by domain in `src/main/handlers/`.
- **Validation**: All IPC inputs are validated using Zod schemas (`src/shared/ipcValidation.ts`) before processing.

### Key Channels
- **Data Records**: CRUD operations for contacts, servers, etc. (e.g., `data:addContact`, `data:getServers`).
- **Configuration**: App settings and paths (e.g., `config:getDataPath`).
- **Weather/Location**: External API proxies (e.g., `weather:get`).
- **Logging**: Telemetry from renderer (e.g., `logger:toMain`).

## Tab behaviors
- **Compose (Assembler)**: Build and manage communication bridges. Select contacts/groups and "Draft Bridge" to initiate actions.
- **On-Call (Personnel)**: visual grid of on-call teams. Drag-and-drop reordering, team management, and shift assignments.
- **People (Directory)**: Searchable list of all contacts. Add, edit, or delete personnel.
- **Servers**: Server infrastructure monitoring list with status indicators.
- **Weather**: Dashboard for environmental awareness. Supports multiple locations and severe weather alerts.
- **Radar**: Real-time weather radar visualization.
- **AI Chat**: Sandboxed interface for AI assistants (Gemini, ChatGPT) with privacy controls (auto-clear on exit).

## Authentication & Security
- **Credential Management**: Sensitive credentials (proxies, API keys) are stored using Electron's `safeStorage` API.
- **Interception**: `authHandlers.ts` intercepts HTTP 401 challenges and prompts the user via the renderer, securely caching the result.
- **Context Isolation**: Enabled for all renderer windows. No direct Node.js access.
- **CSP**: Strict Content Security Policy enforced.

## Testing strategy
- **Unit tests (Vitest)**:
  - Located alongside source files (`*.test.ts`) or in `__tests__` directories.
  - Cover operations, utility functions, and validation logic.
  - **Current Coverage**: 37.71% (Target: 60%+)
- **Integration tests**:
  - Test IPC handlers and complex workflows.
  - Focus on main-renderer communication paths.
- **E2E tests (Playwright)**:
  - Located in `tests/e2e/`.
  - Verify critical user paths (startup, navigation, CRUD) on the packaged application.
  - Use `await expect(...).toBeVisible()` patterns for reliability (avoid hardcoded waits).
- **Test Organization**:
  - Main process tests: `src/main/**/*.test.ts`
  - Shared module tests: `src/shared/**/*.test.ts`
  - Renderer tests: `src/renderer/**/*.test.tsx`
  - E2E tests: `tests/e2e/**/*.spec.ts`

## State Management Strategy

### Current Implementation
The application currently uses React Context and hooks for state management:
- **Global State**: App data (contacts, servers, on-call) managed via context providers
- **Local State**: Component-level state with `useState` and `useReducer`
- **Data Synchronization**: FileManager broadcasts updates via EventEmitter pattern

### Evaluation of Advanced Solutions

#### Zustand
**Pros:**
- Minimal boilerplate compared to Redux
- TypeScript-first with excellent type inference
- No Provider wrapper needed
- Supports middleware (persist, devtools)
- ~1KB bundle size

**Cons:**
- Less suitable for complex state trees
- Limited built-in DevTools support

**Recommended Use Cases:**
- Global UI state (theme, preferences)
- Feature flags state
- Performance-critical state updates

#### Jotai
**Pros:**
- Atomic state management model
- Excellent for derived state
- Built-in async support
- TypeScript-first
- ~2KB bundle size

**Cons:**
- Different mental model than Redux/Context
- Smaller ecosystem
- Learning curve for atomic patterns

**Recommended Use Cases:**
- Granular UI state management
- Complex derived state calculations
- Form state management

#### Recommendation
For Relay's architecture, a **hybrid approach** is recommended:
1. **Keep React Context** for app data (contacts, servers, on-call) since it's already synchronized with FileManager
2. **Add Zustand** for UI-specific global state (theme, sidebar state, modal state)
3. **Consider Jotai** for complex forms or derived state calculations if needed

**Migration Path:**
1. Phase 1: Introduce Zustand for new global UI features
2. Phase 2: Migrate non-data global state to Zustand
3. Phase 3: Evaluate performance and decide on full migration

## Database Migration Path

### Current State: JSON Files
**Advantages:**
- Simple, human-readable format
- Easy debugging and manual edits
- Fast for small-to-medium datasets
- No dependencies

**Limitations:**
- Full file rewrites on every update
- No transactional guarantees
- Limited query capabilities
- Performance degrades with large datasets (>10k records)

### Proposed: SQLite Migration

#### Why SQLite?
- **Zero-Config**: Single file database, no server needed
- **ACID Compliant**: Full transactional support
- **Fast**: Efficient indexing and querying
- **Embedded**: No external dependencies
- **Cross-Platform**: Works on all platforms
- **Mature**: Battle-tested, stable API

#### Migration Strategy

**Phase 1: Parallel Write (Recommended First Step)**
- Keep JSON files as primary storage
- Write changes to both JSON and SQLite
- Validate data consistency
- Build confidence in SQLite implementation
- Timeline: 1-2 weeks

**Phase 2: Dual Read with SQLite Primary**
- Switch reads to SQLite
- Keep JSON as backup/fallback
- Monitor performance and errors
- Timeline: 2-4 weeks

**Phase 3: SQLite Only**
- Remove JSON read/write logic
- Keep JSON export functionality for backups
- Implement automatic migration for users
- Timeline: 1 week

#### Technical Implementation

**Libraries:**
- `better-sqlite3`: Fast, synchronous SQLite wrapper
- `drizzle-orm`: Type-safe ORM with excellent TypeScript support
- Alternative: `kysely` for more SQL-like experience

**Schema Design:**
```sql
-- Contacts table
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(email)
);

-- Servers table  
CREATE TABLE servers (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  business_area TEXT,
  lob TEXT,
  comment TEXT,
  owner TEXT,
  contact TEXT,
  os TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(name)
);

-- On-Call table
CREATE TABLE oncall (
  id TEXT PRIMARY KEY,
  team TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  time_window TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_name ON contacts(name);
CREATE INDEX idx_servers_name ON servers(name);
CREATE INDEX idx_oncall_team ON oncall(team);
```

**Encryption:**
- Use `sqlcipher` for database encryption
- Integrate with existing credential management
- Transparent encryption at rest

#### Benefits of Migration
1. **Performance**: 10-100x faster queries for large datasets
2. **Reliability**: ACID transactions prevent data corruption
3. **Scalability**: Handles 100k+ records efficiently
4. **Features**: Full-text search, complex queries, aggregations
5. **Backup**: Point-in-time recovery, easier backup strategies

#### Risks & Mitigation
1. **Risk**: Data loss during migration
   - **Mitigation**: Automatic backup before migration, rollback capability
2. **Risk**: Increased complexity
   - **Mitigation**: Use ORM with good TypeScript support, comprehensive testing
3. **Risk**: Performance regression for small datasets
   - **Mitigation**: Benchmark before/after, optimize indices
4. **Risk**: Cross-platform issues
   - **Mitigation**: Test on all platforms early, use native modules

#### Timeline
- **Phase 1**: 2 weeks (design, parallel write)
- **Phase 2**: 3 weeks (testing, dual read)
- **Phase 3**: 1 week (cutover, cleanup)
- **Total**: 6-8 weeks for full migration

## Feature Flag System

The application now includes a comprehensive feature flag system (`src/shared/featureFlags.ts`):

**Capabilities:**
- Environment-based configuration
- Gradual rollout percentages
- Dev mode overrides
- Runtime enable/disable
- Restart requirements

**Usage:**
```typescript
import { isFeatureEnabled } from '@shared/featureFlags';

if (isFeatureEnabled('enableSQLiteMigration')) {
  // Use SQLite operations
} else {
  // Use JSON operations
}
```

**Environment Variables:**
```bash
FEATURE_FLAG_ENABLE_SQLITE_MIGRATION=true
FEATURE_FLAG_ENABLE_DEBUG_MODE=true
```

## Memory Management & Performance

### File Lock Management
**Implementation**: `src/main/FileManager.ts`
- File locks prevent concurrent writes
- Automatic cleanup via Promise finalizers
- Periodic monitoring (every 5 minutes)
- Manual cleanup on destroy

**Best Practices:**
- Keep lock duration minimal
- Use detached writes for background operations
- Monitor lock count in production

### Electron Process Optimization
**Main Process:**
- Minimize memory footprint via lazy loading
- Use streaming for large file operations
- Implement periodic garbage collection hints

**Renderer Process:**
- Virtual scrolling for large lists (react-window)
- Lazy component loading (React.lazy)
- Memoization for expensive calculations

### Performance Monitoring
**Current:**
- Basic memory logging in file operations
- Error tracking via structured logging

**Recommended Additions:**
- IPC latency tracking
- File operation duration metrics
- Memory usage trends
- CPU profiling for hot paths

## Implementation notes
- Keep a shared `types` module for IPC payloads to reduce drift between main and renderer.
- Prefer reactive streams (e.g., RxJS or simple EventEmitter) in the main process to manage watcher events and backpressure.
- Log with structured messages (JSON) to make it easy to pipe into external observability tools during ops shifts.
