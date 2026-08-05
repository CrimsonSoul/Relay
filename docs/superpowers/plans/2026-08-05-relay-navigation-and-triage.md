# Relay Navigation and Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete top-level shortcut parity, add safe keyboard movement through unaddressed Dynatrace problems, and make the compact sidebar readable through a non-reflowing hover/focus overlay.

**Architecture:** The existing global shortcut hook gains Radar as destination seven. Dynatrace Problems receives an `active` flag from App and a focused hook that handles only Alt+Up/Down/N outside editable or modal contexts; the tab owns queue selection and exposes its note textarea through a ref. A fixed-width `sidebar-shell` remains in the app flex layout while its inner sidebar expands above content at compact widths through CSS `:hover`/`:focus-within`, so no renderer state or content reflow is introduced.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, react-window, CSS media queries and reduced-motion preferences.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-05-relay-tab-operator-workflows-design.md`.
- Cmd/Ctrl+7 opens Radar and uses the same modal guard as Cmd/Ctrl+1-6.
- Alt+Down selects the next unaddressed problem; Alt+Up selects the previous; navigation wraps only when at least one unaddressed problem exists.
- Alt+N focuses the selected problem's response-note editor and never submits or changes disposition.
- Dynatrace shortcuts run only while Problems is the active top-level tab.
- Suppress triage shortcuts for input, textarea, select, content-editable targets, and any open modal.
- When no unaddressed problem exists, preserve selection and issue one concise informational toast per key activation.
- Compact sidebar resting width stays `64px`; expanded overlay shows labels without changing main-content width.
- The overlay remains open while pointer hover or keyboard focus is anywhere in the rail and closes after both leave.
- Reduced motion removes the width animation but not labels or interaction.
- Preserve Radar status, client presence, dashboards, Settings, active state, accessible names, and tooltips.
- Do not add On-Call coverage computation or status.

---

### Task 1: Radar shortcut parity and documentation

**Files:**
- Modify: `src/renderer/src/hooks/useKeyboardShortcuts.ts`
- Modify: `src/renderer/src/hooks/__tests__/useKeyboardShortcuts.test.ts`
- Modify: `src/renderer/src/components/ShortcutsModal.tsx`
- Modify: `src/renderer/src/components/__tests__/ShortcutsModal.test.tsx`

**Interfaces:**
- Consumes: existing `setActiveTab(TabName)` and modal stack guard.
- Produces: key `7` → `Radar` plus visible shortcut help.

- [ ] **Step 1: Add failing key-map and modal-copy assertions**

```ts
it.each([
  ['1', 'Compose'],
  ['2', 'Alerts'],
  ['3', 'Personnel'],
  ['4', 'Knowledge'],
  ['5', 'Status'],
  ['6', 'Problems'],
  ['7', 'Radar'],
] as const)('maps Cmd+%s to %s', (key, tab) => {
  const setActiveTab = vi.fn();
  renderHook(() =>
    useKeyboardShortcuts({
      setActiveTab,
      openSettings: vi.fn(),
      setIsShortcutsOpen: vi.fn(),
      searchInputRef: React.createRef<HTMLInputElement>(),
    }),
  );
  fireEvent.keyDown(window, { key, metaKey: true });
  expect(setActiveTab).toHaveBeenCalledWith(tab);
});

expect(screen.getByText('Go to Dispatcher Radar')).toBeInTheDocument();
expect(screen.getByText('Next unaddressed problem')).toBeInTheDocument();
expect(screen.getByText('Previous unaddressed problem')).toBeInTheDocument();
expect(screen.getByText('Focus selected problem note')).toBeInTheDocument();
```

Change the unassigned-key parameterized test to cover only `8` and `9`.

- [ ] **Step 2: Run shortcut tests to verify the Radar assertions fail**

Run: `npm run test:renderer -- src/renderer/src/hooks/__tests__/useKeyboardShortcuts.test.ts src/renderer/src/components/__tests__/ShortcutsModal.test.tsx`

Expected: FAIL because key 7 and Radar copy are absent.

- [ ] **Step 3: Add Radar to the key map and modal**

```ts
const tabMap: Partial<Record<string, TabName>> = {
  '1': 'Compose',
  '2': 'Alerts',
  '3': 'Personnel',
  '4': 'Knowledge',
  '5': 'Status',
  '6': 'Problems',
  '7': 'Radar',
};
```

Add `{ keys: `${modKey} + 7`, description: 'Go to Dispatcher Radar' }` immediately after Problems in `ShortcutsModal` and update the comment from `Cmd/Ctrl+1-6` to `Cmd/Ctrl+1-7`. Add a `Dynatrace Problems` shortcut section with these exact items:

```ts
{
  category: 'Dynatrace Problems',
  items: [
    { keys: 'Alt + ↓', description: 'Next unaddressed problem' },
    { keys: 'Alt + ↑', description: 'Previous unaddressed problem' },
    { keys: 'Alt + N', description: 'Focus selected problem note' },
  ],
}
```

- [ ] **Step 4: Run shortcut tests to verify they pass**

Run: `npm run test:renderer -- src/renderer/src/hooks/__tests__/useKeyboardShortcuts.test.ts src/renderer/src/components/__tests__/ShortcutsModal.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit Radar shortcut parity**

