export type AuthorityMutationCoordinatorPort = {
  run<T>(operation: () => Promise<T>): Promise<T>;
};

export class AuthorityMutationCoordinator implements AuthorityMutationCoordinatorPort {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
