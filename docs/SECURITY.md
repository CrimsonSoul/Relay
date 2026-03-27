# Security Policy

## Overview

Relay is a desktop application built with Electron that handles sensitive operational data. This document outlines our security model, threat considerations, and implementation details.

## Security Architecture

### Context Isolation & Sandboxing

**Main Process:**

- Runs with full Node.js access
- Manages file system operations, IPC handlers, and system integrations
- No direct exposure to untrusted content

**Renderer Process:**

- Context isolation enabled (`contextIsolation: true`)
- Node integration disabled (`nodeIntegration: false`)
- Sandbox mode enabled (`sandbox: true`)
- Communication only via secure IPC bridge (preload script)

**Preload Script:**

- Acts as a secure bridge between main and renderer
- Exposes only explicitly defined APIs via `contextBridge`
- No direct access to Node.js or Electron APIs from renderer

### Rate Limiting

IPC operations are protected by a token-bucket rate limiter (`src/main/rateLimiter.ts`). Each bucket has a configurable burst capacity and per-second refill rate:

| Bucket            | Burst | Refill    | Scope                                     |
| ----------------- | ----- | --------- | ----------------------------------------- |
| `fileImport`      | 5     | 1 per 10s | CSV/file import operations                |
| `dataMutation`    | 100   | 10/s      | CRUD operations (add/remove/update)       |
| `dataReload`      | 3     | 1 per 2s  | Full data reload requests                 |
| `fsOperations`    | 10    | 2/s       | Open-path, open-external shell operations |
| `network`         | 10    | 1/s       | Outbound network requests                 |
| `rendererLogging` | 60    | 20/s      | Renderer-to-main log forwarding           |

When a bucket is exhausted the request is rejected and a `retryAfterMs` value is returned. Rate-limit events are logged to the `ipc` logger.

### Content Security Policy (CSP)

The application enforces a strict Content Security Policy:

**Production:**

```
default-src 'self';
script-src 'self' 'sha256-[hash]';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
connect-src 'self' [whitelisted APIs];
font-src 'self' data:;
frame-src 'self' [trusted domains];
```

**Development:**

- Relaxed script-src to allow HMR: `'unsafe-eval' 'unsafe-inline'`
- All other restrictions remain in place

**Additional Headers:**

- `X-Content-Type-Options: nosniff` - Prevents MIME type sniffing
- `X-Frame-Options: DENY` - Prevents clickjacking
- `X-XSS-Protection: 1; mode=block` - Enables XSS filtering
- `Referrer-Policy: strict-origin-when-cross-origin` - Controls referrer information

### WebView Isolation

**AI Chat Feature:**

- Uses `<webview>` tags to embed external AI services (Gemini, ChatGPT)
- **Partition Isolation:** All AI webviews use `partition="ai-chat-session"` for isolated storage/cookies
- **Automatic Cleanup:** Session data is cleared when the tab is unmounted or app exits
- **User Agent Masking:** Uses modern Chrome user agent to ensure compatibility
- **No File Access:** AI webviews cannot access local file system
- **Suspended State:** Webviews are suspended when not active to reduce resource usage

**Security Considerations:**

- AI webviews are explicitly marked as untrusted content
- No sensitive application data is shared with AI services
- Users are warned that data clears on tab exit
- Consider implementing additional CSP for webview content if needed

### Credential Management

**Storage:**

- Sensitive credentials (proxy auth, API keys) use Electron's `safeStorage` API
- Data is encrypted at rest using OS-level encryption:
  - **Windows:** Data Protection API (DPAPI)
  - **macOS:** Keychain
  - **Linux:** libsecret / gnome-keyring
- Credentials are stored in app's userData directory with OS-level encryption

**Authentication Flow:**

1. HTTP 401 challenges are intercepted by the main process
2. A secure nonce (32 random bytes, hex-encoded) is generated and associated with the auth callback
3. User is prompted securely via IPC; the renderer must present the correct nonce to complete auth
4. Nonces are one-time-use and expire after 5 minutes — expired/invalid nonces are rejected
5. Credentials can be optionally cached in-memory using `safeStorage` encryption (30-minute TTL, refreshed on use)
6. Periodic cleanup (every 60 seconds) prunes expired nonces and cached credentials

### Input Validation

**Path Validation:**

- All file paths are validated against allowed directories
- Path traversal attempts (`../`, `..\\`) are blocked
- Absolute paths outside data directory are rejected
- Implemented in: `src/main/pathValidation.ts`, `src/main/utils/pathSafety.ts`

