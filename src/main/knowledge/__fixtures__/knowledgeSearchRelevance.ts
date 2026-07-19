import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import {
  KNOWLEDGE_SEARCH_INDEX_VERSION,
  normalizeKnowledgeSearchText,
  type KnowledgeSearchChunkRecord,
} from '@shared/knowledgeSearch';

const TIMESTAMP = '2026-07-19T12:00:00.000Z';

type FixtureDocument = {
  id: string;
  title: string;
  fileName: string;
  category: string;
  categoryId: string;
  documentType: KnowledgeDocumentRecord['documentType'];
  pages: readonly string[];
};

const FIXTURE_DOCUMENTS: readonly FixtureDocument[] = [
  {
    id: 'noc-rf-failover',
    title: 'RF Gateway Failover Runbook',
    fileName: 'rf-gateway-failover.pdf',
    category: 'Network Operations',
    categoryId: 'network',
    documentType: 'sop',
    pages: [
      'RF gateway failover procedure. Verify radio frequency link health, transfer traffic to the standby gateway, and confirm carrier recovery.',
    ],
  },
  {
    id: 'noc-bgp-recovery',
    title: 'BGP Neighbor Recovery',
    fileName: 'bgp-neighbor-recovery.pdf',
    category: 'Network Operations',
    categoryId: 'network',
    documentType: 'sop',
    pages: [
      'BGP neighbor recovery procedure. Inspect the border router session, validate route advertisements, and reset the peering connection.',
    ],
  },
  {
    id: 'noc-major-incident',
    title: 'Major Incident Command',
    fileName: 'major-incident-command.pdf',
    category: 'Incident Management',
    categoryId: 'incident',
    documentType: 'sop',
    pages: [
      'Major incident escalation for ticket INC-1042. Assign an incident commander, open the communications bridge, and begin stakeholder updates.',
    ],
  },
  {
    id: 'noc-dns-resolution',
    title: 'DNS Resolution Troubleshooting',
    fileName: 'dns-resolution-troubleshooting.pdf',
    category: 'Network Operations',
    categoryId: 'network',
    documentType: 'cheatsheet',
    pages: [
      'DNS resolution troubleshooting. Check recursive resolver latency, stale cache entries, authoritative nameservers, and domain lookup failures.',
    ],
  },
  {
    id: 'noc-oracle-database',
    title: 'Oracle Database Recovery',
    fileName: 'oracle-database-recovery.pdf',
    category: 'Database Operations',
    categoryId: 'database',
    documentType: 'sop',
    pages: [
      'Oracle database recovery procedure. Inspect archive logs, restore the damaged tablespace, validate replication, and resume application connections.',
    ],
  },
  {
    id: 'noc-dynatrace-monitoring',
    title: 'Dynatrace Alert Investigation',
    fileName: 'dynatrace-alert-investigation.pdf',
    category: 'Monitoring',
    categoryId: 'monitoring',
    documentType: 'cheatsheet',
    pages: [
      'Dynatrace alert investigation. Review the problem timeline, inspect service anomalies, correlate host metrics, and acknowledge the notification.',
    ],
  },
  {
    id: 'noc-firewall-vpn',
    title: 'Firewall VPN Diagnostics',
    fileName: 'firewall-vpn-diagnostics.pdf',
    category: 'Security Operations',
    categoryId: 'security',
    documentType: 'cheatsheet',
    pages: [
      'Firewall VPN diagnostics. Confirm tunnel negotiation, inspect access control rules, verify certificate validity, and test encrypted traffic flow.',
    ],
  },
  {
    id: 'noc-backup-restore',
    title: 'Backup Restore Validation',
    fileName: 'backup-restore-validation.pdf',
    category: 'Platform Operations',
    categoryId: 'platform',
    documentType: 'sop',
    pages: [
      'Backup restore validation. Recover the latest snapshot, compare checksums, test restored services, and record recovery point objectives.',
    ],
  },
] as const;

function checksum(index: number): string {
  return (index + 1).toString(16).padStart(64, '0');
}

