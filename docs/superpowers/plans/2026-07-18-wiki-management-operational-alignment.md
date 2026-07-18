# Wiki Management Operational Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Wiki Management with Relay's Status and Problems visual language while preserving all document, upload, trash, audit, and permission behavior.

**Architecture:** Keep `KnowledgeManagementWorkspace` information architecture and hook usage intact. Apply the approved shell, density, selected-state, destructive-action, and responsive treatments in `knowledge.css`; add presentation-only button classes where the filled-versus-outlined danger distinction needs stable selectors; protect the result with component and source-level style regressions.

**Tech Stack:** React 19, TypeScript 6, CSS custom properties, Testing Library, Vitest 4, Impeccable layout detector

## Global Constraints

- Preserve the four-section order: Documents, Uploads, Trash, Audit.
- Preserve the 190px desktop rail and every existing management action and accessible name.
- Use a flat app background, `gap: var(--space-4)`, and `padding: var(--space-4) var(--space-5) 0` on the management root.
- Use `var(--text-2xl)`, `var(--space-1)`, zero display tracking, and `var(--leading-tight)` for the page title rhythm.
- Use Relay's 2px radius, 40px controls, 8px control-group gaps, 16px major-group gaps, and 84px minimum document rows.
- Keep the upload queue as the only accent-subtle emphasis surface and remove its gradient.
- Use readable, horizontally scrollable section labels at 1100px and 560px; never reduce labels to initials.
- Disable toolbar stickiness at 820px and stack the existing controls and rows.
- Keep entry-level Trash, upload Cancel, and Delete permanently actions outlined; keep final destructive confirmation filled.
- Do not change `useKnowledgeManagement`, IPC, PocketBase data, upload orchestration, privileges, sessions, counts, cursors, filters, rename, replace, recovery, restore, deletion, or audit behavior.
- Do not alter Wiki reader, PDF controls, Contacts, Servers, Status, or Problems.

---

## File Structure

- Create `src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts` for the shell, density, selected state, control geometry, upload emphasis, danger outline, and responsive CSS contract.
- Modify `src/renderer/src/features/knowledge/knowledge.css` for all approved visual and responsive rules.
- Modify `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx` only to mark entry-level destructive actions with `knowledge-management__danger-outline`.
- Modify `src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx` to verify entry versus confirmation danger presentation without changing behavioral assertions.

### Task 1: Flat Operational Shell and Density

**Files:**

- Create: `src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts`
- Modify: `src/renderer/src/features/knowledge/knowledge.css:738-1078`
- Modify: `src/renderer/src/features/knowledge/knowledge.css:1081-1235`

**Interfaces:**

- Consumes: Relay theme tokens from `src/renderer/src/styles/theme.css` and existing Knowledge Management class names.
- Produces: the approved flat shell, workspace, toolbar, rail, controls, row density, and upload emphasis without JSX or behavior changes.

- [ ] **Step 1: Add failing style regressions for the approved desktop treatment**

