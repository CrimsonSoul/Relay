import {
  KNOWLEDGE_MAX_LINK_URL_LENGTH,
  normalizeKnowledgeSearchText,
  type KnowledgeDocumentRecord,
} from '@shared/knowledge';

// eslint-disable-next-line no-control-regex -- Required to reject authored links containing control characters.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/i;
const COMMON_WEB_SUFFIXES = new Set([
  'app',
  'biz',
  'cloud',
  'com',
  'dev',
  'edu',
  'gov',
  'info',
  'int',
  'io',
  'mil',
  'net',
  'org',
]);

export type KnowledgeLinkUnavailableReason = 'not-found' | 'ambiguous' | 'unsupported';

export type KnowledgeResolvedLink =
  | { kind: 'same-document'; pageIndex: number }
  | { kind: 'knowledge-document'; documentId: string; title: string; pageIndex: number }
  | { kind: 'web'; url: string; hostname: string }
  | { kind: 'unavailable'; reason: KnowledgeLinkUnavailableReason };

export type ResolveKnowledgeLinkInput = {
  rawUrl: string;
  currentDocument: KnowledgeDocumentRecord;
  documents: readonly KnowledgeDocumentRecord[];
};

type ParsedAuthoredPath = {
  path: string;
  pageNumber: number | null;
};

type AuthoredPathContext = { kind: 'absolute' } | { kind: 'relative'; resolvedSourceKey: string };

function unavailable(reason: KnowledgeLinkUnavailableReason): KnowledgeResolvedLink {
  return { kind: 'unavailable', reason };
}

function parsePageIndex(pageNumber: number | null, pageCount: number): number {
  if (pageNumber === null || pageNumber < 1 || pageNumber > pageCount) return 0;
  return pageNumber - 1;
}

function parsePageNumber(fragment: string | null): number | null {
  const match = fragment?.match(/^page=(\d+)$/);
  if (!match) return null;

  const pageNumber = Number(match[1]);
  return Number.isSafeInteger(pageNumber) ? pageNumber : null;
}

function parseAuthoredPath(value: string): ParsedAuthoredPath | null {
  const hashIndex = value.indexOf('#');
  const fragment = hashIndex >= 0 ? value.slice(hashIndex + 1) : null;
  const pathAndQuery = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = pathAndQuery.indexOf('?');
  const encodedPath = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery;

  try {
    return {
      path: decodeURIComponent(encodedPath).replace(/\\/g, '/'),
      pageNumber: parsePageNumber(fragment),
    };
  } catch {
    return null;
  }
}

function isAbsoluteAuthorPath(path: string): boolean {
  return path.startsWith('/') || WINDOWS_ABSOLUTE_PATH.test(path);
}

function resolveRelativeSourceKey(currentSourceKey: string, authoredPath: string): string | null {
  const sourceSegments = currentSourceKey.replace(/\\/g, '/').split('/');
  sourceSegments.pop();

  const resolvedSegments = sourceSegments.filter((segment) => segment.length > 0);
  for (const segment of authoredPath.split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') {
      if (resolvedSegments.length === 0) return null;
      resolvedSegments.pop();
      continue;
    }
    resolvedSegments.push(segment);
  }

  return resolvedSegments.join('/');
}

function resolveAuthoredPathContext(
  currentSourceKey: string,
  authoredPath: string,
): AuthoredPathContext | null {
  if (isAbsoluteAuthorPath(authoredPath)) return { kind: 'absolute' };

  const resolvedSourceKey = resolveRelativeSourceKey(currentSourceKey, authoredPath);
  return resolvedSourceKey === null ? null : { kind: 'relative', resolvedSourceKey };
}

function resolvedDocument(
  document: KnowledgeDocumentRecord,
  currentDocument: KnowledgeDocumentRecord,
  pageNumber: number | null,
): KnowledgeResolvedLink {
  const pageIndex = parsePageIndex(pageNumber, document.pageCount);
  if (document.id === currentDocument.id) return { kind: 'same-document', pageIndex };

  return {
    kind: 'knowledge-document',
    documentId: document.id,
    title: document.title,
    pageIndex,
  };
}

