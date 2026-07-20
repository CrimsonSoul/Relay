# Cloud Status Freshness and Provider Links Implementation Plan

> **For agentic workers:** The repository `AGENTS.md` overrides the generic Superpowers handoff: implement this plan directly with the primary agent in the current session. Do not invoke `superpowers:subagent-driven-development` or `superpowers:executing-plans` unless the user explicitly requests them. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop stale Cloud Status feed records from appearing or alerting as active outages, and restore each provider's configured Status, X, and Downdetector actions.

**Architecture:** Add one deterministic renderer utility that defines a current outage as an error item no more than seven rolling days old. Consume it in both `useAppCloudStatus` and `CloudStatusTab`, while leaving raw snapshots and main-process provider parsing unchanged. Provider posture derives from the filtered current-outage set, and both coverage layouts render independent external action buttons.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Electron renderer, existing Cloud Status IPC types and CSS tokens.

## Global Constraints

- The current-outage window is exactly seven rolling days and is inclusive at the boundary.
- Only `severity === 'error'` with a valid `pubDate` is eligible; future timestamps remain eligible.
- UI rows, provider posture, ordering, counts, cache baselining, and cloud-toast eligibility use the same predicate.
- Raw server snapshots, shared IPC types, main-process parsers, persistence, and Dynatrace/toast priority logic remain unchanged.
- Status, X, and Downdetector actions appear in active and all-clear provider coverage; X is omitted when no handle is configured.
- Existing missing-snapshot and unavailable-feed copy remains unchanged.
- Use red-green TDD for each behavior task and commit each independently testable slice.

---

## File Map

- Create `src/renderer/src/utils/cloudStatus.ts`: seven-day constant, current-outage predicate, and snapshot selector.
- Create `src/renderer/src/utils/__tests__/cloudStatus.test.ts`: deterministic boundary and severity tests.
- Modify `src/renderer/src/hooks/useAppCloudStatus.ts`: consume the shared selector.
- Modify `src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts`: fixed clock and stale cache/realtime coverage.
- Modify `src/renderer/src/tabs/CloudStatusTab.tsx`: current-outage presentation and restored provider actions.
- Modify `src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx`: stale filtering, posture, and external destinations.
- Modify `src/renderer/src/tabs/cloud-status.css`: independent provider action rows in both coverage layouts.

---

### Task 1: Shared Current-Outage Rule

**Files:**

- Create: `src/renderer/src/utils/cloudStatus.ts`
- Create: `src/renderer/src/utils/__tests__/cloudStatus.test.ts`

**Interfaces:**

- Produces `CURRENT_CLOUD_OUTAGE_WINDOW_MS: number`.
- Produces `isCurrentCloudOutage(item: CloudStatusItem, now?: number): boolean`.
- Produces `getCurrentCloudOutages(data: CloudStatusData, now?: number): CloudStatusItem[]`.

- [ ] **Step 1: Write the failing utility tests**

Create `src/renderer/src/utils/__tests__/cloudStatus.test.ts` with a fixed evaluation instant:

```ts
import { describe, expect, it } from 'vitest';
import type { CloudStatusData, CloudStatusItem, CloudStatusProvider } from '@shared/ipc';
import {
  CURRENT_CLOUD_OUTAGE_WINDOW_MS,
  getCurrentCloudOutages,
  isCurrentCloudOutage,
} from '../cloudStatus';

const NOW = Date.parse('2026-07-20T18:00:00.000Z');

function item(overrides: Partial<CloudStatusItem> = {}): CloudStatusItem {
  return {
    id: 'outage-1',
    provider: 'aws',
    title: 'Provider outage',
    description: '',
    pubDate: new Date(NOW).toISOString(),
    link: '',
    severity: 'error',
    ...overrides,
  };
}

function data(items: CloudStatusItem[]): CloudStatusData {
  const providers = Object.fromEntries(
    ['aws', 'azure', 'm365', 'jira', 'github', 'cloudflare', 'google', 'anthropic', 'openai', 'salesforce'].map(
      (provider) => [provider, []],
    ),
  ) as Record<CloudStatusProvider, CloudStatusItem[]>;
  for (const current of items) providers[current.provider].push(current);
  return { providers, errors: [], lastUpdated: NOW };
}

describe('current Cloud Status outages', () => {
  it('includes an error published exactly seven days ago', () => {
    expect(
      isCurrentCloudOutage(
        item({ pubDate: new Date(NOW - CURRENT_CLOUD_OUTAGE_WINDOW_MS).toISOString() }),
        NOW,
      ),
    ).toBe(true);
  });

  it('excludes stale, invalid, and non-error records', () => {
    expect(
      isCurrentCloudOutage(
        item({ pubDate: new Date(NOW - CURRENT_CLOUD_OUTAGE_WINDOW_MS - 1).toISOString() }),
        NOW,
      ),
    ).toBe(false);
    expect(isCurrentCloudOutage(item({ pubDate: 'not-a-date' }), NOW)).toBe(false);
    expect(isCurrentCloudOutage(item({ severity: 'warning' }), NOW)).toBe(false);
  });

  it('keeps future-dated errors and selects only current outages', () => {
    const future = item({ id: 'future', pubDate: new Date(NOW + 60_000).toISOString() });
    const stale = item({
      id: 'stale',
      pubDate: new Date(NOW - CURRENT_CLOUD_OUTAGE_WINDOW_MS - 1).toISOString(),
    });
    expect(
      getCurrentCloudOutages(data([future, stale, item({ id: 'warning', severity: 'warning' })]), NOW),
    ).toEqual([future]);
  });
});
```

