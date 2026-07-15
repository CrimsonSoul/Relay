# Knowledge Base PDF Link Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ordinary same-document, cross-PDF, and web links inside Relay Knowledge Base PDFs usable without exposing arbitrary local-file access or weakening the existing read-only Focus Reader.

**Architecture:** PDF.js continues to render only the canvas and selectable text, while a narrow Relay-owned overlay turns supported link annotations into positioned buttons. A pure renderer resolver maps authored PDF filenames and relative paths only against the already-indexed `knowledge_documents` metadata; same-document destinations stay in the current PDF.js instance; web links cross a new Knowledge-only typed preload channel whose main-process handler accepts only bounded credential-free HTTP(S) URLs. No link target is persisted, no PocketBase schema changes, and no embedded path is ever opened or read from disk.

**Tech Stack:** Electron 42, TypeScript 6, React 19, PDF.js (`pdfjs-dist` 5.4.624), PocketBase 0.26 metadata, Vitest, Testing Library, Playwright Electron, existing Relay Toast and design tokens.

## Global Constraints

- Preserve the existing server/client authentication, PocketBase metadata sync, protected PDF transport, on-demand cache, offline-open behavior, and read-only collection rules.
- Treat `file:` URLs, Windows paths, POSIX paths, and relative paths as metadata-only strings. Never pass them to `openPath`, `openExternal`, `fetch`, `fs`, or a URL probe.
- Do not broaden `IPC_CHANNELS.OPEN_EXTERNAL` or its provider allowlist. Knowledge web links get a dedicated handler and typed result.
- Accept only explicit operator clicks. Do not auto-open a URL during PDF load, page render, annotation extraction, document selection, or realtime refresh.
- Keep PDF.js evaluation, XFA, auto-fetch, streaming, and full annotation UI disabled. Render only Relay-owned link buttons; forms, attachments, launch actions, media, JavaScript, and named application actions remain blocked.
- Use test-driven development for every task: add the focused failing test, run it and confirm the expected failure, add the smallest implementation, and rerun the focused test.
- Use Relay's current product register: precise, dark, tactile, restrained. Preserve the authored PDF appearance at rest; use existing accent/focus tokens only for hover and keyboard focus. Do not add cards, decorative glow, new toolbar chrome, or gratuitous motion.
- Keep controls keyboard accessible and screen-reader labelled. Unsupported protocols are not focusable; missing or ambiguous PDF targets remain user-activatable only so Relay can explain the problem through the existing toast surface.
- Use `apply_patch` for source edits, preserve unrelated worktree changes, and commit each coherent task only after its focused tests pass.

---

## File Structure

### Shared contracts and preload

- Modify `src/shared/knowledge.ts` with the link-length limit and typed Knowledge web-open result.
- Modify `src/shared/ipc.ts` with `KNOWLEDGE_OPEN_WEB_LINK` and `BridgeAPI.openKnowledgeWebLink()`.
- Modify `src/preload/index.ts` with the one new invoke-only bridge method.
- Create `src/preload/index.test.ts` to prove the preload surface uses only the dedicated channel.

### Main process

- Create `src/main/knowledge/knowledgeWebLinks.ts` for bounded HTTP(S)-only URL normalization.
- Create `src/main/knowledge/knowledgeWebLinks.test.ts` for protocol, credentials, control-character, hostname, and length cases.
- Modify `src/main/handlers/knowledgeHandlers.ts` to register the trusted, rate-limited, typed web-open handler.
- Modify `src/main/handlers/knowledgeHandlers.test.ts` for trusted-sender, rate-limit, validation, shell success, and shell failure coverage.
- Leave `src/main/handlers/windowHandlers.ts` and its general `OPEN_EXTERNAL` policy unchanged.

### Renderer

