# Remote Operator Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Invoke `superpowers:test-driven-development` before each production change and `superpowers:verification-before-completion` before each completion claim.

**Goal:** Let Ryan Bledsoe administer Relay's operator roster, privileged accounts, publisher assignment, paired devices, and approved server settings from either the server PC or a paired work laptop while all normal operators remain passwordless.

**Architecture:** Extend the signed command catalog created by the privileged-access foundation. The server resolves each command through small domain managers that reuse the existing `RelayOperatorManager`, enforce current revisions, and write bounded audit-safe command results. Administrator capabilities cover every supported Relay administration operation; publisher capabilities remain Knowledge Base-only. Settings presents a read-only roster to ordinary operators and an authenticated Administration area to the administrator. Secrets may be replaced but are never returned, and server-filesystem browsing remains local to the server PC.

**Tech Stack:** Electron 42, TypeScript 6, React 19, PocketBase SDK 0.26.8, Zod 4, Vitest, Testing Library, Playwright.

**Dependency:** Complete and verify `docs/superpowers/plans/2026-07-15-privileged-access-foundation.md` first. Reuse its roles, capabilities, session manager, paired-device keys, signed envelope, command processor, rate limits, and narrow bridge; do not create a second privileged protocol.

## Global Constraints

- The normal operator selector remains passwordless attribution. It does not grant admin or publisher access.
- The authoritative initial roster is exactly nine people: Charles Gibbs, Connor McElroy, Paris Carlson, Ryan Bell, Ryan Bledsoe, Tristan Bowles, Tristan Stillwell, Vlad McCarty, and Weston Yokley.
- Ryan Bledsoe is the sole initial administrator. Tristan Bowles and every other non-designated profile are normal operators.
- Exactly zero or one active non-admin operator may be Knowledge Publisher. Reassignment must never leave two authoritative publishers.
- Publisher sessions cannot add, rename, activate, deactivate, assign roles, manage devices, change Relay settings, or manage privileged credentials.
- Operator records are deactivated, not deleted. Existing attribution snapshots remain unchanged.
- High-risk actions require a fresh, command-bound, single-use reauthentication proof.
- Existing secrets are represented only as `Configured` or `Not configured`; no bridge or response may reveal current values.
- Path-dependent server operations remain local to the server PC. Remote administration accepts typed, path-independent fields only.
- All remote mutations are online-only signed commands with request ID idempotency and expected revisions; none enter the offline mutation queue.
- Keep current client sync, reconfigure, offline reading, and ordinary feature behavior unchanged.

---

## File Structure

### Shared contracts

- Extend `src/shared/privilegedAccess.ts` with administrator-facing account, assignment, device, setting, and audit summary views.
- Extend `src/shared/privilegedCommands.ts` with typed operator, publisher, account, device, and setting payload/result entries.
- Extend `src/shared/operators.ts` only where a current revision/public role view is needed; keep attribution types backward compatible.
- Add focused tests under `src/shared/__tests__/`.

### Main process

- Extend `src/main/operators/RelayOperatorManager.ts` with read helpers and revision-safe commands while preserving existing server-owned PocketBase writes.
- Create `src/main/privileged/PrivilegedAccountManager.ts` for administrator password state, enable/disable, and password reset/change.
- Create `src/main/privileged/PublisherAssignmentManager.ts` for single-publisher assignment and revocation.
- Create `src/main/privileged/PrivilegedDeviceManager.ts` for list/rename/revoke.
- Create `src/main/privileged/RelayAdministrationService.ts` for allowlisted settings summaries and replacements.
- Create `src/main/privileged/registerAdministrationCommands.ts` to register typed handlers with `PrivilegedCommandProcessor`.
- Update lifecycle state only where new managers require startup/disposal.

### Renderer

- Replace the server-only behavior in `src/renderer/src/components/settings/OperatorSettingsSection.tsx` with capability-aware read/manage behavior.
- Create `src/renderer/src/components/settings/AdministrationSettings.tsx` and focused panels under `src/renderer/src/components/settings/administration/`.
- Create `src/renderer/src/hooks/useRelayAdministration.ts` for signed command submission, refresh, conflict recovery, and public data normalization.
- Extend Settings CSS and tests for role chips, compact layout, dialogs, focus, and disabled/offline states.

