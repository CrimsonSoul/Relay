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

The renderer does not import Node.js or Electron APIs directly. System-level operations go through the preload bridge. Ordinary reads and online writes use the PocketBase SDK directly. Offline-capable desktop writes use the validated preload bridge to enter the main-process mutation queue; Relay Web rejects writes while offline.

### Relay Web Gateway

Relay Web is an optional server-mode backup path for desktop Chrome, Edge, and Safari on a managed LAN or private VPN. It serves the shared renderer and a bounded same-origin API from `src/main/web/`. It is not designed or approved for internet exposure.

The gateway binds only when server-mode direct LAN access and Relay Web are both enabled. Host-header and request-origin validation restrict accepted requests to the local machine name and private interface addresses. Ordinary sessions use random server-side identifiers in HTTP-only, path-scoped, `SameSite=Strict` cookies with one-hour idle and eight-hour absolute limits. Cookie and CSRF values rotate after refresh while a separate server-only logical-session ID preserves rate accounting and revocation ownership. Logout, replacement, and expiry destroy that logical record even when a previously authorized request overlaps cookie rotation.

The browser receives the ordinary app-user connection needed by the shared renderer only after the web session is authenticated. Protected commands keep the existing authoritative capability, revision, replay, and audit controls. Browser protected sign-in and destructive approvals are server-mediated; they do not expose Electron secrets, local paths, the protected auth store, or private signing keys.

Relay Web deliberately has no service worker, browser push subscription, permissive cross-origin API, backup/restore endpoint, arbitrary filesystem bridge, connection-reconfiguration endpoint, or offline mutation queue.

The service uses cleartext HTTP. Session credentials, operational data, and responses are not confidential against a network observer. Never port-forward or publish the Relay Web port through public DNS, a public reverse proxy, or a WAN-facing firewall rule. Restrict access to approved LAN/VPN devices. See `docs/relay-web.md` for deployment requirements.

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

`electron.vite.config.ts` injects a `<meta http-equiv="Content-Security-Policy">` tag into `dist/renderer/index.html` at build time. It is a defense-in-depth fallback for the packaged `file://` load path, not an exact copy of the response-header policy. Because the configured PocketBase origin is not known at build time, the meta policy permits the supported HTTP(S)/WebSocket schemes in `connect-src` and omits the runtime header's `form-action` directive. A meta tag also cannot provide the non-CSP response headers. The session-level policy in `src/main/app/securityHeaders.ts` is authoritative at runtime: it narrows `connect-src` to the configured PocketBase origin, includes `form-action 'self'`, and installs the remaining security headers.

### Navigation And Window Controls

Relay blocks unexpected navigation and secondary window creation paths in `src/main/app/windowFactory.ts`.

Controls in place:

- Main and auxiliary windows reject unexpected `will-navigate` requests
- `window.open()` is denied for app windows
- Auxiliary windows are limited to an allowlisted route set
- Auxiliary windows are capped at 5 concurrent instances

The general `OPEN_EXTERNAL` action also requires a trusted sender and a shared
external-action rate-limit token. HTTPS navigation is limited to Relay's exact
status, social, Teams, or boundary-safe Dynatrace hosts; credentials, custom
ports, whitespace, control characters, and all other web hosts are rejected.
Teams desktop and web URLs are further confined to the meeting-draft path,
exact `subject` and `attendees` fields, bounded decoded values, and validated
attendee addresses. Relay has no general `mailto:` opener.

### External Dashboard Popouts

Dynatrace dashboard popouts are handled by `src/main/dynatrace/DynatraceWindowManager.ts`.

Security controls in place:

- The Relay chrome shell is loaded from the trusted renderer URL or packaged renderer file only
- Dashboard content is loaded into a separate `WebContentsView`
- Dashboard content uses the isolated `persist:relay-dynatrace` session partition
- Permission requests and permission checks from the dashboard session are denied
- External navigation is limited to HTTPS `dynatrace.com` hosts and Microsoft authentication hosts required for SSO
- `window.open()` from dashboard content is denied; allowed Dynatrace or Microsoft auth popups are loaded in the same dashboard view
- Permission-denial logs and public dashboard runtime state retain only URL origins; paths, query strings, fragments, and URL credentials are discarded before logging, IPC, or Relay Web publication
- Blocked navigation logs use the same origin-only URL descriptions to avoid leaking dashboard query strings or auth details
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

Wiki publishing has no configured source root or watched folder. The native file picker returns selected paths only to the main process. Relay accepts regular, non-symbolic PDF files within the size limit, records their canonical identity, and reopens them with no-follow semantics. Before every bounded chunk read it revalidates the canonical path, device, inode, size, modification time, PDF signature, and whole-file checksum. A moved or changed source becomes `source-required` instead of uploading replacement bytes under an existing manifest.

### Cache IPC Validation

`src/main/handlers/cacheHandlers.ts` restricts cache access with explicit allowlists.

Checks include:

- Collection name allowlist
- Mutation action allowlist (`create`, `update`, `delete`)
- Record shape validation for writes

### Brand Image Validation

Company and client logos are limited to 2 MiB of compressed input and accepted only as PNG, JPEG,
or WebP. The shared main-process image pipeline applies explicit source width, height, pixel, and
decoded-byte budgets before full decode, resizes inside a 400 by 400 pixel box without enlargement,
and bounds the generated PNG before persistence or response construction.

### Rate Limiting

`src/main/rateLimiter.ts` provides global and caller-keyed token buckets. Security coverage is determined by handler call sites, not merely by a configured bucket.

Currently enforced limits include:

| Boundary                 | Enforced operations                                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global IPC buckets       | Native file/shell actions, Wiki source selection/staging, and Wiki external-link opening (`fsOperations`); cloud-status network refreshes (`network`); renderer log forwarding (`rendererLogging`) |
| Keyed privileged buckets | Protected login, pairing-code verification, signed commands, and the separately budgeted Wiki upload command plane                                                                                 |
| Relay Web route buckets  | Per-address session login and per-session refresh, operational mutation, protected-command, Wiki file/search/upload, and browser-log routes                                                        |

`fileImport`, `dataMutation`, and `dataReload` are defined as reusable global buckets but have no current production call sites; do not rely on those definitions as enforced controls. Global and privileged denials are logged without the opaque caller key. Relay Web returns HTTP 429 with `Retry-After`.

## Automated Security And Quality Gates

Relay's `Security and Code Quality` workflow provides two complementary gates:

- SonarQube analyzes source quality and first-party security findings, imports unit and renderer LCOV coverage, waits for the exact uploaded analysis, reconciles only pinned `test`-branch review decisions, blocks if the analyzed branch or pull request retains any Open, Confirmed, or legacy Reopened issue, and then verifies the configured remote quality gate for that same analysis.
- Snyk's native GitHub integration blocks newly introduced pull-request findings. The push-triggered Snyk CLI gate blocks any current high- or critical-severity Open Source or Snyk Code finding, including findings in development dependencies, and then publishes a dependency snapshot identified as `test`.

The workflow is intentionally anchored to Relay's authoritative `test` branch. SonarQube runs on pushes to `test` and same-repository pull requests targeting `test`; the SonarQube Cloud project's main analysis branch is also named `test`. The scanner uploads without making a premature quality-gate decision, and `security:sonar:quality-gate` validates the scanner report and waits for its exact compute task. After reconciliation, it proves that analysis is still the latest `test` analysis before and after reading the recalculated live branch gate; pull requests use their immutable analysis ID directly. After analysis, `security:sonar:issues` paginates the exact branch or pull-request issue set, fails on unresolved Open/Confirmed/Reopened issues, and reports Accepted/Won't Fix and False Positive decisions separately so reviewed exceptions remain visible. The Snyk CLI baseline runs on `test` pushes while the native integration owns pull requests. Scanner tokens are exposed only to their scanner steps and stored as GitHub Actions secrets. Repository variables hold non-secret organization and SonarQube host identifiers.

