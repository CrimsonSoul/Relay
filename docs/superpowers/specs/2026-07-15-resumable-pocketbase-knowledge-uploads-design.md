# Resumable PocketBase Knowledge Uploads Design

**Date:** 2026-07-15

**Status:** Approved for implementation

## Summary

Relay will make PocketBase the only runtime authority for Knowledge Base PDFs and remove the
server-folder watcher, folder fallback, and folder-based migration path. A publisher may select PDFs
from any folder on a paired laptop, but the selected path is only the temporary source for an upload;
it is never part of a document identity or a server-side library layout.

The upload path will support batches of up to 100 PDFs, with each PDF limited to 50 MiB. Files will
be divided into 4 MiB chunks and uploaded through the existing PocketBase endpoint with at most two
chunks in flight. Relay will persist an encrypted client-side queue, retry transient failures with
bounded exponential backoff, query the server for missing chunks, and resume after a VPN
interruption, application restart, or laptop restart once the publisher signs back in.

Completed uploads remain staged and invisible to normal Knowledge Base readers until a publisher
reviews their extracted headings, title, category, and duplicate warnings and explicitly publishes
them. Unpublished staged PDFs expire after seven days. Publishing creates the durable protected
PocketBase document and immediately removes the staging copy.

This design also corrects remote publisher pairing. An authenticated administrator on the Relay
server can create a one-time pairing challenge targeted to either the administrator account or the
currently designated publisher account. The publisher can then pair their own laptop without
receiving device-management authority.

## Relationship to Existing Designs

This design extends and supersedes the upload and storage portions of
`2026-07-15-privileged-operators-and-knowledge-management-design.md`:

- PocketBase remains the server authority and the privileged command boundary remains intact.
- The paired-device and privileged-role model remains intact.
- The previous one-time folder migration, folder reconciliation, and server-folder PDF fallback are
  removed rather than retained.
- Whole-file `knowledge_uploads` creation is replaced with a resumable manifest-and-chunk protocol.
- Staging retention changes from 24 hours to seven days after validation completes.
- Pairing challenge creation is explicitly target-account-aware, matching the intended design.

The Focus Reader, relative PDF links, guarded web links, protected-file retrieval, realtime document
updates, and client PDF cache remain unchanged.

## Goals

- Make PocketBase the only runtime storage authority for Knowledge Base PDFs.
- Remove all runtime dependency on `knowledge-base` folders, filenames as paths, filesystem
  watchers, and server-folder PDF fallback reads.
- Reliably upload a batch of up to 100 PDFs at up to 50 MiB each over an unstable VPN.
- Resume at the missing-chunk boundary rather than restarting a complete PDF.
- Resume a batch after Relay or the laptop restarts without persisting PDF bytes outside the
  publisher's original files.
- Keep all traffic on the configured Relay PocketBase endpoint and add no port or external service.
- Keep ordinary operators from seeing staged, failed, cancelled, or incomplete PDFs.
- Preserve explicit human review before publication.
- Provide accurate per-file and whole-batch byte progress, retry, pause, cancel, and recovery states.
- Keep server disk usage bounded and automatically clean abandoned data.
- Allow the designated publisher to pair their work laptop securely.
- Preserve normal Relay client connectivity, offline reading, and existing Knowledge Base links.

## Non-goals

- Relay will not synchronize arbitrary directories or watch a shared folder.
- Relay will not preserve a server-side source path for a published document.
- Relay will not add S3, MinIO, tus, cloud storage, or a second HTTP service.
- Relay will not automatically publish a successfully uploaded PDF.
- Relay will not edit PDF contents.
- Relay will not make privileged publishing available offline.
- Relay will not persist a second copy of source PDF bytes on the publisher laptop.
- Relay will not guarantee progress while the corporate VPN does not route the Relay server address.
- Relay's HTTP connection will not provide application-layer encryption; confidentiality depends on
  the managed LAN or VPN tunnel until HTTPS is available.

## Runtime Authority and Folder Removal

The `knowledge_documents` PocketBase collection and its protected `pdf` file field are the only
published-document authority.

Relay will remove the following runtime behavior:

- startup scanning or creation of `Application Support/Relay/knowledge-base`;
- `KnowledgeBaseManager` reconciliation and watcher scheduling;
- `ManagedKnowledgeMigration` and recovery-mode folder adoption;
- `knowledgePathSafety` folder containment and scan paths;
- server-reader attempts to resolve a document from the old folder before using PocketBase; and
- dummy-data setup that places authoritative PDFs in a watched directory.

