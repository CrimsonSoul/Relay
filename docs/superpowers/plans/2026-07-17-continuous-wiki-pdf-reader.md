# Continuous Wiki PDF Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default continuously scrolling Wiki PDF mode with lazy page rendering while preserving the current single-page reader, links, outline destinations, zoom, fit, offline cache, and security behavior.

**Architecture:** Load one `PDFDocumentProxy` per selected Wiki document and share it across both modes. Extract page canvas/text/link rendering into `KnowledgePdfPage`. Continuous mode creates stable lightweight shells for every page, uses an `IntersectionObserver` rooted on the viewer to render only visible pages plus a small overscan range, and derives the current page from intersection ratio. A local preference controls `continuous | single` and mode switches preserve the current page.

**Tech Stack:** React 19, TypeScript 6, pdfjs-dist 5, Electron renderer, CSS overflow layout, IntersectionObserver, Vitest, Testing Library, Playwright, existing protected PDF IPC/cache transport.

## Global Constraints

- The user-facing destination remains Wiki inside the outer Knowledge tab.
- Reader modes are exactly `continuous` and `single`.
- New workstations default to Continuous mode; the preference is local and unsynchronized.
- Switching modes does not reload the PDF and preserves the current page.
- Continuous mode must scroll inside the viewer and must not expand the Relay app shell.
- Render canvases/text/link layers only for visible pages plus a small overscan range; do not render every page of a large PDF.
- Preserve selectable text, internal destinations, guarded web links, relative Wiki links, outline navigation, zoom, fit width, previous/next page, current section, retry, and offline cached PDFs.
- Cancel stale render tasks during rapid page, scale, document, target, and mode changes.
- A page failure is local to that page; a document failure retains the existing document-level recovery.
- Respect reduced-motion preference when scrolling to pages/destinations.
- Use TDD for every behavior and commit each independently testable task.

---

## File Structure

### Create

- `src/renderer/src/features/knowledge/knowledgePdfViewMode.ts` — local view-mode persistence and validation.
- `src/renderer/src/features/knowledge/__tests__/knowledgePdfViewMode.test.ts` — default, persistence, invalid-value, and storage-failure tests.
- `src/renderer/src/features/knowledge/KnowledgePdfPage.tsx` — one page's canvas, text, links, cancellation, and page-local error.
- `src/renderer/src/features/knowledge/__tests__/KnowledgePdfPage.test.tsx` — render/layer/link/error/cleanup tests.
- `src/renderer/src/features/knowledge/useContinuousPdfPages.ts` — page-shell registration, intersection state, current page, and overscan set.
- `src/renderer/src/features/knowledge/__tests__/useContinuousPdfPages.test.tsx` — observer and current-page tests.
- `src/renderer/src/features/knowledge/KnowledgeContinuousPdf.tsx` — shell/metric layout and lazy page composition.
- `src/renderer/src/features/knowledge/__tests__/KnowledgeContinuousPdf.test.tsx` — page shells, bounded rendering, navigation, and retry tests.

### Modify

- `src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx` — shared document lifecycle, mode toggle, current-page synchronization, and shared toolbar.
- `src/renderer/src/features/knowledge/__tests__/KnowledgePdfViewer.test.tsx` — mode switching and regression coverage.
- `src/renderer/src/features/knowledge/KnowledgeLinkLayer.tsx` and tests only if extraction requires a page-scoped callback contract.
- `src/renderer/src/features/knowledge/knowledge.css` — mode control, bounded continuous viewport, page gaps/shells, loading/error states, responsive controls.
- `src/renderer/src/features/knowledge/knowledgePdfDestination.ts` and tests only if a shared page-target helper is needed.
- `tests/e2e/critical-path.spec.ts` — real scrolling, mode persistence, page preservation, and link checks.
- `docs/DESIGN.md` and `docs/architecture.md` — final reader architecture and performance contract.

---

### Task 1: Add a Local PDF View-Mode Contract

**Files:**

- Create: `src/renderer/src/features/knowledge/knowledgePdfViewMode.ts`
- Create: `src/renderer/src/features/knowledge/__tests__/knowledgePdfViewMode.test.ts`

**Interfaces:**

