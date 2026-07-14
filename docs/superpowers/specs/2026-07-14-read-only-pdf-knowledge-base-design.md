# Read-Only PDF Knowledge Base Design

**Date:** 2026-07-14

**Status:** Approved for implementation

## Summary

Relay will add a top-level `Knowledge` tab for a shared, read-only PDF knowledge base. The Relay server indexes PDFs from a server-local category folder, extracts a navigable heading outline without sending document content outside the LAN, and mirrors the resulting metadata and protected PDF files through the existing PocketBase connection. Connected clients receive category and document changes in realtime. Previously opened PDFs remain available from a local client cache when the server is unavailable.

The approved interface is the **Focus Reader** direction. A compact category drawer sits beside a large embedded PDF viewer. The selected document expands in the drawer to show its extracted headings. Selecting a heading jumps to the corresponding PDF page and vertical position.

## Goals

- Give every Relay operator fast, read-only access to 25–100 operational PDF documents.
- Present one overall category list, with PDF documents nested under each category.
- Render the original PDF inside Relay rather than converting it into Relay-authored article content.
- Extract headings locally and display them beneath the selected document.
- Let heading selections jump to the correct page and location in the PDF.
- Synchronize document metadata and files from the Relay server to LAN clients.
- Keep previously opened PDFs usable on client laptops while disconnected from the server.
- Keep PDF parsing, indexing, transport, and storage inside the Relay server/client LAN boundary.
- Preserve Relay's existing server/client authentication, discovery, realtime, and offline behavior.

## Non-goals

- No document editor, rich-text editor, annotation tools, comments, or operator notes.
- No in-app create, rename, upload, replace, delete, reorder, or category-management controls.
- No passwords, roles, or knowledge-base-specific permission model.
- No cloud OCR, cloud search, AI summarization, external document processing, or telemetry.
- No local OCR in the first release.
- No full-text search across PDF body content in the first release.
- No PDF form filling, attachment extraction, embedded JavaScript, or external-link execution.
- No automatic pre-download of the entire knowledge base to every laptop.

## Content Source and Ownership

The server filesystem is the operator-maintained content source. Relay creates this directory in server mode:

```text
<Relay config data directory>/knowledge-base/
```

Immediate child directories are categories. PDFs inside a category directory are its documents:

```text
knowledge-base/
  Monitoring & Triage/
    XCenter count mismatch.pdf
    Dynatrace alert triage.pdf
  Access & Connectivity/
    VPN access failure.pdf
  Store Systems/
    Payment terminal offline.pdf
```

Only one category level is supported. A PDF placed directly in the root is assigned to `General`. Deeper directories are ignored and logged as invalid structure.

Relay does not expose content-management controls in the renderer. Adding, replacing, moving, or removing PDFs is an administrative filesystem action performed on the Relay server PC. Relay watches the folder and reconciles safe changes automatically.

Display-name rules:

- Category name comes from the immediate parent directory.
- Document title uses a non-empty PDF metadata title when available.
- Otherwise, document title uses the filename without `.pdf`.
- Category names are limited to 120 characters, document titles to 240 characters, and normalized source keys to 512 characters.
- Control characters and empty normalized names are rejected.
- Category and document sorting is case-insensitive and alphabetical, with `General` first.
- The original filename remains visible in document metadata and logs.

## User Interface

### Navigation and shell

Add `Knowledge` to the primary sidebar immediately after `Notes` and before `Status`. The tab uses Relay's existing shell:

- Header breadcrumb: `Relay / Knowledge`
- Global search remains available in the header.
- Existing clock and connection status remain unchanged.
- Bottom status text reports document count, category count, and index freshness.

The feature uses Relay's existing dark theme, IBM Plex typography, compact spacing, borders, focus treatment, keyboard behavior, and selected-state accent. It does not introduce a separate visual system.

### Category drawer

The left drawer contains:

1. `Categories` heading.
2. Search input for category names, document titles, and extracted heading labels.
3. Alphabetical category list with document counts.
4. Document list beneath the expanded category.

Only one category is expanded at a time. Only the selected document expands into its extracted outline. This prevents the 25–100 document library from becoming an excessively tall tree.

Document rows show:

- document title;
- expandable caret when headings exist;
- heading count when headings exist; or
- no heading indicator when no usable outline was extracted.

