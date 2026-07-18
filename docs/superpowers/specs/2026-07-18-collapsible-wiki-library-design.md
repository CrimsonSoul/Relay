# Collapsible Wiki Library Design

## Problem

The compact Wiki drawer gives the PDF reader the full workspace width at 900px or less, but the 292px library is permanently visible above that breakpoint. Wide windows usually benefit from that persistent navigation; long or detailed PDFs sometimes benefit more from reclaiming the same space.

## Approved Experience

- At more than 900px of Knowledge workspace width, keep the library open by default.
- Add a quiet `Collapse Wiki library` control to the library heading on wide layouts.
- When the user collapses the wide library, the PDF reader spans the full workspace and a labeled `Library` control appears at the upper-left of the reader.
- Activating the wide `Library` control restores the persistent library and returns the reader to the two-column layout.
- Keep the wide collapsed preference only in the mounted Relay session. A fresh application launch starts with the library open.
- At 900px or less, preserve the existing overlay drawer exactly: it starts closed, opens from the labeled `Library` control, focuses search, and closes through Escape, backdrop, close control, or selection.
- Compact drawer state and wide collapsed state are independent. Resizing to compact never changes the user's wide preference; resizing back restores the prior wide state.
- Wide collapse and restore do not change search, expanded categories, selected document, page, zoom, or continuous/single-page reader mode.

## Interaction Architecture

`KnowledgeTab` owns two separate booleans:

- `libraryDrawerOpen` is the transient compact overlay state.
- `desktopLibraryCollapsed` is the session-only wide-layout preference.

The workspace exposes both states as data attributes. CSS container queries decide which control and which layout are active, so JavaScript does not duplicate or infer the 900px layout breakpoint.

The compact and wide restore controls are separate buttons with the same visible `Library` label. This prevents a compact open action from mutating the wide preference. The library heading likewise contains separate wide-collapse and compact-close controls whose visibility is determined by the container.

## Visual Design

- Use the existing Wiki icon, borders, typography, accent states, and 31px toolbar-control height.
- The wide collapse control is a compact left-pointing panel icon inside the library heading, not another prominent text action.
- The labeled `Library` control is absent while the wide library is visible and appears only when the user has collapsed it.
- Wide collapse has no backdrop and no modal behavior. Compact mode retains the existing dimmed backdrop and overlay motion.

## Accessibility

- Wide controls use `Collapse Wiki library` and `Show Wiki library` accessible names.
- The restore control exposes `aria-controls="knowledge-library-drawer"` and `aria-expanded="false"`; the wide collapse control communicates the inverse action directly through its label.
- Restoring the wide library moves focus to Wiki search so keyboard users land in the revealed region.
- Collapsing the wide library moves focus to the restore control after it becomes available.
- Escape remains scoped to the compact overlay and does not collapse the wide persistent library.
- Reduced-motion behavior remains immediate.

## Verification

- Component coverage verifies wide collapse, focus transfer, restore, and independence from compact overlay state.
- CSS/Electron coverage verifies 1040px open and collapsed geometry plus the unchanged 880px compact overlay.
- The real Electron critical path collapses and restores the library at desktop width, resizes through compact mode, and confirms the PDF reader and selected document survive every transition.
- Existing compact drawer, repeated Wiki leave/return, PDF layout, renderer, typecheck, and build checks remain green.
