# Juniper Mist Regional Cloud Status Design

## Context

Relay's Cloud Status workspace currently monitors ten external providers and shares their status from the Relay server to desktop and Web clients. Juniper Mist publishes a public SorryApp status API covering four regional services: Global, EMEA, APAC, and Federal. Relay needs to show each region separately and alert operators when Mist reports an active incident or sustained component degradation.

Cloud Status data is compatibility-sensitive. Existing Relay clients flatten every provider bucket in the shared `cloud_status_snapshot` record. Publishing unknown provider keys through that record could make an older client count or act on provider types its renderer cannot safely display. The Mist integration must therefore extend updated clients without changing the legacy snapshot contract consumed by existing clients.

## Goals

- Add separate Cloud Status providers for Juniper Mist Global, EMEA, APAC, and Federal.
- Route Mist incidents to their affected regions using the provider's published component metadata.
- Generate Cloud Status outage and degradation alerts through Relay's existing notification behavior.
- Preserve Dynatrace notification priority and Cloud Status deduplication semantics.
- Keep older Relay clients connected and stable when the server begins collecting Mist data.
- Support the same information and alert behavior in the Electron renderer and Relay Web.

## Non-goals

- Monitoring customer-specific Mist organizations, devices, sites, or Marvis actions.
- Authenticating to the Mist management API or storing Mist credentials.
- Adding planned-maintenance notifications.
- Redesigning the Cloud Status workspace or toast system.
- Adding an unverified Mist social-media or Downdetector destination.

## Provider Model and Presentation

Add these providers immediately after Cloudflare in the shared display order:

1. `mist_global` — Juniper Mist Global
2. `mist_emea` — Juniper Mist EMEA
3. `mist_apac` — Juniper Mist APAC
4. `mist_federal` — Juniper Mist Federal

All four providers use `https://status.mist.com/` as their official status page and share the Juniper provider mark. They do not expose social or Downdetector actions unless a verified destination is added in a later change.

The existing Cloud Status interface remains structurally unchanged. The monitored-provider count increases from 10 to 14. Each Mist region participates in the existing provider posture ordering, overview row, detail workspace, responsive behavior, keyboard navigation, accessible naming, and source-link presentation.

## Mist API Adapter

Add a server-side SorryApp adapter dedicated to the public Mist status feed. It uses `fetchNoStore`, the existing ten-second timeout policy, JSON accept headers, HTTPS redirects, and no credentials.

For each polling cycle, one shared Mist request group performs the following work:

1. Fetch active unplanned notices from the public notices endpoint.
2. Fetch the four component records and their current states.
3. Fetch detail for each active notice concurrently so its affected components and update history are available.
4. Map Mist component IDs and canonical component names to the four Relay provider keys.
5. Return four provider buckets to the Cloud Status aggregator without repeating the Mist request group once per region.

An active notice becomes one `CloudStatusItem` in every affected regional bucket. The item uses the stable notice ID, official notice URL, notice subject, latest update content, and latest update timestamp with a fallback to the notice start time. `investigating` and `identified` notices are outages. A `recovering` notice, if returned as active, is a degradation. Resolved and false-alarm notices are excluded.

If a notice has no usable component metadata, Relay assigns it to all four regions. This conservative fallback prevents an operational incident from being silently omitted. If the component endpoint reports a degraded region with no active notice assigned to it, Relay adds one stable synthetic warning item for that component. Operational and under-maintenance component states do not create active issue items.

Planned notices are excluded at the API query boundary and never create Cloud Status items or alerts.

## Shared Snapshot Compatibility

Keep `cloud_status_snapshot` as the legacy ten-provider contract. Add a singleton `cloud_status_mist_snapshot` collection containing only the four Mist provider buckets, Mist feed errors, the last-updated timestamp, and a content hash.

The server-owned Cloud Status manager polls all providers as one logical refresh, then persists the legacy and Mist partitions independently. Its in-memory snapshot remains the complete 14-provider view so privileged server-side APIs and Relay Web can return the current combined result.

