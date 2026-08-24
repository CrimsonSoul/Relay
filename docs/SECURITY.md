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
- Credential-free status-feed aggregation, including the public Juniper Mist API

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

Dispatcher Radar crosses this boundary only as a bounded, strictly validated `RadarSnapshot`. CW Dashboard cookies remain in the Electron Radar session on the Relay server PC and are never returned to the browser. Radar reads require an authenticated Web session. Manual refresh additionally requires same-origin and CSRF validation and is limited to 12 requests per logical session per minute. The browser cannot supply a Radar URL, cookie, credential, or alternate dashboard target.

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
Juniper Mist incident links are limited to HTTPS URLs whose hostname is exactly
`status.mist.com`; lookalike and credential-bearing URLs are rejected.
Teams desktop and web URLs are further confined to the meeting-draft path,
exact `subject` and `attendees` fields, bounded decoded values, and validated
attendee addresses. Relay has no general `mailto:` opener.

Service Desk links use a separate, explicit-click capability so they do not
broaden the general external-link allowlist. That handler accepts only bounded,
credential-free HTTPS URLs without custom ports, validates the IPC sender, uses
the shared external-action rate limit, and logs only an origin-safe URL
description when it blocks or cannot open a link. Relay Web applies the same URL
shape checks in its browser action before opening a new tab.

This capability applies no host allowlist. The Service Desk host is
operator-supplied, so any HTTPS host that meets the shape checks is accepted.
The trust boundary is the explicit operator click plus the shape checks, not a
fixed host set.

### Release Discovery And Manual Installation

Desktop update discovery is advisory and credential-free. The main process requests only the fixed
GitHub API endpoint for `CrimsonSoul/Relay`'s latest release, rejects redirects, bounds request time
and response size, requires JSON, and accepts only a published normal `vX.Y.Z` release. Discovery
alone can display a mutable release, but installability additionally requires GitHub's immutable
flag, a commit SHA, exactly the expected ZIP and checksum assets, uploaded state, bounded sizes,
fixed asset API URLs, and valid GitHub SHA-256 digests. The renderer cannot provide an alternate
repository, URL, version, path, asset, or process argument.

Every privileged updater transition requires a separate trusted-sender-validated IPC action. A
release check never starts a download; a download never starts installation; installation never
restarts Relay. Electron test mode suppresses filesystem and process side effects. Relay Web does
not receive discovery or updater capabilities.

Downloads stream to an exclusive `.part` file in an app-owned, randomized version directory under
the current user's `%LOCALAPPDATA%\Relay\Updates` tree. Relay applies a protected Windows DACL that
grants only the current user and LocalSystem full control, then atomically renames each verified
download to its final asset name. The downloader permits only HTTPS redirects to
the fixed GitHub and GitHub asset hosts, rejects credentials and custom ports, caps redirects and
bytes, enforces the advertised length, and calculates SHA-256 while writing. Relay requires the
downloaded ZIP digest to agree with both GitHub metadata and the separately downloaded checksum
file. The ZIP must contain exactly one regular, non-encrypted top-level `Relay.exe`; traversal,
links, directories, case variants, extra members, unsupported compression, size expansion, CRC
failure, and a missing Windows executable marker fail closed and remove the staging directory.

Before execution, Relay resolves and revalidates the staging directory and installer, rejects
symbolic links, confirms the exact size and Windows marker, and re-hashes the executable. The only
spawned argument is `/relay-prepare-only`, which delegates runtime preparation to Relay's existing
bootstrap. Restart is another explicit action and is allowed only through the validated stable
`%LOCALAPPDATA%\Relay\Relay.exe` launcher. Cancellation, verification failure, and successful
preparation remove staged files; a failed bootstrap keeps only the already verified installer for a
manual retry. Startup cleanup removes only recognized updater directories older than 24 hours.

The automated release workflow uploads the ZIP and checksum to a clean draft release without
in-place asset overwrites, compares GitHub's target commit and asset digests with the verified source
and locally generated bytes, resolves the tag to that source before publication, then publishes and
waits for immutable state. A published release is never overwritten. Repository release
immutability, branch protection, the
required Build/SonarQube/Snyk gates, and the protected GitHub account are therefore part of the
update trust root.

