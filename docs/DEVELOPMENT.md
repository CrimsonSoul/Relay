# Development Guide

Current patterns, workflows, and contributor conventions for Relay.

## Overview

Relay is an Electron app with a React renderer, a typed preload bridge, and a PocketBase-backed data model.

Use these directories as the primary mental model:

- `src/main/`: Electron lifecycle, security, IPC handlers, PocketBase bootstrap, offline cache, backup logic
- `src/preload/`: typed `window.api` bridge
- `src/renderer/`: UI, hooks, services, tabs, and styles
- `src/shared/`: shared types, IPC channels, schemas, and utilities

For runtime structure, see `docs/architecture.md`.

## Source Of Truth

These files define the current workflow and should win over stale assumptions:

| File                                          | Purpose                                                     |
| --------------------------------------------- | ----------------------------------------------------------- |
| `package.json`                                | Scripts and tool entry points                               |
| `eslint.config.js`                            | Lint rules and per-layer restrictions                       |
| `vitest.config.ts`                            | Main/shared test config                                     |
| `vitest.renderer.config.ts`                   | Renderer test config                                        |
| `src/shared/ipc.ts`                           | Bridge API and IPC channel definitions                      |
| `src/shared/ipcValidation.ts`                 | Shared IPC validation helpers                               |
| `src/renderer/src/services/pocketbase.ts`     | Renderer PocketBase client and connection state             |
| `src/renderer/src/hooks/useCollection.ts`     | Realtime collection subscription and offline cache fallback |
| `src/renderer/src/hooks/useOptimisticList.ts` | Optimistic list state over realtime data                    |

## Data Access Pattern

### Renderer Services

PocketBase collection CRUD lives in `src/renderer/src/services/`.

Current conventions:

- Initialize PocketBase once through `initPocketBase()`
- Access the shared client through `getPb()`
- Keep collection logic in service modules, not components
- Call `requireOnline()` before writes that should fail fast while offline
- Route API failures through `handleApiError()`

In Relay, normal record CRUD is performed directly from the renderer via the PocketBase SDK. It does not go through Electron IPC.

### Adding A Service

For a new collection-backed feature:

1. Add a service module in `src/renderer/src/services/`
2. Keep the exported API narrow and async
3. Add a hook in `src/renderer/src/hooks/` for UI-facing state and effects
4. Write tests next to the service or in a nearby `__tests__/` directory

Prefer using `createCrudService<T>()` from `crudServiceFactory.ts` when the collection only needs standard CRUD behavior.

### PocketBase Filters

Escape user-provided values with `escapeFilter()` before interpolating them into PocketBase filter strings.

```ts
import { escapeFilter, getPb } from './pocketbase';

const record = await getPb()
  .collection('contacts')
  .getFirstListItem(`email="${escapeFilter(email)}"`);
```

## IPC Pattern

IPC is reserved for work the renderer should not do directly.

Current examples:

- Window management
- Setup and PocketBase connection bootstrap
- Weather, radar, and location lookups
- Cloud status aggregation
- Clipboard and shell/file-system actions
- Alert image and logo persistence
- Offline cache reads and sync triggers
- Backup creation and restore
- Renderer-to-main logging

Rules:

- Define channels and bridge types in `src/shared/ipc.ts`
- Validate payloads with shared schemas from `src/shared/ipcValidation.ts`
- Expose new bridge methods from `src/preload/index.ts`
- Keep handlers in `src/main/handlers/`

## Connection, Realtime, And Offline Behavior

### Connection State

`src/renderer/src/services/pocketbase.ts` owns the renderer connection lifecycle.

Current connection states:

- `connecting`
- `online`
- `offline`
- `reconnecting`

Use:

- `onConnectionStateChange()` to subscribe
- `isOnline()` to branch behavior
- `requireOnline()` to reject writes while disconnected

### Realtime Collections

`useCollection()` is the standard pattern for list data backed by PocketBase realtime subscriptions.

It handles:

- Initial full fetch
- Realtime subscription setup
- Sort preservation for incoming events
- Offline cache fallback
- Reconnect-triggered resubscribe and pending-sync flush

### Optimistic Lists

When UI state needs optimistic updates on top of realtime collection data, layer `useOptimisticList()` on top of `useCollection()`.

This prevents external realtime events from overwriting local optimistic state while mutations are still settling.

## Renderer Conventions

### Hooks

Hooks in `src/renderer/src/hooks/` should own:

- Feature-level state
- Side effects
- Service orchestration
- View-facing callbacks

Components should stay focused on rendering and local interaction details.

### Tab Loading

`src/renderer/src/App.tsx` uses a mount-once tab model.

Current behavior:

- Compose loads eagerly
- Most other tabs are lazy-loaded
- Visited tabs remain mounted to preserve local state and scroll position

### Styling

Relay uses plain CSS plus shared design tokens.

Conventions:

- Reuse existing tokens in `src/renderer/src/styles/theme.css`
- Reuse shared primitives such as `TactileButton`, `.tactile-input`, and `.card-surface`
- Keep feature-specific CSS near the feature when that pattern already exists

For UI guidance, see `docs/DESIGN.md`.

## Testing

### Test Suites

Relay uses two Vitest configurations:

| Suite       | Config                      | Environment |
| ----------- | --------------------------- | ----------- |
| Main/shared | `vitest.config.ts`          | Node        |
| Renderer    | `vitest.renderer.config.ts` | jsdom       |

Common commands:

```bash
npm test
npm run test:unit
npm run test:renderer
npm run test:coverage
npm run test:electron
```

Coverage thresholds are currently 80% for lines, functions, branches, and statements in both Vitest configs.

### Renderer Test Setup

`src/renderer/test/setup.ts` provides the shared renderer test environment.

It currently:

- Loads `@testing-library/jest-dom`
- Patches missing `HTMLDialogElement` methods in jsdom
- Provides a localStorage fallback when needed

If a hook or component depends on toast context, wrap it with `NoopToastProvider` from `src/renderer/src/components/Toast.tsx`.

### Test Placement

Both of these patterns are already used in the repo:

- Adjacent `*.test.ts` or `*.test.tsx` files
- Nearby `__tests__/` directories

Match the surrounding feature instead of introducing a new structure.

## Linting And Code Style

Relay uses ESLint flat config plus Prettier.

Important current rules from `eslint.config.js`:

- `@typescript-eslint/no-explicit-any`: `error` in app code, `warn` in tests
- `@typescript-eslint/no-floating-promises`: `error`
- `@typescript-eslint/no-misused-promises`: `error` in app code
- `react-hooks/rules-of-hooks`: `error`
- `jsx-a11y` rules are enabled in renderer code
- `jsx-a11y/no-autofocus` is intentionally disabled for current modal/search behavior

Renderer, main, preload, and shared code all have slightly different lint environments. Check the file globs in `eslint.config.js` before assuming a rule applies everywhere.

## Practical Contributor Rules

- Prefer the smallest correct change over broad refactors
- Keep domain CRUD in renderer services, not React components
- Use IPC only for privileged or system-level work
- Validate new IPC payloads in shared schemas
- Reuse existing hooks and shared UI primitives before adding new abstractions
- Keep docs aligned with current code paths instead of preserving old architecture notes