### Nested heading outline

The active document displays extracted headings beneath its name. The UI supports two visible indentation levels:

```text
XCenter count mismatch
  Overview                         1
  Symptoms                         1
  Checks                           2
    Confirm page freshness         2
    Compare operator view          2
  Resolution                       3
  Escalation                       3
```

Each heading is a native button with a clear accessible name containing the heading label and page number. Activating it:

- marks the heading selected;
- loads or reveals its destination page;
- scrolls to the destination coordinate when available;
- updates the visible page counter; and
- updates the current-section label above the viewer.

Keyboard behavior:

- Up/Down moves through visible tree items.
- Right expands a category or document.
- Left collapses it or moves to its parent.
- Enter or Space activates a category, document, or heading.
- Focus remains in the drawer after a PDF jump so operators can move rapidly between sections.

### Embedded PDF viewer

The right workspace contains:

- category/document breadcrumb;
- current-section label;
- PDF canvas;
- page counter;
- zoom out, zoom value, zoom in, and fit controls.

The first release renders one page at a time with adjacent-page pre-rendering for quick navigation. It does not use Chromium's `<object>` or `<embed>` PDF viewer because Relay's CSP intentionally blocks object content. Rendering uses a bundled local PDF.js worker and canvas/text layers.

The viewer does not expose annotation, download, print, attachment, form, or external-link actions in the first release. Text selection is available when the PDF contains a usable text layer.

### Search

Knowledge search matches:

- category name;
- document title;
- original filename; and
- extracted heading labels.

Search is case-insensitive and diacritic-insensitive. Results remain grouped by category and document. Selecting a heading result opens its document and jumps directly to the destination. Selecting a document result opens page 1 or the first native PDF destination.

Full PDF body text is not stored or searched in the first release.

### Loading, empty, and unavailable states

- Initial load uses drawer-row and PDF-page skeletons rather than a centered spinner.
- A server with no indexed PDFs shows the server folder path and explains the required category-folder structure. It does not show upload or edit controls.
- A client with no documents explains that the server has not published a knowledge base yet.
- A document whose bytes are not cached while offline remains listed but shows `Not available offline` instead of an empty viewer.
- A PDF with no usable outline opens normally without an expandable heading tree.
- A failed PDF render keeps the category drawer usable and offers a retry action.

## Shared Data Model

Add a server-owned PocketBase collection named `knowledge_documents`.

```ts
type KnowledgeOutlineNode = {
  id: string;
  label: string;
  level: 1 | 2;
  pageIndex: number;
  top: number | null;
};

type KnowledgeDocumentRecord = {
  id: string;
  sourceKey: string;
  category: string;
  title: string;
  fileName: string;
  pdf: string;
  checksum: string;
  byteSize: number;
  pageCount: number;
  outline: KnowledgeOutlineNode[];
  outlineSource: 'native' | 'inferred' | 'none';
  sourceModifiedAt: string;
  indexedAt: string;
  created: string;
  updated: string;
};
```

Collection behavior:

- `sourceKey` is the normalized category-relative source path and has a unique index.
- `pdf` is a required protected PocketBase file field limited to one `application/pdf` file.
- Authenticated Relay clients may list, view, subscribe, and obtain protected-file access.
- Direct client creates, updates, and deletes are forbidden.
- Server-mode indexing uses the authenticated local superuser client.
- Categories are derived from the document records; no second collection is required.

PDF bytes are not written to Relay's SQLite offline-record cache. Only the collection metadata and outline JSON use the existing cache snapshot path.

## Server Indexing Architecture

Add a server-only `KnowledgeBaseManager` owned by the main process. It starts after PocketBase collection bootstrap succeeds and stops during runtime reconfigure or app shutdown.

Responsibilities:

- create the source directory if it does not exist;
- scan the source tree at startup;
- watch for additions, modifications, moves, and removals;
- debounce filesystem event bursts for one second;
- run a reconciliation scan every five minutes as a watcher fallback;
- validate candidate files before parsing;
- calculate SHA-256 checksums;
- extract metadata, page count, and headings;
- create or update protected PocketBase file records;
- remove records only after a validated source deletion;
- broadcast index status to Relay windows; and
- keep parsing work off Electron's main event loop.

