# First-Owner Username Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the internal account-ID field in server-local first-Owner setup with a trimmed, case-insensitive username flow.

**Architecture:** Add a dedicated initial-Owner IPC input instead of overloading account-ID credential management. Validate and canonicalize the username at IPC, resolve it to the pending Owner in the main process, then reuse the existing account-ID credential replacement path.

**Tech Stack:** TypeScript, React, Electron IPC, PocketBase, Zod, Vitest, Testing Library

## Global Constraints

- Apply only while the server's Owner credential is pending initial configuration.
- Do not alter PocketBase bootstrap, role-account migration, stored authority pointers, normal sign-in, or non-Owner credential management.
- Match usernames after trimming and case-insensitive canonicalization.
- Keep passwords byte-preserving and enforce the existing 12-128 character limits and confirmation match.
- Never request or display the internal Owner account ID in first-time setup.

---

### Task 1: Dedicated Initial-Owner IPC Contract

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipcValidation.ts`
- Test: `src/shared/ipcValidation.test.ts`

**Interfaces:**
- Produces: `PrivilegedInitialOwnerSetupInput` with `{ username, password, passwordConfirm }`.
- Produces: `PrivilegedInitialOwnerSetupSchema`, returning a canonical lowercase username while preserving password bytes.

- [ ] **Step 1: Write the failing validation test**

Add an assertion that:

```ts
expect(
  PrivilegedInitialOwnerSetupSchema.parse({
    username: '  Ryan ',
    password: ` ${password} `,
    passwordConfirm: ` ${password} `,
  }),
).toEqual({
  username: 'ryan',
  password: ` ${password} `,
  passwordConfirm: ` ${password} `,
});
```

Also assert that `accountId`, unknown fields, malformed usernames, and mismatched confirmation are rejected.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/shared/ipcValidation.test.ts`

Expected: FAIL because `PrivilegedInitialOwnerSetupSchema` does not exist.

- [ ] **Step 3: Implement the contract**

Add:

```ts
export type PrivilegedInitialOwnerSetupInput = {
  username: string;
  password: string;
  passwordConfirm: string;
};
```

Extract the existing login username transform into a reusable schema, use it in `PrivilegedLoginSchema`, and define `PrivilegedInitialOwnerSetupSchema` with the same password and confirmation rules as credential setup. Change only `setupInitialAdministratorCredential` in `RelayApi` to consume the new input type.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/shared/ipcValidation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add src/shared/ipc.ts src/shared/ipcValidation.ts src/shared/ipcValidation.test.ts
git commit -m "refactor: add initial Owner username contract"
```

### Task 2: Resolve the Pending Owner by Username

**Files:**
- Modify: `src/main/privileged/PrivilegedAccountManager.ts`
- Test: `src/main/privileged/__tests__/PrivilegedAccountManager.test.ts`

**Interfaces:**
- Consumes: `PrivilegedInitialOwnerSetupInput`.
- Produces: `setupInitialAdministrator(input)` resolving the canonical username to the pending Owner record.

- [ ] **Step 1: Write failing manager tests**

Change the success case to call:

```ts
manager().setupInitialAdministrator({
  username: '  RyAn ',
  password: PASSWORD,
  passwordConfirm: PASSWORD,
});
```

Require the returned account to remain `account-ryan`. Add rejection cases for an unknown username and for a valid non-Owner username, with no account update.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/main/privileged/__tests__/PrivilegedAccountManager.test.ts`

Expected: FAIL because the manager still requires `accountId`.

- [ ] **Step 3: Implement username resolution**

Normalize the username with `normalizeRoleUsername`, query the canonical stored username with `getFirstListItem`, verify its ID equals `state.ownerAccountId`, and retain the existing pending-state checks:

```ts
const state = await this.getState();
const account = await this.getAccountByUsername(input.username);
if (account.id !== state.ownerAccountId) {
  throw new Error('Initial administrator setup is not available.');
}
```

Continue to call `replaceCredential(account, input, account.id, 'owner')` so persistence and device revocation remain ID-based.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/main/privileged/__tests__/PrivilegedAccountManager.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit username resolution**