```bash
git add src/renderer/src/hooks/useKeyboardShortcuts.ts src/renderer/src/hooks/__tests__/useKeyboardShortcuts.test.ts src/renderer/src/components/ShortcutsModal.tsx src/renderer/src/components/__tests__/ShortcutsModal.test.tsx
git commit -m "feat: add Radar navigation shortcut"
```

### Task 2: Isolated Dynatrace triage shortcut hook

**Files:**
- Create: `src/renderer/src/hooks/useDynatraceProblemShortcuts.ts`
- Create: `src/renderer/src/hooks/__tests__/useDynatraceProblemShortcuts.test.ts`

**Interfaces:**
- Consumes: `active`, ordered unaddressed problem IDs, current selection, a selection callback, note-focus callback, and no-problems callback.
- Produces: exported `UseDynatraceProblemShortcutsParams` and guarded Alt+Down, Alt+Up, and Alt+N keyboard behavior without importing Dynatrace data services.

- [ ] **Step 1: Write failing navigation, wrapping, focus, and guard tests**

```ts
const defaultShortcutProps: UseDynatraceProblemShortcutsParams = {
  active: true,
  unaddressedProblemIds: ['P-1', 'P-2', 'P-3'],
  selectedProblemId: 'P-2',
  onSelectProblem: vi.fn(),
  onFocusNote: vi.fn(),
  onNoUnaddressedProblems: vi.fn(),
};

const renderShortcuts = (
  overrides: Partial<UseDynatraceProblemShortcutsParams> = {},
) =>
  renderHook(() =>
    useDynatraceProblemShortcuts({
      ...defaultShortcutProps,
      ...overrides,
    }),
  );

it.each([
  ['ArrowDown', 'P-3'],
  ['ArrowUp', 'P-1'],
] as const)('moves with Alt+%s', (key, expected) => {
  const onSelectProblem = vi.fn();
  renderShortcuts({ onSelectProblem });
  fireEvent.keyDown(window, { key, altKey: true });
  expect(onSelectProblem).toHaveBeenCalledWith(expected);
});

it('wraps at both queue boundaries', () => {
  const onSelectProblem = vi.fn();
  renderShortcuts({ selectedProblemId: 'P-3', onSelectProblem });
  fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
  expect(onSelectProblem).toHaveBeenCalledWith('P-1');
});

it('focuses the selected note editor with Alt+N', () => {
  const onFocusNote = vi.fn();
  renderShortcuts({ onFocusNote });
  fireEvent.keyDown(window, { key: 'n', altKey: true });
  expect(onFocusNote).toHaveBeenCalledOnce();
});

it('reports an empty unaddressed queue without changing selection', () => {
  const onSelectProblem = vi.fn();
  const onNoUnaddressedProblems = vi.fn();
  renderShortcuts({
    unaddressedProblemIds: [],
    onSelectProblem,
    onNoUnaddressedProblems,
  });
  fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
  expect(onNoUnaddressedProblems).toHaveBeenCalledOnce();
  expect(onSelectProblem).not.toHaveBeenCalled();
});

it('does nothing while the Problems tab is inactive', () => {
  const onSelectProblem = vi.fn();
  renderShortcuts({ active: false, onSelectProblem });
  fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
  expect(onSelectProblem).not.toHaveBeenCalled();
});

it('does nothing while a modal is open', () => {
  const onSelectProblem = vi.fn();
  renderHook(() => {
    useModalStack('triage-shortcut-modal', true);
    useDynatraceProblemShortcuts({
      active: true,
      unaddressedProblemIds: ['P-1'],
      selectedProblemId: 'P-1',
      onSelectProblem,
      onFocusNote: vi.fn(),
      onNoUnaddressedProblems: vi.fn(),
    });
  });
  fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
  expect(onSelectProblem).not.toHaveBeenCalled();
});

it.each(['input', 'textarea', 'select'] as const)(
  'does nothing from an editable %s target',
  (tagName) => {
    const onSelectProblem = vi.fn();
    renderShortcuts({ onSelectProblem });
    const target = document.createElement(tagName);
    document.body.append(target);
    fireEvent.keyDown(target, { key: 'ArrowDown', altKey: true });
    expect(onSelectProblem).not.toHaveBeenCalled();
    target.remove();
  },
);

it('does nothing from a content-editable target', () => {
  const onSelectProblem = vi.fn();
  renderShortcuts({ onSelectProblem });
  const target = document.createElement('div');
  target.contentEditable = 'true';
  document.body.append(target);
  fireEvent.keyDown(target, { key: 'n', altKey: true });
  expect(onSelectProblem).not.toHaveBeenCalled();
  target.remove();
});
```

