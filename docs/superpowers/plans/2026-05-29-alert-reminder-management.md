# Alert Reminder Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Alerts-tab reminder manager that lists multiple pending reminders, supports editing, and keeps completed/dismissed reminders hidden behind a toggle.

**Architecture:** Extend the reminder service and hook with an edit operation and sorted pending/history lists. Add a focused `AlertReminderManagerModal` component for list management, reuse `AlertReminderModal` for schedule/edit form behavior, and wire both into `AlertsTab` through existing modal state patterns.

**Tech Stack:** React, TypeScript, PocketBase SDK, Vitest, React Testing Library, CSS.

---

### Task 1: Reminder Update Service

**Files:**
- Modify: `src/renderer/src/services/alertReminderService.ts`
- Modify: `src/renderer/src/services/alertReminderService.test.ts`

- [ ] Add an `AlertReminderUpdateInput` type with `title`, `note`, and `dueAt`.
- [ ] Add `updateAlertReminder(id, input)` that calls `requireOnline()`, updates `title`, `note`, `dueAt`, `status: 'pending'`, and `snoozeUntil: ''`, catches errors through `handleApiError`, and rethrows.
- [ ] Add a failing service test asserting the update payload clears `snoozeUntil`.
- [ ] Run `node node_modules/vitest/vitest.mjs run -c vitest.renderer.config.ts src/renderer/src/services/alertReminderService.test.ts` and verify the new test fails before implementation, then passes after implementation.

### Task 2: Reminder Hook Lists And Edit Action

**Files:**
- Modify: `src/renderer/src/hooks/useAlertReminders.ts`
- Modify: `src/renderer/src/hooks/__tests__/useAlertReminders.test.ts`

- [ ] Add tests for `pendingReminders` sorted by effective time and `completedReminders` containing done/dismissed records sorted newest first.
- [ ] Add a test for `updateReminder` calling `updateAlertReminder` and showing an error toast on failure.
- [ ] Implement `pendingReminders`, `completedReminders`, and `updateReminder`.
- [ ] Preserve existing `upcomingReminders`, schedule, snooze, done, and dismiss behavior.
- [ ] Run `node node_modules/vitest/vitest.mjs run -c vitest.renderer.config.ts src/renderer/src/hooks/__tests__/useAlertReminders.test.ts`.

### Task 3: Reusable Schedule/Edit Form

**Files:**
- Modify: `src/renderer/src/tabs/AlertReminderModal.tsx`
- Modify: `src/renderer/src/tabs/__tests__/AlertReminderModal.test.tsx`

- [ ] Add tests that opening the modal with a reminder record shows edit title/copy, pre-fills title/note/effective due time, submits edited fields, and rejects past edit dates.
- [ ] Extend `AlertReminderModal` with optional `reminder` and `mode` support while keeping existing schedule props working.
- [ ] Populate edit mode from `reminder.snoozeUntil || reminder.dueAt`.
- [ ] Submit only title/note/dueAt in edit mode; keep schedule mode unchanged.
- [ ] Run `node node_modules/vitest/vitest.mjs run -c vitest.renderer.config.ts src/renderer/src/tabs/__tests__/AlertReminderModal.test.tsx`.

### Task 4: Reminder Manager Modal

**Files:**
- Create: `src/renderer/src/tabs/AlertReminderManagerModal.tsx`
- Create: `src/renderer/src/tabs/__tests__/AlertReminderManagerModal.test.tsx`
- Modify: `src/renderer/src/tabs/alerts.css`

- [ ] Add tests that the modal renders pending reminders in the provided order, shows note previews, shows a snoozed indicator, hides completed reminders by default, reveals completed reminders with a toggle, calls `onEdit`, `onDone`, `onDismiss`, `onRetry`, and `onScheduleNew`.
- [ ] Implement `AlertReminderManagerModal` as a focused modal component.
- [ ] Add scoped CSS for rows, meta text, empty/error states, and actions.
- [ ] Run `node node_modules/vitest/vitest.mjs run -c vitest.renderer.config.ts src/renderer/src/tabs/__tests__/AlertReminderManagerModal.test.tsx`.

### Task 5: Alerts Tab Integration

**Files:**
- Modify: `src/renderer/src/tabs/AlertsTab.tsx`
- Modify: `src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`
- Modify: `src/renderer/src/tabs/alerts.css`

- [ ] Update the hook mock and tests so the strip shows next pending reminder plus `+N more`.
- [ ] Add tests opening the manager from the header `REMINDERS` button and from the strip.
- [ ] Add tests that manager edit opens the reminder modal in edit mode and that done/dismiss actions call hook actions.
- [ ] Wire `pendingReminders`, `completedReminders`, `updateReminder`, `markDone`, `dismissReminder`, `loading`, `error`, and `refetch` into `AlertsTab`.
- [ ] Add a compact `REMINDERS` header action and make the strip a button when pending reminders exist.
- [ ] Run `node node_modules/vitest/vitest.mjs run -c vitest.renderer.config.ts src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`.

### Task 6: Verification And Commit

**Files:**
- No new files.

- [ ] Run `node node_modules/vitest/vitest.mjs run -c vitest.renderer.config.ts src/renderer/src/services/alertReminderService.test.ts`.
- [ ] Run `node node_modules/vitest/vitest.mjs run -c vitest.renderer.config.ts src/renderer/src/hooks/__tests__/useAlertReminders.test.ts src/renderer/src/tabs/__tests__/AlertReminderModal.test.tsx src/renderer/src/tabs/__tests__/AlertReminderManagerModal.test.tsx src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`.
- [ ] Run `node scripts/run-renderer-tests.mjs`.
- [ ] Run `node node_modules/vitest/vitest.mjs run`.
- [ ] Run `node node_modules/typescript/bin/tsc --noEmit`.
- [ ] Run `node node_modules/eslint/bin/eslint.js src/renderer/src/services/alertReminderService.ts src/renderer/src/hooks/useAlertReminders.ts src/renderer/src/tabs/AlertReminderModal.tsx src/renderer/src/tabs/AlertReminderManagerModal.tsx src/renderer/src/tabs/AlertsTab.tsx src/renderer/src/tabs/__tests__/AlertReminderModal.test.tsx src/renderer/src/tabs/__tests__/AlertReminderManagerModal.test.tsx src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`.
- [ ] Commit the implementation with `feat: manage alert reminders`.
