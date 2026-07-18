# Compose and Alerts Operational Frame Design

**Date:** 2026-07-18
**Status:** Approved design; awaiting written-spec review
**Selected direction:** Option A — Shared operational frame

## Summary

Relay will restyle the Compose and Alerts tabs so they use the same operational hierarchy as Status and Problems: a page identity header, a full-width command bar, a bordered working area, and a bottom status bar. The selected Option A mockup is the visual source of truth for this hierarchy.

The work is a presentation and layout pass. Compose keeps its recipient, contact-group, bridge, history, sorting, scheduling, and scroll-collapse behavior. Alerts keeps its composer, preview, history, templates, reminders, image capture, Outlook export, and click-through behavior. Existing handlers and data flows remain authoritative.

The exported alert card is not redesigned. Its current on-screen representation remains the capture target, and the email/PNG content inside the sections marked `EMAIL CONTENT — DO NOT RESTYLE` remains unchanged. Only the Relay application chrome around that preview changes.

## Goals

- Make Compose and Alerts feel native beside Knowledge, Status, and Problems.
- Establish a consistent hierarchy of context, title, live state, commands, workspace, and connection status.
- Use the available width deliberately instead of presenting controls as a detached top strip.
- Give each workspace clear pane identities and stronger alignment.
- Keep primary actions easy to find without making every control visually dominant.
- Preserve every existing action, enabled/disabled rule, modal, shortcut, state transition, and export path.
- Keep the interface usable when the Electron window is narrower or controls must wrap.

## Non-goals

- No changes to Compose recipient selection, group storage, manual add/remove behavior, sorting semantics, bridge creation, calendar scheduling, or history data.
- No changes to Alerts severity meanings, rich-text editing, templates, reminder storage, alarm playback, capture resolution, Outlook/EML generation, click-through sanitization, or alert history data.
- No redesign of the exported alert card, email markup, or PNG output.
- No new navigation destinations, data collections, IPC contracts, backend services, or authentication rules.
- No broad refactor of Status, Problems, Knowledge, shared navigation, or unrelated controls.
- No new required fields or validation gates. New readiness labels are informational only.

## Shared Visual Language

### Page identity header

Each tab begins with a page identity row inside the tab content area.

Compose uses:

- context label: `Compose`;
- title: `Bridge recipient assembly`; and
- live meta: connected/ready state plus the current recipient count.

Alerts uses:

- context label: `Alerts`;
- title: `Operational alert composer`; and
- live meta: draft state plus the current severity.

The title and meta align to the same horizontal rhythm used by Status and Problems. The meta includes text as well as a status signal; color is never the only state indicator. This row establishes page context but does not introduce new controls.

### Command bar

A full-width command bar sits below the page identity header and above the workspace. It has a bottom border and enough vertical padding that its controls do not sit on the divider.

Commands are divided by intent:

- utility and history actions align left;
- sorting and workflow-completion actions align right;
- ghost/secondary treatment is used for reversible or supporting actions; and
- Relay's primary accent is reserved for the actions that advance the workflow.

All controls continue to use the existing `TactileButton`, `ListToolbar`, tooltip, focus, loading, and disabled-state behavior. The redesign changes grouping and spacing, not handler ownership.

### Bordered workspace

The main working surface is a single bordered two-pane workspace, not a grid of cards. Pane headers share one compact height and expose a pane label plus a small contextual count or state. The pane divider, outer border, background layers, and square geometry follow the current Status/Problems/Knowledge vocabulary.

Each pane owns its scrolling region. Page identity and command controls stay stable while long lists, forms, or previews scroll within their existing flow.

### Status bar

The existing `StatusBar` remains the final row of each tab. Connection state stays on the left. The right side shows tab-specific context: selected-recipient count for Compose and alert-composer context for Alerts. No connection or presence behavior changes.

### Typography, color, and motion

- Continue Relay's existing font families, size tokens, uppercase/tracked operational labels, dark surfaces, sharp borders, and restrained blue accent.
- Use semantic color only for selection, primary actions, connection state, severity, warning, and error states.
- Do not add gradients, glow, glass effects, broad shadows, decorative animation, or rounded dashboard cards.
- Hover, focus, active, disabled, and loading states continue to use the existing component vocabulary.
- Layout transitions, if any are needed for the existing collapsed header, stay within 150–250 ms and respect `prefers-reduced-motion`.

## Compose Design

### Page structure

Compose retains the outer Relay shell and current tab lifecycle. Inside the tab, the selected layout is:

1. page identity header;
2. full-width command bar;
3. bordered contact-group/recipient workspace; and
4. existing status bar.

The current `AssemblerTab` remains the orchestration owner. `AssemblerSidebar`, `CompositionList`, the bridge reminder, history modal, group editor, and schedule modal continue to receive their existing props and callbacks.

### Command hierarchy

The left command group contains:

- Undo, when a removable manual change exists;
- Reset;
- History; and
- Copy all.

The right command group contains:

- Sort by field;
- Sort direction;
- Start bridge; and
- Schedule.

