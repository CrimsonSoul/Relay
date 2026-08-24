import React, { useEffect, useState } from 'react';
import {
  getRoleDisplayNameError,
  getRoleUsernameError,
  normalizeRoleDisplayName,
  normalizeRoleUsername,
} from '@shared/roleAccounts';
import type { RelayRoleAccountAdminView } from '@shared/privilegedAccess';
import type { PrivilegedCommandError, PrivilegedCommandResult } from '@shared/privilegedCommands';
import { useRetainedValue } from '../../../hooks/useRetainedValue';
import { usePrivilegedAccess } from '../../../contexts/PrivilegedAccessContext';
import { Modal } from '../../Modal';
import { TactileButton } from '../../TactileButton';
import type { AdministrationPanelProps } from './types';
import { RoleAccountCredentialManager } from './RoleAccountCredentialManager';
import {
  RoleAccountReauthenticationDialog,
  type RoleAccountReauthenticationAction,
} from './RoleAccountReauthenticationDialog';
import { RoleAccountList } from './RoleAccountList';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];
type Props = AdministrationPanelProps & { relayMode: 'server' | 'client' | null };
type CreateRole = 'administrator' | 'publisher';

// Typed against the full error union on purpose: a missing arm used to fall out
// of the lookup as `undefined` and the dialog rendered a blank failure notice.
const COMMAND_ERRORS: Record<PrivilegedCommandError, string> = {
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
  // Throttling is not a lost race, so this deliberately does not tell the admin
  // to refresh and retry — that only spends more of the budget.
  'rate-limited': 'Relay is limiting repeated attempts. Wait a moment before trying again.',
  'server-error': 'Relay could not apply this protected change. Try again.',
};

function commandFailureMessage(result: Extract<PrivilegedCommandResult, { ok: false }>): string {
  // A vetted server message names the actual blocker ("That username is already in
  // use."); the local map only knows the error class. Conflicts keep the local
  // wording because it explains the dialog-specific recovery step.
  return result.error === 'conflict' || !result.message
    ? COMMAND_ERRORS[result.error]
    : result.message;
}

export function RoleAccountsPanel({ snapshot, execute, relayMode }: Readonly<Props>) {
  const { session, reauthenticate, busy, error: accessError, clearError } = usePrivilegedAccess();
  const [createRole, setCreateRole] = useState<CreateRole | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [publisherAccountId, setPublisherAccountId] = useState(snapshot.publisherAccountId ?? '');
  const [reauthAction, setReauthAction] = useState<RoleAccountReauthenticationAction | null>(null);
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
  const deactivationBusy =
    retainedDeactivation !== null && savingId === retainedDeactivation.accountId;

  useEffect(() => setPublisherAccountId(publisherPointer ?? ''), [publisherPointer]);

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

  const renameAccount = async (account: RelayRoleAccountAdminView, displayName: string) => {
    const validation = getRoleDisplayNameError(displayName);
    if (validation) {
      setFailure(validation);
      return false;
    }
    setFailure(null);
    setSavingId(account.accountId);
    const result = await execute({
      command: 'account.display-name.update',
      payload: {
        accountId: account.accountId,
        displayName: normalizeRoleDisplayName(displayName),
        expectedRevision: account.revision,
      },
      expectedRevision: null,
    });
    setSavingId(null);
    if (result.ok) {
      setFeedback('Account display name updated.');
      return true;
    } else {
      setFailure(commandFailureMessage(result));
      return false;
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

  const openReauthentication = (action: RoleAccountReauthenticationAction) => {
    clearError();
    setDialogError(null);
    setReauthAction(action);
  };

  const closeReauthentication = () => {
    clearError();
    setDialogError(null);
    setReauthAction(null);
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

      <RoleAccountList
        accounts={snapshot.accounts}
        isOwner={isOwner}
        savingId={savingId}
        onRename={renameAccount}
        onRequestActiveChange={requestActiveChange}
        onTransferOwnership={(account) => openReauthentication({ kind: 'ownership', account })}
      />

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

      <RoleAccountCredentialManager
        relayMode={relayMode}
        credentialTargets={credentialTargets}
        unassignedAccounts={unassignedAccounts}
        onFeedback={setFeedback}
      />

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

      <RoleAccountReauthenticationDialog
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