**IPC Validation:**

- All IPC messages are validated using Zod schemas
- Type-safe validation for all inputs
- Rate limiting on sensitive operations
- Implemented in: `src/shared/ipcValidation.ts`, `src/main/ipcHandlersValidation.ts`

**Cache Handler Validation:**

- Cache IPC handlers (`CACHE_READ`, `CACHE_WRITE`, `CACHE_SNAPSHOT`) validate the `collection` parameter against a hard-coded allowlist of known collection names (e.g. `contacts`, `servers`, `oncall`, `notes`, `alert_history`, etc.)
- `CACHE_WRITE` additionally validates the `action` parameter against an allowlist of `create | update | delete` and rejects non-object records
- Invalid requests are logged and silently dropped — no data is returned or written
- Implemented in: `src/main/handlers/cacheHandlers.ts`

**Backup Restore Validation:**

- Backup filenames are validated with a strict regex (`/^[\w.-]+\.zip$/`) and explicitly reject path traversal sequences (`..`)
- This prevents an attacker from tricking the restore handler into overwriting arbitrary files outside the backup directory
- After a successful restore, the offline cache is invalidated to prevent serving stale data
- Implemented in: `src/main/handlers/backupHandlers.ts`

**Data Validation:**

- CSV imports are validated for encoding, structure, and content
- Phone numbers, emails, and other fields are sanitized
- Size limits enforced on file uploads and imports

### Error Handling

**Uncaught Exceptions:**

- Uncaught exceptions display a synchronous dialog with **Quit** and **Continue** buttons (default: Quit)
- Choosing "Continue" logs a warning and lets the user keep working — useful for non-fatal errors that would otherwise force-quit the app
- The error message is shown to the user in the dialog

**Unhandled Promise Rejections:**

- Tracked with a rolling-window counter (3 rejections within 60 seconds triggers a notification)
- When the threshold is exceeded, a stability warning is broadcast to all renderer windows via `app:error-notification`
- The counter resets after each notification to prevent spam

Implemented in: `src/main/app/errorHandlers.ts`

### Log Redaction

All structured log data passes through PII redaction (`src/shared/logRedaction.ts`) before being written:

- **Key-based redaction:** Fields matching sensitive key patterns (`password`, `token`, `api_key`, `secret`, `email`, `phone`, `address`, etc.) are replaced with `[REDACTED]`
- **String-value scanning:** All string values (including `Error.message` and `Error.stack`) are scanned for email addresses and phone numbers, which are replaced with `[REDACTED_EMAIL]` and `[REDACTED_PHONE]` respectively
- **Error objects:** `Error` instances are serialized to `{ name, message, stack }` with PII redaction applied to `message` and `stack`
- **Circular reference protection:** Object graphs with circular references are safely handled with `[Circular]` placeholders

### Auxiliary Window Limits

The app enforces a hard limit of **5 simultaneous auxiliary windows** (`MAX_AUX_WINDOWS` in `src/main/app/windowFactory.ts`). When the limit is reached, further `createAuxWindow` requests are silently rejected with a warning log. Destroyed windows are cleaned up before each check.

### Data Integrity

**ACID Transactions:**

- PocketBase stores all application data in an embedded SQLite database
- All writes are protected by SQLite ACID transactions — partial writes and corruption are not possible
- No application-level file locking or atomic rename operations are required

**Offline Write Queue:**

- When the PocketBase server is unreachable, writes are queued in `PendingChanges` (local SQLite via better-sqlite3)
- `SyncManager` replays the queue and resolves conflicts when the connection is restored
- Conflict resolution is last-write-wins with server records taking precedence

**Backup Strategy:**

- `BackupManager` creates backups via the PocketBase Admin API (`pb.backups.create()`)
- Backups are stored in `pb_data/backups/` as timestamped `.zip` archives
- Retention policy enforces a maximum of 10 backups; older backups are pruned automatically

## Threat Model

### In Scope

1. **Local Data Tampering**
   - Mitigation: SQLite ACID transactions, PocketBase access controls, validation
   - Severity: Medium

2. **Path Traversal Attacks**
   - Mitigation: Strict path validation, sandboxing
   - Severity: High

3. **IPC Message Injection**
   - Mitigation: Type-safe validation, rate limiting
   - Severity: High

4. **Credential Theft**
   - Mitigation: OS-level encryption, context isolation
   - Severity: Critical

5. **XSS in Renderer Process**
   - Mitigation: CSP, context isolation, input sanitization
   - Severity: High

