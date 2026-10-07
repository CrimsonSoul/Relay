import { resetSdpNotifications } from './SdpAlerts';
import { useEffect, useRef, useState } from 'react';
import {
  type SdpAccountCommand,
  type SdpAccountProfile,
  type SdpAccountView,
} from '@shared/sdpAccount';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';
import { subscribeSdpStatus } from './sdpStatusPoller';

export function SdpAccountPanel({
  profile,
  onClose,
}: Readonly<{ profile?: SdpAccountProfile; onClose: () => void }>) {
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
    const unsubscribe = subscribeSdpStatus(() => {
      if (actionPending.current) return;
      const epoch = actionEpoch.current;
      return (outcome) => {
        if (!active || epoch !== actionEpoch.current) return;
        if ('result' in outcome && outcome.result.success && outcome.result.data) {
          setView(outcome.result.data);
          setError('');
        } else {
          setView(undefined);
          setError(
            ('result' in outcome && outcome.result.error) ||
              'Could not read SDP connection status.',
          );
        }
      };
    });
    return () => {
      active = false;
      unsubscribe();
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
    if (command.action === 'disconnect' || command.action === 'connect') resetSdpNotifications();
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
      onClose={onClose}
      footer={<TactileButton onClick={onClose}>Done</TactileButton>}
    >
      <div className="sdp-account-panel">
        {!available ? (
          <p>
            <output>
              Open Relay desktop to connect your SDP account. Web sign-in is not available yet.
            </output>
          </p>
        ) : (
          <>
            {!view && !error && (
              <p>
                <output>Checking connection…</output>
              </p>
            )}
            {view && (
              <output className="sdp-account-status">
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
                {view.status === 'connected' && profile && (
                  <span>
                    Signed in as {profile.name}
                    {profile.email && profile.email !== profile.name && ` (${profile.email})`}
                  </span>
                )}
                {(view.message || view.status === 'connecting') && (
                  <span>
                    {view.message || 'Complete sign-in in your browser, then return here.'}
                  </span>
                )}
              </output>
            )}
            {view && !view.configured && (
              <p>
                <output>
                  SDP needs one-time setup by an administrator on the Relay server computer.
                </output>
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
                    Sign In with Work Account
                  </TactileButton>
                )}
                {(view.status === 'connected' || view.status === 'connecting') && (
                  <TactileButton disabled={busy} onClick={() => void run({ action: 'disconnect' })}>
                    {view.status === 'connecting' ? 'Cancel Sign-In' : 'Disconnect'}
                  </TactileButton>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