export function knowledgeSearchFixtureDocument(
  overrides: Partial<KnowledgeDocumentRecord> & Pick<KnowledgeDocumentRecord, 'id' | 'title'>,
): KnowledgeDocumentRecord {
  return {
    id: overrides.id,
    sourceKey: `fixture/${overrides.id}.pdf`,
    category: 'Network Operations',
    categoryId: 'network',
    documentType: 'sop',
    title: overrides.title,
    displayTitle: overrides.title,
    fileName: `${overrides.id}.pdf`,
    pdf: `${overrides.id}.pdf`,
    cover: null,
    checksum: 'a'.repeat(64),
    byteSize: 1_024,
    pageCount: 1,
    outline: [],
    outlineSource: 'none',
    sourceModifiedAt: TIMESTAMP,
    indexedAt: TIMESTAMP,
    searchIndexState: 'ready',
    searchIndexChecksum: 'a'.repeat(64),
    searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
    searchIndexedAt: TIMESTAMP,
    searchIndexError: null,
    lifecycleState: 'active',
    revision: 1,
    publishedByAccountId: 'fixture-account',
    publishedByName: 'Fixture Account',
    publishedAt: TIMESTAMP,
    trashedByAccountId: null,
    trashedByName: null,
    trashedAt: null,
    created: TIMESTAMP,
    updated: TIMESTAMP,
    ...overrides,
  };
}

export function knowledgeSearchFixtureChunk(
  document: KnowledgeDocumentRecord,
  text: string,
  overrides: Partial<KnowledgeSearchChunkRecord> = {},
): KnowledgeSearchChunkRecord {
  const normalizedText = normalizeKnowledgeSearchText(text);
  const normalizedStart = overrides.normalizedStart ?? 0;
  return {
    id: `${document.id}-page-1-passage-1`,
    documentId: document.id,
    checksum: document.checksum,
    pageNumber: 1,
    passageNumber: 1,
    headingId: null,
    heading: null,
    text,
    normalizedText,
    normalizedStart,
    normalizedEnd: normalizedStart + normalizedText.length,
    indexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
    indexedAt: TIMESTAMP,
    created: TIMESTAMP,
    updated: TIMESTAMP,
    ...overrides,
  };
}

export const KNOWLEDGE_SEARCH_RELEVANCE_DOCUMENTS: readonly KnowledgeDocumentRecord[] =
  FIXTURE_DOCUMENTS.map((fixture, index) =>
    knowledgeSearchFixtureDocument({
      id: fixture.id,
      title: fixture.title,
      displayTitle: fixture.title,
      fileName: fixture.fileName,
      sourceKey: `fixture/${fixture.fileName}`,
      pdf: fixture.fileName,
      category: fixture.category,
      categoryId: fixture.categoryId,
      documentType: fixture.documentType,
      checksum: checksum(index),
      searchIndexChecksum: checksum(index),
      pageCount: fixture.pages.length,
    }),
  );

export const KNOWLEDGE_SEARCH_RELEVANCE_CHUNKS: readonly KnowledgeSearchChunkRecord[] =
  FIXTURE_DOCUMENTS.flatMap((fixture) => {
    const document = KNOWLEDGE_SEARCH_RELEVANCE_DOCUMENTS.find(({ id }) => id === fixture.id)!;
    return fixture.pages.map((page, pageIndex) =>
      knowledgeSearchFixtureChunk(document, page, {
        id: `${document.id}-page-${pageIndex + 1}-passage-1`,
        pageNumber: pageIndex + 1,
      }),
    );
  });

export const KNOWLEDGE_SEARCH_RELEVANCE_FIXTURE_VERSION = 1;

