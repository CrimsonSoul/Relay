# Compose Teams Handoff Design

**Date:** 2026-08-04

**Status:** Approved

**Surface:** Relay Compose

**Constraint:** No Microsoft Graph API access

## Problem

Compose is primarily used to assemble recipients and open a Teams meeting draft, with copying the
recipient list as the reliable fallback. The current command bar gives the rarely used Schedule
action similar prominence, and `Start Bridge` implies that Relay can create or start a meeting.
Relay can only request that Teams open a draft.

The existing recording confirmation is also too weak. It interrupts the operator with `I
Understand` but does not summarize the handoff or make the recording reminder appropriately
prominent.

## Goals

- Make the Teams draft the single primary Compose action.
- Keep recipient copying immediately available as the fallback.
- Move scheduling out of the primary workflow without removing it.
- Replace the recording acknowledgment with a useful handoff review.
- Make the recording reminder visually prominent without adding a required checkbox.
- Show only information Relay already has in the current Compose state.
- Normalize and validate the recipient set before handoff.
- Record history only after a locally observable handoff succeeds.
- Keep the interaction fast for incident-response use.

## Non-goals

- Microsoft Graph integration.
- Creating, sending, or confirming a Teams meeting.
- A bridge packet, copied handoff summary, incident form, or incident template system.
- Importing Servers, Alerts, Cloud Status, or Dynatrace Problems into Compose.
- A wizard or multi-stage Compose workflow.
- Requiring an operator to check an acknowledgment box.
- Redesigning saved groups, Bridge History, or the recipient rows beyond what this handoff needs.
- Changing the existing Schedule dialog or calendar-file behavior beyond moving its entry point.

## Approved Interaction Design

### Compose command bar

Preserve the current saved-groups and recipients workspace.

The command hierarchy becomes:

1. **Open Teams Draft** — primary action.
2. **Copy Recipients** — visible secondary action.
3. **More** — an accessible overflow menu containing **Create Calendar Invite**.

Reset and History remain visible utility actions. Undo remains contextual and appears only when an
operator has removed a recipient. Recipient sorting moves from the global command cluster to the
Recipients pane header because it changes the list presentation rather than the handoff.

The current `Ready · N selected` page status is replaced with a neutral recipient count. Relay must
not claim readiness until it has evaluated the current recipient set.

### Handoff review

Selecting **Open Teams Draft** opens one review modal. This replaces the current Meeting Recording
confirmation; it does not add another step.

The modal title is **Open Teams meeting draft?** and it contains:

- the exact subject Relay will pass to Teams;
- total normalized recipient count;
- duplicate count;
- selected group names;
- manual-addition count;
- recipient validation result; and
- an expandable list of the normalized recipients.

The modal does not include on-call matches or unrelated operational data. Although the Compose
component currently receives on-call records, those records are not necessary to make the handoff
decision and would add noise.

The footer actions are:

- **Cancel**;
- **Copy Recipients**; and
- **Open Teams Draft** as the primary action.

### Recording reminder

The first element in the modal body is a high-prominence amber notice:

> **Enable recording in Teams**
>
> Start recording as soon as the bridge begins. Relay cannot enable or verify it for you.

The notice uses an icon, strong border treatment, and clear heading, but it is informational rather
than an error. It has no checkbox and does not disable the primary action. The modal itself provides
the necessary interruption; a mandatory acknowledgment would add friction without proving that
recording was enabled.

### Teams handoff semantics

Relay retains the existing no-Graph handoff:

1. Request the allowlisted `msteams:` meeting-draft URL.
2. If the desktop protocol is refused, request the allowlisted Teams web URL.
3. If either request is accepted, close the modal, report **Teams draft requested**, and save the
   composition to Bridge History.
4. If both requests fail, keep or restore the review state, show **Could not open Teams draft**, and
   do not save history.

An accepted external-open request proves only that the operating system accepted the handoff.
Relay must never label this result `started`, `created`, `sent`, or `invited`.

While either external-open request is pending, the modal buttons are disabled and the primary action
shows an in-progress state. This prevents duplicate handoffs and duplicate history entries.

### Copy behavior

**Copy Recipients** writes the normalized recipients as the existing semicolon-separated Outlook
list. It is available in both the Compose command bar and the review modal.

- On success, show **Recipients copied** and save the composition to Bridge History.
- On failure, show **Could not copy recipients** and do not save history.
- Disable repeated copy actions while the clipboard request is pending.
- Disable copying while invalid recipient values remain, using the same actionable validation state
  as the Teams handoff.