Import `useModalStack` from `../../components/modalStack` in the hook test. Keep modal registration inside the same `renderHook` callback as the triage hook so registration and cleanup share the test lifecycle.

- [ ] **Step 2: Run the new hook test to verify it fails**

Run: `npm run test:renderer -- src/renderer/src/hooks/__tests__/useDynatraceProblemShortcuts.test.ts`

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement editable-target and modal guards**

```ts
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select') ||
      target.isContentEditable ||
      target.closest('[contenteditable="true"]') !== null)
  );
}

if (!active || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
if (isAnyModalOpen() || isEditableTarget(event.target)) return;
```

- [ ] **Step 4: Implement bounded triage actions**

```ts
if (event.key.toLowerCase() === 'n') {
  if (!selectedProblemId) return;
  event.preventDefault();
  onFocusNote();
  return;
}

if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
event.preventDefault();
if (unaddressedProblemIds.length === 0) {
  onNoUnaddressedProblems();
  return;
}
const current = unaddressedProblemIds.indexOf(selectedProblemId ?? '');
const direction = event.key === 'ArrowDown' ? 1 : -1;
const origin = current < 0 ? (direction === 1 ? -1 : 0) : current;
const next = (origin + direction + unaddressedProblemIds.length) % unaddressedProblemIds.length;
onSelectProblem(unaddressedProblemIds[next]!);
```

- [ ] **Step 5: Run the hook tests to verify all guards and actions pass**

Run: `npm run test:renderer -- src/renderer/src/hooks/__tests__/useDynatraceProblemShortcuts.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the isolated triage hook**

```bash
git add src/renderer/src/hooks/useDynatraceProblemShortcuts.ts src/renderer/src/hooks/__tests__/useDynatraceProblemShortcuts.test.ts
git commit -m "feat: add guarded Dynatrace triage shortcuts"
```

### Task 3: Wire triage shortcuts to the retained Problems tab

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/__tests__/App.test.tsx`
- Modify: `src/renderer/src/tabs/DynatraceProblemsTab.tsx`
- Modify: `src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx`

**Interfaces:**
- Consumes: `useDynatraceProblemShortcuts` from Task 2.
- Produces: optional `active?: boolean` prop (default `true` for direct tests), sorted unaddressed selection, note textarea focus, and empty-queue toast.

- [ ] **Step 1: Add failing App active-state and Dynatrace integration tests**

