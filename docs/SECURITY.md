# Security Guide

Current security model and implementation notes for Relay.

## Overview

Relay is an Electron desktop application that handles operational data, local configuration, and network-backed services. The security model centers on a narrow renderer surface, validated IPC, and encrypted storage for sensitive secrets where Electron supports it.

## Trust Boundaries

### Main Process

The main process is trusted code with access to Electron, Node.js, the local file system, and OS integrations.

Primary responsibilities:

- Window creation and lifecycle
- PocketBase bootstrap and local background services
- IPC handler registration
- File system and shell operations
- Security header enforcement
- Credential and config secret handling

Key files:

- `src/main/index.ts`
- `src/main/app/windowFactory.ts`
- `src/main/app/securityHeaders.ts`

### Preload

The preload script exposes a typed `window.api` bridge and is the only renderer-facing Electron boundary.

Key file:

- `src/preload/index.ts`

### Renderer

The renderer runs with:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`

The renderer does not import Node.js or Electron APIs directly. System-level operations go through the preload bridge. PocketBase data CRUD is performed with the PocketBase SDK rather than IPC.

## Runtime Hardening

### Navigation And Window Controls

Relay blocks unexpected navigation and secondary window creation paths in `src/main/app/windowFactory.ts`.

Controls in place:

- Main and auxiliary windows reject unexpected `will-navigate` requests
- `window.open()` is denied for app windows
- Auxiliary windows are limited to an allowlisted route set
- Auxiliary windows are capped at 5 concurrent instances

### Content Security Policy

`src/main/app/securityHeaders.ts` installs CSP and related response headers on the default Electron session.

Highlights:

- `default-src 'self'`
- Strict `connect-src` allowlist for PocketBase endpoints
- `object-src 'none'`
- `base-uri 'self'`
- `form-action 'self'`

Development mode relaxes `script-src` only as needed for HMR.

## Validation And Rate Limiting

### IPC Validation

Shared IPC schemas live in `src/shared/ipcValidation.ts`. Handlers validate input before acting on it and return safe failures for invalid payloads.

Related files:

- `src/shared/ipc.ts`
- `src/shared/ipcValidation.ts`
- `src/main/handlers/ipcHelpers.ts`

### Path Validation

File operations validate paths before touching disk.

Key files:

- `src/main/utils/pathValidation.ts`
- `src/main/utils/pathSafety.ts`

### Cache IPC Validation

`src/main/handlers/cacheHandlers.ts` restricts cache access with explicit allowlists.

Checks include:

- Collection name allowlist
- Mutation action allowlist (`create`, `update`, `delete`)
- Record shape validation for writes

### Rate Limiting

`src/main/rateLimiter.ts` applies token-bucket rate limiting to expensive or sensitive IPC paths.

Current buckets:

| Bucket            | Purpose                         |
| ----------------- | ------------------------------- |
| `fileImport`      | Import operations               |
| `dataMutation`    | Mutation-oriented IPC handlers  |
| `dataReload`      | Full reload requests            |
| `fsOperations`    | File and shell actions          |
| `network`         | Outbound network requests       |
| `rendererLogging` | Renderer-to-main log forwarding |

When a request is blocked, the limiter returns `retryAfterMs` and logs the event through the IPC logger.

## Secrets And Local Data

### Config Secret Storage

`src/main/config/AppConfig.ts` stores the Relay config secret encrypted with Electron `safeStorage` when available. A plaintext fallback exists for environments where Electron encryption is unavailable, such as headless CI.

### Credential Storage

`src/main/credentialManager.ts` handles proxy and auth credential caching.

Current behavior:

- Credentials are encrypted with `safeStorage` when supported
- Authentication requests are bound to a one-time nonce
- Cached credentials expire and are pruned automatically

### PocketBase Data

Relay data is stored in PocketBase's SQLite database. This database is not encrypted by Relay itself.

Recommended deployment assumption:

- Use full-disk encryption when the workstation or server handles sensitive operational data

## Backups, Sync, And Resilience

### Backup Safety

`src/main/handlers/backupHandlers.ts` validates backup filenames before restore and rejects traversal attempts.

### Offline Cache And Replay

The offline cache and replay pipeline live in:

- `src/main/cache/OfflineCache.ts`
- `src/main/cache/PendingChanges.ts`
- `src/main/cache/SyncManager.ts`

This design provides:

- Read fallback while PocketBase is unavailable
- Queued writes for reconnect scenarios
- Conflict logging via the `conflict_log` collection

### Error Handling

`src/main/app/errorHandlers.ts` installs process-level guards.

Current behavior:

- Uncaught exceptions show a blocking dialog with `Quit` and `Continue`
- Repeated unhandled rejections within a rolling window trigger a renderer stability warning

### Log Redaction

Structured logs are redacted before persistence.

Key file:

- `src/shared/logRedaction.ts`

The redaction layer strips common sensitive fields and scans strings for PII such as emails and phone numbers.

## Developer Rules

- Do not expose new Electron or Node.js APIs directly to the renderer
- Validate all new IPC payloads in shared schemas before handling them
- Keep file-system access in the main process and run it through path validation
- Escape user input in PocketBase filter strings
- Log security-relevant failures without logging raw secrets

## Reporting Issues

Report security vulnerabilities privately to the project maintainers. Do not open public issues for exploitable security bugs.
