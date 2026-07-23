# Wiki Upload Recovery and Cover Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Workspace override:** Relay's personal policy requires the primary agent to implement an approved plan inline in the current session. Do not dispatch subagents or invoke an execution workflow unless the user explicitly requests it.

**Goal:** Let publishers discard staged uploads, keep duplicate conflicts current after document deletion, make Windows management dropdowns legible, and ship the approved exact-ratio Relay hybrid SOP cover treatment.

**Architecture:** Keep existing upload and document commands authoritative. Derive current duplicate conflicts when the main process builds each management snapshot, refresh renderer state after upload cancellation, and keep the renderer responsible only for confirmation and presentation. Extend the existing lazy cover hook with intrinsic dimensions so `KnowledgeSopCard` can keep stable fallback geometry and switch to the real PDF ratio only after a successful image load.

**Tech Stack:** TypeScript 6, React 19, Electron, PocketBase, Vitest 4, Testing Library, CSS

## Global Constraints

- Preserve current protected-management permissions, resumable upload protocol, publish/replace behavior, document lifecycle, audit history, and existing clients.
- Reuse `knowledge.upload.file.cancel`; do not add an IPC command, collection, permission, migration, or audit-event type.
- Discarded uploads do not enter published-document Trash and cannot be recovered through Trash.
- Resolve duplicates from exact filenames of documents whose `lifecycleState` is `active`; server mutation checks remain authoritative.
- Keep uploaded PDF cover artwork untouched: no recoloring, cropping, stretching, or regeneration.
- Direction D is authoritative: exact-ratio and undecorated at rest, with only a narrow neutral paper edge, quiet shadow, and two-to-three-pixel lift on hover/focus.
- Keep Relay accent use on the card border/focus ring; do not tint the PDF artwork.
- Keep the `3 / 4` cover ratio as the loading/error fallback and honor reduced motion.
- Use genuine red-green TDD for every behavior slice.

---

## File Map

- `src/main/knowledge/ManagedKnowledgeService.ts` — derive current upload duplicate IDs from the active document set while building snapshots.
- `src/main/knowledge/__tests__/ManagedKnowledgeService.test.ts` — prove stale duplicate IDs are cleared and newly active matches are returned.
- `src/renderer/src/features/knowledge/useKnowledgeManagement.ts` — refresh the management snapshot and upload queue after successful single-upload cancellation.
- `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx` — expose and confirm Discard upload in Upload review, remove cancelled items, clear local draft state, and manage focus.
- `src/renderer/src/features/knowledge/__tests__/useKnowledgeManagement.test.tsx` — prove successful cancellation triggers authoritative refresh and failed cancellation does not hide state.
- `src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx` — prove duplicate ready uploads can be kept or discarded with accessible confirmation.
- `src/renderer/src/styles/components.css` — apply the dark native popup palette to every shared tactile select.
- `src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts` — guard Windows select colors.
- `src/renderer/src/features/knowledge/useKnowledgeCover.ts` — capture and reset valid natural image dimensions.
- `src/renderer/src/features/knowledge/KnowledgeSopCard.tsx` — apply the loaded cover ratio and add an isolated cover sheet for hover/focus depth.
- `src/renderer/src/features/knowledge/knowledge.css` — implement exact-ratio loaded shells, stable fallback shells, paper edge, shadow, focus parity, and reduced motion.
- `src/renderer/src/features/knowledge/__tests__/useKnowledgeCover.test.tsx` — prove intrinsic dimensions are recorded and reset.
- `src/renderer/src/features/knowledge/__tests__/KnowledgeCatalogStyles.test.ts` — guard the Relay hybrid resting and interaction treatment.
- `src/renderer/src/features/knowledge/__tests__/KnowledgeSopCard.test.tsx` — integration-test the natural ratio on the rendered card.

---

### Task 1: Make Snapshot Duplicate State Current

**Files:**

