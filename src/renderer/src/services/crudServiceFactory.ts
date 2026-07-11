import type { RecordListOptions } from 'pocketbase';
import { getPb, handleApiError } from './pocketbase';
import { isPbNotFoundError } from './pbErrors';
import type { OfflineWritableCollection } from '@shared/ipc';
import { mutateCollection } from './mutationGateway';

export interface CrudService<T> {
  getAll(options?: RecordListOptions): Promise<T[]>;
  getOne(id: string): Promise<T | null>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  remove(id: string): Promise<void>;
}

export function createCrudService<T>(collectionName: string): CrudService<T> {
  return {
    async getAll(options?: RecordListOptions): Promise<T[]> {
      try {
        return await getPb().collection(collectionName).getFullList<T>(options);
      } catch (err) {
        handleApiError(err);
        throw err;
      }
    },

    async getOne(id: string): Promise<T | null> {
      try {
        return await getPb().collection(collectionName).getOne<T>(id);
      } catch (err: unknown) {
        if (isPbNotFoundError(err)) return null;
        handleApiError(err);
        throw err;
      }
    },

    async create(data: Partial<T>): Promise<T> {
      return (await mutateCollection<T>(
        collectionName as OfflineWritableCollection,
        'create',
        undefined,
        data as Record<string, unknown>,
      )) as T;
    },

    async update(id: string, data: Partial<T>): Promise<T> {
      return (await mutateCollection<T>(
        collectionName as OfflineWritableCollection,
        'update',
        id,
        data as Record<string, unknown>,
      )) as T;
    },

    async remove(id: string): Promise<void> {
      await mutateCollection(collectionName as OfflineWritableCollection, 'delete', id);
    },
  };
}
