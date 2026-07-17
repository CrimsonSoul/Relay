# Role Accounts and Operator Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Relay's passwordless operator roster with username-based protected role accounts while preserving ordinary passwordless use, Ryan as Owner, Charles as Administrator, existing credentials/devices, and historical name snapshots.

**Architecture:** Keep `relay_privileged_accounts` as the PocketBase auth authority, add username and display-name identity, and derive the effective Owner from a singleton `ownerAccountId`. A server-only migration converts stable existing account IDs before the old roster is retired. Renderer login and administration consume bounded account projections; ordinary workflows no longer depend on identity selection.

**Tech Stack:** Electron 42, TypeScript 6, React 19, PocketBase 0.26, Zod 4, Vitest, Testing Library, existing signed privileged-command and paired-device runtime.

## Global Constraints

- Ordinary Relay use remains passwordless and available without any account.
- Protected account identity is username, password, and display name; no email appears in the product.
- Keep exactly one Owner, zero or more Administrators, and no more than one assigned Publisher.
- Owner manages Administrator lifecycle and ownership transfer.
- Owner and Administrators may assign or replace Publisher.
- Ryan Bledsoe migrates to Owner username `ryan`; Charles Gibbs migrates to Administrator username `charles`.
- Preserve existing auth record IDs, credential state, password hashes, credential versions, and paired-device account relationships.
- Historical name snapshots remain unchanged and render without a roster lookup.
- Retire `relay_operators` only after account conversion and historical attribution validation succeed.
- Keep privileged tokens, password material, internal auth email values, device private keys, and secrets out of renderer projections, logs, and caches.
- Use TDD for every behavior: write the focused failing test, observe RED, implement the smallest passing change, rerun focused tests, then commit.

---

## File Structure

### Create

- `src/shared/roleAccounts.ts` — username/display-name normalization, stored/effective role types, and account helpers.
- `src/shared/roleAccounts.test.ts` — validation and effective-role contract tests.
- `src/main/privileged/RoleAccountMigration.ts` — idempotent server-side account/attribution conversion and roster retirement readiness.
- `src/main/privileged/__tests__/RoleAccountMigration.test.ts` — Ryan/Charles, publisher, collision, rollback, and idempotence tests.
- `src/main/privileged/RoleAccountManager.ts` — Owner-only Administrator lifecycle and ownership transfer.
- `src/main/privileged/__tests__/RoleAccountManager.test.ts` — authorization, conflict, and session-revocation tests.
- `src/renderer/src/components/settings/administration/RoleAccountsPanel.tsx` — bounded account list and Owner/Admin role actions.
- `src/renderer/src/components/settings/administration/RoleAccountsPanel.test.tsx` — permissions and form behavior.

### Delete after migration and call-site conversion

- `src/shared/operators.ts`
- `src/shared/operators.test.ts`
- `src/main/operators/RelayOperatorManager.ts`
- `src/main/operators/RelayOperatorManager.test.ts`
- `src/main/handlers/relayOperatorHandlers.ts`
- `src/main/handlers/relayOperatorHandlers.test.ts`
- `src/renderer/src/contexts/OperatorContext.tsx`
- `src/renderer/src/contexts/__tests__/OperatorContext.test.tsx`
- `src/renderer/src/services/operatorSelection.ts`
- `src/renderer/src/components/sidebar/SidebarOperatorSelector.tsx`
- `src/renderer/src/components/sidebar/__tests__/SidebarOperatorSelector.test.tsx`
- `src/renderer/src/components/settings/OperatorSettingsSection.tsx`
- `src/renderer/src/components/settings/__tests__/OperatorSettingsSection.test.tsx`
- `src/renderer/src/components/settings/administration/OperatorAdministrationPanel.tsx`
- `src/renderer/src/components/settings/administration/PublisherAssignmentPanel.tsx`
- `src/renderer/src/components/settings/administration/PrivilegedAccountsPanel.tsx`

### Modify

