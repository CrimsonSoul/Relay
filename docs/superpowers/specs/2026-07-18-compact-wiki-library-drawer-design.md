# Compact Wiki Library Drawer Design

## Problem

Relay's Wiki uses a persistent 292px library beside the PDF reader. In a compact desktop window, the application sidebar reduces the real Knowledge workspace before the current viewport breakpoints run. The result is a narrow PDF reader, crowded controls, and a library that occupies roughly one third of the usable width.

## Approved Experience

- At more than 900px of Knowledge workspace width, keep the existing persistent library and reader layout unchanged.
- At 900px or less, give the reader the full workspace width and turn the library into a left-side overlay drawer.
- Show a compact `Library` control at the upper-left of the reader. It exposes `aria-controls` and `aria-expanded` and uses Relay's existing Wiki icon and tactile control geometry.
- Opening the drawer moves focus to Wiki search. Escape, the explicit close button, or the backdrop closes it. Escape and the close button return focus to the `Library` control.
- Selecting a document or outline section closes the compact drawer without changing the selected document, target page, search state, or expanded categories.
- Opening Wiki management closes the compact drawer before entering management.
- The overlay uses Relay's square, bordered, dark console vocabulary. It does not add rounded cards, decorative effects, or a new navigation model.

## Responsive Architecture

The breakpoint is a named CSS container on `.knowledge-tab`, not a viewport media query. This measures the width actually available after Relay's application shell and remains correct if the global sidebar changes.

The drawer remains mounted so library search, expansion, scroll, and selection state survive opening and closing. Compact CSS controls visibility, transform, pointer events, backdrop, and reader width. The desktop layout ignores drawer-open state and remains persistent.

## Accessibility

- Closed compact drawers are `visibility: hidden` and cannot receive pointer or keyboard input.
- The toggle and close controls have explicit accessible names.
- The drawer is associated with the toggle through `aria-controls`.
- Escape closes only while the drawer is open.
- Focus moves to search on open and returns to the toggle for keyboard-initiated dismissal.
- Reduced-motion users receive an immediate state change.

## Verification

- Component tests cover open, search focus, Escape dismissal, focus return, and automatic close after document selection.
- CSS/Electron coverage verifies the container-driven persistent and compact states.
- A real Electron critical-path test resizes Relay to a compact window, exercises open/close/selection, verifies the PDF reader remains available, then resizes to the desktop layout.
- Existing Wiki viewer and retained-tab regressions must remain green.
