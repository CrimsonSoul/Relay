import type { OfflineWritableCollection } from '@shared/ipc';
import { mutateCollection } from './mutationGateway';

/** Writes for a collection; reads go through `useCollection` stores. */
interface CrudService<T> {
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  remove(id: string): Promise<void>;
}

export function createCrudService<T>(collectionName: string): CrudService<T> {
  return {
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
