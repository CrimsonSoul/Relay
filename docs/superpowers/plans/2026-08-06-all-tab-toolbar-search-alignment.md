# All-Tab Toolbar and Header Search Alignment Implementation Plan

> **For the implementing agent:** Use `superpowers:executing-plans` for inline execution or
> `superpowers:subagent-driven-development` for task-by-task delegated execution. Follow this plan
> in order and stop at each verification checkpoint if the stated behavior is not proven.

**Goal:** Apply Compose's approved top-level header and command hierarchy to every Relay tab, then
make Header Search actions compact, stable, and fully keyboard accessible without changing any
domain behavior.

**Architecture:** Add three renderer-only, slot-based presentation primitives—`TabPageHeader`,
`TabCommandBar`, and `TabCommandGroup`—and centralize their geometry in one stylesheet. Keep all
domain actions, state, callbacks, and `CollapsibleHeader` behavior in their existing tabs. Migrate
the seven top-level destinations in two controlled waves, then update Header Search's result-row
layout while preserving the current combobox/listbox model and selection callbacks.

**Tech stack:** React 19, TypeScript, Vitest and Testing Library, CSS, Electron, Playwright.

**Design authority:**
`docs/superpowers/specs/2026-08-06-all-tab-toolbar-search-alignment-design.md`

---

## Task 1: Add the shared top-level chrome primitives

**Files:**

- Create: `src/renderer/src/components/tab-chrome/TabChrome.tsx`
- Create: `src/renderer/src/components/tab-chrome/TabChrome.test.tsx`
- Create: `src/renderer/src/styles/tab-chrome.css`
- Modify: `src/renderer/src/styles.css`

### Step 1: Write the failing component tests

Create `TabChrome.test.tsx` with tests that prove:

- `TabPageHeader` renders an eyebrow, an `h2` by default, optional metadata, and an explicit `h1`
  when requested by Knowledge.
- Omitting metadata does not leave an empty metadata container.
- `TabCommandBar` exposes the supplied toolbar name.
- `TabCommandGroup` exposes the utility/workflow class and preserves child order.
- Optional class names are appended rather than replacing shared classes.

Use this public API in the tests:

```tsx
<TabPageHeader
  context="Compose"
  title="Bridge Recipient Assembly"
  metadata={<span role="status">6 recipients</span>}
/>

<TabCommandBar ariaLabel="Compose actions" className="assembler-command-bar">
  <TabCommandGroup kind="utility">
    <button type="button">Reset</button>
  </TabCommandGroup>
  <TabCommandGroup kind="workflow">
    <button type="button">Open Teams draft</button>
  </TabCommandGroup>
</TabCommandBar>
```

### Step 2: Run the focused test and prove it fails

Run:

```bash
npm run test:renderer -- src/renderer/src/components/tab-chrome/TabChrome.test.tsx
```

Expected: FAIL because the shared tab-chrome module does not exist.

### Step 3: Implement the minimal components

Implement `TabChrome.tsx` with typed, renderer-only slots:

```tsx
import type { ReactNode } from 'react';

type TabPageHeaderProps = Readonly<{
  context: string;
  title: string;
  metadata?: ReactNode;
  headingId?: string;
  headingLevel?: 1 | 2;
  className?: string;
}>;

type TabCommandBarProps = Readonly<{
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}>;

type TabCommandGroupProps = Readonly<{
  kind: 'utility' | 'workflow';
  children: ReactNode;
  className?: string;
}>;

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function TabPageHeader({
  context,
  title,
  metadata,
  headingId,
  headingLevel = 2,
  className,
}: TabPageHeaderProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <header className={classes('tab-page-header', className)}>
      <div className="tab-page-header__identity">
        <div className="tab-page-header__context">{context}</div>
        <Heading id={headingId} className="tab-page-header__title">
          {title}
        </Heading>
      </div>
      {metadata ? <div className="tab-page-header__meta">{metadata}</div> : null}
    </header>
  );
}

export function TabCommandBar({ ariaLabel, children, className }: TabCommandBarProps) {
  return (
    <div className={classes('tab-command-bar', className)} role="toolbar" aria-label={ariaLabel}>
      {children}
    </div>
  );
}

export function TabCommandGroup({ kind, children, className }: TabCommandGroupProps) {
  return (
    <div className={classes('tab-command-group', `tab-command-group--${kind}`, className)}>
      {children}
    </div>
  );
}
```

