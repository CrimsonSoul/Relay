# Radar Queue Notifications and Sidebar Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove persistent XCenter figures from the Radar navigation item, align its single status pip with Relay's standard tab geometry, and emit deduplicated high-priority toasts when Prod01, Prod02, or Transactional Emails Queue Depth transitions to red.

**Architecture:** Keep the Radar parser, main-process poller, and IPC contract unchanged. Add one renderer notification manager that consumes the existing `RadarSnapshot`, tracks explicit per-target tone transitions, and sends `radar-critical` messages through the shared operational toast queue. Simplify the reusable sidebar status payload to a tone plus accessible announcement so Radar can retain exact tooltip information without a second visual row.

**Tech Stack:** React 19, TypeScript, Vitest and Testing Library, Electron Playwright layout contracts, existing Relay toast and Radar snapshot APIs.

## Global Constraints

- Desktop renderer only; do not enable Radar notifications in Relay Web or popout windows.
- Track only `prod01`/`prod1`, `prod02`/`prod2`, and `Transactional Emails Queue Depth`, case-insensitively.
- Use the dashboard-provided semantic tone; do not infer numeric queue-depth thresholds.
- Establish the first fresh usable snapshot as a silent baseline.
- Alert once per red episode and re-arm only after an explicit non-red tone.
- Treat a missing target as unknown, not recovered.
- Ignore snapshots with `lastUpdated === 0`, `signInRequired`, or `error`.
- Batch simultaneous red transitions into one 8-second error toast with an `Open Radar` action.
- Do not play an alert sound.
- Operational priority is exactly Dynatrace Problems, Radar critical queues, cloud outages, cloud degradation, then routine toasts.
- Preserve the standard active-tab accent rail and keep health text plus exact XCenter counts in the Radar tooltip and accessible name.
- Do not change the Radar parser, polling interval, IPC, PocketBase, Relay Web, or system-notification behavior.

---

## File Structure

- Modify `src/renderer/src/components/Toast.tsx`: add `radar-critical` to the operational delivery model and place it in the exact priority order.
- Modify `src/renderer/src/components/__tests__/Toast.test.tsx`: pin Radar preemption, resume, and queue ordering.
- Create `src/renderer/src/components/RadarQueueNotificationManager.tsx`: isolate target discovery, transition state, batching, and toast delivery.
- Create `src/renderer/src/components/__tests__/RadarQueueNotificationManager.test.tsx`: cover baseline, transitions, recovery, stale/missing data, batching, and action behavior.
- Modify `src/renderer/src/App.tsx`: mount the manager only in the desktop main window and provide Radar navigation.
- Modify `src/renderer/src/__tests__/App.test.tsx`: verify mount boundaries and `Open Radar` navigation wiring.
- Modify `src/renderer/src/components/Sidebar.tsx`: remove visible count formatting, calculate fresh/stale tone, and preserve the descriptive tooltip announcement.
- Modify `src/renderer/src/components/sidebar/SidebarButton.tsx`: remove visible detail markup from the reusable status button.
- Modify `src/renderer/src/components/sidebar/sidebar.css`: delete the Radar-specific grid and align the pip inside the standard tab footprint.
- Modify `src/renderer/src/styles/responsive.css`: remove compact count-row rules and retain only the compact pip inset.
- Modify `src/renderer/src/components/__tests__/Sidebar.test.tsx`: replace visible-count expectations with fresh/stale accessible-status coverage.
- Modify `src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx`: pin one pip, no detail row, and standard status-button geometry.
- Modify `tests/e2e/css-visual-contracts.spec.ts`: compare ordinary and Radar tab geometry in wide and compact Electron viewports.

---

### Task 1: Add Radar to the operational toast priority queue

**Files:**

- Modify: `src/renderer/src/components/Toast.tsx:14-114`
- Modify: `src/renderer/src/components/__tests__/Toast.test.tsx:30-350`

**Interfaces:**

- Consumes: existing `ShowToast(message, type, options)` and queued operational-toast lifecycle.
- Produces: `ToastDelivery` member `'radar-critical'` with priority below `'dynatrace-problem'` and above `'cloud-outage'`.

- [ ] **Step 1: Write failing priority and preemption tests**

Add a Radar trigger to `OperationalToastTrigger`:

