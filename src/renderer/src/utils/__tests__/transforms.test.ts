import { describe, expect, it } from 'vitest';
import { toGroup } from '../transforms';
import type { BridgeGroupRecord } from '../../services/bridgeGroupService';

describe('transforms', () => {
  describe('toGroup', () => {
    it('converts a BridgeGroupRecord to a BridgeGroup', () => {
      const record: BridgeGroupRecord = {
        id: 'bg1',
        name: 'NOC',
        contacts: ['c1', 'c2'],
        created: '2024-01-01T00:00:00Z',
        updated: '2024-06-15T12:30:00Z',
      };

      const group = toGroup(record);

      expect(group).toEqual({
        id: 'bg1',
        name: 'NOC',
        contacts: ['c1', 'c2'],
        createdAt: new Date('2024-01-01T00:00:00Z').getTime(),
        updatedAt: new Date('2024-06-15T12:30:00Z').getTime(),
      });
    });

    it('defaults contacts to empty array when contacts is falsy', () => {
      const record = {
        id: 'bg2',
        name: 'Empty',
        contacts: undefined as unknown as string[],
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      } as BridgeGroupRecord;

      const group = toGroup(record);

      expect(group.contacts).toEqual([]);
    });

    it('defaults contacts to empty array when contacts is null', () => {
      const record = {
        id: 'bg3',
        name: 'Null',
        contacts: null as unknown as string[],
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      } as BridgeGroupRecord;

      const group = toGroup(record);

      expect(group.contacts).toEqual([]);
    });

    it('defaults contacts to empty array when contacts is empty string', () => {
      const record = {
        id: 'bg4',
        name: 'EmptyStr',
        contacts: '' as unknown as string[],
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      } as BridgeGroupRecord;

      const group = toGroup(record);

      expect(group.contacts).toEqual([]);
    });
  });
});
