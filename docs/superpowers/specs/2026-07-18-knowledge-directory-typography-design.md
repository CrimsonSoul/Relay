# Knowledge and Directory Typography Alignment

## Goal

Bring the Knowledge splash, Wiki catalog and management views, Wiki reader chrome, Contacts, and Servers onto Relay's existing dual-distance typography scale. The result must remain readable on a full 1920x1080 55-inch display viewed at distance and in an approximately 960px-wide Relay window on a 24-inch 1080p monitor.

The content remains primary: SOP cover art and PDF pages keep the visual emphasis, while surrounding controls, metadata, and directory information become easier to scan under operational pressure.

## Cause

Relay already defines responsive semantic type tokens in `src/renderer/src/styles/theme.css`, but the affected Knowledge surfaces bypass them with fixed `8px` through `16px` values. Contacts and Servers are especially inconsistent because Knowledge-scoped rules override the larger semantic sizes already present in the shared directory styles.

This pass aligns selectors to the existing scale. It does not enlarge the global tokens or introduce a separate density preference.

## Semantic Scale

Use the existing tokens by information role:

| Role | Token |
| --- | --- |
| Page title | `--text-2xl` |
| Section or sidebar heading | `--text-lg` |
| Group heading, list primary text, or detail identity | `--text-md` |
| Prose, descriptions, and detail values | `--text-base` |
| Search fields, selects, primary toolbar controls, and document titles | `--text-sm` |
| Secondary row text, sidebar modes, and outline entries | `--text-xs` |
| Captions, counts, technical readouts, and uppercase labels | `--text-2xs` |

At an approximately 960px-wide viewport, these tokens resolve to a compact 13px through 28px product scale. At 1920px, they expand to approximately 14px through 38px for distance viewing. Components must use these tokens directly rather than adding new selector-specific `clamp()` values.

## Font and Numeric Treatment

Keep the current application font family unchanged. The repository currently implements IBM Plex Sans even though `docs/DESIGN.md` still names Outfit; resolving that documentation and font-family discrepancy is outside this size pass.

Reserve JetBrains Mono for technical readouts and compact technical marks, including PDF page and zoom status, key-like SOP/QS marks, and code-oriented values. Ordinary categories, dates, document metadata, counts, and navigation labels use the UI family. Numeric values that benefit from alignment use `font-variant-numeric: tabular-nums` without adopting the mono family.

## Knowledge Splash and Navigation

- Use `--text-2xs` for the workspace kicker and destination metadata.
- Use `--text-display` for the splash headline.
- Use `--text-base` for explanatory copy and `--text-lg` for destination titles.
- Use `--text-sm` for destination descriptions and top destination navigation.
- Preserve the square launcher cards, their order, and all navigation behavior.

## Wiki Catalog and Management

- Catalog and management page titles use `--text-2xl`.
- Introductory and instructional prose uses `--text-base` with the existing 65-68ch measure.
- Catalog section headings use `--text-lg`; SOP category headings and other list-primary headings use `--text-md`.
- SOP cover-card titles use `--text-base`; recent-document and cheatsheet row titles use `--text-sm`.
- Search values, select values, and primary management controls use `--text-sm`.
- Counts, dates, filter labels, field labels, and supporting metadata use `--text-2xs`.
- Management rows follow the same semantic mapping so the privileged view does not retain a separate miniature type system.

Cover dimensions, catalog grouping, category editing, filtering, sorting, upload behavior, publishing behavior, and permission behavior remain unchanged.

## Wiki Reader Chrome

- The library title uses `--text-lg`.
- Library mode buttons, search input, document titles, and management action use `--text-sm`.
- Outline entries use `--text-xs`.
- Categories, counts, footer status, and technical metadata use `--text-2xs`.
- The viewer toolbar document title uses `--text-sm`; its current-section label, page status, zoom status, fit control, and view-mode control use `--text-2xs`.
- Empty and error explanatory paragraphs use `--text-base`; loading status and compact placeholder text use `--text-sm`.

Viewer toolbar buttons use a 32px minimum height, while primary management and catalog controls retain their existing 36-40px control height. Existing control grouping and responsive stacking remain intact.

### PDF Boundary

Do not change the PDF canvas, text layer, link layer geometry, PDF-derived font sizing, zoom behavior, fit behavior, continuous-scroll rendering, or document cover art. In particular, the renderer math under `.knowledge-page__text-layer` remains untouched. This pass changes only Relay's reader sidebar, toolbar, controls, placeholders, and states.

## Contacts and Servers

- Match counts, search inputs, selects, and primary toolbar buttons use `--text-sm`.
- Sort labels, compact counts, and uppercase field labels use `--text-2xs`.
- Filter pills use `--text-xs` and a 32px minimum height.
- Contact and server names use `--text-md`.
- Secondary row metadata uses `--text-xs`.
- Detail-panel names use `--text-lg`; titles use `--text-sm`; field values use `--text-base`; field and section labels use `--text-2xs`.

The existing 67px virtual row height remains unchanged because it can accommodate `--text-md` primary text and `--text-xs` metadata. Contact and server rows remain identical in height and internal rhythm.

## Responsive Behavior

Do not add smaller typography overrides around 960px. Preserve the token minimums and recover width structurally:

- The Wiki library remains an overlay drawer below its existing compact breakpoint.
- The Contacts and Servers detail panel disappears at widths of 1024px and below, prioritizing the list at the approximately 960px target.
- Catalog grids continue reducing columns at their existing breakpoints.
- Viewer controls retain their existing compact stacking and wrapping behavior; this pass does not hide additional information or reduce text size.

The compact view may show slightly fewer rows because the type is larger, but it does not remove secondary chrome solely to recover density.

## Accessibility and Interaction

- Preserve browser zoom and 200% reflow behavior.
- Keep the existing visible focus treatment, keyboard order, accessible names, hover states, selected states, and disabled states.
- Maintain at least the existing text-color contrast tiers; do not compensate for larger text by weakening contrast.
- Do not truncate primary names earlier than the existing ellipsis behavior.
- Keep uppercase tracking intentional and limited to genuine labels and eyebrows.

## Verification

Automated regressions will assert that the affected selectors use the approved semantic tokens and that the PDF text-layer sizing remains unchanged. Focused Knowledge, Directory, and Servers tests will run before the complete renderer suite.

The completed implementation must also pass lint, typecheck, production build, formatting, and `git diff --check`. Visual verification will cover:

- 1920x1080 full-width Relay for the 55-inch distance case
- an approximately 960px-wide, 1080px-tall Relay window for the half-monitor case
- Wiki catalog, management, reader sidebar, reader toolbar, Contacts, and Servers
- long contact names, long server names, long document titles, empty states, and active filter states

The Impeccable typography detector is rerun after implementation. A clean detector is treated as a floor; the selector-level visual inspection remains authoritative.

## Acceptance Criteria

- The affected screens no longer look materially smaller than Status, Problems, Alerts, or Compose.
- No readable UI copy in scope remains at fixed 8-12px sizing.
- Primary and secondary hierarchy is immediately distinguishable at both target widths.
- SOP covers and PDF pages remain the visual focus.
- Contacts and Servers retain matched row geometry and usable density.
- No text clips, collides, or becomes inaccessible at the compact target width.
- PDF rendering, Knowledge behavior, directory behavior, permissions, and persistence remain unchanged.