Pull-request scans never change issue state. A `test`-branch push invokes an
exact 49-item reconciliation manifest only after fresh analysis and before the
zero-open gate. The reconciler requires an internal `--apply` latch, validates
each issue key, rule, and component before the first write, refuses to run when
an unknown Open or Confirmed issue is present, and records a bounded rationale
with every transition. The manifest contains 43 behavior-preserving Accepted
decisions for intentional ARIA, test-structure, Electron startup, and render
callback patterns, plus six False Positives backed by persisted-hash
compatibility, browser-computed contrast, or constrained OS browser-dispatch
evidence. Missing or fixed items are not changed, already-reviewed decisions
are idempotent, and metadata drift fails closed. The final quality-gate check
remains fail-closed; reviewed issue transitions can no longer prevent the
reconciler from running before that check.

GitHub dependency alerts, automated dependency security fixes, secret scanning, and push protection should remain enabled for the repository. Snyk is the scanner and pull-request security gate; GitHub remains the source of secret-blocking and dependency-fix automation so duplicate Snyk dependency upgrade pull requests are unnecessary.

Treat a failing gate as a release blocker until the finding is validated and fixed or a narrowly documented exception is approved. Run a Codex Security standard scan before releases and after changes to authentication, IPC, Relay Web, updates, file handling, or privileged commands. Use a deep scan for major trust-boundary redesigns or when a standard scan identifies a plausible multi-stage attack path.

## Secrets And Local Data

### Connection Passphrase Storage

`src/main/config/AppConfig.ts` stores the Relay connection passphrase encrypted with Electron `safeStorage` when available. Packaged builds fail closed and refuse to write the passphrase when OS encryption is unavailable. A plaintext compatibility path exists only in unpackaged development and test environments such as headless CI.

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

New server setup enables direct LAN access by default and binds PocketBase to `0.0.0.0`. Clear **Allow direct LAN access** during setup to bind only to `127.0.0.1`. A LAN-bound server accepts connections on every interface permitted by the host firewall, so use it only on trusted operator-controlled networks and restrict the PocketBase port to approved stations.

Client setup accepts HTTPS Relay server URLs by default and also supports HTTP for trusted LAN targets, including private IP addresses, `.local` names, and single-label machine names used for NOC desktop-to-laptop deployments. Public HTTP requires the explicit insecure HTTP opt-in. Use HTTPS when Relay traffic leaves the trusted LAN so the shared Relay passphrase is not sent over cleartext WAN links.

When the server is LAN-bound (`0.0.0.0`), Relay advertises a `_relay._tcp` service via mDNS, and the service name includes the machine hostname. Advertisement stops when the instance is reconfigured to client mode, rebound to loopback, or quit. Discovery results shown during client setup are filtered to private/LAN addresses, so an mDNS advertiser cannot present a WAN address as a local Relay server.

### PocketBase Bootstrap

Relay manages its own collections at startup. Bootstrap creates missing Relay collections, adds missing fields, and re-applies authenticated API rules to existing managed collections.

Unknown collections are left in place and logged as unmanaged. Startup must not delete application or operator-created collections outside Relay's managed collection list.

The packaged server also loads Relay's checked-in PocketBase hooks from a dedicated resource
directory. Startup fails closed if the privileged reauthentication hook is absent or does not answer
an unauthenticated probe with the expected authorization failure.

PocketBase first binds to loopback while Relay authenticates the configured superuser and persists
the authoritative authentication and privileged-reauthentication rate limits. Only after those
controls succeed does Relay stop that bootstrap process and start the configured LAN listener.

