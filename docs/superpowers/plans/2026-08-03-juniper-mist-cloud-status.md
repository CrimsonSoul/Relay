# Juniper Mist Regional Cloud Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four independently rendered Juniper Mist regional providers to Relay Cloud Status, with accurate incident routing, existing alert semantics, Relay Web parity, and compatibility-safe shared persistence.

**Architecture:** The server polls Mist's public SorryApp API once per Cloud Status cycle, maps active notices to Global, EMEA, APAC, and Federal provider buckets, and combines those buckets with the existing ten providers in memory. The existing `cloud_status_snapshot` record remains a ten-provider legacy contract; a new `cloud_status_mist_snapshot` singleton carries only Mist data, and updated clients merge both partitions before rendering or alerting.

**Tech Stack:** TypeScript, Electron, React 19, PocketBase 0.27, Zod 4, Vitest, Testing Library, Playwright, existing Relay Cloud Status and toast infrastructure.

## Global Constraints

- Mist provider keys are exactly `mist_global`, `mist_emea`, `mist_apac`, and `mist_federal`.
- Display labels are exactly `Juniper Mist Global`, `Juniper Mist EMEA`, `Juniper Mist APAC`, and `Juniper Mist Federal`.
- Insert all four Mist providers immediately after Cloudflare in the provider display order.
- The only Mist source and external destination is `https://status.mist.com/`; do not add credentials, social links, or a Downdetector link.
- Poll active unplanned notices, notice details, and component state server-side with the existing ten-second timeout and no-store policy.
- Treat `investigating` and `identified` as outages, active `recovering` as degradation, and exclude planned, resolved, false-alarm, operational, and maintenance records.
- Route notices by component metadata; when metadata or one detail response is unavailable, assign that notice to all four Mist regions.
- Keep `cloud_status_snapshot` an exact ten-provider legacy payload. Persist Mist only in `cloud_status_mist_snapshot` so old clients never receive unknown providers.
- Updated clients must show all four Mist regions as `Unknown` and suppress Mist alerts when connected to an older server without the Mist collection or singleton.
- Preserve silent startup baselines, outage deduplication, two-observation degradation confirmation, reopened-incident behavior, batching, and Dynatrace-first toast priority.
- Preserve unknown PocketBase collections and all unrelated worktree changes.
- Do not run development builds, migrations, or destructive tests against live Relay data; Electron/Web integration tests must use their disposable fixtures.

---

### Task 1: Define provider contracts and partition helpers

**Files:**
- Create: `src/shared/cloudStatus.ts`
- Create: `src/shared/cloudStatus.test.ts`
- Modify: `src/shared/ipc.ts:191-221`
- Modify: `src/shared/ipc.ts:304-390`
- Modify: `src/shared/webApi.ts:352-444`
- Modify: `src/shared/webApi.test.ts:105-128`
- Modify: `src/shared/downdetectorLinks.test.ts`
- Modify: `src/main/handlers/cloudStatus/fetchCloudStatus.ts:1-32`

**Interfaces:**
- Produces `LegacyCloudStatusProvider`, `MistCloudStatusProvider`, `CloudStatusProvider`, `CloudStatusPartition<P>`, `LegacyCloudStatusData`, `MistCloudStatusData`, `CloudStatusData`, `LegacyCloudStatusSnapshotRecord`, and `MistCloudStatusSnapshotRecord` from `@shared/ipc`.
- Produces `emptyLegacyCloudStatusProviders()`, `emptyMistCloudStatusProviders()`, `emptyCloudStatusProviders()`, `splitCloudStatusData()`, `mergeCloudStatusData()`, and `unavailableMistCloudStatusData()` from `@shared/cloudStatus`.
- Later tasks consume the exact provider-order constants and partition helpers rather than reconstructing provider maps locally.

- [ ] **Step 1: Write failing partition and schema tests**

Add tests that require exact partition membership, merge behavior, unavailable coverage, and a complete 14-provider Web payload:

```ts
import {
  emptyLegacyCloudStatusProviders,
  emptyMistCloudStatusProviders,
  mergeCloudStatusData,
  splitCloudStatusData,
  unavailableMistCloudStatusData,
} from './cloudStatus';

it('keeps Mist outside the legacy snapshot partition', () => {
  const legacy = emptyLegacyCloudStatusProviders();
  const mist = emptyMistCloudStatusProviders();
  expect(Object.keys(legacy)).toEqual([
    'aws',
    'azure',
    'm365',
    'jira',
    'github',
    'cloudflare',
    'google',
    'anthropic',
    'openai',
    'salesforce',
  ]);
  expect(Object.keys(mist)).toEqual([
    'mist_global',
    'mist_emea',
    'mist_apac',
    'mist_federal',
  ]);
});

it('marks every Mist region unavailable without inventing incidents', () => {
  const unavailable = unavailableMistCloudStatusData(123);
  expect(unavailable.lastUpdated).toBe(123);
  expect(unavailable.errors.map(({ provider }) => provider)).toEqual([
    'mist_global',
    'mist_emea',
    'mist_apac',
    'mist_federal',
  ]);
  expect(Object.values(unavailable.providers).flat()).toEqual([]);
});

it('round-trips combined cloud status through legacy and Mist partitions', () => {
  const combined = mergeCloudStatusData(
    { providers: emptyLegacyCloudStatusProviders(), errors: [], lastUpdated: 10 },
    { providers: emptyMistCloudStatusProviders(), errors: [], lastUpdated: 20 },
  );
  expect(splitCloudStatusData(combined)).toEqual({
    legacy: expect.objectContaining({ lastUpdated: 20 }),
    mist: expect.objectContaining({ lastUpdated: 20 }),
  });
});
```

Update the Web schema test's provider fixture to contain all 14 exact keys and add assertions that omitting `mist_global` or adding an unknown key fails. Update the Downdetector contract so it explicitly expects all ten legacy providers to have slugs and all four Mist providers to omit them.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm run test:unit -- src/shared/cloudStatus.test.ts src/shared/webApi.test.ts src/shared/downdetectorLinks.test.ts
```

Expected: FAIL because the Mist types, provider keys, helpers, and Web schema entries do not exist.

- [ ] **Step 3: Add exact shared types and provider metadata**

Refactor the Cloud Status declarations in `src/shared/ipc.ts` around readonly provider arrays:

```ts
export const LEGACY_CLOUD_STATUS_PROVIDER_ORDER = [
  'aws',
  'azure',
  'm365',
  'jira',
  'github',
  'cloudflare',
  'google',
  'anthropic',
  'openai',
  'salesforce',
] as const;