- Modify: `src/main/knowledge/ManagedKnowledgeService.ts:120-135`
- Modify: `src/main/knowledge/ManagedKnowledgeService.ts:194-240`
- Test: `src/main/knowledge/__tests__/ManagedKnowledgeService.test.ts`

**Interfaces:**

- Consumes: `StoredUploadRecord.fileName`, stored `duplicateDocumentId`, and the document views already returned by `readDocuments()`.
- Produces: `uploadView(upload, duplicateDocumentId)` where the second argument is `string | null` and defaults to the stored value outside snapshot composition.
- Produces: `KnowledgeManagementSnapshot.uploads.items[*].duplicateDocumentId` derived from current active documents.

- [ ] **Step 1: Write the failing snapshot regression**

Add this test beside the existing snapshot normalization test:

```ts
it('resolves upload filename conflicts from the current active document set', async () => {
  documents.getFullList.mockResolvedValueOnce([
    document({
      id: 'document-current',
      fileName: 'Replacement.pdf',
      lifecycleState: 'active',
    }),
    document({
      id: 'document-trashed',
      fileName: 'Trashed.pdf',
      lifecycleState: 'trashed',
    }),
  ]);
  uploads.getFullList.mockResolvedValueOnce([
    upload({
      id: 'upload-current',
      fileName: 'Replacement.pdf',
      duplicateDocumentId: 'document-stale',
    }),
    upload({
      id: 'upload-deleted',
      fileName: 'Deleted.pdf',
      duplicateDocumentId: 'document-deleted',
    }),
    upload({
      id: 'upload-trashed',
      fileName: 'Trashed.pdf',
      duplicateDocumentId: 'document-trashed',
    }),
  ]);

  const snapshot = await service().snapshot({
    accountId: ACTOR.accountId,
    query: '',
    cursor: null,
    pageSize: 25,
  });

  expect(
    snapshot.uploads.items.map(({ id, duplicateDocumentId }) => ({
      id,
      duplicateDocumentId,
    })),
  ).toEqual([
    { id: 'upload-current', duplicateDocumentId: 'document-current' },
    { id: 'upload-deleted', duplicateDocumentId: null },
    { id: 'upload-trashed', duplicateDocumentId: null },
  ]);
});
```

- [ ] **Step 2: Run the regression and verify red**

Run:

```bash
npx vitest run src/main/knowledge/__tests__/ManagedKnowledgeService.test.ts
```

Expected: FAIL because the snapshot still returns each stored `duplicateDocumentId`.

- [ ] **Step 3: Let `uploadView` accept an authoritative duplicate**

Change the helper to:

```ts
function uploadView(
  upload: StoredUploadRecord,
  duplicateDocumentId: string | null = upload.duplicateDocumentId || null,
): KnowledgeManagementUploadView {
  return {
    id: upload.id,
    requestId: upload.requestId,
    fileName: upload.fileName,
    byteSize: Number(upload.byteSize),
    checksum: upload.checksum,
    state: upload.state,
    progress: upload.progress,
    proposedTitle: upload.proposedTitle,
    proposedCategory: upload.proposedCategory,
    pageCount: upload.pageCount,
    outlineSource: upload.outlineSource || null,
    outlineCount: upload.outline.length,
    duplicateDocumentId,
    safeError: upload.safeError || null,
    expiresAt: upload.expiresAt,
    revision: Number(upload.revision),
  };
}
```

Preserve every existing field exactly; only the new parameter and `duplicateDocumentId` assignment change.

- [ ] **Step 4: Derive current duplicates in `snapshot()`**

After `documents` is available and before paginating uploads, add:

```ts
const activeDocumentIdByFilename = new Map(
  documents
    .filter(({ lifecycleState }) => lifecycleState === 'active')
    .map(({ fileName, id }) => [fileName, id]),
);
```

Map upload items with:

```ts
items: uploadItems.map((item) =>
  uploadView(item, activeDocumentIdByFilename.get(item.fileName) ?? null),
),
```

Do not mutate PocketBase records or persist the derived value.

- [ ] **Step 5: Run the focused main-process tests**

