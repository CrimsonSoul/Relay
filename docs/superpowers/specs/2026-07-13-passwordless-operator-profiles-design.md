# Passwordless Operator Profiles and Dynatrace Problem Links Design

**Date:** 2026-07-13
**Status:** Approved for implementation

## Summary

Relay will add shared passwordless operator profiles for human attribution. Each operator selects their name once on their own laptop, and Relay remembers that selection locally. Genuine attribution fields will use the selected operator instead of the workstation hostname. Profiles do not authenticate users, grant permissions, or change Relay's existing server/client passphrase.

Relay will also correct the Problems tab's `Open Dynatrace` action. The action currently opens only the configured tenant origin. It will instead open the selected Grail problem directly in the Dynatrace Problems app.

## Goals

- Give each operator a recognizable identity across genuine Relay attribution fields.
- Keep operator selection passwordless and low-friction.
- Remember the selected operator separately on each laptop.
- Synchronize the operator roster to every Relay client over the existing LAN data connection.
- Let the Relay server add, rename, deactivate, and reactivate operators.
- Preserve historical names when a profile is renamed or deactivated.
- Support attributed offline actions through Relay's existing pending-sync path.
- Open the exact Dynatrace problem represented by a Relay problem record.
- Preserve current Relay server/client connectivity and authentication behavior.

## Non-goals

- Operator profiles are not login accounts and provide no authentication or authorization boundary.
- This work will not add passwords, PINs, roles, per-user permissions, or individual PocketBase auth accounts.
- Operator selection will not replace hostnames used for client discovery, presence, diagnostics, or network administration.
- Cosmetic Alert `To` and `From` values will not be replaced by the selected operator.
- Existing history will not be rewritten or backfilled.
- Internal machine attribution such as `conflict_log.overwrittenBy = "client"` will remain system-generated.
- Operators cannot be permanently deleted through Relay.

## Initial Operator Roster

The operator collection will be seeded once, when it is first created and empty, with these active profiles:

- Ryan Bell
- Tristan Stillwell
- Vlad McCarty
- Paris Carlson
- Connor McElroy
- Weston Yokley
- Charles Gibbs

The seed must be idempotent. Later renames or deactivations must not cause an original seed name to be recreated.

## Operator Data Model

Add a server-owned base collection named `relay_operators` with these fields:

```ts
type RelayOperatorRecord = {
  id: string;
  displayName: string;
  active: boolean;
  created: string;
  updated: string;
};
```

Authenticated Relay clients may list, view, and subscribe to the collection. Direct client creates, updates, and deletes are forbidden. A server-mode main-process manager performs validated profile changes with administrative PocketBase access.

Validation rules:

- Trim leading and trailing whitespace.
- Require a non-empty display name.
- Limit display names to 120 characters.
- Reject case-insensitive duplicate active or inactive names.
- Deactivation is reversible.
- Permanent deletion is not exposed.

Selectors sort active profiles alphabetically by display name. Settings presents active profiles first and inactive profiles second.

## Local Operator Selection

The selected operator ID is stored locally on each laptop. It is not synchronized because every operator has their own laptop and the choice represents that workstation's current human identity.

An app-level `OperatorProvider` owns:

- the synchronized operator roster;
- the locally selected operator ID;
- the resolved active operator record;
- selection persistence; and
- a common method for requiring attribution before an action.

At startup, Relay resolves the stored ID against the latest locally cached or server-provided roster. A valid active match becomes the current operator. A missing or inactive match clears the selection only after roster hydration completes; the initial loading state must not erase a valid stored choice.

Relay does not block general application startup when no operator is selected. Only an action that writes human attribution is blocked. Relay then opens the operator picker and explains that an operator must be selected.

## User Interface

### Sidebar selector

Add a compact operator control to the sidebar footer immediately above Settings and below other operational footer tools. It displays:

- `Select operator` when no active profile is selected; or
- the selected operator's name and initials when selected.

Activating the control opens a keyboard-accessible picker containing active profiles. Selecting a profile updates the local choice immediately. The control remains visible so an operator can correct an accidental selection.

The selector must match Relay's existing sidebar density, typography, focus treatment, dark theme, and accent-color behavior. It must not resemble an account-security or sign-in control.

