import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import type { PrivilegedRuntime } from '../privileged/privilegedRuntime';
import type { ProductionPrivilegedHost } from '../privileged/ProductionPrivilegedHost';
import {
  getPrivilegedHost,
  getPrivilegedRuntime,
  notifyKnowledgeUploadSessionChanged,
  setPrivilegedHost,
  setPrivilegedRuntime,
} from './appState';

type PrivilegedRuntimeReplacement = Readonly<{
  host: ProductionPrivilegedHost | null;
  runtime: PrivilegedRuntime;
}>;

type PrivilegedRuntimeFactory = () =>
  PrivilegedRuntimeReplacement | Promise<PrivilegedRuntimeReplacement>;

const signedOutView = (): PrivilegedSessionView => ({
  state: 'signed-out',
  accountId: null,
  username: null,
  displayName: null,
  role: null,
  capabilities: [],
  deviceId: null,
  expiresAt: null,
});

export async function stopPrivilegedRuntime(): Promise<void> {
  const runtime = getPrivilegedRuntime();
  const host = getPrivilegedHost();
  if (!runtime && !host) return;

  setPrivilegedRuntime(null);
  setPrivilegedHost(null);
  notifyKnowledgeUploadSessionChanged(signedOutView());
  await (host?.dispose() ?? runtime?.dispose());
}

export async function replacePrivilegedRuntime(
  nextFactory: PrivilegedRuntimeFactory,
): Promise<void> {
  await stopPrivilegedRuntime();
  const { host, runtime } = await nextFactory();
  setPrivilegedHost(host);
  setPrivilegedRuntime(runtime);
  notifyKnowledgeUploadSessionChanged(runtime.getView());
}