export const MIST_CLOUD_STATUS_PROVIDER_ORDER = [
  'mist_global',
  'mist_emea',
  'mist_apac',
  'mist_federal',
] as const;

export const CLOUD_STATUS_PROVIDER_ORDER = [
  'aws',
  'azure',
  'm365',
  'jira',
  'github',
  'cloudflare',
  ...MIST_CLOUD_STATUS_PROVIDER_ORDER,
  'google',
  'anthropic',
  'openai',
  'salesforce',
] as const;

export type LegacyCloudStatusProvider = (typeof LEGACY_CLOUD_STATUS_PROVIDER_ORDER)[number];
export type MistCloudStatusProvider = (typeof MIST_CLOUD_STATUS_PROVIDER_ORDER)[number];
export type CloudStatusProvider = (typeof CLOUD_STATUS_PROVIDER_ORDER)[number];

export type CloudStatusPartition<P extends CloudStatusProvider> = {
  providers: Record<P, CloudStatusItem[]>;
  lastUpdated: number;
  errors: { provider: P; message: string }[];
};

export type LegacyCloudStatusData = CloudStatusPartition<LegacyCloudStatusProvider>;
export type MistCloudStatusData = CloudStatusPartition<MistCloudStatusProvider>;
export type CloudStatusData = CloudStatusPartition<CloudStatusProvider>;
```

Define explicit legacy and Mist snapshot record aliases with the existing singleton metadata. Add the four Mist entries to `CLOUD_STATUS_PROVIDERS` with the exact labels and `statusUrl`, leaving `twitterHandle` and `downdetectorSlug` undefined.

- [ ] **Step 4: Implement partition helpers and exhaustive Web schemas**

In `src/shared/cloudStatus.ts`, construct provider maps from explicit object literals so a new provider produces a compile failure until assigned to a partition. `splitCloudStatusData()` must set both partition timestamps to the combined timestamp. `mergeCloudStatusData()` must take the maximum partition timestamp, concatenate errors, and merge only known buckets. `unavailableMistCloudStatusData()` must return four empty buckets and one bounded error per region with message `Juniper Mist status is unavailable from this Relay server.`

Use these exact signatures:

```ts
export function emptyLegacyCloudStatusProviders(): LegacyCloudStatusData['providers'];
export function emptyMistCloudStatusProviders(): MistCloudStatusData['providers'];
export function emptyCloudStatusProviders(): CloudStatusData['providers'];
export function splitCloudStatusData(data: CloudStatusData): {
  legacy: LegacyCloudStatusData;
  mist: MistCloudStatusData;
};
export function mergeCloudStatusData(
  legacy: LegacyCloudStatusData,
  mist: MistCloudStatusData,
): CloudStatusData;
export function unavailableMistCloudStatusData(lastUpdated?: number): MistCloudStatusData;
```

Update `WebCloudStatusDataSchema` to accept all 14 exact keys and extend its provider enum with the four Mist keys. Replace `emptyCloudStatusProviders()` in `fetchCloudStatus.ts` with a re-export/import from `@shared/cloudStatus` so existing callers keep one exhaustive source of truth.

- [ ] **Step 5: Run focused tests and typecheck to verify GREEN**

Run:

```bash
npm run test:unit -- src/shared/cloudStatus.test.ts src/shared/webApi.test.ts src/shared/downdetectorLinks.test.ts
npm run typecheck
```

Expected: all focused tests PASS and TypeScript reports no incomplete provider records.

- [ ] **Step 6: Commit the shared contract**

```bash
git add src/shared/cloudStatus.ts src/shared/cloudStatus.test.ts src/shared/ipc.ts src/shared/webApi.ts src/shared/webApi.test.ts src/shared/downdetectorLinks.test.ts src/main/handlers/cloudStatus/fetchCloudStatus.ts
git commit -m "feat(cloud-status): define Mist regional providers"
```

---

### Task 2: Build the Mist SorryApp adapter

**Files:**
- Create: `src/main/handlers/cloudStatus/mistProvider.ts`
- Create: `src/main/handlers/cloudStatus/mistProvider.test.ts`
- Modify: `src/main/handlers/cloudStatus/types.ts`

**Interfaces:**
- Consumes `MistCloudStatusProvider`, `MistCloudStatusData`, `CloudStatusItem`, and `CloudStatusSeverity` from `@shared/ipc`.
- Produces `MIST_STATUS_URL`, `MIST_NOTICES_URL`, `MIST_COMPONENTS_URL`, `MistProviderFetchResult`, `mistNoticeStateToSeverity()`, and `fetchMistProviderGroup(now?: () => number): Promise<MistProviderFetchResult>`.
- `MistProviderFetchResult` is `{ providers: MistCloudStatusData['providers']; errors: MistCloudStatusData['errors'] }`.

- [ ] **Step 1: Write failing adapter tests with real response shapes**

Use `vi.stubGlobal('fetch', vi.fn())` and URL-based responses. Cover one component, two components, missing component metadata, recovering state, latest update selection, and component-only degradation:

Define local fixture helpers before the tests:

```ts
const component = (
  id: number,
  name: string,
  state: 'operational' | 'degraded' | 'under_maintenance',
) => ({ id, name, state, updated_at: '2026-08-03T10:00:00.000Z' });

const update = (state: string, content: string, created_at: string) => ({
  state,
  content,
  created_at,
});

const notice = (overrides: Partial<SorryAppNoticeSummary> = {}): SorryAppNoticeSummary => ({
  id: 42,
  type: 'unplanned',
  state: 'investigating',
  timeline_state: 'present',
  subject: 'Mist incident',
  url: 'https://status.mist.com/notices/test-incident',
  began_at: '2026-08-03T10:00:00.000Z',
  latest_update: null,
  ...overrides,
});

const detail = (overrides: Partial<SorryAppNoticeDetail> = {}): SorryAppNoticeDetail => ({
  ...notice(),
  components: [],
  updates: [],
  ...overrides,
});

