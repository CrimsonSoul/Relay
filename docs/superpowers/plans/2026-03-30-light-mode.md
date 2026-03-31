# Light Mode Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a light mode theme to Relay with System/Light/Dark switching, preserving the existing design language.

**Architecture:** CSS variable override approach — `:root` keeps dark defaults, `[data-theme="light"]` overrides all color variables. A `useTheme()` hook manages preference persistence, OS detection, and attribute toggling. Hardcoded `rgba()` values across CSS files get replaced with new semantic variables.

**Tech Stack:** CSS custom properties, React hook, secureStorage, matchMedia API

**Spec:** `docs/superpowers/specs/2026-03-30-light-mode-design.md`

---

### Task 1: Add New Semantic Overlay Variables to theme.css

**Files:**
- Modify: `src/renderer/src/styles/theme.css`

These new variables capture the hardcoded `rgba()` patterns used throughout the codebase. They go into the existing `:root` block so later tasks can reference them during the hardcoded-color cleanup.

- [ ] **Step 1: Add overlay and interaction variables to `:root`**

In `src/renderer/src/styles/theme.css`, add these variables after the `--border-strong` line (after line 82):

```css
  /* Overlay / Interaction */
  --color-hover-overlay: rgba(255, 255, 255, 0.02);
  --color-hover-overlay-strong: rgba(255, 255, 255, 0.04);
  --color-active-overlay: rgba(255, 255, 255, 0.06);
  --color-backdrop: rgba(0, 0, 0, 0.42);
  --color-divider: rgba(255, 255, 255, 0.025);
  --color-focus-ring: rgba(255, 255, 255, 0.08);
  --color-scrollbar: rgba(255, 255, 255, 0.1);
  --color-scrollbar-hover: rgba(255, 255, 255, 0.2);
```

- [ ] **Step 2: Update scrollbar styles to use variables**

Replace the hardcoded scrollbar colors in `theme.css` (around lines 188-211):

```css
*:hover {
  scrollbar-width: thin;
  scrollbar-color: var(--color-scrollbar) transparent;
}

::-webkit-scrollbar-thumb {
  background-color: var(--color-scrollbar);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-scrollbar-hover);
}
```

- [ ] **Step 3: Update header border to use variable**

Replace the hardcoded header border (line 265):

```css
.app-header {
  /* change border-bottom from: 1px solid rgba(255, 255, 255, 0.04) */
  border-bottom: 1px solid var(--color-border-subtle);
}
```

- [ ] **Step 4: Update `--chrome-bg` to use variable**

Replace the hardcoded `--chrome-bg: #0c0e15` (line 174) with:

```css
  --chrome-bg: var(--color-bg-chrome);
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All 1491 tests pass (CSS variable changes don't affect test behavior).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/styles/theme.css
git commit -m "refactor: add semantic overlay variables and remove hardcoded colors from theme.css"
```

---

### Task 2: Add the Light Theme Variable Override Block

**Files:**
- Modify: `src/renderer/src/styles/theme.css`

- [ ] **Step 1: Add `[data-theme="light"]` block**

Add this block after the closing `}` of `:root` (before the `* { box-sizing }` rule):