Do not add domain status roles or live-region behavior to the primitive; each tab must retain
control of those semantics.

### Step 4: Define the shared CSS contract

Add `tab-chrome.css` and import it in `styles.css` immediately after `components-after-settings.css`.
Define:

```css
.tab-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.tab-page-header__context {
  color: var(--color-text-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-widest);
  text-transform: uppercase;
}

.tab-page-header__title {
  margin: var(--space-1) 0 0;
  color: var(--color-text-primary);
  font-size: var(--text-2xl);
  font-weight: var(--weight-bold);
  line-height: var(--leading-tight);
}

.tab-page-header__meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  min-width: 0;
  color: var(--color-text-tertiary);
  font-family: var(--font-family-sans);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.tab-command-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  width: 100%;
  --tab-command-control-height: 36px;
}

.tab-command-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}

.tab-command-group--utility {
  --tab-command-control-height: 36px;
}

.tab-command-group--workflow {
  --tab-command-control-height: 40px;
  justify-content: flex-end;
}

.tab-command-group .tactile-button {
  height: var(--tab-command-control-height);
  min-height: var(--tab-command-control-height);
}

.tab-command-group .tactile-button--icon-only {
  width: var(--tab-command-control-height);
  min-width: var(--tab-command-control-height);
}
```

Add a breakpoint that stacks header metadata beneath identity and command groups in DOM order;
never use CSS `order`. Include a rule for `.tab-command-bar .collapsible-header` and its actions so
Compose and On-Call retain scroll collapse while the shared groups still control geometry.

### Step 5: Run the focused tests

Run:

```bash
npm run test:renderer -- src/renderer/src/components/tab-chrome/TabChrome.test.tsx
npx prettier --check src/renderer/src/components/tab-chrome/TabChrome.tsx src/renderer/src/components/tab-chrome/TabChrome.test.tsx src/renderer/src/styles/tab-chrome.css src/renderer/src/styles.css
```

Expected: PASS.

### Step 6: Commit the shared foundation

```bash
git add src/renderer/src/components/tab-chrome/TabChrome.tsx \
  src/renderer/src/components/tab-chrome/TabChrome.test.tsx \
  src/renderer/src/styles/tab-chrome.css src/renderer/src/styles.css
git commit -m "feat: add shared tab chrome primitives"
```

---

## Task 2: Migrate Compose, Alerts, and On-Call to the shared contract

**Files:**

- Modify: `src/renderer/src/tabs/AssemblerTab.tsx`
- Modify: `src/renderer/src/tabs/assembler/assembler.css`
- Modify: `src/renderer/src/tabs/__tests__/AssemblerTab.test.tsx`
- Modify: `src/renderer/src/tabs/AlertsTab.tsx`
- Modify: `src/renderer/src/tabs/alerts/AlertActionsMenu.tsx`
- Modify: `src/renderer/src/tabs/alerts.css`
- Modify: `src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`
- Modify: `src/renderer/src/tabs/PersonnelTab.tsx`
- Modify: `src/renderer/src/components/oncall/oncall.css`
- Modify: `src/renderer/src/tabs/__tests__/PersonnelTab.test.tsx`

### Step 1: Replace CSS-string assertions with failing structural contract tests

Update the three existing test files to assert shared structure through rendered DOM:

```tsx
const toolbar = screen.getByRole('toolbar', { name: 'Alert actions' });
const utility = toolbar.querySelector('.tab-command-group--utility');
const workflow = toolbar.querySelector('.tab-command-group--workflow');

expect(screen.getByRole('heading', { name: 'Operational Alert Utility' }))
  .toHaveClass('tab-page-header__title');
expect(utility).toContainElement(screen.getByRole('button', { name: 'Save image' }));
expect(workflow).toContainElement(screen.getByRole('button', { name: 'Open in Outlook' }));
expect(workflow).toContainElement(screen.getByRole('button', { name: 'More alert actions' }));
```

Add equivalent assertions for:

- Compose: Reset/History in utility; Copy recipients/Open Teams draft/More in workflow.
- On-Call: reminder/display scale/Copy all/Export in utility; lock/Add card in workflow.
- Visible labels use Title Case, while existing accessible names may remain more descriptive.
- Alerts overflow is a `TactileButton` icon-only workflow control and remains disabled while
  capture is busy.