### Documentation

- Update `docs/architecture.md` and `docs/SECURITY.md` with the authorization matrix, high-risk actions, secret-redaction rule, and local-only filesystem boundary.

---

## Task 1: Extend Typed Command and Administration View Contracts

**Files:**

- Modify: `src/shared/privilegedAccess.ts`
- Modify: `src/shared/privilegedCommands.ts`
- Modify: `src/shared/operators.ts`
- Modify: `src/shared/__tests__/privilegedAccess.test.ts`
- Modify: `src/shared/__tests__/privilegedCommands.test.ts`
- Modify: `src/shared/operators.test.ts`

- [ ] Write failing tests for the full administrator/publisher authorization matrix, strict payload parsing, expected revisions, display-name normalization, publisher eligibility, secret-summary redaction, and bounded public views.
- [ ] Run `npx vitest run src/shared/__tests__/privilegedAccess.test.ts src/shared/__tests__/privilegedCommands.test.ts src/shared/operators.test.ts` and confirm RED at the missing command/view members.
- [ ] Add these command payloads to `PrivilegedCommandPayloadMap`:

```ts
type AdministrationCommandPayloads = {
  'administration.snapshot.read': Record<string, never>;
  'operator.create': { displayName: string };
  'operator.rename': { operatorId: string; displayName: string; expectedRevision: number };
  'operator.active.set': { operatorId: string; active: boolean; expectedRevision: number };
  'publisher.assign': {
    operatorId: string | null;
    expectedStateRevision: number;
    reauthRequestId: string;
  };
  'privileged.device.rename': { deviceId: string; label: string; expectedRevision: number };
  'privileged.device.revoke': {
    deviceId: string;
    expectedRevision: number;
    reauthRequestId: string;
  };
  'administration.setting.replace': {
    setting: RelayAdministrableSetting;
    value: unknown;
    expectedRevision: number;
    reauthRequestId?: string;
  };
};
```

- [ ] Define explicit `RelayAdministrableSetting` names and a discriminated value map; do not accept arbitrary keys, collection names, paths, URLs outside an approved setting schema, or raw JSON blobs.
- [ ] Add `RelayAdministrationSnapshot` with operator rows, current admin/publisher IDs, account credential states, paired device summaries, public configuration summaries, and revisions. Exclude hashes, tokens, public-key material, secrets, paths, and command envelopes.
- [ ] Preserve `RelayOperatorRecord` compatibility by adding an optional/defaulted revision in normalization or by publishing a separate `RelayOperatorAdminView`; do not break existing roster consumers.
- [ ] Rerun the preceding focused command, then run `npm run typecheck`; confirm all exit 0.
- [ ] Commit with `feat(admin): define administration commands`.

## Task 2: Make Operator Management Revision-Safe and Remotely Callable

**Files:**

- Modify: `src/main/operators/RelayOperatorManager.ts`
- Modify: `src/main/operators/RelayOperatorManager.test.ts`
- Modify: `src/main/handlers/relayOperatorHandlers.ts`
- Modify: `src/main/handlers/relayOperatorHandlers.test.ts`
- Create: `src/main/privileged/registerAdministrationCommands.ts`
- Create: `src/main/privileged/__tests__/registerAdministrationCommands.test.ts`

- [ ] Add failing tests for admin-only create/rename/activate/deactivate, normalized duplicate rejection, expected revision conflicts, administrator self-deactivation rejection, active publisher deactivation rejection, preserved historical records, and idempotent command replay.
- [ ] Run `npx vitest run src/main/operators/RelayOperatorManager.test.ts src/main/handlers/relayOperatorHandlers.test.ts src/main/privileged/__tests__/registerAdministrationCommands.test.ts` and confirm RED at the missing authorization/revision cases.
- [ ] Keep `RelayOperatorManager` as the one domain implementation used by local-server IPC and signed remote commands. Do not duplicate PocketBase mutation logic in the renderer or command registration layer.
- [ ] Add `revision` to operator records non-destructively and increment it on rename/active changes after matching the expected revision.
- [ ] Register `operator.create`, `operator.rename`, and `operator.active.set` handlers requiring `operators.manage`; derive operator/admin/publisher state again immediately before mutation.
- [ ] Restrict existing direct operator IPC to trusted local server mode as a recovery path. Remote clients must use signed commands.
- [ ] Return bounded conflict results with the current revision and a refresh instruction; do not leak raw PocketBase errors.
- [ ] Rerun the preceding focused command, then run `npm run typecheck`; confirm all exit 0.
- [ ] Commit with `feat(admin): secure operator management`.