The server PDF service will always obtain the protected PDF from PocketBase and verify its byte
length, `%PDF-` signature, and SHA-256 checksum. Client retrieval and the existing checksum-keyed
offline cache continue to use the same protected PocketBase file.

Knowledge index status is derived from PocketBase document and category records rather than a
filesystem manager. Removing `KnowledgeBaseManager` must not leave the renderer permanently showing
an idle or unavailable index.

Existing PocketBase document records and files are preserved. The obsolete library-state record may
remain as inert compatibility data, but no runtime behavior or UI state may depend on it. Test data
and development seed commands must create PocketBase document records with protected file uploads.

If an operator has legacy PDFs that were never stored in PocketBase, the supported transition is to
select those PDFs once through the publisher batch picker. Relay will not silently import a folder.

## Capacity and Limits

The fixed limits are:

| Limit | Value |
| --- | ---: |
| Files per batch | 100 |
| PDF size | 50 MiB |
| Theoretical batch bytes | 5,000 MiB |
| Chunk payload | 4 MiB, except the final smaller chunk |
| Concurrent chunk requests | 2 across the entire batch |
| Ready-stage retention | 7 days |
| Incomplete/failed retention | 7 days since last server activity |
| Retry backoff ceiling | 30 seconds |
| Automatic retry attempts per chunk before pause | 8 |

Before accepting a batch, the server checks the filesystem containing `pb_data/storage`. It must have
enough free space for the declared batch bytes plus one maximum-size assembly copy while preserving
a 2 GiB free-space floor. The server rejects admission with a bounded `insufficient-storage` result
when that condition is not met.

Only one active batch is allowed per privileged account. A new batch may be added after the previous
batch is ready, cancelled, expired, or published. This bounds active reservations without adding an
administrator-configurable quota surface.

## PocketBase Data Model

### `knowledge_upload_batches`

One server-created record represents the durable batch reservation:

```ts
type KnowledgeUploadBatchRecord = {
  id: string;
  requestId: string;
  accountId: string;
  deviceId: string;
  operatorId: string;
  operatorName: string;
  fileCount: number;
  totalBytes: number;
  state: 'active' | 'ready' | 'cancelled' | 'expired' | 'completed';
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  revision: number;
};
```

The account may read its own batch. Only a signed server command may create, change, cancel, or
complete it.

### `knowledge_uploads`

The existing collection becomes the per-file upload manifest. Its `pdf` field is optional until
assembly succeeds:

```ts
type KnowledgeUploadRecord = {
  id: string;
  batchId: string;
  accountId: string;
  deviceId: string;
  operatorId: string;
  operatorName: string;
  fileName: string;
  byteSize: number;
  checksum: string;
  chunkSize: number;
  chunkCount: number;
  state:
    | 'queued'
    | 'uploading'
    | 'assembling'
    | 'extracting'
    | 'ready'
    | 'failed'
    | 'cancelled';
  pdf: string | null;
  pageCount: number | null;
  outline: KnowledgeOutlineNode[];
  outlineSource: 'native' | 'inferred' | 'none' | null;
  proposedTitle: string;
  proposedCategory: string;
  duplicateDocumentId: string | null;
  safeError: KnowledgeUploadSafeError | null;
  lastActivityAt: string;
  readyAt: string | null;
  expiresAt: string;
  revision: number;
};
```

The manifest is created by a signed `knowledge.upload.file.begin` command. The server validates the
batch binding, filename, size, chunk count, and full-file checksum before returning the upload ID.

### `knowledge_upload_chunks`

Each acknowledged chunk is a protected PocketBase file record:

```ts
type KnowledgeUploadChunkRecord = {
  id: string;
  uploadId: string;
  batchId: string;
  accountId: string;
  deviceId: string;
  index: number;
  byteSize: number;
  checksum: string;
  chunk: string;
  created: string;
};
```

`uploadId + index` is unique. Chunk files accept only `application/octet-stream`, have a maximum size
of 4 MiB, and are protected. `uploadId` and `batchId` are single-relation fields so PocketBase rules
can require a matching authenticated account and manifest instead of trusting unrelated text IDs.
Create and view rules scope records to the authenticated privileged account and matching upload
manifest. Update and delete remain server-only.