- Existing callbacks, menus, disabled states, and collapse tests remain intact.

Remove tests that parse tab-specific CSS for hard-coded heights; Task 1 owns the geometry test.

### Step 2: Run the focused tests and prove they fail

Run:

```bash
npm run test:renderer -- \
  src/renderer/src/tabs/__tests__/AssemblerTab.test.tsx \
  src/renderer/src/tabs/__tests__/AlertsTab.test.tsx \
  src/renderer/src/tabs/__tests__/PersonnelTab.test.tsx
```

Expected: FAIL because the tabs still emit their bespoke header/group classes and uppercase labels.

### Step 3: Migrate Compose without changing behavior

Replace the custom header with:

```tsx
<TabPageHeader
  context="Compose"
  title="Bridge Recipient Assembly"
  metadata={
    <span role="status" aria-live="polite">
      {asm.allRecipients.length} {asm.allRecipients.length === 1 ? 'recipient' : 'recipients'}
    </span>
  }
/>
```

Keep `CollapsibleHeader` and place the shared `TabCommandGroup` children inside it. Use
`TabCommandBar` for the outer toolbar. Preserve Undo's conditional rendering, the zero-recipient
disabled states, the existing More menu, and every callback. Change visible command labels only to
the approved Title Case wording.

Delete obsolete `.assembler-page-*`, `.assembler-command-group*`, and per-button height rules that
are now supplied by `tab-chrome.css`. Retain Compose-specific pane, notice, sort, and collapse CSS.

### Step 4: Migrate Alerts and correct its group order

Render Save image in the left utility group and the draft action plus overflow in the right workflow
group:

```tsx
<TabCommandBar ariaLabel="Alert actions">
  <TabCommandGroup kind="utility">
    <TactileButton variant="secondary">Save image</TactileButton>
  </TabCommandGroup>
  <TabCommandGroup kind="workflow">
    <TactileButton variant="primary">
      {isWebRuntime ? 'Download draft' : 'Open in Outlook'}
    </TactileButton>
    <AlertActionsMenu
      captureBusy={isCapturing}
      onScheduleAlarm={openNewReminderModal}
      onOpenAlarms={reminderManagerModal.open}
      onOpenHistory={historyModal.open}
      onPinTemplate={handlePinTemplate}
      onReset={handleClear}
    />
  </TabCommandGroup>
</TabCommandBar>
```

Change `AlertActionsMenu` to render `TactileButton` with its existing aria attributes, busy state,
position calculation, and `ContextMenu`. Use the existing ellipsis glyph or SVG as `icon` so the
button remains icon-only and inherits the 40px workflow size.

Delete the raw `.alerts-overflow-trigger` button reset/geometry and the Alerts-specific 48px/36px
height overrides. Keep only menu positioning or animation selectors that still apply.

### Step 5: Migrate On-Call

Use `TabPageHeader`, retain its green status dot and exact week/update text inside `metadata`, and
wrap the existing command groups in the shared components. Preserve `CollapsibleHeader`, reminder
buttons, display scale, board lock semantics, and add-card behavior. Change visible labels to Copy
all, Export, Locked/Unlocked, and Add card.

Make `OnCallDisplayControl` and reminder controls consume
`var(--tab-command-control-height)` from the utility group. Remove the broad
`.oncall-command-action.tactile-button { height: 36px; }` override so lock and Add card both inherit
40px from the workflow group.

### Step 6: Run the migration regression tests

Run:

```bash
npm run test:renderer -- \
  src/renderer/src/tabs/__tests__/AssemblerTab.test.tsx \
  src/renderer/src/tabs/__tests__/AlertsTab.test.tsx \
  src/renderer/src/tabs/__tests__/PersonnelTab.test.tsx
```

Expected: PASS, including all pre-existing behavior tests.

### Step 7: Commit the canonical three-tab migration

```bash
git add src/renderer/src/tabs/AssemblerTab.tsx \
  src/renderer/src/tabs/assembler/assembler.css \
  src/renderer/src/tabs/__tests__/AssemblerTab.test.tsx \
  src/renderer/src/tabs/AlertsTab.tsx \
  src/renderer/src/tabs/alerts/AlertActionsMenu.tsx \
  src/renderer/src/tabs/alerts.css \
  src/renderer/src/tabs/__tests__/AlertsTab.test.tsx \
  src/renderer/src/tabs/PersonnelTab.tsx \
  src/renderer/src/components/oncall/oncall.css \
  src/renderer/src/tabs/__tests__/PersonnelTab.test.tsx
git commit -m "refactor: align primary tab command bars"
```

