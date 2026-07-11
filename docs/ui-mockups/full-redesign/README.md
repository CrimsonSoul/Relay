# Relay full UI redesign mockup

This standalone prototype explores a complete visual and information-architecture redesign without changing Relay's production renderer.

## Direction

- Preserve Relay's dark, tactile operations-console identity.
- Keep Compose as the default task instead of inventing a decorative dashboard.
- Separate operational workspaces from reference workspaces in the primary navigation.
- Surface connection health, Central Time, sync state, and task readiness persistently.
- Use dense ledgers and split panes for time-sensitive scanning rather than repeated generic cards.
- Reserve the accent for current state and primary actions; keep warning, danger, and success semantic.

## Included workspaces

- Bridge assembly
- Alert studio with live export preview
- On-call board
- Service status command center
- People directory
- Server inventory
- Operations notes
- Settings drawer with accent scheduling and connection state

## Interaction

Open `index.html` directly or serve this directory with any static file server. The sidebar, command palette (`Cmd/Ctrl+K`), keyboard shortcuts (`1`–`7`), settings drawer, alert preview, tables, groups, notes, and status refresh are interactive.

This is intentionally isolated under `docs/ui-mockups/`; it does not import production code or modify application behavior.
