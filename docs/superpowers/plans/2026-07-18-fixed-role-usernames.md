# Fixed Role Usernames Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the authoritative Paris Carlson Publisher account to username `paris` and lock in case-insensitive privileged sign-in.

**Architecture:** Extend the existing legacy role-account migration's fixed-identity rules so Paris is handled beside Ryan and Charles while retaining the generic Publisher fallback. Keep sign-in normalization at the main-process session and PocketBase client boundaries; add characterization tests because those paths already canonicalize mixed-case input.

**Tech Stack:** TypeScript 6, Electron main process, PocketBase 0.26, Vitest 4

## Global Constraints

- Store protected usernames as lowercase canonical values.
- Preserve existing account IDs, password hashes, active state, `mustChangePassword`, credential versions, roles, and paired-device relationships.
- Defer migration before any writes when another account owns `paris` case-insensitively.
- Keep usernames immutable after account creation or migration.
- Keep password comparison case-sensitive and authentication failures generic.
- Do not add renderer-side authentication normalization or database-schema changes.

---

## File Structure

- `src/main/privileged/RoleAccountMigration.ts`: resolves fixed legacy identities, detects username conflicts, and plans in-place account updates.
- `src/main/privileged/__tests__/RoleAccountMigration.test.ts`: proves deterministic Paris migration, preserved credentials, and fail-closed collision handling.
- `src/main/privileged/__tests__/PrivilegedSessionManager.test.ts`: proves the session boundary canonicalizes user-entered login casing and whitespace.
- `src/main/privileged/__tests__/PrivilegedPocketBaseClient.test.ts`: proves the PocketBase authentication adapter sends only the canonical username.

### Task 1: Migrate Paris to the fixed username

**Files:**

- Modify: `src/main/privileged/__tests__/RoleAccountMigration.test.ts:328-368`
- Modify: `src/main/privileged/RoleAccountMigration.ts:113-114,278-289,363-471`

**Interfaces:**

- Consumes: legacy `publisherOperatorId`, matching `MigrationAccountRecord`, and operator display-name snapshots.
- Produces: the existing `PlannedAccount.username` field set to `paris` for the authoritative Paris Carlson Publisher.

- [ ] **Step 1: Write the failing deterministic-username and collision tests**

Change the existing Publisher fixture so it retains a credential sentinel and requires `paris`:

```ts
{
  id: 'account-publisher',
  operatorId: 'publisher-op',
  role: 'publisher',
  active: true,
  mustChangePassword: false,
  credentialVersion: 2,
  passwordHash: 'paris-existing-hash',
}
```

```ts
expect(fixture.record('relay_privileged_accounts', 'account-publisher')).toMatchObject({
  username: 'paris',
  displayName: 'Paris Carlson',
  storedRole: 'publisher',
  legacyOperatorId: 'publisher-op',
  active: true,
  mustChangePassword: false,
  credentialVersion: 2,
  passwordHash: 'paris-existing-hash',
});
expect(fixture.record('relay_privileged_state', 'privileged-state')).toMatchObject({
  publisherAccountId: 'account-publisher',
});
```

Add a second test whose legacy state authorizes an additional Administrator with username `PARIS` and assigns Paris Carlson as Publisher:

```ts
it('defers without writes when the fixed Paris username is already assigned', async () => {
  const base = legacyFixture();
  const fixture = legacyFixture({
    relay_operators: [
      ...base.records.get('relay_operators')!,
      { id: 'other-admin-op', displayName: 'Other Administrator', active: true },
      { id: 'publisher-op', displayName: 'Paris Carlson', active: true },
    ],
    relay_privileged_accounts: [
      ...base.records.get('relay_privileged_accounts')!,
      {
        id: 'account-other-admin',
        operatorId: 'other-admin-op',
        role: 'admin',
        username: 'PARIS',
        active: true,
        mustChangePassword: false,
        credentialVersion: 1,
      },
      {
        id: 'account-publisher',
        operatorId: 'publisher-op',
        role: 'publisher',
        active: true,
        mustChangePassword: false,
        credentialVersion: 2,
      },
    ],
    relay_privileged_state: [
      {
        id: 'privileged-state',
        key: 'primary',
        adminOperatorId: 'ryan-op',
        adminOperatorIds: ['ryan-op', 'charles-op', 'other-admin-op'],
        publisherOperatorId: 'publisher-op',
        assignmentVersion: 8,
      },
    ],
  });

  await expect(migration(fixture).run()).resolves.toMatchObject({
    status: 'deferred',
    reason: expect.stringContaining('paris username'),
  });
  expect(fixture.writes).toEqual([]);
  expect(fixture.hasCollection('relay_operators')).toBe(true);
});
```

