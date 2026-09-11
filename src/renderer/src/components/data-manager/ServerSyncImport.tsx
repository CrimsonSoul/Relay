import { useState } from 'react';
import type { ServerSyncController } from '../../hooks/useServerSyncImport';
import { TactileButton } from '../TactileButton';

function SyncPreview({ sync }: Readonly<{ sync: ServerSyncController }>) {
  const [reviewed, setReviewed] = useState(false);
  const plan = sync.preview!;
  return (
    <section className="dm-sync-preview" aria-label="Server sync preview">
      <div className="dm-sync-heading">
        <strong>{plan.fileName}</strong>
        <span>
          {plan.currentCount.toLocaleString()} current → {plan.incomingCount.toLocaleString()} in
          file
        </span>
      </div>
      <div className="dm-sync-counts">
        <span>
          <strong>{plan.added.length}</strong> Add
        </span>
        <span>
          <strong>{plan.updated.length}</strong> Update
        </span>
        <span>
          <strong>{plan.unchanged}</strong> Unchanged
        </span>
        <span className={plan.removed.length ? 'dm-sync-removal-count' : undefined}>
          <strong>{plan.removed.length}</strong> Remove
        </span>
      </div>
      {plan.added.length > 0 && (
        <details>
          <summary>Servers to add ({plan.added.length})</summary>
          <ul className="dm-sync-names">
            {plan.added.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </details>
      )}
      {plan.updated.length > 0 && (
        <details>
          <summary>Servers to update ({plan.updated.length})</summary>
          <ul className="dm-sync-names">
            {plan.updated.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </details>
      )}
      {plan.removed.length > 0 && (
        <div className="dm-sync-removals">
          <strong>Servers to remove ({plan.removed.length})</strong>
          <ul className="dm-sync-names">
            {plan.removed.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <label className="dm-sync-confirm">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={sync.busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed the {plan.removed.length} servers to remove
          </label>
        </div>
      )}
      <p className="data-manager-section-description">
        Changes affect the shared Servers list for all connected clients. Completed changes remain
        if a later step fails. Download the current list before syncing.
      </p>
      <div className="data-manager-controls-row">
        <TactileButton onClick={sync.downloadBackup} disabled={sync.busy}>
          Download current list
        </TactileButton>
        <TactileButton onClick={sync.reset} disabled={sync.busy}>
          Cancel preview
        </TactileButton>
        <TactileButton
          variant={plan.removed.length ? 'danger' : 'primary'}
          onClick={sync.apply}
          disabled={sync.busy || (plan.removed.length > 0 && !reviewed)}
        >
          {plan.removed.length ? `Sync and remove ${plan.removed.length} servers` : 'Sync servers'}
        </TactileButton>
      </div>
    </section>
  );
}

export function ServerSyncImport({ sync }: Readonly<{ sync: ServerSyncController }>) {
  return (
    <div className="dm-sync">
      <p className="data-manager-section-description">
        Choose the complete list of servers you want to keep. Servers missing from the file will be
        removed after you review the preview. Matching names keep their existing records.
      </p>
      {!sync.preview && (
        <TactileButton variant="primary" onClick={sync.chooseFile} disabled={sync.busy}>
          {sync.busy ? 'Preparing preview...' : 'Choose file to preview...'}
        </TactileButton>
      )}
      {sync.preview && <SyncPreview sync={sync} />}
      {sync.progress && (
        <output className="data-manager-import-progress" aria-live="polite">
          <strong>
            {sync.progress.stage === 'removing' ? 'Removing servers' : 'Saving servers'}:{' '}
            {sync.progress.processed} of {sync.progress.total}
          </strong>
        </output>
      )}
      {sync.error && (
        <div role="alert" className="data-manager-import-result data-manager-import-result--error">
          {sync.error}
        </div>
      )}
      {sync.result && (
        <output
          className={`data-manager-import-result data-manager-import-result--${sync.result.errors.length ? 'error' : 'success'}`}
        >
          <strong>{sync.result.errors.length ? 'Sync stopped' : 'Servers synced'}</strong>
          <span className="dm-sync-result-line">
            Added: {sync.result.imported}, Updated: {sync.result.updated}, Removed:{' '}
            {sync.result.removed}, Unchanged: {sync.result.unchanged}
          </span>
          {[...new Set(sync.result.errors)].map((error) => (
            <span className="dm-sync-result-line" key={error}>
              {error}
            </span>
          ))}
        </output>
      )}
    </div>
  );
}
