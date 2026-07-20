# First-Owner Username Setup Design

**Date:** 2026-07-20
**Status:** Approved

## Summary

Relay's server-local first-Owner setup will accept the Owner's login username instead of exposing the internal PocketBase account record ID. The main process will normalize the supplied username, resolve the matching pending Owner account, and continue using the canonical account ID for authorization and persistence.

## Scope

This change applies only while the server's Owner credential is pending initial configuration. That is normally a new Relay server, but it also includes an upgraded or reset data directory whose Owner credential has never been configured.

The change does not alter PocketBase startup, collection creation, role-account seeding or migration, stored authority pointers, normal privileged sign-in, existing configured servers, or Administrator and Publisher credential management.

## Data Flow

1. The first-time setup form labels its identity field `Owner username` and submits `{ username, password, passwordConfirm }`.
2. A dedicated IPC validation schema trims the username, requires a non-empty value within the existing username length limit, and preserves password validation.
3. The main-process account manager compares the normalized username case-insensitively against privileged account records.
4. The resolved record must match `relay_privileged_state.ownerAccountId` and must still be an inactive Administrator record with `mustChangePassword` set.
5. Credential replacement continues through the existing account-ID-based persistence path. Internal IDs do not cross into the setup UI.
6. After setup, the renderer signs in using the canonical username returned by the main process and the password already held locally by the form.

## Error Handling

- Unknown usernames, non-Owner usernames, and already-configured Owner accounts are rejected without changing credentials.
- Username comparison is trimmed and case-insensitive, so `ryan`, `Ryan`, and values with surrounding spaces resolve identically.
- The renderer presents a setup-specific failure message and does not turn an initial setup rejection into a normal sign-in error.
- Password length, confirmation matching, server-local IPC trust, and server-mode requirements remain unchanged.

## Testing

- Renderer coverage proves the form is username-labelled and sends a `username` field rather than `accountId`.
- IPC validation coverage proves usernames are trimmed, bounded, and required.
- Handler coverage proves the dedicated initial-owner input reaches the account manager only through trusted local server IPC.
- Account-manager coverage proves mixed-case and padded usernames resolve to the pending Owner while unknown or non-Owner usernames are rejected.
- Existing credential, sign-in, migration, and role-management tests remain green.

## Acceptance Criteria

- A pending server Owner can complete first-time setup with the username `ryan` without knowing a database record ID.
- Username matching is case-insensitive and ignores surrounding whitespace.
- Existing configured Owner credentials and normal sign-in behavior are unchanged.
- No internal account ID is requested or displayed in first-time Owner setup.
