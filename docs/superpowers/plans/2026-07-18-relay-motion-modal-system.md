# Relay Motion and Modal System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Relay one restrained “Operational silk” motion language and one shared square, tactile modal system without changing workflows, permissions, validation, persistence, import/export, scheduling, alert, or PDF behavior.

**Architecture:** Add semantic motion tokens and CSS utilities first, then implement a small React presence hook and a shared modal stack so exit animation, focus restoration, body locking, and nested dialogs are correct at the system boundary. Expand `Modal` into the common confirmation/standard/wide/large shell, migrate every modal consumer to it in reviewable groups, and finally apply the same state-based motion and typography vocabulary to retained tab panels, Knowledge, floating layers, drawers, toasts, setup/loading states, and existing detail surfaces.

**Tech Stack:** React 19, TypeScript 6, CSS custom properties, React portals, Vitest, Testing Library, Electron/Vite.

## Global Constraints

- Use exactly these motion durations: instant feedback 100ms, control feedback 140ms, state change 160ms, layer enter 220ms, layer exit 160ms, and structural change 240ms.
- Use `cubic-bezier(0.22, 1, 0.36, 1)` for every non-linear transition. Keep linear easing only for indeterminate rotation.
- Elevated layers enter from `translateY(10px) scale(0.985)` and exit at the shorter layer-exit duration.
- Tabs and destination content move no more than 4px; menus, popovers, and tooltips move 3–4px from their anchor.
- Do not add bounce, elastic motion, decorative blur, backdrop filters, page-load choreography, celebratory effects, or a new animation runtime.
- Use the operating system `prefers-reduced-motion` setting only. Do not add a Relay motion preference.
- Use transform and opacity for movement. Do not animate width, margins, absolute positioning, large lists, PDF pages, PDF scrolling, or continuously polling data.
- Keep focus-visible treatment stronger than hover treatment. Motion may soften border, background, and color changes, but it must never delay or weaken keyboard focus, validation, error, or selection feedback.
- Keep IBM Plex Sans as the application UI family. Use JetBrains Mono only for timestamps, identifiers, codes, paths, keyboard shortcuts, and fixed-width numeric readouts.
- Preserve the existing fluid semantic type scale designed for half-screen 1080p monitors and 55-inch 1080p displays.
- Modal variants are confirmation 400px, standard 560px, wide 820px, and large 960px, with viewport-safe width, 85vh maximum height, and one internal scroll region.
- Modal shells use a 1px strong border, 2px corners, `--shadow-sm`, a 64px minimum header, an optional stable tab rail, and a footer with 44px actions.
- Preserve existing dialog semantics, accessible names, focus trapping, Escape behavior, backdrop dismissal, non-dismissible busy states, and trigger focus restoration.
- Preserve all existing handlers, data flow, permissions, validation, errors, loading states, and user-visible copy unless this plan names the exact copy change.
- The checkout contains unrelated and pre-existing work in several target files. Use partial staging, inspect `git diff --cached`, and never stage a hunk that is not part of the current task.

## File Map

- `src/renderer/src/styles/theme.css`: canonical typography, motion duration, easing, compatibility transition, radius, shadow, and z-index tokens.
- `src/renderer/src/styles/animations.css`: shared panel, floating-layer, toast, spinner, live-indicator, and reduced-motion behavior.
- `src/renderer/src/hooks/usePresence.ts`: delayed-unmount lifecycle with `opening`, `open`, and `closing` states.
- `src/renderer/src/hooks/useFocusTrap.ts`: focus containment with configurable restoration timing.
- `src/renderer/src/components/modalStack.ts`: ordered modal registration, top-layer ownership, and reference-counted body scroll locking.
- `src/renderer/src/components/Modal.tsx`: common portal, lifecycle, overlay, shell variants, header, tab rail, body, footer, focus, and dismissal boundary.
- `src/renderer/src/styles/modals.css`: shared modal geometry, state selectors, responsive reflow, form rhythm, and modal typography.
- `src/renderer/src/styles/components.css`: retained tab motion, shared buttons, Data Manager, legacy modal cleanup, and feature-neutral component motion.
- `src/renderer/src/components/{AddContactModal,AddServerModal,ConfirmModal,NotesModal,ShortcutsModal,SettingsModal,MaintainTeamModal,HistoryModal,DataManagerModal}.tsx`: primary shared-modal consumers.
- `src/renderer/src/components/directory/DeleteConfirmationModal.tsx`: directory confirmation consumer.
- `src/renderer/src/components/settings/administration/{RoleAccountsPanel,RelayServerPanel,PairedDevicesPanel}.tsx`: nested Administration dialogs.
- `src/renderer/src/tabs/{DirectoryTab,ServersTab,AlertsTab,AlertHistoryModal,AlertReminderModal,AlertReminderManagerModal,AssemblerTab,PersonnelTab,DynatraceProblemsTab}.tsx`: tab-owned modal and panel consumers.
- `src/renderer/src/tabs/assembler/{BridgeHistoryModal,BridgeReminderModal,SaveGroupModal,ScheduleBridgeModal}.tsx`: Compose modal consumers.
- `src/renderer/src/components/{ContextMenu,Combobox,HeaderSearch,Tooltip,Toast,WorldClock}.tsx`: shared floating layers and notifications.
- `src/renderer/src/components/sidebar/SidebarDashboards.tsx` and `src/renderer/src/tabs/alerts/HighlightPopover.tsx`: feature floating layers.
- `src/renderer/src/App.tsx`: retained top-level tab state and unconditional modal mounting.
- `src/renderer/src/features/knowledge/{KnowledgeWorkspace,KnowledgeTab,KnowledgePdfViewer}.tsx`: Knowledge destination, catalog/reader/management, drawer, and View-menu state.
- `src/renderer/src/features/knowledge/{knowledgeWorkspace,knowledge}.css`: Knowledge panel, drawer, catalog, reader, and popover motion.
- `src/renderer/src/styles/{toast,setup,responsive}.css`, `src/renderer/src/components/{statusbar,oncall/oncall}.css`, and `src/renderer/src/tabs/{alerts,cloud-status,dynatrace-problems}.css`: feature motion and typography cleanup.
- `src/renderer/src/theme/__tests__/motionSystemStyles.test.ts`: shared token, geometry, typography, and reduced-motion contracts.
- Existing component and tab tests listed in each task: behavior regressions for every migrated consumer.

---

### Task 1: Canonical Motion Tokens and CSS Primitives

**Files:**
- Create: `src/renderer/src/theme/__tests__/motionSystemStyles.test.ts`
- Modify: `src/renderer/src/styles/theme.css:160-182`
- Modify: `src/renderer/src/styles/animations.css:1-132`
- Modify: `src/renderer/src/styles/components.css:1-48,796-810`

**Interfaces:**
- Consumes: existing `--font-family-base`, `--font-family-mono`, color, shadow, and semantic type tokens.
- Produces: `--motion-duration-*`, `--motion-ease-out`, compatibility `--transition-*` aliases, `relay-panel-in`, `relay-popover-in`, `relay-toast-in`, and `data-motion` utilities used by all later tasks.

- [ ] **Step 1: Write the failing motion-token and utility contract**

Create `motionSystemStyles.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const themeCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/theme.css'),
  'utf8',
);
const animationCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/animations.css'),
  'utf8',
);
const componentsCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/components.css'),
  'utf8',
);

function cssVar(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}:\\s*([^;]+);`, 'm').exec(themeCss)?.[1]?.trim() ?? '';
}

describe('Operational silk motion system', () => {
  it('defines the six approved duration tiers and one easing curve', () => {
    expect(cssVar('--motion-duration-instant')).toBe('100ms');
    expect(cssVar('--motion-duration-control')).toBe('140ms');
    expect(cssVar('--motion-duration-state')).toBe('160ms');
    expect(cssVar('--motion-duration-layer-enter')).toBe('220ms');
    expect(cssVar('--motion-duration-layer-exit')).toBe('160ms');
    expect(cssVar('--motion-duration-structure')).toBe('240ms');
    expect(cssVar('--motion-ease-out')).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
  });

  it('removes bounce and premium aliases while mapping compatibility aliases', () => {
    expect(themeCss).not.toContain('--transition-bouncy');
    expect(themeCss).not.toContain('--transition-premium');
    expect(cssVar('--transition-micro')).toBe(
      'var(--motion-duration-instant) var(--motion-ease-out)',
    );
    expect(cssVar('--transition-fast')).toBe(
      'var(--motion-duration-control) var(--motion-ease-out)',
    );
    expect(cssVar('--transition-base')).toBe(
      'var(--motion-duration-state) var(--motion-ease-out)',
    );
    expect(cssVar('--transition-smooth')).toBe(
      'var(--motion-duration-structure) var(--motion-ease-out)',
    );
  });

  it('provides bounded shared panel, popover, and toast entrances', () => {
    expect(animationCss).toContain('@keyframes relay-panel-in');
    expect(animationCss).toContain('transform: translateY(4px);');
    expect(animationCss).toContain('@keyframes relay-popover-in');
    expect(animationCss).toContain('transform: translateY(-4px);');
    expect(animationCss).toContain('@keyframes relay-toast-in');
    expect(animationCss).toContain('transform: translateX(8px);');
    expect(animationCss).toContain("[data-motion='popover']");
  });

  it('keeps reduced motion static and state-preserving', () => {
    expect(animationCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration:\s*0\.01ms !important/,
    );
    expect(animationCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*transform:\s*none !important/,
    );
    expect(animationCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*scroll-behavior:\s*auto !important/,
    );
  });

  it('uses the shared panel animation for retained top-level tabs', () => {
    expect(componentsCss).toMatch(
      /\.tab-panel--active\s*{[^}]*animation:\s*relay-panel-in var\(--motion-duration-state\) var\(--motion-ease-out\)/,
    );
  });

  it('keeps shared form feedback on the control tier', () => {
    expect(componentsCss).toMatch(
      /input\.tactile-input\.tactile-input\s*{[^}]*border-color var\(--transition-fast\)/,
    );
    expect(componentsCss).toMatch(
      /\.group-selector-checkbox\s*{[^}]*background-color var\(--transition-fast\)/,
    );
  });
});
```

- [ ] **Step 2: Run the contract and verify it fails**

```bash
npm run test:renderer -- src/renderer/src/theme/__tests__/motionSystemStyles.test.ts
```

Expected: FAIL because the six semantic duration variables and `relay-*` keyframes do not exist and the old bouncy/premium aliases remain.

- [ ] **Step 3: Add the semantic tokens and compatibility mapping**

Replace the current transition block in `theme.css` with:

```css
  /* Operational silk motion */
  --motion-duration-instant: 100ms;
  --motion-duration-control: 140ms;
  --motion-duration-state: 160ms;
  --motion-duration-layer-enter: 220ms;
  --motion-duration-layer-exit: 160ms;
  --motion-duration-structure: 240ms;
  --motion-ease-out: cubic-bezier(0.22, 1, 0.36, 1);

  /* Compatibility aliases for existing controls. */
  --transition-micro: var(--motion-duration-instant) var(--motion-ease-out);
  --transition-fast: var(--motion-duration-control) var(--motion-ease-out);
  --transition-base: var(--motion-duration-state) var(--motion-ease-out);
  --transition-smooth: var(--motion-duration-structure) var(--motion-ease-out);