```ts
export type KnowledgePdfViewMode = 'continuous' | 'single';
export const KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY = 'relay.knowledge.pdfViewMode';

export function loadKnowledgePdfViewMode(): KnowledgePdfViewMode;
export function persistKnowledgePdfViewMode(mode: KnowledgePdfViewMode): void;
```

- [ ] **Step 1: Write failing preference tests**

```ts
it('defaults to continuous and ignores invalid storage', () => {
  expect(loadKnowledgePdfViewMode()).toBe('continuous');
  localStorage.setItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY, 'spread');
  expect(loadKnowledgePdfViewMode()).toBe('continuous');
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node scripts/run-renderer-tests.mjs knowledgePdfViewMode.test.ts
```

Expected: the view-mode helper is missing.

- [ ] **Step 3: Implement safe local persistence**

```ts
export function loadKnowledgePdfViewMode(): KnowledgePdfViewMode {
  try {
    return globalThis.localStorage.getItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY) === 'single'
      ? 'single'
      : 'continuous';
  } catch {
    return 'continuous';
  }
}

export function persistKnowledgePdfViewMode(mode: KnowledgePdfViewMode): void {
  try {
    globalThis.localStorage.setItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // A blocked preference store must not block PDF reading.
  }
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: preference and toolbar state pass without regressing existing reader tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/knowledge/knowledgePdfViewMode.ts src/renderer/src/features/knowledge/__tests__/knowledgePdfViewMode.test.ts
git commit -m "feat(knowledge): add PDF reader mode preference"
```

---

### Task 2: Extract a Reusable Cancellable PDF Page

**Files:**

- Create: `src/renderer/src/features/knowledge/KnowledgePdfPage.tsx`
- Create: `src/renderer/src/features/knowledge/__tests__/KnowledgePdfPage.test.tsx`
- Modify: `src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx`
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgePdfViewer.test.tsx`
- Modify: `src/renderer/src/features/knowledge/KnowledgeLinkLayer.tsx` only if callback types must be exported.

**Interfaces:**

```ts
export type KnowledgePdfPageStatus =
  | { state: 'ready'; pageIndex: number; width: number; height: number }
  | { state: 'error'; pageIndex: number; message: string };

export type KnowledgePdfPageProps = {
  pdf: PDFDocumentProxy;
  pageIndex: number;
  scale: number;
  render: boolean;
  targetTop: number | null;
  retryKey: number;
  resolveUrl: (url: string) => KnowledgeResolvedLink;
  onActivateResolvedLink: (link: KnowledgeResolvedLink) => void;
  onActivateDestination: (destination: unknown) => void;
  onStatus: (status: KnowledgePdfPageStatus) => void;
};
```

- [ ] **Step 1: Write failing page-unit tests**

Cover canvas dimensions/device pixel ratio, text-layer rendering, annotation/link rendering, `render=false` producing only a shell, page-local error/retry, and cleanup cancellation.

```tsx
it('cancels stale render tasks when scale changes', async () => {
  const { rerender } = renderPage({ scale: 1 });
  rerender(page({ scale: 1.25 }));
  expect(firstRenderTask.cancel).toHaveBeenCalledOnce();
  expect(secondPage.getViewport).toHaveBeenCalledWith({ scale: 1.25 });
});
```

- [ ] **Step 2: Run page tests and verify RED**

```bash
node scripts/run-renderer-tests.mjs KnowledgePdfPage.test.tsx KnowledgePdfViewer.test.tsx KnowledgeLinkLayer.test.tsx
```

Expected: page component is missing and rendering is embedded in the viewer.

- [ ] **Step 3: Move page rendering into `KnowledgePdfPage`**

Move the existing `getPage`, viewport, canvas, text-layer, annotations, and link-layer effect without changing security/link resolution. Keep a render generation/cancel flag so stale async completions cannot write to current refs. Call `page.cleanup()` only after active render/text/annotation work is cancelled or complete.

- [ ] **Step 4: Add page-local error and retry**

When `pdf.getPage()` or rendering fails, call `onStatus({ state: 'error', ... })` and render a compact `Retry page` control. Do not throw into the document-level error state. A changed `retryKey` reruns only that page.

- [ ] **Step 5: Replace the viewer's single page with the component**

Use `KnowledgePdfPage` with `render={Boolean(pdf)}` for Single mode. Keep current page, scale, target top, link callbacks, current-section behavior, and page status unchanged.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: extracted page tests and every pre-existing single-page viewer/link regression pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/features/knowledge/KnowledgePdfPage.tsx src/renderer/src/features/knowledge/__tests__/KnowledgePdfPage.test.tsx src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx src/renderer/src/features/knowledge/__tests__/KnowledgePdfViewer.test.tsx src/renderer/src/features/knowledge/KnowledgeLinkLayer.tsx
git commit -m "refactor(knowledge): extract cancellable PDF page rendering"
```

