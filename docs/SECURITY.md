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
2. User is prompted securely via IPC
3. Credentials can be optionally cached (encrypted)
4. Nonce-based request validation prevents replay attacks

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

**Data Validation:**

- CSV imports are validated for encoding, structure, and content
- Phone numbers, emails, and other fields are sanitized
- Size limits enforced on file uploads and imports

### File System Security

**Atomic Writes:**

- All file writes use atomic operations (write to temp, then rename)
- Prevents data corruption from interrupted writes
- Implemented in: `src/main/FileSystemService.ts`

**File Locking:**

- Concurrent write protection via file locks
- Prevents race conditions and data corruption
- Automatic cleanup of stale locks
- Implemented in: `src/main/fileLock.ts`, `src/main/FileManager.ts`

**Backup Strategy:**

- Automatic backups before critical operations
- Backups stored in `backups/` subdirectory
- Retention policy can be configured

## Threat Model

### In Scope

1. **Local Data Tampering**
   - Mitigation: Atomic writes, file locking, validation
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

3. **Use parameterized queries for future database work**
   - Prepare for SQLite migration with security in mind
   - Avoid string concatenation for queries

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

2. **Database Migration**
   - [ ] Migrate to SQLite with encrypted database
   - [ ] Implement prepared statements for all queries
   - [ ] Add database-level access controls

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

- **Data Residency:** All data is stored locally on the user's device
- **Data Retention:** User controls retention via manual deletion
- **Data Encryption:** OS-level encryption for credentials, plaintext for operational data
- **Access Controls:** Single-user application, OS-level access controls apply

Organizations using this application should assess their specific compliance requirements and implement additional controls as needed.

## Version History

- **1.0.0** (2026-01-24): Initial security documentation
  - Documented current security architecture
  - Established threat model
  - Defined security best practices

---

**Last Updated:** 2026-01-24  
**Reviewed By:** Security Agent  
**Next Review:** 2026-07-24
