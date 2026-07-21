# Relay Web Backup Design

**Date:** 2026-07-20
**Status:** Approved design; awaiting written-spec review

## Summary

Relay will add a browser client as a backup to the Electron desktop client. The browser client will support current desktop-class Chrome, Edge, and Safari on a trusted LAN or VPN. It will reuse Relay's existing React renderer, PocketBase data model, realtime subscriptions, and main-process domain services rather than becoming a separate application.

The server-mode Relay desktop app will host a small web gateway and the production browser bundle while the server app is running. Electron will keep its existing preload/IPC path. The browser build will install a web implementation of the same application-facing bridge, using browser APIs for local interactions and authenticated HTTP plus server-sent events for capabilities that currently require Electron's main process.

The browser client is online-only. Initial Relay server setup and connection configuration, PocketBase backup/restore, and destructive data reset remain desktop-only. All ordinary operational workflows, privileged administration, paired-device management, protected credential changes, Knowledge publishing and management, Dynatrace configuration, and in-app notifications are in scope.

The web endpoint will use HTTP because the deployment cannot install or trust TLS certificates. It will be restricted to the configured LAN/VPN interface and will visibly disclose that traffic is unencrypted. The accepted HTTP risk does not relax Relay's application-level authentication, authorization, session isolation, rate limiting, validation, audit, or redaction requirements.

## Goals

- Provide a reliable browser fallback when a Relay desktop client is unavailable.
- Support current stable Chrome, Edge, and Safari on laptop and desktop screens.
- Preserve near-full operational parity without duplicating the renderer or rewriting PocketBase-backed services.
- Leave existing Electron server and client behavior intact.
- Host the browser client only from the running server-mode Relay app.
- Use the existing Relay connection passphrase for ordinary browser access.
- Keep privileged web sessions isolated, capability-checked, audited, and short-lived.
- Support ordinary CRUD and realtime updates through the current PocketBase model.
- Support browser-based Knowledge reading, search, upload, publishing, and management.
- Support administration, credential changes, paired-device management, and Dynatrace configuration from the browser.
- Preserve the existing notification policy: Dynatrace problems take priority, and provider-status alerts notify only for current outages.

## Non-goals

- Internet-facing access, public hosting, cloud deployment, or external identity providers.
- Phone or small-tablet layouts.
- Browser offline cache, queued offline mutations, background sync, or conflict replay.
- HTTPS, service workers, PWA installation, operating-system browser notifications, or push delivery.
- Exact emulation of Electron window management, filesystem paths, Outlook launching, custom reminder-sound selection, or isolated Dynatrace SSO storage.
- A second renderer codebase or a general-purpose remote API.
- Browser-based initial server setup, Relay connection reconfiguration, PocketBase backup/restore, or destructive data reset.
- Making the browser itself a paired privileged device.

## Supported Environment

- Browser engines: current stable Chrome, Edge, and Safari at release time are required. The immediately previous stable releases are best-effort compatibility targets, not release blockers.
- Viewports: desktop-class layouts beginning at 1024 by 768. Acceptance sizes are 1024 by 768, 1366 by 768, and 1440 by 900.
- Network: the same trusted LAN as the Relay server or a VPN path into that LAN.
- Server lifecycle: browser access is available only while the server-mode Relay desktop app and its embedded PocketBase process are running.
- Transport: HTTP only, with an explicit trusted-network warning. The product must never imply that HTTP provides confidentiality, integrity, or server authentication.

Windows narrower than the supported desktop width show a dedicated larger-window-required state instead of compressing Relay's dense workflows into an unusable mobile layout.

## Architecture

### One renderer, two runtime adapters

The React renderer remains the source of truth for Relay's application shell and feature UI.

