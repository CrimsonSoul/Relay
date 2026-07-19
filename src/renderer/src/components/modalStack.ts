import { useEffect, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let stack: string[] = [];
let revision = 0;

function emit(): void {
  revision += 1;
  document.body.classList.toggle('modal-open', stack.length > 0);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return revision;
}

function register(id: string): () => void {
  stack = [...stack.filter((candidate) => candidate !== id), id];
  emit();
  return () => {
    stack = stack.filter((candidate) => candidate !== id);
    emit();
  };
}

export function useModalStack(id: string, mounted: boolean): boolean {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!mounted) return;
    return register(id);
  }, [id, mounted]);

  return mounted && stack.at(-1) === id;
}