```

Delete `--transition-bouncy` and `--transition-premium`; `rg` shows no consumers for either alias.

- [ ] **Step 4: Add the shared entrance utilities and reduced-motion fallback**

Keep the existing linear `spin` and semantic `breathe` keyframes, then add these rules to `animations.css`:

```css
@keyframes relay-panel-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes relay-popover-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes relay-toast-in {
  from {
    opacity: 0;
    transform: translateX(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

[data-motion='panel'] {
  animation: relay-panel-in var(--motion-duration-state) var(--motion-ease-out);
}

[data-motion='popover'] {
  animation: relay-popover-in var(--motion-duration-state) var(--motion-ease-out);
  transform-origin: top center;
}

[data-motion='toast'] {
  animation: relay-toast-in var(--motion-duration-layer-enter) var(--motion-ease-out);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }

  [data-motion],
  [data-motion]::before,
  [data-motion]::after {
    transform: none !important;
  }
}
```

Change `.tactile-button` to include `transform var(--transition-micro)` and change its active rule to:

```css
.tactile-button:active:not(:disabled) {
  background: var(--color-active-overlay);
  transform: scale(0.985);
}
```

Extend the existing `input.tactile-input.tactile-input` and `.group-selector-checkbox` transition declarations without changing geometry or validation selectors:

```css
input.tactile-input.tactile-input {
  transition:
    border-color var(--transition-fast),
    background-color var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.group-selector-checkbox {
  transition:
    border-color var(--transition-fast),
    background-color var(--transition-fast),
    color var(--transition-fast);
}
```

Keep the existing focus-visible outline/ring rules after hover rules so keyboard focus stays brighter and immediate. Do not animate error-message position, input height, or validation layout.

Replace the existing `.tab-panel--active` animation with:

```css
.tab-panel--active {
  display: flex;
  animation: relay-panel-in var(--motion-duration-state) var(--motion-ease-out);
}
```

- [ ] **Step 5: Run the focused contracts and button regressions**

```bash
npm run test:renderer -- src/renderer/src/theme/__tests__/motionSystemStyles.test.ts src/renderer/src/components/__tests__/TactileButton.test.tsx src/renderer/src/__tests__/App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/renderer/src/theme/__tests__/motionSystemStyles.test.ts
git add -p src/renderer/src/styles/theme.css src/renderer/src/styles/animations.css src/renderer/src/styles/components.css
git diff --cached
git diff --cached --check
git commit -m "style(ui): add operational motion tokens"
```

---

### Task 2: Presence, Focus-Restoration, and Modal-Stack Foundations

**Files:**
- Create: `src/renderer/src/hooks/usePresence.ts`
- Create: `src/renderer/src/hooks/__tests__/usePresence.test.ts`
- Create: `src/renderer/src/components/modalStack.ts`
- Modify: `src/renderer/src/hooks/useFocusTrap.ts:1-77`
- Modify: `src/renderer/src/hooks/__tests__/useFocusTrap.test.ts:1-220`

**Interfaces:**
- Consumes: `--motion-duration-layer-exit` conceptually; JavaScript uses the matching exported default `160` milliseconds.
- Produces: `PresenceState`, `usePresence(isPresent, exitDurationMs?)`, `useModalStack(id, mounted)`, and `useFocusTrap(isActive, options)` for `Modal`.

- [ ] **Step 1: Write failing presence lifecycle tests**

Create `usePresence.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePresence } from '../usePresence';

describe('usePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      globalThis.setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => globalThis.clearTimeout(id));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('moves an entering layer from opening to open', () => {
    const { result } = renderHook(() => usePresence(true));
    expect(result.current).toEqual({ isMounted: true, state: 'opening' });
    act(() => vi.advanceTimersByTime(16));
    expect(result.current).toEqual({ isMounted: true, state: 'open' });
  });

  it('keeps a closing layer mounted for 160ms', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: true },
    });
    act(() => vi.advanceTimersByTime(16));
    rerender({ open: false });
    expect(result.current).toEqual({ isMounted: true, state: 'closing' });
    act(() => vi.advanceTimersByTime(159));
    expect(result.current.isMounted).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.isMounted).toBe(false);
  });

  it('cancels an in-flight exit when the layer reopens', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: true },
    });
    act(() => vi.advanceTimersByTime(16));
    rerender({ open: false });
    act(() => vi.advanceTimersByTime(80));
    rerender({ open: true });
    act(() => vi.advanceTimersByTime(16));
    expect(result.current).toEqual({ isMounted: true, state: 'open' });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.isMounted).toBe(true);
  });
});
```

- [ ] **Step 2: Add a failing deferred-focus-restoration test**

Append to `useFocusTrap.test.ts`:

```ts
it('can release the trap and restore focus only after its layer unmounts', () => {
  const trigger = document.createElement('button');
  const inside = document.createElement('button');
  document.body.append(trigger, inside);
  trigger.focus();

  const { rerender } = renderHook(
    ({ active, layerMounted }) =>
      useFocusTrap(active, {
        restoreOnDeactivate: false,
        restoreWhen: !layerMounted,
      }),
    { initialProps: { active: true, layerMounted: true } },
  );
  inside.focus();
  rerender({ active: false, layerMounted: true });
  expect(document.activeElement).toBe(inside);
  rerender({ active: false, layerMounted: false });
  expect(document.activeElement).toBe(trigger);
});
```

- [ ] **Step 3: Run the focused tests and verify they fail**

```bash
npm run test:renderer -- src/renderer/src/hooks/__tests__/usePresence.test.ts src/renderer/src/hooks/__tests__/useFocusTrap.test.ts
```

Expected: FAIL because `usePresence` does not exist and `useFocusTrap` has no options argument.

- [ ] **Step 4: Implement delayed presence**

Create `usePresence.ts`:

```ts
import { useEffect, useRef, useState } from 'react';

export type PresenceState = 'opening' | 'open' | 'closing';

export type PresenceSnapshot = Readonly<{
  isMounted: boolean;
  state: PresenceState;
}>;

export const DEFAULT_LAYER_EXIT_MS = 160;

export function usePresence(
  isPresent: boolean,
  exitDurationMs: number = DEFAULT_LAYER_EXIT_MS,
): PresenceSnapshot {
  const [isMounted, setIsMounted] = useState(isPresent);
  const [phase, setPhase] = useState<Extract<PresenceState, 'opening' | 'open'>>('opening');
  const mountedRef = useRef(isPresent);

  useEffect(() => {
    let frame = 0;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;

    if (isPresent) {
      mountedRef.current = true;
      setIsMounted(true);
      setPhase('opening');
      frame = globalThis.requestAnimationFrame(() => setPhase('open'));
    } else if (mountedRef.current) {
      exitTimer = globalThis.setTimeout(() => {
        mountedRef.current = false;
        setIsMounted(false);
      }, exitDurationMs);
    }

    return () => {
      if (frame) globalThis.cancelAnimationFrame(frame);
      if (exitTimer) globalThis.clearTimeout(exitTimer);
    };
  }, [exitDurationMs, isPresent]);

  return {
    isMounted,
    state: isPresent ? phase : 'closing',
  };
}
```

- [ ] **Step 5: Implement ordered modal-stack ownership and body locking**

Create `modalStack.ts`:

```ts
import { useEffect, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let stack: string[] = [];
let revision = 0;

function emit(): void {
  revision += 1;
  document.body.classList.toggle('modal-open', stack.length > 0);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return revision;
}

function register(id: string): () => void {
  stack = [...stack.filter((candidate) => candidate !== id), id];
  emit();
  return () => {
    stack = stack.filter((candidate) => candidate !== id);
    emit();
  };
}

export function useModalStack(id: string, mounted: boolean): boolean {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!mounted) return;
    return register(id);
  }, [id, mounted]);

  return mounted && stack.at(-1) === id;
}
```

- [ ] **Step 6: Add deferred restoration to `useFocusTrap`**

Change the hook signature and active-state effect to:

```ts
type FocusTrapOptions = Readonly<{
  restoreOnDeactivate?: boolean;
  restoreWhen?: boolean;
}>;

export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  isActive: boolean = true,
  { restoreOnDeactivate = true, restoreWhen = false }: FocusTrapOptions = {},
) {
  const containerRef = useRef<T>(null);
  const previousActiveElement = useRef<Element | null>(null);
  const focusRestored = useRef(false);

  useEffect(() => {
    if (isActive) {
      if (previousActiveElement.current === null || focusRestored.current) {
        previousActiveElement.current = document.activeElement;
      }
      focusRestored.current = false;
      return;
    }

    const shouldRestore = restoreWhen || (restoreOnDeactivate && !isActive);
    if (shouldRestore && !focusRestored.current && previousActiveElement.current instanceof HTMLElement) {
      previousActiveElement.current.focus();
      focusRestored.current = true;
    }
  }, [isActive, restoreOnDeactivate, restoreWhen]);
```

Keep the existing first-focus, Tab-cycle, and cleanup effects unchanged. The cleanup remains the fallback for a true component unmount; `restoreWhen` handles the normal continuously mounted `Modal` case after its closing portal disappears.

- [ ] **Step 7: Run foundation tests**

```bash
npm run test:renderer -- src/renderer/src/hooks/__tests__/usePresence.test.ts src/renderer/src/hooks/__tests__/useFocusTrap.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/renderer/src/hooks/usePresence.ts src/renderer/src/hooks/__tests__/usePresence.test.ts src/renderer/src/components/modalStack.ts
git add -p src/renderer/src/hooks/useFocusTrap.ts src/renderer/src/hooks/__tests__/useFocusTrap.test.ts
git diff --cached
git diff --cached --check
git commit -m "feat(ui): add layered presence lifecycle"
```

---

### Task 3: Shared Modal Lifecycle, Variants, and Anatomy

**Files:**
- Modify: `src/renderer/src/components/Modal.tsx:1-118`
- Modify: `src/renderer/src/components/__tests__/Modal.test.tsx:1-205`
- Modify: `src/renderer/src/styles/modals.css:268-354`
- Modify: `src/renderer/src/theme/__tests__/motionSystemStyles.test.ts`

**Interfaces:**
- Consumes: `usePresence`, `useModalStack`, deferred `useFocusTrap`, semantic motion tokens, `TactileButton` sizing conventions, and `Tooltip`.
- Produces: `ModalVariant`, `variant`, `subtitle`, `headerActions`, `tabs`, `footer`, `bodyClassName`, retained closing content, `data-state`, `data-variant`, and common modal DOM/CSS for every later migration.

- [ ] **Step 1: Replace the shallow modal mock tests with lifecycle regressions**

Remove the `useFocusTrap` mock from `Modal.test.tsx`, import `act`, and add:

```tsx
beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    globalThis.setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => globalThis.clearTimeout(id));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.classList.remove('modal-open');
});

function ModalHarness({ dismissible = true }: Readonly<{ dismissible?: boolean }>) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open layer
      </button>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Layer title"
        subtitle="Useful context"
        variant="confirmation"
        dismissible={dismissible}
        footer={<button type="button">Confirm</button>}
      >
        <button type="button">Inside layer</button>
      </Modal>
    </>
  );
}

it('keeps the portal mounted in closing state for the 160ms exit', () => {
  vi.useFakeTimers();
  const { rerender } = render(<Modal isOpen onClose={vi.fn()} title="Lifecycle">Body</Modal>);
  rerender(<Modal isOpen={false} onClose={vi.fn()} title="Lifecycle">Body</Modal>);
  expect(screen.getByRole('dialog')).toHaveAttribute('data-state', 'closing');
  act(() => vi.advanceTimersByTime(159));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole('dialog')).toBeNull();
  vi.useRealTimers();
});

