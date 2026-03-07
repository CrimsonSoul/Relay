# Relay Review Fixes Design

## Goal

Fix the concrete runtime, security, contract, and test-quality issues found in the March 6 review pass without expanding scope beyond those findings.

## Scope

- Normalize IPC contracts so shared typings match real main/preload behavior.
- Fix the save-group UX so failed persistence does not look like success.
- Tighten permission and webview trust behavior around remote origins.
- Remove known renderer test warnings so the suite is high-signal again.

## Non-Goals

- No UI redesign beyond failure-state handling.
- No broad auth or storage refactors outside the reviewed issues.
- No packaging, release, or CI changes unless required by the fixes.

## Approach Options

### Option 1: Coordinated contract-first fix pass

Update shared types and main/preload behavior together, then adjust renderer and tests to the normalized contracts.

Pros:

- Keeps the codebase internally consistent.
- Reduces follow-up churn across renderer and test code.
- Lets verification happen against the final intended API.

Cons:

- Touches multiple layers in one pass.

### Option 2: Runtime-only patches first

Patch the failing runtime paths while leaving type and test cleanup for later.

Pros:

- Lower immediate change surface.

Cons:

- Leaves contract drift and warning noise in place.
- Makes future changes less trustworthy.

### Option 3: Security-only hardening first

Prioritize permission and webview policy changes, then return for correctness and tests.

Pros:

- Fastest way to reduce security exposure.

Cons:

- Leaves user-visible bugs and broken contracts behind.

## Recommended Approach

Use Option 1. The reviewed issues are related: shared contracts, renderer behavior, and tests all depend on the same IPC surface. Fixing them together is the cleanest and lowest-total-risk path.

## Design

### IPC Contract Normalization

- `searchLocation` should always return the shape declared in `src/shared/ipc.ts`, with `lat` and `lon` fields regardless of upstream API payload shape.
- `getWeather` should expose a single safe contract. Either return `WeatherData | null` and treat failures as `null`, or change the shared type to an explicit result union. To minimize renderer churn, normalize handler failures to `null` and keep alerts as a separate call.
- `getInitialData`, `reloadData`, `changeDataFolder`, and `resetDataFolder` should have shared types aligned to what preload and main actually return.
- `updateLocation` validation should include `isDefault` so the runtime schema matches the TypeScript contract and storage operation.

### Save Group Failure Handling

- `SaveGroupModal` should only clear state and close after a confirmed successful save.
- The save callback should return a success signal instead of relying on logging side effects.
- Failed saves should show an inline error and preserve the typed name so users can retry.
- Rename flows should follow the same success-aware pattern.

### Permission and Webview Hardening

- Permission grants should be based on trusted requesting origin, not only the containing `webContents`.
- The main application shell should retain required privileges, but remote iframes inside the shell should not inherit them automatically.
- Runtime radar URL registration should be narrowed to supported trusted origins instead of accepting arbitrary HTTPS origins.
- Existing built-in allowlisted origins should keep working.

### Renderer Test Cleanup

- Replace the test setup `localStorage` probe with a safe descriptor-based or guarded access path that does not trigger Node warnings.
- Update async renderer tests to wait for effects, subscriptions, or state transitions they trigger, rather than asserting synchronously after render/click.
- Fix warning-producing tests rather than muting console output, so the suite remains a useful detector of regressions.

## Error Handling

- Renderer-visible failures should surface as user-facing inline errors or safe no-op fallback states, not console-only logs.
- IPC handler failures should return shapes that match the declared contract exactly.
- Security policy rejections should continue logging blocked origin attempts for auditability.

## Verification

- Run focused tests for weather handlers, shared validation, save-group UI, window controls, settings modal, add-server modal, and location context.
- Run full `npm test` after all changes.
- Confirm the previous `act()` and `--localstorage-file` warnings are gone from the renderer suite.

## Notes

- I am not creating a git commit for this design doc because the current session instructions require commits only when explicitly requested.
