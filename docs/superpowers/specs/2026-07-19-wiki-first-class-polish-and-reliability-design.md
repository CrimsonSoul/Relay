# Wiki First-Class Polish and Reliability Design

**Date:** 2026-07-19

**Status:** Approved design; awaiting written-spec review

## Summary

Relay will improve the existing Wiki through a targeted visual-polish, document-search, and reliability pass. This is not a redesign. The current information architecture already has the right foundation: category-based SOP cover shelves, compact cheatsheet rows, a PDF reader with Contents and Library sidebar modes, continuous and single-page viewing, protected management, editable categories, resumable uploads, trash, and audit history.

The pass keeps those structures and workflows. It makes the Wiki feel like a first-class Relay workspace by strengthening the distinction between full SOP guides and cheatsheets, making the PDF reader smooth and feature-rich, adding full-text search within the open document, aligning management with the rest of Relay, and debugging catalog, reader, and management behavior across normal and interrupted states.

## Relationship to Existing Designs

This design extends the following approved specifications rather than replacing their broader architecture:

- `2026-07-17-role-accounts-and-knowledge-workspace-design.md`
- `2026-07-18-knowledge-splash-square-nav-design.md`
- `2026-07-18-collapsible-wiki-library-design.md`
- `2026-07-18-compact-wiki-library-drawer-design.md`
- `2026-07-18-compact-wiki-viewer-toolbar-design.md`
- `2026-07-18-knowledge-directory-typography-design.md`
- `2026-07-18-wiki-management-operational-alignment-design.md`
- `2026-07-15-resumable-pocketbase-knowledge-uploads-design.md`

Where those specifications conflict with this document, this document controls only the following narrow areas:

- Knowledge Home is shown on the first successful Knowledge visit on a workstation; later visits restore the last Knowledge destination instead of returning home once per application session.
- The Wiki Contents sidebar gains full-text search of the open PDF and a search-highlight layer. This is the only approved expansion of the earlier typography specification's PDF text-layer boundary.
- The management pass includes behavioral debugging and regression coverage while preserving the existing server contracts, permissions, and available actions.

Role accounts, authorization, operator removal, Contacts and Servers behavior, the read-only PDF security model, resumable upload protocol, offline cache, and PocketBase connection model remain unchanged.

## Goals

- Preserve the current Wiki information architecture and working feature set.
- Keep full SOP guides visually dominant through real cover art and category shelves.
- Keep cheatsheets visibly distinct as compact fast-reference rows.
- Make opening, reading, searching, navigating, zooming, and switching PDF view modes feel immediate and stable.
- Search all selectable text in the open document and navigate to the exact matching page and location.
- Keep document search and library filtering clear, separate, and keyboard accessible.
- Align Wiki management with Relay's established operational layout and component vocabulary.
- Debug the complete catalog, viewer, and management experience, including interrupted and recovery states.
- Preserve functionality, permissions, data integrity, and migration compatibility.

## Non-goals

- No wholesale Wiki redesign or new information architecture.
- No PDF editing, annotation, form filling, printing, downloading, or attachment support.
- No OCR for scanned or image-only pages in this pass.
- No global full-text search across every PDF body. Catalog and global Relay search continue to use document identity, category, filename, and outline metadata.
- No changes to protected roles, passwords, privileged session rules, or management capabilities.
- No replacement of PocketBase collections, upload protocols, cache formats, or PDF rendering technology.
- No unrelated refactor outside the Wiki code touched by this work.

## Knowledge Entry and Navigation

The outer sidebar remains **Knowledge**. Its internal navigation remains ordered:

1. Wiki
2. Contacts
3. Servers

Knowledge Home remains explicitly accessible from every destination. The launcher continues to show Wiki, Contacts, and Servers using the approved square Relay treatment.

The launcher is a first-visit orientation surface rather than a mandatory intermediate screen:

- The first successful Knowledge visit on a workstation opens Knowledge Home.
- Opening Wiki, Contacts, or Servers stores that destination locally as the last Knowledge destination.
- Later returns to Knowledge restore the last destination and its retained local state.
- Choosing Knowledge Home explicitly always opens the launcher.
- Missing, corrupt, or unsupported stored values fall back to Knowledge Home.
- This preference is workstation-local and is not synchronized or associated with a passwordless ordinary user identity.

## Wiki Catalog

### Content hierarchy

The catalog keeps two first-class document formats with different visual treatments:

- **Full SOP guides** are complete procedures. They use real PDF cover art, category shelves, document title, category, and page count. Cover art remains the primary visual element.
- **Cheatsheets** are short fast-reference documents. They use compact rows with title, category, page count, and a clear open affordance. They are not forced into fake book-cover cards.