```tsx
<button
  onClick={() =>
    showToast('Prod01 is red on Dispatcher Radar.', 'error', {
      title: 'Radar queue critical',
      durationMs: 8_000,
      delivery: 'radar-critical',
    })
  }
>
  Radar
</button>
```

Add tests that prove the complete ordering and both neighboring preemption boundaries:

```tsx
it('orders Dynatrace, Radar, cloud outage, then degradation', async () => {
  render(
    <ToastProvider>
      <OperationalToastTrigger />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Degradation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));
  fireEvent.click(screen.getByRole('button', { name: 'Radar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dynatrace one' }));

  expect(screen.getByText('Dynatrace one', { selector: '.toast-message' })).toBeVisible();
  await act(async () => vi.advanceTimersByTime(8_160));
  expect(screen.getByText('Prod01 is red on Dispatcher Radar.')).toBeVisible();
  await act(async () => vi.advanceTimersByTime(8_160));
  expect(screen.getByText('AWS outage')).toBeVisible();
  await act(async () => vi.advanceTimersByTime(4_160));
  expect(screen.getByText('Azure degradation')).toBeVisible();
});

it('Radar preempts cloud but remains queued behind Dynatrace', () => {
  render(
    <ToastProvider>
      <OperationalToastTrigger />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));
  fireEvent.click(screen.getByRole('button', { name: 'Radar' }));
  expect(screen.getByText('Prod01 is red on Dispatcher Radar.')).toBeVisible();
  expect(screen.queryByText('AWS outage')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Dynatrace one' }));
  expect(screen.getByText('Dynatrace one', { selector: '.toast-message' })).toBeVisible();
  expect(screen.queryByText('Prod01 is red on Dispatcher Radar.')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx vitest run --config vitest.renderer.config.ts src/renderer/src/components/__tests__/Toast.test.tsx
```

Expected: FAIL because `'radar-critical'` is not a `ToastDelivery` and has no queue priority.

- [ ] **Step 3: Implement the exact delivery order**

Extend the type and both priority selectors in `Toast.tsx`:

```ts
export type ToastDelivery =
  | 'routine'
  | 'cloud-degradation'
  | 'cloud-outage'
  | 'radar-critical'
  | 'dynatrace-problem';

function deliveryPriority(delivery: ToastDelivery): number {
  switch (delivery) {
    case 'dynatrace-problem':
      return 4;
    case 'radar-critical':
      return 3;
    case 'cloud-outage':
      return 2;
    case 'cloud-degradation':
      return 1;
    case 'routine':
      return 0;
  }
}
```

Insert Radar into `findNextOperationalId` between Dynatrace and cloud outage:

```ts
return (
  queued.find((toast) => deliveryOf(toast) === 'dynatrace-problem')?.id ??
  queued.find((toast) => deliveryOf(toast) === 'radar-critical')?.id ??
  queued.find((toast) => deliveryOf(toast) === 'cloud-outage')?.id ??
  queued.find((toast) => deliveryOf(toast) === 'cloud-degradation')?.id ??
  null
);
```

- [ ] **Step 4: Run the focused toast tests**

Run:

```bash
npx vitest run --config vitest.renderer.config.ts src/renderer/src/components/__tests__/Toast.test.tsx
```

Expected: all Toast tests PASS, including existing Dynatrace/cloud timer-resume coverage.

- [ ] **Step 5: Commit the priority change**

```bash
git add src/renderer/src/components/Toast.tsx src/renderer/src/components/__tests__/Toast.test.tsx
git commit -m "feat: prioritize Radar critical toasts"
```

---

### Task 2: Detect and notify fresh Radar red transitions

**Files:**

- Create: `src/renderer/src/components/RadarQueueNotificationManager.tsx`
- Create: `src/renderer/src/components/__tests__/RadarQueueNotificationManager.test.tsx`

**Interfaces:**

- Consumes: `useRadarSnapshot(): { snapshot: RadarSnapshot; ... }`, `useToast().showToast`, and an `onOpenRadar: () => void` prop.
- Produces: `RadarQueueNotificationManager`, `readRadarTargetTones(snapshot): Map<RadarTargetKey, RadarStatusColor>`, and `formatRadarTargetList(labels): string`.