Submitting the same index and checksum is idempotent. A conflicting checksum for an existing index
fails the upload rather than replacing acknowledged bytes.

## Client Queue

The Electron main process owns the upload queue. Renderer code receives only bounded queue views and
progress events.

The persisted queue contains:

- batch and upload IDs;
- encrypted canonical source path;
- filename, byte size, modification time, and full checksum;
- chunk count and acknowledged chunk indexes;
- retry state and last safe error; and
- the privileged account and paired-device IDs.

The source path is encrypted with Electron `safeStorage`. If protected storage is unavailable, Relay
may upload during the current process but must not promise restart recovery or write the path in
plaintext. No PDF bytes, passwords, privileged tokens, or signing private keys are stored in queue
JSON, renderer storage, logs, or the ordinary Relay cache.

Before resuming, Relay reopens the source without following symbolic links and verifies its canonical
path, regular-file status, byte size, modification time, `%PDF-` signature, and full checksum. A
changed or missing file enters `source-required`; Relay never uploads bytes from a replacement file
under the old manifest. Reselecting the exact file may restore the queue after checksum validation.

The queue runs only while:

- the selected operator matches the active privileged session;
- the session has `knowledge.manage`;
- the current paired device matches the queued device; and
- the Relay server is reachable.

Locking or signing out pauses the queue without discarding acknowledged progress.

## Upload Protocol

1. The publisher chooses up to 100 PDF files in the native file picker.
2. The main process rejects directories, symbolic links, non-PDF extensions, invalid signatures,
   empty files, and files over 50 MiB.
3. Relay streams each file once to calculate the SHA-256 checksum and chunk plan without loading the
   whole batch into memory.
4. Relay submits signed `knowledge.upload.batch.begin` and `knowledge.upload.file.begin` commands.
   The server performs authorization, active-batch, capacity, and limit checks.
5. The client requests upload status and receives the authoritative missing chunk indexes.
6. At most two workers read only the required 4 MiB ranges and create protected chunk records.
7. After every successful create, the client records the acknowledged byte count and emits accurate
   per-file and batch progress.
8. When no chunks are missing, the client submits signed `knowledge.upload.file.finalize`.
9. The server claims the manifest revision, reads chunks in order into one bounded per-file assembly,
   verifies each chunk checksum, verifies the reconstructed length and full SHA-256 checksum, and
   rejects extra or missing chunks. It never holds more than one complete 50 MiB PDF plus bounded
   chunk overhead for validation.
10. The server stores the reconstructed PDF in the protected staging `pdf` field, extracts the
    outline, detects duplicate filenames, and marks the upload `ready`.
11. Only after the ready record is durable does the server delete that upload's chunk records.
12. The publisher reviews staged metadata and explicitly publishes or replaces a document.
13. A successful publish writes the durable `knowledge_documents` record, appends the audit event,
    and deletes the staging upload record and file immediately.

Finalize commands remain idempotent. Repeating finalize for a ready upload returns the existing ready
view. Repeating publish with the same request ID returns the existing command result.

## Retry, Resume, and Cancellation

Relay retries only network failures, PocketBase status `0`, HTTP `408`, `429`, and `5xx` responses.
Authentication, authorization, storage, checksum, PDF validation, quota, and conflict failures are
not retried automatically.

Chunk retry delays use jittered exponential backoff starting at one second and capped at 30 seconds.
After eight consecutive failures for a chunk, the batch enters `paused-network`; the publisher may
retry immediately or allow Relay to resume automatically after connectivity returns.

Relay never assumes a locally completed request was accepted. After any ambiguous failure it queries
the server manifest and chunk indexes before sending more bytes. This makes upload recovery safe when
the VPN drops after the server committed a chunk but before the client received the response.

The server validation and extraction command is decoupled from the current approximately 30-second
client command poll. A finalize timeout returns `processing`, not `failed`; the management snapshot
continues showing assembly or extraction, and realtime updates deliver the eventual ready or failed
state. Validation work may continue after the initiating client disconnects.

Cancelling a file or batch requires a signed command. The server marks the target cancelled first,
then deletes chunks and staged files idempotently. The client removes encrypted local queue metadata
after it observes the cancelled server state.

## Staging and Publication

Ready uploads are visible only in the protected management workspace. Ordinary app users cannot list
their records or retrieve their files.

