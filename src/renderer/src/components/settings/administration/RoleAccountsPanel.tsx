import React, { useEffect, useState } from 'react';
import {
  getRoleDisplayNameError,
  getRoleUsernameError,
  normalizeRoleDisplayName,
  normalizeRoleUsername,
  type EffectivePrivilegedRole,
} from '@shared/roleAccounts';
import type { RelayRoleAccountAdminView } from '@shared/privilegedAccess';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { usePrivilegedAccess } from '../../../contexts/PrivilegedAccessContext';
import { TactileButton } from '../../TactileButton';
import type { AdministrationPanelProps } from './types';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];
type Props = AdministrationPanelProps & { relayMode: 'server' | 'client' | null };
type CreateRole = 'administrator' | 'publisher';
type ReauthenticationAction =
  | { kind: 'ownership'; account: RelayRoleAccountAdminView }
  | { kind: 'publisher'; accountId: string | null };

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
  onConfirm,
  onClose,
}: Readonly<{
  action: ReauthenticationAction;
  busy: boolean;
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}>) {
  const [password, setPassword] = useState('');
  const dialogRef = useFocusTrap<HTMLFormElement>(true);

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

  const publisherChange = action.kind === 'publisher';
  const title = publisherChange ? 'Confirm Publisher change' : 'Confirm ownership transfer';

  return (
    <div className="administration-dialog-backdrop">
      <form
        ref={dialogRef}
        className="administration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-account-reauth-title"
        onSubmit={(event) => void submit(event)}
      >
        <div className="settings-section-heading">Protected role change</div>
        <h4 id="role-account-reauth-title">{title}</h4>
        <p>
          {publisherChange
            ? 'Publisher sessions and paired devices may be revoked when this assignment changes.'
            : `Ownership will move to ${action.account.displayName} and both Owner sessions will lock.`}
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
        <div className="administration-actions">
          <TactileButton type="submit" variant="primary" loading={busy}>
            {publisherChange ? 'Confirm Publisher change' : 'Transfer ownership'}
          </TactileButton>
          <TactileButton type="button" onClick={close}>
            Cancel
          </TactileButton>
        </div>
      </form>
    </div>
  );
}

export function RoleAccountsPanel({ snapshot, execute, relayMode }: Readonly<Props>) {
  const { session, reauthenticate, busy } = usePrivilegedAccess();
  const [createRole, setCreateRole] = useState<CreateRole | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [publisherAccountId, setPublisherAccountId] = useState(snapshot.publisherAccountId ?? '');
  const [credentialAccountId, setCredentialAccountId] = useState<string | null>(null);
  const [credentialPassword, setCredentialPassword] = useState('');
  const [credentialConfirm, setCredentialConfirm] = useState('');
  const [reauthAction, setReauthAction] = useState<ReauthenticationAction | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const publisherPointer = snapshot.publisherAccountId;
  const sessionRole = session.state === 'active' ? session.role : null;
  const isOwner = sessionRole === 'owner';
  const canManagePublisher = isOwner || sessionRole === 'admin';

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
      setFeedback(usernameError ?? displayNameError);
      return;
    }
    const command =
      createRole === 'administrator' ? 'account.admin.create' : 'account.publisher.create';
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
    }
  };

  const renameAccount = async (account: RelayRoleAccountAdminView) => {
    const validation = getRoleDisplayNameError(editDisplayName);
    if (validation) {
      setFeedback(validation);
      return;
    }
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
    }
  };

  const setAccountActive = async (account: RelayRoleAccountAdminView) => {
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
    if (result.ok) {
      setFeedback(account.active ? 'Account deactivated.' : 'Account reactivated.');
    }
  };

  const confirmReauthentication = async (password: string) => {
    if (!reauthAction) return;
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
    }
  };

  const closeCredential = () => {
    setCredentialPassword('');
    setCredentialConfirm('');
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
    });
    setCredentialPassword('');
    setCredentialConfirm('');
    setSavingId(null);
    if (result?.ok) {
      setCredentialAccountId(null);
      setFeedback('Credential updated. Existing paired sessions for this account were revoked.');
    } else {
      setFeedback('Credential setup could not be completed on this Relay server PC.');
    }
  };

  const publisherAccounts = snapshot.accounts.filter(
    ({ storedRole }) => storedRole === 'publisher',
  );
  const canManageAccount = (account: RelayRoleAccountAdminView) =>
    isOwner || account.storedRole === 'publisher';
  const credentialTargets = snapshot.accounts.filter(canManageAccount);

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
        {!publisherPointer && (
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
                      {!owner && (
                        <TactileButton
                          size="sm"
                          loading={savingId === account.accountId}
                          onClick={() => void setAccountActive(account)}
                          aria-label={`${account.active ? 'Deactivate' : 'Reactivate'} ${account.displayName}`}
                        >
                          {account.active ? 'Deactivate' : 'Reactivate'}
                        </TactileButton>
                      )}
                      {isOwner && account.effectiveRole === 'admin' && account.active && (
                        <TactileButton
                          size="sm"
                          onClick={() => setReauthAction({ kind: 'ownership', account })}
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
          <span>Owner and Administrators can assign the single Knowledge Base Publisher.</span>
        </div>
        <label className="administration-field">
          <span>Publisher account</span>
          <select
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
            setReauthAction({ kind: 'publisher', accountId: publisherAccountId || null })
          }
        >
          {publisherPointer ? 'Replace Publisher' : 'Assign Publisher'}
        </TactileButton>
      </div>

      {relayMode === 'server' ? (
        <div className="administration-credential">
          <div className="administration-callout">
            <strong>Credential setup and resets stay on this Relay server PC</strong>
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
            </div>
          ) : (
            <form
              className="administration-field-grid"
              onSubmit={(event) => void saveCredential(event)}
            >
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

      {reauthAction && (
        <ReauthenticationDialog
          action={reauthAction}
          busy={busy === 'reauthenticate'}
          onConfirm={confirmReauthentication}
          onClose={() => setReauthAction(null)}
        />
      )}
    </section>
  );
}