function mockMistApi(input: {
  notices: SorryAppNoticeSummary[];
  components: SorryAppComponent[];
  details: Record<number, SorryAppNoticeDetail>;
}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (value: string | URL | Request) => {
      const url = String(value);
      if (url === MIST_NOTICES_URL) return jsonResponse({ notices: input.notices });
      if (url === MIST_COMPONENTS_URL) return jsonResponse({ components: input.components });
      const id = Number(url.split('/').at(-1));
      return jsonResponse({ notice: input.details[id] });
    }),
  );
}
```

`jsonResponse()` returns `{ ok: true, status: 200, json: async () => body }` and is declared in the test file so the fetch stub matches the existing provider-test style.

```ts
it('routes one active notice to every affected Mist region', async () => {
  mockMistApi({
    notices: [notice({ id: 42, state: 'investigating' })],
    components: [component(24585, 'MIST GLOBAL CLOUD', 'degraded')],
    details: {
      42: detail({
        components: [
          component(24585, 'MIST GLOBAL CLOUD', 'degraded'),
          component(84051, 'MIST APAC CLOUD', 'degraded'),
        ],
        updates: [
          update('investigating', 'Initial update', '2026-08-03T10:00:00.000Z'),
          update('identified', 'Latest update', '2026-08-03T10:05:00.000Z'),
        ],
      }),
    },
  });

  const result = await fetchMistProviderGroup(() => Date.parse('2026-08-03T10:06:00.000Z'));
  expect(result.providers.mist_global[0]).toMatchObject({
    id: '42',
    provider: 'mist_global',
    description: 'Latest update',
    pubDate: '2026-08-03T10:05:00.000Z',
    severity: 'error',
  });
  expect(result.providers.mist_apac[0]).toMatchObject({ id: '42', provider: 'mist_apac' });
  expect(result.providers.mist_emea).toEqual([]);
});

it('assigns an unscoped incident to all four regions', async () => {
  mockMistApi({ notices: [notice({ id: 43 })], components: [], details: { 43: detail({ components: [] }) } });
  const result = await fetchMistProviderGroup();
  for (const provider of MIST_CLOUD_STATUS_PROVIDER_ORDER) {
    expect(result.providers[provider]).toEqual([expect.objectContaining({ id: '43', provider })]);
  }
});

it('creates one stable warning for an unexplained degraded component', async () => {
  mockMistApi({
    notices: [],
    components: [component(24592, 'MIST EMEA CLOUD', 'degraded')],
    details: {},
  });
  const result = await fetchMistProviderGroup(() => Date.parse('2026-08-03T10:06:00.000Z'));
  expect(result.providers.mist_emea).toEqual([
    expect.objectContaining({
      id: 'mist-component-24592',
      provider: 'mist_emea',
      severity: 'warning',
      pubDate: '2026-08-03T10:06:00.000Z',
    }),
  ]);
});
```

Add tests that planned/resolved/false-alarm notices and `operational`/`under_maintenance` components produce no items; a component fetch failure returns valid incidents plus four coverage errors; a failed detail request assigns the summary notice to every region; and a structurally invalid notices response rejects the entire adapter call.

- [ ] **Step 2: Run the adapter test and verify RED**

Run:

```bash
npm run test:unit -- src/main/handlers/cloudStatus/mistProvider.test.ts
```

Expected: FAIL because `mistProvider.ts` and its exports do not exist.

- [ ] **Step 3: Define bounded SorryApp types and validation helpers**

Add the response interfaces to `types.ts`: `SorryAppNoticeSummary`, `SorryAppNoticeDetail`, `SorryAppNoticeUpdate`, and `SorryAppComponent`. In `mistProvider.ts`, validate that top-level `notices` and `components` values are arrays and that required IDs, names, states, subjects, URLs, and timestamps are bounded primitive values before mapping. Ignore a malformed individual notice/component; throw `Invalid Mist notices response` or `Invalid Mist components response` for a malformed top-level object.

Use these exact endpoint constants:

```ts
export const MIST_STATUS_URL = 'https://status.mist.com/';
export const MIST_NOTICES_URL =
  'https://status.mist.com/api/v1/notices?filter%5Btimeline_state_eq%5D=present&filter%5Btype_eq%5D=unplanned';
export const MIST_COMPONENTS_URL = 'https://status.mist.com/api/v1/components';
```

- [ ] **Step 4: Implement notice routing and failure fallbacks**

Map component IDs first and canonical names second:

```ts
const MIST_COMPONENT_PROVIDER = new Map<number | string, MistCloudStatusProvider>([
  [24585, 'mist_global'],
  [24592, 'mist_emea'],
  [84051, 'mist_apac'],
  [84052, 'mist_federal'],
]);

