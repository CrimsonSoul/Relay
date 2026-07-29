# Radar Indicator and Original Page Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Radar sidebar status dot more visible and add a secure button
that opens the original CW Dispatcher Radar page in the user's browser.

**Architecture:** Move the canonical Radar URL into one shared module consumed
by the main-process session and renderer. Reuse Relay's existing `openExternal`
bridge for the header action, and enlarge only the existing sidebar status dot
while retaining the established tab geometry and responsive insets.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, Playwright
Electron, Relay's existing bridge API and TactileButton component.

## Global Constraints

- The Radar status dot is exactly 10px by 10px.
- The expanded Radar tab remains 120px by 56px with a 10px right dot inset.
- The collapsed Radar tab remains 56px by 48px with a 5px right dot inset.
- The dot remains vertically centered, contained, and clear of the collapsed
  icon.
- The button label is `OPEN ORIGINAL`.
- The button accessible label and title are
  `Open original Dispatcher Radar page`.
- The canonical URL is
  `https://cw-intra-web/CWDashboard/Home/Radar`.
- Electron opens the URL in the default browser; Relay Web opens a new browser
  tab through the existing `openExternal` bridge.
- Do not add IPC, a standalone Relay window, a polling timer, session sharing,
  dependencies, or changes to Radar parsing, snapshots, notifications, or
  refresh behavior.
- Constrained Radar headers may wrap their action row without clipping or
  overlapping controls.

---

## File Structure

- Create `src/shared/radar.ts`: own the single canonical `RADAR_URL` constant.
- Modify `src/main/handlers/radar/radarSession.ts`: import the shared constant
  for Radar-origin validation.
- Modify `src/main/handlers/radar/fetchRadar.ts`: import the shared constant for
  polling.
- Modify `src/main/handlers/radar/radarSignInWindow.ts`: import the shared
  constant for sign-in navigation.
- Modify `src/renderer/src/tabs/RadarTab.tsx`: render the secondary
  **OPEN ORIGINAL** action and call the existing external-link bridge.
- Modify `src/renderer/src/tabs/radar.css`: allow the action row to wrap at
  constrained widths.
- Modify `src/renderer/src/tabs/__tests__/RadarTab.test.tsx`: verify accessible
  button presentation and the literal external URL.
- Modify `src/renderer/src/components/sidebar/sidebar.css`: enlarge the status
  dot without changing its positioning.
- Modify
  `src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx`: assert
  the new dimensions.
- Modify `tests/e2e/css-visual-contracts.spec.ts`: verify real expanded and
  collapsed geometry, containment, and icon clearance.

### Task 1: Share the Canonical URL and Open the Original Page

**Files:**

- Create: `src/shared/radar.ts`
- Modify: `src/main/handlers/radar/radarSession.ts`
- Modify: `src/main/handlers/radar/fetchRadar.ts`
- Modify: `src/main/handlers/radar/radarSignInWindow.ts`
- Modify: `src/renderer/src/tabs/RadarTab.tsx`
- Modify: `src/renderer/src/tabs/radar.css`
- Test: `src/renderer/src/tabs/__tests__/RadarTab.test.tsx`

**Interfaces:**

- Produces: `RADAR_URL: string` from `@shared/radar`.
- Consumes: `globalThis.api.openExternal(url: string): Promise<boolean>`.
- Leaves `useRadarSnapshot()` and all main-process polling interfaces
  unchanged.

- [ ] **Step 1: Add the failing original-page action test**

  Add a bridge spy beside the existing Radar test spies:

  ```tsx
  const openExternal = vi.fn(async () => true);
  ```

  Clear it in `beforeEach` and include it in the complete `globalThis.api`
  fixture. Then add:

  ```tsx
  it('opens the canonical original Radar page through the secure external action', async () => {
    render(<RadarTab />);

    const button = await screen.findByRole('button', {
      name: 'Open original Dispatcher Radar page',
    });
    expect(button).toHaveTextContent('OPEN ORIGINAL');
    expect(button).toHaveAttribute('title', 'Open original Dispatcher Radar page');
    expect(button).toHaveClass('tactile-button--secondary');

    fireEvent.click(button);

    expect(openExternal).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith(
      'https://cw-intra-web/CWDashboard/Home/Radar',
    );
  });
  ```