- `src/shared/privilegedAccess.ts` and `src/shared/__tests__/privilegedAccess.test.ts` — account projections, effective roles, and capabilities.
- `src/shared/privilegedCommands.ts` and `src/shared/__tests__/privilegedCommands.test.ts` — account/ownership command catalog and payload validation.
- `src/shared/ipc.ts`, `src/shared/ipcValidation.ts`, and tests — username login, account IDs, and new administration requests.
- `src/main/pocketbase/CollectionBootstrap.ts` and tests — account/state fields, username auth identity, migration marker, and roster retirement.
- `src/main/privileged/PrivilegedAccountManager.ts` and tests — account-ID credential setup/reset.
- `src/main/privileged/PublisherAssignmentManager.ts` and tests — account-based single Publisher assignment.
- `src/main/privileged/RelayAdministrationSnapshotReader.ts` and tests — bounded account projections without roster joins.
- `src/main/privileged/registerAdministrationCommands.ts` and tests — role account commands.
- `src/main/privileged/PrivilegedPocketBaseClient.ts`, `PrivilegedSessionManager.ts`, `PrivilegedPairingService.ts`, `PrivilegedCommandProcessor.ts`, `privilegedRuntime.ts`, and tests — username/account actor identity.
- `src/main/handlers/privilegedAccessHandlers.ts` and tests — username login and account credential setup.
- `src/main/ipcHandlers.ts`, `src/main/index.ts`, `src/preload/index.ts`, and tests — remove operator IPC and expose account contracts.
- `src/renderer/src/contexts/PrivilegedAccessContext.tsx` and tests — username/password login independent of OperatorContext.
- `src/renderer/src/components/settings/PrivilegedAccessPanel.tsx` and tests — username/password form and session display.
- `src/renderer/src/components/settings/AdministrationSettings.tsx` and tests — Accounts & roles information architecture.
- `src/renderer/src/components/Sidebar.tsx` and tests — remove operator selector.
- `src/renderer/src/App.tsx` and tests — remove OperatorProvider.
- `src/renderer/src/services/alertReminderService.ts`, `dynatraceProblemsService.ts`, their call sites, and tests — optional ordinary attribution.
- `src/shared/dynatraceProblems.ts` and tests — optional author snapshot for new records.
- `src/main/handlers/cacheHandlers.ts`, `offlineMutationHandlers.ts`, renderer cache registries, and tests — remove roster synchronization.
- `docs/SECURITY.md`, `docs/architecture.md`, and `docs/DEVELOPMENT.md` — final identity, migration, and recovery model.

---

### Task 1: Define Role Account Contracts

**Files:**

- Create: `src/shared/roleAccounts.ts`
- Create: `src/shared/roleAccounts.test.ts`
- Modify: `src/shared/privilegedAccess.ts`
- Modify: `src/shared/__tests__/privilegedAccess.test.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipcValidation.ts`
- Modify: `src/shared/ipcValidation.test.ts`

**Interfaces:**

- Produces:

```ts
export type StoredRoleAccountRole = 'administrator' | 'publisher';
export type EffectivePrivilegedRole = 'owner' | 'admin' | 'publisher';

export function normalizeRoleUsername(value: string): string;
export function getRoleUsernameError(value: string): string | null;
export function normalizeRoleDisplayName(value: string): string;
export function getRoleDisplayNameError(value: string): string | null;
export function getEffectiveRole(
  account: Pick<RelayRoleAccountRecord, 'id' | 'storedRole'>,
  state: Pick<RelayPrivilegedStateRecord, 'ownerAccountId' | 'publisherAccountId'>,
): EffectivePrivilegedRole | null;
```

- Changes `PrivilegedLoginInput` to `{ username: string; password: string }`.
- Changes the renderer session projection from operator identity to `accountId`, `username`, and `displayName`.

- [ ] **Step 1: Write failing username and effective-role tests**

Add `roleAccounts.test.ts`:

```ts
describe('role account identity', () => {
  it('normalizes usernames and rejects unsupported values', () => {
    expect(normalizeRoleUsername('  Ryan.Admin ')).toBe('ryan.admin');
    expect(getRoleUsernameError('ab')).toBe('Usernames must be 3–64 characters.');
    expect(getRoleUsernameError('ryan admin')).toBe(
      'Use only letters, numbers, periods, underscores, and hyphens.',
    );
  });

  it('derives the singleton owner before the stored administrator role', () => {
    expect(
      getEffectiveRole(
        { id: 'account-ryan', storedRole: 'administrator' },
        { ownerAccountId: 'account-ryan', publisherAccountId: null },
      ),
    ).toBe('owner');
  });
});
```

Update IPC validation tests to parse `{ username: 'ryan', password }` and reject `operatorId`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run \
  src/shared/roleAccounts.test.ts \
  src/shared/__tests__/privilegedAccess.test.ts \
  src/shared/ipcValidation.test.ts
```

Expected: `roleAccounts.ts` is missing and privileged login still requires `operatorId`.

- [ ] **Step 3: Implement the shared account model**

Create the normalization boundary:

```ts
export const MIN_ROLE_USERNAME_LENGTH = 3;
export const MAX_ROLE_USERNAME_LENGTH = 64;
export const MAX_ROLE_DISPLAY_NAME_LENGTH = 120;
const ROLE_USERNAME_PATTERN = /^[a-z0-9._-]+$/;

export function normalizeRoleUsername(value: string): string {
  return value.trim().toLocaleLowerCase('en');
}