## Task 3: Implement Privileged Account Credential Management

**Files:**

- Create: `src/main/privileged/PrivilegedAccountManager.ts`
- Create: `src/main/privileged/__tests__/PrivilegedAccountManager.test.ts`
- Modify: `src/main/handlers/privilegedAccessHandlers.ts`
- Modify: `src/main/handlers/privilegedAccessHandlers.test.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipcValidation.ts`
- Modify: `src/shared/ipcValidation.test.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.test.ts`

- [ ] Add failing tests for initial local Ryan Bledsoe password setup, the unreachable bootstrap credential, no shipped default password, 12–128 character bounds, generic validation failures, local publisher setup/recovery, remote credential-reset rejection, pending credential state, and session/device revocation after credential changes.
- [ ] Run `npx vitest run src/main/privileged/__tests__/PrivilegedAccountManager.test.ts src/main/handlers/privilegedAccessHandlers.test.ts src/shared/ipcValidation.test.ts src/preload/index.test.ts` and confirm RED because local credential management is absent.
- [ ] Implement local first-password setup as trusted server-PC IPC that only works when no administrator password is configured and requires the selected Ryan Bledsoe operator.
- [ ] Implement publisher password setup and every privileged credential recovery through a dedicated trusted server-PC flow. Publisher assignment creates an inactive pending account; an authenticated local administrator authorizes setup, then the target operator enters the new password without it becoming a signed remote command.
- [ ] Use PocketBase auth collection APIs so only PocketBase's password hash is stored. Passwords never appear in snapshots, audit safe detail, command records/results, logs, renderer persistence, or remote administration responses.
- [ ] Revoke every existing privileged session and paired device for an account after its password changes. The active administrator cannot be disabled or replaced through remote administration.
- [ ] Rerun the preceding focused command, then run `npm run typecheck`; confirm all exit 0.
- [ ] Commit with `feat(admin): manage privileged credentials`.

## Task 4: Implement Single-Publisher Assignment

**Files:**

- Create: `src/main/privileged/PublisherAssignmentManager.ts`
- Create: `src/main/privileged/__tests__/PublisherAssignmentManager.test.ts`
- Modify: `src/main/privileged/registerAdministrationCommands.ts`
- Modify: `src/main/privileged/__tests__/registerAdministrationCommands.test.ts`

- [ ] Add failing tests for active non-admin eligibility, no publisher, first assignment, reassignment, removal, state revision conflicts, no two-publisher intermediate state, required reauthentication, disabled operator rejection, and device/session revocation for the previous publisher.
- [ ] Run `npx vitest run src/main/privileged/__tests__/PublisherAssignmentManager.test.ts src/main/privileged/__tests__/registerAdministrationCommands.test.ts` and confirm RED because the assignment manager is absent.
- [ ] Use the singleton `relay_privileged_state` record as the only authoritative publisher assignment. Create or reset the selected publisher auth account into inactive `mustChangePassword` state only after eligibility is rechecked; local server credential setup activates it later.
- [ ] Apply reassignment in a recoverable order: reserve the next state revision, set the single publisher ID, revoke the previous publisher's sessions/devices, and record the command result. A retry by request ID completes the same target state.
- [ ] Permit `operatorId: null` to leave no publisher; never permit Ryan Bledsoe's administrator operator to also be publisher.
- [ ] Register the handler with `publisher.assign` capability and a consumed reauthentication proof.
- [ ] Rerun the preceding focused command, then run `npm run typecheck`; confirm all exit 0.
- [ ] Commit with `feat(admin): assign one knowledge publisher`.

## Task 5: Implement Paired-Device Administration

