export const KNOWLEDGE_DOCUMENTS_COLLECTION = 'knowledge_documents';
export const KNOWLEDGE_UPLOADS_COLLECTION = 'knowledge_uploads';
export const KNOWLEDGE_AUDIT_EVENTS_COLLECTION = 'knowledge_audit_events';
export const KNOWLEDGE_LIBRARY_STATE_COLLECTION = 'knowledge_library_state';
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

export type KnowledgeLifecycleState = 'active' | 'trashed';
export type KnowledgeLibraryMode = 'legacy-watch' | 'migrating' | 'managed' | 'recovery-required';

export type ManagedKnowledgeFields = {
  lifecycleState: KnowledgeLifecycleState;
  displayTitle: string;
  revision: number;
  publishedByOperatorId: string;
  publishedByName: string;
  publishedAt: string;
  trashedByOperatorId: string | null;
  trashedByName: string | null;
  trashedAt: string | null;
};

export type KnowledgeDocumentRecord = ManagedKnowledgeFields & {
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

export type KnowledgeUploadState =
  | 'queued'
  | 'uploading'
  | 'validating'
  | 'extracting'
  | 'ready'
  | 'failed'
  | 'published';

export type KnowledgeManagementErrorCode =
  | 'offline'
  | 'unauthorized'
  | 'invalid-file'
  | 'upload-failed'
  | 'validation-failed'
  | 'encrypted-pdf'
  | 'too-large'
  | 'too-many-pages'
  | 'extraction-timeout'
  | 'duplicate-file-name'
  | 'conflict'
  | 'not-found'
  | 'server-error';

export type KnowledgeUploadView = {
  id: string;
  requestId: string;
  fileName: string;
  byteSize: number;
  checksum: string;
  state: KnowledgeUploadState;
  progress: number;
  proposedTitle: string;
  proposedCategory: string;
  pageCount: number | null;
  outline: KnowledgeOutlineNode[];
  outlineSource: KnowledgeOutlineSource | null;
  duplicateDocumentId: string | null;
  safeError: KnowledgeManagementErrorCode | null;
  expiresAt: string;
  revision: number;
};

export type KnowledgeUploadProgress = Pick<
  KnowledgeUploadView,
  'requestId' | 'fileName' | 'byteSize' | 'state' | 'progress' | 'safeError'
>;

export type KnowledgeUploadSelectionResult =
  | { ok: true; uploads: KnowledgeUploadView[] }
  | {
      ok: false;
      error: 'cancelled' | 'offline' | 'unauthorized' | 'invalid-file' | 'upload-failed';
    };

export type KnowledgeAuditAction =
  | 'upload-validated'
  | 'published'
  | 'replaced'
  | 'title-changed'
  | 'category-changed'
  | 'category-renamed'
  | 'trashed'
  | 'restored'
  | 'deleted'
  | 'upload-expired'
  | 'migration-completed'
  | 'recovery-completed';

export type KnowledgeAuditEventView = {
  id: string;
  requestId: string;
  action: KnowledgeAuditAction;
  targetId: string | null;
  fileName: string | null;
  title: string | null;
  category: string | null;
  operatorId: string;
  operatorName: string;
  occurredAt: string;
};

export type KnowledgeManagementDocumentView = Pick<
  KnowledgeDocumentRecord,
  | 'id'
  | 'category'
  | 'displayTitle'
  | 'fileName'
  | 'byteSize'
  | 'pageCount'
  | 'lifecycleState'
  | 'revision'
  | 'publishedByName'
  | 'publishedAt'
  | 'trashedByName'
  | 'trashedAt'
  | 'updated'
>;

export type KnowledgeManagementUploadView = Omit<KnowledgeUploadView, 'outline'> & {
  outlineCount: number;
};

export type KnowledgePage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type KnowledgeManagementSnapshot = {
  mode: KnowledgeLibraryMode;
  documents: KnowledgePage<KnowledgeManagementDocumentView>;
  uploads: KnowledgePage<KnowledgeManagementUploadView>;
  trash: KnowledgePage<KnowledgeManagementDocumentView>;
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
    lifecycleState: rawLifecycleState,
    displayTitle: rawDisplayTitle,
    revision: rawRevision,
    publishedByOperatorId: rawPublishedByOperatorId,
    publishedByName: rawPublishedByName,
    publishedAt: rawPublishedAt,
    trashedByOperatorId: rawTrashedByOperatorId,
    trashedByName: rawTrashedByName,
    trashedAt: rawTrashedAt,
  } = value;

  const lifecycleState = rawLifecycleState ?? 'active';
  const displayTitle = rawDisplayTitle ?? title;
  const revision = rawRevision ?? 1;
  const publishedByOperatorId = rawPublishedByOperatorId ?? '';
  const publishedByName = rawPublishedByName ?? '';
  const publishedAt = rawPublishedAt ?? indexedAt;
  const trashedByOperatorId = rawTrashedByOperatorId || null;
  const trashedByName = rawTrashedByName || null;
  const trashedAt = rawTrashedAt || null;

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

  if (
    (lifecycleState !== 'active' && lifecycleState !== 'trashed') ||
    !boundedString(displayTitle, 240) ||
    !Number.isInteger(revision) ||
    (revision as number) < 1 ||
    typeof publishedByOperatorId !== 'string' ||
    publishedByOperatorId.length > 200 ||
    typeof publishedByName !== 'string' ||
    publishedByName.length > 120 ||
    !boundedString(publishedAt, 100) ||
    (trashedByOperatorId !== null && !boundedString(trashedByOperatorId, 200)) ||
    (trashedByName !== null && !boundedString(trashedByName, 120)) ||
    (trashedAt !== null && !boundedString(trashedAt, 100)) ||
    (lifecycleState === 'active' &&
      (trashedByOperatorId !== null || trashedByName !== null || trashedAt !== null)) ||
    (lifecycleState === 'trashed' &&
      (trashedByOperatorId === null || trashedByName === null || trashedAt === null))
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
    lifecycleState,
    displayTitle,
    revision: revision as number,
    publishedByOperatorId,
    publishedByName,
    publishedAt,
    trashedByOperatorId,
    trashedByName,
    trashedAt,
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
  left: Pick<KnowledgeDocumentRecord, 'title' | 'fileName'> &
    Partial<Pick<KnowledgeDocumentRecord, 'displayTitle'>>,
  right: Pick<KnowledgeDocumentRecord, 'title' | 'fileName'> &
    Partial<Pick<KnowledgeDocumentRecord, 'displayTitle'>>,
): number {
  return (
    collator.compare(left.displayTitle || left.title, right.displayTitle || right.title) ||
    collator.compare(left.fileName, right.fileName)
  );
}

export function isKnowledgeChecksum(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function optionalBoundedString(value: unknown, max: number): value is string | null {
  return value === null || boundedString(value, max);
}

export function normalizeKnowledgeManagementDocumentView(
  value: unknown,
): KnowledgeManagementDocumentView | null {
  if (!isRecord(value)) return null;
  const lifecycleState = value.lifecycleState as KnowledgeLifecycleState;
  const trashedByName = value.trashedByName || null;
  const trashedAt = value.trashedAt || null;
  if (
    !boundedString(value.id, 200) ||
    !boundedString(value.category, KNOWLEDGE_MAX_CATEGORY_LENGTH) ||
    !boundedString(value.displayTitle, 240) ||
    !boundedString(value.fileName, 240) ||
    !Number.isInteger(value.byteSize) ||
    (value.byteSize as number) <= 0 ||
    !Number.isInteger(value.pageCount) ||
    (value.pageCount as number) <= 0 ||
    !['active', 'trashed'].includes(lifecycleState) ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1 ||
    typeof value.publishedByName !== 'string' ||
    value.publishedByName.length > 120 ||
    !boundedString(value.publishedAt, 100) ||
    (trashedByName !== null && !boundedString(trashedByName, 120)) ||
    (trashedAt !== null && !boundedString(trashedAt, 100)) ||
    !boundedString(value.updated, 100) ||
    (lifecycleState === 'active' && (trashedByName !== null || trashedAt !== null)) ||
    (lifecycleState === 'trashed' && (trashedByName === null || trashedAt === null))
  ) {
    return null;
  }
  return {
    id: value.id,
    category: value.category,
    displayTitle: value.displayTitle,
    fileName: value.fileName,
    byteSize: value.byteSize as number,
    pageCount: value.pageCount as number,
    lifecycleState,
    revision: value.revision as number,
    publishedByName: value.publishedByName,
    publishedAt: value.publishedAt,
    trashedByName,
    trashedAt,
    updated: value.updated,
  };
}

export function normalizeKnowledgeManagementUploadView(
  value: unknown,
): KnowledgeManagementUploadView | null {
  if (!isRecord(value)) return null;
  const state = value.state as KnowledgeUploadState;
  const outlineSource = value.outlineSource as KnowledgeOutlineSource | null;
  const safeError = value.safeError as KnowledgeManagementErrorCode | null;
  const validStates: KnowledgeUploadState[] = [
    'queued',
    'uploading',
    'validating',
    'extracting',
    'ready',
    'failed',
    'published',
  ];
  const validErrors: Array<KnowledgeManagementErrorCode | null> = [
    null,
    'offline',
    'unauthorized',
    'invalid-file',
    'upload-failed',
    'validation-failed',
    'encrypted-pdf',
    'too-large',
    'too-many-pages',
    'extraction-timeout',
    'duplicate-file-name',
    'conflict',
    'not-found',
    'server-error',
  ];
  if (
    !boundedString(value.id, 200) ||
    !boundedString(value.requestId, 128) ||
    !boundedString(value.fileName, 240) ||
    !Number.isInteger(value.byteSize) ||
    (value.byteSize as number) <= 0 ||
    !isKnowledgeChecksum(value.checksum) ||
    !validStates.includes(state) ||
    typeof value.progress !== 'number' ||
    value.progress < 0 ||
    value.progress > 100 ||
    typeof value.proposedTitle !== 'string' ||
    value.proposedTitle.length > 240 ||
    typeof value.proposedCategory !== 'string' ||
    value.proposedCategory.length > KNOWLEDGE_MAX_CATEGORY_LENGTH ||
    (value.pageCount !== null && (!Number.isInteger(value.pageCount) || value.pageCount <= 0)) ||
    (outlineSource !== null && !['native', 'inferred', 'none'].includes(outlineSource)) ||
    !optionalBoundedString(value.duplicateDocumentId, 200) ||
    !validErrors.includes(safeError) ||
    !boundedString(value.expiresAt, 100) ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !Number.isInteger(value.outlineCount) ||
    (value.outlineCount as number) < 0
  ) {
    return null;
  }
  return value as KnowledgeManagementUploadView;
}

export function normalizeKnowledgeAuditEventView(value: unknown): KnowledgeAuditEventView | null {
  if (!isRecord(value)) return null;
  const action = value.action as KnowledgeAuditAction;
  const validActions: KnowledgeAuditAction[] = [
    'upload-validated',
    'published',
    'replaced',
    'title-changed',
    'category-changed',
    'category-renamed',
    'trashed',
    'restored',
    'deleted',
    'upload-expired',
    'migration-completed',
    'recovery-completed',
  ];
  if (
    !boundedString(value.id, 200) ||
    !boundedString(value.requestId, 128) ||
    !validActions.includes(action) ||
    !optionalBoundedString(value.targetId, 200) ||
    !optionalBoundedString(value.fileName, 240) ||
    !optionalBoundedString(value.title, 240) ||
    !optionalBoundedString(value.category, KNOWLEDGE_MAX_CATEGORY_LENGTH) ||
    !boundedString(value.operatorId, 200) ||
    !boundedString(value.operatorName, 120) ||
    !boundedString(value.occurredAt, 100)
  ) {
    return null;
  }
  return {
    id: value.id,
    requestId: value.requestId,
    action,
    targetId: value.targetId,
    fileName: value.fileName,
    title: value.title,
    category: value.category,
    operatorId: value.operatorId,
    operatorName: value.operatorName,
    occurredAt: value.occurredAt,
  };
}

function normalizeKnowledgePage<T>(
  value: unknown,
  normalizeItem: (item: unknown) => T | null,
): KnowledgePage<T> | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const items = value.items.map(normalizeItem);
  if (items.some((item) => item === null)) return null;
  if (value.nextCursor !== null && !boundedString(value.nextCursor, 200)) return null;
  return { items: items as T[], nextCursor: value.nextCursor };
}

export function normalizeKnowledgeManagementSnapshot(
  value: unknown,
): KnowledgeManagementSnapshot | null {
  if (!isRecord(value) || !['managed', 'recovery-required'].includes(String(value.mode))) {
    return null;
  }
  const documents = normalizeKnowledgePage(
    value.documents,
    normalizeKnowledgeManagementDocumentView,
  );
  const uploads = normalizeKnowledgePage(value.uploads, normalizeKnowledgeManagementUploadView);
  const trash = normalizeKnowledgePage(value.trash, normalizeKnowledgeManagementDocumentView);
  return documents && uploads && trash
    ? { mode: value.mode as KnowledgeLibraryMode, documents, uploads, trash }
    : null;
}
