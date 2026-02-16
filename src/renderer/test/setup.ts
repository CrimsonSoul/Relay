import '@testing-library/jest-dom';

function hasUsableLocalStorage(value: unknown): value is Storage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Storage).getItem === 'function' &&
    typeof (value as Storage).setItem === 'function' &&
    typeof (value as Storage).removeItem === 'function' &&
    typeof (value as Storage).clear === 'function'
  );
}

if (!hasUsableLocalStorage(globalThis.localStorage)) {
  const store = new Map<string, string>();
  const fallbackStorage = {
    get length() {
      return store.size;
    },
    clear: () => {
      for (const key of store.keys()) {
        delete (fallbackStorage as Record<string, unknown>)[key];
      }
      store.clear();
    },
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
      delete (fallbackStorage as Record<string, unknown>)[key];
    },
    setItem: (key: string, value: string) => {
      const serialized = String(value);
      store.set(key, serialized);
      Object.defineProperty(fallbackStorage, key, {
        value: serialized,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    },
  } satisfies Storage;

  Object.defineProperty(globalThis, 'localStorage', {
    value: fallbackStorage,
    configurable: true,
    writable: true,
  });
}
