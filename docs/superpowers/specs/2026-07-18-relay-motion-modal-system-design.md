# Relay Motion and Modal System Design

## Goal

Give Relay one restrained motion language and one modal visual system across the application. The result should feel smooth and tactile without slowing operators down, and every modal should look like it belongs beside the current Knowledge, Status, and Problems surfaces.

This is a presentation-system change. Existing workflows, permissions, data operations, validation, and modal content remain functionally unchanged.

## Product constraints

- Relay is a dense operations console used under time pressure.
- Motion must clarify state and hierarchy rather than decorate the interface.
- IBM Plex Sans is the application UI family. Monospace is reserved for data that benefits from fixed-width scanning.
- Geometry remains square and tactile: strong dividers, restrained surfaces, 2px corners, and accent color used only for selection, focus, and primary actions.
- The operating system's `prefers-reduced-motion` setting is the only motion preference. Relay will not add a separate setting.

## Approved motion direction: Operational silk

The approved direction uses a quiet opacity transition, a 10px rise, and a 1.5% scale settle for elevated layers. It should be perceptible as polish without becoming something an operator waits for.

### Motion tokens

| Token | Duration | Use |
| --- | ---: | --- |
| Instant feedback | 100ms | Button press, checkbox, active-state acknowledgment |
| Control feedback | 140ms | Hover, focus, selection, validation color |
| State change | 160ms | Tabs, menus, popovers, tooltips, small content changes |
| Layer enter | 220ms | Modal and substantial overlay entrance |
| Layer exit | 160ms | Modal and substantial overlay exit |
| Structural change | 240ms | Drawers, side panels, and expandable regions |

All non-linear motion uses ease-out-quint: `cubic-bezier(0.22, 1, 0.36, 1)`. Linear easing remains limited to indeterminate rotation. Bounce, elastic, and long premium transitions are not part of the Relay motion system.

### Motion hierarchy

- **Elevated layers:** Backdrop opacity enters separately from the modal. The modal moves from `translateY(10px) scale(0.985)` and zero opacity to its resting state. Exit reverses the relationship at the shorter exit duration.
- **Tabs and destinations:** Active content crossfades with no more than 4px of directional movement. The active indicator transitions independently so labels remain stable.
- **Drawers and side panels:** Use transform plus opacity. Do not animate width, margins, or absolute positioning.
- **Menus, popovers, and tooltips:** Use opacity plus a 3–4px shift from their anchor. They must never blur or scale dramatically.
- **Controls:** Tactile actions receive immediate color feedback and a brief `scale(0.985)` active state. Rows and large panels use color only to avoid visual movement.
- **Loading and validation:** Skeletons fade into content. Success, warning, and error states transition color and opacity without shaking or pulsing.
- **Lists:** Existing operational lists remain immediate. Staggered entrances are not used for ordinary tab changes, refreshes, or large result sets. A newly inserted row may use a single state-change transition when the relationship is otherwise unclear.

### Reduced motion

When `prefers-reduced-motion: reduce` is active:

- Remove translate, scale, blur, and drawer movement.
- Replace layer and content movement with a near-instant crossfade.
- Stop nonessential pulses and breathing indicators while retaining their static semantic state.
- Keep indeterminate progress comprehensible with a minimal rotation or static progress label where available.
- Preserve focus movement, focus trapping, keyboard navigation, and all interaction timing not used solely for animation.

## Application motion coverage

The motion tokens apply at shared-system boundaries first, then to tab-specific state changes:

- Main tab and Knowledge destination activation.
- Knowledge home, Wiki catalog, PDF reader, sidebar/drawer, View menu, filters, and loading-to-content states.
- Compose, Alerts, On-Call, Status, and Problems tab panels, detail panels, expandable sections, and selection feedback.
- Modal, nested dialog, confirmation, and history entrances and exits.
- Dropdowns, command/search results, context menus, tooltips, toasts, and world-clock popovers.
- Setup and loading states, shortened to the shared system rather than separate 400–600ms choreography.
- Shared buttons, tabs, checkboxes, inputs, and validation feedback.

