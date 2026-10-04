# Relay Design Guide

Current visual and interaction conventions for the Relay renderer.

## Overview

Relay uses the **Accent Ink** design language: a softened charcoal canvas,
typography-first hierarchy through IBM Plex Sans weight contrast, and a single swappable
accent color as the only active-state signal. All tokens live in
`src/renderer/src/styles/theme.css`.

## Source Of Truth

| File                                                         | Purpose                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `src/renderer/src/styles/theme.css`                          | Global color, spacing, typography, radius, z-index, and motion tokens  |
| `src/renderer/src/styles/components.css`                     | Shared button, input, shell, and layout styles                         |
| `src/renderer/src/styles/tab-chrome.css`                     | Shared top-level page headers and command rows                         |
| `src/renderer/src/styles/utilities.css`                      | `.ink-rail`, `.card-surface`, and text helpers                         |
| `src/renderer/src/styles/modals.css`                         | Modal layout and overlay styling                                       |
| `src/renderer/src/styles/responsive.css`                     | Breakpoints and responsive behavior                                    |
| `src/renderer/src/styles/animations.css`                     | Reusable animation helpers                                             |
| `src/renderer/src/theme/accent.ts`                           | Accent scheme definitions and runtime API                              |
| `src/renderer/src/tabs/alerts.css`                           | Alert Draft form and preview styles (email preview fenced — see below) |
| `src/renderer/src/tabs/cloud-status.css`                     | Provider summary cards and incident feed styles                        |
| `src/renderer/src/features/knowledge/knowledgeWorkspace.css` | Knowledge launcher and internal destination shell                      |
| `src/renderer/src/features/knowledge/knowledge.css`          | Wiki library, management, and PDF reader                               |

---

## 1. The Accent Ink Language

The design rests on four principles:

1. **Softened charcoal canvas.** App background is `#09090b`. Surfaces step up
   gently (`#111114`, `#19191d`). Elevated floating surfaces sit at `#222227`.
2. **Typography-first hierarchy.** Weight contrast replaces surface contrast. Rare
   display titles use weight 200; body text uses 500; emphasis uses 700, the heaviest bundled
   Plex face — nothing asks for 800 or 900. No heading background fills.
3. **Four text-dimming tiers.** Primary `#eee9ec` -> secondary `#beb6bb` ->
   tertiary `#a39ba1` -> quaternary `#9a9298`. Quaternary is the legibility floor
   (>= 4.5 : 1 on every surface up to `#222227`, including 12 % accent/alarm tints);
   do not use a lighter shade for readable text, and never fade readable text with opacity.
4. **1 px `#2b292e` dividers, edge-rails over boxes.** Horizontal rules and the
   `.ink-rail` left-border replace boxy card outlines wherever content allows.

---

## 2. Heading Hierarchy

Each tab's H1 names the page and the app header carries no breadcrumb: Knowledge's sub-navigation
marks its current destination with `aria-current="page"`, so a header trail would only repeat it.
The header keeps its `Application navigation` landmark. The header clock is neutral text; accent
is reserved for focus, selection, the primary action and the active nav item.
Type labels, mono identities, chevrons, glyphs and other decorative metadata use secondary
or tertiary ink, never accent; links and selected states keep it. Error copy and error-state
recovery actions use `--alarm-bright`, so an error never changes hue with the accent preference.
The app header is a three-track grid (title, search, actions) whose outer tracks share the free
space; the title track stays empty, so the Search Relay field sits centred at the same x on every
tab. Sidebar labels are not case-transformed: they read in Title Case like the
H1s; only the `relay.` wordmark is lowercase. Command labels (buttons, menu items, command
disclosures such as `Ticket Actions`) use Title Case; field labels stay sentence case.
Dialog titles are headings, not commands, so they use sentence case (`Delete contact`, `Rename team`)
even when the button that opens or confirms them reads in Title Case.
The header's Help and Notifications are quiet chrome, never ranked with page commands: `TactileButton`
`sm` ghost with `.header-action`, icon-only 36 px squares (16 px icon, no visible label, outline or
fill; secondary ink that lifts to primary on hover). Their names live in the accessible name and
Tooltip (`Help · <shortcut>`, `Notifications`). Unread notices lift the Notifications trigger to
primary ink (`.has-unread`) and add its outlined `.count-badge` beside the bell; only that count,
a pause state or a warning diamond widens it. The world clock follows: reference
information, `--text-sm` secondary-ink time with tabular figures over a `--text-2xs` tertiary
zone/date line.
Pane headings use `.toolbar-title`: a sentence-case, `--text-xs`, semibold, secondary-ink title
with normal tracking, like Compose's Groups and Recipients pane titles.

**No eyebrows, no all caps.** A heading carries its own weight: there is never a kicker or category
label above a heading, title or nav item; if a kicker carried information, it moves into the
heading or the first words of the description. Labels, pane titles, field labels, table headers,
nav labels and role/status chips are sentence case with normal tracking, and source strings are
written in that case rather than transformed. Caps remain only for alert severity vocabulary
(ISSUE / MAINTENANCE / INFO / RESOLVED) in the severity selector and history chips, the exported
email card, acronyms, monogram initials, key caps and machine codes such as pairing codes.
Middle dots separate data inside dense rows and status readouts (`@ryan · Active`,
`Saved copy · Read only`); they never join words in page qualifiers, headings or labels.

The giant lowercase treatment with an accent period belongs to the `relay.` sidebar
wordmark and is not the default for tabs or panes. `.collapsible-header-title`
retains that older styling for compatibility, but new surfaces should use the H1
and pane-title hierarchy unless a design explicitly calls for a standalone
display title.

### Top-level tab chrome