The catalog continues to use category, document type, and sort controls. Local catalog search remains scoped to the Wiki catalog and matches document identity plus indexed outline headings. The removed Recently Updated section does not return.

### Visual polish

The catalog retains its current structure and receives only targeted refinement:

- use the approved semantic Relay typography tokens;
- keep cover proportions stable without cropping or stretching;
- strengthen section hierarchy between SOP guides and cheatsheets;
- keep controls, labels, counts, and spacing aligned with Status and Problems;
- preserve square operational panes and restrained use of the active accent;
- prevent control overflow and double focus outlines at every supported width; and
- retain structural responsive changes instead of shrinking readable text.

Loading uses stable cover shells or skeletons rather than shifting the layout. Missing or failed covers use an intentional document fallback without changing card dimensions.

## PDF Viewer Experience

### Existing reader behavior

The reader preserves:

- Continuous scrolling as the default view mode;
- Single page as an available view mode;
- 100% as the neutral initial zoom;
- fit-width and manual zoom controls;
- grouped page, zoom, and View controls;
- selectable PDF text and safe internal/external links;
- the Contents and Library sidebar modes;
- an always-available show/hide sidebar control on desktop; and
- a drawer presentation at compact widths.

Switching documents, view modes, pages, or sidebar states must preserve the active PDF identity and prevent stale asynchronous work from mutating the new document.

### Sidebar search model

The sidebar uses one consistent physical search location with two explicitly different scopes:

- **Contents mode — Search this guide:** searches selectable text throughout the open PDF.
- **Library mode — Filter library:** retains the existing document/category/outline filtering behavior.

The fields keep independent query state. Switching modes never silently reinterprets an existing query. The visible label, accessible name, and placeholder always communicate the active scope.

When the Contents query is empty, the existing document outline is shown. When it contains a query, the outline area becomes the result list. Clearing the query restores the outline and its active-section state.

`Cmd/Ctrl + F` while the Wiki reader is active opens the sidebar when necessary, selects Contents, and focuses Search this guide. A compact toolbar search action invokes the same behavior but does not add a second persistent search field. Escape closes the active search-result state, restores the outline, and returns focus predictably.

### Document-search behavior

Search operates on all selectable text in the open PDF, not only pages currently rendered on screen.

Each result includes:

- a page number;
- a short contextual snippet;
- section context when the outline provides it; and
- an internal match location used for highlighting and navigation.

Typing starts a progressive search without blocking PDF reading. The result count communicates whether indexing is still in progress. Results already found remain usable while later pages are being processed.

Keyboard and pointer behavior:

- Enter activates the next match.
- Shift+Enter activates the previous match.
- Explicit previous/next controls cycle through matches.
- Selecting a result navigates to its exact page and match.
- Continuous mode scrolls the page shell and match into view.
- Single-page mode opens the target page and then scrolls to the match.
- The active match uses the strongest search highlight; other rendered matches use a quieter highlight.
- Search navigation updates the viewer's current-page state without fighting normal scrolling or outline navigation.

For PDFs without usable selectable text, the Contents search surface explains that the document has no searchable text. It does not claim there are zero matches. OCR is not attempted.

### Smoothness and motion

The viewer prioritizes stable geometry and responsive input over decorative animation:

- PDF pages and cover shells never jump when asynchronous metadata arrives.
- Search results reveal and update with a restrained 150–250 ms state transition.
- Page and match navigation uses smooth scrolling unless reduced motion is requested.
- Search indexing, page rendering, and cover loading do not block typing or toolbar interaction.
- Continuous rendering remains virtualized and releases expensive offscreen canvas, text, link, and highlight resources.
- All state motion has a reduced-motion alternative.

## Document-Search Architecture

### Search index controller

Document search is renderer-local and uses the active PDF.js `PDFDocumentProxy`. It does not require a new server collection or IPC contract.

A focused search-index controller owns:

- page-text extraction;
- normalized searchable text and offset mapping;
- page snippets and section lookup;
- bounded concurrency;
- progressive result publication;
- per-document in-memory caching; and
- cancellation and stale-result protection.

The cache identity is the document ID plus checksum. Replacing a PDF produces a new checksum and cannot reuse stale extracted text. Closing or changing the document cancels outstanding page work. Cache entries are bounded to the active reading session and are not persisted to disk in this pass.

The controller prioritizes the current page, then processes remaining pages with bounded concurrency. It extracts text without rendering offscreen canvases. It releases transient extracted-item arrays after retaining the normalized searchable representation. PDF page cleanup remains coordinated with the existing viewer lifecycle and must never cancel or invalidate an active page render.