Ordinary Relay app-user password authentication is coordinated in the main process. Concurrent
connection, Wiki search, PDF, cover, and reconnect-sync consumers share one detached authentication
request, then receive a validated in-memory token snapshot in their own PocketBase clients. The
coordinator is bounded, keyed by a process-randomized credential digest, actively expires completed
snapshots after four seconds, and is cleared on configuration or server lifecycle changes. It never
copies a superuser or protected-role token, and definitive credential rejection stops retrying
immediately rather than spending the remaining authoritative rate-limit budget.

If PocketBase definitively rejects the configured superuser credential, Relay stops the server and
uses a one-use migration in a deterministic, owner-only directory beneath the operating system's
per-user temporary directory. On Windows, Relay uses Windows PowerShell 5.1 to atomically create and
then verify a protected DACL that grants full control only to the current user and LocalSystem, with
inheritance for the migration and handoff files. If that operation is blocked or unsupported, repair
stops before any secret is written. The passphrase is written with exclusive creation to an
owner-only handoff file; it is not copied into command-line arguments, environment variables, logs,
or migration source. The migration removes the handoff before changing the record and writes a
nonsecret, run-specific completion marker after the save. Relay requires that exact marker, removes
all repair artifacts, restarts PocketBase, and authenticates with the configured credential before
bootstrap can continue.

### Privileged Access Boundary

Ordinary Relay use has no account selector and requires no role-account sign-in. Reading shared data, composing bridges, and making ordinary operational updates remain available through the shared app session. New ordinary records are unattributed; a protected role account is required only for administration and Wiki publishing.

Protected identity is username-based. `relay_privileged_accounts.username` is the sign-in identity; display names are presentation-only and email is not an accepted login or recovery identity. PocketBase may retain an internal `@relay.invalid` email value because the collection is an auth collection, but Relay enables password authentication only for normalized usernames.

Relay has three effective roles. The singleton `relay_privileged_state.ownerAccountId` makes exactly one Administrator record the **Owner**. Other active Administrator records have the **Administrator** role. The optional `publisherAccountId` makes zero or one Publisher record the effective **Publisher**. Account IDs—not usernames, display names, legacy operator IDs, or renderer role claims—bind sessions, commands, pairing records, authority pointers, and revocation.

The privileged PocketBase client is created in the main process with an independent in-memory auth store. The privileged token never replaces the ordinary Relay app-user token and is not exposed to preload consumers, renderer state, local storage, logs, exports, cache snapshots, or the offline mutation queue. Password values are bounded, passed only for the awaited authentication request, cleared from the form, and not retained by Relay.

Privileged sessions lock after 15 minutes without privileged activity. Disconnecting, reconfiguring, explicitly locking, signing out, or closing Relay clears privileged auth state. Normal browsing and note-taking do not keep a role session alive. Sensitive mutations can require a fresh password reauthentication proof; proofs are account/device-bound, expire after five minutes, and can be consumed once.

On a paired client, reauthentication is performed by the authenticated
`POST /api/relay/privileged/reauth` PocketBase hook rather than by a client-authored signed command.
The server validates the password against the current active account, derives the current effective
role, verifies that the named paired device is active for that account, and creates the proof record
transactionally. The route has a 4 KiB body limit and a dedicated authoritative PocketBase rate
limit. Remote signed envelopes cannot contain the internal `privileged.reauth.confirm` command. On
the Relay server PC, the equivalent proof remains available only through the trusted local command
processor.

The server hook and the paired-client call are one protocol version. Deploy the server and paired
clients together before relying on fresh-password protected actions: a new client cannot obtain a
proof from an old server, and a new server deliberately rejects the old self-attested confirmation
command. Ordinary Relay connectivity is unchanged during that coordinated rollout.

Client workstations use a P-256 signing key generated in the main process. The private PKCS#8 material is stored only as Electron `safeStorage` ciphertext with owner-only file permissions where supported. If OS encryption is unavailable or the registry is corrupt, Relay requires pairing again instead of falling back to plaintext. The server stores only the public JWK, fingerprint, device label, hostname snapshot, state, and revision.

