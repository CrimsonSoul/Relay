import { describe, expect, it } from 'vitest';
import type { RecordModel } from 'pocketbase';
import { CollectionStore, collectionRevisionSignature } from '../collectionStore';

describe('CollectionStore', () => {
  it('starts with a stable loading snapshot and no records', () => {
    const store = new CollectionStore<RecordModel>('contacts', {});

    expect(store.getSnapshot()).toBe(store.getSnapshot());
    expect(store.getSnapshot()).toEqual({ data: [], loading: true, error: null });
  });

  it('produces the same revision for unchanged record metadata', () => {
    const records = [{ id: 'one', updated: '2026-07-10' }];

    expect(collectionRevisionSignature(records)).toBe(collectionRevisionSignature([...records]));
  });
});