---

## Task 3: Migrate Knowledge, Status, Problems, and Radar

**Files:**

- Modify: `src/renderer/src/features/knowledge/KnowledgeHome.tsx`
- Modify: `src/renderer/src/features/knowledge/knowledgeWorkspace.css`
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgeHome.test.tsx`
- Modify: `src/renderer/src/tabs/CloudStatusTab.tsx`
- Modify: `src/renderer/src/tabs/cloud-status.css`
- Modify: `src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx`
- Modify: `src/renderer/src/tabs/DynatraceProblemsTab.tsx`
- Modify: `src/renderer/src/tabs/dynatrace-problems.css`
- Modify: `src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx`
- Modify: `src/renderer/src/tabs/RadarTab.tsx`
- Modify: `src/renderer/src/tabs/radar.css`
- Modify: `src/renderer/src/tabs/__tests__/RadarTab.test.tsx`

### Step 1: Add failing shared-structure tests

Add focused assertions to the existing test files:

- Knowledge renders a shared `h1` titled `Knowledge`, exposes Wiki/contact/server counts in metadata,
  and has no empty toolbar.
- Status metadata retains the provider/update truth, while Refresh moves into a named utility-only
  toolbar as a `TactileButton`.
- Problems metadata retains `lastSyncLabel`; queue filters, profile, search, and Refresh appear in
  one utility group; no workflow group is created.
- Radar metadata retains textual Current/Stale status; Original and Refresh appear in one utility
  group as `TactileButton`s; refresh remains disabled/spinning while active.
- Existing data, stale/error, web recovery, click, and refresh tests continue to pass unchanged.

Example Status assertion:

```tsx
const toolbar = screen.getByRole('toolbar', { name: 'Status actions' });
expect(toolbar.querySelector('.tab-command-group--utility')).toContainElement(
  screen.getByRole('button', { name: 'Refresh cloud status' }),
);
expect(toolbar.querySelector('.tab-command-group--workflow')).toBeNull();
```

### Step 2: Run the focused tests and prove they fail

Run:

```bash
npm run test:renderer -- \
  src/renderer/src/features/knowledge/__tests__/KnowledgeHome.test.tsx \
  src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx \
  src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx \
  src/renderer/src/tabs/__tests__/RadarTab.test.tsx
```

Expected: FAIL because these tabs still use bespoke headers/actions.

### Step 3: Replace the Knowledge promotional hero

Render:

```tsx
<TabPageHeader
  context="Knowledge"
  title="Knowledge"
  headingId="knowledge-home-title"
  headingLevel={1}
  metadata={
    <span role="status">
      {wikiLabel} · {contactLabel} · {serverLabel}
    </span>
  }
/>
```

Use the existing count helper to produce honest labels, including unavailable counts. Remove the
promotional sentence and hero gradient/oversized heading rules. Do not render `TabCommandBar`
because Knowledge has no top-level action. Keep destination panels and their accessible names
unchanged.

### Step 4: Migrate Status

Use `TabPageHeader` for `Service status` / `External Status`. Keep the updated timestamp and summary
truth in metadata; move Refresh below it into a utility-only `TabCommandBar`. Replace the raw button
and Tooltip wrapper with `TactileButton`, retaining its aria-label, disabled state, tooltip, and
spinning icon class.

Remove `.cloud-status__refresh` geometry and bespoke header rules that duplicate shared chrome.
Leave provider cards, outage/degradation thresholds, feed errors, and refresh data flow untouched.

### Step 5: Migrate Problems

Use `TabPageHeader` for `Dynatrace Problems` / `Local Response Queue` and keep the sync-state class
and exact `lastSyncLabel` as metadata. Move Refresh from metadata into the existing tools area, then
wrap the filter and tool clusters in one utility `TabCommandGroup`. Preserve the tablist semantics,
profile picker, scoped search, local-response behavior, and filter order.

Change only top-level filter/tool geometry to consume `var(--tab-command-control-height)`. Do not
touch problem rows, response editors, history controls, or virtualization.

### Step 6: Migrate Radar

Use `TabPageHeader` for `Radar` / `Dispatcher Radar`. Keep the status dot and textual overall label
in metadata. Put Original and Refresh in an utility-only toolbar and convert Refresh to
`TactileButton`. Keep Original's secure external callback, Refresh's hook callback, web recovery,
stale state, and retained-snapshot behavior unchanged.

Remove bespoke `.radar-refresh` and `.radar-header-action` geometry while preserving the spin
animation and dashboard content styles.

### Step 7: Run the four-tab regression tests

Run:

```bash
npm run test:renderer -- \
  src/renderer/src/features/knowledge/__tests__/KnowledgeHome.test.tsx \
  src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx \
  src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx \
  src/renderer/src/tabs/__tests__/RadarTab.test.tsx
