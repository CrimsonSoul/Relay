import type { PrivilegedRuntime } from './privilegedRuntime';
import { WebApprovalCodeStore } from '../web/WebApprovalCodeStore';

export type PrivilegedRuntimeSource =
  | { kind: 'electron' }
  | {
      kind: 'web';
      sessionId: string;
      browserFamily: 'Chrome' | 'Edge' | 'Safari' | 'Other';
      addressLabel: string;
    };

export type WebPrivilegedRuntimeSource = Omit<
  Extract<PrivilegedRuntimeSource, { kind: 'web' }>,
  'kind'
>;

type ProductionPrivilegedHostOptions = {
  createRuntime(source: PrivilegedRuntimeSource): PrivilegedRuntime;
  disposeShared(): void | Promise<void>;
};

function validBounded(value: string, max: number): boolean {
  const characters = [...value];
  return (
    characters.length > 0 &&
    characters.length <= max &&
    characters.every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
  );
}

export class ProductionPrivilegedHost {
  readonly approvalCodes: WebApprovalCodeStore;
  private electronRuntime: PrivilegedRuntime | null = null;
  private readonly webRuntimes = new Map<string, PrivilegedRuntime>();
  private disposePromise: Promise<void> | null = null;

  constructor(
    private readonly options: ProductionPrivilegedHostOptions,
    approvalCodes = new WebApprovalCodeStore(),
  ) {
    this.approvalCodes = approvalCodes;
  }

  createElectronRuntime(): PrivilegedRuntime {
    this.assertAvailable();
    this.electronRuntime ??= this.options.createRuntime({ kind: 'electron' });
    return this.electronRuntime;
  }

  createWebRuntime(input: {
    sessionId: string;
    source: Omit<WebPrivilegedRuntimeSource, 'sessionId'>;
  }): PrivilegedRuntime {
    this.assertAvailable();
    if (!validBounded(input.sessionId, 128) || !validBounded(input.source.addressLabel, 128)) {
      throw new TypeError('Invalid web session metadata.');
    }
    if (this.webRuntimes.has(input.sessionId)) {
      throw new TypeError('Privileged web session already exists.');
    }
    const runtime = this.options.createRuntime({
      kind: 'web',
      sessionId: input.sessionId,
      ...input.source,
    });
    this.webRuntimes.set(input.sessionId, runtime);
    return runtime;
  }

  getWebRuntime(sessionId: string): PrivilegedRuntime | null {
    return this.webRuntimes.get(sessionId) ?? null;
  }

  async disposeWebRuntime(sessionId: string): Promise<void> {
    const runtime = this.webRuntimes.get(sessionId);
    if (!runtime) return;
    this.webRuntimes.delete(sessionId);
    await runtime.dispose();
  }

  handleAuthorityChanged(accountIds: readonly string[]): void {
    this.electronRuntime?.handleAuthorityChanged(accountIds);
    for (const runtime of this.webRuntimes.values()) {
      runtime.handleAuthorityChanged(accountIds);
    }
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = (async () => {
      const children = [this.electronRuntime, ...this.webRuntimes.values()].filter(
        (runtime): runtime is PrivilegedRuntime => runtime !== null,
      );
      this.electronRuntime = null;
      this.webRuntimes.clear();
      this.approvalCodes.clear();
      const settled = await Promise.allSettled(children.map((runtime) => runtime.dispose()));
      await this.options.disposeShared();
      const failed = settled.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failed) throw failed.reason;
    })();
    return this.disposePromise;
  }

  private assertAvailable(): void {
    if (this.disposePromise) throw new TypeError('Privileged host is disposed.');
  }
}