const MIST_COMPONENT_NAME_PROVIDER: Record<string, MistCloudStatusProvider> = {
  'MIST GLOBAL CLOUD': 'mist_global',
  'MIST EMEA CLOUD': 'mist_emea',
  'MIST APAC CLOUD': 'mist_apac',
  'MIST FEDERAL CLOUD': 'mist_federal',
};
```

Fetch notices and components with `Promise.allSettled`; reject when notices fail, but continue with incident detail when components fail. Fetch all detail endpoints concurrently with `Promise.allSettled`. Select the newest valid update by `created_at`, use its content and timestamp, and fall back to summary `latest_update`, then `began_at`. Use the official notice URL only when its hostname is exactly `status.mist.com`; otherwise use `MIST_STATUS_URL`.

Prevent duplicate component warnings by tracking every provider already assigned an active notice. Component warnings use stable IDs and the injected `now()` timestamp so a long-running degradation remains inside Relay's seven-day current-issue window without changing identity.

- [ ] **Step 5: Run adapter tests and verify GREEN**

Run:

```bash
npm run test:unit -- src/main/handlers/cloudStatus/mistProvider.test.ts
npm run typecheck
```

Expected: all adapter cases PASS with no unsafe casts or missing provider branches.

- [ ] **Step 6: Commit the adapter**

```bash
git add src/main/handlers/cloudStatus/mistProvider.ts src/main/handlers/cloudStatus/mistProvider.test.ts src/main/handlers/cloudStatus/types.ts
git commit -m "feat(cloud-status): fetch Juniper Mist incidents"
```

---

### Task 3: Integrate one Mist request group into Cloud Status aggregation

**Files:**
- Modify: `src/main/handlers/cloudStatus/fetchCloudStatus.ts`
- Create: `src/main/handlers/cloudStatus/fetchCloudStatus.test.ts`
- Modify: `src/main/handlers/cloudStatusHandlers.test.ts`

**Interfaces:**
- Consumes `fetchMistProviderGroup()` from Task 2 and the partition helpers from Task 1.
- Preserves `fetchCloudStatusData(previous?: CloudStatusData | null): Promise<CloudStatusData>` for existing IPC, service, manager, and Web callers.
- Produces one combined 14-provider in-memory result while retaining previous buckets independently on provider or Mist-group failure.

- [ ] **Step 1: Add failing aggregation tests**

Extend `cloudStatusHandlers.test.ts` with URL-specific Mist fixtures and assertions:

Add a local `installAllProviderResponses()` helper that returns empty valid RSS, Statuspage, Google, and Salesforce responses for existing providers, and uses its `mistNotices` and `mistComponents` inputs for the two Mist endpoints. Store the installed `vi.fn()` as `fetchMock` so call counts are asserted against the same stub.

```ts
it('fetches the Mist API once and returns four regional buckets', async () => {
  installAllProviderResponses({
    mistNotices: [],
    mistComponents: [
      component(24585, 'MIST GLOBAL CLOUD', 'operational'),
      component(24592, 'MIST EMEA CLOUD', 'degraded'),
      component(84051, 'MIST APAC CLOUD', 'operational'),
      component(84052, 'MIST FEDERAL CLOUD', 'operational'),
    ],
  });

  const result = (await handler()) as CloudStatusData;
  expect(result.providers.mist_emea).toEqual([
    expect.objectContaining({ provider: 'mist_emea', severity: 'warning' }),
  ]);
  expect(fetchMock.mock.calls.filter(([url]) => String(url) === MIST_COMPONENTS_URL)).toHaveLength(1);
  expect(fetchMock.mock.calls.filter(([url]) => String(url) === MIST_NOTICES_URL)).toHaveLength(1);
});
```

In `fetchCloudStatus.test.ts`, call `fetchCloudStatusData(previous)` with URL-specific fetch responses. Require a failed Mist group to retain only the previous Mist buckets, record errors for all four Mist providers, and still refresh legacy providers. Add a case that partial component errors from `fetchMistProviderGroup()` are appended without discarding valid Mist incidents.

- [ ] **Step 2: Run focused aggregation tests and verify RED**

Run:

```bash
npm run test:unit -- src/main/handlers/cloudStatus/fetchCloudStatus.test.ts src/main/handlers/cloudStatusHandlers.test.ts
```

Expected: FAIL because `fetchCloudStatusData()` does not call or distribute the Mist group.

- [ ] **Step 3: Implement the combined fan-out**

Keep legacy fetches per provider and call `fetchMistProviderGroup()` exactly once outside that loop. Build the next provider map from `previous?.providers ?? emptyCloudStatusProviders()`. On Mist success, replace all four Mist buckets and append its partial errors. On Mist failure, retain all four previous Mist buckets and append one truncated error per Mist provider. Continue logging through `loggers.cloudStatus` with `ErrorCategory.NETWORK`.

The final result remains:

```ts
return {
  providers,
  errors,
  lastUpdated: Date.now(),
};
```

Do not make four calls through the generic `fetchProvider()` switch and do not let Mist failure reject the entire legacy refresh.

- [ ] **Step 4: Run aggregation tests and verify GREEN**

Run:

```bash
npm run test:unit -- src/main/handlers/cloudStatus/fetchCloudStatus.test.ts src/main/handlers/cloudStatusHandlers.test.ts
npm run typecheck
```

Expected: combined data contains all 14 buckets, all existing provider tests still pass, and Mist endpoints are each called once per uncached refresh.

- [ ] **Step 5: Commit aggregation**

```bash
git add src/main/handlers/cloudStatus/fetchCloudStatus.ts src/main/handlers/cloudStatus/fetchCloudStatus.test.ts src/main/handlers/cloudStatusHandlers.test.ts
git commit -m "feat(cloud-status): aggregate Mist regional status"
```

---

### Task 4: Persist Mist separately without changing the legacy snapshot

**Files:**
- Create: `src/main/handlers/cloudStatus/CloudStatusSnapshotStore.ts`
- Create: `src/main/handlers/cloudStatus/CloudStatusSnapshotStore.test.ts`
- Modify: `src/main/handlers/cloudStatus/CloudStatusManager.ts`
- Modify: `src/main/handlers/cloudStatus/CloudStatusManager.test.ts`
- Modify: `src/main/pocketbase/schema/collectionCatalog.ts`
- Modify: `src/main/pocketbase/__tests__/CollectionBootstrap.test.ts`
- Modify: `src/main/handlers/cacheHandlers.ts`
- Modify: `src/main/handlers/cacheHandlers.test.ts`

**Interfaces:**
- Produces `LEGACY_CLOUD_STATUS_COLLECTION = 'cloud_status_snapshot'` and `MIST_CLOUD_STATUS_COLLECTION = 'cloud_status_mist_snapshot'`.
- Produces `CloudStatusSnapshotStore<P>` with `hydrate(fallback): Promise<CloudStatusPartition<P>>` and `persist(data, force): Promise<void>`.
- `CloudStatusManager.getSnapshot()` continues returning combined `CloudStatusData`; collection records remain partition-specific.

- [ ] **Step 1: Write failing snapshot-store and manager tests**

Create store tests that use a PocketBase mock keyed by collection name:

```ts
it('writes Mist only to the Mist singleton collection', async () => {
  const store = new CloudStatusSnapshotStore(
    () => pb,
    MIST_CLOUD_STATUS_COLLECTION,
    emptyMistCloudStatusProviders,
  );
  await store.persist(
    {
      providers: emptyMistCloudStatusProviders(),
      errors: [],
      lastUpdated: 100,
    },
    false,
  );
  expect(collection).toHaveBeenCalledWith('cloud_status_mist_snapshot');
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ key: 'current', providers: emptyMistCloudStatusProviders() }),
    { requestKey: null },
  );
});
```

Update manager tests so one refresh creates/updates two records, the legacy payload has exactly ten keys, the Mist payload has exactly four keys, unchanged healthy partitions do not rewrite, and unchanged degraded Mist partitions do rewrite so clients can confirm consecutive observations.

Add CollectionBootstrap expectations for an authenticated-read/server-owned `cloud_status_mist_snapshot` collection with the same five fields and a unique `key` index. Add cache-handler tests proving read/snapshot caching accepts `cloud_status_mist_snapshot` while offline mutation enqueueing still rejects it.

- [ ] **Step 2: Run persistence tests and verify RED**

Run:

```bash
npm run test:unit -- src/main/handlers/cloudStatus/CloudStatusSnapshotStore.test.ts src/main/handlers/cloudStatus/CloudStatusManager.test.ts src/main/pocketbase/__tests__/CollectionBootstrap.test.ts src/main/handlers/cacheHandlers.test.ts
```

Expected: FAIL because the Mist collection, store, split persistence, and cache allowlist do not exist.

- [ ] **Step 3: Implement the generic singleton snapshot store**

Move record ID, content hash, hydration, create/update, and unchanged-write suppression out of `CloudStatusManager` into `CloudStatusSnapshotStore<P>`. Hash only `{ providers, errors }`; ignore `lastUpdated` so healthy unchanged polls do not write. `persist(data, true)` must still update an existing unchanged record to advance `lastUpdated` during warnings/errors.

Keep the state private to each collection instance:

```ts
export class CloudStatusSnapshotStore<P extends CloudStatusProvider> {
  private recordId: string | null = null;
  private contentHash = '';
  private hydrated = false;

