# Relay Tab Operator Workflow Improvements Design

## Status

Approved on 2026-08-05.

This design preserves confirmed cloud degradations at a high threshold and supersedes only the renderer degradation-suppression portions of `2026-07-20-cloud-status-outage-toasts-design.md`. It does not change the approved Dynatrace-first notification priority, cloud-outage queue behavior, or provider-feed architecture.

## Problem

Relay's primary tabs already cover the right operational domains, but several interactions still create avoidable uncertainty or expose low-frequency actions at the same level as the primary workflow:

- Header search performs actions whose effects are not explicit. Selecting a contact can change Compose recipients, while selecting a server opens Servers without focusing the matching record.
- Cloud Status correctly detects warning-level degradation, but its two-observation threshold can notify roughly one minute after the first warning. That is confirmation, but not the high threshold required for degradation to compete for operator attention.
- Alerts gives reset, history, alarm management, template pinning, image export, alarm scheduling, and Outlook delivery simultaneous toolbar weight even though Outlook delivery and image export are the dominant actions.
- Radar has no numeric navigation shortcut, Dynatrace Problem triage remains pointer-heavy, and compact sidebar navigation removes readable labels.

The On-Call coverage indicator is explicitly outside this work. It remains unchanged even though the critique identified it as a possible future improvement.

## Goals

- Make every search result's default action visible before activation.
- Keep lookup actions context-preserving and require a separate deliberate action for bridge mutation.
- Preserve real provider degradation in Cloud Status while requiring three independent observations spanning at least two minutes before notification.
- Keep outages immediate and preserve Dynatrace-first operational notification delivery.
- Make Outlook delivery the primary Alerts action and Save Image the most prominent secondary action.
- Move low-frequency Alerts utilities into progressive disclosure without removing them.
- Add complete numeric tab shortcut parity and bounded keyboard accelerators for Dynatrace triage.
- Keep compact navigation readable without permanently reducing the content area's width.
- Preserve Relay Desktop and Relay Web behavior, retained-tab state, offline behavior, and existing data semantics.

## Non-goals

- Computing or displaying truthful On-Call coverage health.
- Creating an incident object, incident dashboard, or shared incident lifecycle.
- Generating AI summaries or automatically choosing recipients, owners, runbooks, or alert content.
- Changing Cloud Status provider adapters, source severity classification, polling ownership, snapshot schemas, or cache formats.
- Removing degradation records from provider details or shared snapshots.
- Changing Outlook/EML export content, alert image rendering, click-through-link behavior, or alert-history persistence semantics.
- Adding new top-level tabs or permanently widening the compact sidebar.

## Search Actions and Exact Navigation

### Visible verbs

Each header-search result displays its activation verb in addition to its result type:

- Contact: `Open contact`
- Server: `Open server`
- Wiki document or passage: `Open document`
- Navigation command: its existing destination verb
- Bridge group: `Add group to bridge`

A contact result also exposes `Add to bridge` as a separate inline action. Activating the result body or pressing Enter performs `Open contact`; it never changes Compose recipients. Adding a contact to the bridge requires activating the inline action.

Bridge groups remain bridge-construction results because Relay has no independent group-detail workspace. Their displayed verb makes that mutation explicit before activation.

### Destination selection

Contact and server results carry the record's stable ID into Knowledge navigation. Relay opens the correct Knowledge destination and selects, scrolls to, and focuses the exact record after the retained tab becomes active. Navigation requests are one-shot and idempotent: revisiting a tab does not replay an earlier selection.

If the requested record disappeared between search and activation, Relay keeps the search query, leaves recipient state unchanged, and reports that the record is no longer available. Ordinary tab navigation and Wiki document navigation retain their current behavior.

### Component boundaries

