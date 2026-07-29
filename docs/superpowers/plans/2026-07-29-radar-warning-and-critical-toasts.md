# Radar Warning and Critical Toasts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify desktop Relay users when Prod01, Prod02, or Transactional
Emails Queue Depth escalates to yellow or red.

**Architecture:** Extend the existing `RadarQueueNotificationManager` transition
detector rather than adding another notification source. Keep one previous
explicit tone per target, select only green-to-yellow, green-to-red, and
yellow-to-red escalations, batch the selected transitions, and derive the
toast copy and severity from their destination tones.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Relay's existing
toast context and Radar snapshot hook.

## Global Constraints

- Only Prod01/Prod1, Prod02/Prod2, and Transactional Emails Queue Depth can
  generate these toasts.
- The first usable snapshot is a silent baseline, including an initial yellow
  or red state.
- Notify for green-to-yellow, green-to-red, and yellow-to-red only.
- Red-to-yellow, red-to-green, yellow-to-green, unchanged tones, missing
  targets, and unusable snapshots are silent.
- A snapshot with both yellow and red escalations creates one combined toast.
- Any batch containing red uses critical presentation; a yellow-only batch
  uses warning presentation.
- Keep `delivery: 'radar-critical'`, `durationMs: 8_000`, the **Open Radar**
  action, and no sound.
- Do not change Radar parsing, polling, sidebar state, toast priority, IPC,
  Relay Web, or dependencies.

---

## File Structure

- Modify
  `src/renderer/src/components/RadarQueueNotificationManager.tsx`: identify
  yellow/red severity increases, format one status-aware toast, and retain the
  existing snapshot-state rules.
- Modify
  `src/renderer/src/components/__tests__/RadarQueueNotificationManager.test.tsx`:
  prove the new yellow and escalation behavior while retaining existing red,
  lifecycle, alias, action, priority, and no-sound coverage.

### Task 1: Extend Radar Transition Detection and Toast Presentation

**Files:**

- Modify:
  `src/renderer/src/components/RadarQueueNotificationManager.tsx`
- Test:
  `src/renderer/src/components/__tests__/RadarQueueNotificationManager.test.tsx`

**Interfaces:**

- Consumes:
  `RadarSnapshot`, `RadarStatusColor`, `useRadarSnapshot()`, and
  `useToast().showToast`.
- Produces:
  existing `RadarQueueNotificationManager({ onOpenRadar })` behavior with
  yellow and red escalation notifications. No exported API changes are
  required.

- [ ] **Step 1: Add failing warning and escalation tests**

  Extend the initial-baseline test table to cover both initial `yellow` and
  initial `red`. Add a table-driven test proving green-to-yellow for each
  target:

  ```tsx
  it.each([
    ['Prod01', { prod01: 'yellow' as const }],
    ['Prod02', { prod02: 'yellow' as const }],
    ['Transactional Emails Queue Depth', { email: 'yellow' as const }],
  ])('notifies when %s transitions from green to yellow', (label, targetOverride) => {
    const view = render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    mocks.snapshot = snapshotWith({ ...targetOverride, lastUpdated: 2 });

    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

    expect(mocks.showToast).toHaveBeenCalledWith(
      `${label} is yellow on Dispatcher Radar.`,
      'warning',
      expect.objectContaining({
        title: 'Radar queue warning',
        durationMs: 8_000,
        delivery: 'radar-critical',
      }),
    );
  });
  ```

  Add a yellow-to-red escalation test that expects two calls:

  ```tsx
  it('notifies again when a yellow queue escalates to red', () => {
    const view = render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

    mocks.snapshot = snapshotWith({ prod01: 'yellow', lastUpdated: 2 });
    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    mocks.snapshot = snapshotWith({ prod01: 'red', lastUpdated: 3 });
    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

    expect(mocks.showToast).toHaveBeenCalledTimes(2);
    expect(mocks.showToast).toHaveBeenLastCalledWith(
      'Prod01 is red on Dispatcher Radar.',
      'error',
      expect.objectContaining({ title: 'Radar queue critical' }),
    );
  });
  ```

  Add recovery and mixed-batch coverage:

  ```tsx
  it('does not notify when a red queue recovers to yellow', () => {
    const view = render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    mocks.snapshot = snapshotWith({ prod01: 'red', lastUpdated: 2 });
    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    mocks.showToast.mockClear();

    mocks.snapshot = snapshotWith({ prod01: 'yellow', lastUpdated: 3 });
    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('batches simultaneous yellow and red escalations in one critical toast', () => {
    const view = render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    mocks.snapshot = snapshotWith({
      prod01: 'yellow',
      prod02: 'red',
      lastUpdated: 2,
    });

    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

    expect(mocks.showToast).toHaveBeenCalledOnce();
    expect(mocks.showToast).toHaveBeenCalledWith(
      'Prod01 is yellow and Prod02 is red on Dispatcher Radar.',
      'error',
      expect.objectContaining({
        title: 'Radar queues need attention',
        durationMs: 8_000,
        delivery: 'radar-critical',
      }),
    );
  });
  ```