Compose is the visual reference for the seven top-level operational destinations. Each uses a
three-band frame: `.tab-page-header`, an optional named `.tab-command-bar`, and the working canvas.
`TabPageHeader`, `TabCommandBar`, and `TabCommandGroup` own this shared structure; tab styles remain
responsible for their domain content.
The page header is one compact line. Each screen has one name: the heading is the nav label in
Title Case (Compose, Alerts, On-Call, Knowledge, Status, Problems, Radar, Tickets, Settings; Knowledge
sub-destinations use their own name, e.g. Wiki). The H1 is the page's only name,
so there is no eyebrow above the heading. Every top-level page carries one short factual source or
scope qualifier ("Bridge recipients", "Compose and export", "Team coverage", "Wiki, contacts,
servers", "External providers", "Dynatrace NOC response", "CW Dashboard", "SDP work account",
"Relay and this workstation") beside the `--text-lg` heading as a quiet tertiary
`.tab-page-header__subtitle`, never as a second name. **Empty states** use one
composition, the `EmptyState` component (`.empty-state` in `components-layout.css`). It sits inline
and left-aligned where the content would be, with an optional neutral 24 px line glyph beside
the copy. The title is `--text-xl` primary ink and the description is tertiary. The next step
follows. It is never a centred bordered card, an icon tile or an eyebrow. **Empty-state primary
rule:** the accent appears on at most one action, and only when it is the surface's own task and
the user can do it. Wiki publishers get `Add PDF Guides` (it opens Manage Wiki straight into the
PDF picker) with `Manage Wiki` and `Search Relay` as secondaries; Compose's empty recipient list
gets `Search Relay ⌘K`, because adding recipients is Compose's task. A user who cannot do the
surface's task gets no primary, only quiet secondary navigation: Wiki readers see `Search Relay`,
`Find an Owner in Contacts` and `Look Up Server Support`, and Knowledge Home's empty Wiki card
offers a secondary `Find an Owner in Contacts`. Actions sit on one row at ≥1366 px (the
`.empty-state` measure is 880 px while the description keeps 620 px) and wrap only when the
viewport is narrower. Compose's empty
recipient list uses the same component with a people glyph: `Search Relay ⌘K` is the only action
and the only place the empty state says "Search Relay", so the sentence adds only what is new ("You can also type
or paste email addresses into search.", or the group list when groups exist) and leaves `History`
to the visible command bar; on-call quick adds (with `Add All On Call (N)` when more than
one is missing) follow below. Filtered list empties (Contacts, Servers) offer `Show All Contacts` /
`Show All Servers`. A no-data list names its header command instead of duplicating it.

- Page metadata uses the UI font, tabular numerals, and a text label whenever color communicates
  status. Live state uses the shared unboxed `.tab-page-status` treatment: an 8 px semantic dot
  beside the text label. Metadata may wrap below the title at constrained widths but must never
  overlap it.
- Utility commands belong in the left group and use a 36 px control height. Workflow commands
  belong in the right group and use a 40 px control height. Toolbars keep both groups on one row
  while their content fits, then wrap without changing DOM or keyboard order. The compact layout
  makes each group full width only at 720 px and below.
- Command labels use Title Case. A view has at most one filled primary action, so a command row
  never adds a second one beside a pane's primary; supporting, creation and reversible actions
  remain secondary or icon-only with an accessible name. On Contacts the filled action is the
  detail pane's `Add to Bridge`, so the header `Add Contact` is bordered secondary, and Servers'
  `Add Server` matches it because both pages share the directory chrome.
- Knowledge has no top-level commands, so it renders no empty command row.
- This contract applies only to the outer tab frame. Nested pane, editor, table, PDF, filter, and
  other domain-specific toolbars retain their own interaction and density rules.
- Every page root pads its sides by `--page-gutter-x` (24 px; 16 px where a narrow query
  tightens it), and the footer `StatusBar` cancels that with negative inline margins. The footer
  therefore spans the page edge to edge and its 24 px text inset lines up with the page title on
  every surface, whether the root is padded (Compose, Alerts, Problems, Status, On-Call,
  Settings) or unpadded (Radar, the Knowledge panels). A new padded root sets the variable.
- Settings uses the same one-line `TabPageHeader` (an h1 "Settings"); it has no stacked title or
  subtitle. Its bordered panel stops at 1440 px rather
  than spanning a 4K canvas, Relay Data lays its two sections side by side from 1600 px, and the
  page has no bottom padding so its status bar sits on the window edge like every other tab.
- Section and queue tabs share one `.tab-strip` / `.tab-strip__tab` treatment: neutral
  `--text-sm` semibold labels on a 1 px baseline, a 3 px accent underline and primary text on the
  selected item, and an optional plain tabular `.tab-strip__count` (never a filled chip). It
  covers Settings sections, Data Manager sections, Knowledge destinations, Problems queue filters,
  SDP queues and ticket tabs, and Notification sections. Each strip keeps its own semantics
  (`tablist`/`aria-selected`, `nav`/`aria-current`, or a fieldset of `aria-pressed` filters); the
  selected style keys off those attributes, not a modifier class. Disabled tabs drop to tertiary
  text without fading.

### Compact Compose groups

At 1120 px and below, Compose stacks a labelled **Choose groups** disclosure above recipients.
The selected-group count and **New Group** remain visible while collapsed. New Group is the only
control that creates a group; the empty groups pane names it rather than adding a second button.
Expanding reveals full group names, contact counts and selection state in a bounded scrolling list,
not initials alone. The same group controls and context actions are retained at desktop size and
browser zoom.

### Bridge vocabulary and on-call handoff

The feature noun is **Bridge**: Compose builds the bridge, contact actions say `Add to Bridge`, and
page titles follow the nav labels (Compose, Alerts), so "composer" never names two tabs. The nav
id and label stay `compose`. Compose offers on-call people (resolved to a unique directory email)
until each is a recipient: a grid in the empty state, one horizontally scrolling strip above a
non-empty list, plus `Add All On Call (N)`. On-Call's `Add to Bridge` sits beside Copy All, adds
every resolvable on-call person and opens Compose. Each row says its role once, never both a word
and a code: rows at least `13em` wide print the full role after the name in secondary ink at the
board's secondary size (`Grace Hopper · Secondary`), except the primary tier, whose role word is
a solid primary-ink chip (`Grace Hopper [Primary]`) so primaries stand out at a glance; narrower
rows swap it for the fixed-width code PRI (primary tier), BKP (Backup, Secondary,
Standby, Escalation, Weekend) or MEM (others), which is focusable and shows the full role in a
Tooltip. Compose suggestions show the role word only. Rows carry no tier tint (a band reads as
selection); the one row tint is "on call now": a row whose time window covers the current time
(`24/7`, `06:00–18:00`, overnight `18:00–06:00`; hyphen, en dash, em dash, `to` or `through`)
takes the accent rail, a 14% accent wash, a static accent dot after the name and a solid accent
`Active now` pill beside its window. A window that names a US zone (`ET`, `CT`, `MT`, `PT` and
their standard, daylight and spelled-out forms, or `UTC`/`GMT`) is judged by that zone's clock;
an unnamed one by local time. The board shows each window in 12-hour local time with the zone
word dropped (`06:00–18:00 ET` reads `5 AM – 5 PM` in Central), and its Tooltip keeps the saved
text (`Saved as 06:00–18:00 ET`). The saved text is never rewritten; Copy All and Export keep it,
and bare-hour ranges such as `9-5` show as typed. The codes are defined by their own Tooltip and the `PRI / BKP / MEM` Help glossary
entry; there is no toolbar `?`, because wide rows show words and a link there would explain chips
that are not on screen. `No coverage` is defined in the Help glossary, with no inline link.
Compose's `On call now`
lists every uncovered team first
(`<Team> — no coverage`, alarm rail) with an `Assign On-Call` button that opens On-Call: the same
small bordered secondary button (with `+`) as the On-Call board's vacant card. Once the bridge
has recipients, `On call now` collapses to a one-row strip inset to the pane header's 16 px; when
its cards overflow it scrolls sideways and fades the edge that has more cards. Role
codes are neutral ink, never accent or status hues: PRI is a solid primary-ink fill, BKP a
primary-ink outline, MEM a faint outline. The healthy team badge (`N active`) is neutral too, so
a status hue on a card always means something to fix. Identity colours skip any palette entry
within 20° of the active accent's hue. An on-call row with no saved number but a
name matching exactly one directory contact shows that contact's number marked `from Contacts`
on its own line under the number, so the marker never widens the phone column; `Needs contact`
means no number from either source. Name and phone share a line only while both fit at their
natural width; otherwise the phone wraps under the name, and a row narrower than `17em` of the
zoomed name size stacks them with the phone aligned to the name. Names wrap only at spaces, never
inside a word, and the role code never shrinks under a name; a single word wider than the row
ellipsizes behind the full-name Tooltip. The card's `···` button names
its menu (`<team> Team Actions: …`, Tooltip `Team Actions: … · Shift+F10`; items `Edit Team`,
`Rename Team`, `Remove Team`); an uncovered team offers `Assign On-Call` (on a narrow card it wraps
below a one-line "No coverage" rather than clipping at the card edge), and the header offers
`Add Team`. Weekly reminders are a
`role="status"` line with a separate `Dismiss reminder: <label>` button. The
team-order toggle is labelled by its action: `Lock Order` / `Unlock Order`; its padlock shows the
state that action produces (closed on `Lock Order`, open on `Unlock Order`) so glyph and words agree.

Compose's utility group is History (secondary) and `Clear Bridge` (ghost, Tooltip `Clear groups
and recipients`). Clear Bridge empties groups, manual adds and removes at once and shows
`Cleared the bridge (N recipients)` with **Undo**, which restores all three. While the bridge is
empty, Copy Recipients, New Teams Bridge and More Compose Actions are disabled; the reason
(`Add recipients first`, or Copy's own `Add recipients to copy` / `Fix invalid recipient addresses
to copy`) is the button's hover tooltip and its sr-only `aria-describedby`, never text printed
beside the actions. The recipients empty state already says the bridge is empty. Bridge actions
have tab-scoped shortcuts: Compose Cmd/Ctrl+Shift+C Copy Recipients and Cmd/Ctrl+Shift+M New
Teams Bridge; On-Call Cmd/Ctrl+Shift+C Copy All and Cmd/Ctrl+Shift+B Add to Bridge (Relay Web:
Alt+Shift with the same letter). Each of those buttons shows its keycap as a trailing
`.tab-command-kbd` (`aria-hidden`, tertiary ink; on a filled primary the button's solid ink, never
faded with opacity), tooltips end `· <keycap>` and buttons carry the
matching `aria-keyshortcuts`; editable fields and open dialogs suppress them. With no recipients, Compose's
Sort By select, direction button and label render disabled.

### Installation vocabulary

UI copy uses one noun per installation role. The host install is the **Relay server** (setup role
tag `Relay Server`; the Settings mode readout is the glossary term `Embedded Server`). A desktop
connected to it is a **Relay client** (setup tag and Settings mode `Relay Client`). A browser
connected to it is a **Relay Web** session. The local machine is **this workstation**. Copy never
says "station", "primary station" or "remote station". The sidebar `clients` count covers both
Relay clients and Relay Web sessions, and its tooltip says so. Code identifiers, config keys and
stored mode values (`server`/`client`) are unchanged.

### Service Status provider rows

Service Status remains an operational coverage list, not a generic vendor dashboard. Its overview
keeps one scannable row per operator-facing provider, ordered by outage, unknown, degraded, then
operational. Juniper Mist is one row even though the server retains four regional buckets for
compatibility; Dropbox, Dynatrace, Proofpoint, and CrowdStrike are also one row each. The summary
readout, keyboard order, and status bar follow the displayed provider list rather than the raw
storage bucket count. The summary ("1 active outage · 2 degraded issues across N monitored
providers", with its posture pip) is the page's status readout in the header
metadata slot, where Radar shows its status word; it is not a separate band above the rows. The
provider count appears once, there; Refresh is the labelled secondary button in the `Status
actions` command bar, and the status bar shows only the shared connection state, never a repeat of
the summary counts. Problem provider tiles sit in equal-width columns (2, 3 from 1600 px, 4 from
2200 px); a trailing tile that would leave empty cells spans the rest of its row, so the grid never
shows an orphan cell and every Outage and Degraded label still sits at the same inset from its
tile's end, lining up with the right-hand column. The status bar likewise shows only the
connection state on Problems (the Unaddressed count is on the filter tab and the sidebar), while
Directory and Servers keep their unique "Showing N of M" filter readout and On-Call its team count.

**Freshness rule (Status, Problems, Radar).** Every live-data page has exactly one Refresh, in its
command bar, and the freshness readout sits directly after it in the same command group. Both lead
the command bar on all three pages (Problems' view strip and search follow them), and each Refresh
is the same icon + text button. The readout is the shared `TabFreshness` component
(`components/TabFreshness.tsx`, class `.tab-freshness`): clock time via `formatOpsTime`
("Updated 4:16 PM"), never a relative age, plus " · may be stale" in warning ink
(`.tab-freshness--stale`) when the data may no longer describe its source — Status past two missed
refreshes, Radar while its refresh fails or sign-in is required, Problems while sync is off or
failed. It is focusable like Problems' `ExactTime` and named by its visible readout (no `aria-label` on the role-less `<time>`); its Tooltip gives the exact date and time and the age, read when it opens
("Last successful sync Sat, Oct 3, 2026, 4:16:02 PM CDT · 3m ago"). The readout is not a live
region, so polls never announce a new time; Status announces only the move to and from stale
through one sr-only `<output>`, as Radar announces its status. Failure
notices and the Radar unavailable block never carry their own Refresh and never hide the command
bar's; they say "Use Refresh above". "Get fresh data" is called Refresh on all three pages, and
every Refresh says `Refreshing…` while it runs; its accessible name starts with the visible word
(`Refresh cloud status` / `Refreshing… cloud status`, `Refresh Radar` / `Refreshing… Radar`) so
the label stays in the name while busy. Problems says `Sync Now` only when its click requests a
Dynatrace sync (Relay server with sync on; busy label `Syncing…`); otherwise it is `Refresh`, which
reloads Relay's copy of Dynatrace problems. Problems' freshness is the last successful sync; the
queue's sync line says only whether the queue is live.
Posture labels use one case (Outage, Degraded, Unknown, Operational); colour, weight and pip shape
carry the urgency. Provider pips use one shape grammar, shared with the sidebar Status pip: filled
square = outage, diamond = degraded, filled circle = operational, hollow ring = unknown or no data.
The sidebar pip is derived from the app-wide cloud status data and announces per-provider counts
("1 provider outage · 2 degraded"). When Dynatrace sync is off, failed or retrying the sidebar
Problems pip gains a slashed-ring stale mark (the failing feed's shape) on the label line; the
accessible name and tooltip say "not syncing" — the same noun as the Problems banner ("Dynatrace
isn't syncing") and its `Not syncing` help term — and why, and that the count is Relay's saved copy.

Search Relay (⌘K) is the console's command line. Besides navigation, people, groups, servers and
Wiki pages it indexes open in-scope Dynatrace problems by display ID and title (shared from the
notification manager's subscription; selecting one opens Problems with it selected), on-call
teams by name (subtitle names who is on call, or `No coverage`; selecting opens On-Call), and tab
commands in Title Case with the button's exact wording: `Copy All On-Call Info`, `Add All On Call
to Bridge`, `Clear Bridge`, `Reset Alert`, `Open Help`. A tab command switches to its tab and runs
the tab's own handler through `requestTabCommand` / `useTabCommandRequests`
(`hooks/useTabCommandShortcuts.ts`), so its disabled reasons and Undo toasts stay the tab's; a
disabled command just lands on the tab. Typed queries cap at 15 results; the empty-query list
shows every command. SDP tickets are not indexed: ticket data lives only inside Tickets.

Help (`ShortcutsModal`) has a filter across shortcuts, How to tasks and Relay terms, and uses the
UI's exact command wording (`Lock Order`, `Mark Addressed in Relay`, `Search Relay`). The header
Help button and Cmd/Ctrl+Shift+/ open it scoped to the active tab's shortcuts, tasks and terms
(`Showing help for <tab>` with `Show All`); typing a filter searches everything. No surface
carries an inline help link, `?` glyph, legend link or `What's this?` beside a state, readout,
heading or sentence; terms such as `Status pips`, `XCenter`, `No coverage`, `Not syncing`, `NOC
response`, the NOC / SOX / Unassigned queues, `Saved copy · Read only`, `Confirm Live Change`,
`Embedded Server` and `Signal Red` live in the Help glossary, reached from the header Help button
or its filter.

Appearance prints no note or caution under the accent picker, whichever accent is chosen: Relay
tells alarms from the accent by shape, not hue (the `Signal Red` glossary term in Help holds the
rationale), so no accent needs a warning. While Auto accent schedule is off, the
Day/Swing/Night selects are disabled (the solid disabled field style) and carry an sr-only
`aria-describedby` reason, "Turn on Auto accent schedule to choose accents"; the switch sits beside
them, so there is no visible label or tooltip. The custom accent's Save stays enabled: pressed with
an empty or invalid hex value it saves nothing, focuses the hex field and shows its `role="alert"`
error ("Enter a 3 or 6 digit hex color."); an empty field is flagged only after that attempt. The swatch
previews only a valid draft; empty or invalid input shows a neutral dashed empty well. The hex
field's placeholder is the format `#rrggbb` in `--color-text-quaternary` ink, never a colour that
could read as already set, and `Preview only. <hex> is not the current accent…`
appears only for a valid draft that is not the current accent.
The Settings tab rule and bordered workspace span the full page width like the shell header and
status bar; `--settings-workspace-max-width` (1440 px) is the content measure inside each
section (section dividers stay full width), and form tabs still cap a column at 640 px.
The Dynatrace Dashboard URL field has an example
placeholder (`https://abc12345.live.dynatrace.com/ui/apps/dynatrace.dashboards/…`),
`inputMode="url"`, and a `.dynatrace-dashboard-hint` line (`#dynatrace-dashboard-url-hint`, "Must
be an HTTPS address under dynatrace.com…") that is always in the field's `aria-describedby`.
Each dashboard field validates inline: a value that can never be saved (an unsafe URL, a
blank-only name) shows as it is typed, and an empty field shows once it loses focus, as a
`.field-error` (`role="alert"`) directly under the field that sets `aria-invalid` and joins its
`aria-describedby`, as `Input` does. Add/Save Dashboard stays enabled (disabled only while saving):
pressed with missing or invalid input it saves nothing, reveals both fields' inline errors and
focuses the first offending field, name before URL.

Selecting Juniper Mist uses the existing provider-detail workspace with compact `All`, `Global`,
`EMEA`, `APAC`, and `Federal` filters. Each filter includes accessible posture text. `All` is the
default and deduplicates incidents shared by multiple regions; an `Affected` line lists the union of
published regions. Selecting a region filters those incidents and uses that region's own outage,
unknown, degraded, or operational posture. Dynatrace uses the same `Affected` treatment for its
cloud and region containers. Affected scopes are text, not color-only signals or a new card layer.

CrowdStrike is visibly marked `Third-party` in its overview row and detail workspace because its
automated signal comes from StatusGator rather than CrowdStrike. The source action says
`StatusGator`; a separate `Official Support` action goes to CrowdStrike. Incident actions say
`View StatusGator Report` and must not imply official confirmation. Downdetector remains a manual
secondary link, never an automated health input.

An active outage outranks feed uncertainty in the visible posture. Feed uncertainty outranks a
retained degradation, so an old warning cannot be presented as current after a failed refresh. With
no active outage, an unavailable or incomplete feed reads Unknown and retains any last-good detail
without implying it is current. Dropbox, Juniper Mist, Dynatrace, Proofpoint, and CrowdStrike use
the same row geometry, focus return, responsive behavior, and accessible status text as every other
provider; the regional filter introduces no modal or nested navigation.

Workflow actions state only outcomes Relay can observe. Compose's `New Teams Bridge` action may say
it opened a prefilled Teams bridge form or copied recipients, but not that Teams created or sent a
bridge. Alerts follows the same rule for Outlook and downloaded drafts. Destructive and externally
consequential actions retain confirmation or review steps owned by their feature.

Deleting a contact or server, or removing an On-Call team, keeps its confirm (it names the exact
record, since names repeat), then hides the row or card at once and shows a notice with **Undo**
(`Deleted …`, or `Removed <team> (N members)` for a team). The delete is written only when that
notice leaves without Undo (timeout, Dismiss) or the owning tab unmounts; Undo inside the window
writes nothing and the card keeps its board position. Undo after the tab closed re-creates the
team in its old board slot. A rejected write brings the row or card back with an error toast
that says why. While a team card is hidden, drag reorder maps visible positions onto the full
saved order, so the hidden card keeps its slot. Toasts that own a pending commit use the
`onDismiss` option rather than a parallel timer, so hover-pause extends the undo window. Confirm
copy reads "You can undo this from the notice that follows.", never "cannot be undone".

On-Call toasts follow `formatFailure`: what failed (naming the team), the cause when Relay knows
it, what happened to the board, and the next step. Retry appears only where repeating the action
is safe (rename, lock toggle, copy, export, and a failed remove, which re-offers Undo). Successes
name what changed: `Copied 3 teams (4 people)`, `Moved Alpha to position 2 of 5`.

---

### Global notifications

The app header exposes one **Notifications** entry across tabs, with an unread count in the shared
neutral `.count-badge` pill. Its Inbox
filters Tickets, Problems, Radar and Status without separate notification surfaces in each workspace.
Rows show a text severity label, source, time, title and summary; opening an entry marks it read and navigates to its target.
Mark-read and clear both follow the active source filter. **Undo Clear** restores the latest user-cleared
batch in session, retaining read state without replaying banners, sounds or desktop notices. New arrivals
are retained within the 200-entry bound. Account resets and sign-out purge ticket entries from Undo too.
Ticket alerts open the ticket in Relay. An active ticket draft delays that navigation until the draft
is finished or explicitly discarded. The inbox is session-only and bounded to 200 entries.

Preferences groups shared banners, desktop delivery and sound, with per-source options collapsed
under labelled disclosures. Quiet hours has an explicit enable toggle that retains its times while off;
existing saved schedules retain their behavior. The header shows **Snoozed** or **Quiet hours** while
interruptions are paused, even when the inbox is closed, and updates as the pause expires.
Quiet hours and snooze silence interruptions while preserving matching inbox entries. Each source
has its own enable control; Problems, Radar and Status can filter information, warning and error
levels and choose sound. Existing ticket event/condition/channel rules remain opt-in beneath Ticket
rules. Ticket monitoring runs across tabs while Relay is running and the account is connected.
Browser clients show supported sources and inbox controls, with desktop-only delivery disabled.
Colors, dividers, text hierarchy and controls use Relay's existing design tokens.

### Tickets workspace

Tickets uses the shared header and command bar with separate NOC, SOX and Unassigned queues;
Unassigned means no support group. It contains no synthetic workspace, sample loader, demo
problem links or demo bridge controls. Clear SDP data is visible only in unpackaged testing.
Before connection, a **Connect Work Account** action opens the existing account panel; unusable
queue filters, table, pagination and workflow commands are deferred. Loading, expired-session,
administrator-setup and desktop-only states remain explicit. Loaded outage copies and active drafts
retain the workspace rather than being hidden by the connection prompt.
Live tickets open beside the queue in a split workspace, with Conversations first. A narrower
screen shows the ticket in place of the queue. The editor follows SDP's template sections, real dropdown
choices, dependent assignments and custom fields in Relay controls. Queue search and filters are
sent to SDP and cover the whole queue, not only the loaded page; Status, Priority and Technician
offer SDP's choices. A changed but unapplied filter shows **Not applied**, and an applied filter is
identified beside the result count. Email replies show recipients
and message in a distinct review before sending. Drafts stay in memory, survive queue polling,
and require an explicit discard before closing. Queue rows and the ticket header show the last
message sender, role and time, plus a distinct unread-reply indicator. A new reply offers Load latest
reply; it never replaces an active draft. Pending and unavailable reply checks are explicit rather
than presented as an empty conversation. Reply is selectable in notification rules.

The queue uses a compact one-line table: ticket number and subject, priority (P1/P2 tints plus the
priority name), status, technician (**No technician** when unassigned), last reply and due time.
Long text truncates with the full value on hover. Due reads relative to now, such as **Due in 3h**
or **Overdue 2d**, with the exact date in a Tooltip (focusable in the ticket workspace); overdue and due-soon states carry words, not only
color. Row checkboxes keep their visible size but have a 36 px hit area. An unboxed summary reports
actual status and unread-reply counts on the loaded page and stays visible beside an open ticket
when there is room. Selecting a ticket narrows the queue and opens a conversation workspace with a
prominent Reply action. The conversation keeps the original request collapsed and recent messages visible;
automatic notifications are excluded by default, with a Show automatic notifications checkbox.
Description opens the full original request, and Notes remains a separate section. Reply drafts
open inline below that context. The ticket header and inspector stay in place while the thread and
drafts scroll beneath them. History has its own
pagination and readable before/after values. Work includes checklists, checklist answers and
personal reminders alongside tasks, worklogs and approvals. Checklist choices are searchable by
name; reminder dates use local date/time controls.

Ticket edit, creation, resolution and bulk-update forms use SDP dropdowns for support group,
technician, status, priority, request type, category, impact and urgency wherever those fields are
present. Choices support search and pagination. Changing the support group clears a selected
technician and scopes subsequent technician choices to that group. Loading failures offer a retry
without substituting a free-text assignment field.

Queue selection is separate from opening a ticket. Select Page selects at most 20 current rows;
Update selected opens a review listing every target and changed field. Per-ticket outcomes remain
visible after submission, including stopped and uncertain results. Forward appears in the ticket
header and on individual messages; its inline draft starts with no recipients and private
visibility. It follows the same explicit email review and draft-preservation rules as Reply.

Ticket properties occupy a right inspector when the detail pane has room,
and a compact strip above the thread at smaller sizes. Narrow workspaces replace the queue with
the ticket in place and hide queue filters; Back to Queue restores the queue and keyboard focus to its row. Charcoal surfaces,
accent selection rails, small square author markers and restrained dividers follow Accent Ink.
Compact ticket controls use the `sm` (36 px) button, 2 px corners and visible accent focus outlines. Workflow
commands and form submission buttons use the default `md` (40 px) button. Queue filters, editor lookups and ticket dialogs use the
same dropdown styling. Supporting browsers render a themed native picker with bounded scrolling,
selected-option checks and wrapped long labels; other browsers retain their native picker and
keyboard behavior. Multi-select fields retain native list selection. Filled buttons identify the
next primary action; reset, cancel and monitoring utilities use quieter ghost buttons.
Reply, Edit Ticket and Add Note stay together in the ticket header; More Actions exposes Forward,
Prepare Incident Bridge, Resolve, Refresh and Open in SDP through the shared keyboard-accessible menu.
The six ticket sections are Conversation, Notes, Work, Attachments, Related and Details, presented as
keyboard tabs (arrow keys, Home and End) that stay usable while a draft is open. Conversation
contains the original request and messages; Details groups Properties, Resolution and History as a
second tab row. Notes are labelled **Internal note**; conversation messages carry no sender-role
label because SDP's conversation data does not include one. Forward Message is offered on
conversation messages, never on private notes.
Related separates Dynatrace problems from SDP ticket relationships. Existing links stay visible;
a failed linked-ticket load offers Try Again. Manual problem linking and ticket link/merge searches
open on demand. Merge labels name the surviving
ticket and retain the explicit review/confirmation step. Pagination belongs inside the
queue; activity paging reads **Newer Activity** and **Older Activity**, and single-page
conversations omit it. In the editor, Cancel (or Discard Draft) sits in the footer beside the
review action. The app header provides the shared Notifications inbox and preferences.
Keyboard shortcuts, listed in the Shortcuts dialog: J and K move through queue rows (opening the
next ticket when one is open), R replies to the open ticket and Escape returns to the queue. They
are ignored while typing, in dialogs and while a request is in progress.
Routine explanatory text stays behind How monitoring works; live sync is a compact label with
its exact sync and saved-copy expiry times in a focusable Tooltip. A failed refresh or status check keeps the last loaded tickets visible and
changes the label to **Not updated since <time> · Retrying** with an explanatory note; tickets are
removed only when SDP reports the session expired or disconnected, or the saved copy expires.
A Relay outage copy reads **SDP unavailable · Saved copy · Read only**. Delayed ticket monitoring flags the global Notifications button; Preferences shows monitoring status and pause controls.
Read-only states, errors and change confirmations remain explicit. Every ticket workflow message
(change, bulk, resource, attachment, relationship, editor and SDP server settings) goes through
the shared `SdpMessage`, which takes a tone: an error — including every uncertain live-write
result ("The result is uncertain… Relay will not retry") and a failed status check — renders in
the error grammar with `role="alert"` (`.panel-error.ink-rail.ink-rail--alarm` at dialog or panel
level, `.field-error` beside a control, such as a choice lookup failure), never tertiary note
ink; info copy (a confirmed change, a saved file, bridge context copied) goes to a persistent
`.ticket-mode-note` `<output>` that stays mounted, empty when idle. Server-authored queue
messages carry no tone and stay in that output. Task, worklog and approval controls use
native Relay forms and explicit review/confirmation. Attachment upload reviews the filename and
size before sending; downloads use the desktop Save dialog. Attachment rows show a wrapping filename,
file size and a compact Save File action. Add attachment opens the file picker; read-only states and
size limits are explained beside the controls. Buttons pair labels with consistent stroke icons.
Problems and Tickets use matching dropdown chevrons and full-width disclosure rows with visible
expanded states, keyboard focus and a minimum 40 px height. No external content mounts inside Relay.

The account panel contains work sign-in controls. Queue monitoring starts after work sign-in, offers a pause control, and shows coverage/backoff
status alongside a session-only notification inbox. The coverage line (ticket count and check
time, or the backoff reason with its next check time) is plain visible text, outside any live
region; a separate sr-only `<output>` announces only monitoring state changes (starting, Monitoring
queues, paused, off, backoff reason, reconnecting, linking failure), so a 30-second check never
re-announces a clock time. Queue rows refresh without blocking ticket
inspection or discarding drafts; alert rules remain opt-in. Safe description tables keep labels beside values, source spacing/styles
are discarded, and long bodies wrap. Errors never look like empty history. At narrow widths,
forms stack and ticket content scrolls within the available workspace. Bridge actions use Relay's
existing composer and bridge links; no bridge is created automatically.

Problem details lead with identity, impact and the NOC response composer, then the workflow
description, then one bordered list of single-line context rows:
**SDP tickets** (verified links stay visible; Ticket Actions opens inline from the same row), **Possible
changes** and Systems affected. Every row label starts at the same inset and every disclosure chevron
sits on the row's trailing edge. Ticket creation and manual-link guidance sit under Ticket Actions.
An unavailable changes check is one muted tertiary line with nothing to disclose, "Changes
unavailable:" plus the reason or fix (for example "connect your SDP work account"), followed by the
next step (Connect in Tickets or Retry) as a link-style button, so it never competes with the response
form. Otherwise Possible changes shows the match count or partial state;
opening a match reveals evidence, scheduled timing and review actions. “Systems & time match” and
“Possible match” describe correlation; “Mark Relevant” is a view-session decision, never an SDP write
or confirmation of cause. Refresh and detailed errors remain inside the expanded changes section.
System lists open under Systems affected, below the NOC response controls.
Ticket relationships use linked SDP tickets; there is no separate free-text reference entry.
NOC notes record the analyst response before marking a problem addressed in Relay. **NOC response**
is the one noun for the operator's recorded work (the history Response filter, the composer
heading, the response history and the glossary). A problem still waiting for one is
**Unaddressed** everywhere — the filter tab, the sidebar ("2 unaddressed") and the detail's
status line (the status bar does not repeat the count); **Resolved by** is
only the field label for the person. Mark Addressed in Relay and Save response stay enabled while
the note or Resolved by is missing: pressing either (or Mod+Enter) saves nothing and focuses the
first missing field in form order. A missing name raises an inline `.field-error` at the Resolved
by select (`aria-invalid`), never a toast; a missing note is named in a warning toast (`Add a NOC
note [and select your name] before …`). Only the connection disables the action: while Relay is
reconnecting or sign-in failed, it is disabled with `Wait for Relay to reconnect` / `Sign in to the
Relay server first` in its tooltip and sr-only `aria-describedby`.

Queue monitoring automatically links NOC workflow tickets only after verifying an exact problem URL
in the ticket description. The monitoring status reports links or retry failures. Ambiguous or missing
references remain available for manual linking. Unlinking hides the relationship and suppresses
automatic recreation across the workspace; an explicit manual link restores it.

Problems distinguishes **Linked SDP tickets** from historical **Ticket reference, not linked to SDP**
notes. Reference text keeps its existing storage and copy behavior; a safe HTTPS reference may be
opened but is not promoted to a connected SDP relationship. Ticket labels and supporting copy use
the shared readable `--text-xs` scale rather than fixed 12 px text.

---

## 3. Edge-Rail Pattern

**Reference utility** — `.ink-rail` defines the canonical row/card treatment — a 4 px left border with no box
background; existing components implement the same declarations locally — use the utility class for new work:

```css
.ink-rail                /* neutral: border-left: 4px solid var(--color-border-strong) */
.ink-rail--alarm         /* problem: border-left-color: var(--alarm) */
```

**Semantics:**

| Modifier  | Token                             | Meaning                           |
| --------- | --------------------------------- | --------------------------------- |
| (default) | `--color-border-strong` `#39363c` | neutral, not active               |
| `--alarm` | `#ff4539` fixed                   | genuine problem or critical state |

Rails encode state at a glance from 10 ft. Never swap the alarm rail for decorative
use or use accent rails for severity.

---

## 4. Elevated-Surface Rule

The elevated combination (`--color-bg-surface-elevated` + strong border + shadow) is
reserved for **floating surfaces** that sit above the canvas:

- Modals and confirm dialogs
- Popovers and tooltips
- Context menus and combobox dropdowns
- Toast/reminder overlays
- Drag ghost elements

Inline content should not imitate elevation. Dense rows and panels should prefer a
transparent canvas with dividers or edge rails. When grouping needs a filled boundary,
use the lower-level `--color-bg-surface` or `--color-bg-card` tokens with the existing
border treatment and no shadow; filter/tool surfaces are current examples.

The relevant token is `--color-bg-surface-elevated: #222227` combined with
`1px solid var(--color-border-strong)` (`#39363c`) and an appropriate `--shadow-*` value.

Shared controls, cards, generic modals and overlays (menus, popovers, tooltips) use 2px
corners via `--radius-control`; full pills use `--radius-pill` and dots/rings `--radius-round`
(never a literal `2px`, `999px` or `50%`; the fenced email content is exempt). Reuse the radius already
owned by an existing component instead of inferring more rounding from surface size.
A rounded one-off surface next to square chips reads as foreign.

---

## 5. Accent System

### Preset Schemes

Ten schemes are defined in `theme/accent.ts` (`ACCENT_SCHEMES`) and as
`:root[data-accent="…"]` overrides in `theme.css`:

| ID       | Label                | `--accent` swatch |
| -------- | -------------------- | ----------------- |
| `red`    | Signal Red (default) | `#e63946`         |
| `orange` | Orange               | `#f97316`         |
| `yellow` | Yellow               | `#facc15`         |
| `blue`   | Blue                 | `#3b82f6`         |
| `cyan`   | Cyan                 | `#06b6d4`         |
| `green`  | Green                | `#22c55e`         |
| `lime`   | Lime                 | `#84cc16`         |
| `pink`   | Pink                 | `#fc8da9`         |
| `purple` | Purple               | `#a855f7`         |
| `violet` | Violet               | `#8b5cf6`         |

The orange and yellow schemes are deliberately tuned as non-semantic operator
preferences so they stay distinguishable from the fixed `--alarm` red-orange
(`#ff4539`) and `--color-warning` amber (`#ffb000`).

Settings can also save up to four custom hexadecimal accents. A custom accent derives
its hover and bright variants at runtime, lifts `--accent-bright` until it meets the
dark-canvas contrast floor, and chooses black or white for `--on-accent` according to
which has the stronger contrast against the fill.

Accent scheduling is workstation-local and optional. It assigns a preset or saved
custom color to three fixed `America/Chicago` windows: Day (6 AM–2 PM CT), Swing
(2 PM–10 PM CT), and Night (10 PM–6 AM CT). When enabled, the active slot overrides
the manually stored accent and is reevaluated at the next slot boundary.

### How It Works

For presets, `data-accent` on `<html>` switches the base variables. Custom colors set
the same properties inline after deriving accessible variants:

| Token             | Source                                                          |
| ----------------- | --------------------------------------------------------------- |
| `--accent`        | scheme base color                                               |
| `--accent-hover`  | lighter midtone                                                 |
| `--accent-bright` | brightest; used for text on dark (>= 4.5 : 1 on `#09090b`)      |
| `--accent-dim`    | `color-mix(in srgb, var(--accent) 12%, transparent)`            |
| `--accent-subtle` | `color-mix(in srgb, var(--accent) 6%, transparent)`             |
| `--on-accent`     | `#000000` for presets; computed black or white for custom fills |

There are no `--color-accent*` aliases; use `--accent`, `--accent-dim` and `--accent-subtle`
directly. Accent-coloured text and icons always use `--accent-bright`, which is lifted
to the contrast floor for every preset and custom accent; raw `--accent` is for fills, rails,
and borders only.

Status companions: `--ok-bright` (success text), `--warning-bright` (warning/pending text on
`--color-warning-subtle`), `--info-subtle` (info chip fill, with `--info-bright` text), and
`--radar-magenta` (Radar status).

### TypeScript API (`src/renderer/src/theme/accent.ts`)

```ts
ACCENT_SCHEMES; // AccentScheme[] — id, label, swatch
ACCENT_STORAGE_KEY; // 'relay-accent'
CUSTOM_ACCENT_STORAGE_KEY; // 'relay-custom-accent' — active custom color
CUSTOM_ACCENTS_STORAGE_KEY; // 'relay-custom-accents'
ACCENT_SCHEDULE_STORAGE_KEY; // 'relay-accent-schedule'
ACCENT_SCHEDULE_SLOTS; // Day, Swing, and Night in America/Chicago
DEFAULT_ACCENT; // 'red'

getStoredAccent(); // → AccentId — reads localStorage, falls back to 'red'
setAccent(id); // persist + apply immediately
setCustomAccent(hex); // normalize, save, and apply a custom accent
setAccentScheduleEnabled(enabled); // persist and apply schedule state
setAccentScheduleSlot(slotId, choice); // assign a preset or saved custom color
initAccent(); // apply schedule or stored accent; wire cross-window storage sync
```

`initAccent()` applies the scheduled slot when scheduling is enabled, otherwise it
applies the stored manual accent. It also schedules the next boundary check and wires
a `window.addEventListener('storage', …)` handler so the kiosk pop-out stays in sync
with the main window. Call it once at renderer startup.

---

## 6. Fixed Semantic Palette

These colors are **never** changed by accent scheme selection:

| Token                    | Value                                               | Use                                                       |
| ------------------------ | --------------------------------------------------- | --------------------------------------------------------- |
| `--alarm`                | `#ff4539`                                           | Genuine system problems only                              |
| `--alarm-bright`         | `#ff6b61`                                           | Alarm hover / text on dark                                |
| `--alarm-dim`            | `color-mix(in srgb, var(--alarm) 12%, transparent)` | Alarm fill tint                                           |
| `--on-alarm`             | `#000`                                              | Ink (text, indicator dots) on a solid `--alarm` fill      |
| `--ok`                   | `#2bb24c`                                           | Positive / resolved / healthy                             |
| `--color-warning`        | `#ffb000`                                           | Non-critical caution                                      |
| `--color-warning-subtle` | `color-mix(--color-warning 12%)`                    | Warning tint background                                   |
| `--info`                 | `#1565c0`                                           | Informational blue (matches the email card's INFO banner) |
| `--info-bright`          | `#42a5f5`                                           | Info lifted for black-ink fills / text on dark            |

**Rule:** use `--alarm` only when the user has a real problem to act on. Never use it
for decorative highlights. Never use `--accent` for severity or urgency signals.

Identity colours (team cards, group pills, avatars) come from the hash-assigned palette in
`utils/colors.ts`; they are user-data assignments and are not re-mapped by accent or alarm
logic. There is no separate `--color-group-*` token set. Server OS badges are text-only
(`getPlatformLabel`).

Team, avatar and group identity colors (`IDENTITY_PALETTE` in `utils/colors.ts`) use only teal,
cyan, indigo (the default), violet, purple and fuchsia. Red/rose/pink, orange/amber/yellow and
lime/green hues are excluded so an identity color never reads as alarm, warning or ok, and blue/sky
are excluded so it never reads as `--info`; a unit test checks every entry stays at least 30° away
from the alarm, warning and ok hues.

---

## 7. Chips

Chips are square (2 px border-radius), compact **borderless** label badges. An outline means
"you can press this", so only pressable controls (buttons, toggles, inputs) carry a border; at
rest a chip is a tinted label and never shares the secondary button's outline. Chips have five
modes:

| Mode                       | Style                                                                                                                             | Example use                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Informational** (tint)   | `background: --color-hover-overlay-strong`, no border, secondary text (primary text inside a selected row)                        | `.contact-entry-chip`; `.alerts-step-status` ("Optional" / "Done" only; an incomplete required step shows none, pressing an export names what is missing) |
| **Status** (tone tint)     | Fixed status token at ~12% (`--color-warning-subtle`, ok/info `color-mix`) as fill, matching token ink, no border                 | `.team-health-badge--watch`; `.dt-problem-badge--warning`; MAINTENANCE / RESOLVED / INFO                                                                  |
| **Featured** (accent)      | `background: --accent-dim`, `color: --accent-bright`, no border                                                                   | `.popout-alert-chip--info`; `.settings-release__badge`                                                                                                    |
| **Alarm** (solid)          | `background: --alarm`, `color: --on-alarm` (`#000`), `font-weight: 700`                                                           | `.popout-alert-chip--danger`; ISSUE in alert history; critical `.dt-problem-badge`; outages                                                               |
| **Severity** (solid fills) | Fixed severity token as solid fill with `--on-alarm` (`#000`) ink, `font-weight: 700` — includes the INFO solid (`--info-bright`) | The alerts-form severity selector and the exported email card                                                                                             |

Chips should not use custom fills outside these modes. Solid chips (alarm and severity fills)
always use black ink for their label text (not `--on-accent`): `--on-alarm` on alarm and severity
fills (the exported email card's own palette is the documented exception). In forced colours the
checked severity option is restated as a Highlight fill. Relay prints no "Needs …" text beside
actions: an action blocked by fixable form input stays enabled and, when pressed, focuses the
first missing field and names what is missing; an action blocked by state is disabled and gives
its reason in its tooltip and accessible description. Alarm-category chips are always the
solid alarm mode — Alert History ISSUE and Problems availability/error/monitoring-unavailable
badges look the same; an alarm chip is never an outline.

Filter toggles (`ListFilters`) are pressable, so they keep the button outline, and they show
their state at rest: a leading box glyph (empty when off, filled with a check when on),
`aria-pressed`, and the `.is-active` selected fill when on. The box is the chip's only glyph: no
decorative per-filter icon sits beside it, so a chip reads as one state indicator and a label.

---

## 8. Buttons and Inputs

### TactileButton (`src/renderer/src/components/TactileButton.tsx`)

All four variants use 2px corners and the same weight (`--weight-bold`, 700). Hierarchy comes
from fill and border, not weight: primary is the only solid accent fill, danger the only alarm
border, secondary a strong outline and ghost no border at all:

| Variant               | Background  | Border                  | Text color                                 |
| --------------------- | ----------- | ----------------------- | ------------------------------------------ |
| `secondary` (default) | transparent | `--color-border-strong` | `--color-text-primary`                     |
| `primary`             | `--accent`  | `--accent`              | `--on-accent`                              |
| `ghost`               | transparent | transparent             | `--color-text-tertiary` → primary on hover |
| `danger`              | transparent | `--alarm`               | `--alarm-bright`; fixed — not themed       |

Danger is an alarm outline whose `--alarm-dim` fill appears only on hover or press; it is never a
solid fill like primary, so destructive actions do not depend on hue alone. Every disabled
TactileButton variant, primary included, is the conventional dimmed button: a solid `--color-border`
outline with `--color-text-quaternary` ink and `cursor: not-allowed`, never an opacity fade or a
faded accent. The quieter outline and the clearly dimmer label (still ≥ 4.5:1) tell it from a live
secondary, whose outline is `--color-border-strong` and label primary ink. A disabled button's
reason is its tooltip and accessible description, not adjacent text.
Selected list rows (Contacts, Servers) use the accent edge-rail plus a neutral
`--color-bg-surface-3` fill; hover is a lighter fill with no rail.

Sizes. Relay has exactly three button heights, and every TactileButton gets its height from the
`size` prop. Feature stylesheets never set `height`/`min-height`/vertical padding on a
`.tactile-button`; they choose a size instead. Empty-state, notice and modal-footer buttons use the
same sizes as command bars, so none of them is taller than a workflow command.

| Size prop      | Height           | Padding (inline) | Font size    | Use                                                  |
| -------------- | ---------------- | ---------------- | ------------ | ---------------------------------------------------- |
| `xs`           | 28 px            | 8 px             | `--text-2xs` | Inline and in-row actions (row Retry, drawer Manage) |
| `sm`           | 36 px            | 12 px            | `--text-xs`  | Compact controls, filters, utility commands          |
| `md` (default) | 40 px            | 16 px            | `--text-sm`  | Workflow commands, forms, dialogs, empty states      |
| icon-only      | = height, square | 0                | —            | Width matches the size's height                      |

`TabCommandGroup` provides the size to its buttons through `TactileButtonSizeContext` (utility →
`sm`, workflow → `md`); an explicit `size` prop still wins, so do not pass one inside a group.

Focus ring: the global `:focus-visible` outline (3px `--accent-bright`, 2px offset; see
Accessibility Baseline) plus `border-color: --accent`. No box-shadow halo.

Active/toggled-on state: `.is-active` applies `background: --accent-dim`,
`color: --accent-bright`, transparent border.

### Outbound affordances

A text action that opens something ends with one glyph saying where it goes: `↗` when it leaves
Relay (the browser or another app: `Open Dynatrace ↗`, `Open Radar ↗`, `Open Reference ↗`,
`View Official Status ↗`), `→` when it moves within Relay (`Open Wiki →` and the other Knowledge
destination cards). The glyph is a separate `aria-hidden` span, so accessible names stay the bare
words (`Open Radar`). Toast action labels and command buttons that start a task (Assign On-Call,
Open Dynatrace Settings) carry no glyph. In the Problems detail, `Open Dynatrace ↗` is a quiet
accent link at the end of the identity line in the title band, so it is in view at compact
heights; the footer keeps only the Dynatrace ID.

### `.tactile-input`

Two field sizes, both tokens in `theme.css`: `--field-height` (44 px) is the default for forms and
dialogs; `--field-height-compact` (36 px) is for dense toolbars — list
sort selects, scoped/list search, the Alert History search, the header search and the accent
schedule list. No field takes any other height; textareas size by `min-height`. A contract test
(`styles/fieldHeightContract.test.ts`) fails on any other single-line field height. Transparent
background, `1px solid --color-border-field`, 2 px radius; padding `0 --space-4` (compact:
`0 --space-3`). Selects use the one chevron: `--field-chevron` (two gradient strokes in
`currentColor`, so it follows the field ink) with `--field-chevron-position`,
`--field-chevron-size` and `padding-right: var(--field-chevron-inset)`; no SVG chevrons.
Hover: `border-color: --color-text-tertiary`. Focus is a ring, not a border hue: `:focus-visible`
takes `outline: 3px solid var(--accent-bright); outline-offset: 2px` plus `border-color: --accent`.
Invalid (`aria-invalid="true"`) has its own shape — an alarm left rail
(`box-shadow: inset var(--rail-width) 0 0 var(--alarm)`) plus the `--alarm` border — so an invalid
field never reads as focused under the Signal Red accent. Disabled: solid `--color-border` on the
sunken `--color-bg-surface-2`, tertiary ink.
Every other field recipe (`.alerts-input`, `.modal-textarea`, `.tag-input`, `.dm-select`,
`.list-toolbar-sort-select`, `.schedule-bridge-select`, `.accent-schedule-select`, the settings,
Problems and tickets fields) restates these tokens and uses the same focus ring and invalid rail
(enforced for every native field in `responsive.css`); never an `--accent-dim` halo.
Field and form error copy uses the one shared `.field-error` class: `--text-xs`, `--alarm-bright`,
no box, led by a small square alarm mark (`::before`, a 6 px `--alarm` border square — the pip
grammar's alarm shape, so the copy reads as an error without colour and survives forced colours).
`Input`'s `error` prop renders it, sets `aria-invalid` and links it through `aria-describedby`;
per-surface error classes only add layout spacing on top of it. A form that validates several
fields puts each message on its own field and moves focus to the first invalid one (Setup's Port,
Server URL and Passphrase), never one form-level alert.
Panel-level load or save failures (a ticket's messages, notes, history or resources, linked
problems, notification storage, server status, settings and administration saves, privileged
access and owner setup, alarm reminders, a failed release update, data imports and backups, Wiki
pages and documents, a failed tab, a failed or uncertain SDP live write) use
`.panel-error.ink-rail.ink-rail--alarm`:
`--text-sm` `--alarm-bright` copy on the 4px alarm rail, no box. When the panel can reload, a
`sm` `Try Again` `TactileButton` follows the copy and re-runs that read. A failed tab's fallback
makes `Try Again` primary and `Reload Application` (a full window reload) secondary. Both error
shapes carry `role="alert"`; a bare `role="alert"` paragraph never ships unstyled, and no surface
keeps a bespoke alarm-tinted box. Guidance that is not an error (a long alert subject) uses
`--warning-bright` helper text tied through `aria-describedby`, never alarm ink. A message that
can be either an error or a confirmation is split by tone before it renders (the tickets'
`SdpMessage`): the error takes one of these shapes, the confirmation a persistent status output;
one tertiary note never carries both.

Every input, select and textarea rests on `--color-border-field` (`#716b71`: 3.83 : 1 on
`--color-bg-app`, 3.63 : 1 on `--color-bg-surface`, 3.05 : 1 on `--color-bg-surface-elevated`),
so empty fields stay findable (WCAG 1.4.11). `--color-border-strong` stays the divider and
container-outline colour. Inline remove/clear controls (tag remove, Input clear, custom-accent
remove) are 24 × 24 px squares on `--radius-control` with a neutral
`--color-hover-overlay-strong` resting fill.

### Header Search Bar (`.header-search-bar`)

Underline-only input: `border-bottom: 2px solid --color-border-field`, no box.
On focus-within: `border-bottom-color: --accent-bright` thickened by a 1px underline shadow; while
the input itself is focused the wrapper also carries the standard field ring (3px `--accent-bright`
outline, 2px offset), since the input suppresses its own. Max-width 400 px. The input is a
`combobox` with `aria-autocomplete="list"` and `aria-haspopup="listbox"`; a visually hidden polite
status announces "n results" or "No results" for a typed query.

Search results label the action they perform. A primary row or Enter opens the exact record,
document, workspace, or tab without changing unrelated Compose state. Actions that do change the
bridge, such as Add group or a contact's `+ Bridge` control, remain separate and have explicit
accessible names that start with the visible label ("Bridge: Add Jane Doe"; the `+` is
decorative). Shift+Enter adds the highlighted contact to the bridge; Tab only moves focus.
Keyboard hints describe only actions available for the active result.

### Persistent release update indicator (`.release-update-indicator`)

When packaged desktop Relay discovers a newer normal release, the global header action area shows a
compact `TactileButton` before the world clock. Wide and full-screen layouts use a concise state
label: `Update`, `Downloading`, `Ready`, or `Update Issue`, followed by `· vX.Y.Z`. At the
existing 1200 px compact-shell breakpoint and below, the state label contracts to `vX.Y.Z`. The
version always comes from the latest validated release response and changes when a later release is
discovered. Its accessible name includes both the version and current action.

The indicator uses a static accent dot, accent-bright text, a restrained accent tint, the standard
2 px control radius, and the shared focus treatment. It does not pulse, glow, use ambient
attention-seeking animation, use warning or alarm colors, or offer a dismiss or snooze action; it
retains the ordinary hover and press feedback of a `TactileButton`. Clicking it opens Relay's fixed
**Update Relay** dialog when the desktop updater bridge is present. Older builds fall back to the
fixed GitHub Releases page. The control remains visible on every tab until the installed version is
current; a transient refresh failure or repeated same-version check does not erase a previously
confirmed update or manual progress.

The dialog uses a 680 px standard modal shell and a single three-stage line for Download, Install, and Restart.
It names the current stage, shows bounded byte progress during download, explains the immutable-GitHub
and SHA-256 trust model, and discloses that publisher signing is not included. The meter is a single visible native progress element, styled as a thin solid accent bar with
subtle corners. A compact caption pairs byte counts with a whole-number percentage; its fill follows
the bounded byte ratio without a width transition. Unknown download sizes and installation use a
simple sliding activity segment with no invented percentage. Reduced-motion mode keeps that segment
stationary. Between current status and integrity details, the dialog presents **What's new in
vX.Y.Z** with the release date and a bounded reader for headings, paragraphs, lists, emphasis, and
inline code. The notes use the main content hierarchy rather than a nested card; long bodies scroll
inside the reader while the update actions remain reachable. Release text becomes a limited set of
React nodes rather than raw HTML; Markdown link labels remain readable text without activating
release-authored destinations.

Buttons name the exact next action. Download, install, and restart are never combined; cancellation is
offered only while downloading, and installation temporarily prevents dismissal while the Windows
bootstrap prepares the runtime with Relay still open. **View on GitHub** remains a secondary action
throughout the flow. Mutable releases replace installation controls with that review action. Failures
name what failed and present only a valid recovery such as **Retry Download**, **Retry Install**,
**Check Again**, or **Retry Restart**.

The compact label must remain visible when the sidebar rests at 64 px. It may not shrink, wrap,
overlap the centered search control or platform window controls, or disappear with the world clock.
At 720 px and below, the empty title track and search shortcut badge yield space while the search field
remains shrinkable, preserving the indicator through Relay's 400 px desktop window minimum.
At 520 px and below, modal footer actions stack at full width while the three-stage line remains a
single readable row. The one-time toast announces each newly discovered version with **Review
update**; the persistent control itself is not a repeatedly announced live region. Relay Web and
pop-out windows do not render it.

### Release history (`.settings-release-history`)

**Settings > About** keeps the installed-version summary at the top and follows it with a readable
history of the ten most recent stable releases. The list is a sharp, divided timeline rather than a
grid of cards. Each row leads with the monospaced version, then the release title and date, followed
by compact **Latest** and **Installed** labels when applicable. The newest release is expanded by
default; only the selected row reveals its structured notes and version-specific GitHub action.

Rows are native buttons with visible focus, `aria-expanded`, and controlled panels. Accent color is
reserved for versions, the current disclosure state, and list markers. Cached content appears
immediately, a quiet status reports background refresh, and offline refresh failure leaves saved
notes in place with a **Try Again** action. At narrow widths, labels wrap beneath the release title
and expanded content returns to the shared page inset without introducing horizontal scrolling.

### Retained-build recovery (`.settings-recovery`)

**Settings > About > Recovery** sits between the installed-version summary and release history as a
divided inline section, not a competing card or modal. Its heading explains the current-plus-two
Windows retention rule and labels either the catalog current version or the retained recovery
runtime currently running. When fallback is active, plain status copy explicitly distinguishes the
running version from the catalog current version and directs the Owner to make the fallback current
through rollback.

Each retained version is a compact row with a monospaced version and a text health label: **Ready**,
**Runtime needs repair**, **Server snapshot unavailable**, or **Data format incompatible**. The
label, not color alone, carries the state. An authenticated Owner sees only valid next actions:
**Roll Back to vX.Y.Z** for a complete compatible target or **Repair vX.Y.Z from GitHub** for a
missing runtime. Other roles see sign-in guidance. A fixed, version-specific GitHub action remains
available when automated repair cannot be offered.

Repair and rollback open an inline confirmation below the list. The copy distinguishes runtime-only
repair, server data restoration, and client cache preservation. Both require the Owner password
again; disabled and busy labels describe the active operation. Feedback is announced as status or
alert text. At 700 px and below, headings, build rows, status/retry areas, action groups, and
confirmation controls stack at full width without changing DOM or keyboard order.

---

## 9. Typography

### Fonts

- **UI font:** `IBM Plex Sans` — locally bundled weights 200, 400, 500, 600, and 700 plus
  200 and 400 italic; fallback `'Segoe UI', system-ui, sans-serif`. Plex ships no 800 or 900, so
  no rule may ask for a weight above 700, and every numeric weight must be a bundled face
  (`theme/__tests__/fontWeights.test.ts`)
- **Mono font:** `JetBrains Mono` — reserved for technical tokens only: IDs (problem and ticket
  IDs, ticket references), version strings, pairing/approval codes and secrets, DQL/query text,
  `kbd`/`code`/`pre` and keycap chips (`.shortcuts-modal-key`), host:port addresses
  (`.setup-config__discover-addr`), and the fenced email-preview content (§10). The allow-list
  lives in `styles/monoFontContract.test.ts`; adding a selector is a design decision.
- **Everything else uses the UI font** — including timestamps, dates, counts, phone
  numbers, and shift time windows. Numeric values get
  `font-variant-numeric: tabular-nums` for aligned digits without the code texture

### Fluid Scale

All sizes use `clamp()` tuned for dual-distance viewing: 24" desktop at arm's length
and 55" TV at approximately 10 ft (both at 1080p).

| Token            | Value                       | ~px at 1920 px wide |
| ---------------- | --------------------------- | ------------------- |
| `--text-2xs`     | `clamp(13px, 0.72vw, 14px)` | 14 px               |
| `--text-xs`      | `clamp(14px, 0.8vw, 16px)`  | 15 px               |
| `--text-sm`      | `clamp(15px, 0.9vw, 18px)`  | 17 px               |
| `--text-base`    | `clamp(16px, 1.05vw, 20px)` | 20 px               |
| `--text-md`      | `clamp(18px, 1.2vw, 23px)`  | 23 px               |
| `--text-lg`      | `clamp(20px, 1.4vw, 27px)`  | 27 px               |
| `--text-xl`      | `clamp(24px, 1.6vw, 32px)`  | 32 px               |
| `--text-2xl`     | `clamp(28px, 2vw, 40px)`    | 38 px               |
| `--text-4xl`     | `clamp(42px, 3.2vw, 62px)`  | 62 px               |
| `--text-display` | `clamp(34px, 3vw, 56px)`    | 56 px               |

### Weight Tokens

`--weight-light: 200` / `--weight-regular: 400` / `--weight-medium: 500` /
`--weight-semibold: 600` / `--weight-bold: 700` (the heaviest; Plex ships no 800). Light is for
display titles and the italic empty-state lines. Numeric weights live in `theme.css` alone; every
other stylesheet, the alerts email card included, uses the tokens (`fontWeights.test.ts` enforces
it).

### Ranges

Ranges use a spaced en dash between dates (`September 28 – October 4, 2026`) and an unspaced one
between times (`6 AM–2 PM CT`), never a hyphen.

---

## 10. Alerts Email-Preview Exemption

`src/renderer/src/tabs/alerts/alerts-email-card.css` and `alerts-email-event.css` (imported by the
`tabs/alerts.css` manifest) contain the fenced regions, marked with full-width banner comments; the
closing END banner sits at the top of `alerts-workflows.css`:

```
/* ==========================================================================
   EMAIL CONTENT — DO NOT RESTYLE. ...
   ========================================================================== */
```

The first region spans from `.alerts-email-card` through the highlight-pill rules,
ending with an "END EMAIL CONTENT" banner. The second region is the `.alerts-email-event-time*`
banner rules, marked with its own EMAIL CONTENT and END EMAIL CONTENT banners.

Everything within those fences is **exported content** — the white-canvas email
preview card that matches the actual sent alert email. Its hardcoded colors (white
background, dark text, literal severity colors) are correct and intentional. Never
apply ink tokens, accent variables, or theme changes inside these fences.

The card's base font rides `--font-family-base` and therefore uses IBM Plex Sans. The fenced rules
remain part of the exported-content contract.

### Operator action hierarchy

Alerts keeps History and a visible Reset in the utility group and exposes one delivery primary
action: Open in Outlook on Desktop or Download Draft in Relay Web. Save Image remains a visible
secondary action; Schedule Alarm, Alarms, and Pin Template stay in the keyboard-accessible
overflow. Cmd/Ctrl+S saves the image and Cmd/Ctrl+Enter opens the draft, including from editable
fields. Both exports refuse a draft until severity has been deliberately chosen and a subject and
message body exist, without being disabled or labelled in advance: pressing Save Image, Open in
Outlook / Download Draft or either shortcut with a field missing does not export; it focuses the
first missing field (severity, then subject, then body) and raises an error toast naming what is
missing (`Choose a severity and add a subject and message body before exporting`). Once
exportable the definition pane header reads "Ready to export". Until severity is
confirmed no option is checked or styled as selected (the first radio is the group's tab stop), and
the preview card shows a neutral grey banner, never the INFO blue, prefixed PREVIEW with an italic
placeholder-voice "Choose severity" (like the empty subject and body); once the
operator picks one, that option takes the solid severity fill. Each option still shows its meaning
at rest: a leading 8 px pip (generated content, never announced) in its severity colour and
pip-grammar shape — filled square ISSUE, diamond MAINTENANCE, hollow ring INFO, filled circle
RESOLVED — on an otherwise neutral outline; on the checked fill the pip turns black, and in forced
colours it is CanvasText (HighlightText when checked). The selector is an arrow-key radio
group. Step status chips read Done or Optional in plain sentence case; an incomplete required step
shows no chip, because pressing an export names the missing fields. A saved alert loaded
from History, a template or an alarm counts as a chosen severity when it carries a valid one.
Severity is named only by that selector and the preview card itself: the
page status reads "Draft ready" with a filled ok pip at `--text-sm` once the draft can be exported
and is empty while it cannot, and the preview
header gives the export width, so
neither echoes the severity. The severity fieldset is itself the radiogroup, named once by its
legend. The Update prefix switch carries its name as visible text with the On/Off state word
beside it; its stepper's live value reads "Update #N" (atomic) and '−' rests disabled at 1, as the
board font-size stepper does at its minimum. An invalid click-through URL shows a linked `.field-error` (`role="alert"`). Pinned templates appear as a one-click row above
the composer, and the alarm strip changes to "Overdue alarm" once an alarm is past due. The
composer and preview stay side by side down to 900 px and stack below that; at 1100 px and below
the composer takes the larger share (`minmax(420px, 1.3fr) minmax(360px, 1fr)`) so every step
stays reachable and the subject placeholder fits. When the preview pane is narrower than the
640 px card, the on-screen card is scaled down with CSS `zoom` (`min(1, 100cqi / 640px)` against
the `container-type: inline-size` preview scroller) so the whole email fits with no sideways
scroll; the rule is scoped to the pane, so the exported image is still captured at 640 px, 1x,
and the pane header keeps naming the 640 px export width. Optional delivery
details remain collapsed until requested; while collapsed on windows taller than 900 px, step 3
docks to the bottom of the composer (two-pane widths) whenever steps 1–2 fill it, and opening it
scrolls its heading to the top. The composer reserves the docked step's height as
`scroll-padding-bottom`, so focused fields and the body caret never scroll under it. On windows
900 px tall or shorter (1366×768) step 3 never docks, because it would cover the message body:
it flows after the body, reachable by scrolling with the bottom fade as the cue, steps 1–2 drop
their description lines, and the message body starts at 120 px instead of 224 px, so the whole
editor is visible and typeable with the composer scrolled to the top. The
Outlook draft keeps the branded card as an inline
image and also includes the alert's severity, subject, body, sender, recipient, update number,
event timing, and safe links as readable HTML and plain text. The image is never the draft's only
message content.

Reset clears the composition at once (logos are branding and stay) and shows `Reset "<subject>"`
with **Undo**, which restores the whole draft: severity and its confirmed state, subject, body,
delivery fields and event times. Loading an alert from History, a pinned template or an alarm
follows the same pattern: it replaces the composition at once, without a confirm, and when a
composition was in progress the `Loaded "<name>"` notice carries **Undo**, which restores it.
Alert History's **Clear All** (no ellipsis, no prompt) hides
every entry and shows `Cleared alert history (N entries)` with **Undo**; the deletes, limited to
exactly those entries, are written when that notice leaves without Undo or the tab unmounts, and
an Undo after that re-adds them. Bridge history keeps its `Clear All…` confirm.

---

## 11. Knowledge Workspace

Knowledge is the single sidebar destination for the Wiki, Contacts, and Servers surfaces. The
destination navigation (`Knowledge destinations`, `aria-current="page"` on the open destination)
is the only location marker; the app header adds no breadcrumb, and the workspace's own
navigation remains the way back to Knowledge Home. Every destination, Home and Wiki included,
ends in the shared `StatusBar` with `StatusBarLive`, like the other tabs. The Knowledge
sidebar item returns to the last destination used (kept for the session and restored on the next
launch). Home rows show `Open Wiki`, `Open Contacts` and `Open Servers`, so each visible command
is the start of its accessible name (`Open Contacts, 6 contacts`; WCAG 2.5.3 Label in Name).

- The Knowledge home is a launcher of three equal cards in the exact order **Wiki, Contacts,
  Servers** (one column below 860 px). Each card is a real button: a neutral line glyph in a
  bordered tile beside the area name, one sentence on what the area holds, its readiness facts as
  label/value lines, then a ruled footer with the count (with explicit loading/unknown and quiet
  zero states) and `Open <area> →`. The accent appears only on hover and focus. The home has no
  search field of its own: the header metadata points to the one app-header Search Relay (⌘K) and
  carries `Retry Wiki Count` when the Wiki count failed. An empty Wiki card holds its next step
  inside the card, below the button.
- Destinations mount on first use and remain retained. Navigation preserves selected records,
  filters, reader position, and local scroll state; opening an exact search result may reveal that
  record but does not change bridge recipients.
- Notes remain contextual to Contacts, Servers, or Problems. Relay has no standalone Notes
  workspace.
- Contact and Server detail panels pin their action stack (Add to Bridge, Notes, Edit, Delete) as
  a footer outside the scrolling body, so the actions stay on screen at 1366×768. The body scrolls
  on its own and its sections never shrink beneath the footer; on windows 900 px tall or shorter
  the commands pair two per row (an odd leading command spans the row) so Owner and Support stay
  in view. Commands show short verbs (`Edit`, `Delete`, `Add Notes`) that never ellipsize; the
  accessible name and tooltip carry the full command (`Delete Server`). Emails wrap only after
  "@", never before the domain suffix.
- At ≤1024 px Contacts and Servers drop the detail panel, so every row shows a 40 px ghost `⋯`
  button (`Actions for <name>`, `aria-haspopup="menu"`, `aria-keyshortcuts="Shift+F10"`; its
  Tooltip is the name itself, so it is not read twice) at its right edge, inside the row box. It
  opens the row's existing context menu (Contacts: Add
  to Bridge, Manage Groups, Notes, Edit Contact, Delete; Servers: Notes, Edit Server, Delete
  Server) anchored below the button; wider windows hide it because the detail panel carries the
  same actions. The status bar carries no actions cue; the `⋯` button's `aria-keyshortcuts` and
  Help's shortcut list carry the Shift+F10 route, and the keyboard focus ring wraps the whole row,
  `⋯` included. Hovering
  the overlaid Servers `⋯` keeps its row's hover fill. A contact with notes shows a 28 px ghost
  icon-only `Edit notes for <name>` button (inferred Tooltip) beside the `⋯`.
- The Wiki reader defaults to Continuous and offers Single page. Mode changes preserve the open
  document, page, and PDF lifetime; bounded rendering, reduced-motion behavior, and page-local retry
  states keep long documents usable without replacing the whole reader.
- Internal PDF destinations stay in Relay. Approved HTTP(S) links require an explicit action and
  open through the validated system-browser boundary.
- Knowledge keeps accent for focus, selection, the primary action and the active destination only.
  The drawer title, category chevrons, the indexing footer, the back-link glyph, type and
  status labels, search readiness, mono identities and the square (`--radius-control`) Close match
  chip use secondary or tertiary ink on neutral fills. Failure headings (`{label} unavailable`,
  `Unable to open this guide`, `Publisher access ended`) and page/document retry buttons use
  `--alarm-bright`; there is no separate failure kicker above them.

---

## 12. Styling Rules

### Compact navigation

At widths at or below 1200 px, the sidebar rests at 64 px and expands labeled navigation above the
content on hover or keyboard `:focus-visible`, not after a pointer click; the active tab never
reflows. The overlay remains open while either pointer or keyboard focus is inside the rail, and
reduced-motion mode removes its width animation. Desktop top-level shortcuts follow sidebar order
from Cmd/Ctrl+1 for Compose through Cmd/Ctrl+8 for Tickets, and Cmd/Ctrl+Shift+/ opens the shortcut
list. Relay Web uses Alt+Shift+1–8, Alt+Shift+K for search, Alt+Shift+, for Settings, and
Alt+Shift+/ for shortcuts so browser tab and search bindings remain available. Each sidebar
tooltip shows its destination's platform keycap (`⌘1`, `Ctrl+1` or `Alt⇧1`; Settings `⌘,`) and the
button exposes the same binding through `aria-keyshortcuts`. Global shortcuts
yield to editable controls and open dialogs. While Problems is active,
Alt+Down and Alt+Up cycle the problems visible in the current filter and search, Alt+1–3 switch
between Unaddressed, Addressed in Relay, and History, Alt+N focuses the selected response note, `/`
focuses search, and Cmd/Ctrl+Enter runs the response action once its prerequisites are met. Alt+arrows
and Cmd/Ctrl+Enter also work from the response note and resolver; other editable controls and
modals suppress the triage shortcuts.

### Scroll edge cues

A scroll panel whose last visible row can be cut off (the Alerts composer, the Status provider
list) fades its content out over the last 40–56 px while more sits below, and Status also fades
the top edge once scrolled. The fade is a `mask-image` driven by `animation-timeline: scroll(self)`,
so it disappears at the end of the scroll and is inactive when the panel does not scroll. It is an
edge cue, never a way to dim readable text at rest.

### Do

- Use tokens from `theme.css` instead of hardcoded shared values
- Prefer shared classes and components before adding one-off patterns
- Keep styles in the existing CSS files unless a feature already owns its own
  stylesheet
- Use `:focus-visible` for keyboard focus states
- Keep dynamic runtime styling limited to cases that truly need inline values
- Use `.ink-rail` modifiers to communicate state via the left-rail color
- Use `--alarm` only for genuine problems the user must act on

### Do Not

- Do not add Tailwind, CSS modules, or CSS-in-JS to new renderer code
- Do not hardcode common spacing, radii, or colors that already exist as tokens
- Do not add custom button patterns when `TactileButton` already covers the case
- Do not use `--accent` for severity or urgency semantics
- Do not use `--alarm` decoratively (borders, section tints, unrelated highlights)
- Do not give inline content surfaces an elevated (`#222227`) background fill

### Inline Style Exceptions

Inline styles are acceptable when the value is produced at runtime:

- `react-window` row positioning
- `@dnd-kit` transform values
- Dynamic CSS custom properties (e.g., per-entity accent color passed as `--swatch`)
- Runtime-computed dimensions

Static design values must stay in CSS.

---

## 13. Accessibility Baseline

- **Focus ring:** a global `:focus-visible { outline: 3px solid var(--accent-bright);
outline-offset: 2px }` in `theme.css` (earliest cascade layer, no `!important`). Component rings
  keep the same 3px accent-bright weight; the one inset variant for edge-to-edge rows, tabs and
  picker options is `outline-offset: -3px`. Controls on a solid alarm fill use `currentColor`. There
  is no separate focus-ring colour token. Never set
  `outline: none` on a `:focus-visible` state without supplying another ring, and never add an
  `--accent-dim` box-shadow halo beside the ring (one ring, not two). Native form
  controls keep one managed `!important` rule (responsive.css): the same 3px accent-bright
  outline ring at a 2px offset plus an accent border, and an alarm left rail plus alarm border
  for `aria-invalid="true"`. Box-shadow halos are never a field's focus signal.
- **Forced colours:** the `@media (forced-colors: active)` block in responsive.css restates every
  state that rides on a box-shadow or fill: selected, active and unread rails become a
  `--rail-width` left border (`Highlight` for selection, `CanvasText` for unread; Contacts and
  Servers rows rest at `Canvas`), custom
  checkboxes keep their checked fill in system colours, Settings switches keep a `CanvasText`
  track and thumb (on: `Highlight` track, `HighlightText` thumb), pressed toggle buttons (rich-text
  format, Status region filter, active tactile toggles) fill with `Highlight`, and fields that
  suppress their own ring (header search, Wiki filters) outline their wrapper. Add new rail or
  fill-only states there.
- **Tooltips:** the shared `Tooltip` is `role="tooltip"`, linked to its trigger by
  `aria-describedby` while shown (the popup is only mounted then, so the reference is never
  dangling; skipped when it repeats the trigger's `aria-label`, or when the
  caller passes `describesTrigger={false}` because the name already says everything, as the
  sidebar buttons do), dismissed by Escape, and stays open while the pointer moves onto it (100 ms
  grace) — WCAG 1.4.13. A keyboard-opened popup stays while its trigger keeps focus, even after
  the pointer passes over and out; it closes on blur or Escape. The popup caps at 320px; callers
  pass widths within that.
- **Menu popovers** (the sidebar Dashboards menu): opening focuses the first item; arrow keys,
  Home and End move within it. Escape closes and returns focus to the launcher; Tab closes and
  continues from the launcher's place in the order; focus moving anywhere else closes it; a
  pointer press outside closes it without moving focus. A launcher whose accessible name differs
  from its visible label starts with that label ("Dashboards: Open NOC") so voice control works.
- **Color + shape:** State must be communicated by at least two signals — color alone
  is insufficient. Rail color is supplemented by label text or icon change.
- **Sidebar status pips:** every state has its own shape as well as its hue — hollow ring = waiting
  or no current data, slashed ring = the feed is failing (neutral `--color-text-secondary` ink,
  never alarm red, because the source's own state is unknown rather than critical), filled circle
  = healthy (`--ok`), diamond = warning (`--color-warning`), square = critical
  (`--color-danger`), triangle = attention (`--radar-magenta`, the CW Dashboard's magenta
  state). On-Call carries the alarm square whenever a team has no coverage (the board's "No
  coverage" rule over the rows App already holds), announced as "1 team has no coverage". Radar
  takes the slashed ring whenever its latest refresh failed and says since when ("refreshes
  failing since 14:05"); waiting and sign-in-needed keep the hollow ring, each with its own
  description. The pip always sits on the label line, right after the label
  (`.sidebar-button-heading`, 5 px gap; "Problems" bold at 18 px is 81 px, so label + gap + pip +
  gap + stale mark is 111 px and fits the 112 px content width of the 136 px button). Alarm and
  failing pips also carry their state in words on exactly one line directly under the label,
  across the full 112 px (`.sidebar-button-state` > `.sidebar-button-status-word`, bold), in its
  tone's text ink so urgency ranks before reading: alarm words in `--alarm-bright` (Radar
  `Critical`, Status `Outage`, On-Call `No coverage`), the warning count in `--warning-bright`, and
  a failing Radar feed in secondary ink.
  A failing Radar says the board's own headline from `deriveRadarStatus` — `Unavailable` before any
  data has loaded (the tab's "Radar unavailable" block), `Stale` while the last good board shows —
  so the sidebar and the tab use one word for one state; `Critical` stays the board's own red state.
  The Signal Red accent never colours a state word; the square on the label line keeps the two reds
  apart by shape. Problems — the one warning that carries a word — says its count (capped `99+`)
  and the tab's own noun, `unaddressed` (`.sidebar-button-status-noun`, regular), on the same line,
  announced "2 unaddressed problems". The word carries the count, so Problems has no separate count
  badge. While Dynatrace sync is off, failed or retrying, the slashed-ring stale mark
  (`.sidebar-button-stale-mark`) follows the pip and the tooltip adds it beside "Not syncing"; the
  count itself is never dashed or underlined. The state line is
  set at 14 px, the `--text-xs` floor, at every viewport (`nowrap`): measured in IBM Plex Sans the
  widest state, `99+ unaddressed`, is 110 px there (126 px at the 16 px `--text-xs` ceiling would
  not fit), `2 unaddressed` 94 px, `No coverage` 81 px and `Unavailable` 78 px, so every state is
  one line (a wider fallback face ellipsizes the noun rather than wrapping); a button with a state
  line grows by it (`.sidebar-button--has-word`). In the 64 px rail the state line and stale mark
  hide with the label and the pip becomes a badge on the icon's top-right corner; the accessible name reads
  `<Label> · <word> [noun] [· not syncing] — <state>`. The tooltip repeats the pip beside its state
  text and the accessible name carries the same text.
- **Sidebar fit:** the brand block and the footer (presence, Dashboards, Settings) are pinned and
  never shrink; the destinations scroll inside `.sidebar-nav` (`min-height: 0`, thin stable
  scrollbar gutter, hidden in the collapsed 64 px rail) if they ever outgrow the window, so
  Settings is never clipped. Windows up to 840 px tall (1366×768 included) compact the buttons to
  48 px, since the full-height rail needs about 810 px at 1920 px wide; the compact tour asserts
  Settings sits inside the sidebar, the nav needs no scrolling and no label is cut at 1366×768.
- **Count badges:** one shared `.count-badge`: a 20 px
  `--radius-pill` neutral (`--color-border-strong`) outline with a primary tabular numeral, so the
  numeral carries the signal (header Notifications unread count).
- **Contrast floors:** Text quaternary (`#9a9298`) is the minimum for any readable
  text on `#09090b`. Accent-bright colors in each preset and custom scheme meet at
  least 4.5 : 1 on the charcoal canvas. Presets use black `--on-accent`; custom
  accents choose black or white according to the stronger fill contrast.
- **Reduced motion:** Animations that flash or pulse (e.g., critical reminder overlay)
  include a `@media (prefers-reduced-motion: reduce)` override.
- **Modal initial focus:** `useFocusTrap` focuses `[data-autofocus]`, then the first form field,
  then the primary button, never a danger action. Failing those, the `<dialog>` (`tabindex="-1"`,
  named by its heading) takes focus itself, so the header close button's Close tooltip appears
  only when the operator tabs to it. The backdrop closes on click but is hidden from assistive
  technology.
- **Toasts:** routine error toasts persist until dismissed, and every toast pauses its timer while
  hovered or focused. A toast's message states its outcome ("Copied 4 recipients"), so there is no
  generic visible title; an explicit title is shown only when a caller passes one. Severity is the
  rail colour, a shape glyph at the start of the first line in the pip grammar (filled square =
  error, diamond = warning, filled circle = success, hollow ring = notice), and a
  screen-reader-only prefix ("Error:", "Warning:", "Success:", "Notice:"); in forced colours the
  rail is restated in `CanvasText`. The close button is named `Dismiss: <message>` (cut at 60
  characters) so a stack of toasts does not read as identical buttons. The `Messages` region is
  not itself live: routine, success and warning toasts are appended into a polite stack mounted
  empty with the provider, and each error toast sits outside that stack as its own
  `role="alert"`, so nothing is announced twice. Pinned alert templates
  follow the same grammar: the dot's shape gives the severity and the button name leads with the
  severity word ("Maintenance: Patching").
  Failure copy comes from `formatFailure` in `utils/failureMessage.ts`: what failed (naming the
  object), the cause when known (a request that never reached the server reads "The Relay server
  didn't respond"), what happened to the data only when the code path guarantees it ("Nothing
  changed."), and the next step. **Retry** appears only where repeating the action is idempotent.
- **Live regions:** a region inserted already holding text is often not read, so announcements go
  through regions that stay mounted and change only their text (`<output>` empty when idle).
  Failure and recovery notice panels (Radar's refresh-failure and CW Dashboard sign-in notices) are
  labelled regions, not live ones; the tab's always-mounted status (Radar's sr-only status output,
  which leads with session expiry, and Status's coverage summary) announces the change. An empty-
  or no-match message that is styled as a panel (Help's and the Wiki catalog's no-match notes, the
  PDF download feedback) keeps its `role="status"` element mounted with `sr-only` while empty and
  swaps to its panel class when the text arrives. `role="status"` and `<output>` already imply
  polite, so they never carry a redundant `aria-live`. One-shot
  errors that mount with the problem (the startup error screen, form errors) use `role="alert"`.
- Clickable non-button elements need semantic ARIA roles and keyboard handlers.

---

## Layout Tokens

| Token                       | Value                                                      |
| --------------------------- | ---------------------------------------------------------- |
| `--sidebar-width-collapsed` | 152 px / 64 px compact                                     |
| `--header-height`           | 56 px                                                      |
| `--space-1` … `--space-12`  | 4 px … 64 px                                               |
| `--radius-control`          | 2 px (`--radius-pill`, `--radius-round` for pills/dots)    |
| `--color-border-medium`     | `#2b292e` (colour only; write `1px solid var(--…)`)        |
| `--rail-width`              | 4 px (every edge-rail: selection, warning, alarm, quote)   |
| `--tab-indicator-width`     | 3 px (selected-tab underline in every tab strip)           |
| `--color-border-field`      | `#716b71` (input/select/textarea resting border, ≥ 3 : 1)  |
| `--z-sidebar`               | 9002                                                       |
| `--z-dropdown`              | 100                                                        |
| `--z-overlay`               | 1000                                                       |
| `--z-popover`               | 10010 (portaled menus, comboboxes, tooltips; above modals) |
| `--z-modal`                 | 9999                                                       |
| `--z-window-controls`       | 10001                                                      |
| `--z-command-palette`       | 10002                                                      |
| `--z-critical`              | 20000                                                      |

### Compact workstation windows

At viewport widths of 1200 px and below, Relay keeps every navigation destination available but
rests the main sidebar at a 64 px icon rail, changes the brand to `r.`, and hides the world clock.
Hovering the rail or moving keyboard focus into it (`:focus-visible`, not a pointer click) expands
the full labels over the active workflow without changing the content width; accessible names and
hover tooltips remain available as fallbacks.

The Dynatrace Problems workspace switches from its queue/detail split to a single stacked column at
900 px and below. The queue header is one row (title, count, Shortcuts); the keycap legend opens
from Shortcuts as a light-dismiss popover. Directly under it, a sync line says whether the queue is
current. Synced and syncing are a quiet secondary line (filled circle, hollow ring; "Dynatrace
sync on"); the last-sync time is the command bar's freshness readout beside Refresh. Not syncing (off or failed)
is a labelled warning banner in the queue (`.dt-problems__sync-state--stale`: warning
diamond at body size, `--warning-bright` label, warning rail on `--color-warning-subtle`) in plain
English: the cause ("Dynatrace isn't syncing."), what the queue is ("The queue is Relay's last
saved copy (from 3h ago)." — problems reach Relay only through a sync, so a copy with no recorded
sync time is still called a saved copy, never "never synced"), and, when off, the owner ("An
Administrator can turn sync on in Settings › Dynatrace.") with Open Dynatrace Settings where this
operator can configure it. The sync line is not live; a persistent sr-only status in the queue
announces sync state and the result limit. Tab notices above the workspace use the rail grammar,
never a tinted box: sync failed and local load failed are `.panel-error` + `.ink-rail--alarm` with
a square pip; the Dynatrace result limit is `.ink-rail--warning` with a diamond pip. The sync
notices are non-live notes (the queue status announces them); the local load failure is
`role="alert"`. Field labels (Root cause, Impact, NOC note, Resolved by) are
sentence case everywhere, and data values are never case-transformed. The NOC response composer
(status with the local-scope note, note, resolver, then the primary action) sits directly under
the problem facts,
ahead of the SDP and system context and NOC response history. It docks to the bottom of the detail
pane whenever a long header pushes it below the fold; on windows 900 px tall or shorter it tightens
(one-line status, a two-line note) rather than undocking, so the commit row is visible without
scrolling at 1366×768. The
resolver defaults to the last operator who marked a problem addressed on this workstation. An
unavailable primary action is drawn as the dimmed neutral outline rather than a faded accent. The
impact, root cause, and profile facts stay in one row until the detail pane is narrower than
520 px. Filter tab counts follow the search, and an empty search offers Clear Search.

Radar's page-level refresh control is the labelled Refresh button that leads its command bar, always
visible, followed by the "Updated 4:16 PM" freshness readout and then Open Radar, which is always a
normal secondary button: the live dashboard stays a way in even while the feed fails. A failed
refresh while retained data exists shows an inline notice with a neutral rail whose title carries
the board status word ("Stale"), because a failed fetch leaves the board unknown and red stays
reserved for the board's own red state; the notice says "Failing since HH:MM" and points to Refresh
instead of carrying a second retry button, and the full board stays below it. When nothing has
ever loaded and the refresh failed, one "Radar unavailable" block replaces the XCenter, PaPA,
Services, Timing and Dispatchers modules: the cause in one paragraph, "Failing since HH:MM", the
retry cadence with "Use Refresh above to try now", and Technical details; the page keeps one
refresh control. The status word appears once: while either is shown the header drops its status.
The header status word's plain-language description is a Tooltip on the focusable status, not a
native `title`.

The sidebar client readout (server mode) is a focusable `<output>`, not a button: the icon beside
the count stacked over "clients" (`--text-xs` count, `--text-2xs` regular word), so each line fits
the 86 px left of the icon in the 136 px button. It counts Relay client desktops and
Relay Web sessions connected to this server; zero is normal for a single workstation, so it is muted
and its tooltip says so. Neither line ever ellipsises; the full sentence ("N clients connected to
this Relay server") is its
accessible name and the connected hostnames are in its tooltip, opened by hover or focus.

Status readouts state time of day with `formatOpsTime` (`utils/opsTime.ts`), the header clock's
12-hour form (`2:01 PM`): "Updated", "Failing since", "Next check", "Checked", "paused until".
Features do not keep their own time formatters or call bare `toLocaleTimeString()`.

## Server List Import

Data Manager defaults to **Add or update**. Choosing Servers exposes **Sync full list**,
which first previews the complete file without writes. Show the file name, current and incoming
counts, four outcome counts, expandable additions/updates, and a scrollable list containing every
removal. Keep the removal count and action explicit: **Sync and Remove N Servers** requires
an unchecked-by-default review checkbox. Offer **Download Current List** and **Cancel Preview**
before applying. Lock mode, category, navigation, and dismissal while an operation is busy.
Report confirmed counts and errors after completion; do not leave a consumed preview available
to retry. Explain that omissions remove shared records and that completed changes may remain
if a later step fails.