Publishers see and manage only their own upload batches. Administrators receive bounded upload views
through server commands for every privileged account and may cancel, publish, or replace any staged
upload. Administrators do not receive direct chunk-file URLs. Server authorization permits this
cross-account management only for the current administrator role; publisher commands remain bound to
their own account and device.

For each staged PDF the publisher can review:

- filename and byte size;
- extracted page count and nested headings;
- native versus inferred outline source;
- proposed display title;
- category;
- duplicate filename warning; and
- validation status.

No file publishes automatically. The workspace supports individual publication and explicit
multi-select `Publish selected`. Selecting a ready row after reviewing its title and category is the
publication confirmation. Bulk publication excludes failed, conflicted, or duplicate rows and
executes one idempotent server command per file so a single failure cannot create a partial hidden
transaction or block unrelated files.

A ready upload expires seven days after `readyAt`. Incomplete and failed uploads expire seven days
after `lastActivityAt`. Server cleanup deletes expired manifests, chunks, and staged files and writes
one bounded audit event without storing local paths or file bytes.

## Publisher Pairing Correction

The server pairing console will offer the administrator two eligible targets:

- the administrator account; and
- the currently assigned, active publisher account.

`createPairingChallenge` accepts a target account ID. The server verifies that the active local
administrator has `devices.manage` and that the target is one of those two current assignments. The
challenge record is bound to the target account, not automatically to the administrator's account.

The publisher selects their operator on the laptop, signs in with their publisher password, enters
the challenge ID and eight-character code, and labels the laptop. Successful completion binds the
laptop's P-256 public key to the publisher account. The publisher receives `knowledge.manage` only;
they do not receive `devices.manage`, operator administration, settings administration, or publisher
assignment authority.

Existing single-use, ten-minute expiry, five-attempt lockout, encrypted local private-key storage,
revocation, and signed-command checks remain unchanged.

## Management UI

The existing Knowledge management visual language remains authoritative. The upload workspace adds:

- a compact batch summary with file count, total bytes, acknowledged bytes, and overall progress;
- a queue row for every file with filename, byte progress, state, and current retry message;
- filters for Uploading, Staged, Failed, and All;
- `Pause`, `Resume`, and `Cancel batch` actions;
- per-file `Retry`, `Reselect source`, and `Cancel` actions when applicable;
- an explicit selected-file count and `Publish selected` action in the staged view; and
- a seven-day expiration timestamp on every staged row.

Progress bars use acknowledged bytes rather than milestone percentages. States are conveyed by text
and icon in addition to color. The layout must remain usable at approximately half of a 1080p display;
the batch summary and filters stack, row actions wrap, and filenames truncate with a title tooltip.

The renderer never receives a local path, chunk bytes, PocketBase file token, privileged auth token,
or device private key.

## Security Model

- Protected PocketBase file fields guard chunks, staged PDFs, and published PDFs.
- Ordinary Relay app authentication cannot create, list, or read upload records.
- Privileged account rules scope upload records to that account.
- Signed commands authorize begin, status, finalize, cancel, publish, and replacement operations.
- Every server command re-resolves the current account, operator, publisher assignment, device state,
  role, and capability.
- Chunk and full-file SHA-256 checks prevent silent corruption and cross-file substitution.
- Unique batch, upload, chunk, and command IDs provide idempotency and replay protection.
- Local source paths are encrypted and never cross the IPC boundary or network.
- No PDF processing or storage leaves the configured Relay server and its connected laptop.
- HTTP does not encrypt PDF bytes on the LAN. A corporate VPN normally supplies tunnel encryption,
  but Relay must not claim confidentiality beyond the actual network configuration.

## Failure Behavior

| Failure | Result |
| --- | --- |
| VPN disconnect during chunk | Pause/retry; query missing chunks before continuing |
| Relay client restart | Restore encrypted queue; resume after publisher sign-in |
| Relay server restart | Server scans active manifests; client status query resumes missing chunks |
| Ambiguous chunk response | Query authoritative chunk index; never blindly duplicate bytes |
| Source file moved | `source-required`; publisher reselects the checksum-matching file |
| Source file changed | Reject resume and require a new upload manifest |
| Insufficient server disk | Reject batch before transfer with bounded storage message |
| Duplicate filename | Stage successfully but block publish until Replace is chosen or conflict is resolved |
| Chunk checksum mismatch | Mark file failed; retain other batch files |
| Full checksum mismatch | Delete assembled staging file, mark failed, retain chunks until retry/cancel/expiry |
| Extraction exceeds client wait | Continue server processing and show `extracting` |
| Privileged session locks | Pause queue; acknowledged server progress remains |
| Device revoked | Reject further commands and uploads; server data expires or admin cancels it |
| Staging expires | Delete staged bytes and append a bounded expiration audit event |