Relay release executables do not currently carry independent Windows publisher signing. The GitHub
immutable release and its protected workflow provide integrity and provenance within that trust
root, but they do not provide Authenticode publisher identity if GitHub or the release authority is
compromised. Keep repository protections and release immutability enabled, review the fixed GitHub
release when in doubt, and do not describe this path as equivalent to a publisher-signed updater.
Release-note bodies are bounded and schema-validated in the main process, persisted atomically with
owner-only file permissions, and rendered as React text nodes through a small Markdown subset; raw
GitHub HTML and arbitrary links are never injected. Opening release details continues to use a
rate-limited IPC handler. The renderer may supply only an optional normal semantic version, which
the main process validates before appending it to the fixed Relay Releases URL.

### Retained Runtime And Rollback Safety

Recovery is limited to packaged Windows x64 Relay. The stable native launcher and bootstrap own all
runtime selection, catalog mutation, candidate promotion, server-data restoration, and fallback
launching; the renderer cannot supply an executable, path, URL, command line, release tag, or commit.
The protocol-2 catalog is strict and bounded: it accepts only the current build, at most three
healthy predecessors, and one transaction-bound candidate. Unknown sections, duplicate keys,
invalid IDs, malformed hashes or timestamps, inconsistent health, incompatible data epochs, and
unreferenced build records invalidate recovery rather than widening the trusted set.

Runtime roots, recovery metadata, repair staging, and server snapshots are re-resolved beneath their
fixed app-owned parents. Relay rejects symbolic links, reparse points, non-direct children, changed
executables, and incomplete markers. A runtime marker must agree with the catalog on build ID,
SHA-512, version, tag, full commit, recovery protocol, and server/client data epochs. Catalog and
request updates use private directories plus write-then-rename activation; the native launcher
serializes mutation with a no-sharing lock. Cleanup fails closed when the catalog, roots, marker, or
transaction state cannot be proved and never deletes a referenced runtime or snapshot.

Server snapshots are taken only after PocketBase and server-owned services stop. Relay rejects
redirected or unsupported entries, scans the source and copy, requires free space for twice the data
size plus a 512 MiB margin, writes the completion marker last, and atomically activates the snapshot
directory. Native restoration validates the transaction and source identity, journals the swap, and
keeps the displaced live directory until the authoritative snapshot has become live. Client mode
does not rewind shared server state; it closes successfully checkpointed local cache and pending
mutation databases before the runtime transition. A rollback is blocked when either data epoch
differs.

Candidate health is established by the stable launcher, not by the candidate declaring itself
current. The candidate receipt is accepted only for the active transaction after renderer mount,
local startup completion, and 60 seconds of relevant data-plane health. The native supervisor uses
a bounded process wait and at most two attempts. During probation Relay disables its normal crash
watchdog, window reload, and process auto-relaunch behavior; packaged Windows PocketBase runs in a
kill-on-close Job Object so a failed candidate cannot leave the embedded server behind. A failed
candidate's exact immutable `tag@commit` fingerprint is suppressed by future update checks rather
than suppressing an unrelated later release with the same version comparison context.

Reading recovery state still requires trusted-sender IPC. Repair and rollback additionally require
an active Owner session, fresh password reauthentication, bounded validated input, and the shared
reauthentication rate limiter; GitHub repair also consumes the network-action limit. Repair resolves
the exact retained version and full commit from the fixed Relay repository, requires an immutable
release and the normal ZIP/checksum/digest checks, and asks that historical bootstrap to recreate
only its matching catalog-bound runtime. If the saved installer hash is known, it must match too.
The bootstrap receipt is bound to the transaction, build, version, commit, runtime hash, and installer
hash. Repair never promotes a build, changes current data, replaces the stable launcher, or rewrites
the catalog.

