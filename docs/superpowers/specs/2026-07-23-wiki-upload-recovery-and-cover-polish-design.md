# Wiki Upload Recovery and Cover Polish Design

**Date:** 2026-07-23

**Status:** Approved

## Summary

Relay will make a focused reliability and presentation pass over Wiki management and SOP cover cards. The change fixes four concrete problems:

1. a ready upload cannot currently be discarded from Upload review;
2. management selects can render white text on a white native option background on Windows;
3. a staged duplicate remains blocked after its original document is permanently deleted until the publisher signs out and back in; and
4. SOP cover shells use a fixed `3 / 4` ratio that adds filler bars around PDFs with a different first-page ratio.

The pass preserves the current Wiki information architecture, permissions, upload protocol, document workflows, and PDF artwork. It adds a clear discard path, makes duplicate state server-authoritative on every management snapshot, standardizes native select colors, and applies the approved **Relay hybrid** cover treatment.

## Relationship to Existing Designs

This design narrows and extends:

- `2026-07-15-resumable-pocketbase-knowledge-uploads-design.md`
- `2026-07-18-wiki-management-operational-alignment-design.md`
- `2026-07-19-wiki-first-class-polish-and-reliability-design.md`

The existing protected management model, resumable upload protocol, publish/replace semantics, trash lifecycle, audit history, and Wiki catalog structure remain authoritative. This document controls only upload discard behavior, live duplicate resolution, management native-select colors, and SOP cover-shell presentation.

## Goals

- Let a publisher discard any unpublished upload that has reached Upload review, including a duplicate filename.
- Remove a discarded upload from the active queue and review surface immediately.
- Re-evaluate upload filename conflicts against the current set of active documents without requiring a new privileged session.
- Make all shared Relay management selects legible in Windows native dropdown menus.
- Render SOP covers at their real first-page aspect ratio without cropping, stretching, or filler bars.
- Add restrained physical depth on cover interaction while preserving Relay's precise, dark, operational design language.
- Cover the fixes with focused regressions and keep existing upload, document, and catalog tests passing.

## Non-goals

- No new upload collection, IPC command, permission, or audit-event type.
- No change to how PDFs are chunked, resumed, extracted, published, replaced, trashed, restored, or permanently deleted.
- No recovery path for a discarded staged upload.
- No conversion of cancelled uploads into published-document Trash items.
- No modification, recoloring, cropping, or regeneration of uploaded PDF cover artwork.
- No permanent reflections, colored cover halos, perspective tilt, or decorative gallery stage in the production catalog.
- No redesign of Wiki navigation, filters, category grouping, reader, Contacts, Servers, or unrelated management sections.

## Upload Discard

### User experience

Every unpublished item shown in **Upload review** receives a danger-outline **Discard upload** action. This includes ready uploads whose filename conflicts with an active published document.

Selecting the action enters a local confirmation state in the row:

- the confirmation names the PDF;
- **Keep upload** exits confirmation without changing data;
- **Discard upload** is the destructive confirmation;
- focus moves into the confirmation and returns predictably if the publisher keeps the upload; and
- only one upload row needs to be in discard confirmation at a time.

Discard is distinct from published-document Trash. It abandons a staging workflow rather than changing a document lifecycle. The existing queue-level **Cancel** action remains available for uploads that are still transferring or processing.

### Behavior

The renderer reuses the existing `knowledge.upload.file.cancel` path through `cancelKnowledgeUpload`. The server continues to:

- authorize the active privileged account;
- mark the upload `cancelled`;
- clear the staged PDF and cover;
- delete staged chunks; and
- prevent in-flight upload or extraction work from reviving the cancelled upload.

After a successful discard, the management hook refreshes both the upload queue and the management snapshot. Upload review excludes `published` and `cancelled` records, so the row disappears immediately. The local draft and discard-confirmation state for that upload are also cleared.

If cancellation fails, the upload remains visible and Relay shows the existing safe cancellation error. The renderer never hides the row optimistically before server confirmation.

## Live Duplicate Resolution

`duplicateDocumentId` stored on a staged upload is validation-time metadata, not permanent truth. Every management snapshot must resolve the current duplicate against documents whose `lifecycleState` is `active`, using the same exact filename rule as upload validation.

The snapshot service already reads documents and uploads together. It will derive an active-document lookup by filename and return each upload view with:

- the current active document ID when an exact filename match exists; or
- `null` when no active document currently owns the filename.

This derived value overrides stale stored upload metadata in the response without requiring a database migration. It also detects an active duplicate that appeared after the upload first became ready.