export function getRoleUsernameError(value: string): string | null {
  const username = normalizeRoleUsername(value);
  if (username.length < MIN_ROLE_USERNAME_LENGTH || username.length > MAX_ROLE_USERNAME_LENGTH) {
    return 'Usernames must be 3–64 characters.';
  }
  return ROLE_USERNAME_PATTERN.test(username)
    ? null
    : 'Use only letters, numbers, periods, underscores, and hyphens.';
}
```

Define Owner capabilities separately from Administrator capabilities. Remove `operators.manage` and add `accounts.manage` plus `ownership.transfer`. Keep `publisher.assign`, `devices.manage`, `settings.manage`, and `knowledge.manage` for Owner/Admin; Publisher keeps only status read and Wiki management.

- [ ] **Step 4: Convert bounded shared projections**

Update account, state, session, administration, pairing, and command actor types to use account identity. Keep optional `legacyOperatorId` fields only for migration compatibility. Normalize session/admin data by allowlisting the new fields; reject internal email, password, token, or unknown capability values.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command plus:

```bash
npm run typecheck
```

Expected: focused tests pass. Typecheck may still report downstream `operatorId` call sites; record that list as the bounded work for Tasks 2–6 and do not broaden Task 1.

- [ ] **Step 6: Commit**

```bash
git add src/shared/roleAccounts.ts src/shared/roleAccounts.test.ts src/shared/privilegedAccess.ts src/shared/__tests__/privilegedAccess.test.ts src/shared/ipc.ts src/shared/ipcValidation.ts src/shared/ipcValidation.test.ts
git commit -m "refactor(auth): define protected role account identity"
```

---

### Task 2: Add an Idempotent Existing-Installation Migration

**Files:**

- Create: `src/main/privileged/RoleAccountMigration.ts`
- Create: `src/main/privileged/__tests__/RoleAccountMigration.test.ts`
- Modify: `src/main/pocketbase/CollectionBootstrap.ts`
- Modify: `src/main/pocketbase/__tests__/CollectionBootstrap.test.ts`

**Interfaces:**

- Consumes username/display-name helpers from Task 1.
- Produces:

```ts
export const ROLE_ACCOUNT_MIGRATION_VERSION = 1;

export type RoleAccountMigrationResult =
  | { status: 'already-complete' }
  | { status: 'migrated'; ownerAccountId: string; administratorAccountIds: string[] }
  | { status: 'deferred'; reason: string };

export class RoleAccountMigration {
  constructor(options: { pb: PocketBase; now?: () => number });
  run(): Promise<RoleAccountMigrationResult>;
}
```

- [ ] **Step 1: Write failing migration tests**

Cover these fixtures explicitly:

```ts
it('preserves Ryan and Charles auth record IDs and device relations', async () => {
  const fixture = existingInstallFixture({
    owner: operator('ryan-op', 'Ryan Bledsoe'),
    administrators: [operator('ryan-op', 'Ryan Bledsoe'), operator('charles-op', 'Charles Gibbs')],
  });
  const result = await migrate(fixture);
  expect(result).toMatchObject({ status: 'migrated', ownerAccountId: 'account-ryan' });
  expect(fixture.account('account-ryan')).toMatchObject({
    username: 'ryan',
    displayName: 'Ryan Bledsoe',
    storedRole: 'administrator',
    legacyOperatorId: 'ryan-op',
  });
  expect(fixture.account('account-charles')).toMatchObject({ username: 'charles' });
  expect(fixture.device('device-charles').accountId).toBe('account-charles');
});
```

Add tests for an existing Publisher, username collision, duplicate Ryan/Charles roster records, a missing historical name snapshot, an unresolvable legacy ID, a restart after success, and a failure before roster deletion.

- [ ] **Step 2: Run migration tests and verify RED**

Run:

```bash
npx vitest run \
  src/main/privileged/__tests__/RoleAccountMigration.test.ts \
  src/main/pocketbase/__tests__/CollectionBootstrap.test.ts