- [ ] **Step 2: Run the focused test and verify the RED state**

  Run:

  ```bash
  npx vitest run --config vitest.renderer.config.ts \
    src/renderer/src/components/__tests__/RadarQueueNotificationManager.test.tsx
  ```

  Expected: the new green-to-yellow, yellow-to-red, and mixed-batch assertions
  fail because the manager still selects only `nextTone === 'red'`.

- [ ] **Step 3: Implement minimal status-aware escalation selection**

  In `RadarQueueNotificationManager.tsx`, define the actionable transition
  type and selector:

  ```tsx
  type RadarAlertTone = Extract<RadarStatusColor, 'yellow' | 'red'>;

  type RadarEscalation = {
    label: string;
    tone: RadarAlertTone;
  };

  function isRadarEscalation(
    previousTone: RadarStatusColor | undefined,
    nextTone: RadarStatusColor,
  ): nextTone is RadarAlertTone {
    if (previousTone === undefined) return false;
    if (nextTone === 'red') return previousTone === 'green' || previousTone === 'yellow';
    return nextTone === 'yellow' && previousTone === 'green';
  }
  ```

  Replace `newlyRed` with `escalations: RadarEscalation[]`, call
  `isRadarEscalation(previousTone, nextTone)`, and always update the stored
  explicit tone after selection.

  Group the selected labels by destination tone:

  ```tsx
  const yellowLabels = escalations
    .filter(({ tone }) => tone === 'yellow')
    .map(({ label }) => label);
  const redLabels = escalations
    .filter(({ tone }) => tone === 'red')
    .map(({ label }) => label);

  const describeGroup = (labels: string[], tone: RadarAlertTone) =>
    `${formatRadarTargetList(labels)} ${labels.length === 1 ? 'is' : 'are'} ${tone}`;
  const statusGroups = [
    ...(yellowLabels.length > 0 ? [describeGroup(yellowLabels, 'yellow')] : []),
    ...(redLabels.length > 0 ? [describeGroup(redLabels, 'red')] : []),
  ];
  const hasRed = redLabels.length > 0;
  const hasMixedTones = yellowLabels.length > 0 && hasRed;
  ```

  Emit one toast:

  ```tsx
  showToast(
    `${formatRadarTargetList(statusGroups)} on Dispatcher Radar.`,
    hasRed ? 'error' : 'warning',
    {
      title: hasMixedTones
        ? 'Radar queues need attention'
        : `${escalations.length === 1 ? 'Radar queue' : 'Radar queues'} ${
            hasRed ? 'critical' : 'warning'
          }`,
      durationMs: 8_000,
      delivery: 'radar-critical',
      action: {
        label: 'Open Radar',
        onClick: onOpenRadar,
      },
    },
  );
  ```

  Keep the existing usable-snapshot guard, silent baseline, missing-target
  behavior, target aliases, duration, delivery priority, action, and absence
  of sound calls unchanged.

- [ ] **Step 4: Run the focused test and verify the GREEN state**

  Run:

  ```bash
  npx vitest run --config vitest.renderer.config.ts \
    src/renderer/src/components/__tests__/RadarQueueNotificationManager.test.tsx
  ```

  Expected: every notification-manager test passes with no warnings.

- [ ] **Step 5: Run directly related toast and app regressions**

  Run:

  ```bash
  npx vitest run --config vitest.renderer.config.ts \
    src/renderer/src/components/__tests__/RadarQueueNotificationManager.test.tsx \
    src/renderer/src/components/__tests__/Toast.test.tsx \
    src/renderer/src/__tests__/App.test.tsx
  ```

  Expected: all three files pass, proving the existing priority queue and
  desktop-only mount remain intact.

- [ ] **Step 6: Commit the behavior change**

  ```bash
  git status --short --branch
  git add \
    src/renderer/src/components/RadarQueueNotificationManager.tsx \
    src/renderer/src/components/__tests__/RadarQueueNotificationManager.test.tsx
  git diff --cached --check
  git commit -m "feat: notify on Radar warnings"
  ```

### Task 2: Complete Relay Verification

**Files:**

- Verify only; no planned source changes.

**Interfaces:**

- Consumes: the committed Task 1 branch tip.
- Produces: evidence that the complete Relay renderer and desktop application
  remain compatible.

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

  Expected: all Electron tests pass and the runner restores
  `better-sqlite3` for the current Node ABI.

- [ ] **Step 3: Audit final branch scope**

  ```bash
  git status --short --branch
  git log --oneline --decorate origin/test..HEAD
  git diff --stat origin/test...HEAD
  git rev-list --left-right --count origin/test...HEAD
  ```

  Expected: the worktree is clean, `origin/test` has no commits absent from
  local `test`, and the branch contains only the approved Radar design, plan,
  notification, and sidebar work.