### Settings management

Add an `Operators` section to Relay Settings. In server mode it supports:

- adding a profile;
- renaming a profile;
- deactivating an active profile; and
- reactivating an inactive profile.

Deactivation requires a short confirmation explaining that history is retained and the profile can be reactivated. No delete action is shown.

Client-mode Relay does not expose management actions. Clients receive roster changes through the existing collection subscription and use the sidebar selector.

## Attribution Contract

Every genuine human-attribution write obtains this value from `OperatorProvider`:

```ts
type OperatorAttribution = {
  operatorId: string;
  operatorName: string;
};
```

Records store both the stable operator ID and a snapshot of the display name. Rendering history uses the snapshot, not the current operator record. Consequently:

- renaming a profile changes new actions only;
- deactivating a profile never changes old history; and
- records remain understandable if a profile is unavailable.

Current human attribution fields covered by this design are:

| Feature | Stable identity field | Name snapshot field |
| --- | --- | --- |
| Dynatrace problem note | `operatorId` | existing `author` |
| Dynatrace local disposition | `operatorId` | existing `addressedBy` |
| Scheduled alert reminder | `operatorId` | existing `createdBy` |

Future genuine attribution fields must use the same app-level contract rather than reading a hostname or form field directly.

### Scheduled alert compatibility

`alert_reminders.createdBy` currently also acts as the saved Alert `From` value when a reminder is reopened. These meanings must be separated:

- `createdBy` becomes the selected operator name snapshot.
- `operatorId` stores the stable operator identity.
- A new optional `alertSender` field preserves the cosmetic Alert `From` value.
- Reopening a new reminder uses `alertSender` for the form's `From` field.
- Reopening an older reminder without `alertSender` falls back to its existing `createdBy` value, preserving prior behavior.

Alert history `sender` and `recipient` fields remain cosmetic and unchanged.

## Offline and Realtime Behavior

Add `relay_operators` to the client offline-cache allowlist. The cached roster allows a previously selected operator to resolve during an offline cold start.

Attributed offline actions save the selected operator ID and name snapshot in the queued mutation. They use Relay's normal optimistic cache and pending-sync behavior. A profile deactivated on the server while a laptop is offline may still author actions until that laptop reconnects and receives the change; those already-created actions remain valid historical records. After the roster refresh, Relay clears the inactive selection and requires another active operator for new attributed actions.

Roster creates and updates propagate through PocketBase realtime subscriptions. If a connected laptop's selected operator becomes inactive, Relay clears the selection and shows one informational toast. Rename events update the selector label immediately while leaving stored historical snapshots untouched.

Operator management is unavailable offline and is never added to the pending mutation queue.

## Dynatrace Problem Deep Link

The current button passes `problem.environmentUrl` directly to `openExternal`, which can only open the tenant landing page. Relay already stores the Grail problem identifier from `event.id` in `problem.problemId`.

Add a shared URL builder that:

1. Revalidates and normalizes the saved Dynatrace tenant origin.
2. URL-encodes `problem.problemId` as one path segment.
3. Builds this Dynatrace Platform route:

```text
https://<tenant>.apps.dynatrace.com/ui/apps/dynatrace.davis.problems/problem/<encoded-event.id>
```

4. Clears unrelated query parameters and fragments.
5. Passes the completed URL through Relay's existing trusted external-open handler.

If the origin or problem ID is invalid, Relay does not open a fallback homepage. It shows an error toast that the problem link could not be created.

The new Problems app route is appropriate because Relay's source records come from Grail `dt.davis.problems` and the stored `problemId` is the corresponding `event.id`.

## Data Flow

### Roster and local selection

```text
Relay server -> relay_operators -> realtime/cache -> OperatorProvider
                                                        |
local selected ID --------------------------------------+
                                                        |
                                                        v
                                              active operator context
```

### Attributed action

```text
operator action -> require selected operator
                         |
                         +-> missing: open picker, do not write
                         |
                         `-> selected: write operatorId + name snapshot
                                              |
                                              +-> PocketBase when online
                                              `-> pending mutation when offline
```

### Operator management

```text
server Settings -> trusted IPC -> operator manager -> PocketBase admin write
                                                        |
                                                        `-> realtime update to clients