- [ ] **Step 1: Write failing transition tests**

Mock `useRadarSnapshot` and `useToast`, render the manager, and rerender with successive snapshots. Define a fixture helper with `lastUpdated: 1`, no error, and the three target tones.

Use this fixture shape so every transition is explicit:

```tsx
type SnapshotOptions = {
  prod01?: RadarStatusColor | null;
  prod02?: RadarStatusColor | null;
  email?: RadarStatusColor | null;
  lastUpdated?: number;
  signInRequired?: boolean;
  error?: string | null;
};

function snapshotWith({
  prod01 = 'green',
  prod02 = 'green',
  email = 'green',
  lastUpdated = 1,
  signInRequired = false,
  error = null,
}: SnapshotOptions = {}): RadarSnapshot {
  return {
    color: 'green',
    dispatchers: [
      ...(prod01 === null ? [] : [{ name: 'prod01', tone: prod01, lastScheduleDate: '', lastPubSubDate: '', queues: [] }]),
      ...(prod02 === null ? [] : [{ name: 'prod02', tone: prod02, lastScheduleDate: '', lastPubSubDate: '', queues: [] }]),
    ],
    papa: [],
    metrics:
      email === null
        ? []
        : [{ label: 'Transactional Emails Queue Depth', value: '0', tone: email }],
    xcenter: { ok: 2_000, pending: 1_807 },
    currentTime: null,
    lastUpdated,
    signInRequired,
    error,
  };
}

let currentSnapshot = snapshotWith();
const showToast = vi.fn();
const onOpenRadar = vi.fn();

vi.mock('../../hooks/useRadarSnapshot', () => ({
  useRadarSnapshot: () => ({
    snapshot: currentSnapshot,
    refreshing: false,
    refresh: vi.fn(),
    signIn: vi.fn(),
  }),
}));

vi.mock('../Toast', () => ({
  useToast: () => ({ showToast }),
}));
```

Cover these explicit cases:

```tsx
it('silently baselines an initially red target', () => {
  currentSnapshot = snapshotWith({ prod01: 'red' });
  render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
  expect(showToast).not.toHaveBeenCalled();
});

it('batches simultaneous fresh red transitions', () => {
  currentSnapshot = snapshotWith({ prod01: 'green', prod02: 'green', email: 'green' });
  const view = render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
  currentSnapshot = snapshotWith({ prod01: 'red', prod02: 'red', email: 'green', lastUpdated: 2 });
  view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

  expect(showToast).toHaveBeenCalledWith(
    'Prod01 and Prod02 are red on Dispatcher Radar.',
    'error',
    expect.objectContaining({
      title: 'Radar queues critical',
      durationMs: 8_000,
      delivery: 'radar-critical',
    }),
  );
});

it('re-arms only after an explicit non-red tone', () => {
  currentSnapshot = snapshotWith({ prod01: 'green', lastUpdated: 1 });
  const view = render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

  currentSnapshot = snapshotWith({ prod01: 'red', lastUpdated: 2 });
  view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
  expect(showToast).toHaveBeenCalledTimes(1);

  currentSnapshot = snapshotWith({ prod01: 'red', lastUpdated: 3 });
  view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
  currentSnapshot = snapshotWith({ prod01: null, lastUpdated: 4 });
  view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
  currentSnapshot = snapshotWith({ prod01: 'red', lastUpdated: 5 });
  view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
  expect(showToast).toHaveBeenCalledTimes(1);

  currentSnapshot = snapshotWith({ prod01: 'green', lastUpdated: 6 });
  view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
  currentSnapshot = snapshotWith({ prod01: 'red', lastUpdated: 7 });
  view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
  expect(showToast).toHaveBeenCalledTimes(2);
});

it.each([
  { lastUpdated: 0 },
  { signInRequired: true },
  { error: 'ECONNREFUSED' },
])('ignores unusable snapshots: $lastUpdated $signInRequired $error', (override) => {
  currentSnapshot = snapshotWith({ prod01: 'green', lastUpdated: 1 });
  const view = render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

  currentSnapshot = snapshotWith({ prod01: 'red', lastUpdated: 2, ...override });
  view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
  expect(showToast).not.toHaveBeenCalled();

  currentSnapshot = snapshotWith({ prod01: 'red', lastUpdated: 3 });
  view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
  expect(showToast).toHaveBeenCalledOnce();
});

it('runs the Open Radar action without playing a sound', () => {
  const playAlertSound = vi.fn();
  Object.defineProperty(globalThis, 'api', {
    configurable: true,
    value: { playAlertSound },
  });
  currentSnapshot = snapshotWith({ prod01: 'green', lastUpdated: 1 });
  const view = render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
  currentSnapshot = snapshotWith({ prod01: 'red', lastUpdated: 2 });
  view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

  const options = showToast.mock.calls[0]?.[2];
  expect(options?.action?.label).toBe('Open Radar');
  options?.action?.onClick();
  expect(onOpenRadar).toHaveBeenCalledOnce();
  expect(playAlertSound).not.toHaveBeenCalled();
});
```

