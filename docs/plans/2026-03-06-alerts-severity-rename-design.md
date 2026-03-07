# Alerts Severity Rename Design

## Goal

Remove the `MINOR` alert severity from the Alerts tab and rename `MAJOR` to `ISSUE` everywhere in the Alerts feature so the preview banner reads `ALERT ISSUE`.

## Current State

- The Alerts severity model is defined in `src/renderer/src/tabs/alertUtils.tsx`.
- `AlertForm` renders the selectable severities from the shared `SEVERITIES` array.
- `AlertCard` renders the alert header as `ALERT` plus the current severity label.
- There do not appear to be existing renderer tests covering this Alerts composer flow.

## Design

- Replace the Alerts severity union and `SEVERITIES` array entry `MAJOR` with `ISSUE`.
- Remove `MINOR` from the union, the severity list, and the associated icon/color entry.
- Preserve the existing visual treatment currently used for `MAJOR`, but move that styling to `ISSUE` so the feature behavior stays visually consistent.
- Keep `AlertCard` header structure unchanged so the rendered text becomes `ALERT ISSUE` through the renamed severity label.
- Update any Alerts-specific tests or fixtures to use `ISSUE` and add a new renderer test that proves `MINOR` is absent and `ISSUE` is shown in the composer and preview.

## Testing

- Add a focused renderer test for the Alerts tab or card/form composition.
- First verify the new test fails because `MINOR` still exists and `MAJOR` is still rendered.
- Make the minimal implementation changes.
- Re-run the focused test, then the renderer test suite if practical.

## Notes

- This change is scoped to the Alerts feature codepath and should not change unrelated weather alert severity handling.
