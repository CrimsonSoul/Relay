# Cohesive Reminder Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the due reminder popup match Relay's existing modal and button visual language while preserving the current critical alarm behavior.

**Architecture:** Keep the popup inside `AlertReminderManager` and keep actions wired through the existing `TactileButton` component. Add one semantic status pill to the popup markup and adjust the existing CSS block in `components.css` to use Relay design variables and modal-like spacing.

**Tech Stack:** React, TypeScript, CSS variables, Vitest, Testing Library, electron-vite.

---

### Task 1: Lock In Popup Structure With Tests

**Files:**
- Modify: `src/renderer/src/components/__tests__/AlertReminderManager.test.tsx`

- [ ] **Step 1: Add failing assertions for cohesive popup hooks**

Add expectations to the existing critical visual treatment test:

```tsx
expect(screen.getByText('Due now')).toBeInTheDocument();
expect(screen.getByText('Snooze 10m')).toHaveAttribute('data-variant', 'secondary');
expect(screen.getByText('Mark Done')).toHaveAttribute('data-variant', 'primary');
expect(screen.getByText('Dismiss')).toHaveAttribute('data-variant', 'ghost');
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
PATH="/Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/ryan/Apps/Relay/node_modules/.bin:$PATH" /Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/ryan/Apps/Relay/node_modules/vitest/vitest.mjs run -c vitest.renderer.config.ts src/renderer/src/components/__tests__/AlertReminderManager.test.tsx --testNamePattern "critical alarm visual treatment"
```

Expected: FAIL because `Due now` does not exist yet.

### Task 2: Add Cohesive Popup Markup

**Files:**
- Modify: `src/renderer/src/components/AlertReminderManager.tsx`

- [ ] **Step 1: Add the status pill beside the eyebrow**

Replace the standalone eyebrow with:

```tsx
<div className="alert-reminder-due__eyebrow-row">
  <div className="alert-reminder-due__eyebrow">Alert reminder</div>
  <div className="alert-reminder-due__status">Due now</div>
</div>
```

- [ ] **Step 2: Run focused test and verify it passes**

Run the same focused test command from Task 1.

Expected: PASS.

### Task 3: Update Popup Styling

**Files:**
- Modify: `src/renderer/src/styles/components.css`

- [ ] **Step 1: Update reminder popup CSS**

Adjust the existing `Alert Reminder Due Prompt` block so the popup:

- Uses `var(--radius-md)` for the dialog radius.
- Uses `var(--shadow-modal)` plus the existing critical glow.
- Uses a header row class named `.alert-reminder-due__eyebrow-row`.
- Adds `.alert-reminder-due__status` as a small danger-tinted pill.
- Uses slightly roomier `18px` content/action padding to match modal rhythm.

- [ ] **Step 2: Run reduced-motion/style focused tests**

Run:

```bash
PATH="/Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/ryan/Apps/Relay/node_modules/.bin:$PATH" /Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/ryan/Apps/Relay/node_modules/vitest/vitest.mjs run -c vitest.renderer.config.ts src/renderer/src/components/__tests__/AlertReminderManager.test.tsx
```

Expected: all tests in the file PASS.

### Task 4: Verify And Commit

**Files:**
- Verify: changed files and relevant suites

- [ ] **Step 1: Run TypeScript**

```bash
PATH="/Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/ryan/Apps/Relay/node_modules/.bin:$PATH" /Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit
```

- [ ] **Step 2: Run lint on touched files**

```bash
PATH="/Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/ryan/Apps/Relay/node_modules/.bin:$PATH" /Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/eslint/bin/eslint.js src/renderer/src/components/AlertReminderManager.tsx src/renderer/src/components/__tests__/AlertReminderManager.test.tsx
```

- [ ] **Step 3: Run full renderer tests**

```bash
PATH="/Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/ryan/Apps/Relay/node_modules/.bin:$PATH" /Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/run-renderer-tests.mjs
```

- [ ] **Step 4: Run production build**

```bash
ELECTRON_RUN_AS_NODE= PATH="/Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/ryan/Apps/Relay/node_modules/.bin:$PATH" ./node_modules/.bin/electron-vite build
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-01-cohesive-reminder-popup-design.md docs/superpowers/plans/2026-06-01-cohesive-reminder-popup.md src/renderer/src/components/AlertReminderManager.tsx src/renderer/src/components/__tests__/AlertReminderManager.test.tsx src/renderer/src/styles/components.css
git commit -m "style: align reminder popup with app design"
```