Pin the aliases directly through the pure extractor:

```tsx
it('matches supported target aliases case-insensitively', () => {
  const snapshot = snapshotWith();
  snapshot.dispatchers[0]!.name = 'PROD1';
  snapshot.dispatchers[1]!.name = 'Prod02';
  snapshot.metrics[0]!.label = 'transactional EMAILS queue DEPTH';

  expect([...readRadarTargetTones(snapshot)]).toEqual([
    ['prod01', 'green'],
    ['prod02', 'green'],
    ['transactionalEmails', 'green'],
  ]);
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
npx vitest run --config vitest.renderer.config.ts src/renderer/src/components/__tests__/RadarQueueNotificationManager.test.tsx
```

Expected: FAIL because the manager module does not exist.

- [ ] **Step 3: Implement target extraction and transition state**

Create the focused manager:

```tsx
import { useEffect, useRef } from 'react';
import type { RadarSnapshot, RadarStatusColor } from '@shared/ipc';
import { useRadarSnapshot } from '../hooks/useRadarSnapshot';
import { useToast } from './Toast';

type RadarTargetKey = 'prod01' | 'prod02' | 'transactionalEmails';
type RadarTarget = { key: RadarTargetKey; label: string };

const TARGETS: readonly RadarTarget[] = [
  { key: 'prod01', label: 'Prod01' },
  { key: 'prod02', label: 'Prod02' },
  { key: 'transactionalEmails', label: 'Transactional Emails Queue Depth' },
];

export function readRadarTargetTones(
  snapshot: RadarSnapshot,
): Map<RadarTargetKey, RadarStatusColor> {
  const tones = new Map<RadarTargetKey, RadarStatusColor>();
  for (const dispatcher of snapshot.dispatchers) {
    const name = dispatcher.name.trim();
    if (/^prod0?1$/i.test(name)) tones.set('prod01', dispatcher.tone);
    if (/^prod0?2$/i.test(name)) tones.set('prod02', dispatcher.tone);
  }
  const emailMetric = snapshot.metrics.find(
    (metric) => metric.label.trim().toLowerCase() === 'transactional emails queue depth',
  );
  if (emailMetric) tones.set('transactionalEmails', emailMetric.tone);
  return tones;
}

export function formatRadarTargetList(labels: string[]): string {
  if (labels.length < 2) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}

function isUsable(snapshot: RadarSnapshot): boolean {
  return snapshot.lastUpdated > 0 && !snapshot.signInRequired && !snapshot.error;
}
```

In the component effect, baseline once, leave missing keys untouched, update only explicit tones,
and notify only `previous !== undefined && previous !== 'red' && next === 'red'`:

```tsx
export function RadarQueueNotificationManager({
  onOpenRadar,
}: Readonly<{ onOpenRadar: () => void }>) {
  const { snapshot } = useRadarSnapshot();
  const { showToast } = useToast();
  const previousTonesRef = useRef<Map<RadarTargetKey, RadarStatusColor> | null>(null);

  useEffect(() => {
    if (!isUsable(snapshot)) return;
    const current = readRadarTargetTones(snapshot);
    if (previousTonesRef.current === null) {
      previousTonesRef.current = current;
      return;
    }

    const newlyRed: string[] = [];
    for (const target of TARGETS) {
      const next = current.get(target.key);
      if (next === undefined) continue;
      const previous = previousTonesRef.current.get(target.key);
      if (next === 'red' && previous !== undefined && previous !== 'red') {
        newlyRed.push(target.label);
      }
      previousTonesRef.current.set(target.key, next);
    }
    if (newlyRed.length === 0) return;

    const names = formatRadarTargetList(newlyRed);
    showToast(
      `${names} ${newlyRed.length === 1 ? 'is' : 'are'} red on Dispatcher Radar.`,
      'error',
      {
        title: newlyRed.length === 1 ? 'Radar queue critical' : 'Radar queues critical',
        durationMs: 8_000,
        delivery: 'radar-critical',
        action: { label: 'Open Radar', onClick: onOpenRadar },
      },
    );
  }, [onOpenRadar, showToast, snapshot]);

  return null;
}
```

