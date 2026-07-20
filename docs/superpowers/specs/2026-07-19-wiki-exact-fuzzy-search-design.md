# Wiki Exact and Fuzzy Search Design

**Date:** 2026-07-19

**Status:** Implemented and verified

**Target corpus:** Approximately 20 SOP guides plus cheatsheets

**Semantic search:** Explicitly out of scope

## Objective

Make Wiki content discoverable without requiring an operator to know which document contains a procedure or to type every term perfectly. Relay will provide deterministic exact and typo-tolerant search across the entire Wiki and within the open guide while preserving page navigation and accurate highlights.

Enhanced search must be a derived, isolated subsystem. Its failure must not block Relay startup, document publication, Wiki management, PDF viewing, the existing exact open-document search, catalog metadata filtering, or non-Wiki search results.

## Product Scope

The feature includes:

- Exact and fuzzy passage search across active SOP guides and cheatsheets.
- Exact and fuzzy passage search restricted to the currently open document.
- Page-aware results containing document, category, heading, page, excerpt, matched text, and highlight offsets.
- Wiki passage results in Relay's universal header search.
- A dedicated page-level result state in the Wiki catalog while a query is active.
- Automatic indexing for newly published and replaced PDFs.
- Background backfill for existing active documents after upgrade.
- Search readiness and retry controls in Manage Wiki.
- A local cached-index fallback on workstations that have previously synchronized the search collection.
- Deterministic ranking and strict thresholds that can return no result instead of weak guesses.

The feature excludes:

- Embeddings, vector storage, vector databases, and semantic similarity.
- Cloud search or external document processing.
- OCR for scanned image-only PDFs.
- Natural-language answer generation or document summaries.
- Search analytics that store operators' queries.
- Replacing the existing exact PDF viewer search.

## Architecture

### PocketBase as source of truth

Relay will add a managed `knowledge_search_chunks` PocketBase collection. The collection contains derived, page-aware passages and is synchronized through the same PocketBase connection already used for Wiki metadata.

PocketBase remains authoritative for shared search passages. Relay will not open or mutate PocketBase's SQLite file directly, introduce a sidecar database, or require a custom PocketBase route.

The collection is readable only by authenticated Relay app users and writable only by the server's privileged indexing path. Clients do not write or repair search records.

### Per-workstation search service

Each Relay workstation loads validated active passage records into a bounded in-memory index owned by the Electron main process. This avoids renderer CPU work and avoids a new server request/response transport. At the initial corpus size, the extracted text is small enough to synchronize and score locally.

The service:

- Fetches the initial chunk set after the normal PocketBase connection is ready.
- Subscribes to chunk and document changes or performs a bounded refresh when realtime delivery is interrupted.
- Stores a validated copy in Relay's existing offline cache infrastructure.
- Applies incremental document-level updates rather than rebuilding the full index after every record change.
- Exposes validated search IPC to the renderer.
- Never returns raw internal records or accepts arbitrary PocketBase filters from the renderer.

### Existing extraction worker

Search passage generation reuses Relay's existing timeout-controlled `KnowledgeExtractorWorker`. The worker already provides queue serialization, timeout recovery, termination, and restart after failures.

Search indexing is a separate best-effort job after publication. It does not become a success condition for PDF validation or publication. Backfill and retry jobs also use this worker boundary.

## Data Model

### `knowledge_search_chunks`

Each record contains:

- `documentId`: required relation to `knowledge_documents`.
- `checksum`: required SHA-256 identity of the indexed PDF.
- `pageNumber`: required one-based PDF page number.
- `passageNumber`: required one-based stable passage order within the page.
- `headingId`: optional outline heading identifier.
- `heading`: optional normalized display heading.
- `text`: the plain extracted passage used for excerpts.
- `normalizedText`: the shared normalization result used for matching.
- `normalizedStart`: zero-based start offset within the normalized page text.
- `normalizedEnd`: exclusive end offset within the normalized page text.
- `indexVersion`: positive integer identifying the passage and normalization format.
- `indexedAt`: server-generated timestamp.