- [ ] **Step 2: Run the migration tests and verify RED**

Run:

```bash
npx vitest run src/main/privileged/__tests__/RoleAccountMigration.test.ts
```

Expected: FAIL because the Publisher receives `paris.carlson`, and the `PARIS` collision currently does not defer.

- [ ] **Step 3: Add the minimal fixed-Paris migration rule**

Add the identity constant and allow fixed-username collision checks to accept `paris`:

```ts
const RYAN_DISPLAY_NAME = 'Ryan Bledsoe';
const CHARLES_DISPLAY_NAME = 'Charles Gibbs';
const PARIS_DISPLAY_NAME = 'Paris Carlson';
```

```ts
function fixedUsernameCollision(
  accounts: MigrationAccountRecord[],
  expectedUsername: string,
  target: MigrationAccountRecord,
): boolean {
  return accounts.some(
    (candidate) =>
      candidate.id !== target.id &&
      nonEmptyString(candidate.username) &&
      normalizeRoleUsername(candidate.username) === expectedUsername,
  );
}
```

Add a focused predicate after `AuthorityAccounts`:

```ts
function isParisPublisher(
  account: MigrationAccountRecord,
  authority: Pick<AuthorityAccounts, 'publisher' | 'operatorById'>,
): boolean {
  if (account.id !== authority.publisher?.id) return false;
  const operatorId = accountLegacyOperatorId(account);
  const operator = operatorId ? authority.operatorById.get(operatorId) : null;
  return normalizedDisplayName(operator?.displayName) === PARIS_DISPLAY_NAME;
}
```

Before returning the resolved `AuthorityAccounts`, fail closed on a conflicting fixed username:

```ts
const resolvedAuthority: AuthorityAccounts = {
  ...fixedAccounts,
  publisher: publisher ?? null,
  administrators,
  operatorById,
};
if (
  publisher &&
  isParisPublisher(publisher, resolvedAuthority) &&
  fixedUsernameCollision(accounts, 'paris', publisher)
) {
  return { reason: 'The paris username is already assigned.' };
}
return resolvedAuthority;
```

Reserve and return `paris` beside the existing fixed usernames:

```ts
function initialReservedUsernames(
  accounts: MigrationAccountRecord[],
  authority: Pick<AuthorityAccounts, 'ryan' | 'charles' | 'publisher' | 'operatorById'>,
): Set<string> {
  const reserved = new Set<string>();
  for (const account of accounts) {
    if (nonEmptyString(account.username)) reserved.add(normalizeRoleUsername(account.username));
  }
  const fixedAccounts = [authority.ryan, authority.charles];
  if (authority.publisher && isParisPublisher(authority.publisher, authority)) {
    fixedAccounts.push(authority.publisher);
  }
  for (const account of fixedAccounts) {
    if (nonEmptyString(account.username)) reserved.delete(normalizeRoleUsername(account.username));
  }
  reserved.add('ryan');
  reserved.add('charles');
  if (authority.publisher && isParisPublisher(authority.publisher, authority)) {
    reserved.add('paris');
  }
  return reserved;
}
```

```ts
function usernameForAccount(
  account: MigrationAccountRecord,
  displayName: string,
  authority: Pick<AuthorityAccounts, 'ryan' | 'charles' | 'publisher' | 'operatorById'>,
  reserved: Set<string>,
): string {
  if (account.id === authority.ryan.id) return 'ryan';
  if (account.id === authority.charles.id) return 'charles';
  if (isParisPublisher(account, authority)) return 'paris';
  const current = nonEmptyString(account.username) ? normalizeRoleUsername(account.username) : null;
  if (current && getRoleUsernameError(current) === null) {
    reserved.delete(current);
    return allocateUsername(current, reserved);
  }
  return allocateUsername(generatedUsername(displayName), reserved);
}
```

- [ ] **Step 4: Run the migration tests and verify GREEN**

Run:

```bash
npx vitest run src/main/privileged/__tests__/RoleAccountMigration.test.ts
```

Expected: all `RoleAccountMigration` tests PASS with no warnings.

- [ ] **Step 5: Commit the migration behavior**

```bash
git add src/main/privileged/RoleAccountMigration.ts src/main/privileged/__tests__/RoleAccountMigration.test.ts
git commit -m "fix(auth): migrate Paris to fixed username"
```

### Task 2: Lock in case-insensitive privileged sign-in

**Files:**

- Modify: `src/main/privileged/__tests__/PrivilegedSessionManager.test.ts:82-101`
- Modify: `src/main/privileged/__tests__/PrivilegedPocketBaseClient.test.ts:129-141`

**Interfaces:**

- Consumes: `PrivilegedSessionManager.login({ username, password })` and `PrivilegedPocketBaseClient.authenticate(username, password)`.
- Produces: regression evidence that both boundaries canonicalize mixed-case, whitespace-padded usernames to lowercase.

- [ ] **Step 1: Add session-boundary normalization coverage**

```ts
it('normalizes username casing and whitespace before authentication', async () => {
  const manager = createManager();

  await manager.login({ username: '  RyAn  ', password: PASSWORD });

  expect(authClient.authenticate).toHaveBeenCalledWith('ryan', PASSWORD);
  expect(manager.getView()).toMatchObject({ state: 'active', username: 'ryan' });
});
```

- [ ] **Step 2: Add PocketBase-client normalization coverage**

```ts
it('canonicalizes mixed-case usernames before PocketBase authentication', async () => {
  const client = createPrivilegedClient();

  await client.authenticate('  RyAn  ', PASSWORD);

  expect(authWithPassword).toHaveBeenCalledWith('ryan', PASSWORD, { requestKey: null });
});
```

- [ ] **Step 3: Run both authentication test files**

Run:

```bash
npx vitest run src/main/privileged/__tests__/PrivilegedSessionManager.test.ts src/main/privileged/__tests__/PrivilegedPocketBaseClient.test.ts
```

Expected: both new tests PASS because canonicalization already exists at both main-process boundaries.

- [ ] **Step 4: Commit the authentication regressions**

```bash
git add src/main/privileged/__tests__/PrivilegedSessionManager.test.ts src/main/privileged/__tests__/PrivilegedPocketBaseClient.test.ts
git commit -m "test(auth): lock case-insensitive sign-in"
```

### Task 3: Verify the complete change

**Files:**

- Verify: `src/main/privileged/RoleAccountMigration.ts`
- Verify: `src/main/privileged/__tests__/RoleAccountMigration.test.ts`
- Verify: `src/main/privileged/__tests__/PrivilegedSessionManager.test.ts`
- Verify: `src/main/privileged/__tests__/PrivilegedPocketBaseClient.test.ts`

**Interfaces:**

- Consumes: the complete fixed-username migration and authentication regression commits.
- Produces: repository-wide evidence that the change is type-safe, formatted, tested, lint-clean, and buildable.

- [ ] **Step 1: Run focused tests together**

```bash
npx vitest run src/main/privileged/__tests__/RoleAccountMigration.test.ts src/main/privileged/__tests__/PrivilegedSessionManager.test.ts src/main/privileged/__tests__/PrivilegedPocketBaseClient.test.ts
```

Expected: all selected test files PASS with zero failures.

- [ ] **Step 2: Run static and formatting gates**

```bash
npm run typecheck
npm run lint
npx prettier --check src/main/privileged/RoleAccountMigration.ts src/main/privileged/__tests__/RoleAccountMigration.test.ts src/main/privileged/__tests__/PrivilegedSessionManager.test.ts src/main/privileged/__tests__/PrivilegedPocketBaseClient.test.ts
git diff --check
```

Expected: every command exits `0` with no lint errors, formatting differences, or whitespace errors.

- [ ] **Step 3: Run the complete automated test suite and build**

```bash
npm test
npm run build
```

Expected: all unit, cache, and renderer tests PASS, followed by a successful Electron Vite build.

- [ ] **Step 4: Confirm final repository scope**

```bash
git status --short --branch
git log --oneline --decorate -5
```

Expected: branch `test` is ahead only by the approved design, plan, migration, and authentication-test commits; the pre-existing untracked `output/` directory remains untouched.
