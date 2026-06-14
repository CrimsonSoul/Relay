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

### IPC Sender Validation

`src/main/utils/trustedSender.ts` provides `assertTrustedIpcSender`, which every IPC handler calls at entry. It confirms the sender frame is the main frame of a Relay window (matching the dev-server origin in development or the `dist/renderer` file URL in production) and rejects anything else with a security log line. This is defense-in-depth: navigation lockdown makes untrusted senders unreachable today, but the check keeps that true if a navigation guard ever regresses.

### Electron Fuses

`electron-builder.yml` configures Electron fuses at build time:

| Fuse                                    | State    |
| --------------------------------------- | -------- |
| `RunAsNode`                             | disabled |
| `EnableNodeOptionsEnvironmentVariable`  | disabled |
| `EnableNodeCliInspectArguments`         | disabled |
| `OnlyLoadAppFromAsar`                   | enabled  |
| `EnableEmbeddedAsarIntegrityValidation` | disabled |

`EnableEmbeddedAsarIntegrityValidation` is intentionally left off: electron-builder signs the unpacked native module (`better-sqlite3`) after computing the asar integrity hashes, which causes a startup integrity violation on every signed build. Re-enable once the builder computes integrity post-signing.

### CSP Meta Fallback

`electron.vite.config.ts` injects a `<meta http-equiv="Content-Security-Policy">` tag into `dist/renderer/index.html` at build time. This mirrors the production response-header CSP (`securityHeaders.ts`) and provides a defense-in-depth layer for the packaged `file://` load path where session-level headers take effect but the meta tag adds a second enforcement point.

### Navigation And Window Controls

Relay blocks unexpected navigation and secondary window creation paths in `src/main/app/windowFactory.ts`.

Controls in place:

- Main and auxiliary windows reject unexpected `will-navigate` requests
- `window.open()` is denied for app windows
- Auxiliary windows are limited to an allowlisted route set
- Auxiliary windows are capped at 5 concurrent instances

### External Dashboard Popouts

Dynatrace dashboard popouts are handled by `src/main/dynatrace/DynatraceWindowManager.ts`.

Security controls in place:

- The Relay chrome shell is loaded from the trusted renderer URL or packaged renderer file only
- Dashboard content is loaded into a separate `WebContentsView`
- Dashboard content uses the isolated `persist:relay-dynatrace` session partition
- Permission requests and permission checks from the dashboard session are denied
- External navigation is limited to HTTPS `dynatrace.com` hosts and Microsoft authentication hosts required for SSO
- `window.open()` from dashboard content is denied; allowed Dynatrace or Microsoft auth popups are loaded in the same dashboard view
- Blocked navigation logs use origin-only URL descriptions to avoid leaking dashboard query strings or auth details
- Settings can clear the Dynatrace dashboard session when operators need to force reauthentication

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

### Connection Passphrase Storage

`src/main/config/AppConfig.ts` stores the Relay connection passphrase encrypted with Electron `safeStorage` when available. A plaintext fallback exists for environments where Electron encryption is unavailable, such as headless CI.

Settings displays the local server URL and passphrase so operators can connect Relay clients without hunting through config files. Treat that screen as sensitive local operator context and avoid sharing screenshots that expose real passphrases.

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

### PocketBase Network Exposure

New server setup binds PocketBase to `127.0.0.1` by default. Direct LAN access requires an explicit setup opt-in and should be used only on trusted operator-controlled networks.

Client setup accepts HTTPS Relay server URLs by default and also supports HTTP for trusted LAN targets, including private IP addresses, `.local` names, and single-label machine names used for NOC desktop-to-laptop deployments. Public HTTP requires the explicit insecure HTTP opt-in. Use HTTPS when Relay traffic leaves the trusted LAN so the shared Relay passphrase is not sent over cleartext WAN links.

When the server is LAN-bound (`0.0.0.0`), Relay advertises a `_relay._tcp` service via mDNS, and the service name includes the machine hostname. Advertisement stops when the instance is reconfigured to client mode, rebound to loopback, or quit. Discovery results shown during client setup are filtered to private/LAN addresses, so an mDNS advertiser cannot present a WAN address as a local Relay server.

### PocketBase Bootstrap

Relay manages its own collections at startup. Bootstrap creates missing Relay collections, adds missing fields, and re-applies authenticated API rules to existing managed collections.

Unknown collections are left in place and logged as unmanaged. Startup must not delete application or operator-created collections outside Relay's managed collection list.

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

### URL Logging

Blocked-navigation and blocked-window-open log lines record the origin of the attempted URL only (via `describeUrlForLog` in `src/shared/urlSecurity.ts`), not the full URL. This avoids inadvertently logging tokens, session IDs, or other data carried in paths or query strings.

## Developer Rules

- Do not expose new Electron or Node.js APIs directly to the renderer
- Validate all new IPC payloads in shared schemas before handling them
- Keep file-system access in the main process and run it through path validation
- Escape user input in PocketBase filter strings
- Log security-relevant failures without logging raw secrets

## Reporting Issues

Report security vulnerabilities privately to the project maintainers. Do not open public issues for exploitable security bugs.