Create `src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/features/knowledge/knowledge.css'),
  'utf8',
);

function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(source)?.[1] ?? '';
}

function mediaBody(maxWidth: number): string {
  const start = css.indexOf(`@media (max-width: ${maxWidth}px)`);
  const end = css.indexOf('@media ', start + 1);
  return css.slice(start, end === -1 ? undefined : end);
}

describe('Knowledge Management visual system', () => {
  it('uses the flat operational shell and shared heading rhythm', () => {
    const root = ruleBody(css, '.knowledge-management');
    const header = ruleBody(css, '.knowledge-management__header');
    const title = ruleBody(css, '.knowledge-management__header h1');
    const workspace = ruleBody(css, '.knowledge-management__workspace');

    expect(root).toContain('gap: var(--space-4);');
    expect(root).toContain('padding: var(--space-4) var(--space-5) 0;');
    expect(root).toContain('background: var(--color-bg-app);');
    expect(root).not.toContain('linear-gradient');
    expect(header).toContain('gap: var(--space-5);');
    expect(header).toContain('padding: 0;');
    expect(title).toContain('margin: var(--space-1) 0 0;');
    expect(title).toContain('font-size: var(--text-2xl);');
    expect(title).toContain('letter-spacing: 0;');
    expect(title).toContain('line-height: var(--leading-tight);');
    expect(workspace).toContain('grid-template-columns: 190px minmax(0, 1fr);');
    expect(workspace).toContain('margin-top: 0;');
    expect(workspace).toContain('box-shadow: none;');
  });

  it('uses flat selection, opaque tools, square controls, and compact rows', () => {
    const railButton = ruleBody(css, '.knowledge-management__rail button');
    const activeRailButton = ruleBody(css, '.knowledge-management__rail button.is-active');
    const count = ruleBody(css, '.knowledge-management__rail strong');
    const toolbar = ruleBody(css, '.knowledge-management__toolbar');
    const controls = ruleBody(css, '.knowledge-management :is(input, select)');
    const categoryTool = ruleBody(css, '.knowledge-management__category-tool');
    const row = ruleBody(css, '.knowledge-management-row');
    const title = ruleBody(
      css,
      '.knowledge-management-row__identity h2,\n.knowledge-audit-row h2',
    );
    const status = ruleBody(css, '.knowledge-management-status');

    expect(railButton).toContain('border: 1px solid transparent;');
    expect(railButton).toContain('border-radius: 2px;');
    expect(activeRailButton).toContain('border-color: var(--color-border-accent);');
    expect(activeRailButton).toContain('background: var(--accent-subtle);');
    expect(activeRailButton).not.toContain('linear-gradient');
    expect(count).toContain('border-radius: 2px;');
    expect(toolbar).toContain('gap: var(--space-4);');
    expect(toolbar).toContain('padding: var(--space-3) var(--space-4);');
    expect(toolbar).toContain('background: var(--color-bg-surface);');
    expect(toolbar).toContain('backdrop-filter: none;');
    expect(controls).toContain('height: 40px;');
    expect(controls).toContain('border-radius: 2px;');
    expect(categoryTool).toContain('gap: var(--space-2);');
    expect(row).toContain('gap: var(--space-4);');
    expect(row).toContain('min-height: 84px;');
    expect(row).toContain('padding: var(--space-3) var(--space-4);');
    expect(title).toContain('font-size: var(--text-sm);');
    expect(status).toContain('border-radius: 2px;');
  });

  it('keeps upload queue emphasis flat and scoped', () => {
    const summary = ruleBody(css, '.knowledge-upload-queue__summary');

    expect(summary).toContain('background: var(--accent-subtle);');
    expect(summary).not.toContain('linear-gradient');
  });

  it('preserves readable section labels and stacked tools at each breakpoint', () => {
    const rail1100 = ruleBody(mediaBody(1100), '.knowledge-management__rail');
    const railButton1100 = ruleBody(mediaBody(1100), '.knowledge-management__rail button');
    const toolbar820 = ruleBody(mediaBody(820), '.knowledge-management__toolbar');
    const rail560 = ruleBody(mediaBody(560), '.knowledge-management__rail');
    const railButton560 = ruleBody(mediaBody(560), '.knowledge-management__rail button');
    const railLabel560 = ruleBody(mediaBody(560), '.knowledge-management__rail button span');

    expect(rail1100).toContain('overflow-x: auto;');
    expect(rail1100).toContain('flex-direction: row;');
    expect(railButton1100).toContain('min-height: 44px;');
    expect(toolbar820).toContain('position: static;');
    expect(toolbar820).toContain('flex-direction: column;');
    expect(rail560).toContain('overflow-x: auto;');
    expect(railButton560).toContain('min-height: 44px;');
    expect(railButton560).toContain('flex: 0 0 auto;');
    expect(railLabel560).toContain('font-size: 10px;');
    expect(mediaBody(560)).not.toContain('span::first-letter');
  });
});
```

- [ ] **Step 2: Run the focused style test and verify the red state**

Run:

```bash
npm run test:renderer -- src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts
```

Expected: FAIL on the current gradient shell, shadowed workspace, left-stripe rail, blurred toolbar, 36px rounded controls, 104px rows, gradient upload summary, and initial-only mobile labels.

- [ ] **Step 3: Apply the approved desktop shell and density rules**

Update the matching selectors in `src/renderer/src/features/knowledge/knowledge.css` to these declarations, retaining unrelated color, font, and interaction declarations already present in each rule:

```css
.knowledge-management {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5) 0;
  color: var(--color-text-primary);
  background: var(--color-bg-app);
}

.knowledge-management__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-5);
  padding: 0;
}

.knowledge-management__header h1 {
  margin: var(--space-1) 0 0;
  font-size: var(--text-2xl);
  letter-spacing: 0;
  line-height: var(--leading-tight);
}

.knowledge-management__header p {
  margin: var(--space-2) 0 0;
}

.knowledge-management__header-actions {
  gap: var(--space-2);
}

.knowledge-management__role,
.knowledge-management-status,
.knowledge-management-row__type,
.knowledge-management__rail strong {
  border-radius: 2px;
}

.knowledge-management__workspace {
  margin-top: 0;
  box-shadow: none;
}

.knowledge-management__rail {
  padding: var(--space-3) var(--space-2);
}

.knowledge-management__rail button {
  min-height: 44px;
  padding: 0 var(--space-3);
  border: 1px solid transparent;
  border-radius: 2px;
}

.knowledge-management__rail button.is-active {
  border-color: var(--color-border-accent);
  color: var(--accent-bright);
  background: var(--accent-subtle);
  box-shadow: inset 0 0 0 1px var(--accent-dim);
}

.knowledge-management__toolbar {
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--color-bg-surface);
  backdrop-filter: none;
}

.knowledge-management :is(input, select) {
  height: 40px;
  border-radius: 2px;
}

.knowledge-management__category-tool {
  gap: var(--space-2);
}

.knowledge-management-row {
  gap: var(--space-4);
  min-height: 84px;
  padding: var(--space-3) var(--space-4);
}

.knowledge-management-row__identity h2,
.knowledge-audit-row h2 {
  font-size: var(--text-sm);
}

.knowledge-upload-queue__summary {
  padding: var(--space-4);
  background: var(--accent-subtle);
}
```

Apply these exact spacing-token substitutions in the touched management selectors:

```css
.knowledge-management__search,
.knowledge-management-row__editor label,
.knowledge-management-row__delete label {
  gap: var(--space-2);
}

.knowledge-management-row__meta {
  gap: var(--space-1);
}

.knowledge-management-row__actions,
.knowledge-management-row__editor > div,
.knowledge-management-row__delete,
.knowledge-upload-queue__summary-actions,
.knowledge-upload-file__actions {
  gap: var(--space-2);
}

.knowledge-upload-queue__summary {
  gap: var(--space-3) var(--space-5);
}

.knowledge-upload-queue__recovery {
  padding: var(--space-1) var(--space-2);
}

.knowledge-upload-file {
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
}

.knowledge-upload-file__state,
.knowledge-upload-file__progress {
  gap: var(--space-2);
}

.knowledge-management-section-heading {
  padding: var(--space-4) var(--space-4) var(--space-2);
}

.knowledge-management-empty {
  padding: var(--space-6);
}

.knowledge-management-more {
  padding: var(--space-4);
}

.knowledge-audit-row {
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}
```

Keep the existing desktop columns, content overflow, borders, hover, focus, semantic colors, and grid spans unchanged.

- [ ] **Step 4: Implement the approved responsive structure**

Replace the management-specific 1100px rail overrides with:

```css
.knowledge-management__rail {
  flex-direction: row;
  gap: var(--space-2);
  padding: var(--space-2);
  overflow-x: auto;
  border-right: 0;
  border-bottom: 1px solid var(--color-border);
}

.knowledge-management__rail button {
  min-height: 44px;
  flex: 1 0 132px;
}
```