- Create `src/renderer/src/features/knowledge/knowledgeLinkResolver.ts` for deterministic URL/path classification and indexed-metadata resolution.
- Create `src/renderer/src/features/knowledge/__tests__/knowledgeLinkResolver.test.ts` for filename, relative-path, duplicate, page-fragment, and blocked-scheme cases.
- Create `src/renderer/src/features/knowledge/knowledgePdfDestination.ts` for native PDF destination resolution.
- Create `src/renderer/src/features/knowledge/__tests__/knowledgePdfDestination.test.ts` for named/direct destination and bounds cases.
- Create `src/renderer/src/features/knowledge/KnowledgeLinkLayer.tsx` for annotation narrowing, rectangle projection, accessible link buttons, and activation.
- Create `src/renderer/src/features/knowledge/__tests__/KnowledgeLinkLayer.test.tsx` for filtering, alignment, labels, keyboard behavior, and unsupported actions.
- Modify `src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx` to fetch display annotations, render/cancel the overlay, resolve native destinations, and restore focus.
- Modify `src/renderer/src/features/knowledge/KnowledgeTab.tsx` to resolve cross-PDF/web actions, switch documents, set page targets, and show bounded errors.
- Modify the existing viewer/tab tests and `src/renderer/src/features/knowledge/knowledge.css`.

### Integration fixtures and documentation

- Create `tests/fixtures/knowledgePdfFixtures.ts` with deterministic local PDF builders containing safe link annotations.
- Modify `tests/e2e/critical-path.spec.ts` with a client/server Knowledge link critical path and a mocked Electron shell boundary.
- Modify `README.md`, `docs/SECURITY.md`, and `docs/architecture.md` with authoring, trust-boundary, and runtime-flow documentation.

---

## Task 1: Resolve Authored PDF Links Against Indexed Metadata

**Files:**

- Create: `src/renderer/src/features/knowledge/knowledgeLinkResolver.ts`
- Create: `src/renderer/src/features/knowledge/__tests__/knowledgeLinkResolver.test.ts`
- Modify: `src/shared/knowledge.ts`
- Modify: `src/shared/knowledge.test.ts`

- [ ] Add failing shared tests for a fixed `KNOWLEDGE_MAX_LINK_URL_LENGTH` of 4,096 characters.
- [ ] Add failing renderer tests for all approved resolution cases: unique filename across categories, a moved unique file, duplicate filename disambiguated by `../Category/File.pdf`, Windows backslashes, URL-encoded spaces, absolute Windows/POSIX paths, `file:` URLs, valid/invalid/out-of-range `#page=N`, query-string ignoring, current-document fragments, missing targets, ambiguous duplicates, traversal above the indexed root, non-PDF files, malformed URLs, and unsupported schemes.
- [ ] Run:

```bash
node scripts/run-renderer-tests.mjs src/renderer/src/features/knowledge/__tests__/knowledgeLinkResolver.test.ts
```

Expected: FAIL because `knowledgeLinkResolver.ts` does not exist.

- [ ] Add the shared limit:

```ts
export const KNOWLEDGE_MAX_LINK_URL_LENGTH = 4_096;
```

- [ ] Implement this exact renderer result model:

```ts
export type KnowledgeLinkUnavailableReason = 'not-found' | 'ambiguous' | 'unsupported';

export type KnowledgeResolvedLink =
  | { kind: 'same-document'; pageIndex: number }
  | { kind: 'knowledge-document'; documentId: string; title: string; pageIndex: number }
  | { kind: 'web'; url: string; hostname: string }
  | { kind: 'unavailable'; reason: KnowledgeLinkUnavailableReason };

export type ResolveKnowledgeLinkInput = {
  rawUrl: string;
  currentDocument: KnowledgeDocumentRecord;
  documents: readonly KnowledgeDocumentRecord[];
};

export function resolveKnowledgeLink(input: ResolveKnowledgeLinkInput): KnowledgeResolvedLink;
```

- [ ] Keep classification deterministic and side-effect free. Use these stages in order:

```ts
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

// 1. Reject non-string, empty, control-character, and oversized input.
// 2. `#page=N` is a same-document link.
// 3. Absolute `http:`/`https:` is a web link; preserve it for main-process revalidation.
// 4. `file:` supplies only its decoded pathname; any other explicit scheme is unsupported.
// 5. Strip query text, parse `#page=N`, decode once, and replace `\\` with `/`.
// 6. Require a final case-insensitive `.pdf` filename.
// 7. Match `fileName` with normalizeKnowledgeSearchText().
// 8. A unique filename wins even after the indexed file moves categories.
// 9. For duplicates only, resolve a genuinely relative authored path from the
//    current document's sourceKey directory and compare normalized sourceKey.
// 10. Never use an absolute author path to disambiguate duplicate filenames.
```

- [ ] Implement page fragments as one-based author input converted to a zero-based page index. Return page 1 (`pageIndex: 0`) when the fragment is missing, malformed, less than 1, or greater than the target's `pageCount`.
- [ ] When the resolved record ID equals the current document ID, return `same-document` instead of reloading the PDF bytes.
- [ ] Implement relative-path normalization without Node's `path` module. Collapse `.` segments, resolve `..` segments only while an indexed source-key segment remains, and return `unavailable/unsupported` when traversal attempts to leave the virtual Knowledge root.
- [ ] Do not call browser navigation, preload, filesystem, `fetch`, or PocketBase from this module.
- [ ] Rerun the focused resolver test and `npx vitest run src/shared/knowledge.test.ts`.
- [ ] Run `npm run typecheck`.
- [ ] Commit with `feat(knowledge): resolve authored PDF links`.

## Task 2: Add a Dedicated HTTP(S)-Only Knowledge Web Bridge

**Files:**

- Create: `src/main/knowledge/knowledgeWebLinks.ts`
- Create: `src/main/knowledge/knowledgeWebLinks.test.ts`
- Create: `src/preload/index.test.ts`
- Modify: `src/shared/knowledge.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/handlers/knowledgeHandlers.ts`
- Modify: `src/main/handlers/knowledgeHandlers.test.ts`

- [ ] Add failing policy tests that accept ordinary `https://docs.example.com/runbook` and `http://intranet.example.local/status`, normalize host casing, and reject `file:`, `javascript:`, `data:`, `blob:`, `ftp:`, relative URLs, missing hosts, embedded username/password, leading/trailing whitespace, control characters, malformed values, non-strings, and strings longer than 4,096 characters.
- [ ] Add a typed result to `src/shared/knowledge.ts`:

```ts
export type KnowledgeOpenWebLinkError =
  | 'invalid-url'
  | 'rate-limited'
  | 'open-failed';

export type KnowledgeOpenWebLinkResult =
  | { ok: true }
  | { ok: false; error: KnowledgeOpenWebLinkError };
```

- [ ] Implement the pure validator:

```ts
export function normalizeKnowledgeWebUrl(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > KNOWLEDGE_MAX_LINK_URL_LENGTH ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
```

- [ ] Run `npx vitest run src/main/knowledge/knowledgeWebLinks.test.ts` and confirm the policy tests pass before wiring Electron.
- [ ] Add the dedicated contract only:

```ts
// BridgeAPI
openKnowledgeWebLink: (url: string) => Promise<KnowledgeOpenWebLinkResult>;

// IPC_CHANNELS
KNOWLEDGE_OPEN_WEB_LINK: 'knowledge:openWebLink',
```

- [ ] Expose it in preload only through `ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_OPEN_WEB_LINK, url)`. Do not alias it to `openExternal` and do not expose Electron `shell`.
- [ ] In `src/preload/index.test.ts`, mock `contextBridge`/`ipcRenderer`, import the preload module after the mocks, capture the exposed `BridgeAPI`, invoke `openKnowledgeWebLink`, and assert the exact dedicated channel and URL argument.
- [ ] Add failing handler tests for untrusted sender, exhausted `rateLimiters.fsOperations`, invalid input, valid HTTP/HTTPS, `shell.openExternal` rejection, and a thrown shell error. Assert rejected values never reach `shell.openExternal`.
- [ ] Register the handler beside the existing Knowledge handlers:

```ts
ipcMain.handle(
  IPC_CHANNELS.KNOWLEDGE_OPEN_WEB_LINK,
  async (event, value: unknown): Promise<KnowledgeOpenWebLinkResult> => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.KNOWLEDGE_OPEN_WEB_LINK)) {
      return { ok: false, error: 'invalid-url' };
    }
    if (!rateLimiters.fsOperations.tryConsume().allowed) {
      return { ok: false, error: 'rate-limited' };
    }
    const url = normalizeKnowledgeWebUrl(value);
    if (!url) {
      loggers.security.warn('Blocked unsupported Knowledge web link');
      return { ok: false, error: 'invalid-url' };
    }
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (error) {
      loggers.ipc.warn('Knowledge web link open failed', { error: getErrorMessage(error) });
      return { ok: false, error: 'open-failed' };
    }
  },
);
```

- [ ] Keep logs free of full URLs so query strings cannot leak into logs. If operational context is needed, log only the validated hostname.
- [ ] Do not edit `ALLOWED_EXTERNAL_HOSTS`, `isAllowedExternalUrl`, or the existing `OPEN_EXTERNAL` handler.
- [ ] Run:

```bash
npx vitest run src/main/knowledge/knowledgeWebLinks.test.ts src/main/handlers/knowledgeHandlers.test.ts src/preload/index.test.ts
npm run typecheck
```

- [ ] Commit with `feat(knowledge): add safe web link bridge`.

## Task 3: Extract and Render a Narrow Accessible Link Overlay

**Files:**

- Create: `src/renderer/src/features/knowledge/KnowledgeLinkLayer.tsx`
- Create: `src/renderer/src/features/knowledge/__tests__/KnowledgeLinkLayer.test.tsx`
- Modify: `src/renderer/src/features/knowledge/knowledge.css`

- [ ] Add failing component tests with small annotation-shaped objects for:
  - retaining only PDF.js link annotations with a four-number rectangle and either `dest`, `url`, or `unsafeUrl`;
  - preferring a native `dest` when an annotation also carries a URL;
  - ignoring named actions, launch actions, attachments, forms, JavaScript, and malformed rectangles;
  - using `viewport.convertToViewportRectangle()` and normalizing reversed coordinates;
  - recomputing geometry when the viewport changes;
  - preserving annotation order as keyboard tab order;
  - labelling internal links with document title/page and web links with hostname plus `Opens in browser`;
  - activating with Enter and Space through native `<button>` behavior; and
  - omitting `unavailable/unsupported` links from the focus order while leaving missing/ambiguous PDF targets activatable for a toast.
- [ ] Run:

```bash
node scripts/run-renderer-tests.mjs src/renderer/src/features/knowledge/__tests__/KnowledgeLinkLayer.test.tsx
```

Expected: FAIL because `KnowledgeLinkLayer.tsx` does not exist.

- [ ] Implement narrow local types rather than consuming PDF.js's full annotation layer:

```ts
export type KnowledgePdfDestination = string | unknown[];

export type KnowledgeLinkItem = {
  id: string;
  rect: readonly [number, number, number, number];
  action:
    | { kind: 'destination'; destination: KnowledgePdfDestination }
    | { kind: 'url'; url: string };
};

export function extractKnowledgeLinkItems(annotations: readonly unknown[]): KnowledgeLinkItem[];
```

- [ ] Accept only `annotationType === AnnotationType.LINK` (with `subtype === 'Link'` as a compatibility fallback), a bounded string ID, and finite rectangle coordinates. For URL annotations, take the raw authored value from `unsafeUrl ?? url`; never set it as `href`, inject it as HTML, or navigate the renderer.
- [ ] Use this component boundary:

```ts
type KnowledgeLinkLayerProps = {
  items: readonly KnowledgeLinkItem[];
  viewport: PageViewport;
  resolveUrl: (url: string) => KnowledgeResolvedLink;
  onActivateResolvedLink: (link: KnowledgeResolvedLink) => void;
  onActivateDestination: (destination: KnowledgePdfDestination) => void;
};
```