Updated desktop clients subscribe to both snapshot collections and merge them before rendering or processing alerts. A new client connected to an older server treats a missing Mist collection or missing Mist singleton as unavailable Mist coverage. It marks the four Mist providers `Unknown`, does not create Mist alerts, and continues to consume the legacy snapshot normally.

Older clients subscribe only to `cloud_status_snapshot`. Because that record retains its existing provider keys and item types, Mist data cannot enter their issue counters, toast actions, or provider detail renderer.

Offline collection caching, collection bootstrap, backup and restore, and Web data schemas must recognize the Mist snapshot without changing the contents of unknown PocketBase collections.

## Alerts and State Transitions

Mist items use the existing `useAppCloudStatus` notification pipeline after the legacy and Mist snapshots are merged.

- The first usable merged snapshot establishes a silent baseline.
- A newly active Mist outage alerts immediately through the `cloud-outage` delivery lane.
- A component-only degradation must remain present across two consecutive processed snapshots before it alerts through the `cloud-degradation` lane.
- Repeated snapshots of the same active regional incident do not duplicate alerts.
- A resolved or disappeared incident leaves the active set and may alert again if it later reopens.
- One notice affecting multiple regions creates regional items but is included in the existing batched toast rather than creating one toast per region.
- Dynatrace Problem notifications retain priority. Mist alerts queue and resume under the existing operational-toast rules without being discarded.
- Planned maintenance, resolved notices, false alarms, feed failures, and unavailable coverage never generate Mist alerts.

Alert actions open the primary affected Mist region inside Cloud Status. The regional detail view links to the official notice when available and otherwise to the Mist status page.

## Failure Handling

If the active-notice request fails, the Mist refresh fails as a group. Relay retains the last persisted Mist buckets, records an error for all four regions, marks their coverage `Unknown` unless an active issue posture takes precedence, and uses the existing degraded one-minute polling cadence.

If the component request fails while notices remain available, Relay still displays incidents obtained from notice details. Regions without an active incident are marked `Unknown` because their component health could not be verified.

If one notice-detail request fails, Relay uses the summary record and assigns that notice to all four regions. This partial failure is logged but does not hide the incident or discard otherwise valid Mist data.

Malformed records are ignored only at the individual-record boundary. A structurally invalid top-level response fails the relevant request so missing data is not presented as healthy. External links remain limited to the configured `status.mist.com` host through Relay's existing trusted external-link policy.

## Testing

Focused server tests cover:

- SorryApp notice, detail, component, and update parsing.
- Single-region and multi-region incident routing.
- The all-region fallback when component metadata is absent or detail fetching fails.
- Stable IDs, latest-update content and timestamps, severity mapping, and official links.
- Component-only degradation synthesis without duplicating an active incident.
- Exclusion of planned, resolved, false-alarm, operational, and maintenance records.
- Partial component failure, complete notice-feed failure, prior-data retention, and error attribution.
- One shared Mist request group per poll rather than four duplicate provider fetches.

Snapshot and compatibility tests cover:

- Independent persistence and hydration of legacy and Mist singleton records.
- Content hashing, poll cadence, and last-known-data retention for both partitions.
- Collection bootstrap, access rules, offline cache eligibility, backup and restore coverage.
- Merging both snapshots in updated clients.
- Missing Mist collection and missing Mist singleton behavior against an older server.
- Confirmation that the legacy snapshot remains an exact ten-provider record.

Renderer and Web tests cover:

- Four regional labels, ordering, shared icon, official status action, and provider count of 14.
- Operational, degraded, outage, and unknown regional postures.
- Regional detail navigation, affected incident rows, focus restoration, responsive layout, and accessible names.
- Silent baseline, outage alerts, sustained degradation alerts, deduplication, reopening, multi-region batching, and Dynatrace-first delivery.
- Updated Web schemas accepting the complete 14-provider result and rejecting incomplete or unknown provider maps.

Before completion, run the repository's required typecheck, lint, format check, full test suite, build, and `git diff --check`, plus `npm run test:electron` and `npm run test:web` because the change crosses Electron, PocketBase, renderer, and Web boundaries. Run the high-severity production dependency audit before any readiness or push-to-test claim.