- [ ] **Step 2: Run the utility test to verify RED**

```bash
node scripts/run-renderer-tests.mjs src/renderer/src/utils/__tests__/cloudStatus.test.ts
```

Expected: FAIL because `../cloudStatus` and its exports do not exist.

- [ ] **Step 3: Implement the minimal shared rule**

Create `src/renderer/src/utils/cloudStatus.ts`:

```ts
import type { CloudStatusData, CloudStatusItem } from '@shared/ipc';

export const CURRENT_CLOUD_OUTAGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function isCurrentCloudOutage(
  item: CloudStatusItem,
  now: number = Date.now(),
): boolean {
  if (item.severity !== 'error') return false;
  const publishedAt = new Date(item.pubDate).getTime();
  return Number.isFinite(publishedAt) && now - publishedAt <= CURRENT_CLOUD_OUTAGE_WINDOW_MS;
}

export function getCurrentCloudOutages(
  data: CloudStatusData,
  now: number = Date.now(),
): CloudStatusItem[] {
  return Object.values(data.providers)
    .flat()
    .filter((item) => isCurrentCloudOutage(item, now));
}
```

- [ ] **Step 4: Run the utility test to verify GREEN**

Run the same command. Expected: one file PASS with three tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/cloudStatus.ts src/renderer/src/utils/__tests__/cloudStatus.test.ts
git commit -m "feat(status): define current outage window"
```

---

### Task 2: Suppress Stale Cloud Toasts

**Files:**

- Modify: `src/renderer/src/hooks/useAppCloudStatus.ts`
- Modify: `src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts`

**Interfaces:**

- Consumes `getCurrentCloudOutages(data: CloudStatusData, now?: number)` from Task 1.
- Preserves the `useAppCloudStatus(showToast: ShowToast)` return shape and cloud toast metadata.

- [ ] **Step 1: Fix the hook test clock and make default fixtures current**

In `beforeEach`, add:

```ts
vi.setSystemTime('2026-07-20T18:00:00.000Z');
```

Change the default item date to:

```ts
pubDate: '2026-07-20T17:00:00.000Z',
```

- [ ] **Step 2: Write failing stale cache and arrival tests**

```ts
it('does not restore stale outage ids from cache', async () => {
  const stale = item({ id: 'incident-1', pubDate: '2026-07-10T17:00:00.000Z' });
  secureStorageMock.setItemSync('cached_cloud_status', {
    fetchedAt: Date.now(),
    data: status([stale]),
  });
  collectionState.data = [snapshot(status([item({ id: 'incident-1' })]))];
  const { rerender } = renderHook(() => useAppCloudStatus(showToast));
  await act(async () => Promise.resolve());

  rerender();

  await waitFor(() => expect(showToast).toHaveBeenCalledOnce());
});