```tsx
it('marks the retained Problems tab active only while it is selected', async () => {
  mockActiveTab = 'Problems';
  const { rerender } = renderApp();
  await waitFor(() => expect(lastDynatraceProblemsProps?.active).toBe(true));
  mockActiveTab = 'Compose';
  rerender(<MainApp />);
  expect(lastDynatraceProblemsProps?.active).toBe(false);
  mockActiveTab = 'Problems';
  rerender(<MainApp />);
  expect(lastDynatraceProblemsProps?.active).toBe(true);
});

it('switches to the unaddressed queue and selects the next problem with Alt+Down', async () => {
  const nextProblem = {
    ...openProblem,
    id: 'pb-2',
    problemId: 'problem-2',
    displayId: 'P-240792',
    title: 'Checkout service response time degradation',
    startTime: openProblem.startTime + 1,
  };
  mocks.hookValue = { ...mocks.hookValue, problems: [openProblem, nextProblem] };
  render(<DynatraceProblemsTab relayMode="client" active />);
  await screen.findByRole('heading', { name: openProblem.title });
  fireEvent.click(screen.getByRole('tab', { name: /Addressed locally/ }));
  fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
  expect(screen.getByRole('tab', { name: /Unaddressed/ })).toHaveAttribute('aria-selected', 'true');
  expect(
    await screen.findByRole('heading', { name: 'Checkout service response time degradation' }),
  ).toBeVisible();
});

it('focuses the selected note editor with Alt+N without changing draft or disposition', async () => {
  render(<DynatraceProblemsTab relayMode="client" active />);
  await screen.findByRole('heading', { name: openProblem.title });
  fireEvent.keyDown(window, { key: 'n', altKey: true });
  expect(screen.getByLabelText('Add a note')).toHaveFocus();
  expect(mocks.setAddressed).not.toHaveBeenCalled();
  expect(mocks.addNote).not.toHaveBeenCalled();
});
```

In `App.test.tsx`, add a `lastDynatraceProblemsProps` capture and mock `DynatraceProblemsTab` exactly as the existing Knowledge and Cloud Status lazy-tab mocks do; reset the capture in `beforeEach` and `afterEach`.

- [ ] **Step 2: Run App and Dynatrace tests to verify integration fails**

Run: `npm run test:renderer -- src/renderer/src/__tests__/App.test.tsx src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx -t "retained Problems|Alt\+|next problem|note editor"`

Expected: FAIL because active state and the textarea ref are not wired.

- [ ] **Step 3: Pass the active flag from App without unmounting the tab**

```tsx
<DynatraceProblemsTab
  relayMode={relayConfig?.mode}
  active={activeTab === 'Problems'}
/>
```

Update the lazy-tab mock capture in `App.test.tsx`. Keep `RetainedTabPanel` behavior unchanged.

- [ ] **Step 4: Expose the note textarea through ProblemDetail**

```ts
noteInputRef: React.RefObject<HTMLTextAreaElement | null>;
```

Add that field to `ProblemDetailProps`, destructure it in `ProblemDetail`, and pass `ref={noteInputRef}` to `textarea[name="dynatrace-problem-note"]`. Create `const noteInputRef = useRef<HTMLTextAreaElement>(null)` in `DynatraceProblemsTab` and pass it to `ProblemDetail`.

- [ ] **Step 5: Build the unaddressed ID queue and wire the hook**

```ts
const unaddressedProblemIds = useMemo(
  () =>
    problems
      .filter(
        (problem) =>
          problem.status !== 'CLOSED' &&
          !isAddressed(stateByProblemId.get(problem.problemId)),
      )
      .sort(problemSort)
      .map((problem) => problem.problemId),
  [problems, stateByProblemId],
);

useDynatraceProblemShortcuts({
  active,
  unaddressedProblemIds,
  selectedProblemId,
  onSelectProblem: (problemId) => {
    setFilter('unaddressed');
    setQuery('');
    setSelectedProblemId(problemId);
  },
  onFocusNote: () => noteInputRef.current?.focus(),
  onNoUnaddressedProblems: () => showToast('No unaddressed Dynatrace problems.', 'info'),
});
```

Default `active = true` in the component signature so existing direct unit tests preserve their mounted behavior; App always passes the real active state.

- [ ] **Step 6: Run complete Dynatrace tab and hook tests**

Run: `npm run test:renderer -- src/renderer/src/hooks/__tests__/useDynatraceProblemShortcuts.test.ts src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx src/renderer/src/__tests__/App.test.tsx`

Expected: PASS, including existing draft-preservation and realtime selection-fallback tests.

- [ ] **Step 7: Commit retained-tab triage wiring**

```bash
git add src/renderer/src/App.tsx src/renderer/src/__tests__/App.test.tsx src/renderer/src/tabs/DynatraceProblemsTab.tsx src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx
git commit -m "feat: wire Dynatrace keyboard triage"
```

