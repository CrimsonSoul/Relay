# Alert Reminder Management Design

## Goal

Let users inspect and manage multiple alert reminders instead of only seeing the next upcoming reminder.

## Scope

- Add a reminder manager surface to the Alerts workflow.
- Default the manager to active `pending` reminders, sorted by effective due time.
- Show completed and dismissed reminders only behind an optional toggle.
- Allow pending reminders to be edited, marked done, or dismissed.
- Keep the existing `REMIND` scheduling action and due reminder popup behavior.

This change does not add a new top-level app tab, OS notifications, recurring reminders, or reminder ownership/assignment.

## User Interface

Add a reminder manager modal reachable from the Alerts tab:

- The existing compact reminder strip should become clickable when reminders exist.
- The strip should show the next pending reminder plus a count when more pending reminders exist, for example `+2 more`.
- Add a compact `REMINDERS` entry point near the existing `REMIND` action so users can open the manager even when there are no pending reminders.

The manager modal should list pending reminders in chronological order using effective time:

- Use `snoozeUntil` when present.
- Otherwise use `dueAt`.

Each pending reminder row should show:

- Title.
- Effective due date/time in local time.
- Note preview when present.
- A small snoozed indicator when `snoozeUntil` is active.
- Actions: `Edit`, `Done`, and `Dismiss`.

The empty pending state should be brief and action-oriented, with a way to schedule a new reminder through the existing schedule flow.

## Editing

Editing should reuse the reminder scheduling form behavior in an edit mode instead of creating a separate form style.

Editable fields:

- Title.
- Due date/time.
- Note.

Saving an edit keeps the reminder `pending`. If the user sets a new due time, the saved reminder should clear any previous `snoozeUntil` so the visible schedule matches the edited due date/time.

The edit form should validate that the due date/time is in the future, matching the existing schedule validation. Failed saves should leave the editor open and show an error/toast consistent with existing reminder actions.

## Data And Hooks

Extend the reminder service with an update operation for editable fields. Keep the current create/snooze/done/dismiss functions unchanged.

Extend `useAlertReminders` to expose:

- Pending reminders sorted by effective time.
- Optional completed/dismissed reminders for the manager toggle.
- `updateReminder` for edit saves.
- Existing action wrappers for done and dismiss.

The Alerts tab should consume the hook rather than querying PocketBase directly.

## Error Handling

- If loading reminders fails, the modal should show a compact error state and allow retry via the existing `refetch`.
- If updating, marking done, or dismissing fails, keep the affected reminder visible and show an error toast.
- The manager should tolerate empty or invalid dates by sorting invalid effective times last.

## Testing

Add focused coverage for:

- The reminder strip shows the next pending reminder and a count for additional pending reminders.
- The manager opens from the strip and from the header action.
- Multiple pending reminders render sorted by effective due time.
- Editing a reminder calls the update service with title, note, due date/time, and cleared `snoozeUntil`.
- Done and dismiss actions call the existing hook actions.
- The completed/dismissed list is hidden by default and appears only when the toggle is enabled.