- Electron continues to receive `BridgeAPI` from the existing context-isolated preload.
- A browser entry point installs `WebBridgeAPI` before React renders.
- Both bridges expose the same application-facing operations and shared request/result types.
- A small runtime descriptor identifies `electron` or `web` and publishes explicit capabilities. Components use capabilities to hide or adapt unavailable actions instead of inferring support from browser globals.
- Existing direct `globalThis.api` consumers may remain during transition, but the bridge is created in one bootstrap module so browser and Electron behavior cannot drift by ad hoc component mocks.

The Electron preload and trusted IPC sender checks remain authoritative for desktop windows. Adding a web adapter must not route existing Electron calls through HTTP.

### Server-mode web gateway

A new main-process `RelayWebServer` owns the browser endpoint.

- It starts only in server mode, only when web access is enabled, and only after PocketBase and required collections are healthy.
- It stops before PocketBase during shutdown or runtime reconfiguration.
- It binds to the server's configured LAN host. Web access cannot be enabled while the server is loopback-only.
- It serves the production browser bundle and a versioned `/relay-api/v1` surface from one origin.
- It uses one configured port, defaulting to `8091`. It never silently moves to another port.
- Port range, conflicts, and equality with the PocketBase port are validated before startup.
- A startup failure leaves PocketBase and Electron usable, reports a bounded error in desktop Settings, and offers an explicit retry.

Existing server configurations migrate with web access disabled. The server desktop Settings page provides the opt-in toggle, validated port, current URL, lifecycle state, and retry action. Once enabled successfully, the gateway starts automatically with the Relay server.

### Shared service boundary

IPC handlers and HTTP route handlers must be thin transports around shared domain services.

- PocketBase-backed renderer services continue to handle ordinary collection reads, writes, and realtime subscriptions.
- Main-only features move reusable logic behind typed service methods where an IPC handler currently owns business behavior.
- IPC adapters retain trusted-sender enforcement and existing channel contracts.
- HTTP adapters add web-session authorization, CSRF validation, request bounds, route-specific rate limits, and safe result projection.
- Gateway events use server-sent events. PocketBase realtime remains on the existing PocketBase connection and is not reimplemented by the gateway.

There is no generic "invoke IPC by name" HTTP endpoint. Every web route is separately allowlisted, typed, validated, authorized, and tested.

## Configuration and Discovery

Server configuration gains bounded web-access fields:

```ts
type ServerWebConfig = {
  enabled: boolean;
  port: number;
};
```

The fields are stored with the existing server configuration and changed only through trusted server-desktop settings IPC. Browser Settings may display the web endpoint but cannot enable, disable, or rebind it.

The desktop Settings surface shows:

- enabled or disabled state;
- starting, available, conflict, or failed runtime state;
- the exact browser URL using the current LAN address and configured port;
- a copy action with ordinary desktop clipboard behavior; and
- the permanent warning `Trusted LAN/VPN only - browser traffic is not encrypted`.

The first release does not add Internet discovery, DNS provisioning, a QR code, automatic port selection, or a separate web daemon.

## Ordinary Browser Authentication

### Login

The browser opens on a Relay-styled sign-in screen containing the server identity, connection-passphrase field, sign-in action, and unencrypted-network warning. It contains no server setup or reconfiguration path.

`POST /relay-api/v1/session/login` accepts the passphrase over the accepted HTTP connection. The gateway authenticates the existing Relay app user against PocketBase on the local loopback address and returns only a bounded bootstrap result.

On success, the gateway creates:

- an opaque session identifier with at least 256 bits of cryptographic randomness;
- a server-held PocketBase auth store for that web session;
- a nonpersistent `HttpOnly`, `SameSite=Strict`, path-scoped session cookie;
- an in-memory CSRF value returned to the renderer and required on state-changing gateway requests; and
- the current PocketBase app-user token delivered only to runtime memory for the existing renderer PocketBase client.

The connection passphrase is never logged, persisted by Relay Web, returned in a response, placed in browser storage, or included in an error. Browser reload uses the opaque gateway session to request a fresh bounded bootstrap response. It does not require the browser to retain the passphrase.

### Session lifetime

