import { afterEach, describe, expect, it } from 'vitest';
import {
  getCollectionStore,
  normalizeCollectionQuery,
  resetCollectionStoreRegistry,
} from '../collectionStoreRegistry';

afterEach(() => resetCollectionStoreRegistry());

describe('collectionStoreRegistry', () => {
  it('normalizes omitted and explicit default sorts to the same query', () => {
    expect(normalizeCollectionQuery('contacts')).toBe(
      normalizeCollectionQuery('contacts', { sort: '-created' }),
    );
  });

  it('returns one store for identical normalized queries', () => {
    const first = getCollectionStore('contacts', { sort: ' name ' });
    const second = getCollectionStore('contacts', { sort: 'name' });

    expect(first).toBe(second);
  });

  it('returns separate stores for different filters', () => {
    const first = getCollectionStore('contacts', { filter: 'team="noc"' });
    const second = getCollectionStore('contacts', { filter: 'team="network"' });

    expect(first).not.toBe(second);
  });

  it('keeps a stable identity when only batched filter values change', () => {
    const first = getCollectionStore('dynatrace_problem_notes', {
      batchedFilter: {
        key: 'loaded-problems',
        field: 'problemId',
        values: ['problem-1'],
        batchSize: 40,
      },
    });
    const second = getCollectionStore('dynatrace_problem_notes', {
      batchedFilter: {
        key: 'loaded-problems',
        field: 'problemId',
        values: ['problem-1', 'problem-2'],
        batchSize: 40,
      },
    });

    expect(first).toBe(second);
  });
});