Pairing is initiated from the Relay server PC by an authenticated Owner or Administrator with `devices.manage`. The server creates an eight-character human code backed by a high-entropy secret; the challenge expires after 10 minutes, is account-bound and single-use, and locks after repeated failures. A successfully paired client keeps its private key locally. Revoking a device on the authoritative server record causes subsequent signed probes and commands to fail without needing access to that laptop.

Every remote privileged request is a canonical, typed envelope containing the command name, payload hash, request ID, account, device, role claim, optional expected revision, issuance time, expiry, and signature. The server:

1. validates shape, size, clock skew, and the 90-second maximum lifetime;
2. loads the current account, singleton authority state, and device records;
3. derives effective capabilities from those records instead of trusting the claimed role;
4. verifies the device fingerprint and ECDSA signature;
5. claims the unique request ID before running an allowlisted handler; and
6. stores only a bounded safe result or generic error.

Matching retries are idempotent. Conflicting request-ID reuse, expired requests, stale revisions, disabled accounts, role changes, and revoked or unknown devices are rejected. Privileged commands are online-only; they never use Relay's offline write queue. The server PC may execute the same typed handlers without a device signature only after server-mode, trusted-sender, and active-session checks.

The server PC is the recovery trust boundary. Fresh bootstrap creates inactive `ryan` / Ryan Bledsoe and `charles` / Charles Gibbs Administrator records, points ownership to Ryan's account ID, and gives neither account a usable default credential. Initial password setup, activation, password reset, and recovery are server-local workflows. Relay has no email reset, remote recovery, or recoverable default password. Password replacement increments credential state and revokes paired sessions for that account.

### Administration Authorization Matrix

Only an active Owner or Administrator may load the administration snapshot. Owner-only account commands are enforced again in the main-process handler: an Administrator cannot create, rename, activate/deactivate, or transfer ownership among Administrator accounts. Administrators may manage the Publisher account and assignment. A Publisher session can invoke Wiki management commands only. Ordinary app-user credentials cannot list or mutate protected accounts.

| Protected action                      | Effective role                     | Additional requirement                                         |
| ------------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| Administration snapshot               | Owner or Administrator             | Active account session                                         |
| Administrator create/rename/status    | Owner                              | Current account/state revision                                 |
| Ownership transfer                    | Owner                              | Current state revision and single-use reauthentication proof   |
| Publisher create/rename/status/assign | Owner or Administrator             | Current account/state revision; assignment may require reauth  |
| Device rename                         | Owner or Administrator             | Current device revision                                        |
| Device revoke                         | Owner or Administrator             | Current device revision and single-use reauthentication proof  |
| Dynatrace URL/profile replacement     | Owner or Administrator             | Current setting revision                                       |
| Dynatrace token replacement           | Owner or Administrator             | Current setting revision and single-use reauthentication proof |
| Wiki document management              | Owner, Administrator, or Publisher | Active protected session                                       |

The administration snapshot exposes only `Configured` or `Not configured` for secrets. Replacement fields start blank and are cleared on submit, cancellation, failure, session lock, and unmount. No endpoint reveals an existing password or token. Device views expose only a short fingerprint suffix; public keys and signing metadata remain server-side.

Publisher assignment is exclusive: the singleton authority record contains zero or one Publisher account ID. Assignment never converts an Owner or Administrator into a Publisher. Reassignment validates the Publisher record, reserves the next assignment revision, revokes the previous Publisher's devices/sessions, and leaves the incoming Publisher pending server-local credential setup.

Revoking a paired device changes the authoritative server record immediately. The next signed probe or command is rejected even if the laptop retains its encrypted local key. Credential changes likewise revoke all paired devices for that account. Files on another workstation are never remotely deleted.

