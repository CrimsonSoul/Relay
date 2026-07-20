# Cloud Status Outage and Toast Priority Implementation Plan

> **For agentic workers:** Execute this plan directly in the primary current session. Use red-green TDD for every behavior slice and one independent final review after implementation; do not dispatch per-task implementers or reviewers unless the user asks.

**Goal:** Replace Relay's noisy provider-update workspace with an outage-only Status experience and guarantee that every new Dynatrace Problem toast appears before queued cloud-outage toasts.

**Architecture:** Source hooks remain responsible for deciding what is notification-worthy. `ToastProvider` gains a typed operational delivery lane that serializes cloud outages and Dynatrace Problems, while `CloudStatusTab` derives an outage-only projection from the unchanged shared snapshot.

**Tech Stack:** React 19, TypeScript 6, Vitest 4, Testing Library, Electron renderer CSS, existing Relay toast and cloud-status infrastructure.

## Global Constraints

- Keep server cloud-status aggregation, polling, persistence, and shared IPC schemas unchanged.
- Keep every newly opened Dynatrace Problem toast-worthy, regardless of Dynatrace severity.
- Cloud Status toasts are eligible only for newly active `error` records.
- Dynatrace operational toasts always precede cloud-outage toasts; waiting cannot consume a toast's visible duration.
- Preserve routine Relay toasts and existing accessibility semantics.
- Use exact Status copy: `External outages`, `Outage`, `Unknown`, `No outage`, `No reported outages`, and `No reported outages from available feeds`.
- Keep `output/` and all unrelated user files untouched.

---

## File Map

- Modify `src/renderer/src/components/Toast.tsx`: typed delivery classification, operational queue, preemption, timer activation, and rendering order.
- Modify `src/renderer/src/components/__tests__/Toast.test.tsx`: operational FIFO, Dynatrace priority, preemption, duration, action, routine coexistence, and cleanup regressions.
- Modify `src/renderer/src/hooks/useAppCloudStatus.ts`: silent baseline, active-outage ID tracking, outage-only notification eligibility, and cloud delivery metadata.
- Modify `src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts`: startup, escalation, reopen, batching, deduplication, and delivery metadata regressions.
- Modify `src/renderer/src/components/DynatraceProblemNotificationManager.tsx`: Dynatrace delivery metadata only; retain batching, severity, sound, and action behavior.
- Modify `src/renderer/src/components/__tests__/DynatraceProblemNotificationManager.test.tsx`: every severity and delivery metadata regressions.
- Modify `src/renderer/src/tabs/CloudStatusTab.tsx`: outage-only projection and selected coverage-plus-queue/all-clear layouts.
- Modify `src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx`: outage-only UI, provider posture, exact copy, ordering, source actions, and removed-control regressions.
- Modify `src/renderer/src/tabs/cloud-status.css`: selected dense dark-console layout, responsive stack, focus treatment, and reduced-motion behavior.

---

### Task 1: Add the Operational Toast Lane

**Files:**

- Modify: `src/renderer/src/components/Toast.tsx`
- Test: `src/renderer/src/components/__tests__/Toast.test.tsx`

**Interfaces:**

- Produces: `export type ToastDelivery = 'routine' | 'cloud-outage' | 'dynatrace-problem'`.
- Produces: exported `ToastOptions` with optional `delivery?: ToastDelivery` while preserving `title`, `durationMs`, and `action`.
- Produces: exported `ShowToast = (message: string, type: ToastType, options?: ToastOptions) => void`.
- Preserves: `useToast()`, `ToastProvider`, and `NoopToastProvider` call sites.

- [ ] **Step 1: Write failing delivery-order tests**

Add trigger helpers that can emit cloud, Dynatrace, and routine notifications with explicit durations:

```tsx
const OperationalToastTrigger = () => {
  const { showToast } = useToast();
  return (
    <>
      <button
        onClick={() =>
          showToast('AWS outage', 'error', {
            title: 'Cloud outage',
            durationMs: 4_000,
            delivery: 'cloud-outage',
          })
        }
      >
        Cloud
      </button>
      <button
        onClick={() =>
          showToast('P-1001 · Checkout unavailable', 'error', {
            title: 'New Dynatrace problem',
            durationMs: 8_000,
            delivery: 'dynatrace-problem',
          })
        }
      >
        Dynatrace
      </button>
      <button onClick={() => showToast('Contact saved', 'success')}>Routine</button>
    </>
  );
};
```

Add tests with these exact assertions:

```tsx
it('queues cloud outages until the active Dynatrace problem closes', async () => {
  render(<ToastProvider><OperationalToastTrigger /></ToastProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Dynatrace' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));

  expect(screen.getByText('P-1001 · Checkout unavailable')).toBeInTheDocument();
  expect(screen.queryByText('AWS outage')).not.toBeInTheDocument();

  await act(async () => vi.advanceTimersByTime(8_160));
  expect(screen.getByText('AWS outage')).toBeInTheDocument();
});

it('preempts a visible cloud outage and restarts its full duration after Dynatrace', async () => {
  render(<ToastProvider><OperationalToastTrigger /></ToastProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));
  await act(async () => vi.advanceTimersByTime(1_000));
  fireEvent.click(screen.getByRole('button', { name: 'Dynatrace' }));

  expect(screen.queryByText('AWS outage')).not.toBeInTheDocument();
  expect(screen.getByText('P-1001 · Checkout unavailable')).toBeInTheDocument();

  await act(async () => vi.advanceTimersByTime(8_160));
  expect(screen.getByText('AWS outage')).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTime(3_999));
  expect(screen.getByText('AWS outage')).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTime(161));
  expect(screen.queryByText('AWS outage')).not.toBeInTheDocument();
});

it('renders routine toasts below the active operational toast', () => {
  const { container } = render(<ToastProvider><OperationalToastTrigger /></ToastProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Routine' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dynatrace' }));

  expect(Array.from(container.querySelectorAll('.toast-message')).map((node) => node.textContent))
    .toEqual(['P-1001 · Checkout unavailable', 'Contact saved']);
});
```

Use a second trigger that emits `Dynatrace one`, `Dynatrace two`, and `Cloud queued`, plus an operational action callback, then add these queue regressions:

```tsx
it('keeps Dynatrace FIFO ahead of queued cloud outages', async () => {
  render(<ToastProvider><QueueTrigger /></ToastProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Cloud queued' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dynatrace one' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dynatrace two' }));

  expect(screen.getByText('Dynatrace one')).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTime(8_160));
  expect(screen.getByText('Dynatrace two')).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTime(8_160));
  expect(screen.getByText('Cloud queued')).toBeInTheDocument();
});

it('advances the operational queue after action or manual dismissal', async () => {
  const onAction = vi.fn();
  render(<ToastProvider><ActionQueueTrigger onAction={onAction} /></ToastProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Cloud queued' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dynatrace action' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open Problems' }));
  await act(async () => vi.advanceTimersByTime(160));
  expect(onAction).toHaveBeenCalledOnce();
  expect(screen.getByText('Cloud queued')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
  await act(async () => vi.advanceTimersByTime(160));
  expect(screen.queryByText('Cloud queued')).not.toBeInTheDocument();
});

it('clears visible and queued operational timers on unmount', () => {
  const { unmount } = render(<ToastProvider><OperationalToastTrigger /></ToastProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dynatrace' }));
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
```

- [ ] **Step 2: Run the Toast tests and confirm RED**

Run:

```bash
npx vitest run src/renderer/src/components/__tests__/Toast.test.tsx
```

Expected: FAIL because `ToastOptions` has no `delivery` field and the provider renders all toasts concurrently.

- [ ] **Step 3: Implement typed queueing and activation**

Export the delivery contract and add `queued` to toast state:

```tsx
export type ToastDelivery = 'routine' | 'cloud-outage' | 'dynatrace-problem';
export type ToastType = 'success' | 'error' | 'info' | 'warning';

export type ToastOptions = {
  title?: string;
  durationMs?: number;
  delivery?: ToastDelivery;
  action?: { label: string; onClick: () => void };
};

export type ShowToast = (
  message: string,
  type: ToastType,
  options?: ToastOptions,
) => void;

interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  state: 'queued' | 'open' | 'closing';
  options?: ToastOptions;
}
```

