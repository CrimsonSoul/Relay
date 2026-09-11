import { expect, it } from 'vitest';
import { collectionRevisionSignature } from './cacheSnapshot';

it('preserves existing UTF-16 snapshot signatures for non-BMP record values', () => {
  expect(collectionRevisionSignature([{ id: 'row😀', updated: 'updated' }])).toBe(
    '1:ddc6f47a138832f5',
  );
});