```

Expected: PASS, including all existing status/error/action tests.

### Step 8: Commit the remaining tab migration

```bash
git add src/renderer/src/features/knowledge/KnowledgeHome.tsx \
  src/renderer/src/features/knowledge/knowledgeWorkspace.css \
  src/renderer/src/features/knowledge/__tests__/KnowledgeHome.test.tsx \
  src/renderer/src/tabs/CloudStatusTab.tsx src/renderer/src/tabs/cloud-status.css \
  src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx \
  src/renderer/src/tabs/DynatraceProblemsTab.tsx \
  src/renderer/src/tabs/dynatrace-problems.css \
  src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx \
  src/renderer/src/tabs/RadarTab.tsx src/renderer/src/tabs/radar.css \
  src/renderer/src/tabs/__tests__/RadarTab.test.tsx
git commit -m "refactor: align remaining tab headers and actions"
```

---

## Task 4: Stabilize Header Search's action rail

**Files:**

- Modify: `src/renderer/src/components/HeaderSearch.tsx`
- Modify: `src/renderer/src/components/__tests__/HeaderSearch.test.tsx`
- Modify: `src/renderer/src/styles/modals.css`
- Modify: `src/renderer/src/styles/components.css`

### Step 1: Add failing behavior and structure tests

Extend `HeaderSearch.test.tsx` to prove:

- Every visible result has the stable icon/info/action-rail structure.
- Contacts display the concise `+ Bridge` text and accessible name `Add <name> to bridge`.
- Group rows display `Add group` as the primary verb and no secondary action.
- Contact primary click and Enter still open the contact without modifying Compose.
- Contact secondary pointer click and keyboard-generated click still add the address to Compose.
- Footer copy explains Enter for the primary row action and Tab for the secondary control.
- Clear search remains a button with its existing accessible name.

Use stable structure assertions rather than computed layout in jsdom:

```tsx
const contactOption = screen.getByRole('option', { name: /Andrew Park/i });
expect(contactOption.querySelector('.search-dropdown-result-icon')).not.toBeNull();
expect(contactOption.querySelector('.search-dropdown-result-info')).not.toBeNull();
expect(contactOption.querySelector('.search-dropdown-action-rail')).not.toBeNull();
expect(within(contactOption).getByRole('button', { name: 'Add Andrew Park to bridge' }))
  .toHaveTextContent('+ Bridge');
```

### Step 2: Run the focused test and prove it fails

Run:

```bash
npm run test:renderer -- src/renderer/src/components/__tests__/HeaderSearch.test.tsx
```

Expected: FAIL because the action rail and concise labels do not exist.

### Step 3: Make primary verbs concise

Keep result dispatch unchanged and return:

```ts
function primaryVerb(result: SearchResult): string {
  if (result.type === 'group') return 'Add group';
  if (result.type === 'action') {
    const action = (result.data as { action?: string }).action;
    if (action === 'create-contact') return 'Create';
    if (action === 'add-manual') return 'Add';
  }
  if (result.source === 'wiki-passage' || result.type === 'knowledge') return 'Open';
  if (result.type === 'contact' || result.type === 'server') return 'Open';
  return 'Select';
}
```

Do not change `handleSelect`, `handleSecondarySelect`, Arrow navigation, Enter handling, search
clearing, or `aria-activedescendant`.

### Step 4: Render a stable three-column row

Keep the primary action as the main button, but move its verb and the optional contact action into a
stable rail inside the row:

```tsx
<div
  className={`search-dropdown-result-row${
    result.type === 'contact' && onSecondarySelect ? ' has-secondary-action' : ''
  }`}
