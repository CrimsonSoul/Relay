import React, { useEffect, useState } from 'react';
import type { PrivilegedApprovalCodeView, PrivilegedApprovalRequestView } from '@shared/ipc';
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

  useEffect(() => {
    let active = true;
    const api = globalThis.api!;
    void api
      .listWebApprovalRequests()
      .then((next) => {
        if (active) setRequests(next);
      })
      .catch(() => undefined);
    const unsubscribe = api.onWebApprovalRequestsChanged((next) => {
      if (!active) return;
      setRequests(next);
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
    try {
      const result = await globalThis.api!.generateWebApprovalCode(requestId);
      if (result.ok) setIssued((current) => ({ ...current, [requestId]: result.value }));
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (requestId: string) => {
    setBusyId(requestId);
    try {
      if (await globalThis.api!.cancelWebApprovalRequest(requestId)) {
        setRequests((current) => current.filter((request) => request.requestId !== requestId));
        setIssued((current) => {
          const next = { ...current };
          delete next[requestId];
          return next;
        });
      }
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
      {requests.length === 0 ? (
        <div className="administration-callout">
          <strong>No browser requests waiting</strong>
          <span>Requests appear here when a browser needs protected credential approval.</span>
        </div>
      ) : (
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