The native Recovery shortcut prefers retained builds and the normal launcher falls back to them when
the current runtime is unusable, keeping the recovery screen reachable when the current Electron
bundle is broken. If no validated runtime starts, only the fixed Relay Releases URL is opened. This
fallback inherits the release trust limitation above: releases are immutable and digest-verified,
but not independently Authenticode-signed.

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

`cloud_status_snapshot` and `cloud_status_mist_snapshot` are authenticated-read,
server-owned PocketBase collections. Desktop cache read, realtime, and snapshot
paths may mirror both collections, but neither is included in the offline-mutation
or user import/export allowlists. The Mist adapter fetches only the public
credential-free `status.mist.com` API and sends no Relay or third-party secrets.

### Brand Image Validation

Company and client logos are limited to 2 MiB of compressed input and accepted only as PNG, JPEG,
or WebP. The shared main-process image pipeline applies explicit source width, height, pixel, and
decoded-byte budgets before full decode, resizes inside a 400 by 400 pixel box without enlargement,
and bounds the generated PNG before persistence or response construction.

### Rate Limiting

`src/main/rateLimiter.ts` provides global and caller-keyed token buckets. Security coverage is determined by handler call sites, not merely by a configured bucket.

Currently enforced limits include:

| Boundary                 | Enforced operations                                                                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global IPC buckets       | Native file/shell actions, Wiki source selection/staging, release-page opening, update installation/restart, and Wiki external-link opening (`fsOperations`); cloud-status refreshes, release checks, and update downloads (`network`); renderer log forwarding (`rendererLogging`) |
| Keyed privileged buckets | Protected login, pairing-code verification, signed commands, and the separately budgeted Wiki upload command plane                                                                                                                                                                  |
| Relay Web route buckets  | Per-address session login and per-session refresh, operational mutation, protected-command, Wiki file/search/upload, and browser-log routes                                                                                                                                         |

`fileImport`, `dataMutation`, and `dataReload` are defined as reusable global buckets but have no current production call sites; do not rely on those definitions as enforced controls. Global and privileged denials are logged without the opaque caller key. Relay Web returns HTTP 429 with `Retry-After`.

## Automated Security And Quality Gates

Relay's pull-request and `main`-branch controls are defined by the checked-in workflows. The required jobs are:

- **Build quality gate**: formatting, linting, type checking, tests, and the production build.
- **SonarQube quality gate**: first-party quality and security analysis, imported unit and renderer coverage, unresolved-issue enforcement, and validation of the exact uploaded analysis.
- **Snyk security gate**: high- and critical-severity Open Source and Snyk Code findings, including development dependencies. Only a merged `main` push publishes the canonical monitored snapshot for `main`.

The Sonar and Snyk CI wrappers classify every run as one of four outcomes:

| Outcome       | Meaning                                                                  | Merge effect                     |
| ------------- | ------------------------------------------------------------------------ | -------------------------------- |
| Clean         | The scanner completed and produced no blocking finding.                  | Required job succeeds.           |
| Finding       | A completed scan or quality gate produced a blocking finding.            | Required job fails.              |
| Unavailable   | The scanner produced no decision because a documented outage occurred.   | Required job warns and succeeds. |
| Configuration | Credentials, scope, identity, response, or an unknown failure is unsafe. | Required job fails closed.       |

A completed finding is a release blocker. A documented scanner outage may be classified as **Unavailable** so CI can distinguish missing evidence from a negative decision, but an Unavailable result is not a clean scan. Retry it and require a real scanner decision before release. Missing credentials, authorization failures, malformed responses, identity drift, and unknown errors fail closed as Configuration failures.

Pull-request scans do not change Sonar issue state or the Snyk monitored snapshot. A merged `main` push may apply the pinned Sonar review manifest and update the `main` Snyk snapshot. The Sonar reconciler validates issue identity and metadata before writing, refuses unknown open findings, is idempotent, and fails closed on drift. Scanner output is bounded and redacted; scanner tokens belong only in GitHub Actions secrets.

CodeRabbit findings remain blocking through its review state and unresolved review conversations even though CodeRabbit availability is not a required check. GitHub dependency alerts, automated dependency security fixes, secret scanning, and push protection should remain enabled.

