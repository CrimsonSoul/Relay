import '@testing-library/jest-dom';

const jsdomGlobal = globalThis as typeof globalThis & {
  jsdom?: {
    virtualConsole?: {
      removeAllListeners: (event: string) => void;
      on: (event: string, listener: (error: Error & { type?: string }) => void) => void;
    };
  };
};

jsdomGlobal.jsdom?.virtualConsole?.removeAllListeners('jsdomError');
jsdomGlobal.jsdom?.virtualConsole?.on('jsdomError', (error) => {
  if (
    error.type === 'not-implemented' &&
    error.message.includes('navigation to another Document')
  ) {
    return;
  }
  console.error(error);
});

// Mock showModal/close since jsdom doesn't support HTMLDialogElement methods
HTMLDialogElement.prototype.showModal =
  HTMLDialogElement.prototype.showModal ||
  function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
HTMLDialogElement.prototype.close =
  HTMLDialogElement.prototype.close ||
  function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };

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

const originalAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
  if (this.download && this.href.startsWith('blob:')) {
    this.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return;
  }
  originalAnchorClick.call(this);
};