---

### Task 3: Track Visible Pages and Bounded Overscan

**Files:**

- Create: `src/renderer/src/features/knowledge/useContinuousPdfPages.ts`
- Create: `src/renderer/src/features/knowledge/__tests__/useContinuousPdfPages.test.tsx`

**Interfaces:**

```ts
export type ContinuousPdfPageVisibility = {
  currentPageIndex: number;
  renderPageIndices: ReadonlySet<number>;
  registerPage: (pageIndex: number) => (node: HTMLElement | null) => void;
  scrollToPage: (pageIndex: number, top?: number | null) => void;
};

export function useContinuousPdfPages(options: {
  active: boolean;
  pageCount: number;
  rootRef: React.RefObject<HTMLDivElement | null>;
  initialPageIndex: number;
  overscanPages?: number;
  reducedMotion: boolean;
}): ContinuousPdfPageVisibility;
```

- [ ] **Step 1: Write failing observer tests**

Install a deterministic `IntersectionObserver` test double. Test that the greatest intersection ratio becomes current, equal ratios choose the smaller page index, one visible page renders ±2 overscan pages, bounds clamp at first/last page, inactive mode disconnects, and `scrollToPage` targets the registered shell.

```ts
observer.emit([
  entry(page0, 0.25),
  entry(page1, 0.8),
  entry(page2, 0.4),
]);
expect(result.current.currentPageIndex).toBe(1);
expect([...result.current.renderPageIndices]).toEqual([0, 1, 2, 3]);
```

- [ ] **Step 2: Run hook tests and verify RED**

```bash
node scripts/run-renderer-tests.mjs useContinuousPdfPages.test.tsx
```

Expected: hook is missing.

- [ ] **Step 3: Implement one observer rooted on the viewer**

Register page shells in a `Map<number, HTMLElement>`. Observe/unobserve on ref changes. Store intersection ratios in a ref and update React state only when the effective current/render set changes. Use default overscan `2`.

- [ ] **Step 4: Implement deterministic scrolling**

Scroll the root to `shell.offsetTop + scaledTargetOffset - 28`, clamped at zero. Use `behavior: reducedMotion ? 'auto' : 'smooth'`. Do not call global page scrolling.

- [ ] **Step 5: Run hook tests and verify GREEN**

Run the Step 2 command. Expected: all observer, overscan, disconnect, and scroll tests pass without timers.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/features/knowledge/useContinuousPdfPages.ts src/renderer/src/features/knowledge/__tests__/useContinuousPdfPages.test.tsx
git commit -m "feat(knowledge): track visible PDF pages with overscan"
```

---

### Task 4: Compose the Continuous PDF Surface

**Files:**

- Create: `src/renderer/src/features/knowledge/KnowledgeContinuousPdf.tsx`
- Create: `src/renderer/src/features/knowledge/__tests__/KnowledgeContinuousPdf.test.tsx`
- Modify: `src/renderer/src/features/knowledge/knowledge.css`

**Interfaces:**

```ts
export type KnowledgeContinuousPdfHandle = {
  scrollToPage(pageIndex: number, top?: number | null): void;
};