```

Expected: migration class and new account/state schema do not exist.

- [ ] **Step 3: Patch the auth and state schema in two non-destructive phases**

Before migration, apply a compatibility schema that adds optional `username`, `displayName`, `storedRole`, and `legacyOperatorId` fields while leaving `operatorId` as the password identity. Add optional `ownerAccountId`, `publisherAccountId`, and `identityMigrationVersion` state fields while retaining legacy pointers. This phase must be valid for populated legacy collections.

After migration verifies every converted account, apply the final schema: require username/display name/stored role, add the case-insensitive unique username index, and switch the password identity field to username. Keep legacy fields optional for historical compatibility rather than trying to drop them in the same upgrade.

Use username as the only password identity field only in the final phase:

```ts
auth: {
  authRule: 'active = true',
  manageRule: null,
  passwordAuth: { enabled: true, identityFields: ['username'] },
}
```

If PocketBase requires an email value on create, generate `<account-id>@relay.invalid` internally and omit it from every public projection.

- [ ] **Step 4: Implement ordered conversion and snapshot verification**

`run()` must:

1. Return `already-complete` only when the marker is current, converted invariants pass, and the roster collection is already absent. If the marker is current but the roster still exists after an interrupted retirement, revalidate and complete only the idempotent roster deletion.
2. Resolve existing auth accounts by stable `operatorId`, not by display name alone.
3. Confirm the state Owner resolves uniquely to Ryan Bledsoe and an Administrator resolves uniquely to Charles Gibbs.
4. Patch the same auth records with `ryan` and `charles`; never recreate configured accounts.
5. Generate a deterministic unique Publisher username from its display name.
6. Backfill only empty historical snapshot fields in `alert_reminders`, `dynatrace_problem_states`, `dynatrace_problem_notes`, Wiki upload/audit records, privileged commands, and pairing records.
7. Write account-ID state pointers and migration version.
8. Re-read the committed state/accounts and validate invariants.
9. Delete `relay_operators` only after all validation succeeds; make this final deletion safe to retry after a process interruption.

Return `deferred` before any destructive step when identity or attribution cannot be resolved.

- [ ] **Step 5: Wire migration into bootstrap**

Bootstrap order is: apply compatibility account/state schema, run `RoleAccountMigration.run()`, apply final required fields/unique username index/username identity, then start the privileged runtime. Fresh-install bootstrap creates pending `ryan` Owner and `charles` Administrator accounts with unreachable random initial passwords. Do not invoke the old roster seed/migration.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command and:

```bash
npx vitest run src/main/pocketbase/__tests__/CollectionBootstrap.test.ts --coverage=false
```

Expected: all migration/schema cases pass, deletion occurs only in the success case, and a second run performs no writes.

- [ ] **Step 7: Commit**

```bash
git add src/main/privileged/RoleAccountMigration.ts src/main/privileged/__tests__/RoleAccountMigration.test.ts src/main/pocketbase/CollectionBootstrap.ts src/main/pocketbase/__tests__/CollectionBootstrap.test.ts
git commit -m "feat(auth): migrate operator identities to role accounts"
```

---

### Task 3: Implement Owner and Publisher Account Administration

**Files:**

- Create: `src/main/privileged/RoleAccountManager.ts`
- Create: `src/main/privileged/__tests__/RoleAccountManager.test.ts`
- Modify: `src/main/privileged/PrivilegedAccountManager.ts`
- Modify: `src/main/privileged/__tests__/PrivilegedAccountManager.test.ts`
- Modify: `src/main/privileged/PublisherAssignmentManager.ts`
- Modify: `src/main/privileged/__tests__/PublisherAssignmentManager.test.ts`
- Modify: `src/main/privileged/RelayAdministrationSnapshotReader.ts`
- Modify: `src/main/privileged/__tests__/RelayAdministrationSnapshotReader.test.ts`
- Modify: `src/main/privileged/registerAdministrationCommands.ts`
- Modify: `src/main/privileged/__tests__/registerAdministrationCommands.test.ts`
- Modify: `src/shared/privilegedCommands.ts`
- Modify: `src/shared/__tests__/privilegedCommands.test.ts`

**Interfaces:**

- Produces commands:

```ts
'account.admin.create': {
  username: string;
  displayName: string;
  expectedStateRevision: number;
};
'account.publisher.create': {
  username: string;
  displayName: string;
  expectedStateRevision: number;
};
'account.display-name.update': {
  accountId: string;
  displayName: string;
  expectedRevision: number;
};
'account.active.set': {
  accountId: string;
  active: boolean;
  expectedRevision: number;
};
'ownership.transfer': {
  accountId: string;
  expectedStateRevision: number;
  reauthRequestId: string;
};
'publisher.assign': {
  accountId: string | null;
  expectedStateRevision: number;
  reauthRequestId: string;
};
```

- [ ] **Step 1: Write failing authorization and conflict tests**

Test that Owner can create/deactivate Administrators and transfer ownership, Administrator cannot mutate Administrator accounts, Owner/Admin can create or assign Publisher, Publisher cannot, current Owner cannot deactivate itself, and stale revisions return the existing conflict result shape.

```ts
await expect(
  manager.setActive({ actorAccountId: 'account-charles', accountId: 'account-admin-2', active: false, expectedRevision: 1 }),
).rejects.toThrow('Only the Relay owner can manage administrators.');
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run \
  src/main/privileged/__tests__/RoleAccountManager.test.ts \
  src/main/privileged/__tests__/PrivilegedAccountManager.test.ts \
  src/main/privileged/__tests__/PublisherAssignmentManager.test.ts \
  src/main/privileged/__tests__/RelayAdministrationSnapshotReader.test.ts \
  src/main/privileged/__tests__/registerAdministrationCommands.test.ts \
  src/shared/__tests__/privilegedCommands.test.ts