An ordinary web session ends on explicit logout, server restart, 60 minutes of inactivity, or an eight-hour absolute lifetime. The cookie has no persistent expiration. The gateway remains authoritative even if a browser restores a previous session cookie after restart.

Logout clears the gateway session, privileged child session, CSRF state, and renderer PocketBase auth state. Browser-local appearance preferences remain intact because they contain no authentication material.

## Privileged Browser Sessions

Privileged identity remains separate from the shared ordinary Relay connection.

- Role username and password are submitted to the authenticated gateway session.
- The gateway creates an isolated privileged runtime per web session. It must not reuse Electron's singleton privileged session or another browser's auth store.
- Privileged PocketBase tokens, credentials, signing material, and reauthentication proofs stay server-side.
- Privileged sessions retain the existing 15-minute inactivity lock.
- Existing capability derivation, current-account checks, authority pointers, optimistic revisions, typed command allowlists, idempotency, and safe-result projection remain authoritative.
- Ownership transfer, device revocation, credential changes, and other currently sensitive commands still require fresh reauthentication.
- Audit records add a bounded `web` source plus sanitized network and browser-family context without storing raw credentials, tokens, or full user-agent strings.

Because the gateway runs on the server PC, browser privileged commands use the existing server-local trust path. The browser is not paired and receives no device private key. An authorized web session can still inspect, rename, revoke, or otherwise manage paired Electron devices according to its current capabilities.

### Initial protected credential and recovery approval

Initial Owner credential setup and protected-account recovery cannot be authorized by the shared connection passphrase alone. The server desktop generates a one-time approval code that is:

- bound to the requesting web session and requested operation;
- valid for ten minutes;
- consumed once;
- limited to five failed attempts; and
- invalidated on server restart, explicit cancellation, or successful use.

The user enters that code in the web flow before the privileged credential operation proceeds. The desktop remains the local approval boundary without requiring the whole credential-management workflow to be desktop-only.

## HTTP Security Boundary

The absence of HTTPS is an explicit deployment constraint and accepted risk. Application protections reduce accidental exposure and common web attacks but do not protect against a network attacker who can read or modify LAN traffic.

The gateway must implement:

- exact Host validation against an allowlist containing the server hostname and active private LAN/VPN interface addresses at the configured port to limit DNS-rebinding attacks; the allowlist is refreshed when network interfaces change and before rejecting an otherwise private request;
- rejection of requests whose remote address is not loopback, private LAN, link-local, or an approved VPN address under Relay's shared network-address classification;
- same-origin enforcement and exact Origin validation for authenticated requests;
- no permissive CORS on gateway routes;
- `HttpOnly` and `SameSite=Strict` session cookies;
- per-session CSRF tokens on every state-changing request;
- generic authentication failures and bounded error bodies;
- per-IP and per-session rate limits for login, reauthentication, approval codes, uploads, and privileged commands;
- route-specific body, header, file, batch, and concurrency limits;
- `Cache-Control: no-store` for authenticated HTML, API, and sensitive assets;
- restrictive production CSP, `frame-ancestors 'none'`, MIME sniffing protection, and a strict referrer policy;
- session rotation after ordinary and privileged authentication changes;
- sensitive-value redaction through the existing logging boundary; and
- clean session and temporary-file disposal on logout, expiry, shutdown, and failed startup.

The HTTP cookie cannot use the `Secure` attribute. Relay must not describe it as secure transport or security-equivalent to HTTPS.

## PocketBase Data Flow

After gateway login, the browser initializes the existing PocketBase SDK against the server's normal PocketBase LAN URL with the in-memory app-user token. Existing services and `useCollection` keep their current collection rules, request shapes, and realtime behavior.

- Ordinary online CRUD does not pass through a new general gateway proxy.
- Desktop client authentication and PocketBase URLs remain unchanged.
- The browser never receives the Relay superuser token or a privileged role-account token.
- PocketBase connection loss keeps the current renderer state visible, marks it stale, and disables mutations.
- Browser writes are never queued for later replay.
- Recovery refetches authoritative collections before writes are re-enabled and then re-establishes realtime subscriptions.

