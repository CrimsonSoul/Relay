# Privileged Access Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Invoke `superpowers:test-driven-development` before each production change and `superpowers:verification-before-completion` before each completion claim.

**Goal:** Add a LAN-safe privileged identity, pairing, session, and signed-command foundation without changing passwordless operator attribution or Relay's existing shared PocketBase sync session.

**Architecture:** PocketBase stores privileged accounts, current role assignment, paired public keys, and idempotent command results. A separate main-process PocketBase client owns privileged authentication; its token never enters renderer state and never replaces the shared Relay app-user token. Each paired laptop creates an asymmetric signing key in Electron `safeStorage`; the server validates a short-lived canonical signed envelope, derives current capabilities from authoritative server records, and executes only allowlisted typed commands. The first command is a read-only capability probe so the complete boundary can be verified before operator or Knowledge Base mutations are added.

**Tech Stack:** Electron 42, TypeScript 6, React 19, PocketBase SDK 0.26.8, Node `crypto`, Electron `safeStorage`, Zod 4, Vitest, Testing Library, Playwright.

## Global Constraints

- Preserve the existing passwordless operator selector. Selecting an elevated operator never authenticates a privileged account.
- Preserve `getPbConnection()`, `RELAY_APP_USER_EMAIL`, client discovery, realtime, reconnect, `initializeClientOfflineInfrastructure`, and offline Knowledge Base reading.
- Keep privileged auth tokens, passwords, pairing secrets, private keys, and raw signed payloads out of renderer state, localStorage, logs, ordinary cache snapshots, exports, and crash messages.
- Do not add an inbound listener or port. Remote requests use the existing authenticated PocketBase connection.
- Treat the server PC as the local recovery trust boundary: it does not need a paired-device record, but local privileged actions still require authentication, pass through the same typed domain handlers, and produce the same command/audit results.
- Treat HTTP on the LAN accurately: command signatures provide authenticity, integrity, replay resistance, and authorization, but do not provide transport confidentiality.
- Never trust a renderer-supplied role or capability. The server derives effective permissions from current account, operator, assignment, and device records for every command.
- Privileged commands are online-only and never enter `WRITABLE_CACHE_COLLECTIONS` or the offline mutation queue.
- Apply strict input limits, trusted-sender checks, rate limits, generic credential errors, 15-minute privileged inactivity locking, and current-revision checks.
- Use `apply_patch` for edits, preserve unrelated worktree changes, and commit each coherent task only after its focused tests pass.

---

## File Structure

### Shared contracts

- Create `src/shared/privilegedAccess.ts` for collection names, roles, capabilities, account/device/session views, pairing results, limits, and pure capability helpers.
- Create `src/shared/privilegedCommands.ts` for canonical envelopes, command names, payload/result maps, signing serialization, and status normalization.
- Update `src/shared/ipc.ts` and `src/shared/ipcValidation.ts` with the narrow privileged bridge.
- Create `src/shared/__tests__/privilegedAccess.test.ts` and `src/shared/__tests__/privilegedCommands.test.ts`; extend `src/shared/ipcValidation.test.ts`.

### Main process

- Extend `src/main/pocketbase/CollectionBootstrap.ts` with the privileged auth/base collections and initial administrator migration.
- Create `src/main/privileged/PrivilegedPocketBaseClient.ts` for the independent auth store/client.
- Create `src/main/privileged/PrivilegedDeviceStore.ts` for safeStorage-protected signing keys.
- Create `src/main/privileged/PrivilegedSessionManager.ts` for login, logout, lock, inactivity, and reauthentication.
- Create `src/main/privileged/PrivilegedPairingService.ts` for server-issued one-time pairing challenges and device activation.
- Create `src/main/privileged/PrivilegedCommandProcessor.ts` for idempotency, signature verification, current-state authorization, and typed dispatch.
- Create `src/main/privileged/privilegedRuntime.ts` for startup, reconfigure, and shutdown lifecycle.
- Create `src/main/handlers/privilegedAccessHandlers.ts`; update `src/main/ipcHandlers.ts`, `src/main/app/appState.ts`, `src/main/app/runtimeReconfigure.ts`, and `src/main/rateLimiter.ts`.

### Preload and renderer

