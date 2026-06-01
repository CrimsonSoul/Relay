# Cohesive Reminder Popup Design

## Goal

Make the due reminder popup feel cohesive with Relay's existing visual system while preserving the current urgent alarm behavior.

## Approved Direction

Use the structure of the current critical reminder popup, with the following visual refinements:

- Keep the left red alarm accent strip and critical red overlay treatment.
- Keep the compact modal footprint and current actions: `Snooze 10m`, `Mark Done`, `Dismiss`.
- Add a small `Due now` status pill in the popup header row.
- Align spacing, border radius, colors, and buttons with Relay's existing modal and `TactileButton` system.
- Do not introduce new action behavior, settings, or sound changes.

## Component Shape

The popup remains owned by `AlertReminderManager`. It should continue using `TactileButton` for all actions. The markup only needs one small addition: a header row that contains the existing eyebrow text plus a new status pill.

## Styling

Styles stay in `src/renderer/src/styles/components.css` beside the existing reminder popup styles. The popup should:

- Use `var(--color-bg-surface-elevated)` for the card surface.
- Use `var(--color-danger)` / `var(--color-danger-hover)` only for urgent accents.
- Use existing radius and border variables where practical.
- Avoid custom button styling; rely on `TactileButton` variants.
- Preserve reduced-motion behavior for the overlay flash.

## Testing

Update the existing `AlertReminderManager` renderer tests to assert the cohesive visual hooks:

- Due reminders render the `Due now` pill.
- The popup uses the critical overlay and critical dialog classes.
- The action buttons keep their intended labels and variants through `TactileButton` usage.

Run focused renderer tests, then TypeScript, lint, renderer suite, and a production build before completion.
