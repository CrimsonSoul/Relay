# All-Tab Header, Toolbar, and Search Alignment Design

**Date:** 2026-08-06
**Status:** Approved for implementation planning

## Problem

Relay's top-level tabs share an operations-console visual language, but their headers and command
rows currently implement different control heights, casing, icon sizes, spacing, grouping, and
responsive behavior. Alerts mixes 48px actions with a 36px overflow trigger. On-Call mixes 36px and
40px workflow controls. Status, Problems, and Radar place custom action buttons directly in their
header metadata. Knowledge uses a promotional hero that does not match the other operational tabs.

Header search now exposes safe, explicit verbs, but its contact rows visually compete between a
large primary hitbox and an oversized secondary bridge button. The action area compresses names and
email addresses and reads as two unrelated destinations.

## Goals

- Make Compose the canonical top-level header and toolbar design across every Relay tab.
- Give operators a stable reading order: tab identity, trustworthy state, commands, working canvas.
- Centralize header and command-row geometry so later tab changes cannot drift independently.
- Preserve every existing action, data boundary, keyboard behavior, and honest status message.
- Keep Header Search's context-preserving primary action while making bridge actions compact and
  predictable.
- Verify the result at normal width, constrained width, keyboard navigation, and 150% zoom.

## Non-Goals

- Redesigning nested pane toolbars, editor formatting controls, table controls, PDF controls, or
  record-detail actions.
- Adding, removing, or reprioritizing application capabilities.
- Changing Relay data, PocketBase, Electron IPC, web-session, authentication, or offline behavior.
- Inventing empty command rows for tabs that have no meaningful top-level actions.
- Replacing Relay's Accent Ink visual language.

## Canonical Visual Contract

Each top-level tab uses the same three-band frame when the applicable bands contain content:

1. **Page header:** eyebrow and title on the left; status or metadata on the right.
2. **Command row:** reversible or view-oriented utilities on the left; consequential workflow
   actions on the right.
3. **Working canvas:** the existing tab-specific content.

Compose remains the visual reference. The shared contract is:

- 16px vertical rhythm between major bands.
- 8px gaps within action groups and a visually stronger separation between utility and workflow
  groups.
- 36px utility controls.
- 40px workflow controls and 40px square workflow overflow triggers.
- Title Case visible labels.
- Shared 2px corners, border weight, icon scale, hover, focus, loading, and disabled states.
- One filled primary workflow action where the tab has a clear commit action.
- UI-font metadata with tabular numerals; metadata must not use monospace merely because it contains
  dates or counts.
- Status colors always retain a textual label.

## Tab Mapping

| Tab | Header status or metadata | Utility group, 36px | Workflow group, 40px |
| --- | --- | --- | --- |
| Compose | Recipient count | Reset, History | Copy recipients, **Open Teams draft**, More |
| Alerts | Draft severity | Save image | **Open in Outlook** or Download draft, More |
| On-Call | Week and last-update time | Reminder, display scale, Copy all, Export | Lock state, **Add card** |
| Knowledge | Wiki, contact, and server counts | None | None |
| Status | Provider and update state | Refresh | None |
| Problems | Sync state | Queue filters, profile, search, refresh | None |
| Radar | Current or stale state | Original, refresh | None |

Tabs without a workflow action do not receive accent-filled buttons. Tabs without any top-level
actions do not render an empty command row.

## Shared Component Structure

Introduce small slot-based primitives instead of copying Compose CSS or creating one monolithic
tab-header component:

- `TabPageHeader` owns eyebrow, title, metadata placement, typography, and responsive stacking.
- `TabCommandBar` owns the full-width command-row layout and toolbar semantics.
- `TabCommandGroup` identifies utility and workflow groups and applies the corresponding geometry.

The primitives accept React children so domain behavior remains in each tab. They do not know about
specific actions, data, or statuses. Existing `TactileButton` remains the button behavior primitive.
Custom refresh and overflow buttons migrate to `TactileButton`; filters, searches, and the On-Call
display control keep their specialized components but align to the utility-control token.

Shared CSS variables define the 36px utility and 40px workflow heights. Tab-specific styles may
control content layout but must not override the shared top-level geometry.