- [ ] Render a button only for native destinations, supported web/internal links, and safe-but-unavailable PDF references. Skip `unavailable/unsupported` entirely. Use an internal guide label for PDF targets, `Open <title>, page <N>` when available, and `Open <hostname> in browser` for web targets.
- [ ] Add only these Focus Reader styles, using existing tokens:

```css
.knowledge-page__link-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}

.knowledge-page__link-target {
  position: absolute;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: transparent;
  pointer-events: auto;
  cursor: pointer;
}

.knowledge-page__link-target:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--accent-bright) 72%, transparent);
}

.knowledge-page__link-target:focus-visible {
  outline: 2px solid var(--accent-bright);
  outline-offset: 2px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
```

- [ ] Do not animate page geometry. Preserve the PDF at rest and honor Relay's existing focus contrast. Do not add full AnnotationLayer CSS, a tooltip framework, an external-link strip, or new toolbar controls.
- [ ] Rerun the focused layer tests, `npm run typecheck`, and `npm run lint -- --quiet` if supported; otherwise run `npm run lint`.
- [ ] Commit with `feat(knowledge): render PDF link overlay`.

## Task 4: Support Native Destinations and Cancellation-Safe Annotation Loading

**Files:**

- Create: `src/renderer/src/features/knowledge/knowledgePdfDestination.ts`
- Create: `src/renderer/src/features/knowledge/__tests__/knowledgePdfDestination.test.ts`
- Modify: `src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx`
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgePdfViewer.test.tsx`

- [ ] Add failing destination tests for a named destination, a direct destination array, an integer page reference, an object reference resolved by `getPageIndex`, `XYZ`, `FitH`, and `FitBH` top coordinates, null/unknown destination types, a missing named destination, thrown PDF.js lookups, negative pages, and pages beyond `pdf.numPages`.
- [ ] Implement a renderer-local destination helper with no IPC:

```ts
export type KnowledgeViewerTarget = {
  pageIndex: number;
  top: number | null;
};

export async function resolveKnowledgePdfDestination(
  pdf: Pick<PDFDocumentProxy, 'numPages' | 'getDestination' | 'getPageIndex'>,
  destination: KnowledgePdfDestination,
): Promise<KnowledgeViewerTarget | null>;
```

- [ ] Use the same PDF destination semantics as the server outline extractor: array element 0 is a zero-based integer page or PDF reference; `XYZ` reads top from element 3; `FitH`/`FitBH` read top from element 2. Bound the result to `0 <= pageIndex < pdf.numPages` and return `null` on lookup failure.
- [ ] Change the viewer's `target` prop from `KnowledgeOutlineNode | null` to `KnowledgeViewerTarget | null` so outline jumps, page fragments, cross-PDF links, and native destinations share one navigation type.
- [ ] Add the link callbacks without giving the viewer ownership of the whole library:

```ts
type Props = {
  document: KnowledgeDocumentRecord | null;
  active: boolean;
  target: KnowledgeViewerTarget | null;
  currentSection?: string | null;
  focusRequestKey?: number;
  resolveUrl: (url: string) => KnowledgeResolvedLink;
  onActivateResolvedLink: (link: KnowledgeResolvedLink) => void;
  onDestinationChange: (target: KnowledgeViewerTarget) => void;
  onPageChange: (pageIndex: number) => void;
};
```

- [ ] Extend the page-render effect to call `page.getAnnotations({ intent: 'display' })` alongside text extraction. Preserve the existing rule that `renderTask.promise` gets rejection observers immediately after `page.render()` and before awaiting text or annotations.
- [ ] Store only `{ pageIndex, viewport, items }` for the current render. Clear the overlay when document, page, scale, or active state changes. Check `disposed` before every state update so late annotation/text work cannot replace a newer page.
- [ ] Keep `annotationMode: 0`; the Relay overlay, not PDF.js's complete annotation layer, owns the link interaction.
- [ ] On a native destination click, await `resolveKnowledgePdfDestination(pdf, destination)`. If valid, call `onDestinationChange(target)`; if invalid, call `onActivateResolvedLink({ kind: 'unavailable', reason: 'unsupported' })` so the tab owns the blocked-link toast. Same-document clicks must not call `getKnowledgePdf` again.
- [ ] Add `tabIndex={-1}` to the viewer viewport and focus it after a cross-document `focusRequestKey` change once the requested page is rendered. Do not steal focus for ordinary page turns, zoom, realtime refresh, or initial tab load.
- [ ] Add focused viewer tests proving:
  - annotations are requested only for the active loaded page;
  - link geometry refreshes after zoom/page changes;
  - native destination navigation does not reload PDF bytes;
  - invalid destinations do not change page;
  - document/page/scale cleanup removes stale overlays;
  - interrupted render/annotation work produces no unhandled rejection; and
  - cross-document focus restoration lands on the viewer viewport.
- [ ] Run:

```bash
node scripts/run-renderer-tests.mjs \
  src/renderer/src/features/knowledge/__tests__/knowledgePdfDestination.test.ts \
  src/renderer/src/features/knowledge/__tests__/KnowledgePdfViewer.test.tsx