A uniqueness index covers `documentId`, `checksum`, `pageNumber`, `passageNumber`, and `indexVersion`.

Zero-based numeric fields that may legitimately contain zero remain optional at the PocketBase schema level because PocketBase treats numeric zero as empty for required validation. Runtime validators still require bounded integers.

### Document search status

`knowledge_documents` gains optional derived status fields:

- `searchIndexState`: `pending`, `ready`, or `failed`.
- `searchIndexChecksum`: checksum of the completed active index.
- `searchIndexVersion`: completed format version.
- `searchIndexedAt`: completion timestamp.
- `searchIndexError`: bounded non-sensitive failure code.

Missing fields on older records normalize to `pending` without making the document invalid.

## Passage Construction

The worker extracts selectable text for every page, even when a PDF already provides a native outline. It uses the same Unicode and whitespace normalization contract as the viewer search.

Passages are constructed along paragraph and line boundaries with bounded size and overlap. A passage never crosses a PDF page. Each passage retains offsets into the normalized page so a workstation can map a result back to the PDF.js text layer.

Image-only pages produce no passage and do not fail the document. A document with no selectable text becomes `failed` with the safe code `no-searchable-text`; the PDF remains available.

## Index Lifecycle

### Publication

1. PDF upload validation, cover extraction, outline extraction, and publication complete using the existing critical path.
2. The published document is marked `searchIndexState = pending`.
3. A background indexing job reads the protected published PDF and generates passages.
4. Chunk records are written under the document checksum and current index version.
5. The service verifies the complete expected page/passage manifest.
6. The document is switched to `ready` with the matching checksum and version.

An indexing exception never rolls back or invalidates the publication. It records a bounded failure state and releases the worker for the next job.

### Replacement

Replacement chunks are generated under the new checksum while the previous ready set remains intact. Only a complete verified new set may become active. Old checksum records are removed asynchronously after activation.

Search always filters chunks against the document's active checksum and ready checksum, so incomplete replacement records cannot appear in results.

### Backfill and version upgrades

After PocketBase and the core Knowledge runtime are healthy, the server queues active documents whose index status, checksum, or version is stale. Backfill runs with concurrency one and never blocks app readiness.

An index-version increment triggers the same safe rebuild process. Workstations ignore versions they do not understand.

### Trash, restore, and deletion

- Trashing a document immediately removes it from eligible results through document lifecycle filtering; chunk deletion is not required for immediate correctness.
- Restoring a document reuses its ready checksum-matched chunks when valid, otherwise it queues a rebuild.
- Permanent deletion removes derived chunk records asynchronously.
- Changing title, category, or document type updates ranking metadata without re-extracting the PDF.

## Query and Ranking Contract

### Normalization

Queries and indexed text use the shared normalization module:

- Unicode NFKC normalization.
- Locale-stable lowercase conversion.
- Whitespace collapse and trim.
- Stable character-to-source offset mapping for highlights.

The request accepts a bounded plain-text query only. Renderer input cannot provide executable filters, sort expressions, or collection names.

### Match tiers

Results are ordered deterministically by these tiers:

1. Exact document title and exact heading phrase.
2. Exact category, filename, and passage phrase.
3. All query tokens present, regardless of order.
4. Prefix token matches.
5. Bounded typo-tolerant token matches.

Within a tier, ranking considers field priority, token coverage, edit distance, phrase proximity, page number, passage number, and document ID as a stable final tie-breaker.

Adjacent matching passages from the same page are collapsed. Global results return no more than three passage hits per document. The service returns no result below the minimum acceptance threshold.

### Fuzzy limits

