import React, { useEffect, useId, useState } from 'react';
import type { RelayRoleAccountAdminView } from '@shared/privilegedAccess';
import { useRetainedValue } from '../../../hooks/useRetainedValue';
import { Modal } from '../../Modal';
import { TactileButton } from '../../TactileButton';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

export type RoleAccountReauthenticationAction =
  | { kind: 'ownership'; account: RelayRoleAccountAdminView }
  | { kind: 'publisher'; accountId: string | null };

export function RoleAccountReauthenticationDialog({
  action,
  busy,
  error,
  currentAccountName,
  onConfirm,
  onClose,
}: Readonly<{
  action: RoleAccountReauthenticationAction | null;
  busy: boolean;
  error: string | null;
  currentAccountName: string;
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}>) {
  const [password, setPassword] = useState('');
  const formId = useId();
  const retainedAction = useRetainedValue(action);

  useEffect(() => () => setPassword(''), []);

  const close = () => {
    setPassword('');
    onClose();
  };

  const submit = async (event: FormSubmitEvent) => {
    event.preventDefault();
    const submittedPassword = password;
    setPassword('');
    await onConfirm(submittedPassword);
  };

  const publisherChange = retainedAction?.kind === 'publisher';
  const title = publisherChange ? 'Confirm Publisher change' : 'Confirm ownership transfer';

  return (
    <Modal
      isOpen={action !== null}
      onClose={close}
      title={title}
      subtitle="Protected role change"
      variant="standard"
      dismissible={!busy}
      footer={
        <>
          <TactileButton type="button" variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </TactileButton>
          <TactileButton type="submit" form={formId} variant="primary" loading={busy}>
            {publisherChange ? 'Confirm Publisher change' : 'Transfer ownership'}
          </TactileButton>
        </>
      }
    >
      {retainedAction ? (
        <form
          id={formId}
          className="administration-dialog-form"
          onSubmit={(event) => void submit(event)}
        >
          <p>
            {publisherChange
              ? 'Publisher sessions and paired devices may be revoked when this assignment changes.'
              : `Ownership will move from ${currentAccountName} to ${retainedAction.account.displayName}. Sessions for the current and incoming Owner accounts will lock.`}
          </p>
          <label className="administration-field">
            <span>Password</span>
            <input
              type="password"
              className="tactile-input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          {error ? (
            <div className="administration-feedback administration-feedback--error" role="alert">
              {error}
            </div>
          ) : null}
        </form>
      ) : null}
    </Modal>
  );
}