```css
/* === Relay Light Theme === */
[data-theme="light"] {
  color-scheme: light;

  /* Backgrounds */
  --color-bg-app: #f8f9fb;
  --color-bg-surface: #ffffff;
  --color-bg-surface-2: #f0f1f5;
  --color-bg-surface-3: #e8eaef;
  --color-bg-surface-opaque: #ffffff;
  --color-bg-surface-elevated: #ffffff;
  --color-bg-card: #ffffff;
  --color-bg-card-hover: #f5f6f8;
  --color-bg-sidebar: #ffffff;
  --color-bg-chrome: #ffffff;

  /* App-specific tokens */
  --app-bg: #f8f9fb;
  --app-surface: #ffffff;
  --app-surface-2: #f0f1f5;
  --app-surface-3: #e8eaef;
  --app-border: rgba(0, 0, 0, 0.08);
  --app-text: #1a1d27;
  --app-muted: #5c6578;
  --app-accent-strong: #e11d48;
  --app-accent-soft: rgba(225, 29, 72, 0.08);

  /* Text */
  --color-text-primary: #1a1d27;
  --color-text-secondary: #5c6578;
  --color-text-tertiary: #8892a6;
  --color-text-quaternary: #8892a6;

  /* Accent overrides */
  --color-accent-text: #e11d48;
  --color-accent-dim: rgba(225, 29, 72, 0.08);
  --color-accent-subtle: rgba(225, 29, 72, 0.04);
  --color-accent-secondary: #0891b2;
  --color-accent-secondary-subtle: rgba(8, 145, 178, 0.08);

  /* Semantic Colors */
  --color-accent-green: #16a34a;
  --color-accent-green-subtle: rgba(22, 163, 74, 0.08);
  --color-danger: #dc2626;
  --color-danger-hover: #ef4444;
  --color-danger-subtle: rgba(220, 38, 38, 0.08);
  --color-warning-subtle: rgba(225, 29, 72, 0.1);

  /* Group colors — slightly darker for light backgrounds */
  --color-group-green: #059669;
  --color-group-warn: #ca8a04;
  --color-group-warn-text: #a16207;

  /* Borders */
  --color-border: rgba(0, 0, 0, 0.08);
  --color-border-subtle: rgba(0, 0, 0, 0.04);
  --color-border-medium: rgba(0, 0, 0, 0.08);
  --color-border-strong: rgba(0, 0, 0, 0.12);
  --color-border-accent: rgba(225, 29, 72, 0.25);
  --border-default: rgba(0, 0, 0, 0.08);
  --border-subtle: rgba(0, 0, 0, 0.04);
  --border-medium: 1px solid rgba(0, 0, 0, 0.08);
  --border-strong: 1px solid rgba(0, 0, 0, 0.12);

  /* Shadows — lighter for light mode */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.1);
  --shadow-xl: 0 12px 32px rgba(0, 0, 0, 0.12);
  --shadow-modal: 0 16px 48px rgba(0, 0, 0, 0.12);

  /* Overlay / Interaction */
  --color-hover-overlay: rgba(0, 0, 0, 0.02);
  --color-hover-overlay-strong: rgba(0, 0, 0, 0.03);
  --color-active-overlay: rgba(0, 0, 0, 0.04);
  --color-backdrop: rgba(0, 0, 0, 0.3);
  --color-divider: rgba(0, 0, 0, 0.04);
  --color-focus-ring: rgba(0, 0, 0, 0.08);
  --color-scrollbar: rgba(0, 0, 0, 0.12);
  --color-scrollbar-hover: rgba(0, 0, 0, 0.2);

  --chrome-bg: var(--color-bg-chrome);
}
```

- [ ] **Step 2: Verify dark mode unchanged**

Run: `npm run dev`
Confirm the app looks identical — no `data-theme` attribute is set yet, so `:root` (dark) applies.

- [ ] **Step 3: Quick manual test**

Open DevTools → Elements → add `data-theme="light"` to `<html>`. Verify backgrounds flip to white/gray. Remove the attribute.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/styles/theme.css
git commit -m "feat: add light theme CSS variable overrides"
```

---

### Task 3: Create useTheme Hook

**Files:**
- Create: `src/renderer/src/hooks/useTheme.ts`
- Test: `src/renderer/src/hooks/__tests__/useTheme.test.ts`

- [ ] **Step 1: Write the test**

Create `src/renderer/src/hooks/__tests__/useTheme.test.ts`:

```typescript
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTheme } from '../useTheme';

// Mock secureStorage
vi.mock('../../utils/secureStorage', () => ({
  secureStorage: {
    getItemSync: vi.fn(() => undefined),
    setItemSync: vi.fn(),
  },
}));

