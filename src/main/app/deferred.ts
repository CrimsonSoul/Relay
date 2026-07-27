/**
 * A promise plus its settlers.
 *
 * `Promise.withResolvers` would do this, but it is ES2024 and this project compiles
 * against the ES2023 lib. Capturing the settlers in `let` bindings assigned inside the
 * executor is also not enough on its own: TypeScript does not track assignments made
 * from a nested function, so the bindings stay narrowed to their initial value at every
 * later use site. Seeding them with no-ops and returning them once the (synchronous)
 * executor has run gives callers non-nullable settlers.
 */
export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

export function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  // The Promise executor runs synchronously, so both bindings hold the real settlers.
  return { promise, resolve, reject };
}