Server configuration remains an exhaustive allowlist. Dynatrace environment URL, platform-token replacement, and alerting-profile names are typed and revision-checked. Connection paths, backup destinations, restore files, folder/executable pickers, and arbitrary settings objects are not remotely callable and remain local to the managed Relay server PC.

Privileged requests reuse the configured PocketBase endpoint, authentication, and realtime channel; Relay opens no additional inbound port. On a trusted HTTP LAN, signatures provide request authenticity, integrity, authorization, and replay resistance, but they do not encrypt passwords, pairing codes, metadata, or responses. HTTP therefore does not provide confidentiality. Keep this deployment on the managed trusted LAN and use HTTPS if traffic crosses that boundary.

### Operator-Roster Migration, Preflight, And Rollback

The legacy `relay_operators` roster is a migration input, not a runtime identity source. Startup first plans the complete conversion and defers privileged runtime if Ryan, Charles, authority pointers, usernames, roles, or referenced historical names are ambiguous. The conversion keeps existing protected-account IDs, writes normalized account identity and account-ID authority pointers, fills only empty historical name snapshots, and re-reads and validates the converted state. Legacy ordinary `role=operator` auth rows are retired because ordinary use no longer authenticates; a row that still owns a paired device causes migration to defer rather than break that binding. The known `relay_login_roster` view must match its exact legacy query, is removed before `relay_operators`, and both collections remain until post-conversion validation succeeds. Existing non-empty `author`, `addressedBy`, `createdBy`, and `displayNameSnapshot` values are never overwritten. Paired-device `accountId` values are not remapped.

Before upgrading an existing installation, create a consistent copy with the PocketBase backup API or SQLite's online backup operation. Do not copy a live `data.db` alone while WAL activity is possible. Run the new build only against the copy and verify: `ryan` / Ryan Bledsoe is the one Owner; `charles` / Charles Gibbs is an Administrator; Publisher count is zero or one; `relay_login_roster` and `relay_operators` are absent only after success; every paired-device account ID matches the preflight baseline; and every pre-existing non-empty historical name snapshot is byte-for-byte unchanged.

Keep the consistent pre-migration backup until the upgraded installation has passed the same checks. If planning defers, do not touch the live installation. If a commit or post-commit check fails, stop Relay and restore the whole pre-migration PocketBase backup before starting the previous build; do not hand-edit collections or run an older build against a partially converted database. A retry with the new build is safe only after the copied database has been inspected and the migration's converted-state validation succeeds.

### Managed Wiki Documents

The Wiki is read-only during ordinary use. `knowledge_documents` has authenticated list/view rules and no direct client create, update, or delete rules. Its PDF field is protected, limited to one `application/pdf` file, and capped at 50 MiB. Only allowlisted, capability-checked server commands publish or mutate managed documents.

`knowledge_categories` is also renderer-read-only and remains outside `WRITABLE_CACHE_COLLECTIONS`. Owner, Administrator, and Publisher category/document changes use strict signed payloads under `knowledge.manage`; the server rechecks the account capability, expected revisions, case-insensitive category uniqueness, document membership, and mandatory reassignment before mutation. The system fallback category cannot be deleted. No category operation enters the ordinary offline-write replay path.

Publisher uploads use account- and device-bound `knowledge_upload_batches`, `knowledge_uploads`, and `knowledge_upload_chunks` records. A batch contains at most 100 files; files are split into fixed 4 MiB chunks and limited to two concurrent transfers. Every chunk is bound to its batch, upload, account, device, index, size, and SHA-256. The server reassembles chunks in order, verifies each checksum and the declared whole-file checksum, validates the PDF signature and size, then performs bounded extraction. Temporary upload records expire after seven days. Cancelling removes chunks and staged bytes; successful publication copies the protected PDF into `knowledge_documents` and clears the staged upload file immediately.

