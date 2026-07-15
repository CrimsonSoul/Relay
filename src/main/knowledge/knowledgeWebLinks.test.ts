import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_MAX_LINK_URL_LENGTH } from '@shared/knowledge';
import { normalizeKnowledgeWebUrl } from './knowledgeWebLinks';

describe('normalizeKnowledgeWebUrl', () => {
  it.each([
    ['https://docs.example.com/runbook', 'https://docs.example.com/runbook'],
    // Plain HTTP is intentionally supported for internal Knowledge runbooks.
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    ['http://intranet.example.local/status', 'http://intranet.example.local/status'],
    ['https://DOCS.Example.COM/runbook', 'https://docs.example.com/runbook'],
  ])('accepts and normalizes HTTP(S) URL %s', (value, expected) => {
    expect(normalizeKnowledgeWebUrl(value)).toBe(expected);
  });

  it.each([
    ['file URL', 'file:///etc/passwd'],
    ['JavaScript URL', 'javascript:alert(1)'],
    ['data URL', 'data:text/plain,runbook'],
    ['blob URL', 'blob:https://docs.example.com/id'],
    ['FTP URL', 'ftp://files.example.com/runbook'],
    ['relative URL', '/runbook'],
    ['missing host', 'http://'],
    ['embedded username', 'https://operator@docs.example.com/runbook'],
    ['embedded password', 'https://operator:secret@docs.example.com/runbook'],
    ['leading whitespace', ' https://docs.example.com/runbook'],
    ['trailing whitespace', 'https://docs.example.com/runbook '],
    ['control character', 'https://docs.example.com/run\nbook'],
    ['malformed URL', 'https://[invalid'],
  ])('rejects %s', (_label, value) => {
    expect(normalizeKnowledgeWebUrl(value)).toBeNull();
  });

  it.each([undefined, null, false, 42, {}, []])('rejects non-string value %j', (value) => {
    expect(normalizeKnowledgeWebUrl(value)).toBeNull();
  });

  it('rejects strings longer than the shared 4,096-character limit', () => {
    const value = `https://docs.example.com/${'a'.repeat(KNOWLEDGE_MAX_LINK_URL_LENGTH)}`;

    expect(value.length).toBeGreaterThan(KNOWLEDGE_MAX_LINK_URL_LENGTH);
    expect(normalizeKnowledgeWebUrl(value)).toBeNull();
  });
});