- One-to-three-character alphanumeric tokens are exact-only.
- Four-to-seven-character tokens allow at most one insertion, deletion, replacement, or adjacent transposition.
- Tokens with eight or more characters allow at most two edits.
- Numeric values and identifier-shaped tokens remain exact-only.
- A fixed, versioned set of common English function words is optional only for unordered token coverage. Exact phrase matching still includes them, and a query containing only function words does not start passage search.
- Every remaining query token must meet its allowed match rule; one fuzzy token cannot compensate for unrelated remaining terms.

The in-memory index maintains exact token postings plus a token dictionary grouped by length and character trigrams. Fuzzy candidate generation first narrows the vocabulary by allowed length and trigram overlap, then applies bounded Damerau-Levenshtein distance and resolves accepted tokens through the passage postings. It does not compare every token in the corpus for every keystroke.

## Search Surfaces

### Universal header search

Relay's existing immediate contact, group, server, action, document-title, and outline-heading results remain independent. When the normalized query is eligible, a cancellable asynchronous request adds a `Wiki passages` result group.

Failure or timeout of the passage request does not remove, delay, or reorder non-Wiki result groups. Duplicate document/heading/passage destinations are collapsed. Selecting a passage opens Wiki, the document, and the returned page.

### Wiki catalog

With an empty query, the existing cover-first SOP groups and cheatsheet section remain unchanged.

With an active query:

- Category and type filters remain active.
- The catalog switches to a page-level result list after the local metadata results are available.
- Each row shows document type, cover thumbnail, document title, category, heading, excerpt, page, and `Close match` only for fuzzy results.
- Selecting a result opens the document at the returned page and matched offsets.
- Clearing the query restores the cover-first catalog without losing category, type, or sort choices.

If enhanced search is unavailable, the catalog continues its current title/category/file filtering and displays a compact non-blocking notice that full-text search is unavailable.

### Open-guide search

The current renderer exact-search controller remains the primary immediate path. It continues indexing the active PDF and producing exact page results without server or PocketBase search chunks.

When connected, the sidebar also requests document-scoped fuzzy results. Exact local results rank first. Server-backed fuzzy results are deduplicated against them and use the `Close match` label.

Selecting either type navigates to the page. Exact results highlight the query match. Fuzzy results highlight the canonical matched text returned by the search service, not the misspelled query.

## Request Lifecycle and Performance

- Renderer requests are debounced by 150 milliseconds.
- A monotonically increasing request generation prevents stale responses from replacing newer results.
- Main-process searches support cancellation and enforce a one-second timeout.
- Queries are bounded to 120 Unicode code points.
- Global responses are capped at 20 results; document-scoped responses are capped at 50.
- Cached in-memory queries target a 200-millisecond response at the initial corpus size.
- Search synchronization and ranking never run on the renderer thread.
- The in-memory index has explicit record, text-byte, and per-document bounds derived from existing PDF limits.

## Management Experience

Manage Wiki displays one compact state on each document row:

- `Search ready`
- `Indexing search`
- `Search needs retry`

A failed state exposes a `Retry search index` action to a signed-in owner, admin, or publisher with the existing Wiki-management capability. Retry does not request the PDF again from the publisher and does not modify document metadata or revision.

The Documents section also shows aggregate readiness such as `18 of 20 searchable` when any item is pending or failed. Search status never competes visually with document lifecycle, upload, or destructive actions.

## Failure Isolation

Enhanced search is not a core Relay dependency.

### Required degraded behavior

If collection bootstrap, synchronization, validation, indexing, ranking, cache persistence, IPC, or UI rendering fails:

- Relay startup continues.
- PocketBase and core collection bootstrap continue.
- PDF publication and replacement continue.
- Wiki documents and covers remain readable.
- Manage Wiki remains usable.
- The viewer's exact local search remains usable.
- Catalog metadata filtering remains usable.
- Contact, group, server, and action search results remain usable.
- Other tabs and client connectivity remain unaffected.

### Containment mechanisms