  constructor(
    private readonly getPocketBase: () => PocketBase | null,
    private readonly collectionName: string,
    private readonly emptyProviders: () => Record<P, CloudStatusItem[]>,
  ) {}

  hydrate(): Promise<CloudStatusPartition<P>>;
  persist(data: CloudStatusPartition<P>, force: boolean): Promise<void>;
}
```

The store must tolerate a missing collection or singleton during hydration by returning its supplied empty fallback. Persistence errors continue to reject so `CloudStatusManager` can log one refresh failure rather than claim publication succeeded.

- [ ] **Step 4: Split manager hydration and persistence**

Construct one store per collection. On first refresh, hydrate both partitions and merge them before passing prior state to `fetchCloudStatusData()`. After a fetch, split the combined result and persist both partitions concurrently:

```ts
const { legacy, mist } = splitCloudStatusData(next);
await Promise.all([
  this.legacyStore.persist(legacy, isDegraded(legacy)),
  this.mistStore.persist(mist, isDegraded(mist)),
]);
this.snapshot = next;
```

Keep the existing five-minute healthy cadence, one-minute degraded/error cadence, overlapping-refresh coalescing, and complete combined in-memory snapshot.

- [ ] **Step 5: Add the collection and desktop-cache boundary**

Add `CLOUD_STATUS_MIST_SNAPSHOT_KEY_INDEX` and a second server-owned collection definition with the same field shape. Add only the new collection name to `VALID_COLLECTIONS` in `cacheHandlers.ts`; do not add it to `OFFLINE_WRITABLE_COLLECTIONS` or user import/export collections. PocketBase native backup/restore already captures the entire database, so no manual backup file list is needed.

The catalog entry must remain server-owned:

```ts
{
  name: MIST_CLOUD_STATUS_COLLECTION,
  type: 'base',
  fields: [
    { type: 'text', name: 'key', required: true },
    { type: 'json', name: 'providers', required: true },
    { type: 'json', name: 'errors', required: false },
    { type: 'number', name: 'lastUpdated', required: true },
    { type: 'text', name: 'contentHash', required: true },
  ],
  indexes: [CLOUD_STATUS_MIST_SNAPSHOT_KEY_INDEX],
  rules: SERVER_OWNED_RULES,
}
```

- [ ] **Step 6: Run persistence tests and verify GREEN**

Run:

```bash
npm run test:unit -- src/main/handlers/cloudStatus/CloudStatusSnapshotStore.test.ts src/main/handlers/cloudStatus/CloudStatusManager.test.ts src/main/pocketbase/__tests__/CollectionBootstrap.test.ts src/main/handlers/cacheHandlers.test.ts
npm run typecheck
```

Expected: both singleton collections are covered, legacy payload shape remains unchanged, and the new collection is read-only to clients.

- [ ] **Step 7: Commit persistence compatibility**

```bash
git add src/main/handlers/cloudStatus/CloudStatusSnapshotStore.ts src/main/handlers/cloudStatus/CloudStatusSnapshotStore.test.ts src/main/handlers/cloudStatus/CloudStatusManager.ts src/main/handlers/cloudStatus/CloudStatusManager.test.ts src/main/pocketbase/schema/collectionCatalog.ts src/main/pocketbase/__tests__/CollectionBootstrap.test.ts src/main/handlers/cacheHandlers.ts src/main/handlers/cacheHandlers.test.ts
git commit -m "feat(cloud-status): isolate Mist shared snapshots"
```

---

### Task 5: Merge both snapshots before rendering and alerting

**Files:**
- Modify: `src/renderer/src/hooks/useAppCloudStatus.ts`
- Modify: `src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts`
- Modify: `src/renderer/src/stores/__tests__/collectionStore.realtime.test.ts`

**Interfaces:**
- Consumes `LegacyCloudStatusSnapshotRecord`, `MistCloudStatusSnapshotRecord`, `mergeCloudStatusData()`, and `unavailableMistCloudStatusData()`.
- Preserves `useAppCloudStatus(showToast, onOpenProvider?)` and its returned `{ statusData, loading, refetch }` interface.
- Produces one complete `CloudStatusData` before invoking the existing baseline/deduplication/degradation notification state machine.

- [ ] **Step 1: Split the hook fixture and write failing merge tests**

Change the `useCollection` mock to return state by collection name:

```ts
function snapshotState<T>() {
  return {
    data: [] as T[],
    loading: false,
    error: null as string | null,
    hasLoadedSnapshot: false,
  };
}

const collectionStates = {
  cloud_status_snapshot: snapshotState<LegacyCloudStatusSnapshotRecord>(),
  cloud_status_mist_snapshot: snapshotState<MistCloudStatusSnapshotRecord>(),
};

vi.mock('../useCollection', () => ({
  useCollection: (name: keyof typeof collectionStates, options: unknown) => {
    mockUseCollection(name, options);
    return { ...collectionStates[name], refetch: vi.fn() };
  },
}));
```

Replace the old all-provider test fixtures with `legacyStatus(items = [])`, `mistStatus(items = [])`, `legacySnapshot(data)`, and `mistSnapshot(data)`. Each status helper starts from the corresponding Task 1 empty-provider function and assigns items by `item.provider`; each snapshot helper adds `id`, `key: 'current'`, `contentHash`, `created`, and `updated`. Define `mistItem()` like the existing `item()` helper but default it to provider `mist_global`, title `Mist login outage`, and link `https://status.mist.com/notices/test-incident`.

Add these behaviors:

```ts
it('waits for both snapshot partitions before establishing the baseline', async () => {
  legacyState.data = [legacySnapshot(legacyStatus())];
  mistState.loading = true;
  const { result, rerender } = renderHook(() => useAppCloudStatus(showToast));
  expect(result.current.statusData).toBeNull();

  mistState.loading = false;
  mistState.hasLoadedSnapshot = true;
  mistState.data = [mistSnapshot(mistStatus([mistItem()]))];
  rerender();
  await waitFor(() => expect(result.current.statusData?.providers.mist_global).toHaveLength(1));
  expect(showToast).not.toHaveBeenCalled();
});

it('marks Mist unknown without alerts when an older server lacks the collection', async () => {
  legacyState.data = [legacySnapshot(legacyStatus())];
  mistState.loading = false;
  mistState.error = 'Missing collection';
  mistState.hasLoadedSnapshot = false;
  const { result } = renderHook(() => useAppCloudStatus(showToast));
  await waitFor(() => expect(result.current.statusData?.errors).toHaveLength(4));
  expect(showToast).not.toHaveBeenCalled();
});
```

Add tests for a new multi-region outage producing exactly one `(+1 more)` toast, an alert action selecting the first Mist provider, a cached pre-Mist snapshot normalizing to four unknown regions, Mist feed errors retaining active IDs, and manual refresh accepting a complete 14-provider result.

- [ ] **Step 2: Run the hook tests and verify RED**

Run:

```bash
npm run test:renderer -- src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts
```

Expected: FAIL because the hook subscribes only to the legacy collection and treats missing Mist data as healthy/missing.

- [ ] **Step 3: Subscribe to both partitions with a readiness gate**

Create one `useCollection` call per singleton. Do not commit or process a realtime snapshot until the legacy partition has a record and the Mist partition has either a record or has finished with a missing/error state. A completed missing/error Mist state merges `unavailableMistCloudStatusData(legacy.lastUpdated)`.

Use separate typed records and derive readiness explicitly:

```ts
const legacySnapshot = useCollection<LegacyCloudStatusSnapshotRecord>(
  'cloud_status_snapshot',
  { filter: 'key="current"' },
);
const mistSnapshot = useCollection<MistCloudStatusSnapshotRecord>(
  'cloud_status_mist_snapshot',
  { filter: 'key="current"' },
);

const legacyRecord = legacySnapshot.data[0];
const mistRecord = mistSnapshot.data[0];
const mistResolved =
  Boolean(mistRecord) ||
  (!mistSnapshot.loading &&
    (mistSnapshot.hasLoadedSnapshot || Boolean(mistSnapshot.error)));
```

Preserve cached data while either live partition is still loading. Normalize old secure-storage cache entries by keeping known legacy buckets, adding empty Mist buckets, and adding unavailable errors. This ensures cache restoration cannot falsely label an unsupported Mist feed operational.

- [ ] **Step 4: Feed only merged data through existing notification logic**

Keep `processNewEvents()` unchanged except for accepting the expanded provider order. Its existing `provider:id` outage key intentionally treats a multi-region notice as multiple regional items; its batching already emits one toast with `(+N more)`. Continue retaining outage IDs for providers whose feed is unavailable and continue using the existing active-provider degradation state.

Build the live value only after the readiness gate:

```ts
const mistData = mistRecord
  ? toMistStatusData(mistRecord)
  : unavailableMistCloudStatusData(legacyRecord.lastUpdated);
const combined = mergeCloudStatusData(toLegacyStatusData(legacyRecord), mistData);
commitStatus(combined);
```

Set `loading` to true while no cached combined snapshot exists and either required live partition is unresolved. The manual refresh path continues calling `api.getCloudStatus()` and committing its complete combined result.

When the live Mist partition has resolved as unsupported or missing, replace the Mist portion of a manual Electron refresh with `unavailableMistCloudStatusData()` before calling `commitStatus()`. This prevents a new client connected to an older server from treating the local main process's empty fallback snapshot as healthy Mist coverage. Once a real Mist singleton arrives, manual refreshes may commit the complete returned 14-provider result.

- [ ] **Step 5: Verify renderer merge and collection fallback**

Run:

```bash
npm run test:renderer -- src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts src/renderer/src/stores/__tests__/collectionStore.realtime.test.ts
npm run typecheck
```

Expected: both subscriptions are present, older-server errors produce Unknown Mist coverage without alerts, and existing AWS/Azure notification cases still pass.

- [ ] **Step 6: Commit client merging**

```bash
git add src/renderer/src/hooks/useAppCloudStatus.ts src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts src/renderer/src/stores/__tests__/collectionStore.realtime.test.ts
git commit -m "feat(cloud-status): merge Mist status for updated clients"
```

---

### Task 6: Add regional presentation, official links, and Relay Web validation

**Files:**
- Modify: `src/renderer/src/components/icons/ProviderIcons.tsx`
- Modify: `src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx`
- Modify: `src/renderer/src/__tests__/App.test.tsx`
- Modify: `src/main/handlers/windowHandlers.test.ts`
- Modify: `src/main/web/routes/operationalRoutes.ts`
- Modify: `src/main/web/routes/operationalRoutes.test.ts`
- Modify: `src/main/web/RelayWebGateway.test.ts`
- Modify: `tests/e2e/critical-path.spec.ts`

**Interfaces:**
- Consumes provider metadata and full Web schema from Task 1 and merged renderer data from Task 5.
- Produces `JuniperNetworksIcon` and maps all four Mist provider keys to it.
- Keeps `CloudStatusTab` generic; no Mist-specific conditional rendering is allowed.
- Validates `/relay-api/v1/operations/cloud-status` responses with `WebCloudStatusDataSchema` before returning them.

- [ ] **Step 1: Write failing UI and Web assertions**

Update Cloud Status test fixtures to use `emptyCloudStatusProviders()` and add:

```tsx
it('renders four separately navigable Mist regions in configured order', async () => {
  render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
  const names = screen.getAllByRole('button', { name: /View .* status details/ });
  expect(names.map((button) => button.getAttribute('aria-label'))).toEqual(
    expect.arrayContaining([
      'View Juniper Mist Global status details',
      'View Juniper Mist EMEA status details',
      'View Juniper Mist APAC status details',
      'View Juniper Mist Federal status details',
    ]),
  );
  expect(screen.getByText('across 14 monitored providers')).toBeInTheDocument();
});

it('offers only the official status action for a Mist region', async () => {
  render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: 'View Juniper Mist Global status details' }));
  await user.click(screen.getByRole('button', { name: 'Open Juniper Mist Global official status page' }));
  expect(api.openExternal).toHaveBeenCalledWith('https://status.mist.com/');
  expect(screen.queryByRole('button', { name: /Juniper Mist Global on (X|Downdetector)/ })).toBeNull();
});
```