type KnowledgeContinuousPdfProps = {
  pdf: PDFDocumentProxy;
  scale: number;
  activePageIndex: number;
  target: KnowledgeViewerTarget | null;
  focusRequestKey: number;
  resolveUrl: KnowledgePdfPageProps['resolveUrl'];
  onActivateResolvedLink: KnowledgePdfPageProps['onActivateResolvedLink'];
  onActivateDestination: KnowledgePdfPageProps['onActivateDestination'];
  onCurrentPageChange: (pageIndex: number) => void;
};
```

- [ ] **Step 1: Write failing composition tests**

Test one shell per PDF page, only overscan pages receiving `render=true`, stable placeholder dimensions, current-page callback, target-page scrolling, zoom recomputing dimensions, page-local retry isolation, and a 200-page fixture rendering at most five pages with default overscan.

- [ ] **Step 2: Run component tests and verify RED**

```bash
node scripts/run-renderer-tests.mjs KnowledgeContinuousPdf.test.tsx KnowledgePdfPage.test.tsx
```

Expected: continuous component is missing.

- [ ] **Step 3: Load and cache page metrics**

For every page, load only the natural viewport metadata needed for aspect ratio. Bound metadata reads with a small concurrency pool (for example four) so a large document does not request every page simultaneously. Store `{ width, height }` by page index and derive scaled shell size. Use a default letter-size aspect placeholder until metadata arrives so the viewport remains stable.

- [ ] **Step 4: Render lightweight shells and lazy page units**

Map page indices to `.knowledge-page-shell` elements registered with `useContinuousPdfPages`. Mount `KnowledgePdfPage` only for `renderPageIndices`; other shells render a page number/loading placeholder at the same measured size.

```tsx
<div
  ref={registerPage(pageIndex)}
  className="knowledge-page-shell"
  data-page-index={pageIndex}
  style={{ width: metric.width * scale, minHeight: metric.height * scale }}
>
  {renderPageIndices.has(pageIndex) ? <KnowledgePdfPage {...pageProps} /> : <PagePlaceholder />}
</div>
```

- [ ] **Step 5: Add bounded internal scrolling CSS**

The viewport must have `min-height: 0`, `overflow: auto`, and a column layout with a clear page gap. Viewer/grid ancestors must also have `min-height: 0` and `overflow: hidden` where required so page shells cannot expand the app shell. Do not customize scrollbar appearance.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: bounded rendering, metrics, scrolling, retry, and large-document tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/features/knowledge/KnowledgeContinuousPdf.tsx src/renderer/src/features/knowledge/__tests__/KnowledgeContinuousPdf.test.tsx src/renderer/src/features/knowledge/knowledge.css
git commit -m "feat(knowledge): render PDFs in a continuous viewport"
```

---

### Task 5: Integrate Both Modes and Preserve Navigation State

**Files:**

- Modify: `src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx`
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgePdfViewer.test.tsx`
- Modify: `src/renderer/src/features/knowledge/knowledgePdfDestination.ts`
- Modify: `src/renderer/src/features/knowledge/__tests__/knowledgePdfDestination.test.ts`
- Modify: `src/renderer/src/features/knowledge/knowledge.css`

**Interfaces:**

- `KnowledgePdfViewer` owns one `currentPageIndex` shared across both modes.
- Continuous current-page changes update toolbar/status/section; Single changes update Continuous's next initial/scroll target.
- Consumes `loadKnowledgePdfViewMode()` and `persistKnowledgePdfViewMode()` from Task 1.

- [ ] **Step 1: Write failing mode-preservation tests**

Cover a unique `View: Continuous` pressed control on first render, persisted `View: Single page` state after activation, page-status updates from observer, previous/next scrolling, switching Continuous → Single on the most visible page, switching Single → Continuous and scrolling to the same page, outline target top, authored internal destination, relative document link, zoom, and fit width without a second PDF fetch.

```tsx
expect(api.getKnowledgePdf).toHaveBeenCalledTimes(1);
observer.showPage(4);
await user.click(screen.getByRole('button', { name: 'View: Continuous' }));
expect(screen.getByLabelText('Page 5')).toBeVisible();
expect(api.getKnowledgePdf).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run viewer tests and verify RED**

```bash
node scripts/run-renderer-tests.mjs \
  KnowledgePdfViewer.test.tsx \
  KnowledgeContinuousPdf.test.tsx \
  knowledgePdfDestination.test.ts \
  KnowledgeLinkLayer.test.tsx
```

Expected: mode control does not yet switch rendering/current page.

- [ ] **Step 3: Share document and current-page state**

Initialize mode from `loadKnowledgePdfViewMode()`, persist every explicit change, and render the toolbar control with the visible label `View: Continuous` or `View: Single page` plus `aria-pressed`. Keep the existing document fetch/load effect above the mode branch. Render `KnowledgeContinuousPdf` for Continuous and `KnowledgePdfPage` for Single. Update one `pageIndex` from observer or single controls. Do not create a second `getDocument()` task on mode change.

