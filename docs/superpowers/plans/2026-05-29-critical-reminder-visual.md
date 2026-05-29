# Critical Reminder Visual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the due alert reminder popup as a critical red alarm treatment based on approved mockup option C.

**Architecture:** Keep reminder behavior in `AlertReminderManager` unchanged and add only a stable critical visual hook to the rendered overlay. Move the visual treatment into the existing `Alert Reminder Due Prompt` CSS block in `components.css`, using danger theme tokens, pseudo-elements for red flash and hazard striping, and a `prefers-reduced-motion` override.

**Tech Stack:** React, TypeScript, Vitest, React Testing Library, CSS animations.

---

### Task 1: Lock The Critical Reminder Visual Contract

**Files:**
- Modify: `src/renderer/src/components/__tests__/AlertReminderManager.test.tsx`
- Modify: `src/renderer/src/components/AlertReminderManager.tsx`
- Modify: `src/renderer/src/styles/components.css`

- [ ] **Step 1: Write the failing rendering test**

Add this test after `shows the first due reminder` in `src/renderer/src/components/__tests__/AlertReminderManager.test.tsx`:

```tsx
it('renders due reminders with the critical alarm visual treatment', async () => {
  mockListDueAlertReminders.mockResolvedValue([makeReminder()]);

  render(<AlertReminderManager />);
  await flushReminderEffects();

  const overlay = screen.getByTestId('critical-reminder-overlay');
  expect(overlay).toHaveClass('alert-reminder-due-overlay--critical');
  expect(screen.getByRole('alertdialog')).toHaveClass('alert-reminder-due--critical');
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
PATH="/Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/ryan/Apps/Relay-fresh-test/node_modules/.bin:$PATH" \
/Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/ryan/Apps/Relay-fresh-test/node_modules/vitest/vitest.mjs run -c vitest.renderer.config.ts \
src/renderer/src/components/__tests__/AlertReminderManager.test.tsx \
--testNamePattern "critical alarm visual treatment"
```

Expected: FAIL because `critical-reminder-overlay` is not present yet.

- [ ] **Step 3: Add the minimal critical visual hooks**

In `src/renderer/src/components/AlertReminderManager.tsx`, change the overlay and dialog opening tags to:

```tsx
<div
  className="alert-reminder-due-overlay alert-reminder-due-overlay--critical"
  data-testid="critical-reminder-overlay"
>
  <div
    ref={dialogRef}
    className="alert-reminder-due alert-reminder-due--critical"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="due-reminder-title"
  >
```

Do not change reminder polling, current reminder selection, focus trapping, actions, or chime behavior.

- [ ] **Step 4: Run the targeted test to verify it passes**

Run the same command from Step 2.

Expected: PASS for the critical visual treatment test.

- [ ] **Step 5: Write the CSS contract test**

Add these imports near the top of `src/renderer/src/components/__tests__/AlertReminderManager.test.tsx`:

```tsx
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
```

Add this constant after the mocks:

```tsx
const componentStyles = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/components.css'),
  'utf8',
);
```

Add this test near the other visual reminder tests:

```tsx
it('defines reduced-motion styles for the critical reminder flash', () => {
  expect(componentStyles).toContain('@media (prefers-reduced-motion: reduce)');
  expect(componentStyles).toContain('.alert-reminder-due-overlay--critical::before');
  expect(componentStyles).toContain('animation: none');
});
```

- [ ] **Step 6: Run the CSS contract test to verify it fails**

Run:

```bash
PATH="/Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/ryan/Apps/Relay-fresh-test/node_modules/.bin:$PATH" \
/Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/ryan/Apps/Relay-fresh-test/node_modules/vitest/vitest.mjs run -c vitest.renderer.config.ts \
src/renderer/src/components/__tests__/AlertReminderManager.test.tsx \
--testNamePattern "reduced-motion styles"
```

Expected: FAIL because the critical CSS and reduced-motion override have not been added yet.

- [ ] **Step 7: Implement the critical CSS treatment**

In `src/renderer/src/styles/components.css`, replace the existing alert reminder due prompt styles with:

```css
.alert-reminder-due-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-critical);
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(4, 8, 16, 0.78);
  backdrop-filter: blur(8px);
  overflow: hidden;
}

.alert-reminder-due-overlay--critical::before,
.alert-reminder-due-overlay--critical::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.alert-reminder-due-overlay--critical::before {
  background:
    radial-gradient(circle at 50% 45%, rgba(239, 68, 68, 0.46), transparent 52%),
    rgba(225, 29, 72, 0.18);
  animation: critical-reminder-flash 0.8s steps(2, end) infinite;
}

.alert-reminder-due-overlay--critical::after {
  background: repeating-linear-gradient(
    135deg,
    rgba(239, 68, 68, 0.22) 0,
    rgba(239, 68, 68, 0.22) 12px,
    transparent 12px,
    transparent 28px
  );
  opacity: 0.62;
}

.alert-reminder-due {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 5px minmax(0, 1fr);
  width: min(460px, 100%);
  overflow: hidden;
  border: 1px solid rgba(239, 68, 68, 0.52);
  border-radius: 8px;
  background: var(--color-bg-surface-elevated);
  box-shadow:
    0 22px 52px rgba(0, 0, 0, 0.52),
    0 0 38px rgba(225, 29, 72, 0.28);
}

.alert-reminder-due__accent {
  grid-row: 1 / span 2;
  background: var(--color-danger);
}

.alert-reminder-due__eyebrow {
  margin-bottom: 6px;
  color: var(--color-danger-hover);
  font-size: var(--text-2xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

@keyframes critical-reminder-flash {
  0% {
    opacity: 0.28;
  }

  100% {
    opacity: 0.82;
  }
}

@media (prefers-reduced-motion: reduce) {
  .alert-reminder-due-overlay--critical::before {
    animation: none;
    opacity: 0.5;
  }
}
```

Keep the existing `.alert-reminder-due__content`, `.alert-reminder-due__title`, `.alert-reminder-due__note`, `.alert-reminder-due__meta`, and `.alert-reminder-due__actions` rules after this block.

- [ ] **Step 8: Run the targeted component tests**

Run:

```bash
PATH="/Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/ryan/Apps/Relay-fresh-test/node_modules/.bin:$PATH" \
/Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/ryan/Apps/Relay-fresh-test/node_modules/vitest/vitest.mjs run -c vitest.renderer.config.ts \
src/renderer/src/components/__tests__/AlertReminderManager.test.tsx
```

Expected: all `AlertReminderManager` tests pass.

- [ ] **Step 9: Run renderer regression tests**

Run:

```bash
PATH="/Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/ryan/Apps/Relay-fresh-test/node_modules/.bin:$PATH" \
/Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/ryan/Apps/Relay-fresh-test/scripts/run-renderer-tests.mjs
```

Expected: renderer tests pass.

- [ ] **Step 10: Commit the implementation**

Run:

```bash
git add src/renderer/src/components/AlertReminderManager.tsx \
  src/renderer/src/components/__tests__/AlertReminderManager.test.tsx \
  src/renderer/src/styles/components.css
git commit -m "style: make due reminders critical"
```