Run:

```bash
npx vitest run src/main/knowledge/__tests__/ManagedKnowledgeService.test.ts
```

Expected: PASS, including publish, replace, trash, restore, and permanent-delete coverage already in the file.

- [ ] **Step 6: Commit the slice**

```bash
git add src/main/knowledge/ManagedKnowledgeService.ts src/main/knowledge/__tests__/ManagedKnowledgeService.test.ts
git commit -m "fix: refresh wiki upload conflicts"
```

---

### Task 2: Add Confirmed Discard to Upload Review

**Files:**

- Modify: `src/renderer/src/features/knowledge/useKnowledgeManagement.ts:350-405`
- Modify: `src/renderer/src/features/knowledge/useKnowledgeManagement.ts:570-590`
- Modify: `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx:176-230`
- Modify: `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx:950-1095`
- Test: `src/renderer/src/features/knowledge/__tests__/useKnowledgeManagement.test.tsx`
- Test: `src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx`

**Interfaces:**

- Consumes: existing `cancelKnowledgeUpload(uploadId): Promise<boolean>`.
- Produces: unchanged `cancelUpload(uploadId): Promise<boolean>`, now resolving only after queue and snapshot refresh on success.
- Produces: row-local actions named `Discard <filename>`, `Keep <filename>`, and `Confirm discard <filename>`.

- [ ] **Step 1: Write the hook refresh regression**

Add a test to `useKnowledgeManagement.test.tsx` that starts with a snapshot containing a ready upload, configures `globalThis.api.cancelKnowledgeUpload = vi.fn(async () => true)`, returns a second snapshot without that active upload, calls `result.current.cancelUpload('upload-1')`, and asserts:

```ts
expect(globalThis.api?.cancelKnowledgeUpload).toHaveBeenCalledWith('upload-1');
expect(submitCommand).toHaveBeenCalledWith({
  command: 'knowledge.snapshot.read',
  payload: { query: '', cursor: null, pageSize: 100 },
  expectedRevision: null,
});
expect(result.current.snapshot?.uploads.items).toEqual([]);
```

Add a second assertion path where cancellation returns `false`; the original snapshot remains and the error is `Relay could not cancel this PDF.`

- [ ] **Step 2: Write the workspace confirmation regression**

Extend the existing duplicate-ready-upload test setup with `cancelUpload: vi.fn(async () => true)` and assert:

```ts
const trigger = screen.getByRole('button', { name: 'Discard Runbook.pdf' });
fireEvent.click(trigger);

const keep = screen.getByRole('button', { name: 'Keep Runbook.pdf' });
expect(keep).toHaveFocus();
expect(
  screen.getByRole('button', { name: 'Confirm discard Runbook.pdf' }),
).toBeInTheDocument();

fireEvent.click(keep);
expect(cancelUpload).not.toHaveBeenCalled();
expect(screen.getByRole('button', { name: 'Discard Runbook.pdf' })).toHaveFocus();

fireEvent.click(trigger);
fireEvent.click(screen.getByRole('button', { name: 'Confirm discard Runbook.pdf' }));
await waitFor(() => expect(cancelUpload).toHaveBeenCalledWith('upload-1'));
```

Also render a snapshot containing `state: 'cancelled'` and assert that its filename is absent from Upload review.

- [ ] **Step 3: Run both renderer regressions and verify red**

Run:

```bash
npx vitest run \
  src/renderer/src/features/knowledge/__tests__/useKnowledgeManagement.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx
```

Expected: FAIL because cancellation does not refresh, cancelled snapshots remain visible, and review rows have no discard action.

- [ ] **Step 4: Refresh after successful single-upload cancellation**

Extend `runUploadControl` with a final `refreshAfterSuccess = false` parameter. After `operation()`:

```ts
if (!ok) {
  setError(message);
  return false;
}
if (refreshAfterSuccess) {
  await Promise.all([refresh(), refreshUploadQueue()]);
}
return true;
```