Inside `ToastProvider`, keep a synchronous `toastsRef` beside state, classify `options?.delivery ?? 'routine'`, and use these rules:

```tsx
const isOperational = (toast: ToastMessage) =>
  (toast.options?.delivery ?? 'routine') !== 'routine';

const nextOperational = (toasts: ToastMessage[]) =>
  toasts.find(
    (toast) => toast.state === 'queued' && toast.options?.delivery === 'dynatrace-problem',
  ) ??
  toasts.find(
    (toast) => toast.state === 'queued' && toast.options?.delivery === 'cloud-outage',
  );
```

Routine messages enter `open` and receive a timer immediately. Operational messages enter `queued`; an effect activates `nextOperational` only when no operational toast is `open` or `closing`, then starts that toast's duration. When a Dynatrace message arrives while a cloud toast is `open`, clear the cloud timer, move it back to `queued`, append Dynatrace, and let the activation effect choose Dynatrace. Final removal triggers activation of the next queued operational toast.

Render only non-queued messages, with the active operational message first:

```tsx
const visibleToasts = toasts.filter((toast) => toast.state !== 'queued');
const orderedToasts = [
  ...visibleToasts.filter(isOperational),
  ...visibleToasts.filter((toast) => !isOperational(toast)),
];
```

Keep the existing 160 ms closing state, roles, titles, actions, SVG close button, and `NoopToastProvider`. Clear every timer on unmount.

- [ ] **Step 4: Run the Toast tests and confirm GREEN**

Run:

```bash
npx vitest run src/renderer/src/components/__tests__/Toast.test.tsx
```

Expected: all Toast tests PASS with no warnings.

- [ ] **Step 5: Commit the operational lane**

```bash
git add src/renderer/src/components/Toast.tsx src/renderer/src/components/__tests__/Toast.test.tsx
git commit -m "feat(toasts): prioritize operational alerts"
```

---

### Task 2: Make Source Notifications Outage-Aware and Dynatrace-First

**Files:**

- Modify: `src/renderer/src/hooks/useAppCloudStatus.ts`
- Test: `src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts`
- Modify: `src/renderer/src/components/DynatraceProblemNotificationManager.tsx`
- Test: `src/renderer/src/components/__tests__/DynatraceProblemNotificationManager.test.tsx`

**Interfaces:**

- Consumes: `ShowToast` and `ToastOptions.delivery` from Task 1.
- Produces: cloud notifications with `delivery: 'cloud-outage'` and title `Cloud outage`.
- Produces: Dynatrace notifications with `delivery: 'dynatrace-problem'`.

- [ ] **Step 1: Write failing Cloud Status notification tests**

Replace the old initial-outage notification expectation with a silent baseline, then add transition cases:

```tsx
it('uses the first uncached realtime snapshot as a silent outage baseline', async () => {
  collectionState.data = [snapshot(status([item()]))];
  renderHook(() => useAppCloudStatus(showToast));
  await act(async () => Promise.resolve());
  expect(showToast).not.toHaveBeenCalled();
});

it('notifies only when a new outage arrives after the baseline', async () => {
  collectionState.data = [snapshot(status([item({ id: 'warning-1', severity: 'warning' })]))];
  const { rerender } = renderHook(() => useAppCloudStatus(showToast));
  await act(async () => Promise.resolve());

  collectionState.data = [snapshot(status([
    item({ id: 'warning-1', severity: 'warning' }),
    item({ id: 'outage-1', title: 'S3 outage', severity: 'error' }),
  ]))];
  rerender();

  await waitFor(() => expect(showToast).toHaveBeenCalledWith(
    'AWS Outage: S3 outage',
    'error',
    expect.objectContaining({ title: 'Cloud outage', delivery: 'cloud-outage' }),
  ));
});

it('notifies when a known warning escalates to an outage', async () => {
  collectionState.data = [snapshot(status([item({ severity: 'warning' })]))];
  const { rerender } = renderHook(() => useAppCloudStatus(showToast));
  await act(async () => Promise.resolve());

  collectionState.data = [snapshot(status([item({ severity: 'error' })]))];
  rerender();
  await waitFor(() => expect(showToast).toHaveBeenCalledOnce());
});
```