6. **Untrusted Content in WebViews**
   - Mitigation: Partition isolation, no file access, cleanup
   - Severity: Medium

### Out of Scope

1. **Physical Access to Device**
   - Users with physical access can extract data
   - OS-level encryption provides some protection

2. **Memory Dumps**
   - Sensitive data may be present in memory during operation
   - Consider implementing memory clearing for sensitive operations

3. **Supply Chain Attacks**
   - Dependencies are not fully audited
   - Regular updates and vulnerability scanning recommended

## Security Best Practices

### For Developers

1. **Never expose Node.js APIs directly to renderer**
   - Always use IPC with validation
   - Use preload script as the only bridge

2. **Validate all inputs**
   - Use Zod schemas for type-safe validation
   - Never trust data from renderer or external sources

3. **Use parameterized queries and filter escaping**
   - PocketBase is now the data store — use `escapeFilter()` from `pocketbase.ts` for filter values
   - Never interpolate user input directly into PocketBase filter strings

4. **Minimize use of `any` type**
   - Leverage TypeScript's strict mode
   - Use proper types for better security guarantees

5. **Log security-relevant events**
   - Track authentication attempts
   - Monitor file access patterns
   - Alert on validation failures

### For Users

1. **Keep the application updated**
   - Security patches are released regularly
   - Enable auto-updates if available

2. **Use strong system passwords**
   - Credential encryption relies on OS-level security
   - Strong system passwords protect stored credentials

3. **Be cautious with AI chat**
   - Data is not sent to external services by default
   - Session data clears on tab exit for privacy

4. **Review data directory permissions**
   - Ensure data directory has appropriate file permissions
   - Consider full-disk encryption for sensitive data

## Reporting Security Issues

If you discover a security vulnerability, please report it to the project maintainers via:

- GitHub Security Advisories (preferred)
- Email to the maintainer (see repository)

**Please do not open public issues for security vulnerabilities.**

### What to Include

1. Description of the vulnerability
2. Steps to reproduce
3. Impact assessment
4. Suggested mitigation (if any)

### Response Timeline

- **Initial Response:** Within 48 hours
- **Status Update:** Within 7 days
- **Fix Timeline:** Varies based on severity (Critical: 7 days, High: 14 days, Medium: 30 days)

## Security Roadmap

### Planned Improvements

1. **Enhanced WebView Security**
   - [ ] Implement stricter CSP for webview content
   - [ ] Add permission system for webview capabilities
   - [ ] Consider alternatives to webview tags

2. **PocketBase Hardening**
   - [ ] Enforce collection-level access rules for all PB collections
   - [ ] Audit filter escaping across all renderer services
   - [ ] Consider encrypted PocketBase data directory for high-security deployments

3. **Enhanced Logging**
   - [ ] Security event logging framework
   - [ ] Anomaly detection for suspicious patterns
   - [ ] Audit trail for sensitive operations

4. **Network Security**
   - [ ] Certificate pinning for critical APIs
   - [ ] Request signing for authenticated APIs
   - [ ] Rate limiting on network requests

5. **Code Signing**
   - [ ] Sign application binaries for release
   - [ ] Implement update verification
   - [ ] Add integrity checks for critical files

## Compliance Notes

This application handles operational data and may be subject to various compliance requirements:

- **Data Residency:** In server mode, all data is stored locally in the embedded PocketBase SQLite database. In client mode, data lives on the designated server node.
- **Data Retention:** User controls retention via the application or direct PocketBase admin access
- **Data Encryption:** OS-level encryption for the config secret (`safeStorage`); PocketBase database is plaintext SQLite — use full-disk encryption for sensitive deployments
- **Access Controls:** Two-tier auth (superuser + app user); superuser access is restricted to localhost

Organizations using this application should assess their specific compliance requirements and implement additional controls as needed.

## Version History

- **1.1.0** (2026-03-27): Updated to reflect current codebase
  - Documented cache handler validation (collection allowlist, action validation)
  - Documented backup restore filename validation (path traversal protection)
  - Documented rate limiter buckets with current configuration
  - Documented uncaughtException "Continue" option and unhandled rejection threshold
  - Documented PII log redaction (including Error message/stack scanning)
  - Documented auxiliary window limit (max 5)
  - Updated credential management with nonce expiry, cache TTL, and cleanup details

- **1.0.0** (2026-01-24): Initial security documentation
  - Documented current security architecture
  - Established threat model
  - Defined security best practices

---

**Last Updated:** 2026-03-27
**Reviewed By:** Security Agent
**Next Review:** 2026-09-27