>
  <button className="search-dropdown-hitbox" onClick={() => onSelect(result)}>
    <span className="search-dropdown-result-icon">
      <RenderIcon result={result} />
    </span>
    <span className="search-dropdown-result-info">
      <span className="search-dropdown-result-title">{result.title}</span>
      {result.subtitle ? (
        <span className="search-dropdown-result-subtitle">{result.subtitle}</span>
      ) : null}
    </span>
    <span className="search-dropdown-action-rail">
      <span className="search-dropdown-result-verb">{primaryVerb(result)}</span>
    </span>
  </button>
  {result.type === 'contact' && onSecondarySelect ? (
    <button
      className="search-dropdown-secondary-action"
      aria-label={`Add ${result.title} to bridge`}
      onClick={() => onSecondarySelect(result)}
    >
      + Bridge
    </button>
  ) : null}
</div>
```

Keep the secondary button as a sibling to avoid nested interactive elements. Make the primary
button a full-row three-column grid (icon, information, action rail), reserve secondary-action space
in the rail when `.has-secondary-action` is present, and position the sibling secondary button
inside that reserved rail. The secondary button must remain above the primary hitbox in stacking
order and retain its own focus ring.

### Step 5: Apply the responsive grid and clear hit target

Use `position: relative` on the result row and a three-column grid on the full-width primary hitbox.
Keep its icon and information columns unchanged, reserve a fixed-width action rail, and absolutely
place the compact secondary button at the inline end of that rail. This preserves the primary
button's complete hover/focus/selected surface while keeping the secondary button independently
focusable.

Set the dropdown maximum width to 540px while retaining the current viewport clamp. Use an action
rail around 64–76px and a compact contact action around 72px. At the constrained breakpoint,
shorten or wrap the rail without allowing the information column below a usable width.

Increase `.header-search-bar-clear` to a 32px square hit target inside the existing 36px rail; keep
the icon 14px and do not increase header height. Add `:focus-visible` styling matching Relay's other
controls.

Update footer text to name Enter and Tab without claiming Tab when no secondary contact action is
present in the current result set.

### Step 6: Run Header Search regression tests

Run:

```bash
npm run test:renderer -- src/renderer/src/components/__tests__/HeaderSearch.test.tsx
```

Expected: PASS, including all existing async Wiki-passage, pointer, keyboard, and ARIA tests.

### Step 7: Commit the search action-rail change

```bash
git add src/renderer/src/components/HeaderSearch.tsx \
  src/renderer/src/components/__tests__/HeaderSearch.test.tsx \
  src/renderer/src/styles/modals.css src/renderer/src/styles/components.css