```

Expected: account commands/managers are missing and existing managers still key by operator ID.

- [ ] **Step 3: Implement `RoleAccountManager`**

Create Administrator accounts with a unique normalized username, normalized display name, pending local credential, inactive state, and random unreachable password. Owner/Admin Publisher creation uses the same identity validation but stores `publisher`, assigns the singleton pointer, and rejects creation while another Publisher remains authoritative unless the operation explicitly replaces it. Transfer ownership only to an active Administrator. Commit the singleton `ownerAccountId` with an assignment-version compare before notifying session invalidation.

```ts
async transferOwnership(input: OwnershipTransferInput): Promise<RelayAdministrationSnapshot> {
  const state = await this.getState();
  this.assertOwner(state, input.actorAccountId);
  this.assertRevision(state, input.expectedStateRevision);
  const target = await this.getAccount(input.accountId);
  if (!target.active || target.storedRole !== 'administrator') {
    throw new Error('Select an active administrator as the new owner.');
  }
  await this.state.updateOwner(state, target.id, input.actorAccountId);
  await this.onAuthorityChanged?.([input.actorAccountId, target.id]);
  return this.snapshotReader.read();
}
```

- [ ] **Step 4: Convert credential and Publisher managers**

Resolve accounts by account ID, use `ownerAccountId`/stored role for authorization, and record `updatedByAccountId`. Publisher assignment prepares or disables only the publisher account and never changes an Administrator account into Publisher. Local credential setup/reset continues to revoke every paired device for the affected account.

- [ ] **Step 5: Register the allowlisted commands**

Remove `operator.create`, `operator.rename`, and `operator.active.set`. Add the account/ownership commands above with exact Zod normalization, reauthentication requirements for transfer/Publisher replacement, optimistic revisions, and bounded result payloads.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all account lifecycle, transfer, assignment, capability, and stale-write tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/privileged src/shared/privilegedCommands.ts src/shared/__tests__/privilegedCommands.test.ts
git commit -m "feat(auth): add owner and publisher account administration"
```

---

### Task 4: Convert Login, Sessions, Pairing, and Signed Commands to Account Identity

**Files:**

- Modify: `src/main/privileged/PrivilegedPocketBaseClient.ts`
- Modify: `src/main/privileged/__tests__/PrivilegedPocketBaseClient.test.ts`
- Modify: `src/main/privileged/PrivilegedSessionManager.ts`
- Modify: `src/main/privileged/__tests__/PrivilegedSessionManager.test.ts`
- Modify: `src/main/privileged/PrivilegedPairingService.ts`
- Modify: `src/main/privileged/__tests__/PrivilegedPairingService.test.ts`
- Modify: `src/main/privileged/PrivilegedCommandProcessor.ts`
- Modify: `src/main/privileged/__tests__/PrivilegedCommandProcessor.test.ts`
- Modify: `src/main/privileged/PrivilegedPocketBaseTransport.ts`
- Modify: `src/main/privileged/__tests__/PrivilegedPocketBaseTransport.test.ts`
- Modify: `src/main/privileged/privilegedRuntime.ts`
- Modify: `src/main/privileged/__tests__/privilegedRuntime.test.ts`
- Modify: `src/main/handlers/privilegedAccessHandlers.ts`
- Modify: `src/main/handlers/privilegedAccessHandlers.test.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.test.ts`

**Interfaces:**

- Consumes `PrivilegedLoginInput = { username; password }` and account-based session projections from Task 1.
- Produces signed command/pairing records with `accountId` and `actorDisplayName`; legacy operator fields are read-only compatibility fields.

- [ ] **Step 1: Write failing login/session tests**

```ts
it('authenticates with username and returns the effective owner role', async () => {
  authWithPassword.mockResolvedValue(accountRecord({ id: 'account-ryan', username: 'ryan' }));
  stateReader.mockResolvedValue(state({ ownerAccountId: 'account-ryan' }));
  await expect(manager.login({ username: 'ryan', password })).resolves.toMatchObject({
    accountId: 'account-ryan',
    username: 'ryan',
    displayName: 'Ryan Bledsoe',
    role: 'owner',
  });
});
```

