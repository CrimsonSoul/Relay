# Privileged Operators and Knowledge Base Management Design

**Date:** 2026-07-15

**Status:** Approved design; specification awaiting final review

## Summary

Relay will preserve passwordless operator selection for normal attribution while adding a narrow privileged-access layer for administration and Knowledge Base publishing.

Ryan Bledsoe will be the Relay administrator. The administrator can manage operators, designate one existing active operator as the Knowledge Publisher, manage the complete Knowledge Base, and administer Relay settings from the server PC or a paired Relay laptop. The designated publisher can manage everything inside the Knowledge Base but receives no broader Relay administrative authority. All other operators remain passwordless and retain read-only Knowledge Base access.

The existing server-local watched PDF folder will be migrated into a server-authoritative managed library. After migration, privileged users will add, replace, categorize, rename, move, trash, restore, and permanently delete PDFs through a dedicated management workspace. Connected Relay clients will continue receiving active documents through the existing PocketBase realtime path, and cached documents will retain the current offline-reader behavior.

Remote privileged actions will not write directly to live collections. A paired laptop submits a bounded, signed request through the existing LAN PocketBase service. The Relay server validates the privileged account, device, request signature, role, revision, and operation before applying an atomic server-side change and appending an audit event.

## Relationship to Existing Designs

This design extends and partially supersedes three existing specifications:

- `2026-07-13-passwordless-operator-profiles-design.md` remains authoritative for normal operator selection and historical attribution. Its statement that operator profiles never grant permissions remains true for ordinary profiles, but privileged accounts may now be linked to selected operator records.
- `2026-07-14-read-only-pdf-knowledge-base-design.md` remains authoritative for the Focus Reader, PDF parsing, protected-file transport, offline cache, and renderer security. Its server-folder ownership model and content-management non-goals are superseded after the one-time migration.
- `2026-07-14-knowledge-pdf-links-design.md` remains authoritative for same-document links, relative PDF links, filename matching, page fragments, and guarded web links.

Existing client/server discovery, the shared Relay app account, the Relay connection passphrase, normal collection synchronization, and operator attribution behavior remain intact.

## Goals

- Keep normal Relay operation passwordless for ordinary operators.
- Add Ryan Bledsoe as a password-authenticated administrator with complete in-app Relay authority.
- Add Tristan Bowles as a normal passwordless operator.
- Let the administrator designate exactly one existing active operator as Knowledge Publisher.
- Let the publisher manage every Knowledge Base content operation without gaining unrelated Relay permissions.
- Support privileged management from the server PC and paired work laptops.
- Keep privileged credentials, tokens, and private device keys out of renderer storage, offline caches, logs, and synchronized application records.
- Keep clients from writing directly to the authoritative Knowledge Base.
- Preserve the Focus Reader, PDF heading extraction, relative links, guarded web links, realtime updates, and offline document cache.
- Provide recoverable trash, append-only audit history, conflict protection, and atomic publication.
- Preserve Relay client-to-server connectivity and avoid adding another inbound LAN service or firewall dependency.
- Keep all Knowledge Base content and processing on the managed LAN.
- Adapt cleanly to a window approximately half of a 1080p display.

## Non-goals

- Normal operators will not receive passwords or individual login accounts.
- Selecting an operator name is not authentication and never grants a role by itself.
- Relay will not become an identity provider or replace company account management.
- The administrator role does not grant Windows, filesystem, device-management, firewall, VPN, or corporate-network authority outside Relay.
- Relay will not expose arbitrary shell execution, arbitrary SQL, unrestricted filesystem browsing, or generic remote code execution.
- The Knowledge Base will not edit PDF body content, annotations, forms, attachments, or embedded links.
- Relay will not add cloud storage, cloud OCR, cloud search, or external PDF processing.
- Privileged mutations will not be queued for offline execution.
- Permanent deletion of operator profiles remains unsupported.
- This work does not make the existing HTTP LAN connection confidential against a capable network observer.

## Initial Operator Roster

After migration, the active roster contains nine profiles:

- Charles Gibbs
- Connor McElroy
- Paris Carlson
- Ryan Bell
- Ryan Bledsoe
- Tristan Bowles
- Tristan Stillwell
- Vlad McCarty
- Weston Yokley

Ryan Bledsoe is linked to the administrator role. Tristan Bowles is a normal operator. The existing seven operators and their stable IDs remain unchanged.