Add `position: static;` to `.knowledge-management__toolbar` inside `@media (max-width: 820px)` while retaining its stacked column layout. Change the management root's narrow padding to `var(--space-3)`.

Replace the management-specific 560px rail rules with:

```css
.knowledge-management__rail {
  overflow-x: auto;
}

.knowledge-management__rail button {
  display: grid;
  min-height: 44px;
  flex: 0 0 auto;
  min-width: 132px;
  padding: 0 var(--space-3);
}

.knowledge-management__rail button span {
  font-size: 10px;
}
```

Delete the `.knowledge-management__rail button span::first-letter` rule.

- [ ] **Step 5: Run the style test and existing workspace component test**

Run:

```bash
npm run test:renderer -- src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx
```

Expected: both files PASS with all existing Documents, Uploads, Trash, Audit, queue, publish, and replacement assertions unchanged.

- [ ] **Step 6: Commit the shell and density slice**

```bash
git add src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts src/renderer/src/features/knowledge/knowledge.css
git commit -m "style(knowledge): align management workspace rhythm"
```

### Task 2: Outlined Entry-Level Danger Actions

**Files:**

- Modify: `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx:415-426`
- Modify: `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx:484-497`
- Modify: `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx:557-565`
- Modify: `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx:745-751`
- Modify: `src/renderer/src/features/knowledge/knowledge.css`
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx`
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts`

**Interfaces:**

- Consumes: `TactileButton`'s existing `variant` and `className` props.
- Produces: `knowledge-management__danger-outline` for entry actions; final Confirm cancel and password-confirmed Delete permanently retain the global filled danger treatment.

- [ ] **Step 1: Add failing presentation assertions to the component tests**

In the first `KnowledgeManagementWorkspace` test, add:

```ts
const trashButton = screen.getByRole('button', { name: 'Trash' });
expect(trashButton).toHaveClass('tactile-button--danger');
expect(trashButton).toHaveClass('knowledge-management__danger-outline');
```

In the resumable VPN upload test, capture the entry buttons and verify the confirmation transition:

```ts
const cancelFile = screen.getByRole('button', { name: 'Cancel Runbook.pdf' });
const cancelBatch = screen.getByRole('button', { name: 'Cancel batch' });

expect(cancelFile).toHaveClass('tactile-button--danger');
expect(cancelFile).toHaveClass('knowledge-management__danger-outline');
expect(cancelBatch).toHaveClass('tactile-button--danger');
expect(cancelBatch).toHaveClass('knowledge-management__danger-outline');

fireEvent.click(cancelBatch);

const confirmCancel = screen.getByRole('button', { name: 'Confirm cancel' });
expect(confirmCancel).toHaveClass('tactile-button--danger');
expect(confirmCancel).not.toHaveClass('knowledge-management__danger-outline');
```

Retain the existing Resume, Retry, and Cancel file clicks and call assertions.

- [ ] **Step 2: Extend the style regression with the outlined-danger contract**

Add this test to `KnowledgeManagementStyles.test.ts`:

```ts
it('uses outlined danger for entry actions without weakening confirmation danger', () => {
  const outline = ruleBody(css, '.knowledge-management__danger-outline');
  const outlineHover = ruleBody(css, '.knowledge-management__danger-outline:hover');

  expect(outline).toContain('border-color: var(--alarm);');
  expect(outline).toContain('color: var(--alarm-bright);');
  expect(outline).toContain('background: transparent;');
  expect(outlineHover).toContain('background: var(--alarm-dim);');
});
```

- [ ] **Step 3: Run both tests and verify the red state**

Run:

```bash
npm run test:renderer -- src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx
```

Expected: FAIL because the entry-action class and its CSS do not exist, and upload cancellation still uses the secondary variant.

- [ ] **Step 4: Mark entry-level destructive actions without changing handlers**

Add `className="knowledge-management__danger-outline"` to the Trash button and the non-confirming Delete permanently button.

Change the batch-cancel button props to:

```tsx
variant="danger"
className={cancelBatchConfirmation ? '' : 'knowledge-management__danger-outline'}
```

Change the per-file Cancel button props to:

```tsx
variant="danger"
className="knowledge-management__danger-outline"
```

Leave the password-confirmed Delete permanently submit button as `variant="danger"` without the outline class.

- [ ] **Step 5: Add the scoped outline treatment**

Add to `knowledge.css` beside the row action rules:

```css
.knowledge-management__danger-outline {
  border-color: var(--alarm);
  color: var(--alarm-bright);
  background: transparent;
}

.knowledge-management__danger-outline:hover {
  border-color: var(--alarm-bright);
  color: var(--alarm-bright);
  background: var(--alarm-dim);
}
```

- [ ] **Step 6: Run the focused component and style tests**

Run:

```bash
npm run test:renderer -- src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx
```

Expected: PASS; entry actions are outlined, confirmation actions are filled, and handler assertions remain green.

- [ ] **Step 7: Commit the danger hierarchy slice**

```bash
git add src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx src/renderer/src/features/knowledge/knowledge.css src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx
git commit -m "style(knowledge): clarify destructive action hierarchy"
```

### Task 3: Full Regression and Visual Verification

**Files:**

- Verify: `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx`
- Verify: `src/renderer/src/features/knowledge/knowledge.css`
- Verify: `src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx`
- Verify: `src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts`

**Interfaces:**

- Consumes: the completed shell, responsive, and danger-presentation slices.
- Produces: evidence that presentation changed without functional regressions or remaining unaccounted layout-detector findings.

- [ ] **Step 1: Run all focused Knowledge tests**

Run:

```bash
npm run test:renderer -- src/renderer/src/features/knowledge/__tests__
```

Expected: all Knowledge renderer tests PASS, including Documents, Uploads, Trash, Audit, reader, continuous PDF, navigation, recovery, publish, replace, restore, and delete coverage.

- [ ] **Step 2: Run the required repository gates**

Run:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:renderer
npm run build
```

Expected: every command exits 0.

- [ ] **Step 3: Re-run the Impeccable layout detector**

Run:

```bash
node /Users/ryan/.codex/skills/impeccable/scripts/detect.mjs --json --scope layout src/renderer/src/features/knowledge/knowledge.css src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx
```

Expected: no unresolved layout findings in touched selectors. For every detector item outside the touched selectors, record the selector and why it is pre-existing and outside this approved pass before continuing.

- [ ] **Step 4: Verify every management section in Electron**

Run:

```bash
npm run dev
```

With a Publisher, Administrator, or Owner session, open Wiki Management and verify Documents, Uploads, Trash, and Audit at desktop width, near 1100px, below 820px, and below 560px:

- the header follows Status and Problems rhythm;
- the workspace is flat, bordered, and shadow-free;
- the toolbar is opaque and non-sticky below 820px;
- row actions remain visible and operable;
- upload progress, pause, resume, retry, cancel, publish, and replace states remain present;
- Trash and initial Delete permanently controls are outlined;
- Confirm cancel and password-confirmed Delete permanently are filled danger;
- all four section labels remain fully readable with 44px minimum targets;
- horizontal section scrolling works without clipping counts or labels;
- search, category rename, editing, replace, restore, pagination, and audit loading still work.

- [ ] **Step 5: Inspect the final diff for scope containment**

Run:

```bash
git diff --check
git diff -- src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx src/renderer/src/features/knowledge/knowledge.css src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts
```

Expected: `git diff --check` exits 0; the diff contains presentation selectors, presentation-only button classes, and tests, with no hook, IPC, data, permission, copy, or action-order changes.

- [ ] **Step 6: Commit verification-only formatting changes if generated**

If formatting produced a tracked change, stage only the four files named in Step 5 and commit:

```bash
git add src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx src/renderer/src/features/knowledge/knowledge.css src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts
git commit -m "test(knowledge): verify management visual alignment"
```

If Step 5 reports no tracked change, do not create an empty commit.
