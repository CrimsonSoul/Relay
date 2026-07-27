import React, { useEffect, useId, useState } from 'react';
import {
  getRoleDisplayNameError,
  getRoleUsernameError,
  normalizeRoleDisplayName,
  normalizeRoleUsername,
  type EffectivePrivilegedRole,
} from '@shared/roleAccounts';
import type { RelayRoleAccountAdminView } from '@shared/privilegedAccess';
import type { PrivilegedApprovalRequestView } from '@shared/ipc';
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';
import { useRetainedValue } from '../../../hooks/useRetainedValue';
import { usePrivilegedAccess } from '../../../contexts/PrivilegedAccessContext';
import { Modal } from '../../Modal';
import { TactileButton } from '../../TactileButton';
import type { AdministrationPanelProps } from './types';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];
type Props = AdministrationPanelProps & { relayMode: 'server' | 'client' | null };
type CreateRole = 'administrator' | 'publisher';
type ReauthenticationAction =
  | { kind: 'ownership'; account: RelayRoleAccountAdminView }
  | { kind: 'publisher'; accountId: string | null };

const COMMAND_ERRORS = {
  unauthorized: 'Your account is not authorized for this change. Sign in with the required role.',
  locked: 'Protected access locked before the change completed. Sign in again and retry.',
  offline: 'Relay is offline. Restore the connection and retry this change.',
  'pairing-required': 'Pair this workstation before retrying this protected change.',
  'invalid-request': 'Relay rejected this protected change. Close the dialog, refresh, and retry.',
  'insufficient-storage': 'Relay needs more free storage before it can apply this change.',
  'duplicate-file-name': 'A protected document with that PDF filename already exists.',
  expired: 'This confirmation expired. Enter your password and try again.',
  replayed: 'Relay could not safely repeat this change. Close the dialog, refresh, and retry.',
  conflict:
    'The server state changed. Close the dialog, review the refreshed accounts, and try again.',
  'server-error': 'Relay could not apply this protected change. Try again.',
} as const;

function commandFailureMessage(result: Extract<PrivilegedCommandResult, { ok: false }>): string {
  // A vetted server message names the actual blocker ("That username is already in
  // use."); the local map only knows the error class. Conflicts keep the local
  // wording because it explains the dialog-specific recovery step.
  return result.error === 'conflict' || !result.message
    ? COMMAND_ERRORS[result.error]
    : result.message;
}

const ROLE_LABELS: Record<EffectivePrivilegedRole, string> = {
  owner: 'OWNER',
  admin: 'ADMIN',
  publisher: 'PUBLISHER',
};

function accountRoleLabel(account: RelayRoleAccountAdminView): string {
  if (account.effectiveRole) return ROLE_LABELS[account.effectiveRole];
  return account.storedRole === 'publisher' ? 'UNASSIGNED' : 'ADMIN';
}

