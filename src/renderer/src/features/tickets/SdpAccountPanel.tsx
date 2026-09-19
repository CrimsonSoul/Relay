import { resetSdpNotifications } from './SdpAlerts';
import { useEffect, useRef, useState } from 'react';
import { type SdpAccountCommand, type SdpAccountView } from '@shared/sdpAccount';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';

export function SdpAccountPanel({ onClose }: Readonly<{ onClose: () => void }>) {
  const [view, setView] = useState<SdpAccountView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const actionEpoch = useRef(0);
  const actionPending = useRef(false);
  const invoke = globalThis.api?.sdpAccount;
  const available = globalThis.api?.runtime.kind === 'electron' && !!invoke;
  useEffect(() => {
    if (!available) return;
    let active = true;
    let pending = false;
    const poll = async () => {
      if (pending || actionPending.current) return;
      const epoch = actionEpoch.current;
      pending = true;
      try {
        const result = await invoke!({ action: 'status' });
        if (epoch !== actionEpoch.current) return;
        if (active && result.success && result.data) {
          setView(result.data);
          setError('');
        } else if (active) {
          setView(undefined);
          setError(result.error ?? 'Could not read SDP connection status.');
        }
      } catch {
        if (active && epoch === actionEpoch.current) {
          setView(undefined);
          setError('Could not read SDP connection status.');
        }
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [available, invoke]);

  useEffect(() => {
    if (!view?.snapshot) return;
    const timer = setTimeout(
      () =>
        setView((current) =>
          current ? { ...current, ticket: undefined, snapshot: undefined } : current,
        ),
      Math.max(0, view.snapshot.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [view?.snapshot]);

  async function run(command: SdpAccountCommand) {
    if (command.action === 'disconnect') resetSdpNotifications();
    actionEpoch.current++;
    actionPending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await invoke!(command);
      if (!result.success || !result.data)
        throw new Error(result.error ?? 'SDP connection failed.');
      setView(result.data);
    } catch (reason) {
      setView(undefined);
      setError(reason instanceof Error ? reason.message : 'SDP connection failed.');
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      dialogClassName="modal-dialog-generic sdp-ticket-dialog"
      isOpen
      title="Your SDP connection"
      subtitle="Your work account · Reviewed changes"
      onClose={onClose}
      footer={<TactileButton onClick={onClose}>Done</TactileButton>}
    >
      <div className="sdp-account-panel">
        <p>
          Your work account determines access in SDP. This connection belongs to this desktop
          session.
        </p>
        {!available ? (
          <p role="status">
            Open Relay desktop to connect your SDP account. Web sign-in is not available yet.
          </p>
        ) : (
          <>
            {!view && !error && <p role="status">Checking connection…</p>}
            {view && (
              <div className="sdp-account-status" role="status">
                <strong>
                  {
                    {
                      disconnected: 'Not connected',
                      connecting: 'Waiting for Zoho',
                      connected: 'Connected to SDP',
                      expired: 'Session expired',
                    }[view.status]
                  }
                </strong>
                <span>
                  {view.message ??
                    (view.status === 'connecting'
                      ? 'Complete sign-in in your browser, then return here.'
                      : 'Passwords and MFA stay with your work sign-in provider.')}
                </span>
              </div>
            )}
            {view && !view.configured && (
              <p role="status">
                SDP needs one-time setup by an administrator on the Relay server computer.
              </p>
            )}
            {view?.configured && (
              <div className="sdp-account-actions">
                {(view.status === 'disconnected' || view.status === 'expired') && (
                  <TactileButton
                    variant="primary"
                    disabled={busy}
                    onClick={() => void run({ action: 'connect' })}
                  >
                    Sign in with work account
                  </TactileButton>
                )}
                {(view.status === 'connected' || view.status === 'connecting') && (
                  <TactileButton disabled={busy} onClick={() => void run({ action: 'disconnect' })}>
                    {view.status === 'connecting' ? 'Cancel sign-in' : 'Disconnect'}
                  </TactileButton>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="ticket-error">
                {error}
              </p>
            )}
          </>
        )}
        <p className="sdp-account-boundary">
          SDP determines your permissions. Sign-in requests read, create, update and delete access;
          every live change requires review and confirmation. Existing read-only sessions need a new
          work sign-in to grant these permissions. Saved outage copies remain read-only.
        </p>
      </div>
    </Modal>
  );
}
