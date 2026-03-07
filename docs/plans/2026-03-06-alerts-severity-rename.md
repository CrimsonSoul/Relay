# Alerts Severity Rename Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the `MINOR` severity from the Alerts tab and rename `MAJOR` to `ISSUE` everywhere in the Alerts feature so the generated alert reads `ALERT ISSUE`.

**Architecture:** Keep the change centered on the shared Alerts severity model in `src/renderer/src/tabs/alertUtils.tsx`, because both the composer and preview derive their severity labels from that file. Add a focused renderer test that exercises the Alerts tab end-to-end enough to prove the allowed severity set and the preview header text changed together.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library

---

### Task 1: Add a failing Alerts renderer test

**Files:**

- Create: `src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`
- Modify: `src/renderer/src/tabs/AlertsTab.tsx` (only if test setup requires a stable query target)
- Test: `src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`

**Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertsTab } from '../AlertsTab';

test('shows issue severity and does not offer minor severity', async () => {
  const user = userEvent.setup();
  render(<AlertsTab />);

  expect(screen.queryByRole('button', { name: 'MINOR' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'ISSUE' }));

  expect(screen.getByText('ALERT')).toBeInTheDocument();
  expect(screen.getByText('ISSUE')).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:renderer -- src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`
Expected: FAIL because `MINOR` still renders and `ISSUE` is not available yet.

**Step 3: Write minimal test support code**

```tsx
vi.mock('../AlertHistoryModal', () => ({
  AlertHistoryModal: () => null,
}));

vi.mock('../hooks/useAlertHistory', () => ({
  useAlertHistory: () => ({
    history: [],
    addHistory: vi.fn(),
    deleteHistory: vi.fn(),
    clearHistory: vi.fn(),
    pinHistory: vi.fn(),
    updateLabel: vi.fn(),
  }),
}));
```

**Step 4: Run test to verify it still fails for the right reason**

Run: `npm run test:renderer -- src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`
Expected: FAIL on severity expectations, not missing mocks.

### Task 2: Rename the Alerts severity model

**Files:**

- Modify: `src/renderer/src/tabs/alertUtils.tsx`
- Test: `src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`

**Step 1: Write the minimal implementation**

```tsx
export type Severity = 'ISSUE' | 'MAINTENANCE' | 'INFO' | 'RESOLVED';

export const SEVERITIES: Severity[] = ['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED'];

export const SEVERITY_COLORS = {
  ISSUE: { banner: '#d32f2f', bannerEnd: '#b71c1c', badgeBg: '#ffebee', badgeText: '#c62828' },
  // ...other severities unchanged
};
```

Also move the old `MAJOR` icon implementation under the `ISSUE` key and remove the `MINOR` entry entirely.

**Step 2: Run test to verify it passes**

Run: `npm run test:renderer -- src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`
Expected: PASS with `MINOR` absent and `ISSUE` visible.

**Step 3: Refactor if needed**

Keep `AlertForm.tsx` and `AlertCard.tsx` unchanged unless TypeScript or test assertions show a direct dependency on the removed labels.

**Step 4: Run the same test again**

Run: `npm run test:renderer -- src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`
Expected: PASS.

### Task 3: Verify feature-wide Alerts behavior

**Files:**

- Modify: `src/renderer/src/tabs/AlertForm.tsx` (only if button text or accessibility names need explicit updates)
- Modify: `src/renderer/src/tabs/AlertCard.tsx` (only if preview assertions expose hard-coded old labels)
- Test: `src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`

**Step 1: Inspect for old severity references**

Search for `MAJOR` and `MINOR` under `src/renderer/src/tabs/` and update any remaining Alerts-specific references to `ISSUE` or remove them.

**Step 2: Run focused renderer coverage**

Run: `npm run test:renderer -- src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`
Expected: PASS.

**Step 3: Run broader renderer tests**

Run: `npm run test:renderer`
Expected: PASS with no Alerts regressions.

**Step 4: Commit**

```bash
git add src/renderer/src/tabs/alertUtils.tsx src/renderer/src/tabs/__tests__/AlertsTab.test.tsx docs/plans/2026-03-06-alerts-severity-rename-design.md docs/plans/2026-03-06-alerts-severity-rename.md
git commit -m "feat: rename alerts major severity to issue"
```