function ReauthenticationDialog({
  action,
  busy,
  error,
  currentAccountName,
  onConfirm,
  onClose,
}: Readonly<{
  action: ReauthenticationAction | null;
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

export function RoleAccountsPanel({ snapshot, execute, relayMode }: Readonly<Props>) {
  const { session, reauthenticate, busy, error: accessError, clearError } = usePrivilegedAccess();
  const [createRole, setCreateRole] = useState<CreateRole | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [publisherAccountId, setPublisherAccountId] = useState(snapshot.publisherAccountId ?? '');
  const [credentialAccountId, setCredentialAccountId] = useState<string | null>(null);
  const [credentialPassword, setCredentialPassword] = useState('');
  const [credentialConfirm, setCredentialConfirm] = useState('');
  const [credentialApprovalRequest, setCredentialApprovalRequest] =
    useState<PrivilegedApprovalRequestView | null>(null);
  const [credentialApprovalCode, setCredentialApprovalCode] = useState('');
  const [reauthAction, setReauthAction] = useState<ReauthenticationAction | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState<RelayRoleAccountAdminView | null>(null);
  const retainedDeactivation = useRetainedValue(deactivating);
  const publisherPointer = snapshot.publisherAccountId;
  const sessionRole = session.state === 'active' ? session.role : null;
  const isOwner = sessionRole === 'owner';
  const canManagePublisher = isOwner || sessionRole === 'admin';
  const credentialAccount = snapshot.accounts.find(
    ({ accountId }) => accountId === credentialAccountId,
  );
  const deactivationBusy =
    retainedDeactivation !== null && savingId === retainedDeactivation.accountId;

  useEffect(() => setPublisherAccountId(publisherPointer ?? ''), [publisherPointer]);
  useEffect(
    () => () => {
      setCredentialPassword('');
      setCredentialConfirm('');
    },
    [],
  );

  if (!canManagePublisher) return null;

  const closeCreate = () => {
    setCreateRole(null);
    setNewUsername('');
    setNewDisplayName('');
  };

  const createAccount = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (!createRole) return;
    const usernameError = getRoleUsernameError(newUsername);
    const displayNameError = getRoleDisplayNameError(newDisplayName);
    if (usernameError || displayNameError) {
      setFailure(usernameError ?? displayNameError);
      return;
    }
    const command =
      createRole === 'administrator' ? 'account.admin.create' : 'account.publisher.create';
    setFailure(null);
    setSavingId('create');
    const result = await execute({
      command,
      payload: {
        username: normalizeRoleUsername(newUsername),
        displayName: normalizeRoleDisplayName(newDisplayName),
        expectedStateRevision: snapshot.assignmentRevision,
      },
      expectedRevision: null,
    });
    setSavingId(null);
    if (result.ok) {
      setFeedback(
        `${createRole === 'administrator' ? 'Administrator' : 'Publisher'} account created. Set its password on the Relay server PC.`,
      );
      closeCreate();
    } else {
      setFailure(commandFailureMessage(result));
    }
  };

  const renameAccount = async (account: RelayRoleAccountAdminView) => {
    const validation = getRoleDisplayNameError(editDisplayName);
    if (validation) {
      setFailure(validation);
      return;
    }
    setFailure(null);
    setSavingId(account.accountId);
    const result = await execute({
      command: 'account.display-name.update',
      payload: {
        accountId: account.accountId,
        displayName: normalizeRoleDisplayName(editDisplayName),
        expectedRevision: account.revision,
      },
      expectedRevision: null,
    });
    setSavingId(null);
    if (result.ok) {
      setEditingAccountId(null);
      setEditDisplayName('');
      setFeedback('Account display name updated.');
    } else {
      setFailure(commandFailureMessage(result));
    }
  };

  const setAccountActive = async (account: RelayRoleAccountAdminView) => {
    setFailure(null);
    setSavingId(account.accountId);
    const result = await execute({
      command: 'account.active.set',
      payload: {
        accountId: account.accountId,
        active: !account.active,
        expectedRevision: account.revision,
      },
      expectedRevision: null,
    });
    setSavingId(null);
    setDeactivating(null);
    if (result.ok) {
      setFeedback(account.active ? 'Account deactivated.' : 'Account reactivated.');
    } else {
      setFailure(commandFailureMessage(result));
    }
  };

  // Deactivation ends that person's live session the moment it commits, so it asks
  // first. Reactivation restores access and stays a single click.
  const requestActiveChange = (account: RelayRoleAccountAdminView) => {
    if (!account.active) {
      void setAccountActive(account);
      return;
    }
    setFailure(null);
    setDeactivating(account);
  };

  const confirmReauthentication = async (password: string) => {
    if (!reauthAction) return;
    setDialogError(null);
    const proof = await reauthenticate(password);
    if (!proof) return;
    const request =
      reauthAction.kind === 'ownership'
        ? {
            command: 'ownership.transfer' as const,
            payload: {
              accountId: reauthAction.account.accountId,
              expectedStateRevision: snapshot.assignmentRevision,
              reauthRequestId: proof.proofId,
            },
            expectedRevision: null,
          }
        : {
            command: 'publisher.assign' as const,
            payload: {
              accountId: reauthAction.accountId,
              expectedStateRevision: snapshot.assignmentRevision,
              reauthRequestId: proof.proofId,
            },
            expectedRevision: null,
          };
    const result = await execute(request);
    if (result.ok) {
      setFeedback(
        reauthAction.kind === 'ownership'
          ? 'Ownership transferred. Sign in again with your updated role.'
          : 'Publisher assignment updated. Set the assigned password on the Relay server PC.',
      );
      setReauthAction(null);
      clearError();
    } else {
      setDialogError(commandFailureMessage(result));
    }
  };

  const openReauthentication = (action: ReauthenticationAction) => {
    clearError();
    setDialogError(null);
    setReauthAction(action);
  };

  const closeReauthentication = () => {
    clearError();
    setDialogError(null);
    setReauthAction(null);
  };

  const closeCredential = () => {
    setCredentialPassword('');
    setCredentialConfirm('');
    setCredentialApprovalRequest(null);
    setCredentialApprovalCode('');
    setCredentialAccountId(null);
  };

  const saveCredential = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (!credentialAccountId) return;
    if (credentialPassword !== credentialConfirm) {
      setFeedback('Passwords must match.');
      return;
    }
    const password = credentialPassword;
    setSavingId(`credential:${credentialAccountId}`);
    const result = await globalThis.api?.setupPrivilegedCredential({
      accountId: credentialAccountId,
      password,
      passwordConfirm: credentialConfirm,
      ...(credentialApprovalRequest
        ? {
            approvalRequestId: credentialApprovalRequest.requestId,
            approvalCode: credentialApprovalCode.trim(),
          }
        : {}),
    });
    setCredentialApprovalCode('');
    setCredentialPassword('');
    setCredentialConfirm('');
    setSavingId(null);
    if (result?.ok) {
      setCredentialApprovalRequest(null);
      setCredentialAccountId(null);
      setFeedback('Credential updated. Existing paired sessions for this account were revoked.');
    } else if (result?.error === 'approval-required' && result.approvalRequest) {
      setCredentialApprovalRequest(result.approvalRequest);
      setFeedback(
        'Approve this credential recovery on the Relay server PC, then re-enter the password and approval code.',
      );
    } else {
      setFeedback('Credential setup could not be completed.');
    }
  };

  const publisherAccounts = snapshot.accounts.filter(
    ({ storedRole }) => storedRole === 'publisher',
  );
  const canManageAccount = (account: RelayRoleAccountAdminView) =>
    isOwner || account.storedRole === 'publisher';
  // A retained Publisher that no longer holds the assignment has no effective role,
  // and every credential or activation path rejects it on the server. Offering those
  // actions here was a dead end; assigning the Publisher role is the way back.
  const credentialTargets = snapshot.accounts.filter(
    (account) => canManageAccount(account) && account.effectiveRole !== null,
  );
  const unassignedAccounts = snapshot.accounts.filter(
    (account) => canManageAccount(account) && account.effectiveRole === null,
  );

  return (
    <section className="administration-panel role-accounts" aria-labelledby="role-accounts-title">
      <header className="administration-panel__header">
        <div>
          <div className="settings-section-heading">Identity & authority</div>
          <h3 id="role-accounts-title">Accounts &amp; roles</h3>
          <p>
            Owner authority is assigned by protected state. Display names never determine a role.
          </p>
        </div>
        <span className="administration-panel__metric">{snapshot.accounts.length} accounts</span>
      </header>

      <div className="administration-actions role-accounts__primary-actions">
        {isOwner && (
          <TactileButton
            type="button"
            variant="primary"
            onClick={() => setCreateRole('administrator')}
          >
            Add Administrator
          </TactileButton>
        )}
        {publisherAccounts.length === 0 && (
          <TactileButton type="button" onClick={() => setCreateRole('publisher')}>
            Add Publisher
          </TactileButton>
        )}
      </div>

      {createRole && (
        <form
          className="administration-create role-accounts__create"
          onSubmit={(event) => void createAccount(event)}
        >
          <label>
            <span>{createRole === 'administrator' ? 'Administrator' : 'Publisher'} username</span>
            <input
              autoFocus
              className="tactile-input"
              value={newUsername}
              onChange={(event) => setNewUsername(event.target.value)}
              autoComplete="off"
              maxLength={64}
              required
            />
          </label>
          <label>
            <span>
              {createRole === 'administrator' ? 'Administrator' : 'Publisher'} display name
            </span>
            <input
              className="tactile-input"
              value={newDisplayName}
              onChange={(event) => setNewDisplayName(event.target.value)}
              maxLength={120}
              required
            />
          </label>
          <div className="administration-actions">
            <TactileButton type="submit" variant="primary" loading={savingId === 'create'}>
              Create {createRole === 'administrator' ? 'Administrator' : 'Publisher'}
            </TactileButton>
            <TactileButton type="button" onClick={closeCreate}>
              Cancel
            </TactileButton>
          </div>
        </form>
      )}

      <div className="administration-list">
        {snapshot.accounts.map((account) => {
          const manageable = canManageAccount(account);
          const owner = account.effectiveRole === 'owner';
          return (
            <div className="administration-row" key={account.accountId}>
              <div className="administration-row__identity">
                {editingAccountId === account.accountId ? (
                  <label>
                    <span className="sr-only">Rename {account.displayName}</span>
                    <input
                      autoFocus
                      className="tactile-input"
                      value={editDisplayName}
                      onChange={(event) => setEditDisplayName(event.target.value)}
                      maxLength={120}
                    />
                  </label>
                ) : (
                  <strong>{account.displayName}</strong>
                )}
                <span>
                  @{account.username} · {account.active ? 'Active' : 'Inactive'}
                </span>
                {account.effectiveRole === null && (
                  <span>Assign the Publisher role to use this account.</span>
                )}
              </div>
              <div className="administration-row__badges">
                <span
                  className={`administration-chip administration-chip--${account.effectiveRole ?? 'pending'}`}
                >
                  {accountRoleLabel(account)}
                </span>
                <span
                  className={`administration-chip administration-chip--${account.credentialState === 'configured' ? 'ok' : 'pending'}`}
                >
                  {account.credentialState === 'configured' ? 'CONFIGURED' : 'SETUP NEEDED'}
                </span>
              </div>
              {manageable && (
                <div className="administration-row__actions">
                  {editingAccountId === account.accountId ? (
                    <>
                      <TactileButton
                        size="sm"
                        variant="primary"
                        loading={savingId === account.accountId}
                        onClick={() => void renameAccount(account)}
                      >
                        Save
                      </TactileButton>
                      <TactileButton size="sm" onClick={() => setEditingAccountId(null)}>
                        Cancel
                      </TactileButton>
                    </>
                  ) : (
                    <>
                      <TactileButton
                        size="sm"
                        onClick={() => {
                          setEditingAccountId(account.accountId);
                          setEditDisplayName(account.displayName);
                        }}
                      >
                        Rename
                      </TactileButton>
                      {!owner && account.effectiveRole !== null && (
                        <TactileButton
                          size="sm"
                          loading={savingId === account.accountId}
                          onClick={() => requestActiveChange(account)}
                          aria-label={`${account.active ? 'Deactivate' : 'Reactivate'} ${account.displayName}`}
                        >
                          {account.active ? 'Deactivate' : 'Reactivate'}
                        </TactileButton>
                      )}
                      {isOwner && account.effectiveRole === 'admin' && account.active && (
                        <TactileButton
                          size="sm"
                          onClick={() => openReauthentication({ kind: 'ownership', account })}
                          aria-label={`Transfer ownership to ${account.displayName}`}
                        >
                          Transfer ownership
                        </TactileButton>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="administration-callout role-accounts__publisher">
        <div>
          <strong>Publisher assignment</strong>
          <span>Owner and Administrators can assign the single Wiki Publisher.</span>
        </div>
        <label className="administration-field">
          <span>Publisher account</span>
          <select
            className="tactile-input"
            value={publisherAccountId}
            onChange={(event) => setPublisherAccountId(event.target.value)}
          >
            <option value="">No Publisher</option>
            {publisherAccounts.map((account) => (
              <option key={account.accountId} value={account.accountId}>
                {account.displayName} (@{account.username})
              </option>
            ))}
          </select>
        </label>
        <TactileButton
          type="button"
          variant="primary"
          disabled={publisherAccountId === (publisherPointer ?? '')}
          onClick={() =>
            openReauthentication({ kind: 'publisher', accountId: publisherAccountId || null })
          }
        >
          {publisherPointer ? 'Replace Publisher' : 'Assign Publisher'}
        </TactileButton>
      </div>

      {relayMode === 'server' ? (
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
            <form
              className="administration-field-grid"
              onSubmit={(event) => void saveCredential(event)}
            >
              {credentialAccount && (
                <div
                  className="administration-callout role-accounts__credential-target"
                  role="group"
                  aria-label="Credential target"
                >
                  <strong>{credentialAccount.displayName}</strong>
                  <span>@{credentialAccount.username}</span>
                </div>
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
              {credentialApprovalRequest && (
                <label className="administration-field">
                  <span>Desktop approval code</span>
                  <input
                    className="tactile-input"
                    value={credentialApprovalCode}
                    onChange={(event) => setCredentialApprovalCode(event.target.value)}
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
                <TactileButton
                  type="submit"
                  variant="primary"
                  loading={savingId === `credential:${credentialAccountId}`}
                >
                  Set credential
                </TactileButton>
                <TactileButton type="button" onClick={closeCredential}>
                  Cancel
                </TactileButton>
              </div>
            </form>
          )}
        </div>
      ) : (
        <div className="administration-callout">
          <strong>Credential setup is server-local</strong>
          <span>Use the Relay server PC to set or reset a protected account password.</span>
        </div>
      )}

      {feedback && (
        <div className="administration-feedback" role="status">
          {feedback}
        </div>
      )}

      {failure && (
        <div className="administration-feedback administration-feedback--error" role="alert">
          {failure}
        </div>
      )}

      <Modal
        isOpen={deactivating !== null}
        onClose={() => setDeactivating(null)}
        title="Deactivate account"
        subtitle="Protected account change"
        variant="confirmation"
        dismissible={!deactivationBusy}
        footer={
          <>
            <TactileButton
              type="button"
              variant="secondary"
              onClick={() => setDeactivating(null)}
              disabled={deactivationBusy}
            >
              Cancel
            </TactileButton>
            <TactileButton
              type="button"
              variant="primary"
              loading={deactivationBusy}
              onClick={() => {
                if (deactivating) void setAccountActive(deactivating);
              }}
            >
              Deactivate account
            </TactileButton>
          </>
        }
      >
        {retainedDeactivation && (
          <p>
            {retainedDeactivation.displayName} (@{retainedDeactivation.username}) loses privileged
            access immediately and any signed-in session for this account ends. Reactivating it
            later restores the same role.
          </p>
        )}
      </Modal>

      <ReauthenticationDialog
        action={reauthAction}
        busy={busy === 'reauthenticate'}
        error={dialogError ?? accessError}
        currentAccountName={
          session.state === 'active'
            ? (session.displayName ?? 'the current Owner')
            : 'the current Owner'
        }
        onConfirm={confirmReauthentication}
        onClose={closeReauthentication}
      />
    </section>
  );
}