Add the remaining transition and batching regressions explicitly:

```tsx
it('notifies when a resolved outage later reopens with the same id', async () => {
  collectionState.data = [snapshot(status([item({ severity: 'error' })]))];
  const { rerender } = renderHook(() => useAppCloudStatus(showToast));
  await act(async () => Promise.resolve());

  collectionState.data = [snapshot(status([item({ severity: 'resolved' })]))];
  rerender();
  await act(async () => Promise.resolve());
  collectionState.data = [snapshot(status([item({ severity: 'error' })]))];
  rerender();
  await waitFor(() => expect(showToast).toHaveBeenCalledOnce());
});

it('batches simultaneous new outages into one cloud toast', async () => {
  collectionState.data = [snapshot(status())];
  const { rerender } = renderHook(() => useAppCloudStatus(showToast));
  await act(async () => Promise.resolve());

  collectionState.data = [snapshot(status([
    item({ id: 'outage-1', title: 'S3 outage' }),
    item({ id: 'outage-2', provider: 'azure', title: 'Storage outage' }),
  ]))];
  rerender();
  await waitFor(() => expect(showToast).toHaveBeenCalledWith(
    'AWS Outage: S3 outage (+1 more)',
    'error',
    expect.objectContaining({ delivery: 'cloud-outage' }),
  ));
});

it.each(['warning', 'info', 'resolved'] as const)(
  'does not notify for %s-only updates',
  async (severity) => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());
    collectionState.data = [snapshot(status([item({ severity })]))];
    rerender();
    await act(async () => Promise.resolve());
    expect(showToast).not.toHaveBeenCalled();
  },
);
```

Retain the cached-outage regression by restoring a cached `error` item, delivering the same realtime item, and asserting `showToast` remains untouched.

- [ ] **Step 2: Run Cloud Status hook tests and confirm RED**

Run:

```bash
npx vitest run src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts
```

Expected: FAIL because the current hook notifies on the first uncached outage, includes warnings, and supplies no delivery metadata.

- [ ] **Step 3: Implement active-outage baselining**

Import `ShowToast`, replace `seenIdsRef` with an outage-only set, and add a baseline flag:

```tsx
import type { ShowToast } from '../components/Toast';

const activeOutageIdsRef = useRef(new Set<string>());
const baselineEstablishedRef = useRef(false);

function getOutages(data: CloudStatusData): CloudStatusItem[] {
  return getAllItems(data).filter((item) => item.severity === 'error');
}
```

Cached restoration sets the active IDs from cached outages and sets `baselineEstablishedRef.current = true`. `processNewEvents` seeds and returns on the first uncached commit. Later commits compare current outage IDs, batch new outages, call:

```tsx
showToast(
  `${providerLabel(primary.provider)} Outage: ${primary.title}${suffix}`,
  'error',
  { title: 'Cloud outage', delivery: 'cloud-outage' },
);
```

Finally replace `activeOutageIdsRef.current` with the current outage-ID set so downgrade, resolution, and disappearance permit a later reopen notification.

- [ ] **Step 4: Run Cloud Status hook tests and confirm GREEN**

Run:

```bash
npx vitest run src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts
```

Expected: all hook tests PASS.

- [ ] **Step 5: Write failing Dynatrace delivery/severity tests**

Strengthen the existing toast expectation:

```tsx
expect(mocks.showToast).toHaveBeenCalledWith(
  'P-1001 · Checkout service unavailable',
  'error',
  expect.objectContaining({
    title: 'New Dynatrace problem',
    durationMs: 8_000,
    delivery: 'dynatrace-problem',
  }),
);
```

Add `it.each` over all seven `DynatraceProblemSeverity` values and expect each newly opened problem to notify once; expect error type for `AVAILABILITY`, `MONITORING_UNAVAILABLE`, and `ERROR`, and warning type for the remaining severities.