Add `refresh` and `refreshUploadQueue` to the callback dependencies. Pass `true` only from `cancelUpload`; preserve current pause, resume, retry, reselection, and batch-cancel behavior.

- [ ] **Step 5: Add review discard state and filtering**

In `KnowledgeManagementWorkspace`:

```ts
const [discardUploadId, setDiscardUploadId] = useState<string | null>(null);
const restoreDiscardFocusRef = useRef<string | null>(null);
const focusDiscardConfirmationRef = useRef<string | null>(null);
const focusAfterDiscardRef = useRef(false);
```

Exclude terminal records:

```ts
const uploads =
  snapshot?.uploads.items.filter(
    ({ state }) => state !== 'published' && state !== 'cancelled',
  ) ?? [];
```

Add an effect that finds buttons by their `data-discard-upload-id` and `data-discard-role` values. When confirmation opens, focus the row's Keep button. When Keep closes it, focus the matching trigger. After a successful discard removes the row, focus the next discard trigger or `sectionContentRef.current`. Compare dataset values in an array search rather than interpolating IDs into a selector.

Clear `discardUploadId` when switching management sections.

- [ ] **Step 6: Render the confirmation and complete discard**

In each Upload review action group, preserve Publish/Replace and add:

```tsx
{discardUploadId === upload.id ? (
  <>
    <TactileButton
      size="sm"
      data-discard-upload-id={upload.id}
      data-discard-role="keep"
      aria-label={`Keep ${upload.fileName}`}
      onClick={() => {
        restoreDiscardFocusRef.current = upload.id;
        setDiscardUploadId(null);
      }}
    >
      Keep upload
    </TactileButton>
    <TactileButton
      size="sm"
      variant="danger"
      aria-label={`Confirm discard ${upload.fileName}`}
      loading={management.busy === `cancel:${upload.id}`}
      onClick={async () => {
        const discarded = await management.cancelUpload(upload.id);
        if (!discarded) return;
        focusAfterDiscardRef.current = true;
        setDiscardUploadId(null);
        setUploadDrafts((current) => {
          const next = { ...current };
          delete next[upload.id];
          return next;
        });
      }}
    >
      Discard upload
    </TactileButton>
  </>
) : (
  <TactileButton
    size="sm"
    variant="danger"
    className="knowledge-management__danger-outline"
    data-discard-upload-id={upload.id}
    data-discard-role="trigger"
    aria-label={`Discard ${upload.fileName}`}
    onClick={() => {
      focusDiscardConfirmationRef.current = upload.id;
      setDiscardUploadId(upload.id);
    }}
  >
    Discard upload
  </TactileButton>
)}
```

Keep confirmation inline with the row so the filename, duplicate warning, publish/replace choice, and destructive decision remain in one context. Do not hide the row before `cancelUpload` resolves `true`.

- [ ] **Step 7: Run the focused upload-management tests**

Run:

```bash
npx vitest run \
  src/renderer/src/features/knowledge/__tests__/useKnowledgeManagement.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx
```

Expected: PASS, including queue cancel, batch cancel, publish, and replace tests.

- [ ] **Step 8: Commit the slice**

```bash
git add \
  src/renderer/src/features/knowledge/useKnowledgeManagement.ts \
  src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx \
  src/renderer/src/features/knowledge/__tests__/useKnowledgeManagement.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx
git commit -m "fix: add wiki upload discard"
```

---

### Task 3: Make Shared Native Select Menus Legible on Windows

**Files:**

- Modify: `src/renderer/src/styles/components.css:147-190`
- Test: `src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts`

**Interfaces:**

- Consumes: the existing `.tactile-input` class used by management selects.
- Produces: a dark native popup palette without changing values, events, sizing, chevrons, or focus behavior.

- [ ] **Step 1: Write the failing style regression**

Add:

```ts
it('gives shared tactile selects a legible Windows popup palette', () => {
  const select = ruleBody(
    componentCss,
    'select.tactile-input.tactile-input',
  );
  const option = ruleBody(
    componentCss,
    'select.tactile-input.tactile-input option',
  );

  expect(select).toContain('color-scheme: dark;');
  expect(option).toContain('background: var(--color-bg-surface);');
  expect(option).toContain('color: var(--color-text-primary);');
});
```

- [ ] **Step 2: Run the style test and verify red**

Run:

```bash
npx vitest run src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts
```

Expected: FAIL because the shared tactile select has no native popup palette.

- [ ] **Step 3: Add the shared select rules**

Append directly after the shared tactile field rule:

```css
select.tactile-input.tactile-input {
  color-scheme: dark;
}

select.tactile-input.tactile-input option {
  color: var(--color-text-primary);
  background: var(--color-bg-surface);
}
```

Do not move Knowledge's custom chevron or duplicate these colors in management-only CSS.

- [ ] **Step 4: Run the management and catalog style tests**

Run:

```bash
npx vitest run \
  src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts \
  src/renderer/src/features/knowledge/__tests__/KnowledgeCatalogStyles.test.ts
```

Expected: PASS with both shared management selects and existing catalog filters using dark native options.

- [ ] **Step 5: Commit the slice**

```bash
git add \
  src/renderer/src/styles/components.css \
  src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts
git commit -m "fix: make tactile selects legible on windows"
```

---

### Task 4: Apply Natural Cover Ratios and Relay Hybrid Depth

**Files:**

- Modify: `src/renderer/src/features/knowledge/useKnowledgeCover.ts`
- Modify: `src/renderer/src/features/knowledge/KnowledgeSopCard.tsx`
- Modify: `src/renderer/src/features/knowledge/knowledge.css:204-275`
- Modify: `src/renderer/src/features/knowledge/__tests__/useKnowledgeCover.test.tsx`
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgeCatalogStyles.test.ts`
- Create: `src/renderer/src/features/knowledge/__tests__/KnowledgeSopCard.test.tsx`

**Interfaces:**

- Produces from `useKnowledgeCover`: `aspectRatio: string | null`.
- Changes `onImageLoad` to `(event: SyntheticEvent<HTMLImageElement>) => void`.
- Consumes valid `naturalWidth` and `naturalHeight`; invalid dimensions leave `aspectRatio` null.
- `KnowledgeSopCard` applies `style={{ aspectRatio: cover.aspectRatio }}` only when the hook returns a ratio.

- [ ] **Step 1: Write the failing hook dimension tests**

Update the test harness to render `cover.aspectRatio ?? 'fallback-ratio'`. In the load test:

```ts
const image = screen.getByRole('img', { name: 'Cover' });
Object.defineProperties(image, {
  naturalWidth: { configurable: true, value: 1275 },
  naturalHeight: { configurable: true, value: 1650 },
});
fireEvent.load(image);

