import { useEffect, useRef, useState } from 'react';
import type { SdpAccountView, SdpQueueTicket } from '@shared/sdpAccount';
import { sdpError, sdpInfo, type SdpNotice } from './SdpMessage';

const NOT_PREPARED = 'Could not prepare the pick up. Refresh the ticket and check your connection.';
const UNCERTAIN =
  'SDP did not confirm the pick up. Check the ticket in SDP before trying again; Relay will not retry it.';

/** SDP shows unassigned tickets without a technician; only those offer Pick Up in Relay. */
export const unassigned = (ticket: SdpQueueTicket): boolean =>
  !ticket.technician || ticket.technician === 'No technician';

async function submitPickUp(
  ticket: SdpQueueTicket,
): Promise<{ view?: SdpAccountView; message: SdpNotice }> {
  let submitted = false;
  try {
    const prepared = await globalThis.api!.sdpAccount!({
      action: 'prepareChange',
      mutation: { kind: 'pickup', id: ticket.id },
    });
    const review = prepared.success ? prepared.data?.review : undefined;
    if (!review) return { message: sdpError(prepared.data?.message ?? NOT_PREPARED) };
    // The review is consumed before submission; an uncertain response is never replayed.
    submitted = true;
    const result = await globalThis.api!.sdpAccount!({
      action: 'confirmChange',
      confirmationId: review.confirmationId,
    });
    if (!result.success || !result.data) return { message: sdpError(UNCERTAIN) };
    return {
      view: result.data,
      message: result.data.changeResult
        ? sdpInfo(`Picked up #${ticket.number}. SDP assigned it to you.`)
        : sdpError(result.data.message ?? UNCERTAIN),
    };
  } catch {
    return { message: sdpError(submitted ? UNCERTAIN : NOT_PREPARED) };
  }
}

/**
 * SDP's Pick Up assigns the ticket to the signed-in technician. One inline confirmation stands in
 * for the review dialog; the change is still a prepared, single-use live change.
 */
export function useSdpPickUp(ticket: SdpQueueTicket, onResult: (view: SdpAccountView) => void) {
  const [step, setStep] = useState<{ id: string; saving: boolean }>();
  const [notice, setNotice] = useState<{ id: string; message: SdpNotice }>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const current = step?.id === ticket.id ? step : undefined;
  async function confirm() {
    if (step?.saving) return;
    const picked = ticket;
    setStep({ id: picked.id, saving: true });
    setNotice(undefined);
    const outcome = await submitPickUp(picked);
    if (!alive.current) return;
    if (outcome.view) onResult(outcome.view);
    setNotice({ id: picked.id, message: outcome.message });
    setStep(undefined);
  }
  return {
    confirming: !!current,
    saving: !!current?.saving,
    // A success note stops applying once the ticket is unassigned again; a failure stays.
    message:
      notice?.id === ticket.id && (notice.message.tone === 'error' || !unassigned(ticket))
        ? notice.message
        : undefined,
    begin: () => {
      setNotice(undefined);
      setStep({ id: ticket.id, saving: false });
    },
    cancel: () => {
      if (!step?.saving) setStep(undefined);
    },
    confirm,
  };
}
