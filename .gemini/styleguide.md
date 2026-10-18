# Relay review guide

Relay is an Electron desktop app (main, preload, renderer) with a PocketBase backend and a
Relay Web mode. Follow the conventions in `AGENTS.md` and `docs/DEVELOPMENT.md`.

Prioritize, in order:

1. Security at trust boundaries: IPC handlers, preload exposure, Relay Web, auto-update, file
   handling, credential storage, and privileged commands. Validate untrusted input.
2. Correctness bugs and data loss, especially in PocketBase sync, replay, and caching.
3. CI and release workflow safety: least-privilege permissions, pinned actions by commit SHA, no
   scanner secrets on fork pull requests.
4. Missing or weakened tests for changed behavior.

Skip formatting and lint nits; Prettier and ESLint already gate them.