Existing conditions remain unchanged. Reset, Copy all, sorting, Start bridge, and Schedule stay disabled when their current logic says they are unavailable. Undo remains conditional. The visible `Schedule` label follows the approved mockup while the existing tooltip continues to identify it as the bridge-calendar action.

The current 30-pixel recipient-list scroll threshold and collapsed-header behavior remain functional. Past that threshold, the command bar reduces its existing action spacing and button padding. Labels remain visible, no command disappears, and the primary actions remain accessible.

### Contact groups pane

The left pane is labeled `Contact groups`. It hosts the current `AssemblerSidebar` content in the new pane frame:

- group creation action in the pane header;
- existing group rows, counts, selection state, and edit/delete behavior;
- current selected-group handling; and
- total and selected counts in the pane footer.

The pane is visually part of the workspace rather than a second application sidebar. No group storage or selection semantics change.

Selected groups use the existing checkmark plus a full-row selected background and accented group token. The current four-pixel colored side stripe is removed; selection remains clear without adding a decorative edge treatment.

### Recipients pane

The right pane is labeled `Recipients` and shows the current selected-recipient count. It contains:

- the current virtualized recipient list;
- existing per-recipient removal and manual-change behavior; and
- the current empty-state route to History.

The empty state teaches the three existing ways into the workflow: select a contact group, add a contact through existing search/navigation, or reopen a recent bridge. It does not introduce a new recipient source.

The local recipient search field and `Remove all` button shown illustratively in the mockup are not part of the production change because Compose does not currently provide those controls. Global search remains the search path, and Reset retains its current meaning rather than becoming a new bulk-remove action.

### Compose data flow

`useAssembler` and current local state remain the source of truth. The design adds no parallel selection state. Counts and live meta are derived from `asm.allRecipients`, current manual changes, existing connection state, and the current sort configuration. The page-frame elements render those values without changing them.

## Alerts Design

### Page structure

Alerts retains the outer Relay shell and current tab lifecycle. Inside the tab, the selected layout is:

1. page identity header;
2. full-width command bar;
3. optional existing next-alarm strip;
4. bordered alert-definition/preview workspace; and
5. existing status bar.

The next-alarm strip remains directly associated with the command region. It keeps its existing click target, count, time formatting, and reminder-manager behavior.

### Command hierarchy

The left command group contains:

- Reset;
- History;
- Alarms;
- Pin template; and
- Save image.

The right command group contains:

- Schedule alarm; and
- Open in Outlook.

`Open in Outlook` remains the primary action. `Schedule alarm` remains secondary. Loading and disabled states continue to come from the existing capture and reminder logic. All current tooltips and callbacks remain connected.

At narrower widths, the command groups wrap to additional lines while preserving every action label. Actions remain visible and keyboard reachable; they are not moved into a new overflow menu in this pass.

### Alert definition pane

The left pane is labeled `Alert definition`. It contains the existing three-step `AlertForm` workflow:

1. Set alert posture;
2. Write the message; and
3. Add delivery details.

All current fields, limits, severity choices, editor controls, date/time inputs, sender/recipient inputs, clickable-image URL input, validation text, and template behavior remain intact.

The pane header displays a derived required-step summary: `1 of 2 required ready` while the message is incomplete and `2 of 2 required ready` once both subject and visible body text are present. This uses the existing `messageComplete` rule: posture is already Done, message is Done or Active, and delivery remains Optional and is not counted. The summary is presentation-only. It does not add required fields, block export, change validation, or alter current action availability.

### Live email preview pane

The right pane is labeled `Live email preview`. Its header shows compact output context such as the current severity and expected preview width. The preview stage centers the existing alert card on a neutral dark canvas and preserves its natural vertical growth.

The application may restyle only the wrapper, pane header, preview canvas, spacing, and scroll behavior around the card. It must not restyle or structurally alter:

- `AlertCard` output markup used for capture/export;
- any CSS inside the `EMAIL CONTENT — DO NOT RESTYLE` boundaries;
- the preview element/ref used by image capture;
- click-through URL attachment and sanitization;
- PNG capture dimensions or quality; or
- Outlook/EML inline-image and editable-draft generation.

The on-screen preview remains the capture target so the displayed alert and exported alert cannot drift apart.

### Alerts data flow

The current state in `AlertsTab` remains authoritative. Header meta, pane counts, and readiness labels are derived from the existing severity, subject, body, delivery fields, capture state, and reminder state. `AlertForm` continues to update that same state, and `AlertCard` continues to render from it. No duplicate draft model is introduced.

## Responsive Behavior

Relay remains desktop-first, but the layout must tolerate the main window's existing 400-pixel minimum width.

- Above 1120 pixels, Compose uses a narrow contact-group pane and flexible recipient pane. Alerts gives the preview enough width to display the existing alert card without scaling its export markup.
- From 901 through 1120 pixels, command groups wrap within the full-width bar and pane minimum widths prevent controls from overlapping borders. Alerts retains its existing one-column transition at 1100 pixels; Compose remains two-column until 900 pixels.
- At 900 pixels and below, both workspaces stack into one column rather than clipping horizontally. Compose shows groups above recipients; Alerts shows the definition above the preview.
- At 620 pixels and below, page-header meta moves below the title and command groups use the full content width.
- Pane content retains independent vertical scrolling where required.
- At 620 pixels and below, header meta moves below the title while title, state text, and actions remain readable.
- No control may sit over a divider, overlap another control, or rely on horizontal page scrolling.