PDF scrolling, continuously updating operational data, and large list rendering remain unanimated.

## Shared modal system

All modal experiences use `Modal` as the common overlay, presence, focus, dismissal, and geometry boundary. Specialized content can choose a modal variant but does not create a new shell.

### Variants

| Variant | Nominal width | Intended use |
| --- | ---: | --- |
| Confirmation | 400px | Destructive confirmation and short decisions |
| Standard | 560px | Contact/server forms, notes, reminders, shortcuts |
| Wide workspace | 820px | Data Manager and dense multi-section workflows |
| Large workspace | 960px | Team maintenance and complex history surfaces |

Every variant respects a viewport-safe maximum width, an 85vh maximum height, compact-window reflow, and a single internal scrolling region.

### Modal anatomy

- **Overlay:** Restrained application backdrop with no decorative blur. The backdrop participates in the shared layer transition.
- **Shell:** Elevated Relay surface, 1px strong border, 2px corner radius, and a compact shadow no larger than the existing small shadow token. Remove the current 14px rounded floating-card treatment and decorative top accent line.
- **Header:** 64px minimum height, IBM Plex Sans title, optional useful subtitle, and one consistent 38px close control. Headers do not add generic kickers or icons unless the icon conveys state.
- **Tabs:** Optional tab rail directly below the header. It uses the same stable label and bottom-indicator language as Knowledge and the current top-level tabs.
- **Body:** Token-based spacing, one scroll region, no nested-card treatment for sections that can be separated by spacing and dividers.
- **Footer:** Top divider, consistent spacing, and 44px secondary and primary actions. Destructive actions use the semantic danger treatment; primary accent is not reused decoratively.

### Presence and dismissal

The shared modal layer remains mounted during its 160ms exit instead of disappearing immediately when `isOpen` becomes false. A small shared presence mechanism exposes `opening`, `open`, and `closing` states to CSS.

- Focus trapping activates while the modal is interactive and releases after close begins.
- Body scroll remains locked until the closing layer is removed.
- Escape and backdrop dismissal preserve existing behavior.
- Non-dismissible busy states remain non-dismissible throughout the exit lifecycle.
- The trigger that opened a modal regains focus after the portal unmounts when that trigger still exists.

## Modal migration scope

The migration includes:

- Add/Edit Contact and Add/Edit Server.
- Confirm and delete-confirmation flows.
- Notes and tags.
- Data Manager.
- Settings when presented as a modal.
- Maintain Team.
- Shortcuts.
- Generic and specialized history views.
- Alert history, alarm/reminder, and reminder-manager flows.
- Bridge history, reminder, save-group, and scheduling flows.
- Personnel management flows.
- Nested Administration dialogs for accounts, server settings, and paired devices.
- The custom Problems dialog and the Alert History label editor.

Bare or workspace-style consumers retain control over their internal layout, but their overlay, shell geometry, header rhythm, dismissal, and motion come from the shared system.

## Reference treatment: Data Manager

Data Manager becomes the reference wide-workspace modal:

- Shared modal header and close control.
- Overview, Import, Export, and Backups in a stable tab rail below the header.
- IBM Plex Sans for all interface copy and controls.
- Monospace only for file paths, formats, identifiers, timestamps, or fixed-width counts.
- Sections organized by hierarchy, spacing, and dividers rather than nested cards.
- Controls align to the shared 44px modal action size and standard form vocabulary.
- Tab panel changes use the shared 160ms crossfade plus no more than 4px directional movement.

The import/export/backups logic and all existing success, error, and loading behavior remain unchanged.

## Typography rules

