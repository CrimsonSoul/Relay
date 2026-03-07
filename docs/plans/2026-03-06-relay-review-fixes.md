# Relay Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the reviewed Relay correctness, security, contract, and renderer test-warning issues in one verified pass.

**Architecture:** Normalize the main/preload/shared IPC boundary first so the renderer consumes trustworthy contracts. Then make the save-group flows success-aware, tighten permission and webview trust checks in the main process, and clean up renderer test setup/tests so the suite stays green without warning noise.

**Tech Stack:** TypeScript, Electron, React, Vitest, Testing Library, Zod

---

### Task 1: Normalize weather IPC contracts

**Files:**

- Modify: `src/main/handlers/weatherHandlers.ts`
- Modify: `src/shared/ipc.ts`
- Test: `src/main/handlers/weatherHandlers.test.ts`
- Test: `src/renderer/src/hooks/__tests__/useWeatherLocation.test.ts`

**Step 1: Write the failing tests**

- Add/adjust a main-process test proving `searchLocation` returns `lat` and `lon` keys for general search results.
- Add/adjust a main-process test proving `getWeather` returns the agreed fallback shape on API errors.
- Add/adjust a renderer test proving manual location search can build a label and coordinates from the normalized result.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/handlers/weatherHandlers.test.ts src/renderer/src/hooks/__tests__/useWeatherLocation.test.ts -c vitest.renderer.config.ts`

Expected: at least one failure caused by current result-shape mismatch or error-shape mismatch.

**Step 3: Write minimal implementation**

- Map Open-Meteo `latitude`/`longitude` to shared `lat`/`lon` before returning from `SEARCH_LOCATION`.
- Decide and implement a single `getWeather` contract; recommended: return `WeatherData | null` on failure.
- Update `src/shared/ipc.ts` only where needed to reflect the actual stable contract.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/handlers/weatherHandlers.test.ts`

Run: `npx vitest run -c vitest.renderer.config.ts src/renderer/src/hooks/__tests__/useWeatherLocation.test.ts`

Expected: PASS with no new warnings.

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 2: Align remaining bridge types and location update validation

**Files:**

- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipcValidation.ts`
- Modify: `src/preload/index.ts`
- Test: `src/shared/ipcValidation.test.ts`
- Test: `src/main/handlers/featureHandlers.test.ts`
- Test: `src/main/handlers/dataHandlers.test.ts`
- Test: `src/main/handlers/configHandlers.test.ts`

**Step 1: Write the failing tests**

- Add a test proving `UPDATE_LOCATION` accepts `isDefault` and persists it.
- Add or update tests for `reloadData`, `changeDataFolder`, and `resetDataFolder` so their return types match the shared declarations.
- Add a test covering `getInitialData` nullability if that remains part of the real contract.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/handlers/featureHandlers.test.ts src/main/handlers/dataHandlers.test.ts src/main/handlers/configHandlers.test.ts src/shared/ipcValidation.test.ts`

Expected: failures or missing assertions demonstrating contract drift.

**Step 3: Write minimal implementation**

- Add `isDefault` to `LocationUpdateSchema`.
- Make `BridgeAPI` method signatures match actual preload/main behavior, or normalize preload/main to the preferred shapes.
- Keep all changes DRY and limited to the reviewed mismatches.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/handlers/featureHandlers.test.ts src/main/handlers/dataHandlers.test.ts src/main/handlers/configHandlers.test.ts src/shared/ipcValidation.test.ts`

Expected: PASS.

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 3: Make save-group and rename flows success-aware

**Files:**

- Modify: `src/renderer/src/tabs/assembler/SaveGroupModal.tsx`
- Modify: `src/renderer/src/tabs/assembler/AssemblerSidebar.tsx`
- Test: `src/renderer/src/tabs/assembler/__tests__/SaveGroupModal.test.tsx`
- Test: `src/renderer/src/tabs/assembler/__tests__/AssemblerSidebar.test.tsx`

**Step 1: Write the failing tests**

- Add a test proving failed save keeps the modal open and preserves the typed name.
- Add a test proving the modal shows an inline error on save failure.
- Add a test proving successful save still clears and closes.
- Add a test proving rename follows the same success-aware behavior if applicable.

**Step 2: Run test to verify it fails**

Run: `npx vitest run -c vitest.renderer.config.ts src/renderer/src/tabs/assembler/__tests__/SaveGroupModal.test.tsx src/renderer/src/tabs/assembler/__tests__/AssemblerSidebar.test.tsx`

Expected: failures because the modal currently closes unconditionally.

**Step 3: Write minimal implementation**

- Change the callback contract to return a boolean or structured result.
- Close and clear only on success.
- Preserve current user input and set inline error text on failure.

**Step 4: Run test to verify it passes**

Run: `npx vitest run -c vitest.renderer.config.ts src/renderer/src/tabs/assembler/__tests__/SaveGroupModal.test.tsx src/renderer/src/tabs/assembler/__tests__/AssemblerSidebar.test.tsx`

Expected: PASS with no `act()` warnings from these tests.

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 4: Tighten permission handling for remote origins

**Files:**

- Modify: `src/main/app/appState.ts`
- Modify: `src/main/index.ts`
- Test: `src/main/app/appState.test.ts`

**Step 1: Write the failing tests**

- Add tests proving `geolocation` and `media` are allowed for the trusted app shell.
- Add tests proving remote iframe origins inside the main window do not inherit those permissions automatically.
- Add tests proving explicitly trusted origins still behave as intended.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/app/appState.test.ts`