- `HeaderSearch` owns visible result verbs, primary versus secondary activation, and keyboard semantics.
- `App` owns cross-tab routing and passes stable record-selection requests to Knowledge.
- `KnowledgeWorkspace`, `DirectoryTab`, and `ServersTab` own consuming a selection request and focusing the record they render.
- Existing Compose assembly hooks remain the only owners of recipient mutation.

## Cloud Degradation Qualification

### Visibility hierarchy

Cloud Status continues to show both outages and confirmed source-reported degradations. The hierarchy is:

1. Providers with active outages
2. Providers with active degradation
3. Providers with unavailable or unknown feeds
4. Operational providers

Outages retain error styling and immediate notification. Degradation retains warning styling and provider-detail visibility but remains visually secondary to an outage. Unknown stays distinct from healthy so missing feeds cannot be read as proof of health.

### High-threshold notification rule

An actionable warning becomes notification-eligible only when all of the following are true:

1. The same provider is warning-level in three distinct server observations.
2. At least two minutes elapsed between the first and qualifying observations.
3. Each observation has a distinct server-owned snapshot timestamp. Split PocketBase collection events from one server poll count once.
4. The provider feed is available.
5. The item is not ordinary planned or scheduled maintenance.
6. The provider has not escalated to an outage.

Emergency maintenance that affects live service remains actionable, matching current behavior.

The first warning observation starts a provider candidate with count one and a first-seen observation timestamp. Subsequent qualifying observations advance the count. Three observations that occur inside two minutes do not notify until a later observation satisfies the minimum duration.

Feed failure, recovery, disappearance of actionable warnings, or escalation to outage clears the degradation candidate. An active confirmed degradation notifies once and does not repeat or update until the provider recovers. Existing degradation at startup remains a silent baseline. Outage notification remains immediate and supersedes any pending degradation candidate.

### State ownership

`useAppCloudStatus` continues to own renderer-side notification qualification. It adds provider candidate first-seen timestamps alongside the existing candidate count and last-observation maps. Constants define the required observation count and duration so tests and implementation share one policy source.

The server continues its five-minute healthy interval and one-minute degraded interval. No polling or schema migration is required.

## Alerts Action Hierarchy

### Command bar

The Alerts command bar exposes two actions:

- Primary: `Open in Outlook` on Desktop or `Download Draft` on Relay Web
- Secondary: `Save Image`

An overflow action contains:

- Schedule Alarm
- Alarms
- History
- Pin Template
- Reset

All existing handlers, loading states, modal contents, confirmation dialogs, alert-history writes, reminder behavior, and export behavior remain unchanged. Reset remains protected by the existing dirty-draft confirmation.

The overflow trigger has a descriptive accessible name and exposes disabled/loading state when a currently running capture makes an action unsafe.

### Optional delivery details

The optional delivery section is collapsed by default. Its collapsed summary reports only configured state:

- Routing configured
- Link ready
- Timing configured
- Branding customized

Absent categories are omitted rather than reported as errors. Activating the summary expands the existing fields. Loading history, a template, or a reminder updates the summary without forcing expansion. When a validation or export failure identifies a specific optional-delivery field, Relay automatically expands the section and focuses that field.

## Navigation and Keyboard Efficiency

### Top-level shortcut parity

Cmd/Ctrl+7 opens Radar, subject to the same modal guard as Cmd/Ctrl+1-6. The Shortcuts modal and shortcut tests list all seven destinations.

### Dynatrace triage

While the Problems tab is active:

- Alt+Down selects the next unaddressed problem.
- Alt+Up selects the previous unaddressed problem.
- Alt+N focuses the selected problem's response-note editor.

Navigation wraps at the queue boundaries only when at least one unaddressed problem exists. Shortcuts do nothing while focus is in an input, text area, content-editable surface, select, or modal. They do not mark a problem addressed or submit a note.

When no unaddressed problem is available, Relay keeps the current selection and provides a concise informational toast. If a selected problem disappears during realtime refresh, the existing queue-selection fallback chooses the nearest remaining item before shortcut navigation resumes.