## Web Bridge Capability Mapping

### Browser-native operations

The web bridge uses browser primitives for:

- opening validated external HTTP(S) links in a new tab with opener isolation;
- selecting images, PDFs, CSVs, and other approved files;
- downloading PNG, EML, ICS, CSV, PDF, and other generated artifacts;
- playing built-in sounds after a user activation;
- opening Relay popouts as ordinary browser tabs or windows; and
- copying text through a compatibility path.

Modern async clipboard access is unavailable on the approved plain-HTTP deployment. Copy actions first use a compatible synchronous selection-copy path. If the browser blocks it, Relay presents the exact selected content in a focused copy surface with explicit Ctrl/Cmd+C instructions. Image clipboard parity is not promised; Relay provides a PNG download instead.

### Gateway-backed operations

Typed HTTP routes and server-sent events provide:

- session bootstrap, refresh, logout, and connection health;
- cloud-status snapshots and invalidation events;
- Dynatrace dashboard metadata and protected Problems settings commands;
- privileged login, logout, reauthentication, account/device administration, and command results;
- Knowledge PDF/cover reads, local search, index status, upload queue, and management commands;
- company/footer logo storage managed by the Relay server;
- cross-runtime drag/dismissal signals where the existing UI depends on them;
- bounded logging and safe server-runtime error notifications; and
- browser presence registration and heartbeat.

### Desktop-only or adapted operations

- Initial Relay server setup and connection configuration are absent from Relay Web.
- PocketBase backup, restore, and destructive data reset are absent from Relay Web.
- Electron window controls and filesystem-path opening are absent.
- Custom reminder-sound file selection is absent; web uses built-in approved sounds.
- `save and open` actions become browser downloads with clear next-step copy.
- Dynatrace dashboards open in the browser's ordinary session. Relay Web cannot isolate or clear third-party Dynatrace SSO cookies.

Unsupported bridge methods fail with explicit typed `unsupported-in-web` results. They must never silently succeed.

## Knowledge Reading and Publishing

Knowledge metadata remains PocketBase-backed. Browser PDF, cover, search, and index requests use the gateway so protected file access, validation, caching, extraction, and search behavior remain server-authoritative.

Browser publishing uses `File` objects and the existing upload limits:

- at most 100 files per batch;
- at most 50 MiB and 1,000 pages per PDF;
- bounded chunk size and upload concurrency;
- explicit file-signature, size, modification metadata, checksum, and session-ownership validation;
- idempotent manifests and acknowledged chunk indexes;
- account/session-bound temporary records; and
- the existing server extraction, outline, cover, publication, audit, cleanup, and retention pipeline.

The browser keeps the selected `File` available while chunks transfer. If the tab remains open, it can retry acknowledged chunks without restarting the batch. After a browser restart or source loss, the user must reselect the same unchanged PDF. Once all bytes are accepted by the server, extraction and publication continue without the tab remaining open.

The Electron upload path remains unchanged. Shared server-side validation and publication logic is reused by both paths.

## Feature Parity

| Area | Relay Web behavior |
| --- | --- |
| Shell, navigation, search, toasts | Shared UI with web runtime indicators and no Electron window chrome |
| Compose | Online parity; generated artifacts download and copy uses the HTTP-compatible fallback |
| Alerts | Compose, images, previews, history, PNG/EML downloads, in-app reminders, and built-in sounds |
| On-Call | Realtime board, drag/drop, lock behavior, dismissals, exports, and browser popouts |
| Contacts, Servers, notes | Existing online CRUD, search, filters, details, and contextual notes |
| Knowledge reading | Catalog, search, covers, PDF reader, internal links, and validated external links |
| Knowledge management | Upload, retry/reselection, categories, metadata, publishing, replacement, trash, and audit |
| Status | Existing provider coverage and current-outage presentation |
| Problems | Existing Dynatrace problem records, notes, state, filters, and sync controls |
| Administration | Accounts, roles, ownership, credentials, publisher assignment, devices, and bounded snapshots |
| Dynatrace | Dashboard/settings/token/profile management and ordinary browser-tab launch |
| Data Manager | Import and export available; reset, backup, and restore hidden |
| Settings | Browser-local appearance and operational settings; server connection settings hidden |
| Presence | Browser client shown with browser family and bounded network label instead of unavailable hostname |