Adding the two new profiles uses an explicit idempotent migration marker rather than treating the expanded list as a perpetual seed. Renaming or deactivating Ryan Bledsoe or Tristan Bowles later must not recreate another profile with the original name.

Role authorization is always linked by stable operator ID. Display-name comparison is used only during the one-time migration to locate or create the intended records.

## Identity and Role Model

Relay maintains two separate concepts:

1. **Operator attribution** identifies the person responsible for a note, ticket reference, local disposition, or other human action. It uses the existing locally selected `relay_operators` record and remains passwordless.
2. **Privileged authorization** permits a bounded set of administrative commands. It requires a linked privileged account, password authentication, an active privileged session, and, for remote clients, an active paired device.

The supported roles are:

| Role | Authentication | Permissions |
| --- | --- | --- |
| Operator | Passwordless selection | Normal Relay use and read-only Knowledge Base |
| Knowledge Publisher | Password plus paired device when remote | All Knowledge Base management operations and Knowledge audit viewing |
| Administrator | Password plus paired device when remote | All publisher permissions, operator and role management, device management, audit viewing, and all in-app Relay settings |

There is exactly one administrator assignment and at most one publisher assignment. Ryan Bledsoe is the administrator. The publisher must be a different active operator selected by the administrator.

The administrator bypasses publisher checks for Knowledge Base actions. The administrator does not need to assign themselves as publisher.

Reassigning the publisher:

- changes the authoritative publisher assignment first;
- immediately makes the prior publisher fail subsequent authorization checks;
- invalidates the prior publisher's privileged sessions;
- revokes the prior publisher's paired-device grants;
- disables the prior publisher credential while preserving their normal operator profile and history; and
- creates a pending credential state for the new publisher.

The administrator operator cannot be deactivated while linked to the active administrator role. An active publisher must be unassigned or replaced before their operator profile can be deactivated.

## Privileged Data Model

### `relay_privileged_accounts`

Add a dedicated PocketBase auth collection that is not used by normal Relay synchronization:

```ts
type RelayPrivilegedAccountRecord = {
  id: string;
  operatorId: string;
  role: 'admin' | 'publisher';
  active: boolean;
  mustChangePassword: boolean;
  credentialVersion: number;
  created: string;
  updated: string;
};
```

The built-in password hash and token key remain PocketBase-managed hidden auth fields. The `operatorId` relation is unique. List and view rules are server-only. Authentication is allowed only when `active = true`.

No password, password hash, auth token, reset material, or secret auth field is copied into Relay's SQLite cache, renderer state, logs, audit records, backups outside PocketBase, or ordinary synchronized collections.

### `relay_privileged_state`

Add one server-owned singleton record:

```ts
type RelayPrivilegedStateRecord = {
  id: string;
  key: 'primary';
  adminOperatorId: string;
  publisherOperatorId: string | null;
  assignmentVersion: number;
  updatedByOperatorId: string | null;
  updatedAt: string;
};
```

This record is the authority for role assignment. Authorization never relies only on the role field carried in an old token. Every privileged command compares the account and current assignment state.

Authenticated Relay app users may read a bounded projection containing only the administrator operator ID, publisher operator ID, and assignment version. This supports role chips and the conditional management entry without exposing accounts, devices, credentials, or security history. Writes remain server-only.

### `relay_privileged_devices`

Add a server-owned paired-device collection:

```ts
type RelayPrivilegedDeviceRecord = {
  id: string;
  accountId: string;
  deviceId: string;
  hostnameSnapshot: string;
  publicKey: string;
  state: 'active' | 'revoked';
  pairedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedByOperatorId: string | null;
};
```

The device public key may be stored on the server. The corresponding private key is generated in the Electron main process and stored using Electron `safeStorage` on the paired laptop. Relay must not store a remote private key when protected storage is unavailable.

### `relay_privileged_commands`

Remote privileged mutations use an append-only request/result record:

```ts
type RelayPrivilegedCommandRecord = {
  id: string;
  requestId: string;
  accountId: string;
  deviceId: string;
  operatorId: string;
  roleClaim: 'admin' | 'publisher';
  command: RelayPrivilegedCommandName;
  issuedAt: string;
  expiresAt: string;
  expectedRevision: string | null;
  payload: unknown;
  bodyHash: string;
  signature: string;
  state: 'pending' | 'processing' | 'succeeded' | 'failed';
  result: unknown | null;
  safeError: string | null;
  completedAt: string | null;
};
```