- Update `src/preload/index.ts` with bounded session, login, logout, lock, pairing, and signed-command methods.
- Create `src/renderer/src/contexts/PrivilegedAccessContext.tsx` for public session state only.
- Create `src/renderer/src/components/settings/PrivilegedAccessPanel.tsx` and its stylesheet additions for login, pairing, lock, and session state.
- Mount the provider in `src/renderer/src/App.tsx` without coupling it to `OperatorContext` selection.

### Documentation

- Update `docs/architecture.md` and `docs/SECURITY.md` with the privileged boundary, transport limitation, token isolation, pairing, replay protection, and recovery path.

---

## Task 1: Define Roles, Capabilities, and Public Session Contracts

**Files:**

- Create: `src/shared/privilegedAccess.ts`
- Create: `src/shared/__tests__/privilegedAccess.test.ts`

- [ ] Write failing tests for role parsing, the exact initial capability matrix, active-account requirements, the 15-minute idle constant, hostname/label limits, and public-session normalization that discards tokens and unknown fields.
- [ ] Run `npx vitest run src/shared/__tests__/privilegedAccess.test.ts` and confirm RED because `@shared/privilegedAccess` does not exist.
- [ ] Implement these exact public primitives:

```ts
export const PRIVILEGED_SESSION_IDLE_MS = 15 * 60 * 1_000;
export const RELAY_PRIVILEGED_ACCOUNTS_COLLECTION = 'relay_privileged_accounts';
export const RELAY_PRIVILEGED_STATE_COLLECTION = 'relay_privileged_state';
export const RELAY_PRIVILEGED_DEVICES_COLLECTION = 'relay_privileged_devices';
export const RELAY_PRIVILEGED_COMMANDS_COLLECTION = 'relay_privileged_commands';

export type PrivilegedRole = 'admin' | 'publisher';
export type PrivilegedCapability =
  | 'privileged.status.read'
  | 'operators.manage'
  | 'publisher.assign'
  | 'devices.manage'
  | 'settings.manage'
  | 'knowledge.manage';

export type PrivilegedSessionView = {
  state: 'signed-out' | 'pairing-required' | 'active' | 'locked' | 'offline';
  accountId: string | null;
  operatorId: string | null;
  operatorName: string | null;
  role: PrivilegedRole | null;
  capabilities: PrivilegedCapability[];
  deviceId: string | null;
  expiresAt: string | null;
};
```

- [ ] Define admin capabilities as all six entries; publisher capabilities as `privileged.status.read` and `knowledge.manage` only.
- [ ] Ensure normalization returns a defensive copy and cannot accept a token, password, password hash, private key, public key, or arbitrary capability.
- [ ] Run `npx vitest run src/shared/__tests__/privilegedAccess.test.ts && npm run typecheck`; confirm both exit 0.
- [ ] Commit with `feat(privileged): define access contracts`.

## Task 2: Define Canonical Signed Command Envelopes

**Files:**

- Create: `src/shared/privilegedCommands.ts`
- Create: `src/shared/__tests__/privilegedCommands.test.ts`

- [ ] Write failing tests proving deterministic serialization regardless of object key insertion order, stable UTF-8 bytes, rejected `undefined`/non-finite/nested-oversize values, expiry enforcement, lowercase SHA-256 hashes, and unique request ID bounds.
- [ ] Run `npx vitest run src/shared/__tests__/privilegedCommands.test.ts` and confirm RED because the module is absent.
- [ ] Define the initial allowlisted command map:

```ts
export type PrivilegedCommandPayloadMap = {
  'privileged.status.read': { clientVersion: string };
  'privileged.reauth.confirm': { authenticatedAt: string };
};

export type SignedPrivilegedCommandEnvelope<K extends PrivilegedCommandName = PrivilegedCommandName> = {
  version: 1;
  requestId: string;
  accountId: string;
  deviceId: string;
  roleClaim: PrivilegedRole;
  command: K;
  payload: PrivilegedCommandPayloadMap[K];
  payloadHash: string;
  expectedRevision: number | null;
  issuedAt: string;
  expiresAt: string;
  signature: string;
};
```