- [ ] **Step 6: Run Dynatrace notification tests and confirm RED**

Run:

```bash
npx vitest run src/renderer/src/components/__tests__/DynatraceProblemNotificationManager.test.tsx
```

Expected: FAIL because the existing toast options do not include Dynatrace delivery metadata.

- [ ] **Step 7: Mark Dynatrace notifications as highest priority**

Keep all existing eligibility, batching, sorting, sound, duration, and action code. Add only the delivery field:

```tsx
showToast(notificationMessage(newOpenProblems), toastType, {
  title: newOpenProblems.length === 1 ? 'New Dynatrace problem' : 'New Dynatrace problems',
  durationMs: 8_000,
  delivery: 'dynatrace-problem',
  action: { label: 'Open Problems', onClick: onOpenProblems },
});
```

- [ ] **Step 8: Run source notification tests and confirm GREEN**

Run:

```bash
npx vitest run \
  src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts \
  src/renderer/src/components/__tests__/DynatraceProblemNotificationManager.test.tsx
```

Expected: both files PASS with every severity covered.

- [ ] **Step 9: Commit source eligibility and priority metadata**

```bash
git add \
  src/renderer/src/hooks/useAppCloudStatus.ts \
  src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts \
  src/renderer/src/components/DynatraceProblemNotificationManager.tsx \
  src/renderer/src/components/__tests__/DynatraceProblemNotificationManager.test.tsx
git commit -m "feat(status): alert only on new cloud outages"
```

---

### Task 3: Distill the Status Workspace to Outages

**Files:**

- Modify: `src/renderer/src/tabs/CloudStatusTab.tsx`
- Test: `src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx`
- Modify: `src/renderer/src/tabs/cloud-status.css`

**Interfaces:**

- Consumes: unchanged `CloudStatusData`, `CloudStatusItem`, provider metadata, and `refetch` props.
- Produces: no new external API; `CloudStatusTab` props remain unchanged.

- [ ] **Step 1: Replace feed-mode tests with outage-only behavior tests**

Keep loading and refresh coverage. Add these core assertions:

```tsx
it('shows only outages and counts only outages', () => {
  const data = makeStatusData({
    providers: {
      ...emptyProviders,
      aws: [makeItem({ id: 'outage', severity: 'error', title: 'EC2 outage' })],
      azure: [makeItem({ id: 'warning', provider: 'azure', severity: 'warning', title: 'Latency' })],
      github: [makeItem({ id: 'resolved', provider: 'github', severity: 'resolved', title: 'Recovered' })],
    },
  });
  render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

  expect(screen.getByRole('heading', { name: 'External outages' })).toBeInTheDocument();
  expect(screen.getByText('EC2 outage')).toBeInTheDocument();
  expect(screen.queryByText('Latency')).not.toBeInTheDocument();
  expect(screen.queryByText('Recovered')).not.toBeInTheDocument();
  expect(screen.getByText('1 active outage')).toBeInTheDocument();
});

it('uses precise all-clear copy and keeps compact provider coverage', () => {
  render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
  expect(screen.getByText('No reported outages')).toBeInTheDocument();
  expect(screen.getByText('10 monitored providers')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open AWS status page' })).toBeInTheDocument();
  expect(screen.queryByText('All services normal')).not.toBeInTheDocument();
});

it('does not claim all-clear when a provider feed is unavailable', () => {
  const data = makeStatusData({ errors: [{ provider: 'github', message: 'fetch failed' }] });
  render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);
  expect(screen.getByText('No reported outages from available feeds')).toBeInTheDocument();
  expect(screen.getByText('Unknown')).toBeInTheDocument();
});
```

Add explicit ordering, visibility, and removed-control regressions:

```tsx
it('orders outage providers before unknown and clear providers', () => {
  const data = makeStatusData({
    providers: { ...emptyProviders, azure: [makeItem({ provider: 'azure', severity: 'error' })] },
    errors: [{ provider: 'github', message: 'fetch failed' }],
  });
  const { container } = render(
    <CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />,
  );
  expect(Array.from(container.querySelectorAll('.cloud-status-provider__name')).slice(0, 3)
    .map((node) => node.textContent)).toEqual(['Azure', 'GitHub', 'AWS']);
});

it('shows outage details without expansion and keeps only official source actions', () => {
  const data = makeStatusData({
    providers: {
      ...emptyProviders,
      aws: [makeItem({ severity: 'error', description: '<p>Investigating EC2</p>' })],
    },
  });
  render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);
  expect(screen.getByText('Investigating EC2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open AWS status page' })).toBeInTheDocument();
  expect(screen.queryByText('@AWSCloud')).not.toBeInTheDocument();
  expect(screen.queryByText(/Downdetector/)).not.toBeInTheDocument();
});

it('removes historical feed controls and hidden severity labels', () => {
  render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  for (const label of ['DEGRADED', 'INFO', 'RESOLVED']) {
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  }
});
```

- [ ] **Step 2: Run Status tab tests and confirm RED**

Run:

```bash
npx vitest run src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx
```

Expected: FAIL because the current page renders feed filters/search, warning/resolved content, `All services normal`, and social/crowd links.

- [ ] **Step 3: Implement the outage-only projection and markup**

Remove `FilterMode`, `FeedMode`, `FEED_FILTERS`, search state/imports, expansion state, warning/info/resolved labels, provider filtering, and social/Downdetector actions.

Derive the workspace from the unchanged snapshot:

```tsx
const outages = useMemo(
  () =>
    allItems
      .filter((item) => item.severity === 'error')
      .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()),
  [allItems],
);

type ProviderPosture = 'outage' | 'unknown' | 'clear';

function providerPosture(
  items: CloudStatusItem[],
  hasFeedError: boolean,
): ProviderPosture {
  if (items.some((item) => item.severity === 'error')) return 'outage';
  if (hasFeedError) return 'unknown';
  return 'clear';
}
```

Sort by posture rank `outage`, `unknown`, `clear`, then configured provider order. In the outage state, render the provider rail and always-expanded outage queue. In the zero-outage state, render the exact all-clear headline plus compact provider source buttons. If `errors.length > 0`, use `No reported outages from available feeds`.

Keep `stripHtml`, local-time formatting, last-updated formatting, official `openExternal` calls, refresh loading state, StatusBar, semantic sections, visible focus, and sanitized descriptions.

- [ ] **Step 4: Replace Cloud Status CSS with the selected layout**

Retain the existing token system and sharp two-pixel-radius console vocabulary. Define only selectors used by the new markup:

- `.cloud-status__header`, summary, notice, workspace, coverage rail, outage queue, and all-clear state.
- Provider rows/chips with outage, unknown, and clear semantic tones.
- Always-visible outage articles with restrained alarm tint and official source action.
- `@media (max-width: 860px)` stacking coverage above outages.
- `@media (max-width: 620px)` compact page padding and wrapped metadata.
- `:focus-visible` outlines for refresh and every source action.
- `prefers-reduced-motion` handling for refresh spin and state transitions.

Do not introduce side-stripe accents, wide ghost-card shadows, decorative glow, large rounded cards, or new color tokens.

Use the existing responsive structure rather than a new layout system:

```css
.cloud-status__workspace {
  display: grid;
  flex: 1 1 0;
  min-height: 0;
  grid-template-columns: minmax(300px, 0.78fr) minmax(0, 1.22fr);
  border: 1px solid var(--color-border);
  background: var(--color-bg-surface);
  overflow: hidden;
}

.cloud-status__workspace--clear {
  grid-template-columns: 1fr;
}

@media (max-width: 860px) {
  .cloud-status__workspace {
    grid-template-columns: 1fr;
    overflow: visible;
  }
}
```

- [ ] **Step 5: Run Status tab tests and confirm GREEN**

Run:

```bash
npx vitest run src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx
```

Expected: all Status tab tests PASS.

- [ ] **Step 6: Run the full focused behavior slice**

Run:

```bash
npx vitest run \
  src/renderer/src/components/__tests__/Toast.test.tsx \
  src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts \
  src/renderer/src/components/__tests__/DynatraceProblemNotificationManager.test.tsx \
  src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx
```

Expected: all four files PASS with no warnings.

- [ ] **Step 7: Run the Impeccable detector on the changed surface**

Run:

```bash
node /Users/ryan/.agents/skills/impeccable/scripts/detect.mjs --json \
  src/renderer/src/tabs/CloudStatusTab.tsx \
  src/renderer/src/tabs/cloud-status.css \
  src/renderer/src/components/Toast.tsx
```

Expected: no high-severity design-rule findings. Address any scoped accessibility or prohibited-pattern finding before committing.

- [ ] **Step 8: Commit the outage-focused workspace**

```bash
git add \
  src/renderer/src/tabs/CloudStatusTab.tsx \
  src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx \
  src/renderer/src/tabs/cloud-status.css
git commit -m "feat(status): focus cloud monitoring on outages"
```

---

### Task 4: Integrate, Verify, and Review

**Files:**

- Verify: all files changed in Tasks 1-3
- Modify only if a gate exposes a scoped regression.

**Interfaces:**

- Consumes: completed operational toast lane, source metadata, and outage-only Status workspace.
- Produces: verified branch tip ready for user-directed publication; this task does not push.

- [ ] **Step 1: Run formatting on the exact changed files**

```bash
npx prettier --write \
  src/renderer/src/components/Toast.tsx \
  src/renderer/src/components/__tests__/Toast.test.tsx \
  src/renderer/src/hooks/useAppCloudStatus.ts \
  src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts \
  src/renderer/src/components/DynatraceProblemNotificationManager.tsx \
  src/renderer/src/components/__tests__/DynatraceProblemNotificationManager.test.tsx \
  src/renderer/src/tabs/CloudStatusTab.tsx \
  src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx \
  src/renderer/src/tabs/cloud-status.css
```

Expected: command exits 0. Re-run focused tests if Prettier changes any TypeScript or TSX file.

- [ ] **Step 2: Run complete verification gates**

Run separately so failures are attributable:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
```

Expected: every command exits 0. If a formatter, lint fix, or hook rewrites a file, re-run the focused four-file Vitest command and the affected gate.

- [ ] **Step 3: Inspect the live Status workspace when local runtime is available**

Run `npm run dev`, open the Status route, and verify:

- Zero-outage state shows compact monitored-provider coverage and no filters/search.
- Active-outage fixtures show coverage beside the newest-first outage queue.
- Narrow-window layout stacks without clipped source actions or horizontal scrolling.
- Refresh, provider status links, outage source links, focus states, and reduced-motion behavior remain usable.
- Dynatrace toast appears before a queued cloud outage and the cloud toast appears afterward.

If local credentials or fixtures prevent an authenticated check, record the exact limitation and rely on the automated evidence rather than claiming the flow was visually exercised.

- [ ] **Step 4: Request one independent final diff review**

Give one reviewer the approved spec, current diff, and fresh test/gate results. Ask only for correctness, regression, accessibility, and requirement-coverage findings; the reviewer should not rerun fresh tests. Resolve any validated finding with a new failing regression test, minimal fix, and focused re-run.

- [ ] **Step 5: Commit any review-driven fixes and verify repository state**

If review produces changes:

```bash
git add \
  src/renderer/src/components/Toast.tsx \
  src/renderer/src/components/__tests__/Toast.test.tsx \
  src/renderer/src/hooks/useAppCloudStatus.ts \
  src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts \
  src/renderer/src/components/DynatraceProblemNotificationManager.tsx \
  src/renderer/src/components/__tests__/DynatraceProblemNotificationManager.test.tsx \
  src/renderer/src/tabs/CloudStatusTab.tsx \
  src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx \
  src/renderer/src/tabs/cloud-status.css
git commit -m "fix(status): address outage notification review"
```

Then verify:

```bash
git status --short --branch
git log -5 --oneline --decorate
```

Expected: only the pre-existing untracked `output/` directory remains, and the local `test` branch contains the design, plan, and implementation commits. Do not push until the user requests publication.