Indexing is incremental. An unchanged `sourceKey`, size, modification time, and checksum is not reparsed or re-uploaded. Replacing a PDF at the same path updates the existing record so its stable PocketBase ID is retained.

Parsing runs in a dedicated worker with concurrency `1`. This avoids locking the Electron main process or saturating the managed NOC workstation while several files are copied at once.

### File validation

Before parsing, Relay must:

- resolve the candidate with `realpath` and confirm it remains inside the knowledge-base root;
- reject symbolic links;
- require a case-insensitive `.pdf` extension;
- verify the `%PDF-` file signature;
- reject empty files;
- reject files larger than 50 MiB;
- reject encrypted PDFs that PDF.js cannot open without a password;
- stop parsing after 1,000 pages;
- enforce a 30-second per-document extraction timeout; and
- log identifiers and failure categories without logging extracted document text.

One invalid PDF does not block indexing of other documents.

## Heading Extraction

Heading extraction is deterministic and entirely local.

### Native outline first

Relay first reads the PDF outline/bookmarks. For each usable outline entry it resolves:

- label;
- nesting level;
- destination page; and
- destination vertical coordinate when present.

Native levels deeper than two are flattened into level 2 for the drawer. Invalid destinations are omitted. Duplicate sibling labels pointing to the same destination are deduplicated.

### Typography inference fallback

When a PDF has no native outline, Relay examines its text layer page by page:

1. Group text items into visual lines using their baseline coordinates.
2. Determine the document's predominant body font size.
3. Remove repeated page headers, repeated footers, and page-number-only lines.
4. Treat short, isolated lines with meaningfully larger or bold text as heading candidates.
5. Cluster candidate font sizes into level 1 and level 2.
6. Preserve page index and top coordinate for navigation.
7. Reject extremely long labels and low-confidence candidates.

The inferred outline is capped at 500 nodes and two levels. Each persisted label is limited to 240 characters. The complete extracted body text is discarded after inference; only outline labels and destinations are persisted.

### No-outline fallback

If a PDF has no outline and no usable text layer, `outlineSource` is `none` and `outline` is empty. The document remains fully readable. The UI does not invent page labels and does not attempt OCR.

## PDF Transport and Client Cache

### Metadata

The renderer uses the existing PocketBase collection-store pattern for `knowledge_documents`:

- online snapshot;
- realtime create/update/delete events;
- metadata cache snapshots; and
- cached offline cold start.

Add `knowledge_documents` to the cache read/write allowlist but not the offline-mutation allowlist. The knowledge base is read-only and never creates pending changes.

### PDF bytes

The renderer never receives filesystem paths or PocketBase credentials. Add a typed, validated preload method that asks the main process for one document by ID and expected checksum.

Main-process behavior:

- Server mode reads the validated local source or protected mirrored file.
- Client mode looks for `<Relay config data directory>/knowledge-cache/<checksum>.pdf`.
- A matching cached file is returned immediately.
- When online and uncached, the main process authenticates with Relay's existing app account, obtains protected-file access, downloads the PDF, verifies its size and SHA-256 checksum, writes it atomically, and then returns the bytes.
- When offline and uncached, it returns a typed `not-available-offline` result.

The IPC result uses an `ArrayBuffer`, not a base64 string. The maximum 50 MiB file limit bounds memory use. Opening another document destroys the previous PDF.js document and releases its page canvases.

The client cache is on-demand and content-addressed. Replacing a server PDF produces a new checksum and cache filename. The cache has a 2 GiB budget and uses least-recently-used eviction without removing the currently open document. Cache files no longer referenced by current metadata are removed after 30 days. Referenced files have no age-based expiry while the cache remains under budget. Cleanup joins Relay's existing 24-hour maintenance cycle. Relay does not pre-download every document.

## Realtime and Offline Behavior

- Connected clients see added, replaced, moved, and removed document metadata through PocketBase realtime.
- A replaced document keeps its stable record ID when its source path is unchanged.
- The renderer closes a document if realtime reports its removal.
- A changed checksum invalidates the open PDF and reloads the new bytes when online.
- Metadata remains available from the existing offline cache during a disconnected cold start.
- Previously cached PDF versions remain readable offline when their checksum still matches cached metadata.
- Documents never opened on that laptop show `Not available offline` while disconnected.
- Knowledge Base has no offline write queue, conflicts, optimistic mutations, or attribution fields.

## Backup and Restore