- [ ] **Step 4: Run the manager tests**

Run:

```bash
npx vitest run --config vitest.renderer.config.ts src/renderer/src/components/__tests__/RadarQueueNotificationManager.test.tsx
```

Expected: all baseline, deduplication, batching, recovery, matching, stale, and action tests PASS.

- [ ] **Step 5: Commit the notification manager**

```bash
git add src/renderer/src/components/RadarQueueNotificationManager.tsx src/renderer/src/components/__tests__/RadarQueueNotificationManager.test.tsx
git commit -m "feat: notify on Radar red transitions"
```

---

### Task 3: Mount notifications in the desktop main window

**Files:**

- Modify: `src/renderer/src/App.tsx:17-23,160-230,550-570`
- Modify: `src/renderer/src/__tests__/App.test.tsx:280-300,1040-1090`

**Interfaces:**

- Consumes: `RadarQueueNotificationManager({ onOpenRadar })` from Task 2 and the existing `setActiveTab`.
- Produces: main-window-only manager mounting and `Open Radar` navigation.

- [ ] **Step 1: Write failing App integration tests**

Mock the manager with an action button:

```tsx
vi.mock('../components/RadarQueueNotificationManager', () => ({
  RadarQueueNotificationManager: ({ onOpenRadar }: { onOpenRadar: () => void }) => (
    <button data-testid="radar-queue-notification-manager" onClick={onOpenRadar}>
      Open Radar notification
    </button>
  ),
}));
```

Add tests that:

1. render the default Electron main window and find the manager;
2. click its button and expect `screen.getByTestId('active-tab')` to contain `Radar`;
3. render `?popout=dynatrace` and expect no manager; and
4. set `globalThis.api.runtime.kind` to `web` and expect no manager.

- [ ] **Step 2: Run the App test and verify it fails**

Run:

```bash
npx vitest run --config vitest.renderer.config.ts src/renderer/src/__tests__/App.test.tsx
```

Expected: FAIL because `App.tsx` does not import or render the manager.

- [ ] **Step 3: Wire the manager into `MainApp`**

Add the import and a stable navigation callback:

```tsx
import { RadarQueueNotificationManager } from './components/RadarQueueNotificationManager';

const isDesktop = globalThis.api?.runtime?.kind === 'electron';
const handleOpenRadar = useCallback(() => setActiveTab('Radar'), [setActiveTab]);
```

Mount it beside the Dynatrace manager, but only in the main desktop window:

```tsx
{!isPopout && isDesktop && (
  <ErrorBoundary fallback={null}>
    <RadarQueueNotificationManager onOpenRadar={handleOpenRadar} />
  </ErrorBoundary>
)}
```

- [ ] **Step 4: Run App and manager tests together**

Run:

```bash
npx vitest run --config vitest.renderer.config.ts \
  src/renderer/src/__tests__/App.test.tsx \
  src/renderer/src/components/__tests__/RadarQueueNotificationManager.test.tsx
```

Expected: both files PASS and existing popout behavior remains unchanged.

- [ ] **Step 5: Commit the app integration**

```bash
git add src/renderer/src/App.tsx src/renderer/src/__tests__/App.test.tsx
git commit -m "feat: mount Radar queue notifications"
```

---

### Task 4: Remove visible Radar counts and align the status pip

**Files:**

