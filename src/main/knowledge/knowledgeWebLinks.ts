import { KNOWLEDGE_MAX_LINK_URL_LENGTH } from '@shared/knowledge';

export function normalizeKnowledgeWebUrl(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > KNOWLEDGE_MAX_LINK_URL_LENGTH ||
    value !== value.trim() ||
    // Explicitly reject ASCII control characters before parsing external URLs.
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
