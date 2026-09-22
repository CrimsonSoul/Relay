import type { SdpBulkMutation, SdpBulkResult } from '@shared/sdpMutation';
import { mutationBaseline, submitMutation } from './SdpMutations';
import { SdpProviderError, type SdpProvider } from './SdpProvider';

export class SdpBulkDeniedError extends SdpProviderError {
  constructor(readonly results: SdpBulkResult) {
    super('denied');
  }
}

/** Bounded batches retain independent outcomes; SDP does not promise a transaction. */
export async function prepareBulk(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  mutation: SdpBulkMutation,
  ensureCurrent: () => void,
): Promise<string> {
  const baselines: Record<string, string> = {};
  for (const id of mutation.ids) {
    ensureCurrent();
    baselines[id] = await mutationBaseline(provider, token, signal, id);
    ensureCurrent();
  }
  return JSON.stringify(baselines);
}

export async function confirmBulk(
  provider: SdpProvider,
  token: string,
  signal: AbortSignal,
  mutation: SdpBulkMutation,
  baseline: string,
  ensureCurrent: () => void,
): Promise<SdpBulkResult> {
  const baselines = JSON.parse(baseline) as Record<string, string>;
  const results: SdpBulkResult = mutation.ids.map((id) => ({ id, status: 'not-attempted' }));
  // Reject changed batches before any write, then recheck each record immediately before its write.
  for (const result of results) {
    ensureCurrent();
    if ((await mutationBaseline(provider, token, signal, result.id)) !== baselines[result.id]) {
      result.status = 'conflict';
      return results;
    }
  }
  for (const result of results) {
    ensureCurrent();
    try {
      if ((await mutationBaseline(provider, token, signal, result.id)) !== baselines[result.id]) {
        result.status = 'conflict';
        break;
      }
      ensureCurrent();
      await submitMutation(provider, token, signal, {
        kind: 'update',
        id: result.id,
        fields: mutation.fields,
      });
      ensureCurrent();
      result.status = 'confirmed';
    } catch (error) {
      // A timeout, denial, warning or partial response is never a reason to continue or retry.
      result.status = 'uncertain';
      if (error instanceof SdpProviderError && error.kind === 'denied')
        throw new SdpBulkDeniedError(results);
      break;
    }
  }
  return results;
}