Permanent deletion already refreshes the management snapshot. Once the original active document no longer exists, the refreshed staged upload returns `duplicateDocumentId: null`; the warning and replace action disappear, and Publish becomes available without logout or reauthentication.

Publish and replace commands retain their server-side uniqueness and revision checks. Live snapshot resolution improves the UI but does not replace authoritative mutation validation.

## Windows Native Select Colors

The shared `select.tactile-input` treatment will explicitly opt into a dark native control scheme and provide option colors:

- `color-scheme: dark` on the select;
- a Relay surface background on `option` elements; and
- primary Relay text on `option` elements.

The fix belongs in the shared tactile-field styles because the failure affects native management selects across the application. Knowledge-specific select chevrons, dimensions, focus states, disabled states, labels, values, and change handlers remain unchanged.

## SOP Cover Presentation

### Approved direction: Relay hybrid

SOP cards use the PDF cover's actual intrinsic ratio once the image loads. The shell has no decorative staging at rest:

- the uploaded cover remains untouched;
- the full first page is visible;
- the shell matches the image ratio;
- no white filler bars are introduced by Relay;
- no cropping or stretching occurs; and
- card metadata and the existing four-column catalog grid remain unchanged.

While a cover is loading or unavailable, the current stable `3 / 4` fallback shell remains so asynchronous loading does not collapse the card or cause a large layout jump. A successfully loaded cover records its intrinsic width and height and applies that ratio to the cover shell.

### Interaction

The existing card hover/focus treatment remains the primary Relay interaction signal. The loaded cover adds only:

- a two-to-three-pixel lift inside the card;
- a narrow paper edge; and
- a quiet neutral shadow.

These effects appear only on card hover or keyboard focus. The active Relay accent continues to control the card border and focus ring; the cover artwork does not acquire an accent tint. Reduced-motion mode removes cover movement while retaining the non-motion focus indication.

The cover image remains `object-fit: contain` as a defensive fallback, but a matching shell ratio means it does not create visible bars during the normal loaded state.

## Accessibility

- **Discard upload**, **Keep upload**, and the destructive confirmation have explicit accessible names that include the filename where needed.
- Confirmation focus behavior is deterministic and keyboard usable.
- Discard busy state prevents duplicate submission.
- Native select options maintain readable foreground/background contrast on Windows.
- Cover effects do not change the card's accessible name or turn decorative paper edges into announced content.
- Keyboard focus receives the same physical cover treatment as pointer hover.
- Reduced-motion users do not receive cover translation.

## Error Handling and Recovery

- A failed discard leaves the upload and draft intact and exposes the safe error.
- A stale upload revision follows the existing cancellation conflict handling and refresh behavior.
- A current duplicate continues to show **Replace existing**; a cleared duplicate exposes **Publish**.
- A failed cover load retains the existing intentional fallback.
- Invalid or unavailable intrinsic dimensions retain the stable fallback ratio.
- Server-side filename checks remain the final authority if state changes between snapshot and publish.

## Verification

Focused regressions will prove:

- a ready duplicate upload exposes **Discard upload**;
- confirming discard invokes cancellation, refreshes authoritative state, clears local review state, and removes cancelled uploads from review;
- keeping an upload exits confirmation without cancellation;
- management snapshots replace stale duplicate IDs with current active-document matches or `null`;
- permanent deletion followed by refresh unblocks the staged upload without a new session;
- shared tactile selects provide a dark color scheme and explicit option foreground/background colors;
- a loaded SOP cover applies its natural ratio and preserves the full image;
- fallback/loading covers keep stable geometry;
- Relay hybrid depth appears only on hover/focus and is reduced-motion safe; and
- existing publish, replace, queue cancellation, trash, restore, category, catalog, and cover-loading tests continue to pass.

Verification will run focused main-process and renderer tests first, followed by the complete relevant test suites, type checking, linting, formatting checks, and a production build. The running app will be checked in the Wiki catalog and Upload review at desktop and supported compact widths.

## Acceptance Criteria

- A publisher can discard a duplicate or unwanted staged upload directly from Upload review.
- Successful discard removes the row immediately and cannot be reversed through document Trash.
- Deleting the original document immediately clears the stale duplicate warning and enables Publish.
- Management dropdown options remain readable on Windows.
- Loaded SOP covers display the entire first page with no Relay-generated filler bars.
- The resting catalog remains restrained and recognizably Relay.
- Cover depth appears only during hover/focus and never alters PDF artwork.
- Existing clients, permissions, upload recovery, publishing, replacement, and document lifecycle behavior remain intact.