### Task 4: Non-reflowing compact sidebar overlay

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/components/__tests__/Sidebar.test.tsx`
- Modify: `src/renderer/src/components/sidebar/sidebar.css`
- Modify: `src/renderer/src/styles/responsive.css`
- Modify: `src/renderer/src/__tests__/responsiveShell.test.ts`

**Interfaces:**
- Consumes: current Sidebar contents and the app shell's flex layout.
- Produces: a fixed-basis `.sidebar-shell` and inner `.sidebar` that expands over content on compact hover/focus.

- [ ] **Step 1: Add failing structure and CSS contract tests**

```tsx
it('renders a fixed-width shell around the navigation surface', () => {
  const { container } = render(<Sidebar {...defaultProps} />);
  expect(container.querySelector('.sidebar-shell > .sidebar')).not.toBeNull();
});
```

```ts
it('expands compact labels over content on hover or focus without changing shell width', () => {
  const compactBlock = mediaBlock(responsiveCss, 'max-width: 1200px') ?? '';
  expect(compactBlock).toContain('.sidebar-shell');
  expect(compactBlock).toContain('flex: 0 0 var(--sidebar-width-collapsed)');
  expect(compactBlock).toMatch(/\.sidebar-shell:is\(:hover,\s*:focus-within\)\s+\.sidebar/);
  expect(compactBlock).toMatch(/width:\s*136px/);
  expect(compactBlock).toMatch(/\.sidebar-shell:is\(:hover,\s*:focus-within\)[\s\S]*?\.sidebar-button-label[\s\S]*?display:\s*block/);
});
```

- [ ] **Step 2: Run Sidebar and shell tests to verify they fail**

Run: `npm run test:renderer -- src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/__tests__/responsiveShell.test.ts`

Expected: FAIL because Sidebar has no fixed-basis wrapper and compact labels stay hidden.

- [ ] **Step 3: Wrap the existing sidebar surface without changing its children**

```tsx
return (
  <div className="sidebar-shell">
    <aside className="sidebar" aria-label="Relay navigation">
```

Keep the current app icon, nav, footer, presence, dashboard, and Settings JSX between the new opening and closing tags, then replace the current final `</div>` with:

```tsx
    </aside>
  </div>
);
```

Keep every current `SidebarButton` prop, Radar status object, presence condition, and dashboard callback unchanged.

- [ ] **Step 4: Give the shell fixed layout ownership and the surface overlay ownership**

```css
.sidebar-shell {
  position: relative;
  z-index: 9002;
  flex: 0 0 var(--sidebar-width-collapsed);
  min-width: var(--sidebar-width-collapsed);
  height: 100%;
}