## Testing and Acceptance

### Automated tests

- Chunk planning handles zero-byte rejection, exact 4 MiB boundaries, a smaller final chunk, and
  50 MiB maximum files.
- Streaming checksums match whole-file SHA-256 without reading a complete batch into memory.
- Queue persistence encrypts paths, restores acknowledgement state, and rejects changed sources.
- Retry policy retries only transient statuses, applies the cap, and pauses after eight failures.
- Ambiguous responses query server state and do not resend an acknowledged chunk.
- Two-worker scheduling never exceeds two concurrent chunk requests across the batch.
- Begin commands enforce 100-file, 50 MiB, one-active-batch, authorization, and disk-reservation
  constraints.
- Chunk rules enforce account/upload binding and protected-file access.
- Finalization verifies ordered chunks, chunk hashes, byte count, full checksum, PDF signature, and
  idempotent replay.
- Server restart recovers active manifests without losing acknowledged chunks.
- Ready publication removes staging bytes only after the durable document and audit event exist.
- Seven-day cleanup removes ready, failed, cancelled, and incomplete data safely.
- Pairing challenges can target the active publisher but reject ordinary operators and stale
  assignments.
- Publisher capabilities remain limited to Knowledge Base management after pairing.
- Renderer tests cover progress, pause/retry, source reselection, failure isolation, multi-select
  publish, responsive layout, and accessible state labels.
- Regression tests prove no server PDF read scans or depends on a knowledge folder.
- Existing Focus Reader, links, protected download, realtime update, offline cache, operator,
  Dynatrace, client/server, cache, and privileged-access suites remain green.

### Integration tests

- Use a real temporary PocketBase data directory to upload chunks, restart the server runtime,
  resume, finalize, publish, retrieve the protected PDF, and compare the final checksum.
- Simulate disconnects before request commit, after commit but before response, and during status
  polling.
- Run two concurrent workers against duplicate indexes and verify idempotent convergence.
- Exercise server storage refusal with an injected free-space probe.

### Opt-in soak test

An opt-in script generates deterministic PDFs and exercises 100 queued files without committing test
artifacts. The default profile uses smaller fixtures for time and disk efficiency. A full profile uses
50 MiB files only when explicitly requested and reports elapsed time, transferred bytes, retries,
peak renderer/main memory, server storage high-water mark, and final checksum results.

### Acceptance criteria

- A batch may contain 100 valid PDFs and no file may exceed 50 MiB.
- Disconnecting and reconnecting the VPN resumes at missing chunks without restarting completed
  files or chunks.
- Restarting either Relay process preserves server acknowledgements and restores the client queue
  after sign-in.
- No upload path, viewer path, test seed, or runtime startup depends on a Knowledge Base folder.
- No staged file is visible to ordinary operators.
- Staged PDFs remain reviewable for seven days and are then removed automatically.
- Publishing is explicit and durable before staging bytes are deleted.
- The publisher can pair their own laptop using an administrator-generated target-account challenge.
- Relay opens no additional network port.

## Rollout

This feature has not reached a production Knowledge Base deployment, so Relay will remove the legacy
folder runtime rather than maintain two authorities. Before replacing a test installation, verify
that any PDFs worth keeping exist as protected `knowledge_documents` files. Any folder-only test PDFs
can be reselected as one batch after the new uploader is active.

Collection bootstrap adds the batch and chunk collections and extends `knowledge_uploads` without
deleting `knowledge_documents` or its protected files. Startup cleanup may leave obsolete migration
state data inert; it must not delete user documents or unknown collections automatically.

The rollout order is:

1. Make PocketBase-only reads authoritative and remove folder runtime code.
2. Correct target-account pairing and verify publisher laptop authorization.
3. Add upload collections, server commands, storage admission, cleanup, and assembly.
4. Add encrypted client queue, chunk scheduler, retry/resume, and progress events.
5. Add the batch management UI and explicit bulk publication.
6. Update seed/test tooling and complete integration and soak verification.