export const KNOWLEDGE_SEARCH_RELEVANCE_CASES = [
  {
    name: 'rf gateway failover',
    query: 'rf gateway failover',
    expectedDocumentId: 'noc-rf-failover',
  },
  {
    name: 'radio frequency link',
    query: 'radio frequency link',
    expectedDocumentId: 'noc-rf-failover',
  },
  { name: 'standby gateway', query: 'standby gateway', expectedDocumentId: 'noc-rf-failover' },
  { name: 'carrier recovery', query: 'carrier recovery', expectedDocumentId: 'noc-rf-failover' },
  { name: 'bgp neighbor', query: 'bgp neighbor', expectedDocumentId: 'noc-bgp-recovery' },
  {
    name: 'border router session',
    query: 'border router session',
    expectedDocumentId: 'noc-bgp-recovery',
  },
  {
    name: 'route advertisements',
    query: 'route advertisements',
    expectedDocumentId: 'noc-bgp-recovery',
  },
  {
    name: 'peering connection',
    query: 'peering connection',
    expectedDocumentId: 'noc-bgp-recovery',
  },
  {
    name: 'major incident escalation',
    query: 'major incident escalation',
    expectedDocumentId: 'noc-major-incident',
  },
  {
    name: 'incident commander',
    query: 'incident commander',
    expectedDocumentId: 'noc-major-incident',
  },
  {
    name: 'communications bridge',
    query: 'communications bridge',
    expectedDocumentId: 'noc-major-incident',
  },
  {
    name: 'stakeholder updates',
    query: 'stakeholder updates',
    expectedDocumentId: 'noc-major-incident',
  },
  { name: 'dns resolution', query: 'dns resolution', expectedDocumentId: 'noc-dns-resolution' },
  {
    name: 'recursive resolver',
    query: 'recursive resolver',
    expectedDocumentId: 'noc-dns-resolution',
  },
  {
    name: 'authoritative nameservers',
    query: 'authoritative nameservers',
    expectedDocumentId: 'noc-dns-resolution',
  },
  {
    name: 'domain lookup failures',
    query: 'domain lookup failures',
    expectedDocumentId: 'noc-dns-resolution',
  },
  {
    name: 'oracle database recovery',
    query: 'oracle database recovery',
    expectedDocumentId: 'noc-oracle-database',
  },
  { name: 'archive logs', query: 'archive logs', expectedDocumentId: 'noc-oracle-database' },
  {
    name: 'damaged tablespace',
    query: 'damaged tablespace',
    expectedDocumentId: 'noc-oracle-database',
  },
  {
    name: 'validate replication',
    query: 'validate replication',
    expectedDocumentId: 'noc-oracle-database',
  },
  {
    name: 'dynatrace alert',
    query: 'dynatrace alert',
    expectedDocumentId: 'noc-dynatrace-monitoring',
  },
  {
    name: 'problem timeline',
    query: 'problem timeline',
    expectedDocumentId: 'noc-dynatrace-monitoring',
  },
  {
    name: 'service anomalies',
    query: 'service anomalies',
    expectedDocumentId: 'noc-dynatrace-monitoring',
  },
  { name: 'host metrics', query: 'host metrics', expectedDocumentId: 'noc-dynatrace-monitoring' },
  { name: 'firewall vpn', query: 'firewall vpn', expectedDocumentId: 'noc-firewall-vpn' },
  {
    name: 'tunnel negotiation',
    query: 'tunnel negotiation',
    expectedDocumentId: 'noc-firewall-vpn',
  },
  {
    name: 'access control rules',
    query: 'access control rules',
    expectedDocumentId: 'noc-firewall-vpn',
  },
  {
    name: 'certificate validity',
    query: 'certificate validity',
    expectedDocumentId: 'noc-firewall-vpn',
  },
  {
    name: 'backup restore validation',
    query: 'backup restore validation',
    expectedDocumentId: 'noc-backup-restore',
  },
  { name: 'latest snapshot', query: 'latest snapshot', expectedDocumentId: 'noc-backup-restore' },
  {
    name: 'compare checksums',
    query: 'compare checksums',
    expectedDocumentId: 'noc-backup-restore',
  },
  {
    name: 'recovery point objectives',
    query: 'recovery point objectives',
    expectedDocumentId: 'noc-backup-restore',
  },
] as const;

export const KNOWLEDGE_SEARCH_NO_RESULT_CASES = [
  'zzqv unrelated',
  '123456789 missing',
  'oracle banana telescope',
] as const;