## Notifications

Relay Web includes realtime in-app notifications while the browser tab is open.

- Dynatrace problem notifications retain priority over provider outage notifications.
- Provider-status notifications are eligible only for current outages under the shared seven-day rule.
- Degradation, warning, informational, resolved, and stale provider items do not create provider alert toasts.
- Existing deduplication, baselining, batching, and reopen behavior remains shared with Electron.
- Alert reminders and sounds work after the user explicitly enables audio during the browser session.
- A backgrounded tab queues unread in-app items, updates the document title and sidebar count, and reconciles current data after focus or realtime reconnect.
- Selecting a notification activates the relevant Relay destination and record.
- A sleeping tab must refetch before announcing an item so stale events are not replayed as new.

Plain HTTP cannot use the secure-context Notifications, Push, or Service Worker APIs. Relay Web therefore provides no operating-system notification banner, closed-browser delivery, or guaranteed background delivery. The UI must state `Notifications require this Relay tab to remain open` near the browser notification controls.

## Browser UX

Relay Web preserves the existing precise, dark, tactile command-console register.

- The shell, sidebar, headers, tabs, typography, semantic state colors, and component geometry remain shared.
- Electron traffic-light/window controls and draggable title regions are hidden.
- A compact `Web` runtime label and connection state appear in existing status chrome without becoming decorative branding.
- The login screen leads with the Relay server identity and sign-in action, not product marketing.
- The unencrypted trusted-network warning is visible at login and in Settings but does not repeat as a toast.
- Browser capability differences appear inline at the affected action. Relay does not present a modal before every adapted download or copy.
- Keyboard navigation, focus visibility, reduced motion, high contrast, and accessible names remain mandatory.
- No generic SaaS dashboard, mobile card stack, new visual theme, or duplicate navigation shell is introduced.

## Failure Handling

### Gateway and session failures

- Gateway loss enters a reconnecting state and retries with bounded exponential backoff.
- Session expiration opens an inline reauthentication layer over the retained renderer tree so unsaved local form state is not discarded.
- A terminal authentication failure signs out and clears PocketBase auth state.
- A server restart invalidates all web sessions and requires the connection passphrase again.
- Server-side web startup failure never prevents Electron or PocketBase from operating.

### PocketBase failures

- Visible data remains rendered with a stale/offline indicator.
- Create, update, delete, privileged, and upload actions are disabled until authoritative reconnection succeeds.
- The browser does not create an offline mutation queue.
- Reconnection refetches before resubscription and write re-enablement.

### Upload failures

- Duplicate manifests and chunks are idempotent.
- Size, signature, checksum, ownership, and sequence errors fail closed.
- Retryable network failures use bounded backoff and acknowledged-index recovery.
- Source changes require explicit reselection.
- Temporary browser upload data follows existing seven-day unpublished retention and is also cleaned on explicit cancellation where safe.

### Safe errors

Gateway responses return typed public error codes and actionable UI copy. They never expose stack traces, local paths, raw PocketBase errors, Dynatrace tokens, passwords, auth tokens, signing keys, approval codes, or internal collection details.

## Testing Strategy

Implementation uses genuine red-green TDD for each behavior slice.

### Contract and unit tests