- [ ] Canonicalize only validated data with recursively sorted object keys, original array order, JSON string escaping, and no locale-dependent formatting.
- [ ] Sign the UTF-8 serialization of every field except `signature`; bind the explicit command name and payload hash.
- [ ] Cap envelopes at 64 KiB, IDs at 128 characters, clock skew at 60 seconds, and command lifetime at 90 seconds.
- [ ] Add a discriminated result with `ok`, `unauthorized`, `locked`, `offline`, `pairing-required`, `invalid-request`, `expired`, `replayed`, `conflict`, and `server-error` outcomes; never expose internal exception text.
- [ ] Run `npx vitest run src/shared/__tests__/privilegedCommands.test.ts && npm run typecheck`; confirm both exit 0.
- [ ] Commit with `feat(privileged): define signed command protocol`.

## Task 3: Bootstrap Privileged Collections and the Initial Administrator

**Files:**

- Modify: `src/main/pocketbase/CollectionBootstrap.ts`
- Modify: `src/main/pocketbase/__tests__/CollectionBootstrap.test.ts`
- Modify: `src/shared/operators.ts`
- Modify: `src/shared/operators.test.ts`

- [ ] Add failing operator tests for the exact nine-person initial roster and no duplicate normalized names: Charles Gibbs, Connor McElroy, Paris Carlson, Ryan Bell, Ryan Bledsoe, Tristan Bowles, Tristan Stillwell, Vlad McCarty, and Weston Yokley.
- [ ] Add failing bootstrap tests for an auth collection named `relay_privileged_accounts` linked one-to-one to `relay_operators`, base collections for state/devices/commands, unique indexes, server-owned mutation rules, and recovery-safe seeding.
- [ ] Run `npx vitest run src/shared/operators.test.ts src/main/pocketbase/__tests__/CollectionBootstrap.test.ts` and confirm the missing roster/collection assertions fail.
- [ ] Extend `CollectionDef` so it can represent PocketBase `type: 'auth'`, auth rules, enabled password authentication, and the installed API's auth configuration without weakening base-collection patching. Configure the unique `operatorId` field as the stable password-auth identity so display-name changes do not change login identity.
- [ ] Create account fields `operatorId`, `role`, `active`, `mustChangePassword`, and `credentialVersion`; state fields `key`, `adminOperatorId`, `publisherOperatorId`, `assignmentVersion`, `updatedByOperatorId`, and `updatedAt`; device fields `accountId`, `deviceId`, `hostnameSnapshot`, `publicKey`, `fingerprint`, `state`, `pairedAt`, `lastUsedAt`, `revokedAt`, `revokedByOperatorId`, and `revision`; command fields for the bounded envelope, status, safe result, and expiry.
- [ ] Keep account/device/command list and view inaccessible to the ordinary Relay app user. Allow ordinary authenticated app users to read only the nonsecret singleton role state used for `ADMIN`/`PUBLISHER` chips; its writes remain server-only. Privileged command create/view rules are scoped to the active authenticated privileged account whose ID matches `accountId`.
- [ ] Seed/recover Ryan Bledsoe's inactive administrator account and singleton state deterministically. Give the bootstrap account an unreachable random credential; never ship or display a default password. First password setup replaces it through a local server-only action.
- [ ] Make seeding additive and idempotent even when an existing custom roster contains extra rows; never reactivate or rename an operator the user changed.
- [ ] Run `npx vitest run src/shared/operators.test.ts src/main/pocketbase/__tests__/CollectionBootstrap.test.ts && npm run typecheck`; confirm both exit 0.
- [ ] Commit with `feat(privileged): bootstrap accounts and devices`.

## Task 4: Protect the Device Signing Key

**Files:**

- Create: `src/main/privileged/PrivilegedDeviceStore.ts`
- Create: `src/main/privileged/__tests__/PrivilegedDeviceStore.test.ts`

- [ ] Add failing tests for P-256 key generation, public JWK export, safeStorage encryption/decryption, atomic persistence, fingerprint stability, corrupted data, unavailable safeStorage, account/device mismatch, key removal, and no private-key logging.
- [ ] Run `npx vitest run src/main/privileged/__tests__/PrivilegedDeviceStore.test.ts` and confirm RED because the store is absent.
- [ ] Implement an injected store with this boundary:

```ts
export interface PrivilegedDeviceKeyStore {
  create(accountId: string, label: string): Promise<PendingDeviceKey>;
  load(accountId: string, deviceId: string): Promise<LoadedDeviceKey | null>;
  bind(accountId: string, pendingKeyId: string, deviceId: string): Promise<void>;
  remove(accountId: string, deviceId: string): Promise<void>;
  sign(accountId: string, deviceId: string, bytes: Uint8Array): Promise<string>;
}
```

- [ ] Store the PKCS#8 private key only inside `safeStorage.encryptString()` output under Relay's config directory; store public JWK, fingerprint, account ID, device ID, and label as nonsecret metadata.
- [ ] Use owner-only file permissions where supported, temporary-file plus rename promotion, and a single queued writer.
- [ ] Return `pairing-required` when safeStorage is unavailable or data is corrupt; never fall back to plaintext.
- [ ] Run `npx vitest run src/main/privileged/__tests__/PrivilegedDeviceStore.test.ts && npm run typecheck`; confirm both exit 0.
- [ ] Commit with `feat(privileged): protect device signing keys`.

## Task 5: Isolate Privileged Authentication and Session Locking

**Files:**

- Create: `src/main/privileged/PrivilegedPocketBaseClient.ts`
- Create: `src/main/privileged/PrivilegedSessionManager.ts`
- Create: `src/main/privileged/__tests__/PrivilegedPocketBaseClient.test.ts`
- Create: `src/main/privileged/__tests__/PrivilegedSessionManager.test.ts`

- [ ] Add failing tests proving the privileged client has an independent in-memory auth store, never mutates `getPbClient().authStore`, clears auth on disconnect/reconfigure, maps invalid credentials generically, and never persists a raw token.
- [ ] Add fake-clock tests for activity refresh, lock exactly after 15 minutes of privileged inactivity, ordinary Relay activity not extending the timer, explicit lock/logout, selected-operator changes, app close, account disablement, operator mismatch, and password reauthentication proof expiry.
- [ ] Run `npx vitest run src/main/privileged/__tests__/PrivilegedPocketBaseClient.test.ts src/main/privileged/__tests__/PrivilegedSessionManager.test.ts` and confirm RED because the managers do not exist.
- [ ] Implement `PrivilegedPocketBaseClient` with a fresh `PocketBase(serverUrl, new BaseAuthStore())` and server URL policy identical to the current client connection policy.
- [ ] Implement this public service boundary:

```ts
export interface PrivilegedSessionManager {
  getView(): PrivilegedSessionView;
  login(input: { operatorId: string; password: string }): Promise<PrivilegedSessionView>;
  reauthenticate(password: string): Promise<{ proofId: string; expiresAt: string }>;
  recordPrivilegedActivity(): void;
  lock(): void;
  logout(): Promise<void>;
  dispose(): void;
}
```

- [ ] Enforce the approved 12–128 character password bound. Password strings exist only for the duration of the trusted IPC call, are never trimmed or logged, are cleared from renderer state in `finally`, and are not retained by the main-process service after the awaited authentication call.
- [ ] Session views contain only the approved public fields. `reauthenticate(password)` performs a fresh PocketBase password authentication in main process, then submits the internal signed `privileged.reauth.confirm` command. Return that completed command request ID as the opaque proof; the generic renderer command bridge must not permit callers to construct the internal command directly.
- [ ] Run `npx vitest run src/main/privileged/__tests__/PrivilegedPocketBaseClient.test.ts src/main/privileged/__tests__/PrivilegedSessionManager.test.ts && npm run typecheck`; confirm all exit 0.
- [ ] Commit with `feat(privileged): isolate privileged sessions`.

## Task 6: Implement One-Time Device Pairing

**Files:**

- Create: `src/main/privileged/PrivilegedPairingService.ts`
- Create: `src/main/privileged/__tests__/PrivilegedPairingService.test.ts`
- Modify: `src/main/rateLimiter.ts`
- Modify: `src/main/rateLimiter.test.ts`