Add tests proving login does not read an operator selection, signed commands bind to authenticated account ID, pairing targets account ID, and ownership/Publisher changes invalidate affected sessions.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run \
  src/main/handlers/privilegedAccessHandlers.test.ts \
  src/main/privileged/__tests__/PrivilegedPocketBaseClient.test.ts \
  src/main/privileged/__tests__/PrivilegedSessionManager.test.ts \
  src/main/privileged/__tests__/PrivilegedPairingService.test.ts \
  src/main/privileged/__tests__/PrivilegedCommandProcessor.test.ts \
  src/main/privileged/__tests__/PrivilegedPocketBaseTransport.test.ts \
  src/main/privileged/__tests__/privilegedRuntime.test.ts \
  src/preload/index.test.ts
```

Expected: existing code still reads `operatorId` and resolves display names through the roster.

- [ ] **Step 3: Convert authentication and session projection**

Authenticate with `pb.collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION).authWithPassword(username, password)`. Normalize effective role against current state on every login/session refresh. Populate `accountId`, `username`, and `displayName` directly from the auth account. Never include PocketBase email.

- [ ] **Step 4: Convert pairing and signed command actor binding**

Pairing challenges select account IDs. Command envelopes bind `accountId`, `roleClaim`, `displayNameSnapshot`, device ID, request ID, payload hash, and signature. The server loads the current account/state and ignores a forged display name or role claim when authorizing.

- [ ] **Step 5: Update trusted IPC and preload contracts**

`loginPrivileged` accepts username/password. Credential setup accepts account ID. Remove operator roster methods from preload only after Task 7 removes their handlers. Validate all new inputs with the shared schemas.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command and `npm run typecheck`. Expected: privileged runtime tests pass and remaining type errors are limited to renderer/admin and ordinary attribution work in Tasks 5–7.

- [ ] **Step 7: Commit**

```bash
git add src/main/privileged src/main/handlers/privilegedAccessHandlers.ts src/main/handlers/privilegedAccessHandlers.test.ts src/preload/index.ts src/preload/index.test.ts
git commit -m "refactor(auth): bind privileged sessions to role accounts"
```

---

### Task 5: Replace the Renderer Operator UI with Accounts and Roles

**Files:**

- Create: `src/renderer/src/components/settings/administration/RoleAccountsPanel.tsx`
- Create: `src/renderer/src/components/settings/administration/RoleAccountsPanel.test.tsx`
- Modify: `src/renderer/src/contexts/PrivilegedAccessContext.tsx`
- Modify: `src/renderer/src/contexts/PrivilegedAccessContext.test.tsx`
- Modify: `src/renderer/src/components/settings/PrivilegedAccessPanel.tsx`
- Modify: `src/renderer/src/components/settings/PrivilegedAccessPanel.test.tsx`
- Modify: `src/renderer/src/components/settings/AdministrationSettings.tsx`
- Modify: `src/renderer/src/components/settings/AdministrationSettings.test.tsx`
- Modify: `src/renderer/src/hooks/useRelayAdministration.ts`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/components/__tests__/Sidebar.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/__tests__/App.test.tsx`
- Modify: `src/renderer/src/contexts/index.ts`

**Interfaces:**

- `PrivilegedAccessContext.login(username: string, password: string): Promise<boolean>`.
- `RoleAccountsPanel` consumes the bounded `RelayAdministrationSnapshot` plus `execute` and `relayMode`.

- [ ] **Step 1: Write failing renderer behavior tests**

Test username/password fields, no operator picker requirement, Owner-only Administrator controls, Owner/Admin Publisher controls, role labels, server-local credential reset messaging, and removal of the sidebar selector.

```tsx
renderPrivilegedAccess();
await user.type(screen.getByLabelText('Username'), 'ryan');
await user.type(screen.getByLabelText('Password'), password);
await user.click(screen.getByRole('button', { name: 'Sign in' }));
expect(api.loginPrivileged).toHaveBeenCalledWith({ username: 'ryan', password });
```

- [ ] **Step 2: Run renderer tests and verify RED**

```bash
node scripts/run-renderer-tests.mjs \
  PrivilegedAccessContext.test.tsx \
  PrivilegedAccessPanel.test.tsx \
  AdministrationSettings.test.tsx \
  RoleAccountsPanel.test.tsx \
  Sidebar.test.tsx \
  App.test.tsx
```

Expected: login still relies on selected operator and Accounts & roles does not exist.

- [ ] **Step 3: Remove OperatorContext from the renderer root**

Delete the `useOperator()` dependency from `PrivilegedAccessProvider`. Hold username in the sign-in form, call the new IPC input, and render session `displayName`/effective role. Remove `OperatorProvider` from `App`, remove its export, and remove `SidebarOperatorSelector` from `Sidebar`.