Add a window-handler test allowing `https://status.mist.com/notices/example` and rejecting `https://status.mist.com.evil.example/notices/example`. Update operational route/Gateway fixtures to use 14 buckets and assert the cloud-status route rejects an incomplete service payload rather than emitting it. Add an Electron critical-path assertion that all four region buttons are visible and the status summary reports 14 providers.

- [ ] **Step 2: Run UI/Web tests and verify RED**

Run:

```bash
npm run test:renderer -- src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx src/renderer/src/__tests__/App.test.tsx
npm run test:unit -- src/main/handlers/windowHandlers.test.ts src/main/web/routes/operationalRoutes.test.ts src/main/web/RelayWebGateway.test.ts
```

Expected: FAIL because the Mist icon mapping and exact Web response validation are absent and fixtures still contain ten providers.

- [ ] **Step 3: Add the shared Juniper mark and generic provider mapping**

Add `JuniperNetworksIcon` using the 24-by-24 monochrome Simple Icons Juniper Networks path, matching the existing icon component pattern. Map all four Mist keys to the same component in `PROVIDER_ICON_MAP`. Do not add brand colors or region-specific icon variants; provider state remains conveyed by Relay's existing signal and text.

The mapping is exhaustive:

```tsx
export const JuniperNetworksIcon = ({ size = 18 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.0864 13.1643c.0456 0 .0717-.0132.0717-.062 0-.0482-.0254-.0593-.0731-.0593h-.1023v.1213zm-.1037.0417v.1285h-.0445v-.334h.1487c.0846 0 .1172.0347.1172.1006 0 .054-.0229.0912-.0806.102l.0755.1314h-.0484l-.0746-.1285zm.0746-.2918a.2535.2535 0 0 0-.2533.2531c0 .1395.1136.2532.2533.2532a.2535.2535 0 0 0 .253-.2532.2534.2534 0 0 0-.253-.2531zm-.291.2531a.2912.2912 0 0 1 .291-.2908.291.291 0 0 1 .2905.2908.291.291 0 0 1-.2905.2907.2912.2912 0 0 1-.291-.2907zm-20.7445-.6602V8.8304h-.4212v3.6767c0 .8506.0337 1.5332-1.4404 1.5332A4.029 4.029 0 0 1 0 14.0369v.397a6.215 6.215 0 0 0 .1602.0022c1.7858 0 1.8616-.8002 1.8616-1.929zm15.5404-1.6972h3.1334c-.042-.918-.1011-1.7014-1.4404-1.7014-1.2887 0-1.6425.6992-1.693 1.7014zm1.7016-2.0889c1.794 0 1.853 1.2045 1.8447 2.4764h-3.5548c.0085 1.1204.2863 1.9544 1.7436 1.9544.775 0 1.1288-.2107 1.5079-.4886l.2357.3116c-.421.3117-.918.556-1.7436.556-1.8194 0-2.1565-1.053-2.1565-2.4091 0-1.356.3877-2.4007 2.123-2.4007zm-4.1484 2.7055c.7439 0 1.1135-.3625 1.1135-1.0949 0-.7322-.3988-1.0798-1.132-1.0798h-1.7285v2.1747zM15.109 8.839c1.0678 0 1.5519.5307 1.5519 1.474 0 .9497-.478 1.527-1.5578 1.527h-1.7348v1.5981h-.4124V8.839zm-2.9253 0v4.5991h-.4122V8.839zm-1.1939 4.5991h-.4296v-2.8134c0-.8086.0084-1.491-1.474-1.491-1.4743 0-1.4405.6824-1.4405 1.5331v2.7713h-.4212v-2.7713c0-1.1288.076-1.9289 1.8616-1.9289 1.7943 0 1.9037.8001 1.9037 1.8952zM2.7466 8.8304h.4297v2.8134c0 .8088-.0084 1.491 1.474 1.491 1.4742 0 1.4405-.6822 1.4405-1.533V8.8303h.4212v2.7713c0 1.1289-.0759 1.929-1.8616 1.929-1.7943 0-1.9038-.8001-1.9038-1.8952zm18.9675 1.8364v2.7713h.421v-2.7713c0-.8507-.0336-1.533 1.4407-1.533.1579 0 .298.0083.4242.023v-.4012a4.8535 4.8535 0 0 0-.4242-.0177c-1.7859 0-1.8617.8001-1.8617 1.929zm-.4315 4.3602c.1525.096.3017.1286.4542.1286.2624 0 .3789-.0737.3789-.2486 0-.18-.1508-.2057-.3789-.2468-.2743-.048-.4594-.0944-.4594-.3514 0-.2453.1577-.3413.4594-.3413.199 0 .3412.0447.4423.1132l-.072.1097c-.0908-.06-.2263-.0995-.3703-.0995-.228 0-.3257.0636-.3257.2144 0 .1612.132.192.3584.233.2776.0499.4782.091.4782.3635 0 .2521-.1612.3737-.5074.3737-.192 0-.3652-.0393-.5263-.1456zm-.7886-.4423-.2538.2777v.396h-.132v-1.2703h.132v.7012l.643-.7012h.156l-.456.4989.5176.7715h-.1525l-.4543-.6738m-1.1006.0326c.18 0 .2914-.0549.2914-.2555 0-.1971-.108-.2485-.2965-.2485h-.4132v.504zm-.0377.1234h-.3806v.5178h-.132V13.988h.5486c.2948 0 .4286.1183.4286.3703 0 .2194-.1046.348-.3258.377l.3068.523h-.1439l-.3017-.5177m-.924-.1166c0-.3429-.1594-.528-.5058-.528-.3446 0-.5023.1851-.5023.528 0 .3446.1577.5298.5023.5298.3464 0 .5058-.1852.5058-.5298zm-.5058-.6566c.408 0 .6412.2024.6412.655 0 .4542-.2332.6565-.6412.6565-.4063 0-.6377-.2023-.6377-.6566 0-.4525.2314-.6549.6377-.6549zm-2.3571.0206.3342 1.0508.3412-1.0508h.1166l.3394 1.0508.336-1.0508h.1303l-.408 1.2789h-.1165l-.343-1.0577-.341 1.0577h-.1183l-.4098-1.2789zm-1.392.1286v-.1286h1.0886v.1286h-.4766v1.1418h-.1355v-1.1418zm-.204-.1286v.1286h-.7046v.42h.6874v.127h-.6874v.4713h.7114v.1235h-.8468V13.988zm-2.0539 0 .7596 1.0475V13.988h.1303v1.2704h-.1235l-.7835-1.0784v1.0784h-.1303V13.988Z" />
  </svg>
);

const PROVIDER_ICON_MAP: Record<CloudStatusProvider, React.FC<IconProps>> = {
  aws: AWSIcon,
  azure: AzureIcon,
  m365: M365Icon,
  jira: JiraIcon,
  github: GitHubIcon,
  cloudflare: CloudflareIcon,
  mist_global: JuniperNetworksIcon,
  mist_emea: JuniperNetworksIcon,
  mist_apac: JuniperNetworksIcon,
  mist_federal: JuniperNetworksIcon,
  google: GoogleCloudIcon,
  anthropic: ClaudeIcon,
  openai: ChatGPTIcon,
  salesforce: SalesforceIcon,
};
```

