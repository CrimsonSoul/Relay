import { useState } from 'react';
import type { EffectivePrivilegedRole } from '@shared/roleAccounts';
import type { RelayRoleAccountAdminView } from '@shared/privilegedAccess';
import { TactileButton } from '../../TactileButton';

const ROLE_LABELS: Record<EffectivePrivilegedRole, string> = {
  owner: 'OWNER',
  admin: 'ADMIN',
  publisher: 'PUBLISHER',
};

function accountRoleLabel(account: RelayRoleAccountAdminView): string {
  if (account.effectiveRole) return ROLE_LABELS[account.effectiveRole];
  return account.storedRole === 'publisher' ? 'UNASSIGNED' : 'ADMIN';
}

export function RoleAccountList({
  accounts,
  isOwner,
  savingId,
  onRename,
  onRequestActiveChange,
  onTransferOwnership,
}: Readonly<{
  accounts: RelayRoleAccountAdminView[];
  isOwner: boolean;
  savingId: string | null;
  onRename: (account: RelayRoleAccountAdminView, displayName: string) => Promise<boolean>;
  onRequestActiveChange: (account: RelayRoleAccountAdminView) => void;
  onTransferOwnership: (account: RelayRoleAccountAdminView) => void;
}>) {
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');

  const saveRename = async (account: RelayRoleAccountAdminView) => {
    if (!(await onRename(account, editDisplayName))) return;
    setEditingAccountId(null);
    setEditDisplayName('');
  };

  return (
    <div className="administration-list">
      {accounts.map((account) => {
        const manageable = isOwner || account.storedRole === 'publisher';
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
                      onClick={() => void saveRename(account)}
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
                        onClick={() => onRequestActiveChange(account)}
                        aria-label={`${account.active ? 'Deactivate' : 'Reactivate'} ${account.displayName}`}
                      >
                        {account.active ? 'Deactivate' : 'Reactivate'}
                      </TactileButton>
                    )}
                    {isOwner && account.effectiveRole === 'admin' && account.active && (
                      <TactileButton
                        size="sm"
                        onClick={() => onTransferOwnership(account)}
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
  );
}
