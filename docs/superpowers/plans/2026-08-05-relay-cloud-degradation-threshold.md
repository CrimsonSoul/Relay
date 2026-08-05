# Relay Cloud Degradation Threshold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep real cloud degradations visible while requiring three monotonic server observations spanning at least two minutes before Relay emits one warning notification.

**Architecture:** `useAppCloudStatus` remains the sole renderer qualification owner. It adds a first-observation map beside the existing count and last-observation maps, uses exported policy constants for count and duration, and qualifies only monotonic server timestamps. Existing provider presentation, outage delivery, Dynatrace priority, startup baseline, cache, and server polling stay unchanged.

**Tech Stack:** React hooks, TypeScript, Vitest fake timers, PocketBase realtime snapshots, Relay Toast delivery metadata.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-05-relay-tab-operator-workflows-design.md`.
- A degradation requires three distinct observations and at least `120_000` milliseconds between the first and qualifying observation.
- Use server-owned legacy/Mist snapshot timestamps; renderer arrival time and `Date.now()` cannot qualify a candidate.
- Duplicate, equal, or older observation timestamps do not advance a candidate.
- Split collection events from one server poll count once.
- Feed error, recovery, warning disappearance, and outage escalation clear a pending candidate.
- Existing degradation at startup remains a silent baseline; an active confirmed degradation notifies once until recovery.
- Outage notifications remain immediate and keep `delivery: 'cloud-outage'`; degradation keeps `delivery: 'cloud-degradation'`.
- Planned or scheduled maintenance stays excluded; emergency maintenance stays actionable.
- Do not change provider adapters, snapshot schemas, cache formats, server polling, or Cloud Status visibility.

---

### Task 1: Red tests for three observations and two-minute duration

**Files:**
- Modify: `src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts`

**Interfaces:**
- Consumes: current `useAppCloudStatus(showToast, onOpenProvider?)` API and existing legacy/Mist collection harness.
- Produces: executable policy examples for count, duration, duplicate timestamps, and out-of-order reconnect data.

- [ ] **Step 1: Replace the two-snapshot test with a three-observation duration test**

```ts
async function publishStatus(
  rerender: () => void,
  data: CloudStatusData,
): Promise<void> {
  collectionState.data = [snapshot(data)];
  rerender();
  await act(async () => Promise.resolve());
}

it('requires three distinct observations spanning two minutes before notifying for degradation', async () => {
  collectionState.data = [snapshot({ ...status(), lastUpdated: 1_000 })];
  const { rerender } = renderHook(() => useAppCloudStatus(showToast));
  await act(async () => Promise.resolve());
  const warning = item({
    id: 'degraded-1',
    severity: 'warning',
    title: 'Elevated API latency',
  });

  await publishStatus(rerender, { ...status([warning]), lastUpdated: 60_000 });
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 120_000 });
  expect(showToast).not.toHaveBeenCalled();

  await publishStatus(rerender, { ...status([warning]), lastUpdated: 179_999 });
  expect(showToast).not.toHaveBeenCalled();

  await publishStatus(rerender, { ...status([warning]), lastUpdated: 180_000 });
  expect(showToast).toHaveBeenCalledWith(
    expect.stringContaining('Degraded:'),
    'warning',
    expect.objectContaining({ delivery: 'cloud-degradation' }),
  );
});
```

Use the test file's existing snapshot builders and collection emitters rather than adding a second harness.

- [ ] **Step 2: Add a failing exact-three-observation test when duration is already satisfied**

```ts
it('qualifies on the third observation when the first-to-third span is at least two minutes', async () => {
  collectionState.data = [snapshot({ ...status(), lastUpdated: 1_000 })];
  const { rerender } = renderHook(() => useAppCloudStatus(showToast));
  await act(async () => Promise.resolve());
  const warning = item({ severity: 'warning', title: 'Elevated API latency' });
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 10_000 });
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 70_000 });
  expect(showToast).not.toHaveBeenCalled();
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 130_000 });
  expect(showToast).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Add failing tests for duplicate and older timestamps**

```ts
it('does not let duplicate or older reconnect snapshots advance degradation', async () => {
  collectionState.data = [snapshot({ ...status(), lastUpdated: 1_000 })];
  const { rerender } = renderHook(() => useAppCloudStatus(showToast));
  await act(async () => Promise.resolve());
  const warning = item({ severity: 'warning', title: 'Elevated API latency' });
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 10_000 });
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 10_000 });
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 9_000 });
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 130_000 });
  expect(showToast).not.toHaveBeenCalled();
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 131_000 });
  expect(showToast).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 4: Run the degradation subset to verify it fails for the old threshold**

Run: `npm run test:renderer -- src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts -t "degradation|scheduled maintenance|emergency maintenance"`

Expected: FAIL because the hook currently qualifies on two observations and has no minimum duration.

- [ ] **Step 5: Commit the red policy tests**

```bash
git add src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts
git commit -m "test: define high cloud degradation threshold"
```

### Task 2: Candidate count and first-observation state

**Files:**
- Modify: `src/renderer/src/hooks/useAppCloudStatus.ts`
- Modify: `src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts`

**Interfaces:**
- Consumes: `CurrentStatusState`, server observation timestamps, active provider set, and existing candidate maps.
- Produces: `DEGRADATION_REQUIRED_OBSERVATIONS`, `DEGRADATION_MIN_DURATION_MS`, and first-observation state used by `advanceProviderDegradation`.

- [ ] **Step 1: Add named qualification constants and first-observation map**

```ts
export const DEGRADATION_REQUIRED_OBSERVATIONS = 3;
export const DEGRADATION_MIN_DURATION_MS = 120_000;