expect(screen.getByText('1275 / 1650')).toBeInTheDocument();
expect(screen.getByText('ready')).toBeInTheDocument();
```

In the checksum-reset test, call `onImageLoad` with a typed synthetic-event stub containing valid dimensions, then rerender and assert `result.current.aspectRatio` returns to `null`. In the error test, assert `onImageError()` also clears it. Add an invalid-dimension case with `naturalWidth: 0` and `naturalHeight: 0` and assert the state can become `ready` while `aspectRatio` remains `null`.

- [ ] **Step 2: Write the failing card integration test**

Create `KnowledgeSopCard.test.tsx` with a valid SOP document fixture, the existing cover API mock, and object URL stubs. Render the card, wait for its image, set `naturalWidth = 1275` and `naturalHeight = 1650`, fire load, and assert:

```ts
expect(container.querySelector('.knowledge-sop-card__cover')).toHaveStyle({
  aspectRatio: '1275 / 1650',
});
expect(container.querySelector('.knowledge-sop-card__cover-sheet')).not.toBeNull();
```

Click the card and assert `onOpen` receives the document ID so markup changes do not break navigation.

- [ ] **Step 3: Replace the fixed-shell style expectation**

Update `KnowledgeCatalogStyles.test.ts` so it requires:

```ts
expect(ruleBody('.knowledge-sop-card__cover')).toContain('aspect-ratio: 3 / 4;');
expect(ruleBody('.knowledge-sop-card__cover')).toContain('contain: layout;');
expect(ruleBody('.knowledge-sop-card__cover-sheet')).toContain('overflow: hidden;');
expect(ruleBody(".knowledge-sop-card__cover[data-state='ready']::before")).toContain(
  'opacity: 0;',
);
expect(css).toMatch(
  /\.knowledge-sop-card:is\(:hover, :focus-visible\)[\s\S]*?\.knowledge-sop-card__cover\[data-state='ready'\]::before\s*\{[^}]*opacity:\s*1;/,
);
expect(css).toMatch(
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.knowledge-sop-card__cover-sheet\s*\{[^}]*transform:\s*none;/,
);
```

Keep the `object-fit: contain` assertion.

- [ ] **Step 4: Run cover tests and verify red**

Run:

```bash
npx vitest run \
  src/renderer/src/features/knowledge/__tests__/useKnowledgeCover.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgeSopCard.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgeCatalogStyles.test.ts
```

Expected: FAIL because the hook exposes no dimensions, the sheet wrapper does not exist, and CSS still clips a fixed `3 / 4` shell.

- [ ] **Step 5: Capture natural dimensions in `useKnowledgeCover`**

Import `SyntheticEvent` as a type, add `aspectRatio` state, and implement:

```ts
const [aspectRatio, setAspectRatio] = useState<string | null>(null);
const onImageLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
  const { naturalWidth, naturalHeight } = event.currentTarget;
  setAspectRatio(
    Number.isFinite(naturalWidth) &&
      Number.isFinite(naturalHeight) &&
      naturalWidth > 0 &&
      naturalHeight > 0
      ? `${naturalWidth} / ${naturalHeight}`
      : null,
  );
  setState('ready');
}, []);
const onImageError = useCallback(() => {
  setAspectRatio(null);
  setState('error');
}, []);
```

Set `aspectRatio` to `null` whenever a new visible cover request enters loading. Return it with the existing hook fields.

- [ ] **Step 6: Apply the ratio and sheet wrapper**

In `KnowledgeSopCard`:

```tsx
<div
  ref={cover.ref}
  className="knowledge-sop-card__cover"
  data-state={cover.state}
  style={cover.aspectRatio ? { aspectRatio: cover.aspectRatio } : undefined}
>
  <div className="knowledge-sop-card__cover-sheet">
    {cover.url && cover.state !== 'error' ? (
      <img
        src={cover.url}
        alt=""
        onLoad={cover.onImageLoad}
        onError={cover.onImageError}
      />
    ) : (
      <div className="knowledge-sop-card__fallback" aria-hidden="true">
        <span>{cover.state === 'loading' ? 'Loading cover' : 'SOP Manual'}</span>
        <strong>{document.displayTitle.slice(0, 1)}</strong>
      </div>
    )}
  </div>