Every asynchronous request carries the active document generation. State updates are accepted only if the generation, document ID, and checksum still match the active viewer. Query changes may reuse extracted page text but invalidate older match calculations.

### Search results and highlights

The search controller exposes results with this required public shape:

```ts
type KnowledgeDocumentSearchResult = {
  id: string;
  pageIndex: number;
  matchIndex: number;
  snippet: string;
  sectionLabel: string | null;
  normalizedStart: number;
  normalizedEnd: number;
  textItemRange: { start: number; end: number };
};
```

Additional private indexing fields are permitted, but every public result preserves this offset information so the viewer can map a normalized match back to the rendered PDF text layer.

Highlighting is implemented as an isolated search-highlight layer associated with a rendered page. It derives rectangles from the completed text layer and does not alter the PDF canvas, zoom math, or link targets. When navigation reaches an unrendered continuous page, the existing page shell is scrolled into range, the page renders, and the active highlight is applied after the text layer reports ready.

Outline destinations and search destinations remain distinct request types so stale search work cannot consume or overwrite a deliberate outline-link navigation request.

## Wiki Management

### Information architecture and presentation

Management remains a protected mode of the existing Wiki workspace. It preserves the current Documents, Uploads, Trash, and Audit structure and the existing category editor within the document-management workflow.

The pass keeps the operational-alignment design:

- flat Relay surfaces;
- shared heading and toolbar rhythm;
- square control vocabulary;
- restrained selected states;
- row-based document and audit content rather than card grids;
- one filled primary action for Add PDFs; and
- structural responsive behavior with readable section names.

Document rows and editors clearly expose title, category, document type, page count, publication state, and available actions. SOP guide and Cheatsheet remain the authoritative type values.

### Category management

Categories remain fully editable through the management UI:

- create a category;
- rename a category;
- reorder categories;
- assign or reassign documents;
- delete an unused category; and
- delete a used category only through an explicit reassignment flow.

Category changes retain optimistic revision checks and server-authoritative validation. Inline or progressive editing is preferred over unnecessary modal layers. Destructive confirmation remains explicit.

### Existing workflows preserved

The following workflows remain available and retain their current permission and server boundaries:

- upload staging and validation;
- pause and resume;
- offline pause and recovery;
- retry and source reselection;
- upload cancellation and batch cancellation;
- publish and replace;
- document metadata editing;
- trash, restore, and permanent deletion; and
- immutable audit history.

The renderer never treats hidden controls as authorization. Server-side capability and session checks remain authoritative.

## Debugging and Reliability Scope

### Catalog and reader

The implementation pass must reproduce, diagnose, fix, and regress the following classes of failure:

- returning to Wiki after visiting another destination sometimes produces Wiki unavailable;
- rapid document or destination switching allows stale PDF work to win;
- catalog refreshes produce false document-removed notices;
- publishing, replacing, restoring, or refreshing temporarily invalidates a still-valid selection;
- cover URLs fail, race cleanup, crop, stretch, or leave unstable shells;
- compact toolbars stack unintentionally or overlap borders;
- the sidebar fails to collapse, restore, or become a drawer at the correct width;
- outline, page, and search navigation fight the continuous-page observer;
- loading, empty, unavailable, and retry states lose focus or become stale;
- search, filter, dropdown, textarea, and modal focus treatments show duplicate outlines; and
- long labels or larger semantic type clip at supported widths.

A document is reported as removed only after a successful authoritative library snapshot confirms its absence. Transitional loading, failed refreshes, optimistic management updates, or replaced checksums do not trigger removal copy.

### Management

Management debugging covers every action and recovery state, including:

- privileged session expiry or capability changes while management is open;
- upload interruption, restart recovery, offline pause, resume, retry, and cancellation;
- missing source files and source reselection;
- duplicate filenames, duplicate checksums, conflicts, stale revisions, and replacement failures;
- publish success followed by catalog refresh and selection reconciliation;
- category create, rename, reorder, assignment, reassignment, conflict, and deletion;
- trash restoration and permanent deletion;
- password-confirmed destructive actions;
- audit-event accuracy and actor snapshots;
- loading, empty, error, and partial-success states;
- search and pagination interactions;
- dropdown clipping, native-select overflow, editor validation, modal sizing, focus trapping, and focus restoration;
- compact-window tab navigation and row-action access; and
- bottom-edge spacing and safe scrolling in every management section.

Management operations must be idempotent where the existing contract promises idempotency. A renderer timeout or refresh cannot imply failure when the authoritative server state records success.