`requestId` is unique and provides idempotency. Payload and result schemas are command-specific, bounded, and validated in shared code. Secret fields never appear in a result. Expired, replayed, malformed, unpaired, revoked, incorrectly signed, or unauthorized commands are rejected without applying a partial change.

The Relay server subscribes to pending commands and also scans them at startup and on a periodic fallback interval. Only the server main process may mark a command processing, succeeded, or failed.

Create rules accept only an authenticated active `relay_privileged_accounts` record whose ID matches `accountId`. An account may view only its own command records. Update and delete rules are server-only. Ordinary shared Relay app users cannot create or inspect privileged commands.

## Authentication, Sessions, and Pairing

### Local setup and recovery

Initial administrator password setup occurs only in the server-mode Relay application. The bootstrap creates Ryan Bledsoe's inactive privileged account with an unreachable random credential. A local setup action replaces that credential, activates the account, increments its credential version, and records the completion without exposing the password.

Publisher assignment creates or resets an inactive publisher credential. Initial publisher password setup and all privileged password recovery also occur locally on the Relay server PC. This treats control of the server's Windows session as an explicit recovery trust boundary.

Passwords:

- must contain 12–128 characters;
- are entered only into a dedicated privileged-authentication surface;
- are passed from the renderer to the local main process through typed trusted IPC;
- are never saved by Relay, autofilled into ordinary fields, copied to logs, or synchronized; and
- are immediately cleared from renderer state after the attempt completes.

### Remote-device pairing

Remote privileged access requires a one-time pairing ceremony initiated on the server PC:

1. The administrator selects the privileged account and chooses `Pair laptop`.
2. The server creates a single-use pairing code that expires after ten minutes.
3. The privileged operator opens `Privileged access` on their work laptop, signs in, and enters the pairing code.
4. The laptop main process generates its signing key pair and submits the public key with the one-time code.
5. The server verifies the account, code, expiry, attempt count, and role assignment before activating the device record.
6. The code is consumed and cannot be reused.

Pairing codes allow no more than five failed attempts. Revoking a device is immediate because every privileged command checks the current device record.

The server PC is a trusted local execution surface and does not require a remote-device pairing record, but privileged actions still require an authenticated account and produce the same audit events.

### Session behavior

- Privileged auth tokens exist only in the Electron main process.
- Privileged authentication uses a separate main-process PocketBase client and auth store, so signing in or out never replaces the existing shared app account used by Relay synchronization.
- The renderer receives a minimal session projection: operator ID, display name, effective role, expiry state, and permitted capability names.
- A privileged session locks after 15 minutes without privileged activity. Ordinary Relay navigation does not extend it.
- Closing Relay, switching the locally selected operator, changing the password, publisher reassignment, account disablement, or device revocation clears the local privileged session.
- A locked session leaves ordinary Relay and the read-only Knowledge Base available.
- Failed authentication uses bounded feedback and rate limiting. Five failed attempts in fifteen minutes trigger a temporary account/device cooldown.

Password re-entry is required immediately before:

- permanent Knowledge Base deletion;
- publisher reassignment;
- privileged credential reset;
- paired-device revocation other than the current device;
- server connection or data-root changes;
- replacing Relay or Dynatrace secrets; and
- other settings explicitly classified as high risk.

## Signed Remote Command Boundary

Every remote command contains a canonical payload hash, unique request ID, issuing time, short expiry, account ID, device ID, role claim, and expected target revision. The paired device signs the canonical command bytes with its protected private key.

The server applies this validation order:

1. Validate collection and field size limits.
2. Reject an expired request or an issue time outside the accepted clock-skew window.
3. Claim the unique request ID or return its previously completed result.
4. Load the current account, operator, assignment, and device records.
5. Verify the device state and request signature.
6. Derive effective capabilities from the current server role assignment.
7. Validate the typed command payload and required reauthentication proof.
8. Compare the expected revision with current target state.
9. Apply the server-side operation atomically where PocketBase permits a single-record change, or with an explicitly recoverable ordered transaction for multi-record changes.
10. Append the audit result and return a bounded response.

The command catalog is allowlisted. It contains Knowledge Base operations, operator and role operations, device operations, and typed Relay-setting operations. It never accepts source code, executable paths, command lines, SQL, filesystem globbing, or arbitrary collection names.

Signed requests prevent an intercepted ordinary Relay client token from authorizing administrative changes. They do not encrypt the HTTP connection or the command contents.

## Operator and Administration Interface

### Normal operator behavior

The existing sidebar operator selector remains the source of attribution. Selecting Ryan Bledsoe or the publisher does not unlock anything. A privileged password and valid session are still required.

