import { useState } from 'react';
import type { ServerSyncController } from '../../hooks/useServerSyncImport';
import { TactileButton } from '../TactileButton';

function SyncPreview({ sync }: Readonly<{ sync: ServerSyncController }>) {
  const [reviewed, setReviewed] = useState(false);
  const plan = sync.preview!;
  const removedNoun = plan.removed.length === 1 ? 'Server' : 'Servers';
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
          Download Current List
        </TactileButton>
        <TactileButton onClick={sync.reset} disabled={sync.busy}>
          Cancel Preview
        </TactileButton>
        <TactileButton
          variant={plan.removed.length ? 'danger' : 'primary'}
          onClick={sync.apply}
          disabled={sync.busy || (plan.removed.length > 0 && !reviewed)}
        >
          {plan.removed.length
            ? `Sync and Remove ${plan.removed.length} ${removedNoun}`
            : 'Sync Servers'}
        </TactileButton>
      </div>
    </section>
  );
}

type SyncResultData = NonNullable<ServerSyncController['result']>;

function SyncResult({ result }: Readonly<{ result: SyncResultData }>) {
  const counts = (
    <span className="dm-sync-result-line">
      Added: {result.imported}, Updated: {result.updated}, Removed: {result.removed}, Unchanged:{' '}
      {result.unchanged}
    </span>
  );
  if (!result.errors.length) {
    return (
      <output className="data-manager-import-result data-manager-import-result--success">
        <strong>Servers synced</strong>
        {counts}
      </output>
    );
  }
  return (
    <div
      role="alert"
      className="data-manager-import-result--error panel-error ink-rail ink-rail--alarm"
    >
      <strong>Sync stopped</strong>
      {counts}
      {[...new Set(result.errors)].map((error) => (
        <span className="dm-sync-result-line" key={error}>
          {error}
        </span>
      ))}
    </div>
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
          {sync.busy ? 'Preparing preview…' : 'Choose File to Preview…'}
        </TactileButton>
      )}
      {sync.preview && <SyncPreview sync={sync} />}
      {sync.progress && (
        <output className="data-manager-import-progress">
          <strong>
            {sync.progress.stage === 'removing' ? 'Removing servers' : 'Saving servers'}:{' '}
            {sync.progress.processed} of {sync.progress.total}
          </strong>
        </output>
      )}
      {sync.error && (
        <div
          role="alert"
          className="data-manager-import-result--error panel-error ink-rail ink-rail--alarm"
        >
          {sync.error}
        </div>
      )}
      {sync.result && <SyncResult result={sync.result} />}
    </div>
  );
}