- Search collection bootstrap is an optional post-core step with bounded retries.
- Indexing uses the existing worker timeout, termination, and restart boundary.
- Search jobs have per-document error containment; one corrupt PDF cannot stop the queue.
- PocketBase records pass strict shared validation before entering the in-memory index.
- Unknown index versions, stale checksums, oversized text, invalid offsets, and inactive documents are discarded.
- Search handlers translate internal failures into a stable unavailable response.
- The service opens a temporary circuit after repeated failures and retries after a cooldown or explicit management retry.
- Derived records and caches are disposable and rebuildable from protected PDFs.

No search failure may throw across the application startup boundary or React feature boundary.

## Security and Privacy

- No PDF text or query leaves the configured Relay PocketBase environment.
- Search chunks are not publicly readable and are never exposed through universal unauthenticated rules.
- Search requests use schema validation, query length limits, result limits, and fixed ranking behavior.
- Management retry requires the existing publisher/admin/owner capability checks.
- Logs include document IDs and bounded safe error codes, not passage text, full queries, credentials, file tokens, or PDF bytes.
- Offline cache storage follows the same data-root ownership, cleanup, and backup boundaries as other Relay cached data.

## Testing Strategy

### Search engine

- Unicode and whitespace normalization with source offsets.
- Exact phrase, token-order, prefix, typo, transposition, acronym, numeric, and identifier behavior.
- Edit-distance boundaries by token length.
- Stable tie-breaking, per-document caps, adjacent-passage collapse, and minimum-score rejection.
- False-positive cases and explicit no-result queries.
- Cancellation, stale generations, timeout, and circuit behavior.

### Index lifecycle

- New publication, replacement activation, failed partial replacement, retry, and cleanup.
- Startup backfill, version rebuild, restart recovery, and concurrency one.
- Trash, restore, permanent deletion, title/category changes, and stale checksum rejection.
- Image-only pages, partially extractable PDFs, malformed text items, oversized records, and worker termination.

### Failure isolation

Fault-injection tests must prove that every search dependency can fail while the following still succeed:

- Application startup.
- Core PocketBase bootstrap.
- PDF publication and replacement.
- Wiki catalog rendering and metadata filtering.
- PDF opening and exact viewer search.
- Manage Wiki navigation.
- Contact, server, group, and action search.

These tests are a release gate.

### Interface behavior

- Universal search grouping, keyboard navigation, selection, and non-Wiki result independence.
- Catalog result mode, filters, clear behavior, page navigation, and unavailable fallback.
- Viewer exact/fuzzy merge, deduplication, canonical fuzzy highlight, match navigation, and offline behavior.
- Management status, retry focus restoration, error messaging, responsive layout, and capability enforcement.
- Screen-reader result counts, live-region updates, focus management, and reduced motion.

### Relevance evaluation

Before default enablement, evaluate a curated set of at least 30 real NOC queries covering:

- Known document titles and categories.
- Procedural phrases.
- Acronyms and operational identifiers.
- One- and two-edit misspellings.
- Queries expected to return no result.

Every expected destination must appear in the top three. No-result queries must remain empty. Failures require ranking or threshold correction before release.

## Acceptance Criteria

The feature is complete only when:

1. Active Wiki passages are indexed in PocketBase and synchronized to workstations without a separate database or service.
2. Global and open-guide exact/fuzzy searches return deterministic page-aware results.
3. Result selection opens the correct document and page and highlights the correct canonical text.
4. Covers remain the default Wiki presentation when no search is active.
5. Existing installations backfill safely without blocking startup.
6. Publishers can see and retry search-index failures without re-uploading PDFs.
7. Trash, restore, replacement, metadata changes, and permanent deletion produce correct eligible results.
8. Offline or degraded mode preserves exact open-document search and metadata filtering.
9. Search dependency failures do not affect startup, publishing, PDF viewing, management, other tabs, connectivity, or non-Wiki search.
10. The automated suite, fault-injection matrix, typecheck, lint, format, production build, and relevance evaluation all pass.

## Verification

Automated verification completed on 2026-07-19:

- `npm run test:unit -- --run src/main/knowledge/__tests__/KnowledgeSearchFailureIsolation.test.ts` — PASS, 15 tests, including delayed publication A rejection after replacement B is ready.
- `npm run test:renderer -- src/renderer/src/features/knowledge/__tests__/KnowledgeSearchFailureIsolation.test.tsx` — PASS, 9 tests.
- `npm test` — PASS: 1,707 unit tests, 79 cache tests, and 2,687 renderer tests (4,473 total).
- `npm run typecheck` — PASS.
- `npm run lint` — PASS.
- `npm run format:check` — PASS.
- `npm run build` — PASS. Vite emitted its existing informational large-chunk warning.
- `git diff --check` — PASS.

The main-process matrix covers optional storage bootstrap, client search authentication, collection fetch and validation, cache reads and writes, extraction worker timeout and exit, chunk-batch and document-status failures, realtime subscription drops, ranking timeout, explicit cancellation, IPC handler exceptions, and a delayed trigger rejection from publication A after replacement B is ready. Every row uses one connected storage, cache identity, search service/runtime, command-triggered indexer, management-command registration, and PDF-open path. Publish, replace, and restore remain successful, command-triggered queue faults recover on later work, and the search assertion comes from that row's faulted service/runtime/engine. Trigger-failure callbacks carry the successful mutation's checksum and revision; the indexer fails only a matching pending operation, ignores stale checksum/revision identities, and preserves a matching already-ready checksum such as restore reuse. Owning tests additionally prove that synchronous throws and rejected promises/thenables cannot reject a completed mutation, emit only bounded logs, and expose management retry when the matching operation actually fails.

The renderer matrix covers a missing bridge API, rejected IPC, typed timeout, cancellation, malformed responses, and separate production render-boundary failures in universal search, the catalog, and the open-guide sidebar. Every row renders the actual SearchProvider/SearchContext, exported NotesProvider, ToastProvider, HeaderSearch, KnowledgeLibrary, reader search/sidebar, KnowledgeManagementWorkspace, KnowledgeWorkspace, DirectoryTab, and ServersTab. Contact, server, and action selections each reopen the dropdown by focusing and typing through real provider state, then prove production clear/blur closes it before the next selection. The matrix also proves NotesProvider data/reload lifecycle, local catalog opening, exact reader navigation, an actionable management surface, and activation of the production Contacts and Servers destinations. The catalog recovery row crashes the real KnowledgeSearchBoundary and proves a new search generation restores enhanced results.

Live Electron verification completed on 2026-07-19 against the local PocketBase-backed test copy:

- The empty-query Wiki opens on the cover-first catalog with separate SOP-guide and cheatsheet type controls.
- The exact phrase `Understanding Oracle Terms and Tickets` returns and opens the canonical page 4 passage.
- The one-edit query `Understnding` returns `Close match` results, opens page 4, and highlights the canonical `Understanding` text.
- The short token `rf` returns page 7 matches and highlights the visible `RF Gun Password Resets` text; `gg` returns no matches and no highlight, directly exercising the reported regression.
- Exact and fuzzy reader results navigate correctly in single-page and continuous modes. The active highlight remains aligned after zooming from 100% to 115%.
- Universal search independently returns a real contact (`Alex Novak`), server (`prod-api-01`), and navigation actions while Wiki passage search is installed.
- The local index reached `ready` for the 23-page Oracle guide with 29 synchronized passage chunks, and PocketBase batch writes completed successfully after bootstrap enabled the optional batch setting.

The current local instance has no connected client peer and is signed out of privileged access, so client-disconnect fallback and protected management readiness/retry were verified with the production-component fault-injection matrices rather than by changing local topology or creating credentials. Those matrices exercise the real cache/search/runtime/management boundaries and prove that enhanced-search failures do not block metadata filtering, exact open-document search, publishing, PDF viewing, management recovery, Contacts, Servers, actions, or Relay startup.