The resumable queue lives in the main process. The renderer receives only bounded filenames, sizes, state, and progress—never source paths or PDF bytes. Persisted source paths are Electron `safeStorage` ciphertext in an owner-only file. If encryption is unavailable Relay keeps the queue in memory only. On restart or resume, Relay asks the server which chunk indexes are missing and sends only those indexes after revalidating the unchanged source file. Automatic sign-out and shutdown suspension remains queued for recovery, while an explicit Publisher pause remains paused until resumed. Before status lookup, source access, transfer, acknowledgment, and finalization, the scheduler rechecks that the active account and local source still own the queued item so work from one Publisher session cannot continue through another.

The preload bridge exposes the bounded PDF/status reads `getKnowledgePdf({ documentId, checksum })` and `getKnowledgeIndexStatus()`, plus a dedicated `openKnowledgeWebLink(url)` action. The PDF request schema accepts a bounded PocketBase-style ID and lowercase SHA-256 checksum; it does not accept paths, URLs, tokens, or credentials. Each handler validates the sender as a trusted Relay main frame before invoking the main-process service.

On clients, the main process checks the configured Relay server's PocketBase health endpoint, then authenticates with Relay's existing app account and configured connection secret before requesting the protected file. This distinguishes Relay reachability from generic internet connectivity. It uses the configured, policy-validated LAN server URL and does not add certificate bypasses, external fetches, or permissive CORS headers. Response bodies are streamed through a hard bound before allocation; cached files are size-checked before reading. Downloaded bytes must match the PDF signature, collection byte count, 50 MiB limit, and requested SHA-256 before an atomic cache write.

PDF parsing runs in a single-concurrency worker with a 30-second job timeout, a 1,000-page limit, and a 500-heading output limit. Page-one cover rendering runs in the same isolated extraction path, clamps the canvas to 480 by 620 pixels, and accepts only PNG output no larger than 2 MiB. PDF.js evaluation is disabled. The renderer loads the bundled PDF.js worker locally with automatic fetch/streaming disabled and exposes canvas/text rendering plus a narrow Relay-owned overlay for link annotations on the active page. It does not enable PDF.js forms, attachments, arbitrary annotation UI, print, or download controls. CSP retains `object-src 'none'`; the feature does not embed a browser PDF plugin or use cloud OCR, telemetry, or CDN assets.

The preload bridge exposes `getKnowledgeCover({ documentId, checksum })` as a separate bounded read. Trusted-sender validation runs before the service is invoked, and the request cannot carry a path, URL, token, or credential. The main process obtains short-lived PocketBase file authority internally, confines it to the document record's protected cover field, streams the response through a 2 MiB hard bound even when `Content-Length` is absent, validates the PNG signature, and never returns the token or server URL to the renderer.

PDF.js can flatten URI, Launch/GoToR, and recoverable JavaScript actions into the same URL fields. Relay therefore treats every retained PDF.js URL value as origin-agnostic inert text and reclassifies it through its own resolver; it never executes the originating PDF action. Native destinations stay inside the current PDF.js document. PDF-like paths resolve only against indexed Knowledge metadata, and an absolute or `file:` path contributes only its filename, never local filesystem authority. Unsupported protocols and action fields PDF.js retains explicitly do not produce a focusable overlay.

Only an explicit operator click on a resolved HTTP(S) overlay can invoke `openKnowledgeWebLink`. The dedicated main-process handler requires a trusted sender, shares Relay's existing external-action rate limiter, parses a bounded URL, permits only HTTP(S) with a hostname, and rejects credentials, control characters, oversized values, and malformed URLs before calling `shell.openExternal`. This narrow action does not broaden or replace the provider allowlist on the general `OPEN_EXTERNAL` channel.

Full-text search is an optional derived-data boundary. A server worker extracts bounded PDF passages into `knowledge_search_chunks`, which stores both original and normalized passage text. The collection is server-owned: authenticated clients may list/view it for search, but direct client create/update/delete rules are disabled. The main-process search service validates and bounds snapshots, reconciles realtime events, and may copy document metadata and chunks into the desktop offline search snapshot. Search requests are schema-validated and cancellable through trusted IPC; Relay Web adds authenticated same-origin routing and a per-session route limit.