it('does not toast when a stale error arrives after the baseline', async () => {
  collectionState.data = [snapshot(status())];
  const { rerender } = renderHook(() => useAppCloudStatus(showToast));
  await act(async () => Promise.resolve());

  collectionState.data = [
    snapshot(status([item({ pubDate: '2026-07-10T17:00:00.000Z' })])),
  ];
  rerender();

  await act(async () => Promise.resolve());
  expect(showToast).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run the hook test to verify RED**

```bash
node scripts/run-renderer-tests.mjs src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts
```

Expected: the stale-arrival test FAILS because every error is currently selected.

- [ ] **Step 4: Replace the local severity-only selector**

Import `getCurrentCloudOutages`, remove the local `getAllItems` and `getOutages` helpers, and replace their call sites:

```ts
const outages = getCurrentCloudOutages(data);
```

```ts
activeOutageIdsRef.current = new Set(
  getCurrentCloudOutages(cached.data).map((item) => item.id),
);
```

- [ ] **Step 5: Run the hook test to verify GREEN**

Run the hook test command. Expected: all hook tests PASS without warnings.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/hooks/useAppCloudStatus.ts src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts
git commit -m "fix(toasts): ignore stale cloud outages"
```

---

### Task 3: Hide Stale Outages Throughout the Status Workspace

**Files:**

- Modify: `src/renderer/src/tabs/CloudStatusTab.tsx`
- Modify: `src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx`

**Interfaces:**

- Consumes `getCurrentCloudOutages(data: CloudStatusData, now?: number)` from Task 1.
- Produces no new public component API.

- [ ] **Step 1: Fix the Status test clock and add a stale regression**

Import `afterEach`. In `beforeEach`, use fake timers and set `2026-07-20T18:00:00.000Z`; restore real timers in `afterEach`.

```ts
it('does not display or count stale error records as active outages', () => {
  const data = makeStatusData({
    providers: {
      ...emptyProviders,
      aws: [makeItem({ id: 'stale', title: 'Old AWS outage', pubDate: '2026-04-30T07:25:54.000Z' })],
      github: [makeItem({ id: 'current', provider: 'github', title: 'Current GitHub outage' })],
    },
  });
  const { container } = render(
    <CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />,
  );

  expect(screen.queryByText('Old AWS outage')).not.toBeInTheDocument();
  expect(screen.getByText('Current GitHub outage')).toBeInTheDocument();
  expect(screen.getByText('1 active outage')).toBeInTheDocument();
  expect(
    Array.from(container.querySelectorAll('.cloud-status-provider__name'))
      .slice(0, 2)
      .map((node) => node.textContent),
  ).toEqual(['GitHub', 'AWS']);
});
```

- [ ] **Step 2: Run the Status test to verify RED**

```bash
node scripts/run-renderer-tests.mjs src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx
```

Expected: FAIL because the old AWS record appears and the count is two.

- [ ] **Step 3: Make the filtered outage list the sole posture source**

Import `getCurrentCloudOutages`. Replace `allItems` and the severity-only outage filter:

```ts
const outages = useMemo(
  () =>
    statusData
      ? getCurrentCloudOutages(statusData).toSorted(
          (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime(),
        )
      : [],
  [statusData],
);
const outageProviders = useMemo(
  () => new Set(outages.map((item) => item.provider)),
  [outages],
);
```

Change `providerPosture` to accept `hasOutage: boolean`, and update `sortProviders`, `ProviderRow`, `ProviderChip`, and their call sites to consume `hasOutage={outageProviders.has(provider)}`. The queue, count, order, and posture then share one filtered source.

- [ ] **Step 4: Run the Status test to verify GREEN**

Run the Status test command. Expected: all Status tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/tabs/CloudStatusTab.tsx src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx
git commit -m "fix(status): hide stale outage records"
```

---

### Task 4: Restore Status, X, and Downdetector Actions

**Files:**

- Modify: `src/renderer/src/tabs/CloudStatusTab.tsx`
- Modify: `src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx`
- Modify: `src/renderer/src/tabs/cloud-status.css`

**Interfaces:**

- Consumes `downdetectorUrl(slug: string): string` and provider `statusUrl`, `twitterHandle`, and `downdetectorSlug` fields from `@shared/ipc`.
- Produces an internal `ProviderActions` component with independent accessible buttons.

- [ ] **Step 1: Replace the removed-link assertion with failing destination tests**

```ts
it('opens provider Status, X, and Downdetector actions in the outage layout', () => {
  const data = makeStatusData({ providers: { ...emptyProviders, aws: [makeItem()] } });
  render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Open AWS official status page' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open AWS on X' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open AWS on Downdetector' }));

  expect(openExternal).toHaveBeenNthCalledWith(1, 'https://status.aws.amazon.com/');
  expect(openExternal).toHaveBeenNthCalledWith(2, 'https://x.com/AWSCloud');
  expect(openExternal).toHaveBeenNthCalledWith(
    3,
    'https://downdetector.com/status/aws-amazon-web-services/',
  );
});

it('keeps separate all-clear actions and omits unavailable X accounts', () => {
  render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);

  expect(screen.getByRole('button', { name: 'Open AWS on X' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open Claude on Downdetector' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Open Claude on X' })).not.toBeInTheDocument();
});
```

Update older exact status-button assertions to the new destination-specific names.

- [ ] **Step 2: Run the Status test to verify RED**

Run the Status test command. Expected: FAIL because X and Downdetector buttons are absent.

- [ ] **Step 3: Implement independent provider actions**

Import `downdetectorUrl` and add:

```tsx
const ProviderActions: React.FC<{ provider: CloudStatusProvider }> = ({ provider }) => {
  const config = CLOUD_STATUS_PROVIDERS[provider];
  return (
    <div className="cloud-status-provider__actions">
      <button
        type="button"
        onClick={() => void globalThis.api?.openExternal(config.statusUrl)}
        aria-label={`Open ${providerLabel(provider)} official status page`}
      >
        Status
      </button>
      {config.twitterHandle && (
        <button
          type="button"
          onClick={() => void globalThis.api?.openExternal(`https://x.com/${config.twitterHandle}`)}
          aria-label={`Open ${providerLabel(provider)} on X`}
        >
          @{config.twitterHandle}
        </button>
      )}
      {config.downdetectorSlug && (
        <button
          type="button"
          onClick={() => void globalThis.api?.openExternal(downdetectorUrl(config.downdetectorSlug))}
          aria-label={`Open ${providerLabel(provider)} on Downdetector`}
        >
          Downdetector
        </button>
      )}
    </div>
  );
};
```

Render `ProviderActions` in `ProviderRow`. Convert `ProviderChip` from one large `<button>` to an `<article>` containing provider identity, posture, and `ProviderActions`; never nest action buttons inside another button.

- [ ] **Step 4: Style the restored links**

In `cloud-status.css`:

- Give `.cloud-status-provider__actions` a second-row flex layout with wrapping and small gaps.
- Style its buttons as low-emphasis text controls with a 28px minimum height, visible hover state, accent focus ring, and reduced-motion coverage.
- Expand provider row and chip grid areas so identity/posture remain first and actions sit below.
- Preserve narrow-window stacking and prevent horizontal scrolling.

- [ ] **Step 5: Verify GREEN and run the design detector**

```bash
node scripts/run-renderer-tests.mjs src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx
node /Users/ryan/.agents/skills/impeccable/scripts/detect.mjs --json \
  src/renderer/src/tabs/CloudStatusTab.tsx \
  src/renderer/src/tabs/cloud-status.css
