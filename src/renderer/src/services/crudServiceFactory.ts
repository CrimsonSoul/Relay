import type { RecordListOptions } from 'pocketbase';
import { getPb, handleApiError, requireOnline } from './pocketbase';
import { isPbNotFoundError } from './pbErrors';

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
      requireOnline();
      try {
        return await getPb().collection(collectionName).create<T>(data);
      } catch (err) {
        handleApiError(err);
        throw err;
      }
    },

    async update(id: string, data: Partial<T>): Promise<T> {
      requireOnline();
      try {
        return await getPb().collection(collectionName).update<T>(id, data);
      } catch (err) {
        handleApiError(err);
        throw err;
      }
    },

    async remove(id: string): Promise<void> {
      requireOnline();
      try {
        await getPb().collection(collectionName).delete(id);
      } catch (err) {
        handleApiError(err);
        throw err;
      }
    },
  };
}
