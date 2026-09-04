import type { KnowledgeUploadQueueView, KnowledgeUploadSelectionResult } from '@shared/knowledge';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import type { PrivilegedRuntime } from '../privileged/privilegedRuntime';
import { KnowledgeUploadService } from '../knowledge/KnowledgeUploadService';
import {
  createEmptyKnowledgeUploadQueue,
  type KnowledgeUploadQueueState,
} from '../knowledge/KnowledgeUploadQueueStore';
import {
  WebKnowledgeUploadStaging,
  type WebKnowledgeStagingBatch,
} from './WebKnowledgeUploadStaging';
import type { WebSessionStore } from './WebSessionStore';

type UploadServicePort = Pick<
  KnowledgeUploadService,
  | 'start'
  | 'refresh'
  | 'queuePaths'
  | 'pauseBatch'
  | 'resumeBatch'
  | 'retryUpload'
  | 'reselectSource'
  | 'cancelUpload'
  | 'cancelBatch'
  | 'handleSessionChanged'
  | 'dispose'
>;

type UploadServiceFactoryOptions = {
  emitSnapshot: (snapshot: KnowledgeUploadQueueView) => void;
};

type WebKnowledgeSessionOptions = {
  // Staging directories and queue identity must survive cookie rotation, so this is the
  // stable logical session id rather than the rotating browser cookie value.
  logicalSessionId: string;
  sessions: WebSessionStore;
  runtime: PrivilegedRuntime;
  rootDir: string;
  createUploadService?: (options: UploadServiceFactoryOptions) => UploadServicePort;
  onDispose?: () => void;
};

type AppendInput = Parameters<WebKnowledgeUploadStaging['append']>[0];

function disposeRejectedKnowledgeSession(
  upload: UploadServicePort,
  staging: WebKnowledgeUploadStaging,
): void {
  void upload.dispose();
  void staging.dispose();
}

function memoryQueueStore() {
  let queue: KnowledgeUploadQueueState = createEmptyKnowledgeUploadQueue(false);
  return {
    async load(): Promise<KnowledgeUploadQueueState> {
      return structuredClone(queue);
    },
    async save(next: KnowledgeUploadQueueState): Promise<void> {
      queue = structuredClone(next);
    },
  };
}

export class WebKnowledgeSession {
  readonly localSourceId: string;
  private readonly upload: UploadServicePort;
  private readonly staging: WebKnowledgeUploadStaging;
  private ready: Promise<void> | null = null;
  private readonly stopRuntime: () => void;
  private disposePromise: Promise<void> | null = null;

  constructor(private readonly options: WebKnowledgeSessionOptions) {
    this.localSourceId = `web-${options.logicalSessionId}`;
    const emitSnapshot = (snapshot: KnowledgeUploadQueueView) => {
      options.sessions.publishByRateLimitId(
        options.logicalSessionId,
        'knowledge-upload-queue-changed',
        snapshot,
      );
    };
    this.upload = options.createUploadService
      ? options.createUploadService({ emitSnapshot })
      : new KnowledgeUploadService({
          getRuntime: () => options.runtime,
          store: memoryQueueStore(),
          emitSnapshot,
        });
    this.staging = new WebKnowledgeUploadStaging({
      rootDir: options.rootDir,
      sessionId: options.logicalSessionId,
      localSourceId: this.localSourceId,
      queuePaths: async (paths, localSourceId, replacementDocumentId, reselectUploadId) => {
        if (reselectUploadId) {
          const accepted =
            paths.length === 1 &&
            (await this.upload.reselectSource(reselectUploadId, undefined, paths[0]));
          return accepted
            ? { ok: true, uploads: (await this.upload.refresh()).items }
            : { ok: false, error: 'invalid-file' };
        }
        return replacementDocumentId
          ? this.upload.queuePaths(paths, localSourceId, replacementDocumentId)
          : this.upload.queuePaths(paths, localSourceId);
      },
    });
    this.stopRuntime = options.runtime.onSessionChanged((view: PrivilegedSessionView) => {
      this.upload.handleSessionChanged(view);
    });
    if (
      !options.sessions.registerCleanupByRateLimitId(options.logicalSessionId, () => this.dispose())
    ) {
      this.stopRuntime();
      disposeRejectedKnowledgeSession(this.upload, this.staging);
      throw new TypeError('Ordinary web session is unavailable.');
    }
  }

  async begin(
    files: ReadonlyArray<{ name: string; size: number }>,
    replacementDocumentId?: string,
    reselectUploadId?: string,
  ): Promise<WebKnowledgeStagingBatch> {
    await this.ensureReady();
    return this.staging.begin(files, replacementDocumentId, reselectUploadId);
  }

  async append(input: AppendInput): Promise<void> {
    await this.ensureReady();
    await this.staging.append(input);
  }

  async commit(batchId: string): Promise<KnowledgeUploadSelectionResult> {
    await this.ensureReady();
    return this.staging.commit(batchId);
  }

  async abort(batchId: string): Promise<void> {
    await this.staging.abort(batchId);
  }

  pending(): WebKnowledgeStagingBatch | null {
    return this.staging.pending();
  }

  async getQueue(): Promise<KnowledgeUploadQueueView> {
    await this.ensureReady();
    return this.upload.refresh();
  }

  async pauseBatch(id: string): Promise<void> {
    await this.ensureReady();
    this.upload.pauseBatch(id);
  }

  async resumeBatch(id: string): Promise<void> {
    await this.ensureReady();
    this.upload.resumeBatch(id);
  }

  async retryUpload(id: string): Promise<void> {
    await this.ensureReady();
    this.upload.retryUpload(id);
  }

  async cancelUpload(id: string): Promise<void> {
    await this.ensureReady();
    await this.upload.cancelUpload(id);
  }

  async cancelBatch(id: string): Promise<void> {
    await this.ensureReady();
    await this.upload.cancelBatch(id);
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.stopRuntime();
    this.options.onDispose?.();
    this.disposePromise = (async () => {
      await this.ready?.catch(() => undefined);
      await this.upload.dispose();
      await this.staging.dispose();
    })();
    return this.disposePromise;
  }

  private ensureReady(): Promise<void> {
    this.ready ??= this.upload.start();
    return this.ready;
  }
}