```bash
git add src/main/privileged/PrivilegedAccountManager.ts src/main/privileged/__tests__/PrivilegedAccountManager.test.ts
git commit -m "fix: resolve initial Owner by username"
```

### Task 3: Wire the Trusted IPC and Preload Boundary

**Files:**
- Modify: `src/main/handlers/privilegedAccessHandlers.ts`
- Modify: `src/main/handlers/privilegedAccessHandlers.test.ts`
- Modify: `src/preload/index.test.ts`

**Interfaces:**
- Consumes: `PrivilegedInitialOwnerSetupSchema` and `PrivilegedInitialOwnerSetupInput`.
- Preserves: channel name `privileged:setupInitialAdministrator` and trusted local server checks.

- [ ] **Step 1: Write failing boundary tests**

Change the handler and preload fixtures for initial setup to:

```ts
const input = {
  username: '  Ryan ',
  password: PASSWORD,
  passwordConfirm: PASSWORD,
};
```

Require the handler to forward canonical `username: 'ryan'`, while `setupPrivilegedCredential` continues using `accountId`.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/main/handlers/privilegedAccessHandlers.test.ts src/preload/index.test.ts`

Expected: FAIL because the initial handler still validates the account-ID schema.

- [ ] **Step 3: Implement boundary wiring**

Import `PrivilegedInitialOwnerSetupSchema` and use it only for `PRIVILEGED_SETUP_INITIAL_ADMIN`. Keep `PrivilegedCredentialSetupSchema` for `PRIVILEGED_SETUP_CREDENTIAL`. Update preload test fixtures without changing the channel or exposed method name.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/main/handlers/privilegedAccessHandlers.test.ts src/preload/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit IPC wiring**

```bash
git add src/main/handlers/privilegedAccessHandlers.ts src/main/handlers/privilegedAccessHandlers.test.ts src/preload/index.test.ts
git commit -m "fix: validate initial Owner username over IPC"
```

### Task 4: Replace the Renderer ID Field with Username UX

**Files:**
- Modify: `src/renderer/src/components/settings/PrivilegedAccessPanel.tsx`
- Test: `src/renderer/src/components/settings/PrivilegedAccessPanel.test.tsx`

**Interfaces:**
- Consumes: `setupInitialAdministratorCredential({ username, password, passwordConfirm })`.
- Produces: a first-time form labelled `Owner username` with setup-specific feedback.

- [ ] **Step 1: Write the failing renderer test**

Open initial setup, require `clearError()` to run, fill `Owner username` with `Ryan`, and expect:

```ts
expect(setupInitialAdministratorCredential).toHaveBeenCalledWith({
  username: 'Ryan',
  password: 'a-new-owner-password',
  passwordConfirm: 'a-new-owner-password',
});
```

Assert `Owner account ID` is absent.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/renderer/src/components/settings/PrivilegedAccessPanel.test.tsx`

Expected: FAIL because the form still renders and submits `Owner account ID`.

- [ ] **Step 3: Implement the renderer change**

Rename the local identity state to `initialUsername`, label the input `Owner username`, clear stale sign-in and setup errors when opening the form, and submit:

```ts
{
  username: initialUsername.trim(),
  password: passwordToUse,
  passwordConfirm: initialPasswordConfirm,
}
```

Keep the success path that uses the canonical username returned by main for automatic sign-in.

- [ ] **Step 4: Verify GREEN and run final gates**

Run:

```bash
npx vitest run src/shared/ipcValidation.test.ts \
  src/main/privileged/__tests__/PrivilegedAccountManager.test.ts \
  src/main/handlers/privilegedAccessHandlers.test.ts \
  src/preload/index.test.ts \
  src/renderer/src/components/settings/PrivilegedAccessPanel.test.tsx
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Expected: all commands PASS with no new warnings or errors.

- [ ] **Step 5: Commit the renderer UX**

```bash
git add src/renderer/src/components/settings/PrivilegedAccessPanel.tsx src/renderer/src/components/settings/PrivilegedAccessPanel.test.tsx
git commit -m "fix: use username for first Owner setup"
```