const degradationCandidateFirstObservationsRef = useRef(
  new Map<CloudStatusProvider, number>(),
);
```

- [ ] **Step 2: Extend candidate cleanup to all three maps**

Create one local helper to prevent reset paths from drifting:

```ts
function clearDegradationCandidate(
  provider: CloudStatusProvider,
  candidateCounts: Map<CloudStatusProvider, number>,
  candidateObservations: Map<CloudStatusProvider, number>,
  candidateFirstObservations: Map<CloudStatusProvider, number>,
): void {
  candidateCounts.delete(provider);
  candidateObservations.delete(provider);
  candidateFirstObservations.delete(provider);
}
```

Call it for feed errors, recovery/no issue, outage, non-actionable warning, and successful qualification. Keep `activeProblemProviders` through feed errors so a previously notified degradation cannot replay when its feed returns.

- [ ] **Step 3: Require monotonic timestamps, count, and duration**

```ts
const previousObservation = candidateObservations.get(provider);
if (previousObservation !== undefined && observationTimestamp <= previousObservation) return null;

candidateObservations.set(provider, observationTimestamp);
if (!candidateFirstObservations.has(provider)) {
  candidateFirstObservations.set(provider, observationTimestamp);
}

const count = (candidateCounts.get(provider) ?? 0) + 1;
candidateCounts.set(provider, count);
const firstObservation = candidateFirstObservations.get(provider) ?? observationTimestamp;

if (
  count < DEGRADATION_REQUIRED_OBSERVATIONS ||
  observationTimestamp - firstObservation < DEGRADATION_MIN_DURATION_MS
) {
  return null;
}
```

Pass the new map through `collectNewDegradations` and its call in `processNewEvents`.

- [ ] **Step 4: Run the focused degradation tests to verify green**

Run: `npm run test:renderer -- src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts -t "degradation|scheduled maintenance|emergency maintenance"`

Expected: PASS.

- [ ] **Step 5: Commit the high-threshold implementation**

```bash
git add src/renderer/src/hooks/useAppCloudStatus.ts src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts
git commit -m "feat: raise cloud degradation notification threshold"
```

### Task 3: Reset, batching, startup, and outage regression matrix

**Files:**
- Modify: `src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts`

**Interfaces:**
- Consumes: the Task 2 policy implementation.
- Produces: regression coverage that proves the new first-observation state cannot leak across episodes or interfere with outages.

- [ ] **Step 1: Extend recovery and feed-error tests with fresh timing windows**

```ts
it('restarts count and duration after a pending degradation recovers', async () => {
  collectionState.data = [snapshot({ ...status(), lastUpdated: 1_000 })];
  const { rerender } = renderHook(() => useAppCloudStatus(showToast));
  await act(async () => Promise.resolve());
  const warning = item({ severity: 'warning', title: 'Elevated API latency' });
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 10_000 });
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 70_000 });
  await publishStatus(rerender, { ...status(), lastUpdated: 80_000 });

  await publishStatus(rerender, { ...status([warning]), lastUpdated: 130_000 });
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 190_000 });
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 249_999 });
  expect(showToast).not.toHaveBeenCalled();
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 250_000 });
  expect(showToast).toHaveBeenCalledTimes(1);
});
```

Add the same fresh-window assertion after a feed error and after warning disappearance.

- [ ] **Step 2: Prove outage escalation stays immediate and clears pending degradation state**

```ts
it('notifies an outage immediately and requires a fresh degradation episode after recovery', async () => {
  collectionState.data = [snapshot({ ...status(), lastUpdated: 1_000 })];
  const { rerender } = renderHook(() => useAppCloudStatus(showToast));
  await act(async () => Promise.resolve());
  const warning = item({ severity: 'warning', title: 'Elevated API latency' });
  const outage = item({ severity: 'error', title: 'API unavailable' });
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 10_000 });
  await publishStatus(rerender, { ...status([outage]), lastUpdated: 20_000 });
  expect(showToast).toHaveBeenCalledWith(
    expect.stringContaining('Outage:'),
    'error',
    expect.objectContaining({ delivery: 'cloud-outage' }),
  );
  await publishStatus(rerender, { ...status(), lastUpdated: 30_000 });
  showToast.mockClear();
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 40_000 });
  await publishStatus(rerender, { ...status([warning]), lastUpdated: 100_000 });
  expect(showToast).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Keep split-event batching and simultaneous-provider ordering tests at the new threshold**