- [ ] **Step 2: Run the focused test and verify the RED state**

  Run:

  ```bash
  npx vitest run --config vitest.renderer.config.ts \
    src/renderer/src/tabs/__tests__/RadarTab.test.tsx
  ```

  Expected: the new test fails because no button with the required accessible
  name exists.

- [ ] **Step 3: Create the shared constant and update main-process imports**

  Create `src/shared/radar.ts`:

  ```ts
  /** Canonical first-party CW Dispatcher Radar page used by polling and navigation. */
  export const RADAR_URL = 'https://cw-intra-web/CWDashboard/Home/Radar';
  ```

  In `radarSession.ts`, remove the local `RADAR_URL` declaration and add:

  ```ts
  import { RADAR_URL } from '@shared/radar';
  ```

  In `fetchRadar.ts`, replace the import of `RADAR_URL` from
  `./radarSession` with:

  ```ts
  import { RADAR_URL } from '@shared/radar';
  import { getRadarSession } from './radarSession';
  ```

  In `radarSignInWindow.ts`, import `RADAR_URL` from `@shared/radar` and retain
  `isAllowedRadarUrl` and `RADAR_SESSION_PARTITION` from `./radarSession`.

- [ ] **Step 4: Add the secondary header action and responsive wrapping**

  In `RadarTab.tsx`, import `RADAR_URL` and insert this button before
  **REFRESH**:

  ```tsx
  <TactileButton
    variant="secondary"
    onClick={() => void globalThis.api?.openExternal(RADAR_URL)}
    title="Open original Dispatcher Radar page"
    aria-label="Open original Dispatcher Radar page"
  >
    OPEN ORIGINAL
  </TactileButton>
  ```

  Add wrapping to the existing action-row rule in `radar.css`:

  ```css
  .radar-tab-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  ```

- [ ] **Step 5: Run focused and adjacent tests and verify the GREEN state**

  Run:

  ```bash
  npx vitest run --config vitest.renderer.config.ts \
    src/renderer/src/tabs/__tests__/RadarTab.test.tsx \
    src/renderer/src/runtime/browserActions.test.ts
  npx vitest run src/main/handlers/radar/fetchRadar.test.ts
  ```

  Expected: all three existing test files plus the new button test pass.

- [ ] **Step 6: Commit the original-page action**

  ```bash
  git status --short --branch
  git add \
    src/shared/radar.ts \
    src/main/handlers/radar/radarSession.ts \
    src/main/handlers/radar/fetchRadar.ts \
    src/main/handlers/radar/radarSignInWindow.ts \
    src/renderer/src/tabs/RadarTab.tsx \
    src/renderer/src/tabs/radar.css \
    src/renderer/src/tabs/__tests__/RadarTab.test.tsx
  git diff --cached --check
  git commit -m "feat: open the original Radar page"
  ```

### Task 2: Enlarge the Sidebar Indicator Safely

**Files:**

- Modify: `src/renderer/src/components/sidebar/sidebar.css`
- Test:
  `src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx`
- Test: `tests/e2e/css-visual-contracts.spec.ts`

**Interfaces:**

- Consumes: the existing `.sidebar-button-status-dot` element and compact
  `.sidebar-button-status-dot { right: 5px; }` responsive override.
- Produces: a 10px semantic status dot with unchanged positioning and navigation
  button dimensions.

