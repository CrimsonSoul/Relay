# Alert Reminders Design

## Goal

Add shared alert reminders that notify Relay users at a future date and time while Relay is running. The feature should help NOC users remember to send or follow up on alerts without relying on an external calendar.

## Scope

- Store reminders in the Relay PocketBase server so reminders are shared across connected clients.
- Let users schedule a reminder from the Alerts workflow.
- Notify running Relay clients when a reminder becomes due.
- Play a short reminder sound when a due reminder appears, when browser audio policy allows it.
- Provide simple actions for handling a due reminder: open Alerts, snooze, mark done, or dismiss.

The feature does not need to wake Relay when the app is closed, install an OS background scheduler, or send external push notifications.

## Data Model

Create an `alert_reminders` PocketBase collection managed by the existing collection bootstrap flow.

Fields:

- `title`: required text. Default should be derived from the current alert subject when available.
- `note`: optional text for operator context.
- `dueAt`: required date/time.
- `status`: select with `pending`, `done`, and `dismissed`.
- `snoozeUntil`: optional date/time. When present and later than `dueAt`, the effective trigger time is `snoozeUntil`.
- `severity`: optional select matching alert severity values, used for context and visual treatment.
- `alertSubject`: optional text snapshot from the alert form.
- `alertBodyHtml`: optional text snapshot from the alert form when a reminder is created from a drafted alert.
- `createdBy`: optional text using the local user/sender label when available.
- `completedAt`: optional date/time.
- `dismissedAt`: optional date/time.

## Runtime Behavior

The renderer should own reminder polling because it already has PocketBase client state and can display UI directly. A small global reminder manager should mount after the app is connected to PocketBase, poll pending reminders on a short interval, and subscribe to collection changes if the existing collection hooks make that straightforward.

A reminder is due when:

- `status` is `pending`, and
- `snoozeUntil` is in the past, or `snoozeUntil` is empty and `dueAt` is in the past.

When a due reminder is found, the client should show one reminder at a time. Multiple due reminders can queue in chronological order. Since reminders are shared, more than one running client may show the same due reminder until someone marks it done or dismissed.

## User Interface

Add compact reminder controls to the Alerts tab:

- A "Schedule reminder" action near the alert timing/send workflow.
- A small reminder list or indicator showing upcoming pending reminders, kept compact so it does not crowd the existing composer.
- A scheduling modal with title, note, date, time, and optional alert context copied from the current draft.

Due reminders should be shown globally, not only inside the Alerts tab, so users are notified even while viewing another tab.

Due reminder actions:

- `Open Alerts`: switches to the Alerts tab and keeps the reminder visible until another action is chosen.
- `Snooze 10 min`: updates `snoozeUntil` and returns the reminder to pending.
- `Mark Done`: sets `status` to `done` and records `completedAt`.
- `Dismiss`: sets `status` to `dismissed` and records `dismissedAt`.

## Sound

Bundle a short, non-jarring reminder sound with the renderer assets. Play it once when a due reminder first appears. If autoplay is blocked or audio playback fails, keep the visual reminder active and do not treat sound failure as a user-facing error.

## Error Handling

- If reminder creation fails, show an error toast and keep the schedule modal open.
- If updating a reminder fails, show an error toast and leave the reminder visible so the user can retry.
- If polling fails because PocketBase is temporarily unavailable, do not spam errors. Retry on the next interval and surface connection health through the existing app status patterns.
- Date/time values should be stored in server-compatible UTC date values and displayed in the user's local timezone.

## Testing

Add focused coverage for:

- PocketBase bootstrap creation and patching of `alert_reminders`.
- Reminder service create, list due, snooze, mark done, and dismiss behavior.
- Due reminder manager behavior, including no duplicate alert for the same reminder during one visible cycle.
- Alerts tab scheduling UI, including draft-derived defaults.
- Sound playback fallback when audio fails.

Run the existing TypeScript, lint, unit, renderer, build, and Electron E2E checks before pushing.