</div>
```

Do not change the button accessible name, title, page count, or click handler.

- [ ] **Step 7: Implement Direction D in catalog CSS**

Keep the outer fallback:

```css
.knowledge-sop-card__cover {
  position: relative;
  aspect-ratio: 3 / 4;
  background: var(--color-bg-app);
  contain: layout;
}
```

Add an initially hidden neutral paper edge:

```css
.knowledge-sop-card__cover[data-state='ready']::before {
  position: absolute;
  z-index: 0;
  inset: 3px -4px -4px 4px;
  border-right: 1px solid var(--color-border-strong);
  border-bottom: 1px solid var(--color-border-strong);
  background: var(--color-bg-surface-3);
  content: '';
  opacity: 0;
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.knowledge-sop-card__cover-sheet {
  position: absolute;
  z-index: 1;
  inset: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  background: var(--color-bg-app);
  transition:
    filter 180ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
```

Move the existing image and fallback sizing under the sheet. Reveal depth only for ready covers:

```css
.knowledge-sop-card:is(:hover, :focus-visible)
  .knowledge-sop-card__cover[data-state='ready']::before {
  opacity: 1;
}

.knowledge-sop-card:is(:hover, :focus-visible)
  .knowledge-sop-card__cover[data-state='ready']
  .knowledge-sop-card__cover-sheet {
  filter: drop-shadow(0 9px 11px rgb(0 0 0 / 48%));
  transform: translate(-1px, -3px);
}
```

In reduced motion, set the ready sheet transform to `none` and remove its transition while retaining border/focus indication. Do not add reflections, perspective, colored glow, or a permanent shadow.

- [ ] **Step 8: Run focused cover tests**

Run:

```bash
npx vitest run \
  src/renderer/src/features/knowledge/__tests__/useKnowledgeCover.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgeSopCard.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgeCatalogStyles.test.ts
```

Expected: PASS with the exact natural ratio, stable fallback, navigation, interaction-only depth, and reduced-motion guard.

- [ ] **Step 9: Commit the slice**

```bash
git add \
  src/renderer/src/features/knowledge/useKnowledgeCover.ts \
  src/renderer/src/features/knowledge/KnowledgeSopCard.tsx \
  src/renderer/src/features/knowledge/knowledge.css \
  src/renderer/src/features/knowledge/__tests__/useKnowledgeCover.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgeSopCard.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgeCatalogStyles.test.ts
git commit -m "feat: polish wiki cover presentation"
```

---

### Task 5: Complete Verification and Runtime Check

**Files:**

- Verify all files from Tasks 1-4.
- Modify only if a verification failure exposes a real defect.

**Interfaces:**

- Consumes: the four independently passing behavior slices.
- Produces: one verified branch tip with no unrelated changes.

- [ ] **Step 1: Run the complete focused Knowledge set**

```bash
npx vitest run \
  src/main/knowledge/__tests__/ManagedKnowledgeService.test.ts \
  src/renderer/src/features/knowledge/__tests__/useKnowledgeManagement.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts \
  src/renderer/src/features/knowledge/__tests__/useKnowledgeCover.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgeSopCard.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgeCatalogStyles.test.ts
```

Expected: all tests PASS.

- [ ] **Step 2: Run repository quality gates**

Run in order:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Expected: every command exits `0`. If formatting tools rewrite files, inspect the diff and rerun the focused tests plus affected gate.

- [ ] **Step 3: Inspect the final diff**

```bash
git status --short
git diff --check
git diff origin/test...HEAD --stat
git diff origin/test...HEAD -- \
  src/main/knowledge \
  src/renderer/src/features/knowledge \
  src/renderer/src/styles/components.css
```

Expected: only the approved spec, plan, implementation, and focused tests are present; no mockup, generated PDF, temporary file, or unrelated user change is included.

- [ ] **Step 4: Run Relay and verify the real workflows**

Start:

```bash
npm run dev
```

In the running app:

1. Open Wiki Management > Uploads with a ready duplicate PDF.
2. Choose **Discard upload**, verify Keep returns focus, then confirm discard and verify the row disappears.
3. Stage a duplicate, permanently delete the original through Trash, and verify Publish becomes available without logout.
4. Open every management select used by Documents, Categories, and Upload review on Windows or the available Windows test environment; verify option text and background remain legible.
5. Return to the Wiki catalog and verify the supplied Oracle cover has no top filler bar.
6. Verify a loaded cover is exact-fit and quiet at rest, then gains only the narrow edge/shadow/lift on hover and keyboard focus.
7. Verify loading/error fallbacks remain stable and reduced-motion removes cover translation.

- [ ] **Step 5: Record final evidence**

Capture the passing command summary, runtime observations, final `git status --short --branch`, and commit list:

```bash
git status --short --branch
git log --oneline origin/test..HEAD
```

Do not push until the user explicitly asks to publish the completed branch.