function resolveWebLink(rawUrl: string): KnowledgeResolvedLink {
  if (rawUrl !== rawUrl.trim()) return unavailable('unsupported');

  try {
    const parsedUrl = new URL(rawUrl);
    if (
      !['http:', 'https:'].includes(parsedUrl.protocol) ||
      parsedUrl.hostname.length === 0 ||
      parsedUrl.username.length > 0 ||
      parsedUrl.password.length > 0
    ) {
      return unavailable('unsupported');
    }
    return { kind: 'web', url: rawUrl, hostname: parsedUrl.hostname };
  } catch {
    return unavailable('unsupported');
  }
}

function resolveSchemeLessWebLink(rawUrl: string): KnowledgeResolvedLink | null {
  if (
    rawUrl !== rawUrl.trim() ||
    rawUrl.startsWith('/') ||
    rawUrl.startsWith('\\') ||
    rawUrl.includes('\\')
  ) {
    return null;
  }

  try {
    const parsedUrl = new URL(`https://${rawUrl}`);
    const labels = parsedUrl.hostname.split('.');
    const suffix = labels.at(-1) ?? '';
    if (
      labels.length < 2 ||
      labels.some((label) => label.length === 0) ||
      (suffix.length !== 2 && !COMMON_WEB_SUFFIXES.has(suffix))
    ) {
      return null;
    }
    return resolveWebLink(parsedUrl.toString());
  } catch {
    return null;
  }
}

export function resolveKnowledgeLink(input: ResolveKnowledgeLinkInput): KnowledgeResolvedLink {
  const { rawUrl, currentDocument, documents } = input;
  if (
    typeof rawUrl !== 'string' ||
    rawUrl.length === 0 ||
    rawUrl.length > KNOWLEDGE_MAX_LINK_URL_LENGTH ||
    CONTROL_CHARACTERS.test(rawUrl)
  ) {
    return unavailable('unsupported');
  }

  if (rawUrl.startsWith('#page=')) {
    return {
      kind: 'same-document',
      pageIndex: parsePageIndex(parsePageNumber(rawUrl.slice(1)), currentDocument.pageCount),
    };
  }

  if (/^https?:/i.test(rawUrl)) {
    return resolveWebLink(rawUrl);
  }

  let authoredPath = rawUrl;
  if (/^file:/i.test(rawUrl)) {
    try {
      const parsedUrl = new URL(rawUrl);
      authoredPath = `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
    } catch {
      return unavailable('unsupported');
    }
  } else if (SCHEME.test(rawUrl) && !WINDOWS_ABSOLUTE_PATH.test(rawUrl)) {
    return unavailable('unsupported');
  }

  const parsedPath = parseAuthoredPath(authoredPath);
  if (!parsedPath) return unavailable('unsupported');

  const fileName = parsedPath.path.split('/').at(-1) ?? '';
  if (!/\.pdf$/i.test(fileName)) {
    return resolveSchemeLessWebLink(rawUrl) ?? unavailable('unsupported');
  }

  const authoredPathContext = resolveAuthoredPathContext(
    currentDocument.sourceKey,
    parsedPath.path,
  );
  if (authoredPathContext === null) return unavailable('unsupported');

  const normalizedFileName = normalizeKnowledgeSearchText(fileName);
  const fileNameMatches = documents.filter(
    (document) => normalizeKnowledgeSearchText(document.fileName) === normalizedFileName,
  );

  if (fileNameMatches.length === 0) return unavailable('not-found');
  if (fileNameMatches.length === 1) {
    return resolvedDocument(fileNameMatches[0], currentDocument, parsedPath.pageNumber);
  }

  if (authoredPathContext.kind === 'absolute') return unavailable('ambiguous');

  const normalizedSourceKey = normalizeKnowledgeSearchText(authoredPathContext.resolvedSourceKey);
  const sourceKeyMatches = fileNameMatches.filter(
    (document) =>
      normalizeKnowledgeSearchText(document.sourceKey.replace(/\\/g, '/')) === normalizedSourceKey,
  );

  if (sourceKeyMatches.length !== 1) return unavailable('ambiguous');
  return resolvedDocument(sourceKeyMatches[0], currentDocument, parsedPath.pageNumber);
}
