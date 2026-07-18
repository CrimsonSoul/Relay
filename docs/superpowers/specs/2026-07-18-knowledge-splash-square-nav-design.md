# Knowledge Splash Square Panels and Wiki-First Navigation

Date: 2026-07-18
Status: Approved

## Goal

Align the Knowledge splash and destination navigation with Relay's operational pane-and-divider visual language while preserving all existing workspace behavior.

## Approved Design

### Splash destination panels

- Set the outer Wiki, Contacts, and Servers destination panels to square corners with `border-radius: 0`.
- Keep the small `WK`, `CT`, and `SV` monogram tiles subtly rounded at their current radius. They remain compact identity markers rather than structural panes.
- Preserve the existing panel dimensions, spacing, typography, borders, hover, active, focus, count, and responsive behavior.

### Destination navigation

- Order the destination buttons `Wiki`, `Contacts`, then `Servers` after `Knowledge home`.
- Keep the current destination active state, click behavior, retained workspace state, accessibility attributes, and home navigation unchanged.
- The splash launcher already uses Wiki, Contacts, Servers order, so the navigation will now maintain the same reading order after a destination opens.

## Implementation Boundaries

- Change only the outer destination panel corner treatment and the destination navigation array order.
- Do not change the splash content, card proportions, background, monogram tiles, toolbar geometry, workspace layout, routing, loading, or data behavior.
- Do not modify the Wiki continuous-scroll controls or the Contacts and Servers workspaces.

## Verification

- Add a failing regression test that requires the top navigation order to be `Knowledge home`, `Wiki`, `Contacts`, `Servers`.
- Add a failing style-contract test that requires the outer destination panel to use `border-radius: 0` while the monogram tile retains its current rounded radius.
- Run the focused Knowledge tests, then the full renderer suite, typecheck, lint, production build, and diff check.
- Verify the splash and an open Wiki workspace in the running Relay app at desktop width. Confirm square outer panels, rounded monogram tiles, Wiki-first navigation, unchanged interaction states, and no responsive regression.

## Success Criteria

The splash reads as part of Relay's square operational pane system, and every open Knowledge destination presents the top navigation in Wiki, Contacts, Servers order without any functional change.