Normal operators:

- see the synchronized active roster;
- select their name without a password;
- use all ordinary Relay features;
- read the Knowledge Base; and
- cannot see management actions or secret setting values.

### Settings information architecture

Relay Settings keeps ordinary workstation preferences separate from privileged administration.

Ordinary sections remain:

- Appearance
- Relay data connection status and non-sensitive workstation information
- Operators, as a read-only roster when no administrator session is active
- Dynatrace public status and dashboard controls that are already intended for the current workstation

An authenticated administrator session adds an `Administration` area with:

- Operators and roles
- Publisher assignment
- Privileged accounts and credential state
- Paired and revoked devices
- Knowledge Base policy and index status
- Relay server configuration
- Dynatrace server configuration
- Backup, restore, and maintenance actions
- Security and audit history

Sensitive values use `Configured` or `Not configured` states. Existing secrets are never returned to a remote client. The administrator may replace a supported secret but cannot reveal its current value.

Relay operations that require choosing or inspecting an arbitrary server filesystem path remain local to the server PC. Remote administration may issue only typed, prevalidated path-independent settings commands. This keeps the administrator powerful inside Relay without turning the client into a remote filesystem browser.

### Operator management

With an administrator session, the existing Operators section supports add, rename, deactivate, and reactivate from a paired client or server PC. Publisher sessions receive no operator-management actions.

Rows show compact role chips:

- `ADMIN` for Ryan Bledsoe;
- `PUBLISHER` for the currently designated publisher; and
- no elevated chip for ordinary operators.

The publisher-assignment control lists active non-admin operators. Reassignment shows the previous and new publisher, explains immediate session/device revocation, and requires password re-entry.

Normal operator profiles are never permanently deleted. Historical attribution continues to render name snapshots exactly as it does today.

## Knowledge Base Reader and Management Entry

The normal Focus Reader remains the default Knowledge tab for every operator.

- Ordinary operators see the existing `Read only` state.
- An administrator or publisher whose selected operator matches their privileged account sees `Manage library`.
- Activating `Manage library` prompts for authentication when no active privileged session exists.
- Successful authentication changes to a clearly distinct dedicated management workspace.
- `Exit management` returns to the normal reader and preserves the privileged session until it locks or is explicitly signed out.

The management entry is a convenience affordance, not an authorization boundary. Every action is independently validated by the server.

## Dedicated Knowledge Base Management Workspace

The approved workspace contains four top-level views:

1. **Documents** — search, categories, active document inventory, metadata, and document actions.
2. **Uploads** — validation progress, extracted metadata, failures, and ready-to-publish items.
3. **Trash** — trashed documents with restore and permanent-delete actions.
4. **Audit** — append-only Knowledge Base activity and failure history.

### Documents

The desktop layout uses a compact category rail and a flexible document table. Documents can be searched and filtered by title, filename, category, status, or extracted heading label.

Each row shows:

- display title;
- category;
- original PDF filename;
- page and heading counts;
- last-published timestamp and operator; and
- an overflow menu for permitted actions.

Supported actions are:

- open in reader;
- change display title;
- move to another category;
- replace PDF;
- move to Trash; and
- inspect audit history.

The management workspace does not edit PDF body content. `Rename` changes the Relay display title, not the original PDF filename used by authored relative links. This preserves the current link-resolution contract. Replacing a PDF keeps the original filename and stable document record unless the publisher explicitly creates a separate document.

Categories remain derived from active document records. A publisher creates a category by assigning it during upload or move. Renaming a category is a validated server-side batch move. An empty category disappears automatically. Category names follow the existing one-level, 120-character validation rules.

### Uploads

`Add PDFs` opens a system file picker owned by the Electron main process. Multiple PDFs may be selected. Local paths never enter renderer state or logs.

Each upload follows:

```text
Selected -> Queued -> Uploading -> Validating -> Extracting headings -> Ready -> Publishing -> Published
                                                               |                         |
                                                               `-> Failed                `-> Failed
```

The ready state shows:

- PDF metadata title and editable Relay display title;
- original filename;
- target category;
- file size and page count;
- native, inferred, or absent outline status;
- extracted heading preview; and
- duplicate or replacement warnings.

The publisher reviews the ready item and explicitly chooses `Publish` or `Replace`. Uploading alone never exposes a document to readers.

Unpublished staging records expire after 24 hours. Expiry deletes only staging bytes and records an audit cleanup event; it never changes a live document.