- [ ] Add failing tests for a local-server-only challenge, 10-minute expiry, single use, random 8-character human code plus high-entropy secret, account binding, public-key validation, hostname/label bounds, duplicate fingerprint rejection, failed-attempt lockout, and completed-device activation.
- [ ] Add failing rate-limit tests for login, pairing verification, and signed-command submission buckets.
- [ ] Run `npx vitest run src/main/privileged/__tests__/PrivilegedPairingService.test.ts src/main/rateLimiter.test.ts` and confirm RED at the missing service/limiters.
- [ ] Implement local challenge creation through a trusted server-renderer IPC only; return the human code to the server PC and require the remote client to submit both its authenticated account and generated public key.
- [ ] Store only a hash of the pairing secret, expire it in memory and server state, consume it before device activation, and make retries idempotent by challenge ID plus fingerprint.
- [ ] Configure conservative limits: five login attempts per account/device per 15 minutes, five pairing attempts per challenge per 10 minutes, and 60 signed commands per device per minute with a short burst of 10.
- [ ] Run `npx vitest run src/main/privileged/__tests__/PrivilegedPairingService.test.ts src/main/rateLimiter.test.ts && npm run typecheck`; confirm all exit 0.
- [ ] Commit with `feat(privileged): pair trusted devices`.

## Task 7: Validate and Process the First Signed Command

**Files:**

- Create: `src/main/privileged/PrivilegedCommandProcessor.ts`
- Create: `src/main/privileged/__tests__/PrivilegedCommandProcessor.test.ts`

- [ ] Add failing tests for validation order, current account/operator/device checks, ECDSA verification, payload hash mismatch, role-claim mismatch, disabled/revoked state, expiry/skew, request ID replay, in-progress recovery, current capability derivation, result bounding, and audit-safe errors.
- [ ] Run `npx vitest run src/main/privileged/__tests__/PrivilegedCommandProcessor.test.ts` and confirm RED because the processor is absent.
- [ ] Inject PocketBase, clock, nonce generator, logger, capability resolver, and command handlers. Implement `privileged.status.read` plus the internal `privileged.reauth.confirm` handler in this phase.
- [ ] Claim a request ID with a unique index before side effects. A repeated completed request returns its stored safe result; a conflicting envelope with the same ID returns `replayed`.
- [ ] Derive effective role from `relay_privileged_state` and current account records; compare but never trust `roleClaim`.
- [ ] Verify the public key fingerprint and signature after device/current-state checks, then validate the typed payload and optional expected revision.
- [ ] Support a distinct trusted-local execution context for the server PC with `deviceId: null`; it bypasses remote signature/pairing checks only after trusted-sender, server-mode, and active privileged-session validation, and still uses request IDs, authorization, revisions, results, and audit.
- [ ] Treat a successful `privileged.reauth.confirm` request ID as proof only for the same account/device, for at most five minutes, and once. High-risk handlers consume that prior request ID before mutation. The proof record contains only the signed account/device/timestamp attestation.
- [ ] Persist only the approved bounded command envelope, signature, safe result, and lifecycle fields. Never store passwords, auth tokens, private keys, PDF bytes, or unbounded raw errors.
- [ ] Run `npx vitest run src/main/privileged/__tests__/PrivilegedCommandProcessor.test.ts && npm run typecheck`; confirm both exit 0.
- [ ] Commit with `feat(privileged): process signed commands`.

## Task 8: Add Trusted IPC, Lifecycle, and Renderer Session UI

**Files:**