- [ ] **Step 4: Implement `RoleAccountsPanel`**

Use one account list with role chips and progressive actions. Owner sees Administrator create/edit/deactivate/transfer controls. Owner/Admin sees Publisher assign/replace controls. Publisher sees no administration surface. Reauthentication dialogs use the existing focus trap/modal vocabulary and wipe password state on close/unmount.

- [ ] **Step 5: Replace administration navigation**

Replace `Operators`, `Publisher`, and `Accounts` rail entries with one `Accounts & roles` entry plus existing Devices and Relay Server entries. Show `OWNER`, `ADMIN`, or `PUBLISHER` from the effective role; never infer Owner from a name.

- [ ] **Step 6: Run renderer tests and verify GREEN**

Run the Step 2 command plus:

```bash
npm run typecheck
```

Expected: UI tests pass; no renderer login or sidebar path imports `OperatorContext`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src
git commit -m "feat(settings): manage protected accounts and roles"
```

---

### Task 6: Remove Operator Requirements from Ordinary Workflows

**Files:**

- Modify: `src/renderer/src/services/alertReminderService.ts`
- Modify: `src/renderer/src/services/alertReminderService.test.ts`
- Modify: `src/renderer/src/services/dynatraceProblemsService.ts`
- Modify: `src/renderer/src/services/dynatraceProblemsService.test.ts`
- Modify: `src/renderer/src/hooks/useAlertReminders.ts`
- Modify: `src/renderer/src/hooks/__tests__/useAlertReminders.test.ts`
- Modify: `src/renderer/src/hooks/useDynatraceProblems.ts`
- Modify: `src/renderer/src/hooks/__tests__/useDynatraceProblems.test.ts`
- Modify: `src/renderer/src/tabs/DynatraceProblemsTab.tsx`
- Modify: `src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx`
- Modify: `src/shared/dynatraceProblems.ts`
- Modify: `src/shared/dynatraceProblems.test.ts`
- Modify: `src/main/pocketbase/CollectionBootstrap.ts`
- Modify: `src/main/pocketbase/__tests__/CollectionBootstrap.test.ts`

**Interfaces:**

- Ordinary reminder/problem APIs no longer consume `OperatorAttribution`.
- New ordinary records omit operator ID and name snapshots; existing non-empty snapshots remain displayable.

- [ ] **Step 1: Write failing unattributed-action tests**

```ts
it('creates an alert reminder without an operator identity', async () => {
  await addAlertReminder(input);
  expect(mutateCollection).toHaveBeenCalledWith(
    'alert_reminders',
    'create',
    undefined,
    expect.not.objectContaining({ operatorId: expect.anything(), createdBy: expect.anything() }),
  );
});
```

Add matching tests for marking a problem addressed and adding a Dynatrace response note without an operator picker. Keep tests showing stored legacy `author`, `addressedBy`, and `createdBy` render unchanged.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run \
  src/renderer/src/services/alertReminderService.test.ts \
  src/renderer/src/services/dynatraceProblemsService.test.ts \
  src/shared/dynatraceProblems.test.ts
node scripts/run-renderer-tests.mjs DynatraceProblemsTab.test.tsx
```

Expected: services require `OperatorAttribution` and throw when it is absent.

- [ ] **Step 3: Remove attribution parameters and picker calls**

Make `createdBy`, `author`, `addressedBy`, and legacy operator IDs optional for new ordinary writes. For a required PocketBase text field, patch it to optional before sending empty values. Render a neutral `Unattributed` label only in UI that requires a visible author line; do not persist `Relay user` or a hostname as a fake person.

- [ ] **Step 4: Preserve historical display**

Keep rendering stored snapshot strings first. Remove joins or lookups against `relay_operators`. Do not backfill or replace non-empty historical values in renderer code.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command and the affected reminder/problem hook tests. Expected: ordinary actions work with no account and historical snapshot fixtures remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/services src/renderer/src/hooks src/renderer/src/tabs src/shared/dynatraceProblems.ts src/shared/dynatraceProblems.test.ts src/main/pocketbase/CollectionBootstrap.ts src/main/pocketbase/__tests__/CollectionBootstrap.test.ts
git commit -m "refactor(identity): make ordinary Relay actions operatorless"
```

---

### Task 7: Retire Operator Infrastructure and Compatibility State

**Files:**

- Delete all files listed under **Delete after migration and call-site conversion**.
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/main/__tests__/ipcHandlers.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.test.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipcValidation.ts`
- Modify: `src/shared/ipcValidation.test.ts`
- Modify: `src/main/handlers/cacheHandlers.ts`
- Modify: `src/main/handlers/cacheHandlers.test.ts`
- Modify: `src/main/handlers/offlineMutationHandlers.ts`
- Modify: `src/main/handlers/offlineMutationHandlers.test.ts`
- Modify: `src/renderer/src/stores/collectionStoreRegistry.ts`
- Modify: `src/renderer/src/services/importExportService.ts`
- Modify: `src/renderer/src/types/electron.d.ts`