**Files:**

- Create: `src/main/privileged/PrivilegedDeviceManager.ts`
- Create: `src/main/privileged/__tests__/PrivilegedDeviceManager.test.ts`
- Modify: `src/main/privileged/registerAdministrationCommands.ts`
- Modify: `src/main/privileged/__tests__/registerAdministrationCommands.test.ts`

- [ ] Add failing tests for sanitized device listing, rename bounds, expected revisions, admin-only cross-account revocation, publisher own-device visibility, fresh reauthentication for revoke, already-revoked idempotency, and immediate command rejection after revoke.
- [ ] Run `npx vitest run src/main/privileged/__tests__/PrivilegedDeviceManager.test.ts src/main/privileged/__tests__/registerAdministrationCommands.test.ts` and confirm RED because the device manager is absent.
- [ ] Return only device ID, operator/account display snapshot, label, hostname snapshot, state, last-seen time, fingerprint suffix, and revision.
- [ ] Never return the public key, full fingerprint, signing metadata, pairing secret, command history payload, or private key state.
- [ ] On revocation, increment revision, set `revokedAt`, invalidate matching session state, and require re-pairing. Never remotely delete local key files.
- [ ] Rerun the preceding focused command, then run `npm run typecheck`; confirm all exit 0.
- [ ] Commit with `feat(admin): manage paired devices`.

## Task 6: Add an Explicit Server-Settings Allowlist

**Files:**

- Create: `src/main/privileged/RelayAdministrationService.ts`
- Create: `src/main/privileged/__tests__/RelayAdministrationService.test.ts`
- Modify: `src/main/privileged/registerAdministrationCommands.ts`
- Modify: `src/main/privileged/__tests__/registerAdministrationCommands.test.ts`

- [ ] Inventory every current Settings mutation and classify it in a failing table-driven test as ordinary workstation, remotely administrable nonsecret, remotely replaceable secret, high-risk local-only, or unsupported.
- [ ] Add failing tests for redacted snapshots, typed validation, server-only authority, expected revisions, fresh proof on secrets/high-risk settings, unchanged secret preservation, and rejection of arbitrary paths/keys/objects.
- [ ] Run `npx vitest run src/main/privileged/__tests__/RelayAdministrationService.test.ts src/main/privileged/__tests__/registerAdministrationCommands.test.ts` and confirm RED because the allowlisted service is absent.
- [ ] Implement an exhaustive `switch` over `RelayAdministrableSetting`. Each case calls the current server manager/config API and returns a public summary plus revision.
- [ ] Allow secret replacement only for settings already supported by Relay's server configuration managers, including Dynatrace token replacement. Return `Configured`/`Not configured`; never add a reveal endpoint.
- [ ] Keep folder pickers, backup destination browsing, arbitrary restore files, executable selection, and any new server filesystem path operation local to server mode.
- [ ] Register `administration.snapshot.read` and `administration.setting.replace` under `settings.manage`.
- [ ] Rerun the preceding focused command, then run `npm run typecheck`; confirm all exit 0.
- [ ] Commit with `feat(admin): allowlist server settings`.

## Task 7: Build the Capability-Aware Settings Experience

**Files:**

- Create: `src/renderer/src/hooks/useRelayAdministration.ts`
- Create: `src/renderer/src/hooks/useRelayAdministration.test.tsx`
- Create: `src/renderer/src/components/settings/AdministrationSettings.tsx`
- Create: `src/renderer/src/components/settings/AdministrationSettings.test.tsx`
- Create: `src/renderer/src/components/settings/administration/OperatorAdministrationPanel.tsx`
- Create: `src/renderer/src/components/settings/administration/PublisherAssignmentPanel.tsx`
- Create: `src/renderer/src/components/settings/administration/PrivilegedAccountsPanel.tsx`
- Create: `src/renderer/src/components/settings/administration/PairedDevicesPanel.tsx`
- Create: `src/renderer/src/components/settings/administration/RelayServerPanel.tsx`
- Modify: `src/renderer/src/components/settings/OperatorSettingsSection.tsx`
- Modify: `src/renderer/src/components/settings/__tests__/OperatorSettingsSection.test.tsx`
- Modify: `src/renderer/src/components/SettingsModal.tsx`
- Modify: `src/renderer/src/components/__tests__/SettingsModal.test.tsx`
- Modify: `src/renderer/src/styles/components.css`