Treat any failing gate as a release blocker until the finding is validated and fixed or a narrowly documented exception is approved. Run a Codex Security standard scan before releases and after changes to authentication, IPC, Relay Web, updates, file handling, or privileged commands. Use a deep scan for major trust-boundary redesigns or when a standard scan identifies a plausible multi-stage attack path.

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

The legacy `relay_operators` roster is migration input, not a runtime identity source. `RoleAccountMigration` plans and validates the whole conversion before privileged runtime can start. It preserves protected-account IDs, paired-device bindings, account-ID authority pointers, and every non-empty historical attribution field. The known `relay_login_roster` view must match its exact legacy query; ambiguous identities, roles, references, or schema defer the migration instead of guessing.

Before upgrading an existing installation, make a consistent PocketBase or SQLite online backup; never copy a live `data.db` alone while WAL activity is possible. Exercise the upgrade against a disposable copy first. Verify the single Owner, Administrator and optional Publisher roles, authority pointers, paired-device account IDs, historical attribution, and removal of the two legacy collections only after successful conversion.

Keep the full pre-migration backup until those invariants pass on the upgraded installation. If planning defers or a post-conversion check fails, stop Relay and restore the entire backup before starting the previous build. Do not hand-edit collections or run an older build against a partially converted database. The implementation and regression cases live in `src/main/privileged/RoleAccountMigration.ts` and `src/main/privileged/__tests__/RoleAccountMigration.test.ts`; see `docs/DEVELOPMENT.md` for disposable-data testing rules.

### Managed Wiki Documents

Managed Wiki metadata is read-only to ordinary clients. `knowledge_documents` and `knowledge_categories` permit authenticated reads but no direct client mutation. Publishing, category management, and deletion use allowlisted server commands that rederive the caller's Owner, Administrator, or Publisher capability and enforce revision, uniqueness, membership, and reassignment rules. Wiki mutations never enter the ordinary offline replay queue.

Uploads are account- and device-bound, size-limited, chunked, and resumable. The server binds every chunk to its batch and upload, verifies chunk and whole-file checksums, validates the PDF signature and size, performs bounded extraction, and removes expired, cancelled, or successfully published staging data. The main-process queue never exposes source paths or PDF bytes to the renderer. Persisted paths use Electron `safeStorage` in an owner-only file; without OS encryption the queue remains memory-only.

PDF and cover reads cross narrow, trusted-sender-validated preload methods. Requests carry only bounded document IDs and checksums; the main process obtains short-lived file authority internally, streams through hard size limits, validates signatures, sizes, and checksums, and promotes cache files atomically. Tokens, server URLs, paths, and credentials never enter renderer responses.

PDF parsing and cover generation run through bounded workers. Relay uses the bundled PDF.js runtime with automatic fetching and streaming disabled, and it does not enable forms, attachments, arbitrary annotation actions, printing, downloads, cloud OCR, telemetry, or browser PDF plugins. PDF.js link and action data is inert until Relay's resolver reclassifies it. Native destinations remain in-document; unsupported schemes and local paths do not gain filesystem or execution authority. Only an explicit operator click on a resolved HTTP(S) link can reach the rate-limited, trusted-sender-validated external-link handler.

Full-text search is optional derived data. The server owns `knowledge_search_chunks`; authenticated clients may read it but cannot mutate it directly. Indexing and search are bounded and failure-isolated so a search outage does not weaken publication or PDF access controls. Extracted passages are duplicated operational content in PocketBase, desktop snapshots, and backups, and Relay does not encrypt those stores itself.

Knowledge metadata may use the normal read-only offline snapshot. PDF and cover caches are content-addressed, checksum-validated, bounded, and disposable; they are never authority for the managed library. Server backups include authoritative managed documents and derived search data, but local caches and resumable upload queues require no restore. These controls provide integrity and resource limits, not encryption. Use managed-device controls and full-disk encryption for confidential runbooks, and HTTPS whenever traffic leaves the trusted LAN boundary. See `docs/knowledge-base.md` for operator behavior and `docs/architecture.md` for the complete data flow.

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
