# Fixed Role Usernames Design

**Date:** 2026-07-18
**Status:** Approved design; awaiting written-spec review

## Summary

Relay's existing-installation role migration will assign the three known production identities deterministic login usernames: Ryan Bledsoe becomes `ryan`, Charles Gibbs becomes `charles`, and the authoritative Paris Carlson Publisher becomes `paris`. Privileged sign-in will continue to accept any username capitalization while storing and comparing the canonical lowercase username.

## Relationship to the Role-Account Design

This design narrows one migration rule in `2026-07-17-role-accounts-and-knowledge-workspace-design.md`. It replaces the generic generated username for the known Paris Carlson Publisher with the fixed username `paris`. All other role-account, authorization, credential, pairing, migration, and operator-retirement requirements remain unchanged.

## Migration Behavior

- Ryan Bledsoe's authoritative Owner account receives username `ryan`.
- Charles Gibbs's Administrator account receives username `charles`.
- When the authoritative legacy Publisher pointer resolves to the unique Paris Carlson operator and its matching privileged account, that account receives username `paris`.
- The migration updates the existing account record rather than creating a replacement. Its account ID, password hash, active state, `mustChangePassword` state, credential version, role, and paired-device relationships remain attached to the same account.
- Username uniqueness is evaluated after lowercase normalization. If another account already owns `paris`, migration defers before making writes and reports the collision on the Relay server PC.
- A Publisher other than Paris Carlson retains the existing generic deterministic-username behavior. The migration does not guess that another person should receive the `paris` identity.
- Successfully converted databases remain idempotent; repeated bootstrap runs do not rewrite credentials or identity state.

## Sign-In Behavior

- Stored usernames remain lowercase canonical values.
- The privileged sign-in boundary trims surrounding whitespace and lowercases the supplied username before PocketBase authentication.
- `PARIS`, `Paris`, and `paris` therefore authenticate against the `paris` account with the same password.
- Password comparison remains case-sensitive and otherwise unchanged.
- Authentication failures remain generic and do not reveal whether a username exists.

The current session and PocketBase client paths already normalize login usernames. This change adds explicit regression coverage rather than duplicating normalization in the renderer.

## Non-goals

- Usernames remain immutable after account creation or migration.
- Display-name editing remains independent of login identity.
- This change does not add email identity, password recovery, or manual database editing workflows.
- This change does not alter Publisher assignment authority or allow more than one authoritative Publisher.

## Testing

- Update the existing Paris migration test to require username `paris` and verify the Publisher account ID and authoritative pointer are preserved.
- Add a migration test proving a case-insensitive `paris` collision defers before any writes.
- Add privileged-session coverage proving a mixed-case username is normalized before authentication.
- Add PocketBase-client coverage proving direct privileged authentication canonicalizes mixed-case input.
- Run the focused migration and authentication tests, then the repository typecheck, lint, formatting, full test, and build gates.

## Acceptance Criteria

- A matching production migration yields Owner `ryan`, Administrator `charles`, and Publisher `paris`.
- The three accounts retain their existing credentials and account relationships.
- A conflicting `paris` username cannot cause a partial migration.
- Privileged login accepts any capitalization of a valid stored username.
- Password handling and authorization behavior are unchanged.
