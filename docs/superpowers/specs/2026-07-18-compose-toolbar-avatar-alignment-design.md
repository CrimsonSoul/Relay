# Compose Toolbar and Group Avatar Alignment

## Goal

Bring Compose into the same operational layout vocabulary as Status and Problems without changing any Compose behavior. Correct group initials, tighten the heading-to-toolbar-to-workspace rhythm, and make action hierarchy legible at a glance.

## Scope

This pass changes only Compose presentation and group-token derivation:

- `AssemblerSidebar` group identity tokens
- Compose page toolbar geometry and action styling
- Compose-specific CSS and focused regression tests

It does not change recipient selection, sorting, bridge creation, scheduling, history, persistence, or responsive navigation.

## Group Identity Tokens

Group initials are derived from the first two meaningful alphanumeric words in the group name. Whitespace, underscores, ASCII hyphens, en dashes, em dashes, and other punctuation are separators rather than initials.

Examples:

- `Data — Engineering` -> `DE`
- `Field — Network` -> `FN`
- `HQ — Security` -> `HS`
- `OPS — Core SRE` -> `OC`
- `Leadership` -> `LE`
- an empty or punctuation-only name -> `?`

The token remains decorative and excluded from the accessibility name; the full group name and contact count remain the button label.

## Page Rhythm

Status and Problems remain the layout reference. Compose keeps the matching outer padding, 16px page-section gap, context label, title size, and title margin it already shares with those tabs.

The Compose command bar will stop inheriting the old CollapsibleHeader divider and extra 16px bottom padding. The toolbar itself will occupy one control row, followed by the page's existing 16px gap before the workspace. This removes the current doubled separation and keeps the toolbar visually attached to the recipient workspace.

Within the toolbar:

- 8px separates controls within a semantic group.
- 16px separates the sort controls from bridge actions.
- Existing responsive wrapping and the 1120px stacked layout remain intact.

## Button Hierarchy

Controls retain their existing handlers, disabled states, tooltips, labels, and icons.

- Reset, History, Copy All, and conditional Undo use a compact 36px outlined utility style matching the filter controls in Status and Problems.
- Sort selection and direction remain 40px controls.
- Start Bridge remains the single 40px filled primary action.
- Schedule becomes a 40px outlined secondary action so it no longer competes with Start Bridge for primary emphasis.

All controls retain Relay's 2px corner radius, focus treatment, high-contrast dark styling, and current wrapping behavior.

## Verification

Automated regressions will cover:

- initials for dash-separated, single-word, and punctuation-only group names
- the absence of the inherited Compose toolbar divider and duplicate bottom padding
- compact utility-button geometry
- distinct primary and secondary bridge-action roles

Verification will run the focused Compose test suites, typecheck, lint, formatting checks, and a visual inspection in the running Electron app at desktop and responsive widths. The mechanical layout detector must remain clean after the change.

## Acceptance Criteria

- Group avatars show meaningful two-letter tokens instead of dash glyphs.
- Compose heading and toolbar spacing visually matches Status and Problems.
- Utility, sort, and bridge controls follow the specified 36px/40px hierarchy.
- Start Bridge is the only filled primary bridge action.
- No Compose functionality or accessibility semantics regress.
- Existing responsive behavior remains usable without clipping or collisions.
