# Collapsible Wiki Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users collapse the persistent wide Wiki library without changing the existing compact overlay drawer.

**Architecture:** `KnowledgeTab` keeps separate compact-overlay and wide-collapse booleans and exposes both through workspace data attributes. CSS container queries own breakpoint behavior, showing a wide collapse/restore pair above 900px and the current overlay controls at 900px or less.

**Tech Stack:** React 19, TypeScript, CSS container queries, Vitest and Testing Library, Playwright Electron.

## Global Constraints

- The wide library starts open after a fresh application launch.
- The wide collapsed preference lasts only while the mounted Wiki workspace remains alive.
- Compact drawer state and wide collapsed state remain independent across resizing.
- Do not alter PDF loading, rendering, pagination, zoom, continuous scrolling, retained selection, or the 900px breakpoint.
- Use Relay's existing Wiki icon, square controls, border tokens, and focus treatments.
- Keep the existing untracked `output/` directory untouched.

---

### Task 1: Wide collapse interaction contract

**Files:**
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgeTab.test.tsx`
- Modify: `src/renderer/src/features/knowledge/KnowledgeTab.tsx`

**Interfaces:**
- Consumes: existing `libraryDrawerOpen`, search ref, drawer id, and compact close lifecycle.
- Produces: `desktopLibraryCollapsed`, `data-library-collapsed="true|false"`, `Collapse Wiki library`, and `Show Wiki library` controls.

- [ ] **Step 1: Write the failing interaction test**

Render a populated `KnowledgeTab`; assert the workspace starts with `data-library-collapsed="false"`, collapsing changes it to `true` and focuses `Show Wiki library`, restoring changes it to `false` and focuses `Search Wiki`, and compact open/close actions do not change the wide attribute.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:renderer -- src/renderer/src/features/knowledge/__tests__/KnowledgeTab.test.tsx -t "collapses the wide Wiki library"`

Expected: FAIL because `Collapse Wiki library`, `Show Wiki library`, and `data-library-collapsed` do not exist.

- [ ] **Step 3: Implement the minimal React state and controls**

Add `desktopLibraryCollapsed`, separate compact and wide restore refs, a shared focus helper, a wide collapse button in the drawer heading, and a wide restore `Library` button before the backdrop. Keep existing compact close and selection behavior unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2 and expect the focused test to pass.

### Task 2: Wide collapsed layout and compact isolation

**Files:**
- Modify: `src/renderer/src/features/knowledge/knowledge.css`
- Modify: `tests/e2e/knowledge-pdf-layout.spec.ts`

**Interfaces:**
- Consumes: Task 1's wide collapse attribute and distinct control class names.
- Produces: full-width desktop reader, desktop restore-control placement, persistent default layout, and unchanged compact overlay layout.

- [ ] **Step 1: Extend the failing layout regression**

At a 1040px Knowledge container, assert that the library and two-column geometry start visible, then simulate `data-library-collapsed="true"` and assert the drawer hides, the reader fills the workspace, and `Show Wiki library` appears. Resize to 880px and assert the wide control hides while the compact overlay remains closed and independently openable.

- [ ] **Step 2: Run the layout test and verify RED**

Run: `npm run test:electron -- tests/e2e/knowledge-pdf-layout.spec.ts -g "collapsible Wiki library"`

Expected: FAIL because wide collapsed geometry and separate controls do not exist.

- [ ] **Step 3: Implement the container-driven CSS**

Add base wide collapsed selectors, wide-only collapse and restore controls, reader-toolbar offset while collapsed, and compact overrides that ignore the wide attribute. Reuse the existing control states and reduced-motion rules.

- [ ] **Step 4: Run the layout test and verify GREEN**

Run the command from Step 2 and expect the wide and compact assertions to pass.

### Task 3: Real Relay resize regression

**Files:**
- Modify: `tests/e2e/critical-path.spec.ts`

**Interfaces:**
- Consumes: the wide collapse/restore controls and existing compact drawer critical path.
- Produces: a real Electron regression for wide preference retention through compact resizing.

- [ ] **Step 1: Extend the compact Wiki workflow**

Start at desktop width, collapse the library, verify the PDF remains selected, resize to compact and exercise the overlay, resize back to desktop and assert the library remains collapsed, then restore it and verify search focus and reader state.

- [ ] **Step 2: Run the focused Electron test**

Run: `npm run test:electron -- tests/e2e/critical-path.spec.ts -g "compact Wiki Library drawer"`

Expected: PASS with wide preference, compact overlay, and PDF state intact.

### Task 4: Verification and handoff

**Files:**
- Verify only; no additional production files.

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: a reviewed commit and running Relay test instance.

- [ ] **Step 1: Run full verification**

Run `npm run test:renderer`, `npm run typecheck`, targeted ESLint and Prettier checks, `npm run build`, `npm run test:electron -- tests/e2e/knowledge-pdf-layout.spec.ts`, and the focused Wiki lifecycle Electron tests.

- [ ] **Step 2: Review and commit**

Run `git diff --check`, inspect the complete diff, confirm `output/` is untouched, and commit with `feat: make Wiki library collapsible`.

- [ ] **Step 3: Relaunch Relay**

Restart `npm run dev`, verify the Electron window is visible, verify `http://localhost:5173/` returns HTTP 200, and leave Relay open on the wide Wiki reader with the library collapsed for review.