it('exposes the confirmation variant and shared anatomy', () => {
  render(<ModalHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open layer' }));
  const dialog = screen.getByRole('dialog', { name: 'Layer title' });
  expect(dialog).toHaveAttribute('data-variant', 'confirmation');
  expect(dialog.querySelector('.modal-header-generic')).not.toBeNull();
  expect(dialog.querySelector('.modal-subtitle-generic')).toHaveTextContent('Useful context');
  expect(dialog.querySelector('.modal-footer-generic')).not.toBeNull();
  expect(dialog.querySelector('.modal-accent-line')).toBeNull();
});

it('restores trigger focus only after the closing portal unmounts', () => {
  vi.useFakeTimers();
  render(<ModalHarness />);
  const trigger = screen.getByRole('button', { name: 'Open layer' });
  trigger.focus();
  fireEvent.click(trigger);
  act(() => vi.advanceTimersByTime(16));
  fireEvent.click(screen.getByLabelText('Close'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(trigger).not.toHaveFocus();
  act(() => vi.advanceTimersByTime(160));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger).toHaveFocus();
  vi.useRealTimers();
});

it('keeps body scroll locked while any nested modal remains mounted', () => {
  const { rerender } = render(
    <>
      <Modal isOpen onClose={vi.fn()} title="Outer">Outer body</Modal>
      <Modal isOpen onClose={vi.fn()} title="Inner">Inner body</Modal>
    </>,
  );
  expect(document.body).toHaveClass('modal-open');
  rerender(
    <>
      <Modal isOpen onClose={vi.fn()} title="Outer">Outer body</Modal>
      <Modal isOpen={false} onClose={vi.fn()} title="Inner">Inner body</Modal>
    </>,
  );
  expect(document.body).toHaveClass('modal-open');
});

it('lets only the top nested modal handle Escape', () => {
  const outerClose = vi.fn();
  const innerClose = vi.fn();
  render(
    <>
      <Modal isOpen onClose={outerClose} title="Outer">Outer body</Modal>
      <Modal isOpen onClose={innerClose} title="Inner">Inner body</Modal>
    </>,
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(innerClose).toHaveBeenCalledOnce();
  expect(outerClose).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Extend the style contract for modal geometry and state**

Add `modalsCss` to `motionSystemStyles.test.ts` and append:

```ts
it('uses the shared square modal geometry and state-driven layer motion', () => {
  expect(modalsCss).toContain(".modal-dialog-generic[data-variant='confirmation']");
  expect(modalsCss).toContain('--modal-width: 400px;');
  expect(modalsCss).toContain('--modal-width: 560px;');
  expect(modalsCss).toContain('--modal-width: 820px;');
  expect(modalsCss).toContain('--modal-width: 960px;');
  expect(modalsCss).toMatch(/\.modal-dialog-generic\s*{[^}]*border-radius:\s*2px/);
  expect(modalsCss).toMatch(/\.modal-dialog-generic\s*{[^}]*box-shadow:\s*var\(--shadow-sm\)/);
  expect(modalsCss).toMatch(/\.modal-dialog-generic\s*{[^}]*font-family:\s*var\(--font-family-base\)/);
  expect(modalsCss).toContain('translateY(10px) scale(0.985)');
  expect(modalsCss).not.toContain('.modal-accent-line');
  expect(modalsCss).not.toContain('backdrop-filter');
});
```

- [ ] **Step 3: Run the modal tests and verify they fail**

```bash
npm run test:renderer -- src/renderer/src/components/__tests__/Modal.test.tsx src/renderer/src/theme/__tests__/motionSystemStyles.test.ts
```

Expected: FAIL because `Modal` unmounts immediately, has no variants/anatomy props, and still renders the accent line and rounded shell.

- [ ] **Step 4: Replace `Modal.tsx` with the shared lifecycle and anatomy**

Use this public prop contract and render structure:

```tsx
import React, { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { usePresence } from '../hooks/usePresence';
import { useModalStack } from './modalStack';
import { Tooltip } from './Tooltip';

export type ModalVariant = 'confirmation' | 'standard' | 'wide' | 'large';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerActions?: React.ReactNode;
  tabs?: React.ReactNode;
  footer?: React.ReactNode;
  variant?: ModalVariant;
  width?: string;
  bare?: boolean;
  bodyClassName?: string;
  overlayClassName?: string;
  dialogClassName?: string;
  dialogProps?: React.HTMLAttributes<HTMLDialogElement>;
  dismissible?: boolean;
};

type RetainedPresentation = Pick<
  Props,
  | 'children'
  | 'title'
  | 'subtitle'
  | 'headerActions'
  | 'tabs'
  | 'footer'
  | 'bare'
  | 'dismissible'
>;

export const Modal: React.FC<Props> = ({
  isOpen,
  onClose,
  children,
  title,
  subtitle,
  headerActions,
  tabs,
  footer,
  variant = 'standard',
  width,
  bare = false,
  bodyClassName = '',
  overlayClassName = 'modal-overlay-generic',
  dialogClassName = 'modal-dialog-generic',
  dialogProps,
  dismissible = true,
}) => {
  const modalId = useId();
  const titleId = useId();
  const { isMounted, state } = usePresence(isOpen);
  const isTopModal = useModalStack(modalId, isMounted);
  const interactive = isOpen && state !== 'closing' && isTopModal;
  const focusTrapRef = useFocusTrap<HTMLDialogElement>(interactive, {
    restoreOnDeactivate: false,
    restoreWhen: !isMounted,
  });
  const retained = useRef<RetainedPresentation>({
    children,
    title,
    subtitle,
    headerActions,
    tabs,
    footer,
    bare,
    dismissible,
  });

  if (isOpen) {
    retained.current = {
      children,
      title,
      subtitle,
      headerActions,
      tabs,
      footer,
      bare,
      dismissible,
    };
  }

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !interactive) return;
      event.preventDefault();
      if (dismissible) onClose();
    },
    [dismissible, interactive, onClose],
  );

  useEffect(() => {
    if (!interactive) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, interactive]);

  if (!isMounted) return null;

  const presentation = retained.current;
  const { className: extraDialogClass = '', style: dialogStyle, ...restDialogProps } =
    dialogProps ?? {};

  return createPortal(
    <div className={overlayClassName} data-state={state} data-modal-layer>
      {interactive && dismissible ? (
        <button
          type="button"
          className="overlay-hitbox"
          aria-label="Close modal backdrop"
          onClick={onClose}
        />
      ) : (
        <div className="overlay-hitbox" aria-hidden="true" />
      )}
      <dialog
        open
        ref={focusTrapRef}
        className={[dialogClassName, extraDialogClass].filter(Boolean).join(' ')}
        style={{ ...dialogStyle, ...(width ? { width } : {}) }}
        {...restDialogProps}
        aria-modal="true"
        aria-labelledby={presentation.title ? titleId : undefined}
        data-state={state}
        data-variant={variant}
        data-bare={presentation.bare ? 'true' : 'false'}
        inert={interactive ? undefined : true}
      >
        {presentation.bare ? (
          presentation.children
        ) : (
          <>
            <header className="modal-header-generic">
              <div className="modal-heading-generic">
                <h2 id={titleId} className="modal-title-generic">
                  {presentation.title}
                </h2>
                {presentation.subtitle && (
                  <div className="modal-subtitle-generic">{presentation.subtitle}</div>
                )}
              </div>
              <div className="modal-header-actions-generic">
                {presentation.headerActions}
                {presentation.dismissible && (
                  <Tooltip content="Close" position="left">
                    <button
                      type="button"
                      onClick={onClose}
                      className="modal-close-generic"
                      aria-label="Close"
                      disabled={!interactive}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </Tooltip>
                )}
              </div>
            </header>
            {presentation.tabs && <div className="modal-tabs-generic">{presentation.tabs}</div>}
            <div className={['modal-body-generic', bodyClassName].filter(Boolean).join(' ')}>
              {presentation.children}
            </div>
            {presentation.footer && (
              <footer className="modal-footer-generic">{presentation.footer}</footer>
            )}
          </>
        )}
      </dialog>
    </div>,
    document.body,
  );
};
```

- [ ] **Step 5: Replace generic modal CSS with the approved square system**

Replace the generic modal block in `modals.css` with:

```css
.modal-overlay-generic {
  position: fixed;
  z-index: var(--z-critical);
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  opacity: 0;
  background: var(--color-backdrop);
  transition: opacity var(--motion-duration-layer-enter) var(--motion-ease-out);
}

.modal-overlay-generic[data-state='open'] {
  opacity: 1;
}

.modal-overlay-generic[data-state='closing'] {
  opacity: 0;
  transition-duration: var(--motion-duration-layer-exit);
}

.modal-dialog-generic {
  --modal-width: 560px;
  position: relative;
  display: flex;
  width: min(var(--modal-width), calc(100vw - 32px));
  max-width: calc(100vw - 32px);
  max-height: 85vh;
  margin: 0;
  padding: 0;
  overflow: hidden;
  flex-direction: column;
  border: 1px solid var(--color-border-strong);
  border-radius: 2px;
  opacity: 0;
  background: var(--color-bg-surface-elevated);
  box-shadow: var(--shadow-sm);
  color: var(--color-text-primary);
  font-family: var(--font-family-base);
  transform: translateY(10px) scale(0.985);
  transform-origin: center;
  transition:
    opacity var(--motion-duration-layer-enter) var(--motion-ease-out),
    transform var(--motion-duration-layer-enter) var(--motion-ease-out);
}

.modal-dialog-generic[data-variant='confirmation'] { --modal-width: 400px; }
.modal-dialog-generic[data-variant='standard'] { --modal-width: 560px; }
.modal-dialog-generic[data-variant='wide'] { --modal-width: 820px; }
.modal-dialog-generic[data-variant='large'] { --modal-width: 960px; }

.modal-dialog-generic[data-state='open'] {
  opacity: 1;
  transform: none;
}

.modal-dialog-generic[data-state='closing'] {
  opacity: 0;
  transform: translateY(10px) scale(0.985);
  transition-duration: var(--motion-duration-layer-exit);
}

.modal-header-generic {
  display: flex;
  min-height: 64px;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 0 var(--space-5);
  border-bottom: 1px solid var(--color-border);
  flex: 0 0 auto;
  background: var(--color-bg-chrome);
}

.modal-heading-generic { min-width: 0; }
.modal-title-generic {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-tight);
}
.modal-subtitle-generic {
  margin-top: 3px;
  color: var(--color-text-tertiary);
  font-size: var(--text-sm);
}
.modal-header-actions-generic {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.modal-close-generic {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 2px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    color var(--transition-fast),
    border-color var(--transition-fast),
    background var(--transition-fast);
}
.modal-close-generic:hover:not(:disabled),
.modal-close-generic:focus-visible {
  border-color: var(--color-border-strong);
  background: var(--color-hover-overlay);
  color: var(--color-text-primary);
}
.modal-close-generic:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.modal-tabs-generic {
  min-height: 48px;
  border-bottom: 1px solid var(--color-border);
  flex: 0 0 auto;
}
.modal-body-generic {
  min-height: 0;
  overflow: auto;
  padding: var(--space-5);
  flex: 1 1 auto;
  overscroll-behavior: contain;
}
.modal-body-generic--nested-scroll {
  overflow: hidden;
}
.modal-footer-generic {
  display: flex;
  min-height: 68px;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--color-border);
  flex: 0 0 auto;
  background: var(--color-bg-chrome);
}
.modal-footer-generic .tactile-button { min-height: 44px; }

@media (max-width: 640px) {
  .modal-overlay-generic { padding: var(--space-2); }
  .modal-dialog-generic {
    width: calc(100vw - 16px);
    max-width: calc(100vw - 16px);
    max-height: calc(100dvh - 16px);
  }
  .modal-header-generic,
  .modal-footer-generic { padding-inline: var(--space-4); }
  .modal-body-generic { padding: var(--space-4); }
}

@media (prefers-reduced-motion: reduce) {
  .modal-dialog-generic,
  .modal-dialog-generic[data-state] { transform: none; }
}
```

Delete `.modal-accent-line` and the legacy `animate-fade-in` / `animate-scale-in` classes from `Modal`.

- [ ] **Step 6: Run modal, focus, and style tests**

```bash
npm run test:renderer -- src/renderer/src/components/__tests__/Modal.test.tsx src/renderer/src/hooks/__tests__/useFocusTrap.test.ts src/renderer/src/hooks/__tests__/usePresence.test.ts src/renderer/src/theme/__tests__/motionSystemStyles.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add -p src/renderer/src/components/Modal.tsx src/renderer/src/components/__tests__/Modal.test.tsx src/renderer/src/styles/modals.css src/renderer/src/theme/__tests__/motionSystemStyles.test.ts
git diff --cached
git diff --cached --check
git commit -m "feat(ui): unify modal lifecycle and shell"
```

---

### Task 4: Core Forms, Confirmations, Notes, Shortcuts, and Settings Modal

**Files:**
- Modify: `src/renderer/src/components/AddContactModal.tsx`
- Modify: `src/renderer/src/components/AddServerModal.tsx`
- Modify: `src/renderer/src/components/ConfirmModal.tsx`
- Modify: `src/renderer/src/components/directory/DeleteConfirmationModal.tsx`
- Modify: `src/renderer/src/components/NotesModal.tsx`
- Modify: `src/renderer/src/components/ShortcutsModal.tsx`
- Modify: `src/renderer/src/components/SettingsModal.tsx`
- Modify: `src/renderer/src/styles/modals.css:1-267`
- Modify: `src/renderer/src/styles/components.css:874-1018,1230-1270,2967-3025`
- Test: `src/renderer/src/components/__tests__/{AddContactModal,AddServerModal,ConfirmModal,NotesModal,ShortcutsModal,SettingsModal}.test.tsx`

**Interfaces:**
- Consumes: `Modal` variants, subtitle, footer, body class, retained content, and shared 44px footer controls from Task 3.
- Produces: standard form and confirmation migration patterns used by later feature modals.

- [ ] **Step 1: Add structural assertions to the existing consumer tests**

Add the following assertion pattern to the open-state test for each consumer, using its expected variant:

```tsx
const dialog = screen.getByRole('dialog');
expect(dialog).toHaveAttribute('data-variant', 'standard');
expect(dialog.querySelector('.modal-header-generic')).not.toBeNull();
expect(dialog.querySelector('.modal-body-generic')).not.toBeNull();
```

Use `confirmation` for `ConfirmModal` and `DeleteConfirmationModal`. In `NotesModal.test.tsx` and `ShortcutsModal.test.tsx`, also assert:

```tsx
expect(dialog).toHaveStyle({ borderRadius: '' });
expect(dialog).not.toHaveClass('modal-container', 'shortcuts-modal');
expect(dialog.querySelector('.modal-footer-generic')).not.toBeNull();
```

In `ConfirmModal.test.tsx`, assert the busy state still removes close affordances and sets `aria-busy="true"`.

- [ ] **Step 2: Run the consumer tests and verify structural failures**

```bash
npm run test:renderer -- src/renderer/src/components/__tests__/AddContactModal.test.tsx src/renderer/src/components/__tests__/AddServerModal.test.tsx src/renderer/src/components/__tests__/ConfirmModal.test.tsx src/renderer/src/components/__tests__/NotesModal.test.tsx src/renderer/src/components/__tests__/ShortcutsModal.test.tsx src/renderer/src/components/__tests__/SettingsModal.test.tsx
```

Expected: FAIL for the old bare Notes/Shortcuts shells and missing explicit variants/footers.

- [ ] **Step 3: Move CRUD and confirmation actions into the shared footer**

Use `useId()` for form IDs where a footer submit button sits outside the body form. The Add Contact structure becomes:

```tsx
const formId = useId();

<Modal
  isOpen={isOpen}
  onClose={onClose}
  title={editContact ? 'Edit Contact' : 'Add Contact'}
  variant="standard"
  footer={
    <>
      <TactileButton type="button" onClick={onClose}>Cancel</TactileButton>
      <TactileButton type="submit" form={formId} loading={isSubmitting} variant="primary">
        {editContact ? 'Update Contact' : 'Create Contact'}
      </TactileButton>
    </>
  }
>
  <form id={formId} onSubmit={handleSubmit} className="modal-form-body">
    <div className="add-contact-field">
      <Input
        label="Full Name"
        value={name}
        variant="vivid"
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Alice Smith"
        required
        autoFocus
      />
    </div>
    <div className="add-contact-field">
      <Input
        label="Email Address"
        type="email"
        variant="vivid"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="alice@example.com"
        required
      />
    </div>
    <div className="add-contact-field">
      <Input
        label="Job Title"
        variant="vivid"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="e.g. Marketing Director"
      />
    </div>
    <div className="add-contact-field">
      <Input
        label="Phone Number"
        type="tel"
        variant="vivid"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        onBlur={handlePhoneBlur}
        placeholder="e.g. (555) 123-4567"
      />
    </div>
  </form>
</Modal>
```

For Add Server, keep the existing fields unchanged and use:

```tsx
<Modal
  isOpen={isOpen}
  onClose={onClose}
  title={serverToEdit ? 'Edit Server' : 'Add Server'}
  variant="standard"
  footer={
    <>
      <TactileButton onClick={onClose}>Cancel</TactileButton>
      <TactileButton
        onClick={handleSubmit}
        loading={isSubmitting}
        disabled={!formData.name}
        variant="primary"
      >
        Save Server
      </TactileButton>
    </>
  }
>
  <div className="add-server-form">
    <Input
      label="Server Name (Required)"
      value={formData.name}
      onChange={handleChange('name')}
      placeholder="e.g. SRV-001"
      autoFocus
    />
    <div className="add-server-row">
      <Input
        label="Business Area"
        value={formData.businessArea}
        onChange={handleChange('businessArea')}
        placeholder="e.g. Finance"
        containerStyle={{ flex: 1 }}
      />
      <Input
        label="LOB"
        value={formData.lob}
        onChange={handleChange('lob')}
        placeholder="Line of Business"
        containerStyle={{ flex: 1 }}
      />
    </div>
    <Input
      label="Comment"
      value={formData.comment}
      onChange={handleChange('comment')}
      placeholder="Notes..."
    />
    <div className="add-server-row">
      <Input
        label="LOB Owner (Email)"
        value={formData.owner}
        onChange={handleChange('owner')}
        placeholder="owner@example.com"
        containerStyle={{ flex: 1 }}
      />
      <Input
        label="IT Contact (Email)"
        value={formData.contact}
        onChange={handleChange('contact')}
        placeholder="support@example.com"
        containerStyle={{ flex: 1 }}
      />
    </div>
    <Input
      label="OS"
      value={formData.os}
      onChange={handleChange('os')}
      placeholder="e.g. Windows"
    />
    {submitError && <div className="add-server-error">{submitError}</div>}
  </div>
</Modal>
```

Remove only the old `.add-server-actions` block.

For `ConfirmModal`, use `variant="confirmation"`, keep the message/error in the body, and pass the existing two buttons through `footer`. For `DeleteConfirmationModal`, use the same variant and move Cancel/Delete Contact into `footer`.

- [ ] **Step 4: Migrate Notes and Shortcuts off their one-off shells**

Replace the Notes `Modal` invocation and custom header/footer with:

```tsx
<Modal
  isOpen={isOpen}
  onClose={onClose}
  title={entityType === 'contact' ? 'Contact Notes' : 'Server Notes'}
  subtitle={entityName}
  variant="standard"
  bodyClassName="notes-modal-body"
  dialogProps={{ 'data-entity-id': entityId }}
  dismissible={!saving}
  footer={
    <>
      <TactileButton type="button" onClick={onClose} disabled={saving}>Cancel</TactileButton>
      <TactileButton type="button" onClick={handleSave} loading={saving} variant="primary">
        Save Notes
      </TactileButton>
    </>
  }
>
  <div className="notes-textarea-wrapper">
    <label className="modal-label" htmlFor="note-textarea">Note</label>
    <textarea
      id="note-textarea"
      ref={textareaRef}
      value={note}
      onChange={(event) => setNote(event.target.value)}
      placeholder={`Add a note about this ${entityType}...`}
      className="modal-textarea"
    />
  </div>
  <div className="notes-tags">
    <label className="modal-label" htmlFor="tag-input-field">Tags</label>
    {tags.length > 0 && (
      <div className="tag-list">
        {tags.map((tag) => (
          <TagBadge key={tag} tag={tag} onRemove={handleRemoveTag} />
        ))}
      </div>
    )}
    <TagInput
      id="tag-input-field"
      value={tagInput}
      onChange={setTagInput}
      onAdd={handleAddTag}
      onKeyDown={handleKeyDown}
    />
  </div>
</Modal>
```

Remove only the old custom header, close button, and footer.

Replace the Shortcuts bare shell with:

```tsx
<Modal
  isOpen={isOpen}
  onClose={onClose}
  title="Keyboard Shortcuts"
  variant="standard"
  bodyClassName="shortcuts-modal-content"
  footer={
    <span className="shortcuts-modal-hint">
      Press <kbd className="shortcuts-modal-kbd">Esc</kbd> to close
    </span>
  }
>
  {shortcuts.map((section) => (
    <section key={section.category} className="shortcuts-modal-category">
      <h3 className="shortcuts-modal-category-title">{section.category}</h3>
      <div className="shortcuts-modal-items">
        {section.items.map((item) => (
          <div key={item.keys} className="shortcuts-modal-item">
            <span className="shortcuts-modal-item-desc">{item.description}</span>
            <kbd className="shortcuts-modal-key">{item.keys}</kbd>
          </div>
        ))}
      </div>
    </section>
  ))}
</Modal>
```

- [ ] **Step 5: Keep Settings mounted through exit and select the standard variant**

Remove the component-level `if (!isOpen) return null`. For modal presentation use:

```tsx
if (presentation === 'modal') {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" variant="standard">
      {children}
    </Modal>
  );
}

if (!isOpen) return null;
```

This preserves page presentation behavior while allowing modal presentation to finish its exit.

- [ ] **Step 6: Remove legacy modal chrome and keep feature content styles**

Delete `.modal-overlay`, `.modal-container`, `.modal-header`, `.modal-close-btn`, `.modal-footer`, `.shortcuts-modal-overlay`, `.shortcuts-modal`, `.shortcuts-modal-header`, `.shortcuts-modal-close-btn`, and their entrance animations. Keep and retarget only content rules:

```css
.notes-modal-body { display: grid; gap: var(--space-5); }
.modal-label,
.shortcuts-modal-category-title {
  color: var(--color-text-tertiary);
  font-family: var(--font-family-base);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}
.modal-textarea { min-height: 120px; font-family: var(--font-family-base); }
.shortcuts-modal-content { display: grid; gap: var(--space-5); }
.shortcuts-modal-hint { color: var(--color-text-tertiary); font-size: var(--text-sm); }
.shortcuts-modal-key,
.shortcuts-modal-kbd { font-family: var(--font-family-mono); }
.confirm-modal-body,
.delete-confirm-body { display: grid; gap: var(--space-3); }
```

Delete the old feature action-row rules after their buttons move to `.modal-footer-generic`.

- [ ] **Step 7: Run core modal regressions**

```bash
npm run test:renderer -- src/renderer/src/components/__tests__/Modal.test.tsx src/renderer/src/components/__tests__/AddContactModal.test.tsx src/renderer/src/components/__tests__/AddServerModal.test.tsx src/renderer/src/components/__tests__/ConfirmModal.test.tsx src/renderer/src/components/__tests__/NotesModal.test.tsx src/renderer/src/components/__tests__/ShortcutsModal.test.tsx src/renderer/src/components/__tests__/SettingsModal.test.tsx
```

Expected: PASS, including existing submit, error, tag, keyboard, busy, and close tests.

- [ ] **Step 8: Commit Task 4**

```bash
git add -p src/renderer/src/components/AddContactModal.tsx src/renderer/src/components/AddServerModal.tsx src/renderer/src/components/ConfirmModal.tsx src/renderer/src/components/directory/DeleteConfirmationModal.tsx src/renderer/src/components/NotesModal.tsx src/renderer/src/components/ShortcutsModal.tsx src/renderer/src/components/SettingsModal.tsx src/renderer/src/styles/modals.css src/renderer/src/styles/components.css src/renderer/src/components/__tests__
git diff --cached
git diff --cached --check
git commit -m "style(ui): align core modal consumers"
```

---

### Task 5: Alerts, Compose, Directory, and Personnel Modal Consumers

**Files:**
- Modify: `src/renderer/src/App.tsx:507-516`
- Modify: `src/renderer/src/components/MaintainTeamModal.tsx`
- Modify: `src/renderer/src/tabs/AlertReminderModal.tsx`
- Modify: `src/renderer/src/tabs/AlertReminderManagerModal.tsx`
- Modify: `src/renderer/src/tabs/AlertsTab.tsx:907-978`
- Modify: `src/renderer/src/tabs/DirectoryTab.tsx:410-480`
- Modify: `src/renderer/src/tabs/AssemblerTab.tsx:408-570`
- Modify: `src/renderer/src/tabs/PersonnelTab.tsx:465-570`
- Modify: `src/renderer/src/tabs/assembler/BridgeReminderModal.tsx`
- Modify: `src/renderer/src/tabs/assembler/SaveGroupModal.tsx`
- Modify: `src/renderer/src/tabs/assembler/ScheduleBridgeModal.tsx`
- Modify: `src/renderer/src/styles/components.css`
- Modify: `src/renderer/src/components/oncall/oncall.css`
- Modify: `src/renderer/src/tabs/alerts.css`
- Modify: `src/renderer/src/tabs/assembler/assembler.css`
- Test: existing Alerts, Directory, Personnel, Assembler, Maintain Team, reminder, Save Group, and Schedule Bridge tests.

**Interfaces:**
- Consumes: Task 4’s standard/confirmation form pattern and Task 3’s retained closing content.
- Produces: explicit variants and shared footer anatomy for every tab-owned modal except history and Administration dialogs.

- [ ] **Step 1: Add variant coverage to existing feature tests**

In the open-state test for each modal, assert these mappings:

```ts
const expectedVariants = {
  MaintainTeamModal: 'large',
  AlertReminderModal: 'standard',
  AlertReminderManagerModal: 'wide',
  BridgeReminderModal: 'confirmation',
  SaveGroupModal: 'standard',
  ScheduleBridgeModal: 'standard',
} as const;
```

In `AlertsTab.test.tsx`, assert Pin Template is `confirmation`. In `DirectoryTab.test.tsx`, `AssemblerTab.test.tsx`, and `PersonnelTab.test.tsx`, open each Manage Groups / rename / add-card flow and assert its dialog has `data-variant="confirmation"` or `standard` as named below.

- [ ] **Step 2: Verify the feature tests fail on missing variants**

```bash
npm run test:renderer -- src/renderer/src/components/__tests__/MaintainTeamModal.test.tsx src/renderer/src/tabs/__tests__/AlertReminderModal.test.tsx src/renderer/src/tabs/__tests__/AlertReminderManagerModal.test.tsx src/renderer/src/tabs/__tests__/AlertsTab.test.tsx src/renderer/src/tabs/__tests__/DirectoryTab.test.tsx src/renderer/src/tabs/__tests__/AssemblerTab.test.tsx src/renderer/src/tabs/__tests__/PersonnelTab.test.tsx src/renderer/src/tabs/assembler/__tests__/SaveGroupModal.test.tsx src/renderer/src/tabs/assembler/__tests__/ScheduleBridgeModal.test.tsx
```

Expected: FAIL on structural assertions while the existing behavior assertions remain green.

- [ ] **Step 3: Select variants and shared footers for feature modal components**

Replace the six current opening tags with these exact tags:

```tsx
<Modal
  isOpen={isOpen}
  onClose={onClose}
  title={`Edit Card: ${teamName}`}
  variant="large"
  bodyClassName="modal-body-generic--nested-scroll"
>
<Modal
  isOpen={isOpen}
  onClose={onClose}
  title={isEditing ? 'Edit Alarm' : 'Schedule Alarm'}
  variant="standard"
>
<Modal isOpen={isOpen} onClose={onClose} title="Alarms" variant="wide">
<Modal isOpen={isOpen} onClose={onClose} title="Meeting Recording" variant="confirmation">
<Modal isOpen={isOpen} onClose={handleClose} title={title} subtitle={description} variant="standard">
<Modal isOpen={isOpen} onClose={onClose} title="Schedule Bridge" variant="standard">
```

For Maintain Team, Alert Reminder, Bridge Reminder, Save Group, and Schedule Bridge, move the existing action buttons into `footer`. Use a `useId()` form ID for Alert Reminder and Schedule Bridge so the shared footer submit button keeps native form submission. Remove `if (!isOpen) return null` from `SaveGroupModal`; the shared `Modal` now owns unmount timing.

- [ ] **Step 4: Migrate tab-inline modals and remove conditional shell mounting**

Replace the five current inline opening tags with:

```tsx
<Modal
  isOpen={Boolean(dir.groupSelectorContact)}
  onClose={() => dir.setGroupSelectorContact(null)}
  variant="confirmation"
  title="Manage Groups"
>
<Modal
  isOpen={Boolean(groupSelectorEmail)}
  onClose={() => setGroupSelectorEmail(null)}
  variant="confirmation"
  title="Manage Groups"
>
<Modal
  isOpen={pinPromptModal.isOpen}
  onClose={pinPromptModal.close}
  variant="confirmation"
  title="Pin Template"
>
<Modal
  isOpen={Boolean(renamingTeam)}
  onClose={() => setRenamingTeam(null)}
  variant="confirmation"
  title="Rename Card"
>
<Modal
  isOpen={addTeamModal.isOpen}
  onClose={addTeamModal.close}
  variant="standard"
  title="Add New Card"
>
```

Render the Directory and Compose group-selector `Modal` components unconditionally and guard only their body content:

```tsx
<Modal
  isOpen={Boolean(dir.groupSelectorContact)}
  onClose={() => dir.setGroupSelectorContact(null)}
  title="Manage Groups"
  variant="confirmation"
>
  {dir.groupSelectorContact && (
    <GroupSelector
      contact={dir.groupSelectorContact}
      groups={groups}
      onClose={() => dir.setGroupSelectorContact(null)}
    />
  )}
</Modal>
```

Render the Personnel `ConfirmModal` unconditionally with `isOpen={Boolean(confirmDelete)}` and null-safe message/callback expressions. `Modal` retains the last open children and footer while closing.

In `App.tsx`, replace the conditional Data Manager wrapper with:

```tsx
<Suspense fallback={null}>
  <DataManagerModal isOpen={dataManagerModal.isOpen} onClose={dataManagerModal.close} />
</Suspense>
```

- [ ] **Step 5: Consolidate feature action CSS onto the modal footer**

Delete the local `*-actions` layout declarations after their buttons move. Keep form-field, error, list, DnD, and reminder-row styles unchanged. Add only feature content constraints:

```css
.maintain-team-body,
.alert-reminder-manager,
.save-group-content { min-height: 0; }

.maintain-team-scroll {
  min-height: 0;
  overscroll-behavior: contain;
}

.alert-reminder-manager-list { overscroll-behavior: contain; }

.modal-dialog-generic .alert-reminder-form,
.modal-dialog-generic .schedule-bridge-form {
  display: grid;
  gap: var(--space-4);
}
```

Keep `.maintain-team-scroll` as the single overflow owner inside its workspace-style modal body. The shared `.modal-body-generic` remains the only overflow owner for Alert Reminder Manager, Save Group, and the other ordinary content modals; do not add nested `overflow-y` to their lists.

- [ ] **Step 6: Run all migrated feature modal tests**

```bash
npm run test:renderer -- src/renderer/src/components/__tests__/MaintainTeamModal.test.tsx src/renderer/src/tabs/__tests__/AlertReminderModal.test.tsx src/renderer/src/tabs/__tests__/AlertReminderManagerModal.test.tsx src/renderer/src/tabs/__tests__/AlertsTab.test.tsx src/renderer/src/tabs/__tests__/DirectoryTab.test.tsx src/renderer/src/tabs/__tests__/AssemblerTab.test.tsx src/renderer/src/tabs/__tests__/PersonnelTab.test.tsx src/renderer/src/tabs/assembler/__tests__/SaveGroupModal.test.tsx src/renderer/src/tabs/assembler/__tests__/ScheduleBridgeModal.test.tsx
```

Expected: PASS with no changed handler payloads or accessible names.

- [ ] **Step 7: Commit Task 5**

```bash
git add -p src/renderer/src/App.tsx src/renderer/src/components/MaintainTeamModal.tsx src/renderer/src/components/oncall/oncall.css src/renderer/src/tabs/AlertReminderModal.tsx src/renderer/src/tabs/AlertReminderManagerModal.tsx src/renderer/src/tabs/AlertsTab.tsx src/renderer/src/tabs/DirectoryTab.tsx src/renderer/src/tabs/AssemblerTab.tsx src/renderer/src/tabs/PersonnelTab.tsx src/renderer/src/tabs/assembler src/renderer/src/styles/components.css src/renderer/src/tabs/alerts.css src/renderer/src/tabs/assembler/assembler.css
git diff --cached
git diff --cached --check
git commit -m "style(ui): migrate workflow modals"
```

---

### Task 6: Data Manager Reference Wide Workspace

**Files:**
- Modify: `src/renderer/src/components/DataManagerModal.tsx`
- Modify: `src/renderer/src/components/data-manager/SharedComponents.tsx`
- Modify: `src/renderer/src/components/data-manager/{DataManagerOverview,DataManagerImport,DataManagerExport,DataManagerBackups}.tsx`
- Modify: `src/renderer/src/styles/components.css:3064-3270`
- Modify: `src/renderer/src/components/__tests__/DataManagerModal.test.tsx`
- Test: `src/renderer/src/components/data-manager/__tests__/{DataManagerBackups,DataManagerSubcomponents}.test.tsx`

**Interfaces:**
- Consumes: `Modal` `wide`, `tabs`, and shared panel motion.
- Produces: the reference wide-workspace modal treatment for the rest of Relay.

- [ ] **Step 1: Add failing reference-workspace assertions**

Extend `DataManagerModal.test.tsx`:

```tsx
it('uses the wide shared shell and stable tab rail', () => {
  render(<DataManagerModal isOpen onClose={onClose} />);
  const dialog = screen.getByRole('dialog', { name: 'Data Manager' });
  expect(dialog).toHaveAttribute('data-variant', 'wide');
  expect(dialog.querySelector('.modal-tabs-generic')).not.toBeNull();
  expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
});

it('keys the active panel for the shared 160ms content transition', () => {
  render(<DataManagerModal isOpen onClose={onClose} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Import' }));
  expect(screen.getByRole('tabpanel', { name: 'Import' })).toHaveAttribute(
    'data-motion',
    'panel',
  );
});
```

Also strengthen the existing export/import tests to keep asserting the exact hook call payloads already produced by `handleExport` and `handleImport`.

- [ ] **Step 2: Run Data Manager tests and verify structural failures**

```bash
npm run test:renderer -- src/renderer/src/components/__tests__/DataManagerModal.test.tsx src/renderer/src/components/data-manager/__tests__/DataManagerSubcomponents.test.tsx src/renderer/src/components/data-manager/__tests__/DataManagerBackups.test.tsx
```

Expected: FAIL because the tabs are inside the body, lack `role="tab"`, and the panel has no shared motion marker.

- [ ] **Step 3: Move the tab list into the shared rail**

Update `TabButton` to accept `id` and `controls` and render:

```tsx
<button
  id={id}
  type="button"
  role="tab"
  aria-selected={active}
  aria-controls={controls}
  tabIndex={active ? 0 : -1}
  onClick={onClick}
  className={`dm-tab-btn${active ? ' dm-tab-btn--active' : ''}`}
>
  {children}
</button>
```

In `DataManagerModal`, build the four buttons once and pass them to `tabs`:

```tsx
const tabs = (
  <div role="tablist" aria-label="Data Manager sections" className="data-manager-tablist">
    {(['overview', 'import', 'export', 'backups'] as const).map((tab) => (
      <TabButton
        key={tab}
        id={`data-manager-tab-${tab}`}
        controls={`data-manager-panel-${tab}`}
        active={activeTab === tab}
        onClick={() => setActiveTab(tab)}
      >
        {tab[0].toUpperCase() + tab.slice(1)}
      </TabButton>
    ))}
  </div>
);

<Modal
  isOpen={isOpen}
  onClose={onClose}
  title="Data Manager"
  subtitle="Import, export, inspect, and protect Relay data."
  variant="wide"
  tabs={tabs}
  bodyClassName="data-manager-body"
>
  <div
    key={activeTab}
    id={`data-manager-panel-${activeTab}`}
    role="tabpanel"
    aria-labelledby={`data-manager-tab-${activeTab}`}
    aria-label={activeTab[0].toUpperCase() + activeTab.slice(1)}
    data-motion="panel"
    className="data-manager-panel"
  >
    {activeTab === 'overview' && <DataManagerOverview stats={stats} />}
    {activeTab === 'import' && (
      <DataManagerImport
        importCategory={importCategory}
        setImportCategory={setImportCategory}
        importing={importing}
        onImport={handleImport}
        lastImportResult={lastImportResult}
        onClearResult={clearLastImportResult}
      />
    )}
    {activeTab === 'export' && (
      <DataManagerExport
        exportCategory={exportCategory}
        setExportCategory={setExportCategory}
        exportFormat={exportFormat}
        setExportFormat={setExportFormat}
        includeMetadata={includeMetadata}
        setIncludeMetadata={setIncludeMetadata}
        exporting={exporting}
        onExport={handleExport}
      />
    )}
    {activeTab === 'backups' && <DataManagerBackups />}
  </div>
</Modal>
```

- [ ] **Step 4: Restyle Data Manager as one workspace rather than nested cards**

Replace the current body/tab/stat treatment with:

```css
.data-manager-body { padding: 0; }
.data-manager-tablist {
  display: flex;
  height: 48px;
  align-items: stretch;
  padding: 0 var(--space-5);
}
.dm-tab-btn {
  position: relative;
  min-width: 104px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-text-tertiary);
  font-family: var(--font-family-base);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background var(--transition-fast),
    border-bottom-color var(--transition-fast);
}
.dm-tab-btn:hover { color: var(--color-text-primary); background: var(--color-hover-overlay); }
.dm-tab-btn--active { border-bottom-color: var(--accent); color: var(--color-text-primary); }
.dm-tab-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }
.data-manager-panel { padding: var(--space-5); }
.data-manager-section { display: grid; gap: var(--space-4); }
.data-manager-section-heading {
  color: var(--color-text-primary);
  font-family: var(--font-family-base);
  font-size: var(--text-md);
  font-weight: var(--weight-bold);
  letter-spacing: 0;
  text-transform: none;
}
.data-manager-stats-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-block: 1px solid var(--color-border);
}
.dm-stat-card {
  min-width: 0;
  padding: var(--space-4);
  border: 0;
  border-right: 1px solid var(--color-border);
  border-radius: 0;
  background: transparent;
}
.dm-stat-card:last-child { border-right: 0; }
.dm-stat-count { font-family: var(--font-family-mono); font-variant-numeric: tabular-nums; }
.dm-stat-label,
.data-manager-section-description,
.data-manager-checkbox-label { font-family: var(--font-family-base); }
```

Use existing semantic colors and keep file paths, timestamps, formats, and fixed counts in monospace. Add a compact media rule that changes the metrics grid to two columns below 700px without reducing font sizes.

- [ ] **Step 5: Run Data Manager behavior and style regressions**

```bash
npm run test:renderer -- src/renderer/src/components/__tests__/DataManagerModal.test.tsx src/renderer/src/components/data-manager/__tests__/DataManagerSubcomponents.test.tsx src/renderer/src/components/data-manager/__tests__/DataManagerBackups.test.tsx src/renderer/src/hooks/__tests__/useDataManager.test.ts
```

Expected: PASS with unchanged import/export/backup calls and toasts.

- [ ] **Step 6: Commit Task 6**

```bash
git add -p src/renderer/src/components/DataManagerModal.tsx src/renderer/src/components/data-manager src/renderer/src/styles/components.css src/renderer/src/components/__tests__/DataManagerModal.test.tsx
git diff --cached
git diff --cached --check
git commit -m "style(data): align Data Manager workspace"
```

---

### Task 7: History Surfaces and Nested Administration Dialogs

**Files:**
- Create: `src/renderer/src/hooks/useRetainedValue.ts`
- Create: `src/renderer/src/hooks/__tests__/useRetainedValue.test.ts`
- Modify: `src/renderer/src/components/HistoryModal.tsx`
- Modify: `src/renderer/src/tabs/AlertHistoryModal.tsx`
- Modify: `src/renderer/src/components/settings/administration/RoleAccountsPanel.tsx`
- Modify: `src/renderer/src/components/settings/administration/RelayServerPanel.tsx`
- Modify: `src/renderer/src/components/settings/administration/PairedDevicesPanel.tsx`
- Modify: `src/renderer/src/tabs/DynatraceProblemsTab.tsx`
- Modify: `src/renderer/src/styles/components.css`
- Modify: `src/renderer/src/tabs/{alerts,dynatrace-problems}.css`
- Test: `src/renderer/src/components/__tests__/HistoryModal.test.tsx`
- Test: `src/renderer/src/tabs/__tests__/{AlertHistoryModal,DynatraceProblemsTab}.test.tsx`
- Test: `src/renderer/src/components/settings/{AdministrationSettings.test,administration/RoleAccountsPanel.test}.tsx`

**Interfaces:**
- Consumes: nested-safe modal stack, retained closing content, large/standard/confirmation variants.
- Produces: `useRetainedValue<T>(value)` for identity-bearing dialogs and removes every remaining custom modal shell.

- [ ] **Step 1: Add retained-value and nested-dialog regressions**

Create `useRetainedValue.test.ts`:

```ts
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRetainedValue } from '../useRetainedValue';

it('keeps the last non-null value while a closing layer exits', () => {
  const { result, rerender } = renderHook(({ value }) => useRetainedValue(value), {
    initialProps: { value: { id: 'target-1' } as { id: string } | null },
  });
  rerender({ value: null });
  expect(result.current).toEqual({ id: 'target-1' });
});
```

Add assertions to existing tests:

```tsx
expect(screen.getByRole('dialog', { name: 'Alert History' })).toHaveAttribute(
  'data-variant',
  'large',
);
expect(screen.getByRole('dialog', { name: 'Edit template name' })).toHaveAttribute(
  'data-variant',
  'confirmation',
);
expect(screen.getByRole('dialog', { name: 'Confirm Publisher change' })).toHaveAttribute(
  'data-variant',
  'standard',
);
expect(screen.getByRole('dialog', { name: 'Alerting profile filter' })).toHaveAttribute(
  'data-variant',
  'standard',
);
```

- [ ] **Step 2: Run the focused tests and verify custom shells fail**

```bash
npm run test:renderer -- src/renderer/src/hooks/__tests__/useRetainedValue.test.ts src/renderer/src/components/__tests__/HistoryModal.test.tsx src/renderer/src/tabs/__tests__/AlertHistoryModal.test.tsx src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx src/renderer/src/components/settings/administration/RoleAccountsPanel.test.tsx
```

Expected: FAIL because the helper does not exist, History is bare, and the nested/custom dialogs do not use shared variants.

- [ ] **Step 3: Add the retained identity helper**

Create `useRetainedValue.ts`:

```ts
import { useRef } from 'react';

export function useRetainedValue<T>(value: T | null | undefined): T | null {
  const retained = useRef<T | null>(value ?? null);
  if (value !== null && value !== undefined) retained.current = value;
  return retained.current;
}
```

- [ ] **Step 4: Move History onto shared large anatomy**

Remove `if (!isOpen) return null` from `HistoryModal`. Replace the bare shell with:

```tsx
<Modal
  isOpen={isOpen}
  onClose={onClose}
  title={title}
  variant="large"
  width={width}
  bodyClassName={`${classPrefix}-content`}
  headerActions={
    history.length > 0 ? (
      <TactileButton variant="ghost" size="sm" onClick={() => setIsClearConfirmOpen(true)}>
        Clear All
      </TactileButton>
    ) : null
  }
  footer={
    <TactileButton variant="secondary" onClick={onClose}>
      Close
    </TactileButton>
  }
>
  {toolbar}
  {history.length === 0 ? (
    <div className={`${classPrefix}-empty`}>
      <div className={`${classPrefix}-empty-icon`}>{'\u2205'}</div>
      <p className={`${classPrefix}-empty-text`}>{emptyText}</p>
    </div>
  ) : (
    <div className={`${classPrefix}-list`}>
      {enablePinnedSections ? (
        <>
          {pinned.length > 0 && renderSection('pinned', pinnedSectionLabel, pinned)}
          {recent.length > 0 &&
            (pinned.length > 0
              ? renderSection('recent', recentSectionLabel, recent)
              : recent.map(renderEntryButton))}
        </>
      ) : (
        history.map(renderEntryButton)
      )}
    </div>
  )}
  {extraContent}

  <ConfirmModal
    isOpen={isClearConfirmOpen}
    onClose={() => setIsClearConfirmOpen(false)}
    onConfirm={onClear}
    title="Clear History?"
    message={clearConfirmText}
    confirmLabel="Clear History"
    isDanger
  />

  {contextMenu && (
    <ContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      onClose={() => setContextMenu(null)}
      items={getContextMenuItems(contextMenu.entry, {
        closeMenu: () => setContextMenu(null),
        closeModal: onClose,
      })}
    />
  )}
</Modal>
```

The shared modal body is History's only scroll region. In `alerts.css` and `assembler.css`, remove `max-height` and `overflow-y` from `.alert-history-list` and `.bridge-history-list`; retain their horizontal margin/padding and entry layout. Do not add overflow to `${classPrefix}-content`.

Delete feature header/footer shell CSS but keep entry, pinned, toolbar, empty, and list styles.

- [ ] **Step 5: Convert the Alert History label editor to a nested shared modal**

Remove the custom `<dialog>` from `extraContent`. Render this sibling after `HistoryModal`:

```tsx
<Modal
  isOpen={editingLabelId !== null}
  onClose={() => {
    setEditingLabelId(null);
    setLabelDraft('');
  }}
  title="Edit template name"
  variant="confirmation"
  footer={
    <>
      <TactileButton
        variant="secondary"
        onClick={() => {
          setEditingLabelId(null);
          setLabelDraft('');
        }}
      >
        Cancel
      </TactileButton>
      <TactileButton variant="primary" onClick={commitLabel}>Save</TactileButton>
    </>
  }
>
  <label className="alert-history-label-editor-label" htmlFor="alert-history-label-input">
    Template Name
  </label>
  <input
    id="alert-history-label-input"
    className="alert-history-label-input"
    value={labelDraft}
    onChange={(event) => setLabelDraft(event.target.value)}
    onKeyDown={(event) => {
      if (event.key === 'Enter') commitLabel();
      if (event.key === 'Escape') {
        setEditingLabelId(null);
        setLabelDraft('');
      }
    }}
    placeholder="e.g. Network Outage Template"
    maxLength={10000}
    autoFocus
  />
</Modal>
```

Keep `commitLabel` payload and `maxLength={10000}` unchanged. Delete `.alert-history-label-overlay` and `.alert-history-label-editor` shell CSS; retain label/input rules.

- [ ] **Step 6: Convert all three Administration confirmation shells**

Import `useId`, `Modal`, and `useRetainedValue`. Render each dialog component continuously with `isOpen` derived from its nullable action/target. Replace the current `ReauthenticationDialog` implementation in `RoleAccountsPanel.tsx` with this complete shared-shell version and call it unconditionally at the end of the panel:

```tsx
function ReauthenticationDialog({
  action,
  busy,
  error,
  currentAccountName,
  onConfirm,
  onClose,
}: Readonly<{
  action: ReauthenticationAction | null;
  busy: boolean;
  error: string | null;
  currentAccountName: string;
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}>) {
  const [password, setPassword] = useState('');
  const formId = useId();
  const retainedAction = useRetainedValue(action);

  useEffect(() => () => setPassword(''), []);

  const close = () => {
    setPassword('');
    onClose();
  };

  const submit = async (event: FormSubmitEvent) => {
    event.preventDefault();
    const submittedPassword = password;
    setPassword('');
    await onConfirm(submittedPassword);
  };

  const publisherChange = retainedAction?.kind === 'publisher';
  const title = publisherChange ? 'Confirm Publisher change' : 'Confirm ownership transfer';

  return (
    <Modal
      isOpen={action !== null}
      onClose={close}
      title={title}
      subtitle="Protected role change"
      variant="standard"
      dismissible={!busy}
      footer={
        <>
          <TactileButton type="button" variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </TactileButton>
          <TactileButton
            type="submit"
            form={formId}
            variant="primary"
            loading={busy}
          >
            {publisherChange ? 'Confirm Publisher change' : 'Transfer ownership'}
          </TactileButton>
        </>
      }
    >
      {retainedAction ? (
        <form id={formId} className="administration-dialog-form" onSubmit={(event) => void submit(event)}>
          <p>
            {publisherChange
              ? 'Publisher sessions and paired devices may be revoked when this assignment changes.'
              : `Ownership will move from ${currentAccountName} to ${retainedAction.account.displayName}. Sessions for the current and incoming Owner accounts will lock.`}
          </p>
          <label className="administration-field">
            <span>Password</span>
            <input
              type="password"
              className="tactile-input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          {error ? (
            <div className="administration-feedback administration-feedback--error" role="alert">
              {error}
            </div>
          ) : null}
        </form>
      ) : null}
    </Modal>
  );
}
```

Change the existing conditional call site to the continuous version:

```tsx
<ReauthenticationDialog
  action={reauthAction}
  busy={busy === 'reauthenticate'}
  error={dialogError ?? accessError}
  currentAccountName={session.state === 'active' ? session.displayName : 'the current Owner'}
  onConfirm={confirmReauthentication}
  onClose={closeReauthentication}
/>
```

In `RelayServerPanel.tsx`, add this close helper and replace the custom token dialog with the exact continuous shared shell below:

```tsx
const closeTokenConfirmation = () => {
  setPassword('');
  setPlatformToken('');
  setTokenConfirming(false);
};

const tokenFormId = useId();

<Modal
  isOpen={tokenConfirming}
  onClose={closeTokenConfirmation}
  title="Confirm platform token replacement"
  subtitle="Secret replacement"
  variant="standard"
  dismissible={busy !== 'reauthenticate'}
  footer={
    <>
      <TactileButton
        type="button"
        variant="secondary"
        onClick={closeTokenConfirmation}
        disabled={busy === 'reauthenticate'}
      >
        Cancel
      </TactileButton>
      <TactileButton
        type="submit"
        form={tokenFormId}
        variant="primary"
        loading={busy === 'reauthenticate'}
      >
        Replace token
      </TactileButton>
    </>
  }
>
  <form id={tokenFormId} className="administration-dialog-form" onSubmit={(event) => void replaceToken(event)}>
    <p>Relay will discard the prior token after the replacement is accepted.</p>
    <label className="administration-field">
      <span>Administrator password</span>
      <input
        autoFocus
        type="password"
        className="tactile-input"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        minLength={12}
        maxLength={128}
        required
      />
    </label>
  </form>
</Modal>
```

In `PairedDevicesPanel.tsx`, retain the target during exit and replace its custom revoke dialog with:

```tsx
const revokeFormId = useId();
const retainedRevokeTarget = useRetainedValue(revokeTarget);

const closeRevokeDialog = () => {
  setPassword('');
  setRevokeId(null);
};

<Modal
  isOpen={revokeId !== null}
  onClose={closeRevokeDialog}
  title={`Revoke ${retainedRevokeTarget?.label ?? 'paired workstation'}?`}
  subtitle="Device trust"
  variant="confirmation"
  dismissible={busy !== 'reauthenticate'}
  footer={
    <>
      <TactileButton
        type="button"
        variant="secondary"
        onClick={closeRevokeDialog}
        disabled={busy === 'reauthenticate'}
      >
        Cancel
      </TactileButton>
      <TactileButton
        type="submit"
        form={revokeFormId}
        variant="danger"
        loading={busy === 'reauthenticate'}
      >
        Revoke device
      </TactileButton>
    </>
  }
>
  <form id={revokeFormId} className="administration-dialog-form" onSubmit={(event) => void revoke(event)}>
    <p>Protected commands from this workstation will stop immediately.</p>
    <label className="administration-field">
      <span>Administrator password</span>
      <input
        autoFocus
        type="password"
        className="tactile-input"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        minLength={12}
        maxLength={128}
        required
      />
    </label>
  </form>
</Modal>
```

Delete `.administration-dialog-backdrop` and `.administration-dialog` shell CSS, add a small block-gap rule for `.administration-dialog-form`, and keep existing field/feedback rules. Preserve password clearing, reauthentication payloads, command payloads, errors, and busy labels exactly.

- [ ] **Step 7: Convert the Problems profile dialog to the shared standard shell**

Keep the trigger, selected-profile state, search, bulk actions, save/cancel behavior, and portal semantics. Replace the custom `createPortal` panel with:

```tsx
<Modal
  isOpen={open}
  onClose={closeWithoutSaving}
  title="Alerting profile filter"
  subtitle={`${profiles.length} available from Dynatrace`}
  variant="standard"
  bodyClassName="dt-profile-picker"
  footer={
    canSave ? (
      <>
        <TactileButton variant="secondary" onClick={closeWithoutSaving} disabled={saving}>
          Cancel
        </TactileButton>
        <TactileButton
          variant="primary"
          disabled={selectedProfiles.length === 0 || saving}
          loading={saving}
          onClick={() => void onSave().then((saved) => saved && setOpen(false))}
        >
          Save retention filter
        </TactileButton>
      </>
    ) : undefined
  }
>
  <label className="dt-profile-picker__search">
    <span className="sr-only">Search alerting profiles</span>
    <input
      type="search"
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      placeholder="Find an alerting profile"
      autoFocus
    />
  </label>
  <div className="dt-profile-picker__bulk-actions">
    <button type="button" onClick={() => onChange(profiles)} disabled={!canSave}>
      Select all
    </button>
    <button type="button" onClick={() => onChange([])} disabled={!canSave}>
      Clear
    </button>
    <span>{selectedProfiles.length} selected</span>
  </div>
  <div className="dt-profile-picker__list" role="group" aria-label="Alerting profiles">
    {visibleProfiles.map((profile) => (
      <label className="dt-profile-picker__option" key={profile}>
        <input
          type="checkbox"
          checked={selected.has(profile)}
          onChange={() => toggleProfile(profile)}
          disabled={!canSave}
        />
        <span>{profile}</span>
      </label>
    ))}
    {visibleProfiles.length === 0 && (
      <div className="dt-profile-picker__empty">No profiles match this search.</div>
    )}
  </div>
  <div className="dt-profile-picker__retention-note">
    {canSave
      ? 'Saving removes excluded problem records, local dispositions, and notes from Relay.'
      : 'Profile retention is managed on the Relay server.'}
  </div>
</Modal>
```

Delete fixed-position `style={position}` and custom dialog shell CSS. The trigger remains in the Problems toolbar and regains focus after exit.

- [ ] **Step 8: Run nested/history regressions**

```bash
npm run test:renderer -- src/renderer/src/hooks/__tests__/useRetainedValue.test.ts src/renderer/src/components/__tests__/HistoryModal.test.tsx src/renderer/src/tabs/__tests__/AlertHistoryModal.test.tsx src/renderer/src/tabs/assembler/__tests__/BridgeHistoryModal.test.tsx src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx src/renderer/src/components/settings/AdministrationSettings.test.tsx src/renderer/src/components/settings/administration/RoleAccountsPanel.test.tsx
```

Expected: PASS, including nested Clear History confirmation, template label save/cancel, privileged password clearing, and exact protected command payloads.

- [ ] **Step 9: Prove no custom modal shell remains**

```bash
rg -n "createPortal\(|<dialog\b|role=\"dialog\"" src/renderer/src --glob '*.tsx'
```

Expected: direct `<dialog>` appears only in `components/Modal.tsx`; remaining portals are explicitly non-modal tooltips, menus, search results, clocks, and dashboard popovers. `KnowledgePdfViewer` may retain `role="dialog"` for its anchored View options popover because it is not a blocking modal.

- [ ] **Step 10: Commit Task 7**

```bash
git add src/renderer/src/hooks/useRetainedValue.ts src/renderer/src/hooks/__tests__/useRetainedValue.test.ts
git add -p src/renderer/src/components/HistoryModal.tsx src/renderer/src/tabs/AlertHistoryModal.tsx src/renderer/src/components/settings/administration src/renderer/src/tabs/DynatraceProblemsTab.tsx src/renderer/src/styles/components.css src/renderer/src/tabs/alerts.css src/renderer/src/tabs/dynatrace-problems.css src/renderer/src/components/__tests__ src/renderer/src/tabs/__tests__
git diff --cached
git diff --cached --check
git commit -m "style(ui): unify history and nested dialogs"
```

---

### Task 8: Floating Layers and Toast Presence

**Files:**
- Modify: `src/renderer/src/components/ContextMenu.tsx`
- Modify: `src/renderer/src/components/Combobox.tsx`
- Modify: `src/renderer/src/components/HeaderSearch.tsx`
- Modify: `src/renderer/src/components/Tooltip.tsx`
- Modify: `src/renderer/src/components/WorldClock.tsx`
- Modify: `src/renderer/src/components/Toast.tsx`
- Modify: `src/renderer/src/components/sidebar/SidebarDashboards.tsx`
- Modify: `src/renderer/src/tabs/alerts/HighlightPopover.tsx`
- Modify: `src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx`
- Modify: `src/renderer/src/styles/{components,toast}.css`
- Modify: `src/renderer/src/features/knowledge/knowledge.css`
- Test: existing ContextMenu, Combobox, HeaderSearch, Tooltip, WorldClock, Toast, SidebarDashboards, HighlightPopover, and KnowledgePdfViewer tests.

**Interfaces:**
- Consumes: `data-motion="popover"`, `data-motion="toast"`, 160ms state motion, and 220/160ms layer motion.
- Produces: one bounded floating-layer entrance language and stateful toast exits without changing menu/dropdown behavior.

- [ ] **Step 1: Add motion-marker and toast-exit tests**

In each existing floating-layer test, open the layer and assert its visible surface has `data-motion="popover"`. Add this Toast regression:

```tsx
it('keeps a dismissed toast mounted in closing state for its exit', () => {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <ToastTrigger message="Saved" type="success" />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByTestId('trigger'));
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
  expect(screen.getByText('Saved').closest('.toast')).toHaveAttribute('data-state', 'closing');
  act(() => vi.advanceTimersByTime(159));
  expect(screen.getByText('Saved')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByText('Saved')).toBeNull();
  vi.useRealTimers();
});
```

Update the existing manual-dismiss, action-dismiss, and four-second auto-dismiss tests to assert `data-state="closing"` immediately after dismissal and absence only after advancing the additional 160ms exit.

- [ ] **Step 2: Run the focused layer tests and verify failures**

```bash
npm run test:renderer -- src/renderer/src/components/__tests__/ContextMenu.test.tsx src/renderer/src/components/__tests__/Combobox.test.tsx src/renderer/src/components/__tests__/HeaderSearch.test.tsx src/renderer/src/components/__tests__/Tooltip.test.tsx src/renderer/src/components/__tests__/WorldClock.test.tsx src/renderer/src/components/__tests__/Toast.test.tsx src/renderer/src/components/__tests__/sidebar/SidebarDashboards.test.tsx src/renderer/src/tabs/alerts/__tests__/HighlightPopover.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgePdfViewer.test.tsx
```

Expected: FAIL on missing `data-motion` and immediate toast removal.

- [ ] **Step 3: Mark floating surfaces and remove scale-based entrances**

Add the attribute on the existing opening element for each surface:

```tsx
<div className="context-menu" role="menu" data-motion="popover">
<div className="combobox-dropdown" data-motion="popover">
<div className="search-dropdown" id="header-search-dropdown" data-motion="popover">
<div className="tooltip-popup" data-motion="popover">
<div className="world-clock-popover" data-motion="popover">
<div className="sidebar-dashboards-popover" data-motion="popover">
<div className="alerts-hl-popover" role="menu" data-motion="popover">
<div className="knowledge-viewer__view-panel" role="dialog" data-motion="popover">
```

Remove `animate-scale-in`, `scaleIn`, and one-off 150ms entrance declarations from those surfaces. Preserve their positioning, focus, listbox/menu/dialog roles, keyboard handling, and outside-click behavior.

- [ ] **Step 4: Add closing state to toasts**

Extend `ToastMessage` with `state: 'open' | 'closing'`. Insert new toasts with `state: 'open'`. Split removal into:

```ts
const finalizeToastRemoval = useCallback((id: string) => {
  setToasts((current) => current.filter((toast) => toast.id !== id));
  const timeout = timeoutsRef.current.get(id);
  if (timeout) globalThis.clearTimeout(timeout);
  timeoutsRef.current.delete(id);
}, []);

const removeToast = useCallback(
  (id: string) => {
    setToasts((current) =>
      current.map((toast) => (toast.id === id ? { ...toast, state: 'closing' } : toast)),
    );
    const existing = timeoutsRef.current.get(id);
    if (existing) globalThis.clearTimeout(existing);
    const exit = globalThis.setTimeout(() => finalizeToastRemoval(id), 160);
    timeoutsRef.current.set(id, exit);
  },
  [finalizeToastRemoval],
);
```

Render each toast with:

```tsx
<div
  key={toast.id}
  className={`toast toast-${toast.type}`}
  data-motion="toast"
  data-state={toast.state}
>
```

Update `toast.css`:

```css
.toast { transition: opacity var(--motion-duration-layer-exit) var(--motion-ease-out), transform var(--motion-duration-layer-exit) var(--motion-ease-out); }
.toast[data-state='closing'] { opacity: 0; transform: translateX(8px); }
.toast-close { transition: color var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast); }
```

Delete `toastSlideUp` and `.toast-slide-up`.

- [ ] **Step 5: Run all floating-layer tests**

```bash
npm run test:renderer -- src/renderer/src/components/__tests__/ContextMenu.test.tsx src/renderer/src/components/__tests__/Combobox.test.tsx src/renderer/src/components/__tests__/HeaderSearch.test.tsx src/renderer/src/components/__tests__/Tooltip.test.tsx src/renderer/src/components/__tests__/WorldClock.test.tsx src/renderer/src/components/__tests__/Toast.test.tsx src/renderer/src/components/__tests__/sidebar/SidebarDashboards.test.tsx src/renderer/src/tabs/alerts/__tests__/HighlightPopover.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgePdfViewer.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 8**

```bash
git add -p src/renderer/src/components/ContextMenu.tsx src/renderer/src/components/Combobox.tsx src/renderer/src/components/HeaderSearch.tsx src/renderer/src/components/Tooltip.tsx src/renderer/src/components/WorldClock.tsx src/renderer/src/components/Toast.tsx src/renderer/src/components/sidebar/SidebarDashboards.tsx src/renderer/src/tabs/alerts/HighlightPopover.tsx src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx src/renderer/src/styles/components.css src/renderer/src/styles/toast.css src/renderer/src/features/knowledge/knowledge.css src/renderer/src/components/__tests__ src/renderer/src/tabs/alerts/__tests__ src/renderer/src/features/knowledge/__tests__/KnowledgePdfViewer.test.tsx
git diff --cached
git diff --cached --check
git commit -m "style(ui): unify floating layer motion"
```

---

### Task 9: Top-Level Tabs, Knowledge, Drawers, Detail Panels, and Loading Motion

**Files:**
- Modify: `src/renderer/src/App.tsx:80-114`
- Modify: `src/renderer/src/__tests__/App.test.tsx`
- Modify: `src/renderer/src/features/knowledge/KnowledgeWorkspace.tsx`
- Modify: `src/renderer/src/features/knowledge/KnowledgeTab.tsx`
- Modify: `src/renderer/src/features/knowledge/knowledgeWorkspace.css`
- Modify: `src/renderer/src/features/knowledge/knowledge.css`
- Modify: `src/renderer/src/components/PopoutBoard.tsx`
- Modify: `src/renderer/src/components/sidebar/sidebar.css`
- Modify: `src/renderer/src/tabs/PersonnelTab.tsx`
- Modify: `src/renderer/src/components/directory/directory.css`
- Modify: `src/renderer/src/tabs/assembler/assembler.css`
- Modify: `src/renderer/src/styles/setup.css`
- Modify: `src/renderer/src/styles/animations.css`
- Modify: `src/renderer/src/components/{statusbar,oncall/oncall}.css`
- Modify: `src/renderer/src/tabs/{alerts,cloud-status,dynatrace-problems}.css`
- Modify: `src/renderer/src/theme/__tests__/motionSystemStyles.test.ts`
- Test: App, KnowledgeWorkspace, KnowledgeTab, KnowledgePdfViewer, PersonnelTab, CloudStatusTab, DynatraceProblemsTab, and AlertsTab tests.

**Interfaces:**
- Consumes: shared panel/state/structure tokens and reduced-motion behavior.
- Produces: restrained motion at every major application state boundary without animating operational result sets or PDF pages.

- [ ] **Step 1: Extend motion coverage tests**

Add to `motionSystemStyles.test.ts`:

```ts
const knowledgeCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/features/knowledge/knowledge.css'),
  'utf8',
);
const knowledgeWorkspaceCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/features/knowledge/knowledgeWorkspace.css'),
  'utf8',
);

it('uses shared state and structure tokens in Knowledge', () => {
  expect(knowledgeWorkspaceCss).toMatch(
    /\.knowledge-workspace-shell__panel\[data-state='active'\][\s\S]*relay-panel-in var\(--motion-duration-state\)/,
  );
  expect(knowledgeCss).toMatch(
    /\.knowledge-drawer\s*{[\s\S]*transform var\(--motion-duration-structure\) var\(--motion-ease-out\)/,
  );
  expect(knowledgeCss).toMatch(
    /\.knowledge-drawer-backdrop\s*{[\s\S]*opacity var\(--motion-duration-state\) var\(--motion-ease-out\)/,
  );
  expect(knowledgeCss).not.toMatch(/\.knowledge-page[^}]*animation:/);
});

it('does not stagger operational lists', () => {
  expect(animationCss).not.toContain('.stagger-children');
  expect(animationCss).not.toContain('.animate-card-entrance');
});
```

In `App.test.tsx`, assert an active `RetainedTabPanel` has `data-state="active"` and an inactive retained panel has `data-state="retained"`.

- [ ] **Step 2: Run motion coverage tests and verify failures**

```bash
npm run test:renderer -- src/renderer/src/theme/__tests__/motionSystemStyles.test.ts src/renderer/src/__tests__/App.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgeWorkspace.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgeTab.test.tsx
```

Expected: FAIL because retained tab state is only encoded in a class, Knowledge uses literal 180/200ms values, and stagger utilities remain.

- [ ] **Step 3: Mark top-level and Knowledge destination state**

Update `RetainedTabPanel`:

```tsx
<div
  className={getTabPanelClassName(active)}
  data-motion={active ? 'panel' : undefined}
  data-state={active ? 'active' : 'retained'}
>
  <Activity mode={active ? 'visible' : 'hidden'}>{children}</Activity>
</div>
```

The existing `WorkspacePanel` already has `data-state`. Add `data-motion={isActive ? 'panel' : undefined}`. Do not animate retained hidden destinations, contact/server rows, catalog card grids, PDF pages, or the continuous PDF viewport.

- [ ] **Step 4: Apply shared Knowledge drawer and reader motion**

Replace literal Knowledge control/drawer transitions with:

```css
.knowledge-library-toggle,
.knowledge-workspace-shell__destination,
.knowledge-drawer__collapse,
.knowledge-drawer__close,
.knowledge-drawer__modes > button,
.knowledge-viewer__controls button {
  transition:
    color var(--transition-fast),
    border-color var(--transition-fast),
    background-color var(--transition-fast);
}

.knowledge-drawer-backdrop {
  transition:
    opacity var(--motion-duration-state) var(--motion-ease-out),
    visibility 0s linear var(--motion-duration-state);
}

.knowledge-drawer {
  transition:
    opacity var(--motion-duration-structure) var(--motion-ease-out),
    transform var(--motion-duration-structure) var(--motion-ease-out),
    visibility 0s linear var(--motion-duration-structure);
}

.knowledge-workspace[data-library-drawer='open'] .knowledge-drawer {
  visibility: visible;
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
  transition-delay: 0s;
}
```

Keep desktop collapse immediate because reclaiming the grid column would require prohibited width/grid-track animation. Compact overlay mode uses transform plus opacity. Keep PDF scroll behavior and 100% default zoom unchanged.

Map the main navigation's existing accent rail to the same stable control tier in `sidebar.css`:

```css
.sidebar-item-label {
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}

.sidebar-item--active .sidebar-item-label {
  border-color: currentColor;
}

.sidebar-item-accent {
  transition:
    opacity var(--transition-fast),
    background-color var(--transition-fast);
}
```

Remove the active-only padding increase, the obsolete “size bump” comment, the active rail width increase, and the rail's width transition. Only the rail/color state transitions; sidebar labels, padding, and geometry remain stable.

Add `data-motion="panel"` to the mounted post-snapshot Knowledge catalog root so the replacement of `.knowledge-tab--loading` with real SOP covers gets one 160ms opacity/4px settle:

```tsx
<div className="knowledge-tab knowledge-tab--catalog" data-motion="panel">
  <KnowledgeLibrary
    documents={documents}
    categories={categories}
    canManage={canManage}
    onManage={() => setManagementOpen(true)}
    onOpenDocument={(documentId) => {
      setSelectedDocumentId(documentId);
      setActiveHeadingId(null);
      setTarget(null);
      setSidebarMode('contents');
      setView('reader');
    }}
  />
</div>
```

Do not animate individual skeleton tiles, SOP covers, document rows, or PDF pages; the content surface enters once as a unit.

- [ ] **Step 5: Remove list choreography and normalize detail-panel motion**

Remove `stagger-children` and `animate-card-entrance` from `PersonnelTab.tsx` and `PopoutBoard.tsx`, then delete their CSS rules/keyframes from `animations.css`.

Replace `detailPanelFadeIn` declarations in Directory and Assembler with:

```css
animation: relay-panel-in var(--motion-duration-state) var(--motion-ease-out);
```

Use the same declaration only on newly mounted Alerts/Problems detail surfaces and collapsible bodies. Do not add it to row lists, polling feeds, status incident lists, on-call masonry items, or PDF content.

- [ ] **Step 6: Shorten setup/loading choreography and preserve semantic indicators**

Replace setup entrance durations of 400–600ms with the shared tiers:

```css
.setup-brand { animation: relay-panel-in var(--motion-duration-layer-enter) var(--motion-ease-out); }
.setup-card,
.setup-step,
.startup-error { animation: relay-panel-in var(--motion-duration-state) var(--motion-ease-out); }
```

Keep indeterminate spinners linear. Convert hard-coded 120–300ms control transitions in Status, Problems, Alerts, On-Call, and sidebar CSS to `--transition-fast`, `--transition-base`, or `--transition-smooth` by role. Add this shared semantic-feedback block to `animations.css`:

```css
.data-manager-import-result,
.administration-feedback,
.alert-reminder-manager-error,
.knowledge-viewer-state--error {
  transition:
    opacity var(--transition-base),
    color var(--transition-fast),
    border-color var(--transition-fast),
    background-color var(--transition-fast);
}
```

This is color/opacity feedback only. Keep each error or result readable from its first rendered frame; do not animate height, position, shaking, or pulsing.

Add static reduced-motion fallbacks:

```css
@media (prefers-reduced-motion: reduce) {
  .statusbar-live-dot,
  .oncall-live-indicator,
  .critical-reminder-indicator { opacity: 1; animation: none; }
}
```

- [ ] **Step 7: Run app, Knowledge, and tab regressions**

```bash
npm run test:renderer -- src/renderer/src/theme/__tests__/motionSystemStyles.test.ts src/renderer/src/__tests__/App.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgeWorkspace.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgeTab.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgeLibrary.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgePdfViewer.test.tsx src/renderer/src/tabs/__tests__/PersonnelTab.test.tsx src/renderer/src/tabs/__tests__/AlertsTab.test.tsx src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 9**

```bash
git add -p src/renderer/src/App.tsx src/renderer/src/__tests__/App.test.tsx src/renderer/src/features/knowledge src/renderer/src/components/PopoutBoard.tsx src/renderer/src/components/sidebar/sidebar.css src/renderer/src/tabs/PersonnelTab.tsx src/renderer/src/components/directory/directory.css src/renderer/src/tabs/assembler/assembler.css src/renderer/src/styles/animations.css src/renderer/src/styles/setup.css src/renderer/src/components/statusbar.css src/renderer/src/components/oncall/oncall.css src/renderer/src/tabs/alerts.css src/renderer/src/tabs/cloud-status.css src/renderer/src/tabs/dynatrace-problems.css src/renderer/src/theme/__tests__/motionSystemStyles.test.ts
git diff --cached
git diff --cached --check
git commit -m "style(ui): apply operational motion across Relay"
```

---

### Task 10: Typography Canonicalization and Legacy Motion Cleanup

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/renderer/src/tabs/AlertsTab.tsx:31-32`
- Modify: `src/renderer/src/styles/components.css:1935-2230`
- Modify: `src/renderer/src/styles/{animations,modals}.css`
- Modify: `src/renderer/src/features/knowledge/{knowledge,knowledgeWorkspace}.css`
- Modify: `src/renderer/src/theme/__tests__/motionSystemStyles.test.ts`
- Test: `src/renderer/src/features/knowledge/__tests__/KnowledgeTypographyStyles.test.ts`
- Test: `src/renderer/src/components/settings/PrivilegedAccessPanelStyles.test.ts`
- Test: `src/renderer/src/tabs/__tests__/AlertForm.test.tsx`

**Interfaces:**
- Consumes: canonical font tokens and migrated motion consumers.
- Produces: one installed UI family, one installed technical family, no undefined font aliases, and no obsolete entrance utilities.

- [ ] **Step 1: Add failing font and legacy-motion assertions**

Append to `motionSystemStyles.test.ts`:

```ts
it('uses canonical font tokens and removes superseded motion helpers', () => {
  const rendererCss = [themeCss, animationCss, componentsCss, modalsCss].join('\n');
  expect(rendererCss).not.toContain('var(--font-mono)');
  expect(modalsCss).toMatch(/\.modal-dialog-generic\s*{[^}]*font-family:\s*var\(--font-family-base\)/);
  expect(animationCss).not.toContain('.animate-fade-in');
  expect(animationCss).not.toContain('.animate-scale-in');
  expect(animationCss).not.toContain('@keyframes scaleIn');
  expect(animationCss).not.toContain('@keyframes cardEntrance');
});
```

Add a package assertion:

```ts
const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
) as { dependencies: Record<string, string> };
expect(packageJson.dependencies).not.toHaveProperty('@fontsource/ibm-plex-mono');
expect(packageJson.dependencies).toHaveProperty('@fontsource/ibm-plex-sans');
expect(packageJson.dependencies).toHaveProperty('@fontsource/jetbrains-mono');
```

- [ ] **Step 2: Run typography contracts and verify failure**

```bash
npm run test:renderer -- src/renderer/src/theme/__tests__/motionSystemStyles.test.ts src/renderer/src/features/knowledge/__tests__/KnowledgeTypographyStyles.test.ts src/renderer/src/components/settings/PrivilegedAccessPanelStyles.test.ts src/renderer/src/tabs/__tests__/AlertForm.test.tsx
```

Expected: FAIL on `--font-mono`, the installed IBM Plex Mono package, and legacy animation helpers.

- [ ] **Step 3: Remove the unused IBM Plex Mono runtime font**

Delete these imports from `AlertsTab.tsx`:

```ts
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
```

Then update package metadata:

```bash
npm uninstall @fontsource/ibm-plex-mono --package-lock-only
```

Expected: `package.json` and `package-lock.json` remove only `@fontsource/ibm-plex-mono`; installed IBM Plex Sans and JetBrains Mono remain.

- [ ] **Step 4: Canonicalize font roles**

Replace the three undefined aliases in `components.css`:

```css
.privileged-access__code,
.privileged-access__challenge dd,
.administration-panel__metric {
  font-family: var(--font-family-mono);
}
```

Ensure these ordinary UI selectors use IBM Plex Sans:

```css
.modal-dialog-generic,
.modal-title-generic,
.modal-subtitle-generic,
.modal-body-generic,
.modal-footer-generic,
.knowledge-tab__kicker,
.knowledge-library-toggle,
.knowledge-viewer__loading,
.knowledge-viewer-state--error button,
.knowledge-workspace-shell__failure-eyebrow,
.knowledge-management__rail button,
.knowledge-management-row__warning,
.knowledge-upload-queue__recovery {
  font-family: var(--font-family-base);
}
```

Keep monospace on shortcut keys, role/account codes, file paths, file sizes, timestamps, page counts, ticket identifiers, technical entity IDs, and fixed-width readouts. Do not modify PDF text-layer fonts.

- [ ] **Step 5: Delete obsolete motion declarations**

After Tasks 3, 8, and 9 remove their consumers, delete `fadeIn`, `scaleIn`, `cardEntrance`, `.animate-fade-in`, `.animate-scale-in`, `.animate-card-entrance`, and `.stagger-children` declarations. Keep `spin`, `breathe`, `relay-panel-in`, `relay-popover-in`, `relay-toast-in`, and the reduced-motion block.

Verify no reference remains:

```bash
rg -n "animate-(fade-in|scale-in|card-entrance)|stagger-children|scaleIn|cardEntrance|transition-(bouncy|premium)|var\(--font-mono\)" src/renderer/src
```

Expected: no matches.

- [ ] **Step 6: Run typography and style regressions**

```bash
npm run test:renderer -- src/renderer/src/theme/__tests__/motionSystemStyles.test.ts src/renderer/src/features/knowledge/__tests__/KnowledgeTypographyStyles.test.ts src/renderer/src/features/knowledge/__tests__/KnowledgeCatalogStyles.test.ts src/renderer/src/features/knowledge/__tests__/KnowledgeManagementStyles.test.ts src/renderer/src/components/settings/PrivilegedAccessPanelStyles.test.ts src/renderer/src/tabs/__tests__/AlertForm.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 10**

```bash
git add -p package.json package-lock.json src/renderer/src/tabs/AlertsTab.tsx src/renderer/src/styles/components.css src/renderer/src/styles/animations.css src/renderer/src/styles/modals.css src/renderer/src/features/knowledge/knowledge.css src/renderer/src/features/knowledge/knowledgeWorkspace.css src/renderer/src/theme/__tests__/motionSystemStyles.test.ts
git diff --cached
git diff --cached --check
git commit -m "style(ui): canonicalize motion and typography"
```

---

### Task 11: Full Regression and Live Electron Acceptance

**Files:**
- Verify only; no source changes are expected.

**Interfaces:**
- Consumes: all tasks above.
- Produces: evidence that motion, modal behavior, responsive layout, reduced motion, and existing Relay workflows remain correct.

- [ ] **Step 1: Run the complete automated gate**

```bash
npm run test:unit
npm run test:cache
npm run test:renderer
npm run lint
npm run format:check
npm run typecheck
npm run build
git diff --check
```

Expected: every command exits 0. If Prettier rewrites files, inspect the diff and rerun the entire gate after formatting.

- [ ] **Step 2: Run the focused modal matrix once more**

```bash
npm run test:renderer -- src/renderer/src/components/__tests__/Modal.test.tsx src/renderer/src/components/__tests__/ConfirmModal.test.tsx src/renderer/src/components/__tests__/NotesModal.test.tsx src/renderer/src/components/__tests__/DataManagerModal.test.tsx src/renderer/src/components/__tests__/HistoryModal.test.tsx src/renderer/src/components/settings/administration/RoleAccountsPanel.test.tsx src/renderer/src/tabs/__tests__/AlertHistoryModal.test.tsx src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Launch Relay and inspect full-width operation**

```bash
npm run dev
```

At a full 1920×1080-equivalent window, verify:

- Confirmation: destructive confirmation opens, closes, and uses 400px square geometry.
- Standard: Notes and Shortcuts use one header/body/footer rhythm and IBM Plex Sans UI copy.
- Wide: Data Manager shows header, stable tab rail, one scroll region, and unchanged import/export/backups behavior.
- Large: Maintain Team and a history modal fit without clipping and preserve DnD/list behavior.
- Nested: Clear History, template label edit, Administration reauthentication, token replacement, paired-device revocation, and Problems profile filter place focus only in the top dialog.
- Enter is a quiet fade plus 10px/1.5% settle; exit remains visible for 160ms; no bounce, blur, or decorative accent line appears.
- Escape, backdrop click, close button, non-dismissible busy state, and trigger focus restoration behave correctly.

- [ ] **Step 4: Inspect application motion at full width**

Verify:

- Compose, Alerts, On-Call, Knowledge, Status, Problems, and Settings activate with a 160ms/4px panel transition.
- Knowledge home, Wiki catalog, Contacts, Servers, Wiki reader, management workspace, sidebar mode tabs, compact drawer, and View menu use the shared language.
- Context menus, command search, comboboxes, tooltips, world clock, dashboard popovers, highlight popover, and toasts use a restrained 3–8px entrance without scale drama.
- Operational lists, on-call cards, polling feeds, PDF pages, and continuous PDF scrolling do not stagger or reanimate during refresh.
- Errors, validation, selection, and loading states remain immediately legible and interactive.

- [ ] **Step 5: Inspect compact-window behavior**

Resize Relay to approximately half of a 1920×1080 monitor and verify:

- All four modal variants respect viewport width and 85vh height with one internal scroll region.
- Headers, tab rails, close controls, form fields, and 44px footer actions do not overlap or clip.
- Knowledge switches to the overlay drawer; the backdrop fades, the drawer translates, focus returns to its trigger, and the PDF toolbar remains usable.
- Contacts, Servers, Compose, Alerts, Status, and Problems retain readable semantic font sizes; no compact-only font shrink is introduced.

- [ ] **Step 6: Inspect operating-system Reduce Motion**

Enable macOS Reduce Motion, relaunch or refresh Relay, and verify:

- Modal, drawer, tab, menu, popover, tooltip, and toast transforms disappear.
- State changes remain visible through near-instant opacity/color changes.
- Live/status indicators retain their static semantic color without breathing or pulsing.
- Spinners remain minimally comprehensible and all focus, keyboard, dismissal, and busy-state behavior is unchanged.

- [ ] **Step 7: Check runtime quality and final diff scope**

Confirm there are no console errors, clipping, double focus rings, font drift, or layout shift. Then run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected: only intended implementation/test files are changed; no generated output, local database, secret, or unrelated pre-existing hunk is staged.
