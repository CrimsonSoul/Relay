import PocketBase from 'pocketbase';
import { RELAY_APP_USER_EMAIL } from '@shared/ipc';
import {
  getAppConfig,
  getKnowledgeSearchService,
  getOfflineCache,
  getPbClient,
  setKnowledgeSearchService,
} from '../app/appState';
import { loggers } from '../logger';
import { KnowledgeSearchService } from './KnowledgeSearchService';

const AUTH_DEADLINE_MS = 15_000;
const DISPOSE_DEADLINE_MS = 1_000;

function knowledgeLogger(): typeof loggers.main {
  return (loggers as unknown as { knowledge?: typeof loggers.main }).knowledge ?? loggers.main;
}

let lifecycleTail: Promise<void> = Promise.resolve();
let lifecycleGeneration = 0;
let activeAuthentication: { generation: number; controller: AbortController } | null = null;
type CapturedDisposal = Promise<{ error?: unknown }>;

function serializeLifecycle(operation: () => Promise<void>): Promise<void> {
  const next = lifecycleTail.then(operation, operation);
  lifecycleTail = next.catch(() => undefined);
  return next;
}

function timeoutAfter(
  milliseconds: number,
  message: string,
): {
  promise: Promise<never>;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref?.();
  });
  return {
    promise,
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

function invalidateOwnership(): {
  generation: number;
  disposal: CapturedDisposal | null;
} {
  const generation = ++lifecycleGeneration;
  const service = getKnowledgeSearchService();
  setKnowledgeSearchService(null);
  activeAuthentication?.controller.abort();
  activeAuthentication = null;
  return { generation, disposal: captureDisposal(service) };
}

function captureDisposal(service: KnowledgeSearchService | null): CapturedDisposal | null {
  if (!service) return null;
  let disposal: void | Promise<void>;
  // Disposal must begin synchronously; this boundary also contains a synchronous mock/port throw.
  // eslint-disable-next-line sonarjs/no-try-promise
  try {
    disposal = service.dispose();
  } catch (error) {
    return Promise.resolve({ error });
  }
  return Promise.resolve(disposal).then(
    () => ({}),
    (error: unknown) => ({ error }),
  );
}

async function awaitDisposal(disposal: CapturedDisposal | null): Promise<void> {
  if (!disposal) return;
  const deadline = timeoutAfter(DISPOSE_DEADLINE_MS, 'knowledge-search-dispose-timeout');
  try {
    const result = await Promise.race([disposal, deadline.promise]);
    if (result.error) throw result.error;
  } catch (error) {
    knowledgeLogger().warn('Enhanced Wiki search shutdown failed', { error });
  } finally {
    deadline.cancel();
  }
}

async function restartRuntime(
  generation: number,
  previousDisposal: CapturedDisposal | null,
): Promise<void> {
  await awaitDisposal(previousDisposal);
  if (generation !== lifecycleGeneration) return;

  try {
    const config = getAppConfig()?.load();
    const service = new KnowledgeSearchService(
      config?.mode === 'client'
        ? { cache: getOfflineCache(), cacheIdentity: config.serverUrl }
        : { cache: null },
    );
    if (generation !== lifecycleGeneration) {
      await awaitDisposal(captureDisposal(service));
      return;
    }
    setKnowledgeSearchService(service);
    if (!config) return;
    if (config.mode === 'server') {
      await service.start(getPbClient());
      return;
    }
    const pb = new PocketBase(config.serverUrl);
    await service.start(null);
    if (generation !== lifecycleGeneration) return;
    const controller = new AbortController();
    activeAuthentication = { generation, controller };
    const deadline = timeoutAfter(AUTH_DEADLINE_MS, 'knowledge-search-auth-timeout');
    try {
      await Promise.race([
        pb.collection('_pb_users_auth_').authWithPassword(RELAY_APP_USER_EMAIL, config.secret, {
          requestKey: null,
          signal: controller.signal,
        }),
        deadline.promise,
      ]);
    } catch (error) {
      controller.abort();
      throw error;
    } finally {
      deadline.cancel();
      if (activeAuthentication?.generation === generation) activeAuthentication = null;
    }
    if (generation !== lifecycleGeneration) return;
    await service.connect(pb);
  } catch (error) {
    knowledgeLogger().warn('Enhanced Wiki search is unavailable', { error });
  }
}

export function restartKnowledgeSearchRuntime(): Promise<void> {
  const { generation, disposal } = invalidateOwnership();
  return serializeLifecycle(() => restartRuntime(generation, disposal));
}

export function stopKnowledgeSearchRuntime(): Promise<void> {
  const { generation, disposal } = invalidateOwnership();
  return serializeLifecycle(async () => {
    await awaitDisposal(disposal);
    if (generation !== lifecycleGeneration) return;
  });
}