```

Expected: all Status tests PASS and no high-severity detector findings.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/tabs/CloudStatusTab.tsx src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx src/renderer/src/tabs/cloud-status.css
git commit -m "feat(status): restore provider validation links"
```

---

### Task 5: Complete Verification and Runtime Check

**Files:** Verify only. If a gate exposes a scoped defect, add a failing regression before changing production code.

- [ ] **Step 1: Run focused behavior tests**

```bash
node scripts/run-renderer-tests.mjs \
  src/renderer/src/utils/__tests__/cloudStatus.test.ts \
  src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts \
  src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx \
  src/renderer/src/components/__tests__/Toast.test.tsx \
  src/renderer/src/components/__tests__/DynatraceProblemNotificationManager.test.tsx
```

Expected: all five files PASS without warnings.

- [ ] **Step 2: Run repository gates**

```bash
npm run test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Expected: every command exits 0. If a hook or formatter rewrites files, rerun the focused suite.

- [ ] **Step 3: Inspect the live Status workspace**

With `npm run dev` running, verify:

- March and April AWS records are absent from the active queue.
- A current outage remains visible and counted.
- AWS Status, X, and Downdetector controls are visible and open the configured destinations.
- Claude omits X but retains Status and Downdetector.
- Provider actions wrap without clipping at the default Electron window size.
- If the existing PocketBase Cloud Status persistence HTTP 400 recurs, record it separately from renderer correctness.

- [ ] **Step 4: Perform one independent final diff review**

Review the correction diff for freshness consistency, toast regressions, external-link accessibility, and responsive layout. Do not repeat fresh automated tests.

- [ ] **Step 5: Verify branch state**

```bash
git status --short --branch
git diff --check origin/test...HEAD
git rev-list --left-right --count origin/test...HEAD
```

Expected: only the pre-existing untracked `output/` directory remains, the diff check is empty, and `test` is ahead of but not behind `origin/test`.
