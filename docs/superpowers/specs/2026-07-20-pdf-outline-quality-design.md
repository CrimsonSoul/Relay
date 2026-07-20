# PDF Outline Quality Design

## Problem

Relay correctly prefers a PDF's native bookmarks, but its typography fallback is too permissive when bookmarks are absent. It promotes visually prominent cover text into the document outline, joins every same-baseline PDF text run with a space, and does not use a document's visible Contents page. The Oracle SOP Manual reproduces all three failures: cover labels appear as sections, `step-by-step` becomes `step - by - step`, and `Tickets` becomes `Tic kets`.

The original Knowledge design requires deterministic, local extraction using font size, weight, spacing, short-line structure, and low-confidence rejection. The implementation currently relies primarily on font-size thresholds.

## Goals

- Keep all extraction deterministic, bounded, and local to the Relay server.
- Preserve native PDF bookmarks as the highest-priority outline source.
- Prefer a high-confidence visible Contents page over typography inference.
- Reconstruct adjacent PDF text runs without introducing spaces inside words or around hyphens.
- Reject cover-page title material and weak typography candidates when no trustworthy Contents page exists.
- Keep existing `KnowledgeOutlineNode` and `outlineSource` contracts unchanged.

## Non-goals

- OCR, cloud processing, LLM classification, or external document services.
- Document-specific title lists, Oracle-specific rules, or hard-coded page numbers.
- Editing a PDF or its source Word document.
- Automatic migration of already-persisted outline JSON in this change.

## Extraction order

1. Normalize and return usable native PDF bookmarks exactly as Relay does today.
2. Group PDF text items into visual lines and reconstruct each line from horizontal geometry.
3. Search for a page containing a `Contents` or `Table of contents` heading.
4. On that page, accept rows only when they contain a non-empty label, a dot leader, and a trailing in-range page number. Require at least two monotonic rows before trusting the page.
5. Build level-one outline nodes from those rows. Resolve the vertical coordinate by matching the normalized label on the referenced page; page-only navigation remains valid when no exact label match exists.
6. If no trustworthy Contents outline exists, run typography inference with repeated-margin/page-number filtering, cover-page suppression, and isolation-aware confidence checks.

## Text reconstruction

Text items remain sorted by baseline and horizontal position. Same-baseline items are concatenated when their horizontal gap is no larger than a small font-relative threshold; otherwise Relay inserts one space. Existing whitespace in a text run also creates one normalized separator. This preserves ordinary word boundaries while repairing adjacent split runs such as `Tic` + `kets` and `step` + `-` + `by`.

Contents parsing uses the original ordered items rather than a regular expression over flattened page text. A row is eligible only when one or more dot-leader runs sit between the label items and the final numeric page item. This keeps numbered prose and arbitrary large text from being mistaken for a table of contents.

## Typography fallback confidence

The fallback continues to determine the predominant body size and remove repeated headers, footers, and page-number-only lines. A candidate must be short, meaningfully larger than body text, and visually isolated from neighboring lines unless its size is decisively larger. On multi-page documents, a first page with several oversized title treatments and a maximum size far above body text is treated as a cover and omitted from inferred headings.

## Persistence and existing documents

The resulting outline is persisted during publication exactly as it is today. A previously uploaded document retains its old outline until it is replaced or otherwise reprocessed. The existing replace flow will rerun extraction and preserve the document's managed identity.

## Verification

- Pure tests cover adjacent-run joining, ordinary word spacing, Contents-row validation, page destinations, cover suppression, and fallback behavior.
- The existing native/inferred/no-outline extractor tests remain green.
- A local diagnostic runs the current extractor against the real Oracle SOP Manual and expects exactly the five Contents entries on pages 3, 4, 5, 8, and 14 with unbroken labels.
- Run focused tests, the complete unit/cache/renderer suites, lint/type checks available in the repository, and the production build.
