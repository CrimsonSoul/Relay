# Critical Reminder Visual Design

## Goal

Make the due alert reminder popup visually impossible to miss while preserving the existing blocking reminder behavior and action flow.

## Scope

- Restyle the global due reminder overlay in `AlertReminderManager`.
- Use a red critical alarm treatment based on mockup option C: a flashing red wash with subtle hazard striping behind the dialog.
- Keep existing reminder actions and semantics unchanged: `Snooze 10m`, `Mark Done`, and `Dismiss`.
- Preserve the blocking `alertdialog`, focus trap, polling, chime, snooze, done, and dismiss behavior.
- Add a reduced-motion fallback so users who prefer reduced motion see a static high-contrast critical backdrop instead of a repeating flash.

This change does not add new reminder actions, change polling cadence, change reminder persistence, or introduce OS-level notifications.

## Visual Behavior

When a due reminder is visible, the full-screen overlay should use a critical red treatment:

- A dark blocking backdrop remains in place so the reminder interrupts the app.
- A red flashing wash draws attention across the viewport.
- Subtle diagonal hazard striping reinforces the alarm state without covering the reminder content.
- The reminder card switches from amber to Relay danger red for its accent bar, border, glow, and eyebrow text.
- The dialog layout and button order stay the same so the operator can act quickly without relearning the popup.

For users with `prefers-reduced-motion: reduce`, the overlay should not animate. It should instead render as a strong static red-tinted backdrop with static striping and critical card styling.

## Implementation Shape

Keep the behavior implementation in `src/renderer/src/components/AlertReminderManager.tsx` small. Add a critical visual class or stable test hook to the overlay, while leaving reminder selection, polling, keyboard focus, and actions untouched.

Put the styling in `src/renderer/src/styles/components.css` near the existing `Alert Reminder Due Prompt` section. Add focused keyframes for the critical flash and a reduced-motion media query. Use existing theme tokens where possible, especially `--color-danger`, `--color-danger-hover`, `--color-danger-subtle`, and existing background/text tokens.

## Testing

Add focused tests around the visual contract rather than animation timing:

- A due reminder renders the critical overlay class or stable visual hook.
- The existing `alertdialog` semantics and focus/action tests still pass.
- CSS includes a reduced-motion override for the reminder flashing treatment.

Run the targeted reminder manager test first, then the renderer tests. Use rendered browser validation after implementation to inspect the due reminder visually if a local app flow or fixture can surface it without changing production data.