describe('useTheme', () => {
  let matchMediaListeners: Array<(e: { matches: boolean }) => void>;
  let mockMatchMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    matchMediaListeners = [];
    mockMatchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn((_: string, cb: (e: { matches: boolean }) => void) => {
        matchMediaListeners.push(cb);
      }),
      removeEventListener: vi.fn(),
    });
    globalThis.matchMedia = mockMatchMedia;
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to system preference', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
  });

  it('resolves to dark when OS prefers dark', () => {
    mockMatchMedia.mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('resolves to light when OS prefers light', () => {
    mockMatchMedia.mockReturnValue({
      matches: false,
      addEventListener: vi.fn((_: string, cb: (e: { matches: boolean }) => void) => {
        matchMediaListeners.push(cb);
      }),
      removeEventListener: vi.fn(),
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('sets explicit dark preference', () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setPreference('dark');
    });
    expect(result.current.preference).toBe('dark');
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('sets explicit light preference', () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setPreference('light');
    });
    expect(result.current.preference).toBe('light');
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('responds to OS theme changes when set to system', () => {
    mockMatchMedia.mockReturnValue({
      matches: false,
      addEventListener: vi.fn((_: string, cb: (e: { matches: boolean }) => void) => {
        matchMediaListeners.push(cb);
      }),
      removeEventListener: vi.fn(),
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('light');

    act(() => {
      matchMediaListeners.forEach((cb) => cb({ matches: true }));
    });
    expect(result.current.resolved).toBe('dark');
  });

  it('ignores OS changes when set to explicit preference', () => {
    mockMatchMedia.mockReturnValue({
      matches: false,
      addEventListener: vi.fn((_: string, cb: (e: { matches: boolean }) => void) => {
        matchMediaListeners.push(cb);
      }),
      removeEventListener: vi.fn(),
    });
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setPreference('dark');
    });
    expect(result.current.resolved).toBe('dark');

    act(() => {
      matchMediaListeners.forEach((cb) => cb({ matches: false }));
    });
    // Should still be dark because preference is explicit
    expect(result.current.resolved).toBe('dark');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useTheme.test.ts -c vitest.renderer.config.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement useTheme hook**

Create `src/renderer/src/hooks/useTheme.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { secureStorage } from '../utils/secureStorage';

export type ThemePreference = 'system' | 'light' | 'dark';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme-preference';

function getOsTheme(): ResolvedTheme {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolve(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? getOsTheme() : preference;
}

function applyTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    return secureStorage.getItemSync<ThemePreference>(STORAGE_KEY, 'system') ?? 'system';
  });
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(preference));

  const setPreference = useCallback((p: ThemePreference) => {
    secureStorage.setItemSync(STORAGE_KEY, p);
    setPreferenceState(p);
  }, []);

  // Apply theme and listen for OS changes
  useEffect(() => {
    const current = resolve(preference);
    setResolved(current);
    applyTheme(current);

    if (preference !== 'system') return;

    const mql = globalThis.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent | { matches: boolean }) => {
      const next = e.matches ? 'dark' : 'light';
      setResolved(next);
      applyTheme(next);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [preference]);

  return { preference, resolved, setPreference } as const;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useTheme.test.ts -c vitest.renderer.config.ts`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useTheme.ts src/renderer/src/hooks/__tests__/useTheme.test.ts
git commit -m "feat: add useTheme hook with system/light/dark switching"
```

---

### Task 4: Initialize Theme in App.tsx

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Import and call useTheme**

Add at the top of App.tsx imports:

```typescript
import { useTheme } from './hooks/useTheme';
```

Inside the main App component function body (near the other hooks at the top), add:

```typescript
useTheme();
```

This ensures the theme is applied on mount and reacts to OS changes. No return value needed here — the Settings modal will call `useTheme()` independently for the UI controls.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: initialize theme on app mount"
```

---

### Task 5: Add Theme Toggle to Settings Modal

**Files:**
- Modify: `src/renderer/src/components/SettingsModal.tsx`

- [ ] **Step 1: Add appearance section**

Add the import at the top:

```typescript
import { useTheme, type ThemePreference } from '../hooks/useTheme';
```

Inside the `SettingsModal` component, add:

```typescript
const { preference, setPreference } = useTheme();
```

Add this JSX as the first section inside `<div className="settings-body">` (before the Data Management section):

```tsx
<div className="settings-section">
  <div className="settings-section-heading">Appearance</div>
  <div className="settings-button-row">
    {(['system', 'light', 'dark'] as ThemePreference[]).map((opt) => (
      <TactileButton
        key={opt}
        variant={preference === opt ? 'primary' : 'secondary'}
        onClick={() => setPreference(opt)}
        className="btn-flex-center"
      >
        {opt.charAt(0).toUpperCase() + opt.slice(1)}
      </TactileButton>
    ))}
  </div>
</div>

<div className="settings-divider" />
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass. The existing SettingsModal test renders the modal and shouldn't break since we're adding a new section.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/SettingsModal.tsx
git commit -m "feat: add appearance toggle to settings modal"
```

---

### Task 6: Replace Hardcoded Colors in components.css

**Files:**
- Modify: `src/renderer/src/styles/components.css`

This is the largest file (~42KB, ~50 hardcoded rgba patterns). Replace hardcoded `rgba(255, 255, 255, ...)` values with the appropriate CSS variables.

- [ ] **Step 1: Replace white overlay patterns**

Find and replace these patterns throughout `components.css`:

| Find | Replace With |
|---|---|
| `rgba(255, 255, 255, 0.02)` | `var(--color-hover-overlay)` |
| `rgba(255, 255, 255, 0.03)` | `var(--color-border-subtle)` (when used as border) or `var(--color-hover-overlay)` (when bg) |
| `rgba(255, 255, 255, 0.04)` | `var(--color-hover-overlay-strong)` |
| `rgba(255, 255, 255, 0.05)` | `var(--color-border)` (when used as border) |
| `rgba(255, 255, 255, 0.055)` | `var(--color-border)` |
| `rgba(255, 255, 255, 0.06)` | `var(--color-active-overlay)` (when bg) or `var(--color-focus-ring)` (when border/outline) |
| `rgba(255, 255, 255, 0.07)` | `var(--color-focus-ring)` |
| `rgba(255, 255, 255, 0.08)` | `var(--color-focus-ring)` |
| `rgba(255, 255, 255, 0.1)` | `var(--color-scrollbar)` or `var(--color-border-strong)` |
| `rgba(255, 255, 255, 0.12)` | `var(--color-border-strong)` |
| `rgba(255, 255, 255, 0.15)` | `var(--color-border-strong)` |
| `rgba(255, 255, 255, 0.16)` | `var(--color-border-strong)` |

Use judgment for each occurrence — check whether it's used as a background, border, or shadow and pick the semantic match. When in doubt, `--color-hover-overlay` for subtle bgs, `--color-border` for borders.

- [ ] **Step 2: Replace backdrop patterns**

| Find | Replace With |
|---|---|
| `rgba(0, 0, 0, 0.42)` | `var(--color-backdrop)` |
| `rgba(0, 0, 0, 0.4)` | `var(--color-backdrop)` |

- [ ] **Step 3: Leave accent-colored rgba values alone**

Do NOT replace `rgba(225, 29, 72, ...)`, `rgba(239, 68, 68, ...)`, or other accent/semantic color alphas — these already have variables in `theme.css` and are overridden in the light block.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/styles/components.css
git commit -m "refactor: replace hardcoded rgba colors with CSS variables in components.css"
```

---

### Task 7: Replace Hardcoded Colors in oncall.css

**Files:**
- Modify: `src/renderer/src/components/oncall/oncall.css`

- [ ] **Step 1: Replace white overlay patterns**

Apply the same replacement table from Task 6 to `oncall.css`. Key occurrences:

- `rgba(255, 255, 255, 0.02)` in `.sortable-edit-row-grid`, `.team-row:hover`, `.team-row--primary` → `var(--color-hover-overlay)`
- `rgba(255, 255, 255, 0.04)` in `.sortable-edit-row-grid:hover` → `var(--color-hover-overlay-strong)`
- `rgba(255, 255, 255, 0.05)` in `.sortable-edit-row-grid` border → `var(--color-border)`
- `rgba(255, 255, 255, 0.025)` in `.team-row` border-bottom → `var(--color-divider)`
- `rgba(255, 255, 255, 0.06)` in `.team-card-empty` border → `var(--color-active-overlay)`
- `rgba(255, 92, 92, 0.1)` in `.sortable-edit-row-remove:hover` → `var(--color-danger-subtle)`
- `rgba(255, 255, 255, 0.08)` in `.team-card-body:hover` border → `var(--color-focus-ring)`
- `rgba(255, 255, 255, 0.1)` in `.maintain-team-add-btn` border → `var(--color-border-strong)`

Leave the `#fca5a5`, `#f87171` hex values in alert styles — they're accent colors.

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/oncall/oncall.css
git commit -m "refactor: replace hardcoded rgba colors with CSS variables in oncall.css"
```

---

### Task 8: Replace Hardcoded Colors in Remaining CSS Files

**Files:**
- Modify: `src/renderer/src/styles/modals.css`
- Modify: `src/renderer/src/styles/setup.css`
- Modify: `src/renderer/src/tabs/weather/weather.css`
- Modify: `src/renderer/src/tabs/notes/notes.css`
- Modify: `src/renderer/src/components/directory/directory.css`
- Modify: `src/renderer/src/tabs/alerts.css` (app UI portions only — leave email preview section untouched)
- Modify: Any other CSS files with hardcoded `rgba(255, 255, 255, ...)` patterns

- [ ] **Step 1: Apply the same replacement patterns from Task 6 across all remaining files**

Use the same mapping table. For each file, replace `rgba(255, 255, 255, ...)` patterns with the appropriate semantic variable based on context (border, bg overlay, divider).

**Important for alerts.css:** The email preview section (`.alert-email-*` classes) uses intentionally light-colored hex values (`#ffffff`, `#1a1a2e`, `#f7f7f8`, etc.) for rendering email content. Leave those untouched. Only replace the `rgba(255, 255, 255, ...)` patterns in the non-email app UI portions.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Run format check**

Run: `npm run format:check`
Expected: All files pass formatting.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/styles/modals.css src/renderer/src/styles/setup.css \
  src/renderer/src/tabs/weather/weather.css src/renderer/src/tabs/notes/notes.css \
  src/renderer/src/components/directory/directory.css src/renderer/src/tabs/alerts.css
git commit -m "refactor: replace hardcoded rgba colors with CSS variables across remaining CSS files"
```

---

### Task 9: Visual Verification and Edge Cases

**Files:**
- Possibly modify: any CSS file where light mode reveals issues

- [ ] **Step 1: Start the app**

Run: `npm run dev`

- [ ] **Step 2: Test light mode via Settings**

Open Settings → Appearance → click "Light". Verify:
- Backgrounds flip to white/light gray
- Text is dark and readable
- Signal Red accent is consistent
- Sidebar buttons are visible
- Cards have subtle shadows for depth
- Borders are visible but not heavy

- [ ] **Step 3: Test each tab**

Click through every tab and verify rendering:
- Compose
- On-Call (Personnel)
- People
- Servers
- Weather (including radar)
- Notes
- Alerts
- Cloud Status
- Settings modal itself

- [ ] **Step 4: Test modals and overlays**

Open modals (Add Card, Data Manager, Shortcuts, etc.) and verify:
- Modal backdrop is visible
- Modal content has correct background
- Buttons are readable
- Input fields have proper contrast

- [ ] **Step 5: Test the popout on-call board**

Click Pop Out from the Personnel tab. Verify the popout window inherits the light theme.

- [ ] **Step 6: Test System mode**

Set Appearance to "System". Change macOS appearance (System Settings → Appearance → Light/Dark). Verify the app follows the OS change.

- [ ] **Step 7: Test Dark mode unchanged**

Switch back to "Dark". Verify the app looks identical to before any light mode work.

- [ ] **Step 8: Fix any issues found**

If any elements look wrong in light mode (missing variable replacements, hardcoded colors that were missed), fix them in the appropriate CSS file.

- [ ] **Step 9: Run full quality gate**

Run: `npm run typecheck && npm run lint && npm run format:check && npm test`
Expected: All pass.

- [ ] **Step 10: Commit any fixes**

```bash
git add -A
git commit -m "fix: light mode visual fixes from verification pass"
```

---

### Task 10: Push to Test

- [ ] **Step 1: Push all commits**

```bash
git push
```

- [ ] **Step 2: Verify CI passes**

Monitor the Build and Package action on the test branch. All quality gates should pass.
