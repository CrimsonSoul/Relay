export const KNOWLEDGE_DOCUMENTS_COLLECTION = 'knowledge_documents';
export const KNOWLEDGE_MAX_PDF_BYTES = 50 * 1024 * 1024;
export const KNOWLEDGE_MAX_PAGES = 1_000;
export const KNOWLEDGE_MAX_OUTLINE_NODES = 500;
export const KNOWLEDGE_MAX_OUTLINE_LABEL_LENGTH = 240;
export const KNOWLEDGE_MAX_CATEGORY_LENGTH = 120;
export const KNOWLEDGE_MAX_SOURCE_KEY_LENGTH = 512;
export const KNOWLEDGE_MAX_LINK_URL_LENGTH = 4_096;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export type KnowledgeOutlineNode = {
  id: string;
  label: string;
  level: 1 | 2;
  pageIndex: number;
  top: number | null;
};

export type KnowledgeOutlineSource = 'native' | 'inferred' | 'none';

export type KnowledgeDocumentRecord = {
  id: string;
  sourceKey: string;
  category: string;
  title: string;
  fileName: string;
  pdf: string;
  checksum: string;
  byteSize: number;
  pageCount: number;
  outline: KnowledgeOutlineNode[];
  outlineSource: KnowledgeOutlineSource;
  sourceModifiedAt: string;
  indexedAt: string;
  created: string;
  updated: string;
};

export type KnowledgeIndexStatus = {
  state: 'idle' | 'indexing' | 'warning' | 'error';
  documentCount: number;
  categoryCount: number;
  lastIndexedAt: string | null;
  message?: string;
};

export type KnowledgeOpenWebLinkError = 'invalid-url' | 'rate-limited' | 'open-failed';

export type KnowledgeOpenWebLinkResult =
  | { ok: true }
  | { ok: false; error: KnowledgeOpenWebLinkError };

export type KnowledgePdfRequest = {
  documentId: string;
  checksum: string;
};

export type KnowledgePdfErrorCode =
  | 'not-found'
  | 'not-available-offline'
  | 'invalid-document'
  | 'download-failed'
  | 'checksum-mismatch';

export type KnowledgePdfResult =
  | {
      ok: true;
      data: ArrayBuffer;
      checksum: string;
      source: 'server' | 'cache' | 'download';
    }
  | { ok: false; error: KnowledgePdfErrorCode };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function normalizeOutlineNode(value: unknown): KnowledgeOutlineNode | null {
  if (!isRecord(value)) return null;
  const { id, label, level, pageIndex, top } = value;
  if (!boundedString(id, 200) || !boundedString(label, KNOWLEDGE_MAX_OUTLINE_LABEL_LENGTH)) {
    return null;
  }
  if (level !== 1 && level !== 2) return null;
  if (!Number.isInteger(pageIndex) || (pageIndex as number) < 0) return null;
  if (top !== null && (typeof top !== 'number' || !Number.isFinite(top) || top < 0)) return null;
  return { id, label, level, pageIndex: pageIndex as number, top };
}

export function normalizeKnowledgeDocumentRecord(value: unknown): KnowledgeDocumentRecord | null {
  if (!isRecord(value)) return null;
  const {
    id,
    sourceKey,
    category,
    title,
    fileName,
    pdf,
    checksum,
    byteSize,
    pageCount,
    outline,
    outlineSource,
    sourceModifiedAt,
    indexedAt,
    created,
    updated,
  } = value;

  if (
    !boundedString(id, 200) ||
    !boundedString(sourceKey, KNOWLEDGE_MAX_SOURCE_KEY_LENGTH) ||
    !boundedString(category, KNOWLEDGE_MAX_CATEGORY_LENGTH) ||
    !boundedString(title, 240) ||
    !boundedString(fileName, 240) ||
    !boundedString(pdf, 500) ||
    typeof checksum !== 'string' ||
    !SHA256_PATTERN.test(checksum) ||
    !Number.isInteger(byteSize) ||
    (byteSize as number) <= 0 ||
    (byteSize as number) > KNOWLEDGE_MAX_PDF_BYTES ||
    !Number.isInteger(pageCount) ||
    (pageCount as number) <= 0 ||
    (pageCount as number) > KNOWLEDGE_MAX_PAGES ||
    !Array.isArray(outline) ||
    !['native', 'inferred', 'none'].includes(String(outlineSource)) ||
    !boundedString(sourceModifiedAt, 100) ||
    !boundedString(indexedAt, 100) ||
    !boundedString(created, 100) ||
    !boundedString(updated, 100)
  ) {
    return null;
  }

  const normalizedOutline = outline
    .slice(0, KNOWLEDGE_MAX_OUTLINE_NODES)
    .map(normalizeOutlineNode)
    .filter((node): node is KnowledgeOutlineNode => node !== null);

  return {
    id,
    sourceKey,
    category,
    title,
    fileName,
    pdf,
    checksum,
    byteSize: byteSize as number,
    pageCount: pageCount as number,
    outline: normalizedOutline,
    outlineSource: outlineSource as KnowledgeOutlineSource,
    sourceModifiedAt,
    indexedAt,
    created,
    updated,
  };
}

export function normalizeKnowledgeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('en')
    .replace(/\s+/g, ' ');
}

export function compareKnowledgeCategories(left: string, right: string): number {
  const leftGeneral = normalizeKnowledgeSearchText(left) === 'general';
  const rightGeneral = normalizeKnowledgeSearchText(right) === 'general';
  if (leftGeneral !== rightGeneral) return leftGeneral ? -1 : 1;
  return collator.compare(left, right);
}

export function compareKnowledgeDocuments(
  left: Pick<KnowledgeDocumentRecord, 'title' | 'fileName'>,
  right: Pick<KnowledgeDocumentRecord, 'title' | 'fileName'>,
): number {
  return (
    collator.compare(left.title, right.title) || collator.compare(left.fileName, right.fileName)
  );
}

export function isKnowledgeChecksum(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}