Keep the reviewed Simple Icons path inline as the `d` attribute rather than adding a runtime icon dependency.

No `CloudStatusTab.tsx` branch should be required beyond any type-driven fixture/compiler adjustments. Provider order, labels, counts, official actions, details, accessibility, and responsive layout must flow from shared configuration.

- [ ] **Step 4: Enforce the Web response contract**

Import `WebCloudStatusDataSchema` in `operationalRoutes.ts` and change the handler to:

```ts
handler: async () => ({
  status: 200,
  body: WebCloudStatusDataSchema.parse(await services.cloudStatus.refresh()),
}),
```

Update every Cloud Status fixture in Web route/Gateway tests to use the exhaustive shared empty-provider helper. The existing Web bridge remains unchanged because it already consumes this authenticated endpoint.

- [ ] **Step 5: Run UI/Web tests and verify GREEN**

Run:

```bash
npm run test:renderer -- src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx src/renderer/src/__tests__/App.test.tsx
npm run test:unit -- src/main/handlers/windowHandlers.test.ts src/main/web/routes/operationalRoutes.test.ts src/main/web/RelayWebGateway.test.ts
npm run typecheck
```

Expected: four region rows and the official action pass in renderer tests, hostile lookalike links remain blocked, and Web refuses incomplete provider maps.

- [ ] **Step 6: Commit UI and Web parity**

```bash
git add src/renderer/src/components/icons/ProviderIcons.tsx src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx src/renderer/src/__tests__/App.test.tsx src/main/handlers/windowHandlers.test.ts src/main/web/routes/operationalRoutes.ts src/main/web/routes/operationalRoutes.test.ts src/main/web/RelayWebGateway.test.ts tests/e2e/critical-path.spec.ts
git commit -m "feat(cloud-status): show Mist regions across desktop and web"
```

---

### Task 7: Document boundaries and complete verification

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/DESIGN.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/relay-web.md`
- Verify: all files changed by Tasks 1-6

**Interfaces:**
- Documents the public feed, split snapshot compatibility boundary, client merge behavior, trusted external host, four-provider presentation, and alert rules.
- Produces the evidence required for a completion/readiness claim; no source interface changes originate in this task.

- [ ] **Step 1: Update canonical documentation**

Add concise current-state documentation:

- `architecture.md`: Cloud Status manager polls legacy feeds plus one Mist group, persists legacy and Mist singleton partitions, and merges them in updated clients.
- `DEVELOPMENT.md`: SorryApp is a supported documented status API; new provider families that break old renderer unions require a separate compatibility snapshot.
- `DESIGN.md`: all four Mist regions use the same Juniper mark, exact regional labels, and existing provider-row/detail behavior.
- `SECURITY.md`: `status.mist.com` is a credential-free main-process fetch and exact external-link allowlist host; `cloud_status_mist_snapshot` is authenticated-read/server-owned and cache-readable but not offline-writable.
- `relay-web.md`: Relay Web displays four Mist regions, consumes the server-combined 14-provider response, and retains existing outage/degradation/Dynatrace priority behavior.

- [ ] **Step 2: Run the narrowest complete feature regression set**

Run:

```bash
npm run test:unit -- src/shared/cloudStatus.test.ts src/shared/webApi.test.ts src/shared/downdetectorLinks.test.ts src/main/handlers/cloudStatus/mistProvider.test.ts src/main/handlers/cloudStatusHandlers.test.ts src/main/handlers/cloudStatus/CloudStatusSnapshotStore.test.ts src/main/handlers/cloudStatus/CloudStatusManager.test.ts src/main/pocketbase/__tests__/CollectionBootstrap.test.ts src/main/handlers/cacheHandlers.test.ts src/main/handlers/windowHandlers.test.ts src/main/web/routes/operationalRoutes.test.ts src/main/web/RelayWebGateway.test.ts
npm run test:renderer -- src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts src/renderer/src/tabs/__tests__/CloudStatusTab.test.tsx src/renderer/src/__tests__/App.test.tsx src/renderer/src/stores/__tests__/collectionStore.realtime.test.ts
```

Expected: all targeted unit and renderer tests PASS without warnings from unhandled fetches, state updates, or missing collection mocks.

- [ ] **Step 3: Run all repository verification gates**

Run in this order:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
git diff --check
npm audit --audit-level=high --omit=dev
npm run test:electron
npm run test:web
```

Expected: every command exits 0. Electron and Web tests must use their scripted disposable data directories; do not substitute a manual launch against live Relay data.

- [ ] **Step 4: Inspect the final diff and runtime boundaries**

Confirm all of the following from the actual diff and test output:

```text
cloud_status_snapshot keys: 10 legacy providers only
cloud_status_mist_snapshot keys: 4 Mist providers only
combined service/Web keys: 14 providers exactly
Mist fetch credentials: none
Mist external host: status.mist.com only
old-server result: 4 Mist Unknown states, 0 Mist alerts
multi-region new incident: 1 batched toast
Dynatrace priority behavior: unchanged
```

Run `git status --short --branch` and verify that no unrelated files, generated artifacts, local data, or untracked test output are present.

- [ ] **Step 5: Commit documentation and final adjustments**

```bash
git add docs/architecture.md docs/DEVELOPMENT.md docs/DESIGN.md docs/SECURITY.md docs/relay-web.md
git commit -m "docs: document Mist cloud status boundaries"
```

- [ ] **Step 6: Request final code review**

Invoke `superpowers:requesting-code-review` against the complete branch diff. Address only validated in-scope findings, rerun affected focused tests, then rerun the required completion gates before claiming the branch is ready.