## Component Boundaries

The implementation may split oversized Wiki files only where the new behavior or debugging work needs a clear boundary. Likely units include:

- a document-search index/controller hook;
- a Contents search-and-results panel;
- a page search-highlight layer;
- isolated viewer control groups;
- catalog SOP and cheatsheet sections; and
- focused management section components.

Each unit receives bounded data and callbacks. It does not reach into unrelated global state. The existing library hook, PDF acquisition boundary, upload orchestration, and server APIs remain the authoritative sources for their current responsibilities.

## Error Handling

- Search extraction failure on one page reports that page as unavailable while preserving matches from other pages.
- Total searchable-text failure produces a clear unavailable-text state, not a misleading zero-result state.
- Document replacement or removal cancels search and clears highlight state before the new identity renders.
- Failed library refreshes preserve the last valid catalog and selection while showing a bounded retry state.
- Management mutations distinguish validation, authorization, conflict, offline, server, and unknown failures using the existing safe error vocabulary.
- Partial upload or batch outcomes identify affected files without discarding successful files.
- Retrying an operation cannot duplicate an already-completed authoritative mutation.
- Error recovery returns focus to the initiating control or the restored content region.

## Verification Strategy

### Unit and model tests

- document-search normalization and matching;
- text-item offset mapping and snippets;
- section-context lookup;
- progressive results and stable ordering;
- bounded extraction concurrency;
- cache identity and checksum invalidation;
- cancellation on query and document changes;
- stale generation rejection;
- empty, no-match, unavailable-text, and partial-page-error states;
- catalog selection reconciliation and false-removal prevention; and
- category and management state transitions.

### Component and integration tests

- Contents and Library keep independent search queries and scopes;
- `Cmd/Ctrl + F` opens/focuses Search this guide;
- search-result selection navigates and highlights in both view modes;
- Enter, Shift+Enter, previous, next, Escape, and focus restoration;
- search navigation waits for virtualized page rendering without hanging;
- document/view/destination switches cancel stale work;
- Wiki leave-and-return cycles do not enter an error boundary;
- catalog, cover, outline, sidebar, and toolbar loading/error recovery;
- every management action and failure class listed above;
- permission expiry and capability changes;
- upload restart recovery and idempotent reconciliation;
- category reassignment before deletion;
- restore and permanent-delete confirmation; and
- audit projections after successful mutations.

### Visual and responsive verification

Verify the running Electron app at:

- 1920×1080 for the 55-inch distance-viewing case;
- approximately 960×1080 for the half-monitor case; and
- the narrowest supported compact window.

Cover the catalog, an SOP reader, a cheatsheet reader, Contents search, Library filtering, collapsed sidebar, compact drawer, both PDF view modes, Documents, category editing, Uploads, Trash, Audit, destructive confirmation, and representative loading/error/empty states.

Confirm that no control, focus indicator, result snippet, category name, document title, row action, modal, or toolbar clips or overlaps. Confirm that page rendering, typing, search-result updates, and scrolling remain responsive during progressive extraction.

### Required gates

Run focused Knowledge renderer and main-process tests first, followed by:

- the complete renderer test suite;
- the complete main-process Knowledge suite;
- typecheck;
- lint;
- formatting checks;
- production build;
- `git diff --check`; and
- live Electron verification at the required widths.

Any tool or hook that rewrites files requires the affected verification to be rerun.

## Acceptance Criteria

- The Wiki retains its existing architecture and recognizable Relay design.
- Full SOP guides remain the visual showcase, and cheatsheets remain clearly distinct fast-reference rows.
- Knowledge Home appears once for workstation orientation, while later Knowledge visits restore the last destination.
- The reader opens, closes, and reopens repeatedly without Wiki unavailable or stale-document failures.
- The viewer defaults to continuous scrolling and 100% zoom while preserving all approved controls.
- Search this guide finds selectable text across the entire open PDF, reports progressive results, and navigates to an exact highlighted match in both view modes.
- Library filtering remains separate and unchanged in scope.
- Scanned image-only PDFs communicate that searchable text is unavailable; no OCR is attempted.
- Reader interaction remains smooth while pages render and search indexing runs.
- Management preserves every current action and permission boundary.
- Categories are fully editable with safe reassignment and conflict handling.
- Upload, publish, replace, trash, restore, deletion, audit, interruption, and recovery paths are verified.
- No false removed notices, duplicate focus outlines, clipped controls, accidental toolbar stacks, or compact-window regressions remain.
- All required automated and live verification gates pass after the final edits.