- [ ] **Step 1: Change component and rendered geometry expectations first**

  In `SidebarButton.test.tsx`, update the dimension assertions:

  ```tsx
  expect(dotStyles).toContain('width: 10px');
  expect(dotStyles).toContain('height: 10px');
  ```

  In the Electron `expectMatchingButtons` helper, add:

  ```tsx
  expect(pipBox && { width: pipBox.width, height: pipBox.height }).toEqual({
    width: 10,
    height: 10,
  });
  ```

  After obtaining the compact Radar icon and pip boxes, assert their horizontal
  separation:

  ```tsx
  const compactIconBox = await radarIcon.boundingBox();
  const compactPipBox = await pip.boundingBox();
  expect((compactPipBox?.x ?? 0) - ((compactIconBox?.x ?? 0) + (compactIconBox?.width ?? 0)))
    .toBeGreaterThanOrEqual(1);
  ```

- [ ] **Step 2: Run both focused tests and verify the RED state**

  Run:

  ```bash
  npx vitest run --config vitest.renderer.config.ts \
    src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx
  npm run test:electron -- --grep "Radar status keeps"
  ```

  Expected: the component and Electron geometry assertions report the current
  6px dot instead of 10px.

- [ ] **Step 3: Enlarge only the dot**

  In `sidebar.css`, change:

  ```css
  .sidebar-button-status-dot {
    width: 10px;
    height: 10px;
  }
  ```

  Keep `top: 50%`, `right: 10px`, and `transform: translateY(-50%)`; set the
  compact override to `right: 5px` so the 10px dot clears the icon after the
  active border shifts the collapsed content center.

- [ ] **Step 4: Run both focused tests and verify the GREEN state**

  Run:

  ```bash
  npx vitest run --config vitest.renderer.config.ts \
    src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx
  npm run test:electron -- --grep "Radar status keeps"
  ```

  Expected: the component test passes and the real Electron layout proves the
  10px dot is contained, centered, and at least 1px clear of the collapsed
  icon. Confirm the Electron runner restores `better-sqlite3` for Node.

- [ ] **Step 5: Commit the indicator change**

  ```bash
  git status --short --branch
  git add \
    src/renderer/src/components/sidebar/sidebar.css \
    src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx \
    tests/e2e/css-visual-contracts.spec.ts
  git diff --cached --check
  git commit -m "refine: enlarge the Radar sidebar indicator"
  ```

### Task 3: Complete Relay Verification

**Files:**

- Verify only; no planned source changes.

**Interfaces:**

- Consumes: the committed Task 1 and Task 2 branch tip.
- Produces: evidence that the full renderer, main process, external-link
  handling, build, and desktop package remain compatible.

- [ ] **Step 1: Run all required source gates**

  ```bash
  npm run typecheck
  npm run lint
  npm run format:check
  npm test
  npm run build
  git diff --check
  npm audit --audit-level=high --omit=dev
  ```

  Expected: every command exits zero and the audit reports zero high-or-higher
  production vulnerabilities.

- [ ] **Step 2: Run the complete Electron suite**

  ```bash
  npm run test:electron
  ```

  Expected: every Electron test passes and the runner restores
  `better-sqlite3` for the current Node ABI.

- [ ] **Step 3: Run the Impeccable detector exactly once**

  Run:

  ```bash
  node /Users/ryan/.agents/skills/impeccable/scripts/detect.mjs --json \
    src/renderer/src/components/sidebar/sidebar.css \
    src/renderer/src/tabs/radar.css \
    src/renderer/src/tabs/RadarTab.tsx
  ```

  Review any finding against the approved design and Relay's existing
  conventions. Do not rerun the detector in this implementation cycle.

- [ ] **Step 4: Audit final branch scope**

  ```bash
  git status --short --branch
  git log --oneline --decorate origin/test..HEAD
  git diff --stat origin/test...HEAD
  git rev-list --left-right --count origin/test...HEAD
  ```

  Expected: the worktree is clean, `origin/test` has no commits absent from
  local `test`, and the branch contains only this approved design, plan,
  original-page action, and indicator refinement.