npm run typecheck
```

- [ ] Commit with `feat(knowledge): navigate PDF destinations`.

## Task 5: Integrate Cross-Document and Web Actions in the Focus Reader

**Files:**

- Modify: `src/renderer/src/features/knowledge/KnowledgeTab.tsx`
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgeTab.test.tsx`
- Modify: `src/renderer/src/features/knowledge/knowledge.css`

- [ ] Extend the mocked viewer in `KnowledgeTab.test.tsx` so tests can invoke `resolveUrl`, `onActivateResolvedLink`, and `onDestinationChange`. Mock `useToast()` with a stable `showToast` spy.
- [ ] Add failing tab tests for:
  - a unique PDF link selecting the target document and requested page;
  - a current-document page link keeping the same document selected;
  - a relative duplicate disambiguation opening the correct category record;
  - a missing target showing `Linked guide not found.`;
  - an ambiguous target showing `Multiple guides use this filename. Ask the document owner to qualify the category.`;
  - an unsupported safe-to-report link showing `Relay blocked an unsupported document link.` without IPC;
  - a web link invoking only `api.openKnowledgeWebLink()` after activation;
  - a failed web result showing `Relay could not open this website in the system browser.`; and
  - no link activation during component render, document selection, or status refresh.
- [ ] Run:

```bash
node scripts/run-renderer-tests.mjs src/renderer/src/features/knowledge/__tests__/KnowledgeTab.test.tsx
```

Expected: FAIL on the new callbacks and actions.

- [ ] Import `useToast`, bind `resolveKnowledgeLink()` to the selected document plus the complete unfiltered `documents` array, and keep search results out of resolution policy.
- [ ] Add one page-target helper to update section context consistently:

```ts
function headingForTarget(
  document: KnowledgeDocumentRecord,
  target: KnowledgeViewerTarget,
): KnowledgeOutlineNode | undefined {
  const exact = document.outline.find(
    (node) =>
      node.pageIndex === target.pageIndex &&
      (target.top === null || node.top === null || Math.abs(node.top - target.top) <= 2),
  );
  return exact;
}
```

- [ ] For `same-document`, set `{ pageIndex, top: null }`, clear the active heading unless an exact heading matches, and leave the current PDF loaded.
- [ ] For `knowledge-document`, clear the drawer query, select the target ID from the already-loaded metadata, set its page target, derive any exact current section, clear the removed-document state, and increment `focusRequestKey`. Do not fetch a path or mutate PocketBase.
- [ ] For `web`, call only `globalThis.api.openKnowledgeWebLink(link.url)` and inspect its typed result. Do not fall back to `openExternal`, `window.open`, `location`, anchor navigation, or an iframe.
- [ ] Map unavailable reasons to the exact approved toast copy. Invalid page fragments are not errors; they already arrive as page 1.
- [ ] When no extracted heading exactly matches a destination, pass `Document section` as the viewer's current section. Preserve the existing nearest-heading behavior for manual previous/next page controls.
- [ ] Ensure a selected document removed during realtime sync still clears safely and that a pending link action cannot resurrect it.
- [ ] Rerun the tab test plus all Knowledge renderer tests:

