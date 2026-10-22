import type { SdpBulkMutation, SdpBulkResult } from '@shared/sdpMutation';
import { mutationBaseline, SdpChangeNotAppliedError, submitMutation } from './SdpMutations';
import { requireClosingFields } from './SdpForms';
import { SdpProviderError, SdpValidationError, type SdpProvider } from './SdpProvider';

export class SdpBulkDeniedError extends SdpProviderError {
  constructor(readonly results: SdpBulkResult) {
    super('denied');
  }
}
/** SDP verifiably kept a ticket's earlier values; the batch stopped with no ticket left uncertain. */
export class SdpBulkNotAppliedError extends Error {
  constructor(
    readonly results: SdpBulkResult,
    batch: boolean,
  ) {
    super(
      batch
        ? 'SDP did not apply the change to one ticket, so the batch stopped. Every ticket not marked confirmed is unchanged; refresh and check SDP before trying again.'
        : new SdpChangeNotAppliedError().message,
    );
  }
}
/** SDP refused a ticket's write outright; the batch stopped and SDP's reason is kept. */
export class SdpBulkRejectedError extends Error {
  constructor(
    readonly results: SdpBulkResult,
    rejection: SdpValidationError,
    batch: boolean,
  ) {
    super(
      batch
        ? `${rejection.message} The batch stopped at that ticket; every ticket not marked confirmed is unchanged.`
        : rejection.message,
    );
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
    await requireClosingFields(provider, token, signal, id, mutation.fields);
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
      failedTicket(results, result, error);
      break;
    }
  }
  return results;
}
/** A definite failure throws with the batch outcomes; any other leaves the ticket uncertain. */
function failedTicket(results: SdpBulkResult, result: SdpBulkResult[number], error: unknown): void {
  if (error instanceof SdpChangeNotAppliedError) {
    // A re-read showed the earlier values, so the ticket is as unchanged as one never sent.
    result.status = 'not-attempted';
    throw new SdpBulkNotAppliedError(results, results.length > 1);
  }
  if (error instanceof SdpValidationError) {
    // SDP refused the write, so the ticket is unchanged; later tickets would meet the same rule.
    result.status = 'not-attempted';
    throw new SdpBulkRejectedError(results, error, results.length > 1);
  }
  result.status = 'uncertain';
  if (error instanceof SdpProviderError && error.kind === 'denied')
    throw new SdpBulkDeniedError(results);
}
