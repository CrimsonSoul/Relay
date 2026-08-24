import React, { useEffect, useState } from 'react';
import type { PrivilegedApprovalRequestView } from '@shared/ipc';
import { TactileButton } from '../../TactileButton';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

export function InitialOwnerSetup({
  onClearError,
  onUsernameCreated,
  onLogin,
}: Readonly<{
  onClearError: () => void;
  onUsernameCreated: (username: string) => void;
  onLogin: (username: string, password: string) => Promise<boolean>;
}>) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [approvalRequest, setApprovalRequest] = useState<PrivilegedApprovalRequestView | null>(
    null,
  );
  const [approvalCode, setApprovalCode] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(
    () => () => {
      setPassword('');
      setPasswordConfirm('');
    },
    [],
  );

  const close = () => {
    setPassword('');
    setPasswordConfirm('');
    setApprovalRequest(null);
    setApprovalCode('');
    setOpen(false);
  };

  const openSetup = () => {
    onClearError();
    setFeedback(null);
    setOpen(true);
  };

  const submit = async (event: FormSubmitEvent) => {
    event.preventDefault();
    setFeedback(null);
    if (password !== passwordConfirm) {
      setFeedback('Passwords must match.');
      return;
    }
    const passwordToUse = password;
    try {
      const result = await globalThis.api?.setupInitialAdministratorCredential({
        username: username.trim(),
        password: passwordToUse,
        passwordConfirm,
        ...(approvalRequest
          ? {
              approvalRequestId: approvalRequest.requestId,
              approvalCode: approvalCode.trim(),
            }
          : {}),
      });
      setApprovalCode('');
      if (!result?.ok) {
        if (result?.error === 'approval-required' && result.approvalRequest) {
          setApprovalRequest(result.approvalRequest);
          setPassword('');
          setPasswordConfirm('');
          setFeedback(
            'Approve this request on the Relay server PC, then re-enter the password and approval code.',
          );
          return;
        }
        setPassword('');
        setPasswordConfirm('');
        setFeedback('Initial Owner setup was not accepted. It may already be complete.');
        return;
      }
      setPassword('');
      setPasswordConfirm('');
      setApprovalRequest(null);
      setOpen(false);
      onUsernameCreated(result.value.username);
      await onLogin(result.value.username, passwordToUse);
    } catch {
      setPassword('');
      setPasswordConfirm('');
      setFeedback('Initial Owner setup could not be completed.');
    }
  };

  return (
    <div className="privileged-access__bootstrap">
      <div className="privileged-access__state">
        <strong>First-time Owner setup</strong>
        <span>
          {globalThis.api?.runtime?.kind === 'web'
            ? 'Requires a one-time approval code from the Relay server PC.'
            : 'Available only on this Relay server PC. Relay has no default password.'}
        </span>
      </div>
      {!open ? (
        <TactileButton type="button" onClick={openSetup}>
          Set initial Owner password
        </TactileButton>
      ) : (
        <form className="privileged-access__form" onSubmit={(event) => void submit(event)}>
          <div className="privileged-access__field-grid">
            <label className="privileged-access__field">
              <span>Owner username</span>
              <input
                className="tactile-input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="off"
                required
              />
            </label>
            {approvalRequest && (
              <label className="privileged-access__field">
                <span>Desktop approval code</span>
                <input
                  className="tactile-input privileged-access__code"
                  value={approvalCode}
                  onChange={(event) => setApprovalCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                />
              </label>
            )}
            <label className="privileged-access__field">
              <span>New Owner password</span>
              <input
                type="password"
                className="tactile-input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <label className="privileged-access__field">
              <span>Confirm Owner password</span>
              <input
                type="password"
                className="tactile-input"
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                minLength={12}
                maxLength={128}
                required
              />
            </label>
          </div>
          <div className="privileged-access__actions">
            <TactileButton type="submit" variant="primary">
              Create Owner password
            </TactileButton>
            <TactileButton type="button" onClick={close}>
              Cancel
            </TactileButton>
          </div>
        </form>
      )}
      {feedback && (
        <div className="privileged-access__feedback" role="alert">
          {feedback}
        </div>
      )}
    </div>
  );
}