### Responsive behavior

At approximately half of a 1080p display:

- Relay uses the existing collapsed global sidebar and hidden clock behavior;
- the management header keeps the page title, role/session state, and primary upload action visible;
- the category rail becomes a collapsible drawer;
- table rows adapt into compact stacked rows rather than overflowing horizontally;
- destructive actions remain in the overflow menu;
- panels use their own bounded scrolling; and
- no footer, action, or bottom-right control may depend on viewport clipping.

Keyboard navigation, focus restoration, accessible status messages, color contrast, and confirmation dialogs follow Relay's existing interaction patterns.

## Managed Knowledge Data Model

### Existing `knowledge_documents`

The existing protected collection remains the active document authority. Extend records non-destructively:

```ts
type ManagedKnowledgeFields = {
  lifecycleState: 'active' | 'trashed';
  displayTitle: string;
  revision: number;
  publishedByOperatorId: string;
  publishedByName: string;
  publishedAt: string;
  trashedByOperatorId: string | null;
  trashedByName: string | null;
  trashedAt: string | null;
};
```

Existing `title` remains readable during migration and becomes the initial `displayTitle`. Existing PDF, filename, checksum, page, outline, category, and indexed timestamps remain authoritative. Existing records default to `active` and revision `1`.

Active records continue through the existing metadata realtime/cache path. Trashed records are excluded from the normal reader and client cache snapshots. Trash listing is served only through privileged server commands.

### `knowledge_uploads`

Add a protected server-staging collection:

```ts
type KnowledgeUploadRecord = {
  id: string;
  requestId: string;
  accountId: string;
  deviceId: string | null;
  operatorId: string;
  operatorName: string;
  pdf: string;
  fileName: string;
  checksum: string;
  byteSize: number;
  pageCount: number | null;
  outline: KnowledgeOutlineNode[] | null;
  outlineSource: 'native' | 'inferred' | 'none' | null;
  proposedTitle: string;
  proposedCategory: string;
  state: 'uploading' | 'validating' | 'ready' | 'publishing' | 'failed';
  safeError: string | null;
  expiresAt: string;
  created: string;
  updated: string;
};
```

Clients cannot promote staging records into live documents. The server owns validation, state transitions, publication, and cleanup.

Create and file-upload rules accept only an authenticated active privileged account linked to the submitted account/operator IDs. A privileged account may view only its own staging records. All validation, update, promotion, cleanup, and deletion rules remain server-only. The server still verifies the paired-device signature before accepting the staged file as ready.

### `knowledge_audit_events`

Add a server-owned append-only collection:

```ts
type KnowledgeAuditEventRecord = {
  id: string;
  action: string;
  result: 'succeeded' | 'failed';
  operatorId: string;
  operatorName: string;
  role: 'admin' | 'publisher';
  deviceId: string | null;
  hostnameSnapshot: string;
  targetType: 'document' | 'category' | 'upload' | 'publisher' | 'device' | 'setting';
  targetId: string | null;
  targetLabel: string;
  beforeRevision: number | null;
  afterRevision: number | null;
  checksumBefore: string | null;
  checksumAfter: string | null;
  safeDetail: unknown | null;
  created: string;
};
```

No Relay client may update or delete audit events. Audit details are bounded and exclude passwords, tokens, private keys, full PDF text, raw PDF bytes, local paths, and secret configuration values.

## Server-Side Publication Pipeline

The publisher laptop may calculate a preliminary checksum and size for progress display, but the Relay server repeats every security and content check.

Server validation preserves the existing Knowledge Base bounds:

- canonical staged-file containment;
- no symlinks or arbitrary paths;
- `.pdf` extension and `%PDF-` signature;
- non-empty file;
- maximum 50 MiB;
- maximum 1,000 pages;
- no encrypted PDF requiring a password;
- 30-second extraction timeout;
- bounded metadata and outline node counts;
- safe category and display-title validation; and
- SHA-256 checksum calculated from server-received bytes.

Publishing a new document creates one protected `knowledge_documents` record containing the validated PDF and extracted metadata. Replacing a document updates that record in one server operation, increments its revision, retains its stable ID and original filename, and changes the checksum only after the protected file update succeeds.

If validation or publication fails:

- the live library remains unchanged;
- a safe error appears in Uploads;
- staging bytes remain available for retry until expiry unless the file itself is unsafe or invalid; and
- the failure is audited without exposing document content or paths.

Connected readers receive successful create, update, move, title, trash, and restore changes only after the authoritative server commit.