Copying does not close the review modal, allowing the operator to use it as a fallback and still try
the Teams draft afterward.

### Schedule behavior

The existing Schedule functionality remains available as **Create Calendar Invite** inside the More
menu. Its `.ics` creation, validation, and review-and-send messaging remain unchanged. It is not
included in the handoff review and does not gain additional fields in this scope.

## Recipient Normalization and Validation

The handoff recipient set is derived from the current selected groups, manual additions, and manual
removals.

- Compare email identities case-insensitively.
- Collapse duplicates while preserving the first canonical display value.
- Apply manual removals case-insensitively.
- Validate every resulting value as an email address before enabling the Teams handoff.
- Display invalid values in the expanded recipient list with a direct Remove action.
- Disable **Open Teams Draft** and **Copy Recipients** while invalid values remain.
- Keep Reset, History, and recipient correction controls available.

The review displays a concise healthy state such as `12 recipients · no address issues` or an
actionable warning such as `2 addresses need attention`.

## Existing Data Used

No new external data source is required. The review uses:

- `BridgeGroup.name` and `BridgeGroup.contacts`;
- `Contact.name` and `Contact.email` for recipient display;
- selected group IDs;
- manual additions and removals;
- the existing generated Teams subject; and
- local handoff results from clipboard and external-open calls.

The unused Compose `onCall` prop is not incorporated or removed as part of this feature. Removing it
would be unrelated cleanup and can be considered separately.

## History

This scope preserves the current Bridge History record shape and replay behavior. The behavioral
change is when a record is created:

- after a successful clipboard write; or
- after Teams desktop or web handoff is accepted.

Failed or abandoned attempts do not create history. A single user action creates at most one entry.
Within the current Compose session, successful Copy and Teams actions against the same unchanged
composition reuse the already-saved snapshot instead of creating adjacent duplicates. Changing the
selected groups or manual additions/removals makes the composition eligible for a new entry. No
action type, delivery claim, packet, or audit schema is added in this scope.

## Accessibility and Responsive Behavior

- The More button has an accessible name and opens the shared keyboard-operable menu.
- The handoff modal follows the shared focus trap, Escape, focus restoration, and initial-focus
  behavior.
- The recording notice has a heading and descriptive text; it is not an assertive alert.
- Validation details are connected to the invalid-recipient summary.
- The expandable recipient list and Remove controls are keyboard operable.
- Sorting has a programmatic label and remains adjacent to the Recipients heading.
- On narrow layouts, the primary and secondary handoff actions remain visible; utility controls may
  collapse according to the existing responsive command-bar behavior.

## Error Handling

- Clipboard rejection: keep the current composition and modal state; show a specific error; write no
  history.
- Teams desktop refusal followed by web acceptance: treat as a successful handoff request and write
  one history entry.
- Both Teams paths refused: retain review information; show a specific error; write no history.
- Invalid recipients: prevent Teams handoff and identify the values that need removal.
- History write failure after a successful local handoff: report that the draft/copy succeeded but
  history could not be saved. Do not repeat the external action automatically.

## Verification

Focused automated coverage will verify:

- command hierarchy, Schedule placement, and disabled zero-recipient state;
- handoff-review content and prominent recording reminder;
- absence of a required acknowledgment checkbox;
- case-insensitive deduplication and removal;
- invalid-recipient blocking and correction;
- clipboard success/failure history semantics;
- Teams desktop, web-fallback, and total-failure history semantics;
- unchanged-composition history deduplication;
- pending-state duplicate-action protection;
- keyboard access to More, sorting, recipient expansion, and removal; and
- responsive command-bar behavior.

Before completion, run the repository's required typecheck, lint, formatting, unit-test, build, and
diff checks. Because the work changes Electron external handoff behavior, also run the Electron test
suite. Run the Relay Web suite if the shared browser runtime or More-menu behavior changes.

## Acceptance Criteria

- An operator can assemble recipients and immediately identify Open Teams Draft as the primary next
  action.
- Copy Recipients remains visible without opening a menu.
- Create Calendar Invite remains available but no longer competes with the primary workflow.
- The review modal prominently instructs the operator to enable recording.
- The review gives enough recipient information to catch an obvious handoff mistake without adding
  incident-management fields.
- Relay makes no claim that a meeting was created, sent, or started.
- Failed copy or Teams handoff attempts do not appear in Bridge History.
- No Graph API, bridge packet, copied summary, acknowledgment checkbox, or new incident model is
  introduced.
