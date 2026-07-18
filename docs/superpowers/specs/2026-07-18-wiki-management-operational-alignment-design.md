# Wiki Management Operational Alignment

Date: 2026-07-18
Status: Approved

## Goal

Fix the privileged-access workstation-owner dropdown overflow and align Wiki Management with Relay's established Status and Problems visual language without changing permissions, document workflows, data behavior, or available actions.

## Approved Direction

The approved full-size mockup keeps the existing Wiki Management information architecture: page header, publisher actions, four-section management rail, section-specific toolbar, and row-based Documents, Uploads, Trash, and Audit content. The pass changes presentation and responsive layout only.

## Privileged Access Dropdown Fix

### Root cause

The current `.privileged-access__pairing-actions` flex row has `min-width: min(100%, 420px)`, while its 260px-minimum account field, pairing button, and gap require more than 420px. Because the row is end-aligned, the overflow is pushed left and the label and select escape the pairing card.

### Corrected layout

- Replace the fragile flex sizing with a bounded two-column grid.
- Give the action group `width: min(100%, 500px)`, `min-width: 0`, and `grid-template-columns: minmax(0, 1fr) auto`.
- Keep an 8px gap, bottom-align the controls, and use `margin-left: auto` so the group remains aligned to the card's right edge at desktop widths.
- Allow the account field and native select to shrink within the first grid column instead of contributing an overflowing intrinsic minimum.
- At the existing 600px privileged-access breakpoint, switch the action group to one column at full width and remove the auto left margin.
- Preserve all option labels, selected account state, disabled/loading states, pairing behavior, and accessibility labels.

## Management Page Rhythm

Status and Problems remain the reference surfaces.

- Use a flat app background with `gap: var(--space-4)` and `padding: var(--space-4) var(--space-5) var(--space-5)` on the management root.
- Follow-up decision (2026-07-18): the later bottom-edge spacing requirement supersedes the original zero-bottom gutter; at `<= 820px`, retain `padding: var(--space-3)` on all sides.
- Remove the decorative root gradient.
- Use the shared operational heading treatment: the existing context label, `var(--text-2xl)` title, `var(--space-1)` title margin, zero display tracking, and `var(--leading-tight)` line height.
- Remove the combined custom header-bottom padding and workspace top margin. The root's 16px section gap becomes the single separation between header and workspace.
- Keep the publisher role indicator, Return to library, and Add PDFs together as an 8px action group. Add PDFs remains the single filled primary action.

## Workspace and Navigation

- Preserve the 190px rail plus flexible content grid at desktop widths.
- Keep the workspace as one bordered operational pane with no drop shadow.
- Remove the toolbar blur and translucent glass treatment. Use an opaque neutral surface with a 1px bottom divider.
- Replace the rail's colored side stripe and gradient with a full selected-state border, subtle accent background, and restrained inset accent outline.
- Keep all section counts and the Documents, Uploads, Trash, Audit order unchanged.
- Preserve the existing row-list structure; do not convert content into cards.

## Controls and Density

- Use Relay's 2px control radius consistently for inputs, selects, buttons, count badges, role indicators, and status labels.
- Use 40px search and category controls, 8px gaps inside control groups, and 16px between major toolbar groups.
- Use `var(--space-3) var(--space-4)` toolbar padding on the flat toolbar surface.
- Compact standard document rows to an 84px minimum height with `var(--space-3) var(--space-4)` padding and `var(--space-4)` column gaps.
- Use `var(--text-sm)` for document identity headings while keeping metadata secondary.
- Present repeated Trash, Cancel, and Delete permanently entry actions as outlined danger controls so they do not form a saturated red column. The final destructive confirmation action remains filled danger.
- Preserve the upload queue as the one earned emphasis surface. Use the accent-subtle background without a gradient, and retain progress, pause, resume, retry, cancel, publish, and replace states.

## Responsive Behavior

- At the existing 1100px breakpoint, convert the management rail into readable horizontal section tabs while preserving all four full labels and 44px minimum targets.
- At the existing 820px breakpoint, stack the page header and toolbar, change rows and editors to one column, and disable toolbar stickiness so stacked controls do not consume the viewport while scrolling.
- At the existing 560px Knowledge breakpoint, keep full Documents, Uploads, Trash, and Audit labels in a horizontally scrollable tab row. Do not reduce them to ambiguous D/U/T/A initials.
- The privileged pairing grid becomes a full-width single column at the narrow breakpoint.
- No supported width may clip the account selector, pairing button, management controls, row actions, or section labels.

## Functional Boundaries

- Do not change `useKnowledgeManagement`, IPC calls, PocketBase data, upload orchestration, permissions, role checks, session behavior, or audit behavior.
- Do not add, remove, rename, or reorder management actions.
- Do not change document counts, cursor pagination, filtering, category rename behavior, replace behavior, trash recovery, or permanent-delete confirmation.
- Do not alter the Wiki reader, continuous-scroll PDF controls, Contacts, Servers, Status, or Problems.
- Do not add explanatory mockup-only copy to production.

## Verification

- Add a failing style regression for the pairing action grid that rejects the current 420px flex minimum and requires bounded shrinkable columns plus the one-column narrow layout.
- Add failing Wiki Management style regressions covering the shared shell spacing, flat workspace treatment, 2px controls, compact document rows, flat selected rail state, and readable narrow section tabs.
- Keep the existing component tests for Documents, Uploads, Trash, Audit, publishing, replacement, upload recovery, restoration, and deletion passing unchanged.
- Run the focused privileged-access and Knowledge Management tests first, then typecheck, lint, formatting checks, the renderer suite, and a production build.
- Re-run the Impeccable layout detector and manually account for every remaining off-scale spacing value in the touched selectors.
- Verify the running Electron app at desktop and narrow widths across Documents, Uploads, Trash, Audit, and Settings > Access. Confirm that the dropdown stays inside its card and that no toolbar, row action, or navigation label clips or overlaps.

## Acceptance Criteria

- The workstation-owner dropdown and Create pairing code button remain fully contained at every supported width.
- Wiki Management reads as a sibling of Status and Problems: flat surfaces, consistent heading rhythm, square controls, clear selection, and operational density.
- Documents, Uploads, Trash, and Audit retain their complete functionality and accessible names.
- Destructive actions remain available and clearly identifiable without dominating every row.
- Responsive layouts preserve readable section names and usable 44px navigation targets.
- No functional, permission, data, or upload behavior changes.