```bash
node scripts/run-renderer-tests.mjs src/renderer/src/features/knowledge/__tests__
npm run typecheck
```

- [ ] Commit with `feat(knowledge): open linked guides and websites`.

## Task 6: Add Deterministic Linked-PDF Integration Coverage and Author Docs

**Files:**

- Create: `tests/fixtures/knowledgePdfFixtures.ts`
- Modify: `tests/e2e/critical-path.spec.ts`
- Modify: `README.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/architecture.md`

- [ ] Build deterministic PDFs in TypeScript using the repository's existing small-object/xref pattern from `knowledgeExtractor.test.ts`. The fixture builder must emit valid PDF link annotations without scripts or external dependencies:

```ts
export type KnowledgePdfFixtureLink =
  | { kind: 'uri'; label: string; uri: string }
  | { kind: 'destination'; label: string; pageIndex: number; top: number };

export function buildKnowledgePdfFixture(input: {
  title: string;
  pageCount: number;
  links?: KnowledgePdfFixtureLink[];
}): Uint8Array;
```

- [ ] Give each generated page its own content stream and object reference; place `/Subtype /Link` annotations in non-overlapping rectangles whose visible text matches the link label. Escape PDF literal-string `\`, `(`, and `)` characters and calculate xref offsets from `Buffer.byteLength`.
- [ ] In the E2E `beforeEach`, use `testInfo.title` to create fixtures only for the Knowledge link test before `launchServer()`:

```ts
if (testInfo.title.includes('Knowledge PDF links')) {
  writeKnowledgeLinkFixtures(path.join(tempDataDir, 'data', 'knowledge-base'));
}
```

- [ ] Seed at least:
  - `General/Link navigation test.pdf` with a page-2 same-document destination;
  - a relative link to `../Platform operations/Payment API Degradation Guide.pdf#page=2`;
  - an absolute `file:///C:/Users/Author/Documents/Checkout%20Service%20Incident%20Runbook.pdf` link whose target filename is unique;
  - an `https://example.com/relay-knowledge-test` link; and
  - the two target PDFs, including a two-page Payment guide.
- [ ] Add a Playwright Electron test that launches a connected client, waits for Knowledge metadata, opens the source PDF, activates the same-document link and observes page 2 without a document change, activates the relative link and observes the target title/page 2, returns to the source, activates the absolute `file:` link and observes the unique indexed target, and confirms no author path appears in renderer text/log UI.
- [ ] Before activating the web fixture, replace only the Electron test process's `shell.openExternal` method through `electronApp.evaluate`, store received URLs in a test-only global, click the overlay button in the renderer, and poll the global for the normalized HTTPS URL. Restore/close the app in the existing teardown. Production code must not contain an E2E bypass.
- [ ] Run the targeted integration test:

```bash
npm run build
npm run test:electron -- --grep "Knowledge PDF links"
```

Expected: PASS with the server/client path, protected PDF download, renderer overlay, and mocked system-browser boundary all exercised.

- [ ] Extend `README.md` after the existing Knowledge setup text with an `Authoring links` subsection:
  - use ordinary Insert Link in Word/Acrobat;
  - prefer unique PDF filenames;
  - relative paths disambiguate duplicate filenames;
  - `#page=N` is optional and one-based;
  - absolute author paths are treated only as filenames;
  - HTTP(S) opens in the managed system browser; and
  - renamed target PDFs require author link updates.
- [ ] Update `docs/SECURITY.md` to replace the old blanket "no annotations/external links" statement with the narrow link-overlay boundary, metadata-only `file:` handling, trusted/rate-limited HTTP(S)-only IPC, credential rejection, and unchanged general `OPEN_EXTERNAL` allowlist.
- [ ] Update `docs/architecture.md` with this runtime branch:

```text
PDF link annotation
  -> Relay overlay
     -> native destination -> current PDF.js document
     -> PDF filename/path -> indexed metadata -> selected Relay guide
     -> HTTP(S) -> dedicated preload IPC -> main validation -> system browser
```