- Shared bridge contract tests prove Electron and web adapters expose consistent application behavior.
- Capability tests prove desktop-only controls are absent and unsupported methods fail explicitly.
- Session tests cover entropy, login failure normalization, rate limits, rotation, inactivity, absolute expiry, logout, restart invalidation, and browser-session isolation.
- Security tests cover Host/Origin rejection, CSRF, SameSite/HttpOnly cookie shape, no-store headers, CSP, body bounds, log redaction, and safe error projection.
- Gateway lifecycle tests cover server/client mode, enabled/disabled state, PocketBase readiness, runtime reconfiguration, shutdown ordering, retry, and port conflicts.
- Renderer tests cover login, runtime chrome, stale state, disabled writes, inline reauthentication, copy fallback, downloads, and unsaved-state preservation.
- Notification regressions cover Dynatrace priority, outage-only provider alerts, seven-day freshness, deduplication, background queuing, and reconnect reconciliation.
- Knowledge tests cover selection, chunking, acknowledged retry, reselection, cancellation, validation, server continuation, authorization, and cleanup.
- Privileged tests cover isolated simultaneous sessions, capabilities, reauthentication, approval codes, credential changes, device management, and audit source projection.

### Integration and browser tests

- A desktop mutation must appear in the browser through PocketBase realtime.
- A browser mutation must appear in existing Electron server and client renderers.
- Web access disabled or failed must not affect existing desktop connectivity.
- Playwright Chromium and WebKit cover the browser workflow in automation.
- Stable Chrome, Edge, and Safari receive actual-browser smoke coverage for login, navigation, CRUD, realtime, upload, downloads, copy fallback, privileged actions, and notification reconciliation.
- Viewport acceptance runs at 1024 by 768, 1366 by 768, and 1440 by 900.
- Existing Electron end-to-end coverage remains mandatory.

### Final verification

After focused tests for each behavior slice, run:

- the complete unit, renderer, and cache suites;
- type checking, linting, and formatting checks;
- production Electron and browser builds;
- Electron and browser end-to-end suites;
- a cross-client compatibility smoke test against one shared server; and
- one independent final review covering security, compatibility, parity, accessibility, and regression risk.

## Rollout and Compatibility

- Existing installations migrate with Relay Web disabled.
- Enabling Relay Web is an explicit server-desktop action and does not modify client configuration.
- Existing Electron preload, IPC, PocketBase bootstrap, offline cache, pending mutations, client discovery, and privileged device flows continue to work.
- The browser build and gateway are packaged with server-capable desktop distributions; there is no separate installer.
- Browser route/API versions are explicit so a mismatched cached bundle can receive a safe reload response instead of calling an incompatible gateway.
- The feature can be disabled from server Settings without changing PocketBase data or invalidating Electron clients.
- Disabling the gateway immediately closes web sessions and rejects new requests.

## Success Criteria

The design is successful when:

1. A user on the trusted LAN or VPN can open the advertised Relay URL in Chrome, Edge, or Safari and sign in with the existing connection passphrase.
2. Ordinary operational features behave consistently with Electron while online.
3. Browser and Electron clients observe each other's writes in realtime without changing existing client configuration.
4. Authorized browser users can administer accounts/devices, manage Knowledge, and configure Dynatrace through isolated privileged sessions.
5. Initial server setup, connection configuration, backup/restore, and destructive reset remain server-desktop-only.
6. In-app notifications preserve Dynatrace priority and outage-only cloud rules while the Relay tab is open.
7. Server, gateway, PocketBase, and session failures produce explicit recoverable states without queued browser writes or lost unsaved renderer state.
8. Enabling or disabling Relay Web does not break the Electron server, existing Electron clients, or their offline behavior.
9. The UI clearly discloses the accepted unencrypted HTTP boundary and never promises closed-browser notifications or isolated Dynatrace SSO.

## References

- PocketBase static serving and API routes: <https://pocketbase.io/docs/>
- OWASP transport guidance: <https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html>
- OWASP session guidance: <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
- MDN secure-context requirements for Web Crypto: <https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto>
- MDN secure-context requirements for Clipboard: <https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API>
- MDN secure-context requirements for Notifications: <https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API>
- MDN secure-context requirements for Push: <https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/push_event>
