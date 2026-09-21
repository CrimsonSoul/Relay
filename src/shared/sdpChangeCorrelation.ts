import type { DynatraceEntityRef, DynatraceProblemRecord } from './dynatraceProblems';
import { SDP_CHANGE_GRACE_MS, SDP_CHANGE_LOOKBACK_MS, type SdpChangeRecord } from './sdpChanges';

export type SdpChangeMatch = {
  change: SdpChangeRecord;
  confidence: 'automatic' | 'suggested';
  reasons: string[];
};
const normalize = (value: string): string => value.trim().toLowerCase().replace(/\.$/, '');
const hostName = (value: string): string => {
  const name = normalize(value);
  return /^[a-z0-9][a-z0-9.-]*$/.test(name) ? name : '';
};
function sameHost(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  // Never merge two different DNS domains just because their short names agree.
  return (
    (!left.includes('.') || !right.includes('.')) && left.split('.')[0] === right.split('.')[0]
  );
}
function timeEvidence(change: SdpChangeRecord, at: number): string | null {
  const start = change.scheduledStart;
  if (start === null || start > at || at - start > SDP_CHANGE_LOOKBACK_MS) return null;
  const end = change.scheduledEnd;
  if (end !== null && end < start) return null;
  if (at > (end ?? start) + SDP_CHANGE_GRACE_MS) return null;
  if (end === null) return 'Within two hours of scheduled start; end time is missing';
  return at <= end
    ? 'Problem started during the scheduled change window'
    : `Problem started ${Math.ceil((at - end) / 60000)} minutes after the scheduled window`;
}
type Evidence = Pick<SdpChangeMatch, 'confidence' | 'reasons'>;
function assetMatch(
  hosts: DynatraceEntityRef[],
  asset: string,
  change: SdpChangeRecord,
  siteMatch: boolean,
): Evidence | null {
  const name = hostName(asset);
  const matching = hosts.filter((host) => sameHost(name, hostName(host.name)));
  const first = matching[0];
  if (!first) return null;
  const exact = matching.length === 1 && hostName(first.name) === name;
  const qualified = exact && /\.[a-z][a-z0-9-]*$/.test(name);
  const automatic = exact && (qualified || siteMatch) && change.scheduledEnd !== null;
  return {
    confidence: automatic ? 'automatic' : 'suggested',
    reasons: [
      `Affected asset or CI matches host ${first.name}`,
      ...(qualified ? ['Exact fully qualified hostname'] : []),
      ...(siteMatch ? [`Site matches problem context: ${change.site}`] : []),
      ...(matching.length > 1 ? ['Hostname identifies multiple Dynatrace entities'] : []),
    ],
  };
}
function assetEvidence(
  hosts: DynatraceEntityRef[],
  change: SdpChangeRecord,
  siteMatch: boolean,
): Evidence | null {
  const evidence = [...change.assets, ...(change.configurationItems ?? [])]
    .map((asset) => assetMatch(hosts, asset, change, siteMatch))
    .filter((match): match is Evidence => match !== null);
  return evidence.find((match) => match.confidence === 'automatic') ?? evidence[0] ?? null;
}
function isEntityType(entity: DynatraceEntityRef, type: 'HOST' | 'SERVICE'): boolean {
  return entity.type.toUpperCase().replace(/^DT\.ENTITY\./, '') === type;
}
function entityEvidence(
  problem: DynatraceProblemRecord,
  change: SdpChangeRecord,
): Pick<SdpChangeMatch, 'confidence' | 'reasons'> | null {
  const entities = [...problem.affectedEntities, ...problem.impactedEntities];
  const hosts = [
    ...new Map(entities.filter((e) => isEntityType(e, 'HOST')).map((e) => [e.id, e])).values(),
  ];
  const site = normalize(change.site);
  const contexts = [
    ...problem.managementZones.map((z) => z.name),
    ...(problem.workflowTags ?? []),
  ].map(normalize);
  const siteMatch =
    !!site && contexts.some((c) => c === site || c.endsWith(`:${site}`) || c.endsWith(`=${site}`));
  const asset = assetEvidence(hosts, change, siteMatch);
  if (asset) return asset;
  const service = change.services.find((name) =>
    entities.some((e) => isEntityType(e, 'SERVICE') && normalize(e.name) === normalize(name)),
  );
  if (service) return { confidence: 'suggested', reasons: [`Affected service matches ${service}`] };
  // Full tokens only; DB01 must not match DB010 or DB01.other-domain.
  const words = new Set(
    `${change.title} ${change.description.replace(/<[^<>]*>/g, ' ')}`
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9.-]*/g)
      ?.map(normalize),
  );
  const mentioned = hosts.find((host) => {
    const name = hostName(host.name);
    return name.length >= 3 && words.has(name);
  });
  return mentioned
    ? {
        confidence: 'suggested',
        reasons: [`Change text mentions ${mentioned.name}; asset identity is unverified`],
      }
    : null;
}
export function correlateSdpChanges(
  problem: DynatraceProblemRecord,
  changes: SdpChangeRecord[],
): SdpChangeMatch[] {
  const matches: SdpChangeMatch[] = [];
  for (const change of changes) {
    if (/\b(cancelled|canceled|rejected)\b/i.test(change.status)) continue;
    const timing = timeEvidence(change, problem.startTime);
    if (!timing) continue;
    const evidence = entityEvidence(problem, change);
    if (evidence) matches.push({ change, ...evidence, reasons: [...evidence.reasons, timing] });
  }
  return matches.sort(
    (a, b) =>
      a.confidence.localeCompare(b.confidence) ||
      (b.change.scheduledStart ?? 0) - (a.change.scheduledStart ?? 0),
  );
}