Each stored passage field is capped at 1,600 characters. The search service accepts at most 100,000 chunks and 128 MiB of passage text in a snapshot; queries are limited to 120 Unicode code points and results/excerpts are bounded before reaching the renderer. Bootstrap and indexing are best-effort, so failure disables search without weakening PDF publication or read controls. The extracted text is duplicated operational content in PocketBase, local search snapshots, and backups; Relay does not encrypt those stores itself. Continue to rely on managed-device access controls and full-disk encryption for confidential runbooks.

Knowledge metadata uses the normal authenticated PocketBase/realtime path and may be stored in the read-only offline snapshot. PDF caches are content-addressed, checksum-validated, bounded to 2 GiB, and pruned through Relay's existing daily maintenance cycle. Cover files use the PDF checksum as their cache key, are PNG-signature and size validated before atomic promotion, permit only two concurrent generation/download jobs, and are confined to a separate 100 MiB cache of referenced checksums. These controls protect integrity and limit disk use, but they are not encryption: continue to rely on managed-device access controls and full-disk encryption for confidential runbooks. HTTP remains appropriate only on the trusted LAN deployment described above; use HTTPS if traffic crosses that boundary.

## Backups, Sync, And Resilience

### Backup Safety

`src/main/handlers/backupHandlers.ts` validates backup filenames before restore and rejects traversal attempts.

Scheduled maintenance attempts a backup if one is due before retention cleanup, but authentication or backup failure is logged and does not stop cleanup. Do not treat the daily maintenance order as proof that every pruned record has a current restore point; monitor backup creation and verify restores independently. See `docs/architecture.md` for the schedule and retention flow.

### Offline Cache And Replay

The offline cache and replay pipeline live in:

- `src/main/cache/OfflineCache.ts`
- `src/main/cache/PendingChanges.ts`
- `src/main/cache/SyncManager.ts`

This design provides:

- Read fallback while PocketBase is unavailable
- Queued writes for reconnect scenarios
- Conflict logging via the `conflict_log` collection

Relay Web collection readiness is tied to a monotonically increasing connection generation.
Disconnects and PocketBase client replacements close the write gate and invalidate outstanding
list fetches, so a stale pre-transition response cannot install data or reopen browser writes.

### Error Handling

`src/main/app/errorHandlers.ts` installs process-level guards.

Current behavior:

- Packaged Windows builds notify open windows and automatically relaunch after the first fatal uncaught exception unless fatal relaunch is explicitly disabled
- Other platforms and unpackaged runs show a blocking dialog with `Quit` and `Continue`
- Repeated unhandled rejections within a rolling window trigger a renderer stability warning

### Log Redaction

Structured logs are redacted before persistence.

Key file:

- `src/shared/logRedaction.ts`

The redaction layer strips common sensitive fields and scans strings for PII such as emails and phone numbers.

### URL Logging

Blocked-navigation and blocked-window-open log lines record the origin of the attempted URL only (via `describeUrlForLog` in `src/shared/urlSecurity.ts`), not the full URL. This avoids inadvertently logging tokens, session IDs, or other data carried in paths or query strings.

Authenticated browser log messages retain their browser provenance prefix and escape CR, LF, and
Unicode line separators before entering line-oriented sinks. One accepted browser event therefore
produces one physical log record while preserving delimiter content as visible escaped text.

## Developer Rules

- Do not expose new Electron or Node.js APIs directly to the renderer
- Validate all new IPC payloads in shared schemas before handling them
- Keep file-system access in the main process and run it through path validation
- Escape user input in PocketBase filter strings
- Log security-relevant failures without logging raw secrets

## Reporting Issues

Report security vulnerabilities privately to the project maintainers. Do not open public issues for exploitable security bugs.