.sidebar {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--sidebar-width-collapsed);
}
```

The normal desktop sidebar remains `136px`, matching the existing `--sidebar-width-collapsed` value in `theme.css`.

- [ ] **Step 5: Add compact hover/focus expansion and reduced-motion handling**

```css
@media (max-width: 1200px) {
  .sidebar {
    transition: width var(--motion-duration-state) var(--motion-ease-out);
  }

  .sidebar-shell:is(:hover, :focus-within) .sidebar {
    width: 136px;
    box-shadow: var(--shadow-lg);
  }

  .sidebar-shell:is(:hover, :focus-within) .sidebar-button {
    --sidebar-button-width: 120px;
    align-items: flex-start;
    padding: 8px 10px;
  }

  .sidebar-shell:is(:hover, :focus-within) .sidebar-button-label {
    display: block;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sidebar { transition: none; }
}
```

Also restore the full `Relay` app-icon label only in the expanded compact state and keep status dots inside the `120px` button footprint.

- [ ] **Step 6: Run Sidebar button, presence, dashboard, and shell tests**

Run: `npm run test:renderer -- src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx src/renderer/src/components/__tests__/sidebar/SidebarClientStatus.test.tsx src/renderer/src/components/__tests__/sidebar/SidebarDashboards.test.tsx src/renderer/src/__tests__/responsiveShell.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit compact sidebar readability**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/sidebar/sidebar.css src/renderer/src/styles/responsive.css src/renderer/src/__tests__/responsiveShell.test.ts
git commit -m "feat: expand compact sidebar labels on focus"
```

### Task 5: Document compact navigation and triage shortcuts

**Files:**
- Modify: `docs/DESIGN.md`

**Interfaces:**
- Consumes: completed Radar shortcut, Dynatrace triage, and compact-sidebar behavior.
- Produces: canonical interaction guidance for keyboard and compact-width navigation.

- [ ] **Step 1: Add compact navigation guidance under Styling Rules**

```md
### Compact navigation

At widths at or below 1200 px, the sidebar rests at 64 px and expands labeled navigation above the
content on hover or keyboard focus; the active tab never reflows. The overlay remains open while
either pointer or focus is inside the rail, and reduced-motion mode removes its width animation.
Top-level shortcuts follow sidebar order through Cmd/Ctrl+7 for Radar. While Problems is active,
Alt+Down and Alt+Up move through unaddressed problems and Alt+N focuses the selected response note;
editable controls and modals suppress these triage shortcuts.
```

- [ ] **Step 2: Check the edited canonical document**

Run: `npx prettier --check docs/DESIGN.md && git diff --check`

Expected: both commands exit 0.

- [ ] **Step 3: Commit the navigation design update**

```bash
git add docs/DESIGN.md
git commit -m "docs: describe compact navigation workflow"
```

### Task 6: Navigation and triage readiness gate

**Files:**
- Modify only files required by failures attributable to Tasks 1-4.

**Interfaces:**
- Consumes: completed shortcut, triage, and sidebar slices.
- Produces: verified navigation behavior ready to combine with the other Relay tab plans.

- [ ] **Step 1: Run the complete navigation renderer slice**

Run: `npm run test:renderer -- src/renderer/src/hooks/__tests__/useKeyboardShortcuts.test.ts src/renderer/src/hooks/__tests__/useDynatraceProblemShortcuts.test.ts src/renderer/src/components/__tests__/ShortcutsModal.test.tsx src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/__tests__/responsiveShell.test.ts src/renderer/src/__tests__/App.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run static gates for the slice**

Run: `npm run typecheck && npm run lint && npm run format:check && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Perform a manual keyboard smoke test in both compact and full-width windows**

Run: `npm run dev`

Expected:

- Cmd/Ctrl+7 opens Radar unless a modal is open.
- Alt+Down/Up moves only through unaddressed problems while Problems is active.
- Alt+N focuses the selected note editor; editable fields and modals suppress the shortcuts.
- At widths at or below 1200px, hover or focus expands readable sidebar labels over content without moving the header or active tab.
- Moving pointer and focus outside the sidebar returns it to 64px; reduced-motion mode removes the width animation.

### Task 7: Combined Relay tab readiness gate

**Files:**
- Modify only files required by failures attributable to the four approved subsystem plans.

**Interfaces:**
- Consumes: all completed tasks in `2026-08-05-relay-search-record-navigation.md`, `2026-08-05-relay-cloud-degradation-threshold.md`, `2026-08-05-relay-alerts-action-hierarchy.md`, and this plan.
- Produces: one fully verified branch tip containing all approved Relay tab improvements except truthful On-Call coverage.

- [ ] **Step 1: Confirm all four plan-specific readiness gates are complete**

Run: `git status --short --branch && git log --oneline --decorate -20`

Expected: the branch contains the search, cloud, Alerts, navigation, and documentation commits; no unrelated tracked changes are present. Preserve `.impeccable/` as untracked unless the user separately asks to publish it.

- [ ] **Step 2: Run the repository type and style gates**

Run: `npm run typecheck && npm run lint && npm run format:check`

Expected: all commands exit 0.

- [ ] **Step 3: Run the full unit, cache, and renderer suites**

Run: `npm test`

Expected: all Vitest suites pass with zero failures.

- [ ] **Step 4: Build the production renderer and Electron bundles**

Run: `npm run build`

Expected: exit 0 with renderer, preload, and main bundles produced.

- [ ] **Step 5: Run Electron integration coverage through the repository wrapper**

Run: `npm run test:electron`

Expected: exit 0; the wrapper restores native-module ABI state after the suite.

- [ ] **Step 6: Run Relay Web integration coverage through the repository wrapper**

Run: `npm run test:web`

Expected: exit 0 with shared renderer behavior passing in the browser runtime.

- [ ] **Step 7: Run the readiness security audit**

Run: `npm audit --audit-level=high --omit=dev`

Expected: exit 0 with no high or critical production dependency vulnerability.

- [ ] **Step 8: Check whitespace and final scope**

Run: `git diff --check && git status --short --branch && git diff --stat "$(git merge-base origin/test HEAD)"..HEAD`

Expected: no whitespace errors; only approved source, test, canonical documentation, design, and plan changes are present. Windows packaging is not required because these are renderer-only changes.

- [ ] **Step 9: Commit an attributable verification repair only when required**

Run: `git status --short`

Expected: no new changes. If an in-scope repair was necessary, stage the exact files named by `git status`, commit them as `fix: complete Relay tab workflow verification`, and rerun Steps 2-8 from fresh output.