## Accessibility and Interaction Requirements

- Preserve existing button names, tooltips, keyboard behavior, modal focus management, and disabled semantics.
- Use semantic headings and regions for the page title, command bar, pane labels, form, recipient list, and preview.
- Preserve visible `:focus-visible` treatment on every interactive control.
- Maintain at least 4.5:1 contrast for body/label text and 3:1 for large text and meaningful component boundaries.
- Pair every colored status signal with text.
- Keep touch/click targets at the existing Tactile control size or larger.
- Do not replace native select behavior or existing editor semantics with decorative controls.
- Respect reduced-motion preferences for the existing header compaction transition.

## Implementation Boundaries

The expected production changes are limited to renderer presentation files and focused UI tests:

- restructure the markup around existing controls in `AssemblerTab.tsx` and `AlertsTab.tsx`;
- adapt `AssemblerSidebar`, `CompositionList`, `AlertForm`, or their immediate wrappers only where a pane header or layout slot requires it;
- update `assembler.css` and the application-only portion of `alerts.css`;
- reuse existing Status/Problems spacing, border, control, and status-bar tokens; and
- add focused regressions for the new frame and preserved workflows.

Do not change shared IPC types, main-process handlers, persistence services, export services, reminder services, or bridge services unless implementation reveals a pre-existing UI-only typing dependency. A newly discovered non-visual dependency must be reported before expanding scope.

No generic page-frame component is required for this pass. Status and Problems already demonstrate that local tab composition can share the same visual language without coupling unrelated data flows. Shared tokens or small layout utilities are appropriate; a broad abstraction is not.

## Error, Empty, Loading, and Offline States

- Existing Compose empty, loading, and recipient-list behavior remains visible inside the new recipient pane.
- Existing group failures, bridge failures, schedule failures, and copy feedback continue through their current toast/modal paths.
- Existing Alerts validation, capture failure, Outlook failure, reminder failure, and alarm feedback remain unchanged.
- Loading states stay on the initiating action and must not replace the whole workspace with a spinner.
- Existing connection status remains visible in the status bar.
- If either workspace cannot render its data, the current `TabFallback`/error boundary behavior remains the fallback; the redesign does not hide or restyle errors into success-like states.

## Verification Strategy

### Focused behavior regressions

Compose tests will verify:

- each command still invokes its current handler;
- disabled/enabled states still track recipient availability and manual changes;
- sorting and sort direction still update the current configuration;
- group selection still populates the recipient list;
- reset, undo, removal, history, Start bridge, and Schedule behavior remain connected;
- the existing scroll threshold still compacts the command region; and
- page header, pane labels, counts, and status bar render from current state.

Alerts tests will verify:

- Reset, History, Alarms, Pin template, Save image, Schedule alarm, and Open in Outlook remain connected;
- the next-alarm strip still opens reminder management;
- form changes still update the on-screen preview;
- severity and informational readiness metadata render without changing validation or action availability;
- the capture ref still targets the existing alert card;
- click-through URL data still reaches the current Outlook/EML export path; and
- the protected email-content CSS and alert-card output are unchanged.

### Visual and quality checks

- Compare Compose and Alerts at the same desktop viewport with Knowledge, Status, and Problems to confirm shared hierarchy and density.
- Verify wide, medium, and narrow window layouts for wrapping, stacking, clipping, pane scrolling, and divider alignment.
- Verify keyboard traversal and visible focus through both command bars and workspaces.
- Verify representative empty, populated, loading, disabled, reminder-present, and long-alert states.
- Run the repository's focused renderer tests plus required typecheck, lint, and build gates after implementation.
- Launch Relay and visually verify the actual Electron surfaces, then export a PNG and Outlook draft to confirm the UI-only redesign did not change output.

## Acceptance Criteria

- Compose and Alerts visibly use the approved Option A operational frame.
- Both tabs align with the hierarchy and density of Status, Problems, and the approved Knowledge workspace.
- Command bars span the full available content width, and controls do not sit on divider lines.
- Compose has distinct Contact groups and Recipients panes inside one bordered workspace.
- Alerts has distinct Alert definition and Live email preview panes inside one bordered workspace.
- Every existing Compose and Alerts control is present and performs the same action under the same availability rules.
- Existing modal, toast, keyboard, history, reminder, bridge, sort, search, and collapse behavior remains intact.
- The alert card, capture target, PNG output, Outlook draft, and integrated click-through behavior remain unchanged.
- The layout remains usable without overlap or horizontal clipping at supported window widths.
- Focus, contrast, semantic state text, and reduced-motion behavior meet the accessibility requirements above.
- Focused regressions and repository quality gates pass.