- IBM Plex Sans is explicit at the shared modal shell and inherited by all modal content.
- Titles use the existing semantic large token and bold weight.
- Section headings use the semantic medium token and bold weight.
- Body and form controls use the semantic base or small token according to density.
- Labels and supporting text use the semantic small or extra-small token without arbitrary local sizes.
- JetBrains Mono is limited to timestamps, identifiers, codes, paths, keyboard shortcuts, and fixed-width numeric readouts.
- Replace undefined or drifting aliases such as `--font-mono` with the canonical `--font-family-mono` token.
- Preserve the existing semantic scale designed for half-screen 1080p monitors and 55-inch 1080p displays; this project does not replace the global type scale.

## Component and CSS architecture

- Add the approved durations and easing to the theme token layer and map existing transition aliases to them.
- Remove the unused bouncy transition token and consolidate duplicated modal animation declarations.
- Keep simple state motion in CSS. Do not add Framer Motion, GSAP, or another runtime dependency.
- Add a small reusable presence hook or component only where exit animation requires delayed unmounting.
- Use data-state attributes for layer lifecycle and active tab state rather than duplicating keyframes per component.
- Retain the global reduced-motion kill switch and add static component fallbacks where semantic state currently depends on animation.
- Migrate one-off modal overlay and dialog classes to shared variants, leaving feature-specific content classes scoped to their feature.

## Accessibility and performance

- Existing dialog semantics, focus trap, accessible titles, Escape handling, and backdrop dismissal are required regressions.
- Visible focus treatment remains stronger than hover and is never removed during animation.
- Motion never delays a destructive confirmation or hides an error message.
- Transform and opacity are the default animated properties. Layout-driving properties are not animated casually.
- Blur and backdrop-filter are excluded from the approved operational direction.
- Long lists, PDF pages, and polling data avoid entrance animation.
- Interaction remains possible throughout state transitions unless the underlying operation is genuinely busy.

## Verification

### Automated

- Unit tests for shared modal presence, closing lifecycle, focus return, body-scroll lock, Escape behavior, backdrop dismissal, and non-dismissible states.
- Existing tests for every modal consumer remain green.
- Style contract tests for motion tokens, easing, reduced-motion fallbacks, 2px modal geometry, IBM Plex inheritance, and canonical monospace usage.
- Regression tests for Data Manager tab semantics and unchanged import/export behavior.
- Regression tests for Knowledge destination, reader drawer, and View-menu behavior after motion styling.
- Full unit, cache, and renderer suites plus lint, formatting, typecheck, production build, and `git diff --check`.

### Live Electron

- Inspect standard, confirmation, wide, large, bare/history, and nested-dialog variants.
- Exercise modal enter and exit, Escape, backdrop dismissal, busy states, and focus return.
- Inspect Data Manager, Settings, Notes, Shortcuts, a history modal, and a destructive confirmation.
- Exercise main tabs and Knowledge home, Wiki catalog, PDF reader, sidebar drawer, and View menu.
- Verify full-width and compact Relay windows.
- Enable the operating system's Reduce Motion preference and verify transforms disappear while state remains clear.
- Check for clipping, double focus rings, font drift, layout shift, and console errors.

## Non-goals

- No workflow, permission, storage, import/export, alert, scheduling, or PDF behavior changes.
- No application-specific motion preference.
- No page-load choreography, decorative looping animation, bounce, elastic motion, blur-heavy overlays, or celebratory effects.
- No new animation dependency.
- No redesign of the main tab information architecture.

## Acceptance criteria

The system is complete when:

1. Every modal uses the shared overlay, lifecycle, geometry, typography, and motion vocabulary.
2. Data Manager visually matches the approved wide-workspace direction without functional changes.
3. Tab, drawer, menu, selection, and validation motion uses the approved token tiers and stays below the operational motion ceiling.
4. IBM Plex Sans is consistent for UI copy, with monospace restricted to meaningful data.
5. Reduced Motion removes transforms and nonessential looping motion without reducing clarity or accessibility.
6. The application remains responsive and regression-free at full and compact widths.
