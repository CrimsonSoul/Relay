import type { KnowledgeAuditAction } from '@shared/knowledge';

export class KnowledgeMutationCoordinator {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  run<T>(input: {
    requestId: string;
    action: KnowledgeAuditAction;
    mutate: () => Promise<T>;
  }): Promise<T> {
    const existing = this.inFlight.get(input.requestId);
    if (existing) return existing as Promise<T>;
    const operation = input.mutate().finally(() => this.inFlight.delete(input.requestId));
    this.inFlight.set(input.requestId, operation);
    return operation;
  }
}