git commit -m "refactor: stabilize header search actions"
```

---

## Task 5: Document the shared visual contract

**Files:**

- Modify: `docs/DESIGN.md`

### Step 1: Add the canonical contract

Document:

- The three-band top-level frame: page header, optional command row, working canvas.
- Compose as the visual reference.
- Utility controls at 36px and workflow controls at 40px.
- Utility-left/workflow-right grouping, Title Case labels, one filled primary at most.
- UI-font metadata with tabular numerals and text labels for status colors.
- No empty command row for Knowledge.
- Header Search's context-preserving primary row and compact `+ Bridge` secondary action.
- The top-level-only boundary; nested pane/editor/table/PDF toolbars are not governed by this
  contract.

### Step 2: Check the documentation formatting

Run:

```bash
npx prettier --check docs/DESIGN.md
git diff --check
```

Expected: PASS.

### Step 3: Commit the design documentation

```bash
git add docs/DESIGN.md
git commit -m "docs: document shared top-level tab chrome"
```

---

## Task 6: Add Electron layout and zoom contracts

**Files:**

- Modify: `tests/e2e/redesign-screenshots.spec.ts`
- Modify: `tests/e2e/css-visual-contracts.spec.ts`

### Step 1: Add failing shared layout assertions

Extend `css-visual-contracts.spec.ts` to visit all seven top-level tabs and assert:

- `.tab-page-header` is visible and its title does not overlap metadata.
- A tab with actions has a visible named `.tab-command-bar`; Knowledge has none.
- Utility TactileButtons compute to 36px high.
- Workflow TactileButtons and icon-only overflow compute to 40px square/high.
- Each toolbar's `scrollWidth <= clientWidth` at the standard viewport.
- At a constrained viewport, the first utility control precedes the first workflow control in DOM
  and keyboard order.
- Header Search name/subtitle and action controls remain inside the dropdown bounds.

Implement one reusable measurement helper:

```ts
const geometry = await page.locator('.tab-command-bar').evaluate((toolbar) => ({
  clientWidth: toolbar.clientWidth,
  scrollWidth: toolbar.scrollWidth,
  utilityHeights: Array.from(
    toolbar.querySelectorAll('.tab-command-group--utility .tactile-button'),
    (element) => element.getBoundingClientRect().height,
  ),
  workflowHeights: Array.from(
    toolbar.querySelectorAll('.tab-command-group--workflow .tactile-button'),
    (element) => element.getBoundingClientRect().height,
  ),
}));
```

### Step 2: Add visual coverage for every tab and 150% zoom

Extend `redesign-screenshots.spec.ts` so the existing deterministic harness captures Compose,
Alerts, On-Call, Knowledge, Status, Problems, and Radar with shared top-level chrome. Add one
crowded-toolbar capture at 150% zoom using the existing Electron page and deterministic dummy data.
Reset zoom after the assertion in a `finally` block so later screenshots remain stable.

Do not regenerate or commit screenshots until the assertions and visual inspection both pass.

### Step 3: Run the targeted Electron tests and prove failures before final CSS adjustment

Run:

```bash
npm run test:electron -- --grep "tab chrome|toolbar geometry|150% zoom|Redesign screenshot harness"
```

Expected on the first run: at least one new assertion or screenshot fails until responsive styles
are finalized.

### Step 4: Make the smallest responsive corrections

Adjust only `tab-chrome.css` and the top-level selectors in the affected tab stylesheet. Preserve
DOM order, do not use negative offsets to conceal overlap, and do not change nested toolbar rules.
Confirm metadata wraps, command groups stack, and no action becomes unreachable.

### Step 5: Run all Electron tests

Run:

```bash
npm run test:electron
```

Expected: PASS. Inspect generated captures for all seven tabs and the 150% crowded-toolbar case;
command groups must align, labels must remain readable, and Header Search actions must stay fixed.

### Step 6: Commit Electron coverage and final responsive CSS

```bash
git add tests/e2e/redesign-screenshots.spec.ts tests/e2e/css-visual-contracts.spec.ts \
  src/renderer/src/styles/tab-chrome.css src/renderer/src/tabs/assembler/assembler.css \
  src/renderer/src/tabs/alerts.css src/renderer/src/components/oncall/oncall.css \
  src/renderer/src/features/knowledge/knowledgeWorkspace.css \
  src/renderer/src/tabs/cloud-status.css src/renderer/src/tabs/dynatrace-problems.css \
  src/renderer/src/tabs/radar.css src/renderer/src/styles/modals.css \
  src/renderer/src/styles/components.css
git commit -m "test: verify shared tab chrome across Electron layouts"
```

---

## Task 7: Run the UI detector and complete verification

**Files:**

- Inspect all files changed in Tasks 1–6.
- Modify only a changed target if a detector finding is valid and in scope.

### Step 1: Run the Impeccable detector once on the finished UI patch

Run:

```bash
node /Users/ryan/.agents/skills/impeccable/scripts/detect.mjs --json \
  src/renderer/src/components/tab-chrome/TabChrome.tsx \
  src/renderer/src/styles/tab-chrome.css \
  src/renderer/src/tabs/AssemblerTab.tsx \
  src/renderer/src/tabs/AlertsTab.tsx \
  src/renderer/src/tabs/PersonnelTab.tsx \
  src/renderer/src/features/knowledge/KnowledgeHome.tsx \
  src/renderer/src/tabs/CloudStatusTab.tsx \
  src/renderer/src/tabs/DynatraceProblemsTab.tsx \
  src/renderer/src/tabs/RadarTab.tsx \
  src/renderer/src/components/HeaderSearch.tsx