- [ ] **Step 4: Synchronize mode transitions**

Before switching to Single, accept the latest Continuous current page. After switching to Continuous, call the continuous handle's `scrollToPage(pageIndex, target?.top)` after shells register. Clear a consumed target only after the target page reports ready and the requested focus is applied.

- [ ] **Step 5: Unify toolbar controls**

Previous/next calls `scrollToPage()` in Continuous and sets page state in Single. Fit width uses the current page natural width and viewer client width. Zoom changes shared scale. Current section derives from the most recent page/target and continues to announce page status politely.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command plus the full existing Knowledge reader suite:

```bash
node scripts/run-renderer-tests.mjs \
  KnowledgeTab.test.tsx \
  KnowledgeTree.test.tsx \
  KnowledgePdfViewer.test.tsx \
  KnowledgePdfPage.test.tsx \
  KnowledgeContinuousPdf.test.tsx \
  KnowledgeLinkLayer.test.tsx \
  knowledgeLinkResolver.test.ts \
  knowledgePdfDestination.test.ts
```

Expected: all pass and PDF transport is called once per document/checksum selection.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/features/knowledge
git commit -m "feat(knowledge): switch between continuous and single-page reading"
```

---

### Task 6: Verify Performance, Accessibility, Offline Reading, and Layout

**Files:**

- Modify: `src/renderer/src/features/knowledge/knowledge.css`
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgePdfViewer.test.tsx`
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgeContinuousPdf.test.tsx`
- Modify: `tests/e2e/critical-path.spec.ts`
- Modify: `docs/DESIGN.md`
- Modify: `docs/architecture.md`

**Interfaces:**

- Produces browser evidence that the viewer is internally scrollable and mode switching is accessible and stable.

- [ ] **Step 1: Add failing performance/accessibility assertions**

Add tests for `aria-pressed`/mode name, keyboard activation, focus retention, reduced-motion scroll behavior, page-local live error, offline cached PDF in both modes, and the bounded rendered-page count after simulated scrolling through a large document.

- [ ] **Step 2: Add a real E2E PDF flow**

In the critical path, open a multi-page seeded Wiki PDF, assert `scrollHeight > clientHeight` in Continuous mode, scroll until page 2 becomes current, switch to Single and confirm Page 2 remains, switch back and confirm the viewer returns to Page 2, then exercise one internal/relative or guarded web link already covered by the fixture.

- [ ] **Step 3: Run the focused E2E slice and verify RED**

Run the existing Electron/browser test command filtered to the PDF reader cases. Expected: failures identify any real-layout difference not visible in jsdom.

- [ ] **Step 4: Apply final responsive and control polish**

Keep the mode control readable at normal widths, collapse secondary controls at narrow widths using existing responsive conventions, preserve at least 4.5:1 text contrast, ensure page shells never exceed the viewer width after fit, and ensure no page/toolbar text overflows. Keep transitions within 150–250 ms and disabled in reduced motion.

- [ ] **Step 5: Update documentation**

Document the shared PDF lifetime, page-unit boundary, IntersectionObserver root, overscan count `2`, page metrics, local preference key, mode-preservation contract, and page-local failure recovery.

- [ ] **Step 6: Run all final gates**

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Browser verification must prove:

```text
Default mode: Continuous
Viewer: scrollHeight > clientHeight for a multi-page PDF
Rendered canvases: visible pages plus at most two pages on either side
Mode switch: preserves current page
PDF fetch/load: not repeated solely because mode changed
Single page: existing text and link behavior retained
Offline cached PDF: readable in both modes
Console errors: none
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/features/knowledge tests/e2e/critical-path.spec.ts docs/DESIGN.md docs/architecture.md
git commit -m "test(knowledge): verify continuous PDF reading"
```

---

## Final Completion Gate

The complete approved change set is ready only when:

- every phase completion gate in all three plans passes;
- the full test, typecheck, lint, and build gates pass from the final branch tip;
- the copied existing-install migration proves Ryan Owner and Charles Administrator without credential/device loss;
- the browser shows Knowledge → Wiki/Contacts/Servers in the approved layout;
- standalone Notes and live Operators are absent while contextual/historical data remains;
- Continuous and Single page PDF modes both work with preserved navigation and bounded rendering; and
- the final branch is reviewed before any push to `origin/test`.
