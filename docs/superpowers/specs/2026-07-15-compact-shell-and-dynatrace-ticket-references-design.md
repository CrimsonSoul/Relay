# Compact Shell and Dynatrace Ticket References Design

**Date:** 2026-07-15

**Status:** Approved

## Goal

Keep Relay usable when its window occupies roughly half of a 1080p display, and let NOC operators mark a Dynatrace problem addressed when they have recorded either a Service Desk ticket number, a manual note, or both.

## Scope

This change covers:

- automatic compact behavior for the main Relay sidebar and header clock;
- compact-width behavior for the Dynatrace Problems workspace;
- Service Desk ticket-number notation in the existing local response workflow;
- the addressed-locally visual state.

This change does not create, update, validate, or link to tickets in Service Desk. It does not add another technician selector. The existing selected Relay operator remains the attribution source for notes, ticket references, and local disposition changes.

## Compact Application Shell

Relay will respond to available window width rather than Electron's maximize or fullscreen state. This keeps the interface correct for snapped windows, resized windows, different display scaling, and smaller monitors.

At viewport widths of `1200px` or less:

- the main sidebar changes from its current `136px` labeled rail to a `64px` icon rail;
- navigation and footer labels are visually hidden while existing icons remain centered;
- every sidebar control retains its accessible name, keyboard focus treatment, active rail, and tooltip;
- the compact brand control remains recognizable without consuming label width;
- the world clock is hidden;
- the header search and breadcrumb use the reclaimed space without changing their information architecture.

Above `1200px`, Relay keeps the current labeled sidebar and clock.

The transition is CSS-driven and structural. Relay will not add a manual collapse preference, persist collapse state, or add renderer-to-main window-state IPC.

## Compact Problems Workspace

The Problems tab will continue using its list/detail master-detail layout while the content remains usable. At `900px` viewport width or less, the workspace will stack the queue above the selected-problem detail.

The compact layout must:

- preserve access to filtering, alerting profiles, search, refresh, queue selection, notes, ticket references, the local disposition action, and the Dynatrace link;
- avoid horizontal page overflow;
- keep the local response controls and history readable without clipping;
- preserve keyboard order and visible focus;
- allow vertical scrolling inside the active work area.

Visual verification will cover `1920x1080`, `960x1000`, and `840x1000` renderer viewports.

## Local Response Inputs

The local response area will contain two independent inputs:

1. **Service Desk ticket number** — a single-line notation field.
2. **NOC note** — the existing multiline manual note field.

The ticket field will include copy explaining that Relay records a reference only and does not create or update a Service Desk ticket.

A problem may be marked addressed locally when at least one of these is true:

- the problem already has a saved local history entry;
- the operator has entered a non-empty ticket-number draft;
- the operator has entered a non-empty note draft.

Operators may enter a ticket number, a note, or both. No new Technician control is added; attribution continues to use the active Relay operator selected for the laptop.

## Ticket Reference Validation and Storage

Ticket numbers are notation, not externally verified identifiers. Relay will:

- trim leading and trailing whitespace;
- accept any non-empty single-line value;
- cap the value at 120 characters;
- avoid imposing an `INC`, `REQ`, `CHG`, or other Service Desk prefix.

Ticket references will reuse the existing append-only `dynatrace_problem_notes` mutation and synchronization pipeline. Relay stores the human-readable note value as:

```text
Ticket: <normalized ticket number>
```

This choice preserves:

- selected-operator attribution;
- PocketBase-created timestamps;
- LAN synchronization;
- offline mutation queueing;
- append-only history;
- readability on older Relay clients;
- the current one-year Dynatrace history retention behavior.

It does not require another collection or a destructive schema migration.

Relay-created values with the exact `Ticket: ` prefix are presented in history as ticket-reference entries. Their operator and timestamp use the same metadata presentation as manual notes.

## Save Ordering and Failure Behavior

When an operator marks a problem addressed with unsaved response input, Relay performs these steps in order:

1. require the currently selected Relay operator;
2. save the ticket reference when present;
3. save the manual note when present;
4. mark the problem addressed locally.

Each draft is cleared only after its corresponding history mutation succeeds. If ticket-reference or note persistence fails, Relay does not apply the addressed state, retains the failed and unattempted draft values, and shows the error through the existing toast path. If history saves succeed but the disposition mutation fails, the saved history stays recorded while the problem remains unaddressed.

When offline, the same ordering is submitted through the existing mutation gateway. Ticket and note mutations are queued before the state mutation. Reconnect behavior remains unchanged.

The separate **Add ticket reference** and existing **Add note** actions allow either item to be timestamped without immediately changing disposition. A saved ticket reference or saved manual note then satisfies the addressed requirement.

## Addressed-Locally State

The `Addressed locally` badge will use Relay's fixed informational blue tokens:

- border: `--info`;
- restrained tinted background derived from `--info`;
- text: `--info-bright`.

This treatment appears consistently in the queue and selected-problem detail. The text label and chip shape remain, so color is not the only state signal. Dynatrace-resolved problems remain green, and active problem severity remains red, amber, or informational according to the existing severity rules.

## Accessibility

- Compact sidebar controls retain semantic buttons, accessible names, tooltips, and visible focus.
- Hiding labels and the clock is visual only; no navigation function is removed.
- Ticket and note inputs have explicit labels and requirements copy associated with the disposition action.
- The addressed badge combines blue color with the explicit `Addressed locally` label.
- Responsive reflow preserves logical DOM and keyboard order.
- Existing reduced-motion behavior remains unchanged.

## Testing and Verification

Implementation will follow test-driven development and cover:

- the `1200px` compact-shell breakpoint, icon-only sidebar rules, and hidden clock;
- preservation of accessible sidebar labels and tooltips;
- the `900px` Problems workspace stack;
- ticket-only enabling and successful addressing;
- note-only enabling and successful addressing;
- ticket plus note save ordering before disposition;
- existing saved response history satisfying the requirement;
- operator attribution on ticket-reference history;
- ticket trimming, empty rejection, single-line behavior, and the 120-character limit;
- offline mutation ordering and reconnect compatibility;
- failure of a ticket or note save preventing the addressed mutation;
- informational-blue addressed badge styling in queue and detail;
- existing resolved, active severity, return-to-queue, note, and attribution behavior.

Final verification will include focused renderer and service tests, the broader repository gates, and runtime screenshots at `1920x1080`, `960x1000`, and `840x1000`.

## Non-Goals

- Creating or modifying Service Desk tickets.
- Validating ticket numbers against Service Desk.
- Making ticket references clickable without an approved Service Desk URL contract.
- Adding a second technician or operator selector.
- Changing the global operator-selection model.
- Adding a manual sidebar-collapse preference.
- Redesigning unrelated Relay tabs.
