import React, { useEffect, useState } from 'react';
import type { PrivilegedApprovalRequestView } from '@shared/ipc';
import type { RelayRoleAccountAdminView } from '@shared/privilegedAccess';
import { TactileButton } from '../../TactileButton';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

export function RoleAccountCredentialManager({
  relayMode,
  credentialTargets,
  unassignedAccounts,
  onFeedback,
}: Readonly<{
  relayMode: 'server' | 'client' | null;
  credentialTargets: RelayRoleAccountAdminView[];
  unassignedAccounts: RelayRoleAccountAdminView[];
  onFeedback: (message: string) => void;
}>) {
  const [credentialAccountId, setCredentialAccountId] = useState<string | null>(null);
  const [credentialPassword, setCredentialPassword] = useState('');
  const [credentialConfirm, setCredentialConfirm] = useState('');
  const [approvalRequest, setApprovalRequest] = useState<PrivilegedApprovalRequestView | null>(
    null,
  );
  const [approvalCode, setApprovalCode] = useState('');
  const [saving, setSaving] = useState(false);
  const credentialAccount = credentialTargets.find(
    ({ accountId }) => accountId === credentialAccountId,
  );

  useEffect(
    () => () => {
      setCredentialPassword('');
      setCredentialConfirm('');
    },
    [],
  );

  const close = () => {
    setCredentialPassword('');
    setCredentialConfirm('');
    setApprovalRequest(null);
    setApprovalCode('');
    setCredentialAccountId(null);
  };

  const save = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (!credentialAccountId) return;
    if (credentialPassword !== credentialConfirm) {
      onFeedback('Passwords must match.');
      return;
    }
    const password = credentialPassword;
    setSaving(true);
    const result = await globalThis.api?.setupPrivilegedCredential({
      accountId: credentialAccountId,
      password,
      passwordConfirm: credentialConfirm,
      ...(approvalRequest
        ? {
            approvalRequestId: approvalRequest.requestId,
            approvalCode: approvalCode.trim(),
          }
        : {}),
    });
    setApprovalCode('');
    setCredentialPassword('');
    setCredentialConfirm('');
    setSaving(false);
    if (result?.ok) {
      setApprovalRequest(null);
      setCredentialAccountId(null);
      onFeedback('Credential updated. Existing paired sessions for this account were revoked.');
    } else if (result?.error === 'approval-required' && result.approvalRequest) {
      setApprovalRequest(result.approvalRequest);
      onFeedback(
        'Approve this credential recovery on the Relay server PC, then re-enter the password and approval code.',
      );
    } else {
      onFeedback('Credential setup could not be completed.');
    }
  };

  if (relayMode !== 'server') {
    return (
      <div className="administration-callout">
        <strong>Credential setup is server-local</strong>
        <span>Use the Relay server PC to set or reset a protected account password.</span>
      </div>
    );
  }

  return (
    <div className="administration-credential">
      <div className="administration-callout">
        <strong>
          {globalThis.api?.runtime?.kind === 'web'
            ? 'Credential recovery requires server desktop approval'
            : 'Credential setup and resets stay on this Relay server PC'}
        </strong>
        <span>Replacing a password revokes every paired session for that account.</span>
      </div>
      {!credentialAccountId ? (
        <div className="administration-actions role-accounts__credential-actions">
          {credentialTargets.map((account) => (
            <TactileButton
              key={account.accountId}
              size="sm"
              onClick={() => setCredentialAccountId(account.accountId)}
              aria-label={`Set credential for ${account.displayName}`}
            >
              Set {account.displayName}
            </TactileButton>
          ))}
          {unassignedAccounts.length > 0 && (
            <span>
              Assign the Publisher role before setting a password for{' '}
              {unassignedAccounts.map(({ displayName }) => displayName).join(', ')}.
            </span>
          )}
        </div>
      ) : (
        <form className="administration-field-grid" onSubmit={(event) => void save(event)}>
          {credentialAccount && (
            <fieldset
              className="administration-callout role-accounts__credential-target"
              aria-label="Credential target"
            >
              <strong>{credentialAccount.displayName}</strong>
              <span>@{credentialAccount.username}</span>
            </fieldset>
          )}
          <label className="administration-field">
            <span>New password</span>
            <input
              type="password"
              className="tactile-input"
              value={credentialPassword}
              onChange={(event) => setCredentialPassword(event.target.value)}
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          {approvalRequest && (
            <label className="administration-field">
              <span>Desktop approval code</span>
              <input
                className="tactile-input"
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
          <label className="administration-field">
            <span>Confirm password</span>
            <input
              type="password"
              className="tactile-input"
              value={credentialConfirm}
              onChange={(event) => setCredentialConfirm(event.target.value)}
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <div className="administration-actions">
            <TactileButton type="submit" variant="primary" loading={saving}>
              Set credential
            </TactileButton>
            <TactileButton type="button" onClick={close}>
              Cancel
            </TactileButton>
          </div>
        </form>
      )}
    </div>
  );
}