```

## Error Handling

- Roster load failure preserves any usable cached roster and reports the shared-data error through existing collection state.
- A selected ID that cannot resolve to an active profile is cleared rather than falling back to a hostname.
- An attributed action without an active operator performs no partial write.
- Duplicate or invalid profile names produce inline Settings errors.
- Failed profile writes leave the existing roster unchanged and show an error toast or inline error.
- Deactivation and rename races use the latest server record; a stale management write reports a conflict instead of silently overwriting newer data.
- Offline attributed writes retain their name snapshot even if the operator is later renamed or deactivated.
- Invalid Dynatrace origins or IDs never reach the external-open handler.

## Migration and Compatibility

Collection bootstrap patches the new optional attribution fields non-destructively:

- `dynatrace_problem_notes.operatorId`
- `dynatrace_problem_states.operatorId`
- `alert_reminders.operatorId`
- `alert_reminders.alertSender`

Existing records remain valid. Their current `author`, `addressedBy`, and `createdBy` values render exactly as stored. No attempt is made to match old hostnames or names to new operator profiles.

The existing shared PocketBase app account and Relay passphrase remain unchanged. Server and client startup, discovery, presence, cached cold start, and reconnect authentication continue to use their current paths.

## Testing

### Collection and manager tests

- Bootstrap creates `relay_operators` with authenticated read and server-owned write rules.
- An empty new collection receives the seven initial profiles exactly once.
- Restarting after rename or deactivation does not recreate seed names.
- Add, rename, deactivate, and reactivate validate and persist correctly.
- Duplicate names are rejected case-insensitively.
- Permanent deletion is not exposed.
- Untrusted IPC senders and client-mode management requests are rejected.

### Operator context and UI tests

- The sidebar shows `Select operator` without a selection.
- Selecting an active operator persists its ID locally and survives restart.
- Inactive profiles do not appear in the normal picker.
- A rename updates the selected label without changing the stored ID.
- Deactivation clears a matching selection and produces one notification.
- An attributed action with no selected operator is blocked and opens the picker.
- The Operators Settings section supports the approved server-mode actions and no delete action.
- Keyboard navigation, focus return, accessible names, and contrast meet Relay's existing UI requirements.

### Attribution tests

- Dynatrace notes save `operatorId` and the selected name in `author`.
- Local dispositions save `operatorId` and the selected name in `addressedBy`.
- Alert reminders save `operatorId`, the selected name in `createdBy`, and the cosmetic sender in `alertSender`.
- Reopening a new reminder restores `alertSender` into the cosmetic `From` field.
- Reopening an old reminder falls back to its historical `createdBy` sender.
- Alert history sender and recipient values remain unchanged.
- Offline mutations retain operator attribution and synchronize through the existing queue.
- Existing hostname-based history renders without migration.

### Dynatrace link tests

- A valid `.apps.dynatrace.com` origin and Grail event ID produce the exact Problems-app detail route.
- A classic SaaS origin normalized by current settings produces the corresponding Platform tenant route.
- Reserved characters in the problem ID are encoded as one path segment.
- Empty IDs, non-Dynatrace origins, credentialed URLs, and path-bearing origins are rejected.
- Clicking `Open Dynatrace` sends the completed detail URL to the trusted external-open API.

### Regression verification

- Server and client Relay instances still authenticate and synchronize normally.
- A client can cold-start from cache with its roster and local selection.
- Client presence still displays hostnames for connectivity diagnostics.
- Dynatrace notes still remain append-only and local disposition still requires a note.
- No cosmetic Alert `To` or `From` behavior changes.

## Acceptance Criteria

- Every listed operator is available on a newly upgraded Relay server.
- Each laptop remembers its selected active operator across restarts.
- Genuine attribution fields use the operator name instead of the hostname or cosmetic form values.
- History retains the original name snapshot after profile changes.
- Only server-mode Settings can manage the shared roster.
- Clients receive roster changes without restarting Relay.
- Attributed offline actions synchronize without losing operator identity.
- The Problems tab opens the selected Grail problem directly in Dynatrace.
- Existing client/server, offline, Problems, and Alert behavior remains functional.
