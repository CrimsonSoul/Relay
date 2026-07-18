import { beforeEach, describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY,
  loadKnowledgePdfViewMode,
  persistKnowledgePdfViewMode,
} from '../knowledgePdfViewMode';

describe('knowledge PDF view mode storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to continuous and ignores invalid storage', () => {
    expect(loadKnowledgePdfViewMode()).toBe('continuous');
    localStorage.setItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY, 'spread');
    expect(loadKnowledgePdfViewMode()).toBe('continuous');
  });

  it('persists the selected view mode', () => {
    persistKnowledgePdfViewMode('single');

    expect(localStorage.getItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY)).toBe('single');
    expect(loadKnowledgePdfViewMode()).toBe('single');
  });
});