### Compact sidebar labels

At compact widths the sidebar retains its current resting width. Hovering the navigation rail or moving keyboard focus into it expands a labeled overlay above the content without reflowing the active tab. The overlay closes only after both pointer hover and focus leave the rail.

The expanded state preserves active-tab, Radar status, client-presence, Dynatrace-dashboard, and Settings semantics. Reduced-motion mode removes width animation while retaining the same readable state. Pointer and keyboard users receive identical labels; tooltips remain a fallback rather than the only label source.

## Error Handling and Accessibility

- Search activation never silently falls back from `Open` to `Add to bridge`.
- Failed record selection preserves the search query and reports an actionable recovery message.
- Feed errors neither advance nor preserve a pending degradation candidate.
- Degradation timing uses server observation timestamps, not renderer arrival time, so reconnect bursts cannot manufacture confirmation.
- Destructive Alerts actions retain existing confirmations after moving into overflow.
- Overflow, collapsed delivery details, result secondary actions, and expanding sidebar are fully keyboard operable with visible focus.
- New status and summary text is exposed semantically and never relies on color alone.
- Shortcuts are documented and suppressed in editable or modal contexts.
- Desktop and web runtimes use the same renderer interaction model while retaining their different Outlook/EML action labels.

## Compatibility and Data Boundaries

- No PocketBase collection, migration, shared record type, authentication, or client/server protocol changes are required.
- Search navigation uses renderer-owned ephemeral requests and stable existing record IDs.
- Cloud snapshots and warning items remain unchanged; only renderer qualification state changes.
- Alert drafts, history, reminders, images, and Outlook/EML payloads retain existing persistence and export formats.
- Retained tab mounting remains intact, including unsaved Alerts content and selected Dynatrace queue state.
- Relay Web remains at feature parity for every changed interaction.

## Verification

Implementation uses red-green TDD for each behavior slice.

### Search

- `HeaderSearch` tests cover visible verbs, Enter performing context-preserving open, separate contact bridge activation, explicit group mutation, exact server/contact navigation, keyboard behavior, and missing-record recovery.
- Knowledge, Directory, and Servers tests cover one-shot selection, scrolling/focus, retained-tab activation, and a record disappearing before navigation completes.
- App integration tests prove lookup does not mutate Compose and deliberate secondary activation does.

### Cloud Status

- Hook tests cover three distinct observations, the two-minute minimum, duplicate timestamps, split collection events, reconnect bursts, recovery reset, feed-error reset, scheduled-maintenance exclusion, emergency-maintenance inclusion, outage escalation, silent startup baseline, one notification per degradation episode, and immediate outages.
- Cloud Status tab tests preserve outage-before-degradation ordering, lower warning emphasis, healthy/unknown distinction, counts, provider details, and responsive behavior.

### Alerts

- Tests cover Outlook/Download Draft as primary, Save Image as secondary, the overflow action inventory, existing handler behavior, capture loading, reset confirmation, and keyboard access.
- Alert form tests cover default collapse, configured-state summaries, loaded-draft updates, automatic expansion for actionable validation failures, and preservation of draft data.

### Navigation

- Shortcut tests cover Cmd/Ctrl+7, modal suppression, editable-target suppression, Problems-only Alt shortcuts, unaddressed navigation, boundary wrapping, empty queues, note focus, realtime selection fallback, and Shortcuts modal copy.
- Sidebar tests and visual contracts cover overlay expansion on hover and `focus-within`, non-reflowing content, pointer/focus exit behavior, active/status labels, and reduced motion.

### Completion gates

Run the narrowest affected renderer tests after every slice. Before completion, run:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:electron
npm run test:web
npm audit --audit-level=high --omit=dev
git diff --check
```

Windows packaging is not required because this design changes renderer behavior only. Any formatter or commit-hook change requires diff inspection and rerunning the affected gates.