The protected PocketBase file field mirrors each indexed PDF into PocketBase storage, so existing PocketBase backups include shared knowledge metadata and PDF bytes.

The server source directory remains the normal ingestion source. Reconciliation must never purge mirrored records merely because the entire source root is missing, unreadable, or fails validation. A successful healthy scan may remove records for individually missing source files. If more than 25% of known records disappear in one scan, Relay preserves them and raises an index warning; it applies the deletions only if the same missing set is observed in two consecutive healthy scans at least five minutes apart. This prevents a damaged or temporarily unavailable source directory from erasing a restored knowledge base while still allowing intentional bulk filesystem cleanup.

After backup restore and PocketBase restart:

- collection metadata and protected PDFs are available immediately;
- KnowledgeBaseManager reloads restored records before reconciling the source folder;
- restored records remain available if the source root is unavailable; and
- valid current source files may add or replace records normally.

## Security and Privacy

- No PDF content leaves the Relay server/client LAN path.
- The feature makes no external network requests.
- Protected PDF fields require an authenticated Relay app user and a short-lived file token.
- Renderer code cannot read arbitrary local paths.
- All knowledge IPC calls validate the trusted sender and their document ID/checksum schemas.
- Filesystem access stays in the main process and enforces canonical-path containment.
- PDF.js runs with evaluation disabled and does not execute PDF JavaScript.
- PDF attachments, forms, launch actions, and external links are not exposed.
- Parsing happens in an isolated worker with size, page, node-count, and time bounds.
- Search indexes only category, document, filename, and heading labels.
- Logs never contain full PDF text, extracted paragraphs, credentials, file tokens, or raw PDF bytes.
- Existing `object-src 'none'`, renderer sandboxing, context isolation, disabled Node integration, navigation lockdown, and LAN URL policy remain intact.

## Performance

- Parse and upload only added or changed documents.
- Process one PDF at a time in the background.
- Debounce filesystem event bursts and retain a periodic scan as fallback.
- Cache extracted outline metadata by checksum.
- Fetch PDF bytes only when a document is opened.
- Render the active page plus one adjacent page, then release distant canvases.
- Virtualize long document/search lists when the library exceeds the visible drawer height.
- Avoid realtime subscriptions or polling when the Knowledge tab has no subscribers, following Relay's current collection-store lifecycle.
- Keep client cache cleanup in existing maintenance work rather than starting another frequent timer.

## Error Handling

- Folder creation failure reports a server-local index error and leaves Relay's other tabs operational.
- Watcher failure falls back to periodic scanning.
- A candidate path outside the source root or through a symlink is rejected.
- Invalid, oversized, encrypted, malformed, timed-out, or unsupported PDFs are skipped individually and reported by filename.
- Heading extraction failure falls back to no outline without blocking PDF publication when the PDF can still render safely.
- Protected-file upload failure leaves the last valid record and file in place.
- Interrupted client downloads leave no partial cache file because writes use a temporary file plus atomic rename.
- Checksum mismatch deletes the bad cache file and retries once when online.
- Viewer render failure keeps the category drawer interactive and exposes a retry.
- Realtime removal of the open document returns the viewer to the category state with a concise notification.

## Lifecycle and Integration

### Main process

- Start `KnowledgeBaseManager` only after server PocketBase bootstrap and collection creation complete.
- Stop it before PocketBase shutdown, runtime reconfigure, or app quit.
- Client mode creates only the PDF cache/download service, never the server watcher or parser.
- Runtime reconfigure continues to use the existing centralized client offline initializer.

### Shared and preload

- Add shared document, outline, index-status, and typed IPC result schemas.
- Add validated IPC channels for PDF resolution and server index status.
- Expose only narrow methods through `window.api`.

### Renderer

- Add `Knowledge` to `TabName`, route validation, sidebar navigation, lazy tab loading, and global-search routing.
- Add a collection store/service for knowledge metadata.
- Keep the category tree, search state, active document, active heading, and PDF viewer in focused modules rather than one large tab file.
- Preserve mount-once tab behavior and release PDF resources when the tab is hidden or the active document changes.

## Migration and Compatibility

