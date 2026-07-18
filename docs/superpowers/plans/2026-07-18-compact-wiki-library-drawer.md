# Compact Wiki Library Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve a full-width Wiki PDF reader in compact Relay windows by converting the persistent library into an accessible overlay drawer.

**Architecture:** `KnowledgeTab` owns the drawer's open state and focus lifecycle while keeping the existing library mounted. A named inline-size container on `.knowledge-tab` changes only layout and visibility at 900px of actual workspace width; desktop behavior remains persistent.

**Tech Stack:** React 19, TypeScript, CSS container queries, Vitest and Testing Library, Playwright Electron.

## Global Constraints

- Do not alter PDF loading, rendering, pagination, continuous scrolling, or retained reader state.
- Use the existing Relay colors, borders, typography, Wiki icon, and square control geometry.
- Preserve the desktop library at Knowledge workspace widths greater than 900px.
- Preserve search, expansion, selection, and page state when the compact drawer opens or closes.
- Keep the existing untracked `output/` directory untouched.

---

### Task 1: Drawer interaction contract

**Files:**
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgeTab.test.tsx`
- Modify: `src/renderer/src/features/knowledge/KnowledgeTab.tsx`

**Interfaces:**
- Consumes: existing `KnowledgeTab` document and heading selection handlers.
- Produces: `data-library-drawer="open|closed"`, `#knowledge-library-drawer`, `Library` toggle, and `Close Wiki library` control.

- [ ] **Step 1: Write the failing interaction test**

Render a populated `KnowledgeTab`; assert the `Library` toggle starts collapsed, opens the drawer and focuses `Search Wiki`, closes on Escape with focus restored, and returns to the closed state after selecting a document.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:renderer -- src/renderer/src/features/knowledge/__tests__/KnowledgeTab.test.tsx -t "compact Library drawer"`

Expected: FAIL because the `Library` control and drawer state contract do not exist.

- [ ] **Step 3: Implement the interaction state**

Add `libraryDrawerOpen`, toggle and close refs, an Escape listener, focus transfer to the search input, explicit backdrop and close controls, and close calls in document, heading, and management activation paths. Keep the drawer mounted and make the toggle state available to CSS through `data-library-drawer`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2 and expect the focused test to pass.

### Task 2: Container-driven compact layout

**Files:**
- Modify: `src/renderer/src/features/knowledge/knowledge.css`
- Modify: `tests/e2e/knowledge-pdf-layout.spec.ts`

**Interfaces:**
- Consumes: Task 1's class names and `data-library-drawer` attribute.
- Produces: named `knowledge-reader` inline-size container and a 900px compact overlay state.

- [ ] **Step 1: Write the failing layout regression**

Build static Knowledge markup at 880px and 1040px container widths. Assert that the compact case hides the closed drawer, spans the reader across the workspace, and shows the toggle; assert that the wider case shows the persistent drawer and hides the toggle.

- [ ] **Step 2: Run the layout test and verify RED**

Run: `npm run test:electron -- tests/e2e/knowledge-pdf-layout.spec.ts -g "compact Wiki library"`

Expected: FAIL because the container query and overlay styles do not exist.

- [ ] **Step 3: Implement the responsive CSS**

Name `.knowledge-tab` as an inline-size container. Add compact-only toggle, backdrop, close control, full-width reader grid, and an absolutely positioned drawer below 900px. Add visibility, pointer-event, focus, transition, and reduced-motion states without changing desktop rules.

- [ ] **Step 4: Run the layout test and verify GREEN**

Run the command from Step 2 and expect the layout regression to pass.

### Task 3: Real Relay compact-window regression

**Files:**
- Modify: `tests/e2e/critical-path.spec.ts`

**Interfaces:**
- Consumes: the compact drawer UI and seeded Wiki PDF fixtures.
- Produces: a persistent critical-path regression for compact Electron windows.

- [ ] **Step 1: Add the Electron workflow**

Launch a connected client with seeded Wiki documents, resize its BrowserWindow to a compact width, open Wiki, exercise open, document selection, Escape, and desktop resize, and assert `Wiki unavailable` never appears.

- [ ] **Step 2: Run the focused Electron test**

Run: `npm run build && npm run test:electron -- tests/e2e/critical-path.spec.ts -g "compact Wiki Library drawer"`

Expected: PASS with the drawer and PDF viewer available through the full workflow.

### Task 4: Verification and handoff

**Files:**
- Verify only; no additional production files.

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: a reviewed, committed compact Wiki implementation and running Relay test instance.

- [ ] **Step 1: Run focused and full verification**

Run `npm run test:renderer -- src/renderer/src/features/knowledge/__tests__/KnowledgeTab.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgePdfViewer.test.tsx`, `npm run typecheck`, targeted ESLint and Prettier checks, `npm run build`, and the focused Electron tests.

- [ ] **Step 2: Review the patch**

Run `git diff --check`, inspect the complete diff, and confirm `output/` remains the only unrelated untracked path.

- [ ] **Step 3: Commit and relaunch**

Commit with `feat: add compact Wiki library drawer`, restart `npm run dev`, verify the Electron window is visible, and verify `http://localhost:5173/` returns HTTP 200.