- [ ] Add failing hook tests for signed command submission, one automatic snapshot refresh after conflict, request ID result recovery after disconnect, offline management rejection, session lock, and safe errors.
- [ ] Add failing component tests for ordinary read-only roster, authenticated admin tabs, `ADMIN`/`PUBLISHER` chips, no privileged controls for publisher, server-only credential-recovery messaging, reauthentication dialogs, role reassignment warning, keyboard/focus behavior, and compact responsive stacking.
- [ ] Run `npx vitest run src/renderer/src/hooks/useRelayAdministration.test.tsx src/renderer/src/components/settings/AdministrationSettings.test.tsx src/renderer/src/components/settings/__tests__/OperatorSettingsSection.test.tsx src/renderer/src/components/__tests__/SettingsModal.test.tsx` and confirm RED at the new administration experience.
- [ ] Keep `OperatorSettingsSection` as the roster surface. When no admin session exists, show synchronized names and role chips without mutation controls; when admin is active, render the existing add/rename/deactivate/reactivate operations through signed commands.
- [ ] Add an `Administration` Settings area only for an active administrator session, with sections for Operators and roles, Publisher, Privileged accounts, Devices, Relay server, Dynatrace server, Backup/maintenance summaries, and Security activity.
- [ ] Use explicit `Configured`/`Not configured` labels and blank replacement fields. Clear password/secret fields on submit, cancel, lock, unmount, and failure.
- [ ] At half-width, collapse the administration section rail to a selector/drawer, stack rows, keep the primary action visible, and confine scrolling to panels; do not rely on a clipped bottom-right action.
- [ ] Rerun the preceding focused command, then run `npm run typecheck && npm run build`; confirm all exit 0.
- [ ] Commit with `feat(admin): add remote administration UI`.

## Task 8: Verify Migration, Authorization, Realtime, and Recovery

**Files:**

- Modify: `tests/e2e/critical-path.spec.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/SECURITY.md`

- [ ] Add E2E coverage for the nine-person roster, local Ryan Bledsoe admin setup, local publisher credential setup, Tristan Bowles normal selection, passwordless attribution, remote paired admin login, operator add/rename/deactivate/reactivate realtime sync, publisher assignment/reassignment, role-chip updates, device revocation, locked/offline management, and preserved ordinary client connectivity.
- [ ] Add E2E negative paths proving a publisher cannot invoke admin commands, a normal app-user token cannot mutate server-owned operator records, a stale revision cannot overwrite, and a disabled operator's historical attribution remains visible.
- [ ] Run `npm run test:electron -- --grep "remote operator administration"` and confirm RED at the first unimplemented flow before adding only the required test fixture support.
- [ ] Document the complete authorization matrix, administrator recovery, publisher reassignment, secret redaction, device revocation, local-only file operations, and normal-operator passwordless behavior.
- [ ] Run the complete gates:

```bash
npm run typecheck
npm run lint
npm run test
npm run test:electron
npm run build
```

- [ ] Confirm all commands exit 0, run `git diff --check`, and inspect both server and connected-client behavior after a runtime reconfigure.
- [ ] Commit with `docs(admin): document operator administration`.

## Plan Completion Checklist

- [ ] Search changed files for `TODO|TBD|FIXME|placeholder|appropriate error handling|write tests for above` and resolve every introduced match.
- [ ] Confirm exactly one initial admin, at most one publisher, and no password requirement for ordinary operator selection.
- [ ] Confirm no current secret value, password, token, key, path, or raw PocketBase error crosses the bridge or enters audit/result storage.
- [ ] Confirm publisher sessions expose Knowledge Base management capability only.
- [ ] Confirm direct local operator recovery handlers remain server-only and connected clients use signed commands.
- [ ] Invoke `superpowers:requesting-code-review`, address accepted findings with `superpowers:receiving-code-review`, then invoke `superpowers:verification-before-completion` before declaring this phase complete.