**Interfaces:**

- Removes every live `RelayOperator*`, `OperatorAttribution`, `RELAY_OPERATOR_*` IPC channel, roster cache entry, and `relay.selectedOperatorId` dependency.

- [ ] **Step 1: Write failing absence/compatibility tests**

Update IPC/preload/cache tests to assert operator channels and roster collections are absent. Add an App startup test that seeds `localStorage['relay.selectedOperatorId']`, starts Relay, and expects the key to be removed without blocking ordinary UI.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run \
  src/main/__tests__/ipcHandlers.test.ts \
  src/main/handlers/cacheHandlers.test.ts \
  src/main/handlers/offlineMutationHandlers.test.ts \
  src/preload/index.test.ts \
  src/shared/ipcValidation.test.ts
node scripts/run-renderer-tests.mjs App.test.tsx
```

Expected: operator handlers, IPC methods, roster allowlists, and local selection code still exist.

- [ ] **Step 3: Remove live operator wiring**

Delete operator handler registration, preload methods, shared inputs/channels, cache/offline allowlists, collection registry entries, import/export exposure, and renderer electron declarations. Remove the selected-operator key once during startup.

- [ ] **Step 4: Delete obsolete implementation and tests**

Delete the exact files under **Delete after migration and call-site conversion**. Remove unused icons only when no other contextual UI uses them. Keep legacy string fields in historical record types until a separately approved storage migration removes them.

- [ ] **Step 5: Prove there are no live operator dependencies**

Run:

```bash
rg -n "OperatorProvider|useOperator|SidebarOperatorSelector|relayOperator:|RELAY_OPERATORS_COLLECTION|relay.selectedOperatorId|operators.manage" src
```

Expected: no matches. A narrower search for `operatorId|operatorName` may match explicitly documented legacy compatibility fields only; inspect each match and ensure no authorization or renderer lookup depends on it.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command plus:

```bash
npm run typecheck
npm run lint
```

Expected: all pass and no ignored/stale operator module is bundled.

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "refactor(identity): retire the Relay operator roster"
```

---

### Task 8: Document and Verify the Account Migration End to End

**Files:**

- Modify: `docs/SECURITY.md`
- Modify: `docs/architecture.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `tests/e2e/critical-path.spec.ts`
- Modify: `scripts/seed.mjs` if protected-account seeding still uses operator IDs.

**Interfaces:**

- Produces a repeatable copied-database migration check before the real installation is touched.

- [ ] **Step 1: Add failing critical-path assertions**

Extend the existing critical path to cover username sign-in, Ryan Owner capabilities, Charles Administrator capabilities, Administrator denial for Owner-only account commands, Publisher assignment by Charles, ordinary passwordless app use, and historical snapshot rendering.

- [ ] **Step 2: Run the account E2E slice and verify RED**

Run the repository's existing Electron critical-path command filtered to the new account cases. Expected: failures identify any remaining operator login/authorization fixtures.

- [ ] **Step 3: Update security and architecture documentation**

Document the three effective roles, no-email identity, server-local password recovery, account-ID command binding, singleton Owner/Publisher pointers, operator retirement gate, and historical snapshot contract. Include the copied-database preflight and rollback procedure.

- [ ] **Step 4: Run all account-phase verification**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Then run the copied existing-install migration and verify:

```text
Owner:        username=ryan,   displayName=Ryan Bledsoe
Administrator username=charles, displayName=Charles Gibbs
Owner count:  1
Publisher count: 0 or 1
Operator collection: absent after successful migration
Paired device account IDs: unchanged
Historical non-empty name snapshots: unchanged
```

Expected: every gate passes before applying the migration to the real installation.

- [ ] **Step 5: Commit**

```bash
git add docs/SECURITY.md docs/architecture.md docs/DEVELOPMENT.md tests/e2e/critical-path.spec.ts scripts/seed.mjs
git commit -m "docs(auth): verify role account migration and recovery"
```

---

## Phase Completion Gate

Do not begin the Knowledge workspace plan until:

- focused and full tests pass;
- Ryan and Charles migrate correctly on a copied existing database;
- ordinary Relay use requires no account or operator selection;
- the live operator roster is absent after successful migration;
- privileged login, pairing, signed commands, and session revocation use account identity; and
- the working tree contains no unintended changes beyond the separate local review artifact in `output/`.