- Create: `src/main/handlers/privilegedAccessHandlers.ts`
- Create: `src/main/handlers/privilegedAccessHandlers.test.ts`
- Create: `src/main/privileged/privilegedRuntime.ts`
- Create: `src/renderer/src/contexts/PrivilegedAccessContext.tsx`
- Create: `src/renderer/src/contexts/PrivilegedAccessContext.test.tsx`
- Create: `src/renderer/src/components/settings/PrivilegedAccessPanel.tsx`
- Create: `src/renderer/src/components/settings/PrivilegedAccessPanel.test.tsx`
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipcValidation.ts`
- Modify: `src/shared/ipcValidation.test.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.test.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/main/__tests__/ipcHandlers.test.ts`
- Modify: `src/main/app/appState.ts`
- Modify: `src/main/app/__tests__/appState.test.ts`
- Modify: `src/main/app/runtimeReconfigure.ts`
- Modify: `src/main/app/__tests__/runtimeReconfigure.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/SettingsModal.tsx`

- [ ] Add failing schema/handler/preload tests for trusted sender enforcement, strict unknown-key rejection, password size bounds, generic errors, server-only pairing challenge creation, public session event delivery, and exact bridge exposure.
- [ ] Add failing lifecycle tests proving managers start only after configuration is known, dispose before reconfigure/shutdown, clear sessions on mode/URL changes, and never replace the existing shared PB client or offline infrastructure.
- [ ] Add failing renderer tests for signed-out, pairing-required, active, locked, and offline states; keyboard submission; password clearing; focus return; and publisher/admin role labels.
- [ ] Run `npx vitest run src/shared/ipcValidation.test.ts src/preload/index.test.ts src/main/handlers/privilegedAccessHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/app/__tests__/appState.test.ts src/main/app/__tests__/runtimeReconfigure.test.ts src/renderer/src/contexts/PrivilegedAccessContext.test.tsx src/renderer/src/components/settings/PrivilegedAccessPanel.test.tsx` and confirm RED at the new bridge/UI assertions.
- [ ] Add these renderer-safe bridge methods only: `getPrivilegedSession`, `loginPrivileged`, `logoutPrivileged`, `lockPrivileged`, `reauthenticatePrivileged`, `createPrivilegedPairingChallenge`, `completePrivilegedPairing`, `submitPrivilegedCommand`, and `onPrivilegedSessionChanged`. Type `submitPrivilegedCommand` as the public domain-command union and explicitly exclude internal `privileged.reauth.confirm` construction.
- [ ] Validate every IPC argument with strict Zod schemas in main, use existing trusted-sender enforcement, and broadcast only `PrivilegedSessionView`.
- [ ] Mount `PrivilegedAccessProvider` beside `OperatorProvider`. The context may compare the selected operator for display/entry affordances, but operator selection cannot create or extend a privileged session.
- [ ] Add the compact panel within Settings with explicit `Sign in`, `Lock`, `Sign out`, and paired-device guidance; keep it usable at roughly half a 1080p display without horizontal overflow.
- [ ] Rerun the preceding focused command, then run `npm run typecheck && npm run build`; confirm all exit 0.
- [ ] Commit with `feat(privileged): wire secure session access`.

## Task 9: Add Security Documentation and End-to-End Foundation Coverage

**Files:**

- Modify: `tests/e2e/critical-path.spec.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/SECURITY.md`

- [ ] Add an E2E server/client test that confirms a normal operator remains passwordless, privileged login does not change shared PocketBase connectivity, an unpaired client receives `pairing-required`, a paired active session runs the capability probe, 15-minute simulated inactivity locks the session, and normal cached Knowledge documents remain readable after server disconnect.
- [ ] Run `npm run test:electron -- --grep "privileged access foundation"` and confirm RED at the first missing flow before implementing test-only fixtures/hooks.
- [ ] Add deterministic test-only account/password/pairing fixtures behind the existing E2E environment boundary; never ship a default credential in production code.
- [ ] Document the exact trust boundaries, key/token storage, pairing/revocation flow, replay rules, password recovery, HTTP confidentiality limitation, and why no new inbound port is required.
- [ ] Run the focused E2E test, then the full gates:

```bash
npm run typecheck
npm run lint
npm run test
npm run test:electron
npm run build
```

- [ ] Confirm each command exits 0, inspect `git diff --check`, and verify privileged collection names are absent from ordinary cache/offline-write allowlists.
- [ ] Commit with `docs(privileged): document access boundary`.

## Plan Completion Checklist

- [ ] Search changed files for `TODO|TBD|FIXME|placeholder|appropriate error handling|write tests for above` and resolve every match introduced by this work.
- [ ] Verify every shared contract is imported by at least one production boundary and one focused test.
- [ ] Verify renderer bundles contain no `authStore`, privileged token, private key, pairing secret, or raw password persistence.
- [ ] Verify server/client reconfigure, offline reading, and the ordinary passwordless operator selector still pass.
- [ ] Invoke `superpowers:requesting-code-review`, address accepted findings with `superpowers:receiving-code-review`, then invoke `superpowers:verification-before-completion` before declaring this phase complete.
