/**
 * Deterministic corpus generator for the Knowledge search benchmarks.
 *
 * Produces records shaped like the PocketBase rows the search engine indexes, at a size that
 * mirrors a realistic managed library: ~100 documents x ~100 chunks x ~1200 characters.
 */

const DOCUMENT_COUNT = 100;
const CHUNKS_PER_DOCUMENT = 100;
const TARGET_CHUNK_CHARS = 1_200;

const WORDS = [
  'checkout',
  'payment',
  'gateway',
  'latency',
  'timeout',
  'retry',
  'runbook',
  'incident',
  'severity',
  'escalation',
  'rollback',
  'deployment',
  'cluster',
  'node',
  'pod',
  'ingress',
  'certificate',
  'expiry',
  'rotation',
  'secret',
  'database',
  'replica',
  'primary',
  'failover',
  'backup',
  'restore',
  'snapshot',
  'throughput',
  'saturation',
  'queue',
  'consumer',
  'producer',
  'partition',
  'offset',
  'checksum',
  'validation',
  'schema',
  'migration',
  'index',
  'shard',
  'cache',
  'eviction',
  'invalidation',
  'warmup',
  'stampede',
  'circuit',
  'breaker',
  'bulkhead',
  'throttle',
  'quota',
  'authentication',
  'authorization',
  'session',
  'token',
  'refresh',
  'revocation',
  'audit',
  'compliance',
  'retention',
  'redaction',
  'observability',
  'dashboard',
  'alerting',
  'threshold',
  'anomaly',
  'baseline',
  'regression',
  'canary',
  'rollout',
  'feature',
  'operator',
  'oncall',
  'handover',
  'postmortem',
  'remediation',
  'mitigation',
  'workaround',
  'dependency',
  'upstream',
  'downstream',
  'the',
  'and',
  'with',
  'from',
  'that',
  'when',
  'must',
  'should',
  'before',
  'after',
  'payment.api',
  'checkout-service',
  'relay-web',
  'pb_data',
  'HTTP/504',
  'HTTP/429',
  'v2',
  'v3',
  'p99',
  'p50',
  'RELAY-1042',
  'RELAY-2087',
  'SLO-99.9',
  'ap-east-1',
  'us-west-2',
];

const CATEGORIES = [
  'Platform operations',
  'Checkout operations',
  'Payments',
  'Reliability',
  'Security',
  'Data platform',
  'Client experience',
  'Network',
];

const TITLE_HEADS = [
  'Incident Runbook',
  'Degradation Guide',
  'Escalation Playbook',
  'Recovery Procedure',
  'Operations Manual',
  'Failover Checklist',
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexChecksum(random) {
  let value = '';
  while (value.length < 64) value += Math.floor(random() * 16).toString(16);
  return value;
}

function buildPassage(random) {
  const parts = [];
  let length = 0;
  while (length < TARGET_CHUNK_CHARS) {
    const sentenceWords = 8 + Math.floor(random() * 12);
    const sentence = [];
    for (let index = 0; index < sentenceWords; index += 1) {
      sentence.push(WORDS[Math.floor(random() * WORDS.length)]);
    }
    const text = `${sentence.join(' ')}.`;
    parts.push(text);
    length += text.length + 1;
  }
  return parts.join(' ');
}

/**
 * @param {(value: string) => string} normalize the variant's own text normalizer, so the chunk
 *   records satisfy the engine's `normalizedText` invariant exactly as production rows do.
 */
export function buildCorpus(normalize, options = {}) {
  const documentCount = options.documentCount ?? DOCUMENT_COUNT;
  const chunksPerDocument = options.chunksPerDocument ?? CHUNKS_PER_DOCUMENT;
  const random = mulberry32(options.seed ?? 0x5eed_1234);
  const documents = [];
  const chunks = [];
  let totalTextChars = 0;

  for (let documentIndex = 0; documentIndex < documentCount; documentIndex += 1) {
    const checksum = hexChecksum(random);
    const category = CATEGORIES[documentIndex % CATEGORIES.length];
    const head = TITLE_HEADS[documentIndex % TITLE_HEADS.length];
    const title = `${category} ${head} ${documentIndex + 1}`;
    const documentId = `doc${String(documentIndex).padStart(4, '0')}`;
    documents.push({
      id: documentId,
      sourceKey: `${category}/${title}.pdf`,
      category,
      categoryId: `cat${documentIndex % CATEGORIES.length}`,
      documentType: 'sop',
      title,
      displayTitle: title,
      fileName: `${title}.pdf`,
      pdf: `${documentId}.pdf`,
      cover: null,
      checksum,
      byteSize: 1_024,
      pageCount: Math.max(1, Math.ceil(chunksPerDocument / 4)),
      outline: [],
      outlineSource: 'none',
      sourceModifiedAt: '2026-01-01T00:00:00.000Z',
      indexedAt: '2026-01-01T00:00:00.000Z',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z',
      lifecycleState: 'active',
      revision: 1,
      publishedByAccountId: 'bench',
      publishedByName: 'Bench',
      publishedAt: '2026-01-01T00:00:00.000Z',
      trashedByAccountId: null,
      trashedByName: null,
      trashedAt: null,
      searchIndexState: 'ready',
      searchIndexChecksum: checksum,
      searchIndexVersion: 1,
      searchIndexedAt: '2026-01-01T00:00:00.000Z',
      searchIndexError: null,
    });

    let normalizedStart = 0;
    for (let chunkIndex = 0; chunkIndex < chunksPerDocument; chunkIndex += 1) {
      const text = buildPassage(random);
      const normalizedText = normalize(text);
      totalTextChars += text.length;
      chunks.push({
        id: `${documentId}-c${String(chunkIndex).padStart(4, '0')}`,
        documentId,
        checksum,
        pageNumber: Math.floor(chunkIndex / 4) + 1,
        passageNumber: (chunkIndex % 4) + 1,
        headingId: `${documentId}-h${Math.floor(chunkIndex / 10)}`,
        heading: `${head} section ${Math.floor(chunkIndex / 10) + 1}`,
        text,
        normalizedText,
        normalizedStart,
        normalizedEnd: normalizedStart + normalizedText.length,
        indexVersion: 1,
        indexedAt: '2026-01-01T00:00:00.000Z',
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
      });
      normalizedStart += normalizedText.length + 1;
    }
  }

  return { documents, chunks, totalTextChars };
}

export const BENCH_QUERIES = [
  'checkout latency',
  'payment gateway timeout',
  'runbook escalation',
  'certificate rotation',
  'database failover',
  'cache invalidation',
  'circuit breaker',
  'token revocation',
  'canary rollout',
  'postmortem remediation',
  'payment.api',
  'checkout-service',
  'RELAY-1042',
  'p99 saturation',
  'schema migration index',
  'queue consumer offset',
  'audit retention redaction',
  'anomaly threshold baseline',
  'ingress certificate expiry',
  'replica primary backup',
];
