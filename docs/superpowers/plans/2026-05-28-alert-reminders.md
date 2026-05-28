# Alert Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build shared, PocketBase-backed alert reminders that notify running Relay clients at a scheduled time with a visual prompt and sound.

**Architecture:** Add an `alert_reminders` collection to the existing PocketBase bootstrap, then add a renderer reminder service and hooks/components that use existing PocketBase and toast patterns. Mount a global reminder manager in `MainApp` so due reminders show even outside the Alerts tab, while the Alerts tab owns scheduling UI and upcoming reminder summaries.

**Tech Stack:** Electron, React, TypeScript, PocketBase SDK, Vitest, React Testing Library.

---

### Task 1: PocketBase Collection

**Files:**
- Modify: `src/main/pocketbase/CollectionBootstrap.ts`
- Modify: `src/main/pocketbase/__tests__/CollectionBootstrap.test.ts`

- [ ] Add an `alert_reminders` collection definition with fields `title`, `note`, `dueAt`, `status`, `snoozeUntil`, `severity`, `alertSubject`, `alertBodyHtml`, `createdBy`, `completedAt`, and `dismissedAt`.
- [ ] Update the collection count expectation from 11 to 12.
- [ ] Add a test that finds the `alert_reminders` create call and asserts the required field types and status values.
- [ ] Run `node ./node_modules/vitest/vitest.mjs run src/main/pocketbase/__tests__/CollectionBootstrap.test.ts`.

### Task 2: Reminder Service

**Files:**
- Create: `src/renderer/src/services/alertReminderService.ts`
- Create: `src/renderer/src/services/alertReminderService.test.ts`

- [ ] Define `AlertReminderStatus`, `AlertReminderRecord`, and `AlertReminderInput` types.
- [ ] Implement `addAlertReminder`, `listDueAlertReminders`, `snoozeAlertReminder`, `markAlertReminderDone`, and `dismissAlertReminder`.
- [ ] Build the due filter as `status = "pending" && ((snoozeUntil != "" && snoozeUntil <= now) || (snoozeUntil = "" && dueAt <= now))`.
- [ ] Require online state before mutations and call `handleApiError` on failures.
- [ ] Add tests for create, due listing, snooze, done, dismiss, and error propagation.
- [ ] Run `node ./node_modules/vitest/vitest.mjs run src/renderer/src/services/alertReminderService.test.ts`.

### Task 3: Reminder State Hook

**Files:**
- Create: `src/renderer/src/hooks/useAlertReminders.ts`
- Create: `src/renderer/src/hooks/__tests__/useAlertReminders.test.ts`

- [ ] Use `useCollection('alert_reminders', { sort: 'dueAt' })` for shared realtime reminder data.
- [ ] Expose pending upcoming reminders, `scheduleReminder`, `snoozeReminder`, `markDone`, and `dismissReminder`.
- [ ] Show toasts on failed create/update paths and keep actions boolean-returning for UI retry behavior.
- [ ] Add tests that verify schedule input mapping, pending filtering, and service action calls.
- [ ] Run `node ./node_modules/vitest/vitest.mjs run src/renderer/src/hooks/__tests__/useAlertReminders.test.ts`.

### Task 4: Scheduling UI

**Files:**
- Create: `src/renderer/src/tabs/AlertReminderModal.tsx`
- Create: `src/renderer/src/tabs/__tests__/AlertReminderModal.test.tsx`
- Modify: `src/renderer/src/tabs/AlertsTab.tsx`
- Modify: `src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`
- Modify: `src/renderer/src/tabs/alerts.css`

- [ ] Add a compact `REMIND` action in the Alerts header that opens a schedule modal.
- [ ] Prefill the modal title from the current alert subject, defaulting to `Send alert`.
- [ ] Add date/time and note inputs, validate the due time is in the future, and call `scheduleReminder`.
- [ ] Show a compact upcoming reminder strip in the Alerts tab with the next pending reminder.
- [ ] Add RTL tests for opening the modal, draft-derived defaults, and calling the reminder hook with alert context.
- [ ] Run `node ./node_modules/vitest/vitest.mjs run src/renderer/src/tabs/__tests__/AlertReminderModal.test.tsx src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`.

### Task 5: Global Due Reminder Manager

**Files:**
- Create: `src/renderer/src/components/AlertReminderManager.tsx`
- Create: `src/renderer/src/components/__tests__/AlertReminderManager.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css` or the app stylesheet that owns global modal/banner styles

- [ ] Poll due reminders while the app is running and connected.
- [ ] Show one due reminder at a time in chronological order.
- [ ] Play a short generated chime once per visible reminder using Web Audio; catch playback failures silently.
- [ ] Add actions for `Open Alerts`, `Snooze 10 min`, `Mark Done`, and `Dismiss`.
- [ ] Mount the manager in `MainApp` and pass `setActiveTab('Alerts')` for the open action.
- [ ] Add tests for due display, duplicate suppression during a visible cycle, action calls, and audio failure fallback.
- [ ] Run `node ./node_modules/vitest/vitest.mjs run src/renderer/src/components/__tests__/AlertReminderManager.test.tsx`.

### Task 6: Full Verification

**Files:**
- No new files.

- [ ] Run TypeScript: `node ./node_modules/typescript/bin/tsc --noEmit`.
- [ ] Run lint: `node ./node_modules/eslint/bin/eslint.js .`.
- [ ] Run unit tests: `node ./node_modules/vitest/vitest.mjs run`.
- [ ] Run renderer tests: `node ./scripts/run-renderer-tests.mjs`.
- [ ] Run build: `PATH="$NODEBIN:$PATH" node ./node_modules/electron-vite/bin/electron-vite.js build`.
- [ ] Run Electron E2E if the local runtime allows it: `PATH="$NODEBIN:$PATH" node ./node_modules/@playwright/test/cli.js test -c playwright.electron.config.ts`.
- [ ] Commit the implementation once checks pass.