- Modify: `src/renderer/src/components/Sidebar.tsx:39-95`
- Modify: `src/renderer/src/components/sidebar/SidebarButton.tsx:6-65`
- Modify: `src/renderer/src/components/sidebar/sidebar.css:403-475`
- Modify: `src/renderer/src/styles/responsive.css:45-92`
- Modify: `src/renderer/src/components/__tests__/Sidebar.test.tsx:60-200`
- Modify: `src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx:130-270`
- Modify: `tests/e2e/css-visual-contracts.spec.ts:821-880`

**Interfaces:**

- Consumes: existing `RadarSnapshot`, `RADAR_STATUS_LABELS`, standard `.sidebar-button` geometry, and `SidebarButtonStatus`.
- Produces: `SidebarButtonStatus = { tone: string; announcement: string }` with one visual pip and no persistent detail row.

- [ ] **Step 1: Replace sidebar tests with the new visual and accessibility contract**

Delete compact-number formatter cases and visible detail assertions. Add:

```tsx
it('shows one Radar pip without persistent XCenter figures', async () => {
  stubRuntime('electron');
  const { container } = render(<Sidebar {...defaultProps} />);

  await vi.waitFor(() => {
    const radar = screen.getByTestId('sidebar-btn-radar');
    expect(radar).toHaveAttribute('data-status-tone', 'green');
    expect(radar).toHaveAttribute(
      'data-status-announcement',
      'Healthy. XCenter OK 2,000, Pending 1,807',
    );
  });
  expect(container.querySelectorAll('.sidebar-button-status-dot')).toHaveLength(1);
  expect(container.querySelector('.sidebar-button-detail')).toBeNull();
});

it.each([
  [{ lastUpdated: 0 }, 'Unknown'],
  [{ lastUpdated: 1, error: 'ECONNREFUSED' }, 'Stale. XCenter OK 2,000, Pending 1,807'],
  [{ lastUpdated: 1, signInRequired: true }, 'Stale. XCenter OK 2,000, Pending 1,807'],
])('uses a neutral pip for unavailable or stale Radar data', async (override, announcement) => {
  stubRuntime('electron', override);
  render(<Sidebar {...defaultProps} />);
  await vi.waitFor(() => {
    const radar = screen.getByTestId('sidebar-btn-radar');
    expect(radar).toHaveAttribute('data-status-tone', 'unknown');
    expect(radar).toHaveAttribute('data-status-announcement', announcement);
  });
});
```

Update `SidebarButton.test.tsx` to assert one pip, no `.sidebar-button-detail`, status in the
accessible name/tooltip, and no special grid/height rules.

- [ ] **Step 2: Update the Electron layout contract and verify it fails**

Render an ordinary tab beside a Radar status tab, with no detail markup. At 1440px and 1100px,
assert:

```ts
const ordinaryBox = await ordinaryButton.boundingBox();
const radarBox = await radarButton.boundingBox();
expect({ width: radarBox?.width, height: radarBox?.height }).toEqual({
  width: ordinaryBox?.width,
  height: ordinaryBox?.height,
});
const ordinaryIconBox = await ordinaryIcon.boundingBox();
const radarIconBox = await radarIcon.boundingBox();
expect({
  x: (radarIconBox?.x ?? 0) - (radarBox?.x ?? 0),
  y: (radarIconBox?.y ?? 0) - (radarBox?.y ?? 0),
}).toEqual({
  x: (ordinaryIconBox?.x ?? 0) - (ordinaryBox?.x ?? 0),
  y: (ordinaryIconBox?.y ?? 0) - (ordinaryBox?.y ?? 0),
});
await expect(window.locator('.sidebar-button-detail')).toHaveCount(0);
await expect(window.locator('.sidebar-button-status-dot')).toHaveCount(1);
```

Also assert the pip's bounding box is inside the Radar button at both sizes and its vertical
center is within one pixel of the button's vertical center.

Run:

```bash
npx vitest run --config vitest.renderer.config.ts \
  src/renderer/src/components/__tests__/Sidebar.test.tsx \
  src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx
npx playwright test tests/e2e/css-visual-contracts.spec.ts \
  --config playwright.electron.config.ts \
  --grep "Radar status keeps"
```

Expected: FAIL because count detail markup and Radar-specific grid rules still exist.

- [ ] **Step 3: Simplify the status payload and stale announcement**

Remove `formatRadarNavigationCount`, `detail`, and `compactDetail`. Build the status like this:

```tsx
const radarUnavailable = radar.lastUpdated === 0;
const radarStale = !radarUnavailable && (radar.signInRequired || Boolean(radar.error));
const radarTone = radarUnavailable || radarStale ? 'unknown' : radar.color;
const radarLabel = radarUnavailable
  ? 'Unknown'
  : radarStale
    ? 'Stale'
    : RADAR_STATUS_LABELS[radar.color];
const hasCounts = radar.xcenter.ok !== null || radar.xcenter.pending !== null;
const radarStatus: SidebarButtonStatus = {
  tone: radarTone,
  announcement: hasCounts
    ? `${radarLabel}. XCenter OK ${radar.xcenter.ok?.toLocaleString('en-US') ?? 'unknown'}, Pending ${radar.xcenter.pending?.toLocaleString('en-US') ?? 'unknown'}`
    : radarLabel,
};
```

Reduce the reusable type and remove detail rendering:

```ts
export type SidebarButtonStatus = {
  tone: string;
  announcement: string;
};
```

- [ ] **Step 4: Restore standard geometry and align the pip**

Delete `.sidebar-button--status` grid rules and all `.sidebar-button-detail*` rules. Keep the pip
inside the standard button:

```css
.sidebar-button-status-dot {
  position: absolute;
  top: 50%;
  right: 10px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-quaternary);
  transform: translateY(-50%);
  pointer-events: none;
}
```

Keep the existing semantic tone selectors. In the compact media query, delete the status grid
and count-detail rules; only adjust `right: 7px` if the Electron bounding-box assertion shows the
pip needs the smaller inset.

- [ ] **Step 5: Run focused component and Electron layout tests**

Run:

```bash
npx vitest run --config vitest.renderer.config.ts \
  src/renderer/src/components/__tests__/Sidebar.test.tsx \
  src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx
npm run test:electron -- --grep "Radar status keeps"
```

Expected: component tests PASS; the real Electron contract reports 120×56 wide and 56×48 compact
for both ordinary and Radar buttons, with matching icon/label geometry and one contained pip.

- [ ] **Step 6: Run the one required Impeccable detector pass**

Run once, after the UI change is finished:

```bash
node /Users/ryan/.agents/skills/impeccable/scripts/detect.mjs --json \
  src/renderer/src/components/Sidebar.tsx \
  src/renderer/src/components/sidebar/SidebarButton.tsx \
  src/renderer/src/components/sidebar/sidebar.css \
  src/renderer/src/styles/responsive.css
```

Expected: no unresolved high-confidence design defects. Fix any genuine in-scope finding, rerun
the affected focused tests, and do not run the detector a second time.

- [ ] **Step 7: Commit the sidebar refinement**

```bash
git add \
  src/renderer/src/components/Sidebar.tsx \
  src/renderer/src/components/sidebar/SidebarButton.tsx \
  src/renderer/src/components/sidebar/sidebar.css \
  src/renderer/src/styles/responsive.css \
  src/renderer/src/components/__tests__/Sidebar.test.tsx \
  src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx \
  tests/e2e/css-visual-contracts.spec.ts
git commit -m "refine: align the Radar sidebar indicator"
```

---

### Task 5: Run full Relay verification

**Files:**

- Verify only; modify source only if a gate reveals an in-scope defect.

**Interfaces:**

- Consumes: committed Tasks 1-4.
- Produces: a clean, verified branch tip ready for the user's integration choice.

- [ ] **Step 1: Run all required repository gates**

Run:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
git diff --check
npm audit --audit-level=high --omit=dev
```

Expected: every command exits 0; audit reports no high-or-greater production vulnerability.

- [ ] **Step 2: Run the full desktop integration suite**

Run:

```bash
npm run test:electron
```

Expected: all Electron tests PASS and the native-module ABI restoration completes successfully.

- [ ] **Step 3: Inspect the committed scope**

Run:

```bash
git status --short --branch
git log --oneline --decorate origin/test..HEAD
git diff --stat origin/test...HEAD
```

Expected: no uncommitted source changes and only the approved spec, plan, notification, toast,
App integration, sidebar, and focused test commits are ahead of `origin/test`.

- [ ] **Step 4: Hand off without pushing**

Report the exact test results, commits, and branch divergence. Do not push to `origin/test` until
the user explicitly requests it.
