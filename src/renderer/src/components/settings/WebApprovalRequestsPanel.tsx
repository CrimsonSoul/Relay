import React, { useEffect, useState } from 'react';
import type {
  PrivilegedApprovalCodeView,
  PrivilegedApprovalRequestView,
  PrivilegedIpcError,
} from '@shared/ipc';
import { TactileButton } from '../TactileButton';

type Props = { relayMode: 'server' | 'client' | null };

function operationLabel(operation: PrivilegedApprovalRequestView['operation']): string {
  return operation === 'initial-owner-credential'
    ? 'Initial Owner credential'
    : 'Protected credential recovery';
}

function expiryLabel(expiresAt: string): string {
  const value = new Date(expiresAt);
  return Number.isNaN(value.getTime())
    ? 'Soon'
    : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(value);
}

const APPROVAL_ERRORS: Record<PrivilegedIpcError, string> = {
  'invalid-input': 'Relay rejected that approval request.',
  'invalid-credentials': 'Relay rejected that approval request.',
  unauthorized: 'This session is not allowed to approve browser requests.',
  locked: 'Privileged access is signed out. Sign in again.',
  offline: 'Relay is offline. Restore the connection and try again.',
  'pairing-required': 'Pair this workstation before approving browser requests.',
  conflict: 'That request already changed. Refresh and try again.',
  'rate-limited': 'Too many attempts. Wait a few minutes and try again.',
  'approval-required': 'Approve this request on the Relay server PC and try again.',
  'server-error': 'Relay could not issue an approval code. Try again.',
};

function retainIssuedCodes(
  current: Record<string, PrivilegedApprovalCodeView>,
  requests: PrivilegedApprovalRequestView[],
): Record<string, PrivilegedApprovalCodeView> {
  const activeIds = new Set(requests.map(({ requestId }) => requestId));
  return Object.fromEntries(
    Object.entries(current).filter(([requestId]) => activeIds.has(requestId)),
  );
}

function ApprovalRequestsContent() {
  const [requests, setRequests] = useState<PrivilegedApprovalRequestView[]>([]);
  const [issued, setIssued] = useState<Record<string, PrivilegedApprovalCodeView>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  // A failed load must never be drawn as an empty queue: an operator who reads
  // "No browser requests waiting" stops looking for the request that is actually
  // pending on the server.
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const api = globalThis.api!;
    void api
      .listWebApprovalRequests()
      .then((next) => {
        if (!active) return;
        setRequests(next);
        setLoadFailed(false);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    const unsubscribe = api.onWebApprovalRequestsChanged((next) => {
      if (!active) return;
      setRequests(next);
      setLoadFailed(false);
      setIssued((current) => retainIssuedCodes(current, next));
    });
    return () => {
      active = false;
      unsubscribe();
      setIssued({});
    };
  }, []);

  const generate = async (requestId: string) => {
    setBusyId(requestId);
    setActionError(null);
    try {
      const result = await globalThis.api!.generateWebApprovalCode(requestId);
      if (result.ok) setIssued((current) => ({ ...current, [requestId]: result.value }));
      else setActionError(APPROVAL_ERRORS[result.error]);
    } catch {
      setActionError(APPROVAL_ERRORS['server-error']);
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (requestId: string) => {
    setBusyId(requestId);
    setActionError(null);
    try {
      if (await globalThis.api!.cancelWebApprovalRequest(requestId)) {
        setRequests((current) => current.filter((request) => request.requestId !== requestId));
        setIssued((current) => {
          const next = { ...current };
          delete next[requestId];
          return next;
        });
      } else {
        setActionError('Relay could not cancel that request. Refresh and try again.');
      }
    } catch {
      setActionError('Relay could not cancel that request. Refresh and try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      className="settings-section web-approval-requests"
      aria-labelledby="web-approvals-title"
    >
      <header>
        <div className="settings-section-heading">Local approval</div>
        <h3 id="web-approvals-title">Browser approval requests</h3>
        <p className="settings-description">
          Codes work once, expire after ten minutes, and approve only the browser and action shown.
        </p>
      </header>
      {actionError ? (
        <div className="administration-feedback administration-feedback--error" role="alert">
          {actionError}
        </div>
      ) : null}
      {loadFailed && requests.length === 0 ? (
        <div className="administration-callout" role="alert">
          <strong>Browser requests could not be loaded</strong>
          <span>
            Relay does not know whether any browser is waiting. Reopen settings to try again.
          </span>
        </div>
      ) : null}
      {!loadFailed && requests.length === 0 ? (
        <div className="administration-callout">
          <strong>No browser requests waiting</strong>
          <span>Requests appear here when a browser needs protected credential approval.</span>
        </div>
      ) : null}
      {requests.length > 0 && (
        <div className="web-approval-requests__list">
          {requests.map((request) => {
            const code = issued[request.requestId]?.code;
            return (
              <article className="administration-callout" key={request.requestId}>
                <strong>{operationLabel(request.operation)}</strong>
                <span>{request.sourceLabel}</span>
                <span>Expires {expiryLabel(request.expiresAt)}</span>
                {code ? (
                  <output className="privileged-access__challenge-code" aria-label="Approval code">
                    {code}
                  </output>
                ) : null}
                <div className="administration-actions">
                  <TactileButton
                    type="button"
                    size="sm"
                    variant="primary"
                    loading={busyId === request.requestId}
                    onClick={() => void generate(request.requestId)}
                    aria-label="Generate approval code"
                  >
                    Generate code
                  </TactileButton>
                  <TactileButton
                    type="button"
                    size="sm"
                    disabled={busyId !== null}
                    onClick={() => void cancel(request.requestId)}
                    aria-label="Cancel approval request"
                  >
                    Cancel
                  </TactileButton>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function WebApprovalRequestsPanel({ relayMode }: Readonly<Props>) {
  if (relayMode !== 'server' || globalThis.api?.runtime?.kind !== 'electron') return null;
  return <ApprovalRequestsContent />;
}