## Document Lifecycle

### Display title and category changes

A title change updates only `displayTitle` and revision. A category move updates the record's logical category/source key and revision without changing its stable ID, protected PDF, checksum, or original filename.

The existing PDF link resolver continues using original filenames. A uniquely named target continues resolving after a category move. Duplicate filenames still require an authored category-relative path and may require the author to update a link after a category rename or move. Relay never silently guesses among ambiguous documents.

### Replacement

Replacement requires a ready validated upload and an expected live revision. It preserves:

- document ID;
- original filename used by current authored links;
- category unless the publisher changes it explicitly; and
- audit continuity.

It replaces PDF bytes, checksum, page count, outline, outline source, metadata timestamps, publisher attribution, and revision. Existing cached checksums remain readable only while referenced by cached offline metadata and are cleaned by the existing cache policy.

### Trash and restore

Moving a document to Trash changes its lifecycle state and records operator attribution, timestamp, and revision. It does not remove PDF bytes or audit history. Normal clients remove the document from the active reader after the server commit.

Trash has no automatic document purge. A publisher or administrator can restore a document after the server checks filename, category, and revision conflicts.

Permanent delete requires fresh password re-entry. It removes the protected PDF and managed document record only after recording a deletion audit event with the final checksum and identity metadata. Audit history remains.

## Realtime, Offline, and Concurrency

- Normal operator reading retains the existing online snapshot, realtime update, metadata cache, and on-demand PDF cache behavior.
- Management requires a live server connection and an active privileged session.
- Privileged commands are never added to Relay's ordinary offline mutation queue.
- If connectivity drops after request submission, the server may finish the idempotent command. The client retrieves the result by `requestId` after reconnecting instead of submitting a duplicate operation.
- The UI reports `Published` only after the server marks the command succeeded.
- Every mutable target uses an expected revision. Stale commands fail with a refresh-required conflict and never overwrite newer state.
- Publisher reassignment, account disablement, password changes, and device revocation take effect on the next server authorization check even if an old token remains locally unexpired.
- A disconnected laptop retains the normal read-only Knowledge Base and previously cached PDFs but cannot enter or continue management mode.

## Audit, Retention, Backup, and Restore

Audit records include successful and failed privileged mutations with operator ID and name snapshot, effective role, hostname snapshot, timestamp, target, result, revisions, and relevant checksums.

Audit records are retained for at least one year. The retention job may remove older audit records only after a successful backup and according to an explicit server retention setting. Relay exposes no edit action for audit events.

Existing PocketBase backups include:

- active and trashed protected PDFs;
- staging records still within their expiry window;
- document metadata and extracted outlines;
- operator and privileged account records;
- role assignments and device public keys;
- command results and audit history; and
- non-secret configuration stored in PocketBase.

Passwords remain represented only by PocketBase hashes. Device private keys remain only on their paired laptops and are not part of the server backup.

After restore, privileged accounts and role assignments remain locked until the server verifies collection integrity and the administrator reauthenticates. Knowledge records are available without requiring the legacy source folder. Pending commands left in `processing` are reconciled by request ID and recorded as failed or safely resumed according to command type; they are never applied twice.

## Error Handling and Recovery

- Invalid credentials reveal only a generic authentication failure.
- Missing or inactive selected operator blocks privileged login without changing normal Relay access.
- Missing paired-device protected storage blocks remote privileged mode and directs the user to pair again.
- Invalid or expired pairing codes make no device change.
- Unauthorized, stale, malformed, replayed, or incorrectly signed requests perform no target mutation.
- Upload failures identify a safe category such as invalid PDF, encrypted PDF, too large, page limit, extraction timeout, duplicate, or server unavailable.
- One invalid upload does not block other queued uploads.
- A stale document, operator, publisher, device, or setting operation reports a conflict and offers refresh.
- Publisher reassignment may temporarily leave no active publisher after a crash, but it must never leave two authoritative publishers. The administrator can complete or retry assignment safely.
- Audit append failure prevents a high-risk mutation from reporting success. The server either rolls back the mutation where possible or records a reconciliation-required failure for deterministic repair.
- Failure messages never include passwords, tokens, private keys, full local paths, raw PDF text, protected-file URLs, or PocketBase authorization headers.

## Security and Privacy Boundaries