Update existing split legacy/Mist event cases to emit three complete server observation timestamps spanning two minutes. Assert one observation per provider per server poll and one batched toast in `CLOUD_STATUS_PROVIDER_ORDER`.

```ts
expect(showToast).toHaveBeenCalledTimes(1);
expect(showToast.mock.calls[0]?.[0]).toContain('(+1 more)');
```

- [ ] **Step 4: Run the full Cloud Status hook suite**

Run: `npm run test:renderer -- src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts`

Expected: PASS with the existing cache, manual refresh, baseline, outage, maintenance, and no-renderer-polling tests unchanged.

- [ ] **Step 5: Commit the episode-regression coverage**

```bash
git add src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts
git commit -m "test: cover cloud degradation episode resets"
```

### Task 4: Preserve Cloud Status hierarchy and notification priority

**Files:**
- Modify: `src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx` only if an approved hierarchy assertion is absent.
- Modify: `src/renderer/src/tabs/__tests__/CloudStatusStyles.test.ts` only if the lower warning-emphasis assertion is absent.

**Interfaces:**
- Consumes: existing `CloudStatusTab` provider posture ordering and warning CSS.
- Produces: explicit tests confirming outages, degradations, unknown feeds, and operational providers remain ordered and semantically distinct.

- [ ] **Step 1: Run the current Cloud Status presentation tests before editing**

Run: `npm run test:renderer -- src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx src/renderer/src/tabs/__tests__/CloudStatusStyles.test.ts`

Expected: PASS. Inspect whether the suite already asserts outage → degraded → unknown → clear ordering and warning semantic colors.

- [ ] **Step 2: Add only missing hierarchy assertions**

Build the test snapshot with an AWS outage, an Azure warning, a Microsoft 365 feed error, and all remaining providers operational; then assert the first four provider buttons:

```tsx
const overview = screen.getByRole('region', { name: 'Provider overview' });
expect(
  within(overview)
    .getAllByRole('button', { name: /View .* status details/ })
    .map((button) => button.getAttribute('aria-label'))
    .slice(0, 4),
).toEqual([
  'View AWS status details',
  'View Azure status details',
  'View Microsoft 365 status details',
  'View Jira status details',
]);
expect(screen.getByText('Degraded')).toHaveClass('cloud-status-provider__state--degraded');
expect(screen.getByText('Outage')).toHaveClass('cloud-status-provider__state--outage');
```

Add `within` to the existing `@testing-library/react` import in `CloudStatusTab.test.tsx`.

Do not change `CloudStatusTab.tsx` or `cloud-status.css` when existing implementation already satisfies the approved hierarchy.

- [ ] **Step 3: Run presentation tests after any assertion addition**

Run: `npm run test:renderer -- src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx src/renderer/src/tabs/__tests__/CloudStatusStyles.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit only if tests were added**

```bash
git add src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx src/renderer/src/tabs/__tests__/CloudStatusStyles.test.ts
git commit -m "test: preserve cloud status severity hierarchy"
```

If both files already cover the hierarchy, do not create an empty commit.

### Task 5: Update Relay Web notification policy documentation

**Files:**
- Modify: `docs/relay-web.md`

**Interfaces:**
- Consumes: the implemented renderer qualification policy.
- Produces: current Desktop/Web parity documentation with the exact threshold.

- [ ] **Step 1: Replace the stale two-observation sentence**

Use this exact policy text in the Notifications and service status section:

```md
Dynatrace Problems always take priority when a toast could show both a Problem and a provider event.
Provider status considers current errors and warnings from the last seven days. Relay notifies on
newly observed outages and on confirmed degradations after three distinct server observations
spanning at least two minutes; planned or scheduled maintenance is excluded.
```

- [ ] **Step 2: Check the edited canonical document**

Run: `npx prettier --check docs/relay-web.md && git diff --check`

Expected: both commands exit 0.

- [ ] **Step 3: Commit the notification-policy documentation**

```bash
git add docs/relay-web.md
git commit -m "docs: record cloud degradation threshold"
```

### Task 6: Cloud qualification readiness gate

**Files:**
- Modify only files required by failures attributable to Tasks 1-4.

**Interfaces:**
- Consumes: completed high-threshold qualification and hierarchy regression coverage.
- Produces: a verified Cloud Status slice ready to combine with the other Relay tab plans.

- [ ] **Step 1: Run all Cloud Status renderer tests**

Run: `npm run test:renderer -- src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx src/renderer/src/tabs/__tests__/CloudStatusStyles.test.ts`

Expected: PASS.

- [ ] **Step 2: Run Dynatrace/cloud delivery-manager regressions**

Run: `npm run test:renderer -- src/renderer/src/components/__tests__/DynatraceProblemNotificationManager.test.tsx src/renderer/src/components/__tests__/Toast.test.tsx`

Expected: PASS, proving Dynatrace priority and queued cloud delivery remain intact.

- [ ] **Step 3: Run static gates for the slice**

Run: `npm run typecheck && npm run lint && npm run format:check && git diff --check`

Expected: all commands exit 0.
