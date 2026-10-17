/** Serializes Wiki mutations and shares one result between retries of the same request ID. */
export class KnowledgeMutationCoordinator {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private mutationTail: Promise<void> = Promise.resolve();

  run<T>(input: { requestId: string; mutate: () => Promise<T> }): Promise<T> {
    const existing = this.inFlight.get(input.requestId);
    if (existing) return existing as Promise<T>;
    const operation = this.mutationTail.then(input.mutate);
    this.mutationTail = operation.then(
      () => undefined,
      () => undefined,
    );
    this.inFlight.set(input.requestId, operation);
    void operation.then(
      () => {
        if (this.inFlight.get(input.requestId) === operation) {
          this.inFlight.delete(input.requestId);
        }
      },
      () => {
        if (this.inFlight.get(input.requestId) === operation) {
          this.inFlight.delete(input.requestId);
        }
      },
    );
    return operation;
  }
}