Expected: failures exposing current broad permission behavior.

**Step 3: Write minimal implementation**

- Base permission decisions on requesting origin and trusted-origin rules, not only `webContents` identity.
- Preserve only the minimum app-shell allowances needed by current features.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/app/appState.test.ts`

Expected: PASS.

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 5: Restrict runtime webview trust registration

**Files:**

- Modify: `src/main/handlers/configHandlers.ts`
- Modify: `src/main/securityPolicy.ts`
- Modify: `src/shared/ipc.ts`
- Test: `src/main/securityPolicy.test.ts`
- Test: `src/main/handlers/configHandlers.test.ts`

**Step 1: Write the failing tests**

- Add a test proving unsupported HTTPS origins cannot be registered as trusted radar/webview origins.
- Add a test proving supported radar origins still register correctly.
- Add a test proving `isTrustedWebviewUrl()` only accepts built-in or explicitly supported runtime origins.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/securityPolicy.test.ts src/main/handlers/configHandlers.test.ts`

Expected: failures because arbitrary HTTPS origins are currently accepted.

**Step 3: Write minimal implementation**

- Replace arbitrary-HTTPS acceptance with a narrow supported-origin policy.
- Keep the registration API behavior explicit and testable.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/securityPolicy.test.ts src/main/handlers/configHandlers.test.ts`

Expected: PASS.

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 6: Remove renderer localStorage setup warnings

**Files:**

- Modify: `src/renderer/test/setup.ts`
- Test: `src/renderer/test/setup.ts`

**Step 1: Write the failing test**

- Add a small renderer-side verification or targeted regression check if practical; otherwise document the warning reproduction command and use command output as the failing signal.

**Step 2: Run test to verify it fails**

Run: `npx vitest run -c vitest.renderer.config.ts src/renderer/src/components/__tests__/WindowControls.test.tsx`

Expected: current run may emit `--localstorage-file was provided without a valid path` warnings before the fix.

**Step 3: Write minimal implementation**

- Replace direct `globalThis.localStorage` access with a guarded descriptor/try-catch path that does not invoke the problematic getter unless necessary.
- Only install the fallback storage when the environment truly lacks a usable storage object.

**Step 4: Run test to verify it passes**

Run: `npx vitest run -c vitest.renderer.config.ts src/renderer/src/components/__tests__/WindowControls.test.tsx`

Expected: PASS without the localStorage warning.

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 7: Remove renderer `act()` warnings from affected tests

**Files:**

- Modify: `src/renderer/src/components/__tests__/WindowControls.test.tsx`
- Modify: `src/renderer/src/components/__tests__/SettingsModal.test.tsx`
- Modify: `src/renderer/src/components/__tests__/AddServerModal.test.tsx`
- Modify: `src/renderer/src/tabs/assembler/__tests__/SaveGroupModal.test.tsx`
- Modify: `src/renderer/src/tabs/assembler/__tests__/AssemblerSidebar.test.tsx`
- Modify: `src/renderer/src/contexts/__tests__/LocationContext.test.tsx`

**Step 1: Write the failing test expectations**

- Convert synchronous assertions to awaited assertions using Testing Library async helpers.
- Where needed, explicitly await async user interactions or initial effect completion.

**Step 2: Run test to verify it fails or warns**

Run: `npx vitest run -c vitest.renderer.config.ts src/renderer/src/components/__tests__/WindowControls.test.tsx src/renderer/src/components/__tests__/SettingsModal.test.tsx src/renderer/src/components/__tests__/AddServerModal.test.tsx src/renderer/src/tabs/assembler/__tests__/SaveGroupModal.test.tsx src/renderer/src/tabs/assembler/__tests__/AssemblerSidebar.test.tsx src/renderer/src/contexts/__tests__/LocationContext.test.tsx`

Expected: current run passes but emits `act()` warnings.

**Step 3: Write minimal implementation**

- Update tests to wait for the state changes produced by effects and async callbacks.
- Avoid suppressing console output globally.

**Step 4: Run test to verify it passes**

Run: `npx vitest run -c vitest.renderer.config.ts src/renderer/src/components/__tests__/WindowControls.test.tsx src/renderer/src/components/__tests__/SettingsModal.test.tsx src/renderer/src/components/__tests__/AddServerModal.test.tsx src/renderer/src/tabs/assembler/__tests__/SaveGroupModal.test.tsx src/renderer/src/tabs/assembler/__tests__/AssemblerSidebar.test.tsx src/renderer/src/contexts/__tests__/LocationContext.test.tsx`

Expected: PASS without `act()` warnings.

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 8: Run full verification

**Files:**

- Verify only: `src/main/**`
- Verify only: `src/shared/**`
- Verify only: `src/preload/index.ts`
- Verify only: `src/renderer/**`

**Step 1: Run focused suites**

Run the focused commands from Tasks 1-7 and ensure they all pass.

**Step 2: Run full project tests**

Run: `npm test`

Expected: PASS for unit and renderer suites, with the previously observed warning noise removed.

**Step 3: Spot-check changed flows**

- Confirm weather search/manual search uses normalized coordinates.
- Confirm failed save-group attempts stay visible and retryable.
- Confirm unsupported radar origins are rejected by policy tests.

**Step 4: Commit**

Do not commit unless explicitly requested by the user.