## Responsive Behavior

- Wide layouts keep utilities left and workflow actions right.
- Intermediate layouts allow groups to wrap as intact groups without clipping labels or changing
  keyboard order.
- Narrow layouts stack header metadata beneath the title and give each command group the available
  width.
- Existing DOM order remains the focus order; CSS does not visually reorder focusable controls.
- Long metadata wraps without overlapping the title.
- Controls remain usable at 150% zoom and with longer localized labels.
- Nested toolbars retain their current responsive rules unless a shared top-level style currently
  leaks into them.

## Header Search Action Rail

Header Search uses the approved stable-inline-actions design:

- Every result row uses a stable three-column grid: icon, result information, compact action rail.
- Clicking the main row or pressing Enter performs the context-preserving primary action: open the
  exact contact, server, document, workspace, or tab; group rows add the group because that is their
  existing primary action.
- Contacts display a compact `+ Bridge` secondary control. Its accessible name remains
  `Add <contact name> to bridge`.
- Group rows show a concise `Add group` primary verb and do not render a redundant second button.
- Other results show a concise stable verb such as `Open`, `Create`, or `Select` without adding an
  unnecessary button.
- Actions do not appear, disappear, or move on hover or keyboard selection.
- The dropdown may widen when viewport space permits. At constrained widths, the action rail adapts
  without crushing the name and subtitle columns.
- The footer explains Enter for the row action and Tab for the secondary action.
- The search clear control gains a usable hit target inside the existing 36px search rail without
  making the application header taller.

## Accessibility and Interaction

- Preserve the current combobox/listbox semantics and `aria-activedescendant` behavior.
- Preserve explicit accessible labels for icon-only controls and secondary search actions.
- Keyboard-generated clicks must invoke the same primary and secondary callbacks as pointer clicks.
- Visible focus treatment must be consistent across all shared controls.
- Disabled and loading controls retain their semantic state and cannot trigger actions.
- Selected, stale, healthy, warning, and error states never rely on color alone.
- Reduced-motion behavior remains unchanged.

## Error and Data Boundaries

This is a renderer-structure and styling change. It does not change error handling, network calls,
PocketBase reads or writes, import/export formats, web-runtime boundaries, Electron IPC, or external
application claims. Existing status and failure text remains the source of truth. Layout changes
must preserve overflow access and prevent an action from becoming unreachable at narrow widths.

## Verification

Focused regression coverage will verify:

- Each top-level tab renders the shared page-header structure.
- Each tab maps controls to the approved utility and workflow groups.
- Utility, workflow, and overflow geometry follows the shared contract.
- Alerts no longer mixes 48px and 36px peer actions.
- On-Call no longer mixes 36px and 40px controls within the same group.
- Status, Problems, and Radar no longer use bespoke top-level action-button geometry.
- Knowledge uses the shared operational header without inventing an empty command row.
- Search primary and secondary actions work by pointer and keyboard.
- Search rows preserve usable result information at constrained widths.
- Header metadata and toolbars remain usable at 150% zoom.

Visual verification will cover all seven top-level tabs at the standard Electron test viewport and
the most crowded toolbar at 150% zoom. Mechanical Impeccable detection runs once after the finished
UI edits. Full completion gates are:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
git diff --check
npm audit --audit-level=high --omit=dev
```

Electron integration coverage is required because shared renderer controls, Electron-visible
layout, and header actions are changing:

```bash
npm run test:electron
```

`docs/DESIGN.md` will document the final shared header, command-row, and search-action contracts.

## Acceptance Criteria

- A side-by-side scan of every top-level tab reads as one Relay application rather than seven
  independently styled pages.
- Compose's existing visual hierarchy remains intact.
- Every top-level control has the approved height, casing, spacing, icon scale, and focus behavior.
- Every existing action remains available and invokes the same behavior as before.
- Search actions are compact, fixed-position, readable, and fully keyboard accessible.
- No top-level control clips, overlaps, becomes unreachable, or changes focus order at supported
  widths or 150% zoom.
- Focused tests, Electron tests, full repository gates, and the production dependency audit pass.