- Collection bootstrap creates `knowledge_documents` non-destructively on the server's next startup.
- Existing collections and records are untouched.
- Existing Relay server/client passphrase authentication remains unchanged.
- Existing PocketBase bind address, discovery, presence heartbeat, and reconnect behavior remain unchanged.
- Existing client offline cache and pending-write queue remain unchanged except for the new read-only metadata allowlist entry.
- Existing backups remain restorable. New backups include the knowledge collection and protected files after they are indexed.
- A server with no knowledge-base folder content behaves exactly as before outside the new empty Knowledge tab.

## Testing

### Shared validation

- Accept valid document records, outline nodes, index status, and PDF IPC requests.
- Reject malformed IDs, checksums, outline levels, negative page positions, oversized labels, and unexpected fields.

### Collection bootstrap

- Create `knowledge_documents` with protected PDF field and authenticated read rules.
- Forbid direct client create, update, and delete.
- Add missing managed fields and rules non-destructively.
- Leave unmanaged collections untouched.

### Indexer and path safety

- Create the source directory in server mode.
- Derive categories from immediate directories and use `General` for root PDFs.
- Ignore nested directories.
- Reject symlinks, traversal, invalid signature, oversized files, encrypted files, and page-limit violations.
- Index a valid PDF and preserve its stable ID when replaced at the same source path.
- Skip unchanged files without parsing or uploading.
- Reconcile watcher bursts once after debouncing.
- Fall back to periodic scanning after watcher failure.
- Never purge mirrored records when the source root is unavailable or invalid.
- Stop watcher and worker resources on reconfigure and shutdown.

### Heading extraction

- Preserve native outline order, levels, page destinations, and vertical coordinates.
- Flatten native levels deeper than two.
- Deduplicate identical sibling destinations.
- Infer headings from font size, weight, spacing, and short-line structure when no native outline exists.
- Exclude repeated headers, footers, page numbers, and low-confidence body lines.
- Persist only outline labels and destinations, not full text.
- Return an empty outline for scanned/image-only PDFs without OCR.
- Enforce node-count and extraction-time limits.

### PDF transport and cache

- Reject untrusted IPC senders and invalid document IDs/checksums.
- Return a validated local server PDF.
- Download a protected client PDF only after Relay app-user authentication.
- Verify downloaded size and checksum before atomic cache promotion.
- Reuse a matching local cache entry.
- Return `not-available-offline` for uncached documents while disconnected.
- Remove stale and over-budget cache entries without deleting active content.
- Never queue Knowledge Base mutations.

### Renderer

- Place Knowledge after Notes in the sidebar and preserve current tab navigation.
- Render categories and case-insensitively sorted documents.
- Expand one category and one active document at a time.
- Render two heading levels with page numbers.
- Heading activation updates selection, page, current-section label, and PDF position.
- Search matches categories, titles, filenames, and headings.
- No-outline documents open without a heading tree.
- Loading, empty, offline-uncached, parse-error, removal, and retry states are accessible.
- Keyboard tree navigation and focus retention work as specified.
- No edit, upload, download, annotation, form, attachment, or external-link actions appear.

### Regression verification

- Server and client instances still authenticate, discover, connect, subscribe, and reconnect normally.
- Client presence still reports hostnames normally.
- Existing cached collections still cold-start offline.
- Existing pending mutations still synchronize without Knowledge Base participation.
- PocketBase backup and restore still work with and without indexed PDFs.
- Runtime reconfigure does not leave a watcher, parser worker, or download in the wrong mode.
- Existing CSP, main-window navigation protection, sandbox, and preload boundaries remain enforced.
- Full formatting, lint, typecheck, unit, cache, renderer, build, and Electron E2E gates pass.

## Acceptance Criteria

- Relay shows a new `Knowledge` tab in the approved Focus Reader design.
- The server discovers valid PDFs from category directories without an in-app editor.
- Every connected client sees the same categories and documents through the existing LAN connection.
- Selecting a document renders its original PDF inside Relay.
- Native PDF headings appear nested under the selected document and jump accurately.
- PDFs without bookmarks receive a safe best-effort inferred outline when possible.
- Image-only or otherwise unstructured PDFs remain readable without fabricated headings.
- Previously opened documents remain readable on a disconnected client.
- Uncached documents clearly report that they are unavailable offline.
- No PDF content or extracted text is sent outside the LAN.
- Operators have no Knowledge Base write controls.
- Existing Relay server/client connectivity and all established behavior remain intact.