- [ ] Format only the changed fixture, E2E, and documentation files:

```bash
npx prettier --write \
  tests/fixtures/knowledgePdfFixtures.ts \
  tests/e2e/critical-path.spec.ts \
  README.md \
  docs/SECURITY.md \
  docs/architecture.md
```
- [ ] Commit with `test(knowledge): cover linked PDF navigation`.

## Task 7: Complete Regression, Security, and Visual Verification

**Files:**

- Review all files changed by Tasks 1–6.
- Modify only files required by findings from the checks below.

- [ ] Run the focused security boundary suites and confirm the existing general policy tests still pass:

```bash
npx vitest run \
  src/main/knowledge/knowledgeWebLinks.test.ts \
  src/main/handlers/knowledgeHandlers.test.ts \
  src/main/handlers/windowHandlers.test.ts \
  src/preload/index.test.ts
```

- [ ] Run the complete renderer Knowledge suite:

```bash
node scripts/run-renderer-tests.mjs src/renderer/src/features/knowledge/__tests__
```

- [ ] Run the full static and build gates:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build
```

- [ ] Run all test layers. `test:electron` already rebuilds `better-sqlite3` for Electron and restores the current Node ABI afterward:

```bash
npm test
npm run test:electron
```

- [ ] Launch Relay with an isolated test profile containing the linked PDFs. Inspect at 100%, zoomed out, zoomed in, and Fit width. Verify hit rectangles stay aligned; the PDF remains visually unchanged at rest; hover/focus use restrained Relay accent treatment; controls do not clip at 1280×800, 1366×768, and 1600×1000; and no tooltip/card/chrome was introduced.
- [ ] Keyboard-walk every visible link in page order. Verify visible focus, Enter/Space activation, external-link accessible copy, viewer focus restoration after cross-document navigation, and no focusable target for unsupported protocols.
- [ ] Disconnect a client after opening one fixture and verify the cached PDF plus its same-document links remain usable. Verify a link to an uncached PDF shows the existing offline-unavailable document state without corrupting selection or metadata.
- [ ] Review the final diff specifically for forbidden sinks: no `openPath` call from Knowledge annotations, no `window.open`, no renderer `location` write, no `<a href={rawPdfValue}>`, no `fetch(rawPdfValue)`, no filesystem call using embedded paths, no expansion of `ALLOWED_EXTERNAL_HOSTS`, and no full external URLs in logs.
- [ ] Use `superpowers:requesting-code-review` on the complete change. Address only evidence-backed findings, rerun the affected focused tests, and then rerun the complete verification gate.
- [ ] Run `git status --short`, `git diff --check`, and inspect `git diff --stat` plus the committed diff. Confirm only intended Knowledge, test, and documentation files changed.
- [ ] Commit any review fixes with `fix(knowledge): harden PDF link navigation` only if a fix was necessary. Do not create an empty commit.

## Acceptance Checklist

- [ ] A normal Word/Acrobat link to a uniquely named indexed PDF opens inside Relay without a record ID or server path.
- [ ] An absolute path from the author's computer is reduced to an indexed filename and never accessed on the operator workstation.
- [ ] Moving a uniquely named target between categories does not break the link; renaming it does.
- [ ] Duplicate filenames are opened only when a safe relative source-key match is unique; Relay never guesses.
- [ ] Same-document/native destinations and valid page fragments navigate without reloading PDF bytes.
- [ ] Invalid page fragments open page 1 without an error.
- [ ] Web links open only after a click, through the dedicated HTTP(S)-only trusted/rate-limited main-process boundary.
- [ ] Unsupported actions and protocols cannot access disk, execute content, navigate the renderer, invoke the general external handler, or reach Electron shell.
- [ ] Overlay targets remain aligned at every supported zoom level and are keyboard accessible with Relay-consistent hover/focus treatment.
- [ ] Client/server sync, protected PDF transport, offline cache behavior, read-only permissions, and existing external-link policies remain unchanged.
