# PDF Outline Quality Implementation Plan

> **Execution:** The primary agent implements this plan directly in the current session per the repository's `AGENTS.md` speed profile. Do not dispatch per-task implementers or create a worktree.

**Goal:** Produce accurate deterministic outlines for unbookmarked PDFs by preferring credible Contents rows, reconstructing split text runs, and rejecting cover-page noise.

**Architecture:** Keep `extractKnowledgePdf`'s native-outline-first flow unchanged. Strengthen the pure `inferKnowledgeOutline` pipeline in `knowledgeOutline.ts`: geometry-aware line reconstruction feeds a high-confidence Contents parser, followed by a safer typography fallback. Existing shared and persisted contracts remain unchanged.

**Tech Stack:** TypeScript, PDF.js text items, Vitest, Electron/Vite.

## Global Constraints

- All extraction remains local, deterministic, and bounded.
- Do not add OCR, network calls, document-specific labels, or hard-coded page numbers.
- Native PDF bookmarks always win when usable.
- `KnowledgeOutlineNode` and `outlineSource` contracts do not change.
- Use red-green TDD for every production behavior change.

---

### Task 1: Reconstruct PDF Text Runs From Geometry

**Files:**

- Modify: `src/main/knowledge/knowledgeOutline.test.ts`
- Modify: `src/main/knowledge/knowledgeOutline.ts`

**Interfaces:**

- Consumes: existing `KnowledgeTextItem` values (`str`, `transform`, `width`, `fontName`).
- Produces: normalized line labels used by both Contents parsing and typography inference; no new exported API.

- [ ] Add a failing pure test whose same-baseline heading items contain adjacent `Tic` + `kets` and `step` + `-` + `by` runs, while ordinary words have a visible horizontal gap.
- [ ] Run `npx vitest run src/main/knowledge/knowledgeOutline.test.ts` and confirm the label contains unwanted inserted spaces.
- [ ] Replace unconditional `.join(' ')` with a font-relative horizontal-gap joiner that normalizes explicit whitespace and inserts one space only for a real word gap.
- [ ] Rerun the focused suite and confirm the reconstructed labels are exact.

### Task 2: Prefer a Credible Contents Page

**Files:**

- Modify: `src/main/knowledge/knowledgeOutline.test.ts`
- Modify: `src/main/knowledge/knowledgeOutline.ts`

**Interfaces:**

- Consumes: grouped text lines retaining ordered source items and the complete `KnowledgeTextPage[]` collection.
- Produces: `KnowledgeOutlineNode[]` derived from Contents rows when a page has a Contents heading plus at least two monotonic `label + dot leader + page number` rows.

- [ ] Add a failing test modeling the Oracle cover, Contents page, and referenced headings. Expect only the five Contents labels, all level 1, with destination pages 3, 4, 5, 8, and 14.
- [ ] Run the focused suite and confirm the current fallback returns cover/title noise.
- [ ] Implement item-aware Contents-row parsing, in-range and monotonic page validation, stable IDs, and exact normalized target-page top matching.
- [ ] Rerun the focused suite and confirm false Contents-like prose without dot leaders still falls through to typography inference.

### Task 3: Harden Typography Fallback Confidence

**Files:**

- Modify: `src/main/knowledge/knowledgeOutline.test.ts`
- Modify: `src/main/knowledge/knowledgeOutline.ts`

**Interfaces:**

- Consumes: grouped line geometry, predominant body size, and page count.
- Produces: the existing inferred `KnowledgeOutlineNode[]` when no credible Contents outline exists.

- [ ] Add a failing test for a multi-page unbookmarked PDF with an oversized multi-treatment cover and real section headings but no Contents page.
- [ ] Run the focused suite and confirm the cover labels are returned.
- [ ] Exclude a cover-like first page only when the document is multi-page and the page has several candidate sizes with a maximum far above body text.
- [ ] Require visual isolation for borderline size/bold candidates while retaining decisively larger headings.
- [ ] Rerun the focused suite and all existing extractor tests.

### Task 4: Verify the Real Document and Repository

**Files:**

- Temporarily create and then delete: `src/main/knowledge/oracleSopDiagnostic.test.ts`
- Review: `src/main/knowledge/knowledgeOutline.ts`
- Review: `src/main/knowledge/knowledgeOutline.test.ts`

**Interfaces:**

- Consumes: `/Users/ryan/Downloads/Oracle SOP Manual.pdf` only for local verification.
- Produces: no committed fixture or user-document content.

- [ ] Run the actual Oracle PDF through `extractKnowledgePdf` and assert `outlineSource === 'inferred'` with exactly the five correct Contents labels and page numbers.
- [ ] Delete the temporary diagnostic and verify `git status` contains only intended source/test/docs changes.
- [ ] Run `npx vitest run src/main/knowledge/knowledgeOutline.test.ts src/main/knowledge/knowledgeExtractor.test.ts`.
- [ ] Run the repository's complete test, lint/type-check, and build commands from `package.json`.
- [ ] Review `git diff --check`, the complete diff, and commit the implementation locally without pushing.