```

Review each finding against the approved design. Fix only real in-scope regressions; record
out-of-scope nested-toolbar observations without changing them.

### Step 2: Run focused renderer coverage together

Run:

```bash
npm run test:renderer -- \
  src/renderer/src/components/tab-chrome/TabChrome.test.tsx \
  src/renderer/src/components/__tests__/HeaderSearch.test.tsx \
  src/renderer/src/tabs/__tests__/AssemblerTab.test.tsx \
  src/renderer/src/tabs/__tests__/AlertsTab.test.tsx \
  src/renderer/src/tabs/__tests__/PersonnelTab.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgeHome.test.tsx \
  src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx \
  src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx \
  src/renderer/src/tabs/__tests__/RadarTab.test.tsx
```

Expected: PASS.

### Step 3: Run the repository completion gates

Run each command independently and retain its result:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
git diff --check
npm audit --audit-level=high --omit=dev
```

Expected: every command exits 0. If a formatter or hook changes a file, inspect the diff and rerun
every affected focused test plus the completion gates.

### Step 4: Re-run the Electron suite after the production build

Run:

```bash
npm run test:electron
```

Expected: PASS after the native-module ABI restoration performed by the repository script.

### Step 5: Inspect the final patch and commit any verified cleanup

Run:

```bash
git status --short --branch
git diff --stat HEAD~6..HEAD
git diff --check
```

If detector or verification cleanup remains uncommitted, stage only these in-scope targets and
commit:

```bash
git add src/renderer/src/components/tab-chrome/TabChrome.tsx \
  src/renderer/src/components/tab-chrome/TabChrome.test.tsx \
  src/renderer/src/styles/tab-chrome.css src/renderer/src/styles.css \
  src/renderer/src/tabs/AssemblerTab.tsx \
  src/renderer/src/tabs/assembler/assembler.css \
  src/renderer/src/tabs/__tests__/AssemblerTab.test.tsx \
  src/renderer/src/tabs/AlertsTab.tsx \
  src/renderer/src/tabs/alerts/AlertActionsMenu.tsx \
  src/renderer/src/tabs/alerts.css \
  src/renderer/src/tabs/__tests__/AlertsTab.test.tsx \
  src/renderer/src/tabs/PersonnelTab.tsx \
  src/renderer/src/components/oncall/oncall.css \
  src/renderer/src/tabs/__tests__/PersonnelTab.test.tsx \
  src/renderer/src/features/knowledge/KnowledgeHome.tsx \
  src/renderer/src/features/knowledge/knowledgeWorkspace.css \
  src/renderer/src/features/knowledge/__tests__/KnowledgeHome.test.tsx \
  src/renderer/src/tabs/CloudStatusTab.tsx \
  src/renderer/src/tabs/cloud-status.css \
  src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx \
  src/renderer/src/tabs/DynatraceProblemsTab.tsx \
  src/renderer/src/tabs/dynatrace-problems.css \
  src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx \
  src/renderer/src/tabs/RadarTab.tsx src/renderer/src/tabs/radar.css \
  src/renderer/src/tabs/__tests__/RadarTab.test.tsx \
  src/renderer/src/components/HeaderSearch.tsx \
  src/renderer/src/components/__tests__/HeaderSearch.test.tsx \
  src/renderer/src/styles/modals.css src/renderer/src/styles/components.css \
  docs/DESIGN.md tests/e2e/redesign-screenshots.spec.ts \
  tests/e2e/css-visual-contracts.spec.ts
git commit -m "fix: finish tab chrome alignment verification"
```

Do not push from this plan. Publishing to `origin/test` is a separate GitHub workflow that requires
the repository's temporary `codex/` branch, pull request, and all three required green checks.

## Definition of done

- All seven top-level destinations use `TabPageHeader`.
- Every tab with top-level actions uses `TabCommandBar` and the approved group mapping.
- Knowledge renders no empty toolbar.
- Utility controls are 36px; workflow controls and overflow are 40px.
- Compose remains the visual baseline and all existing actions retain their callbacks and states.
- Alerts and On-Call no longer mix peer control heights.
- Status, Problems, and Radar no longer use raw bespoke top-level refresh buttons.
- Header Search has stable inline actions, compact `+ Bridge`, preserved pointer/keyboard behavior,
  and a usable clear hit target.
- Standard, constrained, and 150% zoom Electron layouts are free of overlap, clipping, overflow,
  or focus-order changes.
- Focused tests, full tests, build, audit, Electron tests, formatting, lint, typecheck, detector review,
  and `git diff --check` pass.