- PDF content, parsing, metadata extraction, storage, and transport remain on Relay laptops and the Relay server inside the LAN.
- The server remains the sole authority for live Knowledge Base and privileged collection changes.
- Normal clients keep read-only access to active Knowledge documents and cannot create, update, trash, restore, or delete them directly.
- Renderer processes never receive PocketBase superuser credentials, privileged auth tokens, device private keys, arbitrary server paths, or current secret values.
- Remote device signatures bind each command to an active paired key, current role assignment, payload, request ID, and expiry.
- Rate limits apply to authentication, pairing, uploads, commands, external links, and high-risk actions.
- PDF parsing remains isolated with evaluation disabled and existing size, page, outline, and timeout limits.
- Cross-document PDF links remain metadata-only identifiers and never cause local filesystem reads.
- Web links continue through the existing dedicated typed URL policy and default system browser.
- Logs and audits use redaction and bounded safe-detail schemas.

The current server connection is HTTP because the managed environment does not provide a usable HTTPS certificate. Consequently:

- traffic is not encrypted in transit;
- a capable LAN observer may read PDF bytes, auth requests, or non-encrypted command payloads;
- device signing protects command integrity and authorization but not confidentiality; and
- this design must not be represented as equivalent to TLS.

The deployment remains viable only while Relay is bound to the intended managed LAN, is not Internet-exposed, uses the device-manager firewall policy, keeps privileged access narrowly assigned, and avoids storing unnecessary secrets in Knowledge documents. Adding pinned TLS or an equivalent authenticated encrypted transport remains the preferred future hardening step if the managed environment permits it.

Someone with administrative control of the Relay server's Windows session or PocketBase data directory remains outside Relay's security boundary. They can access local data or invoke local recovery regardless of application roles.

## Migration and Compatibility

Migration runs in ordered, restart-safe stages:

1. Patch the operator roster and add Ryan Bledsoe and Tristan Bowles once.
2. Create privileged account, state, device, command, staging, and audit collections with server-owned rules and indexes.
3. Create the inactive Ryan Bledsoe administrator credential and link the stable operator ID.
4. Patch existing Knowledge documents with managed lifecycle, display title, revision, and publisher fields.
5. Import the current server-folder documents as active managed records without changing stable IDs or checksums where the mirrored records already exist.
6. Mark the managed-library migration complete.
7. Disable routine filesystem watcher ingestion and make PocketBase protected records the live content authority.
8. Preserve the old folder as a local migration/archive source until the administrator explicitly confirms a successful backup; do not delete it automatically.

The migration is idempotent and safe to resume. A failure before the managed-library marker leaves the current read-only watcher behavior available. A failure after authority switches must not restart dual ingestion.

Existing active documents, categories, extracted headings, cross-document links, offline cache keys, and document IDs remain usable. Existing client versions continue reading active `knowledge_documents` records during a staged upgrade but cannot see or invoke management controls.

## Testing

### Operator and role migration

- Existing seven-operator databases gain Ryan Bledsoe and Tristan Bowles exactly once.
- Existing operator IDs and history remain unchanged.
- Rename, deactivate, restart, and migration do not recreate original seed names.
- Ryan Bledsoe is linked to the pending administrator account by stable ID.
- Tristan Bowles has no privileged account or role.
- Exactly one administrator and at most one publisher remain authoritative.

### Authentication and device security

- Privileged password hashes and tokens never enter renderer, cache, log, or audit payloads.
- Inactive or pending accounts cannot authenticate.
- Five failed attempts trigger the expected cooldown.
- Session expiry uses privileged inactivity and clears main-process token state.
- Operator switching, password reset, reassignment, disablement, revocation, and shutdown clear sessions.
- Pair codes expire, are single-use, and enforce attempt limits.
- Device private keys use protected storage and are never synchronized.
- Valid signatures succeed; modified payloads, wrong keys, expired requests, clock-skew failures, and replayed IDs fail.
- An intercepted ordinary shared-app token cannot authorize a privileged command.

### Authorization matrix

- Normal operators cannot invoke any privileged command.
- A publisher can perform every Knowledge Base operation and view Knowledge audit events.
- A publisher cannot manage operators, roles, devices, Relay settings, or global security audit.
- The administrator can perform every allowlisted Relay and Knowledge operation.
- Selecting a privileged operator without authenticating grants nothing.
- A stale publisher token fails immediately after reassignment.
- Deactivating the administrator or active publisher through ordinary operator controls is rejected.

### Operator and Settings UI

- The normal operator selector remains passwordless and preserves attribution behavior.
- Ryan Bledsoe and Tristan Bowles appear in the roster.
- Admin and publisher role chips render correctly.
- Without an admin session, client Settings exposes no operator mutations or secret values.
- Admin sign-in unlocks operator management on server and paired client modes.
- Publisher assignment requires reauthentication and clearly reports revocation impact.
- Keyboard navigation, focus return, loading, empty, validation, success, conflict, and error states are accessible.
- Compact layout remains usable at approximately 850–960 CSS pixels without clipped actions or horizontal page overflow.

### Knowledge upload and lifecycle

- Multi-file selection never exposes local paths to renderer state or logs.
- Valid files progress to ready and expose extracted heading previews.
- Invalid signature, encrypted PDF, oversized file, page limit, timeout, duplicate, and parse failures stay out of the live library.
- Uploading without publishing never changes the reader.
- New publication becomes visible only after server success.
- Replacement retains document ID and original filename while updating bytes, checksum, outline, attribution, and revision.
- Display-title and category changes preserve PDF bytes and checksum.
- Trash hides the document from normal clients without deleting bytes.
- Restore handles current revision and naming conflicts.
- Permanent delete requires reauthentication and retains audit history.
- Staging expiry never removes a live document.

### Realtime, offline, and compatibility

- Connected server and client instances continue authenticating, discovering, and synchronizing normally.
- Active Knowledge changes appear on connected clients through realtime.
- Offline readers retain cached metadata and previously opened PDFs.
- Management is unavailable offline and never enters the pending-mutation queue.
- Reconnect resolves an in-flight command by request ID without double application.
- Older clients continue reading active documents during rollout.
- Existing same-document, relative-PDF, absolute-author-path, page-fragment, and guarded web links continue working.
- Dynatrace Problems, Alerts, Status, On Call, Notes, Compose, operator attribution, and ordinary Settings behavior retain existing regressions.

### Server lifecycle, backup, and recovery

- Restart resumes or deterministically fails interrupted staging and command states.
- Backups contain active, trashed, and staged PDFs plus required metadata and audit history.
- Restore does not require the legacy source folder.
- Failed migration does not create dual ingestion or delete the legacy source.
- Local credential recovery works only in server mode and invalidates prior sessions.
- Server/client reconfigure and shutdown stop privileged managers cleanly.

### Required verification gates

- Focused unit tests for every new shared validator, manager, handler, and reducer.
- Renderer component and accessibility tests for Settings and management workspace states.
- Cache tests proving privileged collections, secrets, tokens, Trash, uploads, and audit details are not added to ordinary offline mutation paths.
- Integrated Electron tests with separate server and client data roots for authentication, pairing, publish, realtime reader update, trash, restore, revoke, and reconnect idempotency.
- Existing `npm run test:unit`, `npm run test:cache`, `npm run test:renderer`, `npm run test:electron`, `npm run lint`, `npm run typecheck`, and `npm run build` gates.
- A final server/client smoke test confirming LAN connection, operator attribution, Knowledge reading, and remote privileged denial/approval paths.

## Acceptance Criteria

- The roster contains the nine approved operators without duplicating or replacing existing profiles.
- Ryan Bledsoe can complete local administrator setup and administer Relay from the server PC or a paired work laptop.
- Tristan Bowles remains a normal passwordless operator.
- The administrator can assign exactly one active non-admin operator as Knowledge Publisher.
- Reassignment immediately removes the previous publisher's privileged authority while preserving their normal profile and history.
- Normal operators remain passwordless and cannot gain privileges by selecting another operator name.
- The publisher can add, validate, preview, publish, replace, title, categorize, move, trash, restore, and permanently delete Knowledge PDFs and inspect Knowledge audit history.
- The administrator can perform all publisher actions plus operator, role, device, and allowlisted Relay-setting administration.
- Privileged laptop requests require an authenticated account, active paired device, valid signature, current role assignment, unexpired unique request, and matching target revision.
- Clients never write directly to the live Knowledge collection.
- Connected readers receive committed active-document changes through existing realtime synchronization.
- Disconnected readers retain current cached behavior, while management remains unavailable.
- Relative PDF links, extracted headings, guarded web links, and original filenames continue working.
- Trash is recoverable without automatic purge; permanent deletion requires password re-entry and preserves audit history.
- Audit records identify operator, role, hostname, timestamp, target, result, revision, and checksums without secrets.
- Existing Relay client/server connectivity, discovery, authentication, offline behavior, attribution, and operational tabs remain functional.
- The final implementation documents the HTTP confidentiality limitation and does not claim TLS-equivalent protection.
