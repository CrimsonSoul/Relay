import { useId, type ReactNode } from 'react';
import type {
  RelayReleaseNotes,
  RelayUpdateFailureCode,
  RelayUpdatePhase,
  RelayUpdateSnapshot,
} from '@shared/releases';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';
import { ReleaseNotesContent } from './release-notes/ReleaseNotesContent';

type ReleaseUpdateModalProps = Readonly<{
  isOpen: boolean;
  update: RelayUpdateSnapshot;
  releaseNotes?: RelayReleaseNotes | null;
  onClose: () => void;
  onDownload: () => void;
  onCancelDownload: () => void;
  onRevealInstaller: () => void;
  onCheckAgain: () => void;
  onOpenReleases: () => void;
}>;

type UpdateStep = 'download' | 'install';

const ERROR_MESSAGES: Record<RelayUpdateFailureCode, string> = {
  unsupported:
    'Verified downloads are available only in packaged Relay for Windows x64. Use GitHub Releases for this update.',
  'release-not-immutable':
    'GitHub has not locked this release as immutable, so Relay will not download it.',
  'release-changed':
    'The latest GitHub release changed during verification. Check again before downloading.',
  'release-quarantined':
    'Relay already tried this exact release and rolled it back. A newer immutable release is required before updating again.',
  'download-failed':
    'The download did not finish. Your current Relay installation was not changed.',
  'verification-failed': 'The downloaded files did not pass integrity checks and were discarded.',
  cancelled: 'The download was cancelled. Your current Relay installation was not changed.',
  'reveal-failed':
    'Relay could not open the verified installer folder. The verified download is still available.',
};

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1_024;
  let unit: (typeof units)[number] = units[0];
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024;
    unit = units[index]!;
  }
  return `${value.toFixed(1)} ${unit}`;
}

function UpdateProgress({ update }: Readonly<{ update: RelayUpdateSnapshot }>) {
  const showDownloadProgress =
    (update.phase === 'downloading' || update.phase === 'downloaded') && update.totalBytes !== null;
  if (!showDownloadProgress) return null;
  const totalBytes = update.totalBytes;
  if (totalBytes === null) return null;
  const downloadedBytes =
    update.phase === 'downloaded'
      ? totalBytes
      : Math.max(0, Math.min(update.downloadedBytes, totalBytes));
  const progress = totalBytes > 0 ? downloadedBytes / totalBytes : 0;

  return (
    <div className="release-update-modal__progress">
      <progress
        className="sr-only"
        aria-label={
          update.phase === 'downloaded' ? 'Update download complete' : 'Update download progress'
        }
        aria-valuetext={`${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}`}
        data-mode="determinate"
        max={totalBytes}
        value={downloadedBytes}
      />
      <div
        className="release-update-modal__progress-track"
        aria-hidden="true"
        data-mode="determinate"
      >
        <span
          className="release-update-modal__progress-fill"
          style={{ width: progress * 100 + '%' }}
        />
      </div>
      <span>
        {update.phase === 'downloaded'
          ? `${formatBytes(totalBytes)} verified`
          : `${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}`}
      </span>
    </div>
  );
}

function currentStep(update: RelayUpdateSnapshot): UpdateStep {
  if (
    update.phase === 'downloaded' ||
    (update.phase === 'error' && update.failureCode === 'reveal-failed')
  ) {
    return 'install';
  }
  return 'download';
}

function stepState(step: UpdateStep, current: UpdateStep): 'complete' | 'current' | 'upcoming' {
  const order: UpdateStep[] = ['download', 'install'];
  const comparison = order.indexOf(step) - order.indexOf(current);
  if (comparison < 0) return 'complete';
  return comparison === 0 ? 'current' : 'upcoming';
}

function phaseMessage(update: RelayUpdateSnapshot): string {
  if (update.phase === 'error' && update.failureCode) return ERROR_MESSAGES[update.failureCode];
  if (update.failureCode === 'unsupported' || update.failureCode === 'release-quarantined') {
    return ERROR_MESSAGES[update.failureCode];
  }
  if (!update.installable) {
    return 'This release can be reviewed, but Relay cannot download it because GitHub has not locked it as immutable.';
  }
  const messages: Record<RelayUpdatePhase, string> = {
    idle: 'Relay is waiting for the next release check.',
    available: 'A verified Windows update is available. Relay downloads only when you choose.',
    downloading:
      'Downloading from the official Relay repository. You can cancel without changing this installation.',
    downloaded:
      'Download verified. Relay will exit and open the folder so you can run Relay.exe manually.',
    error: 'Relay could not continue the update.',
  };
  return messages[update.phase];
}

function StepMarker({ state }: Readonly<{ state: 'complete' | 'current' | 'upcoming' }>) {
  return (
    <span className="release-update-modal__step-marker" aria-hidden="true">
      {state === 'complete' ? (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
          <path
            d="m3.5 8.2 2.7 2.7 6.3-6.3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <span className="release-update-modal__step-dot" />
      )}
    </span>
  );
}

function modalFooter(
  update: RelayUpdateSnapshot,
  actions: Omit<ReleaseUpdateModalProps, 'isOpen' | 'update'>,
): ReactNode {
  const githubButton = (
    <TactileButton key="github" variant="secondary" onClick={actions.onOpenReleases}>
      View on GitHub
    </TactileButton>
  );

  if (update.phase === 'downloading') {
    return (
      <>
        {githubButton}
        <TactileButton variant="secondary" onClick={actions.onCancelDownload}>
          Cancel download
        </TactileButton>
      </>
    );
  }
  if (update.phase === 'downloaded') {
    return (
      <>
        {githubButton}
        <TactileButton variant="primary" onClick={actions.onRevealInstaller}>
          Exit Relay and open installer folder
        </TactileButton>
      </>
    );
  }
  if (update.phase === 'error') {
    let primaryAction: ReactNode = null;
    if (update.failureCode === 'reveal-failed') {
      primaryAction = (
        <TactileButton variant="primary" onClick={actions.onRevealInstaller}>
          Exit Relay and open installer folder
        </TactileButton>
      );
    } else if (update.failureCode === 'release-changed') {
      primaryAction = (
        <TactileButton variant="primary" onClick={actions.onCheckAgain}>
          Check again
        </TactileButton>
      );
    } else if (
      update.installable &&
      (update.failureCode === 'download-failed' ||
        update.failureCode === 'verification-failed' ||
        update.failureCode === 'cancelled')
    ) {
      primaryAction = (
        <TactileButton variant="primary" onClick={actions.onDownload}>
          Retry download
        </TactileButton>
      );
    }
    return (
      <>
        <TactileButton variant="secondary" onClick={actions.onClose}>
          Close
        </TactileButton>
        {githubButton}
        {primaryAction}
      </>
    );
  }
  if (!update.installable) {
    return (
      <>
        <TactileButton variant="secondary" onClick={actions.onClose}>
          Close
        </TactileButton>
        {githubButton}
      </>
    );
  }
  return (
    <>
      {githubButton}
      <TactileButton variant="primary" onClick={actions.onDownload}>
        Download update
      </TactileButton>
    </>
  );
}

export function ReleaseUpdateModal({
  isOpen,
  update,
  releaseNotes,
  onClose,
  onDownload,
  onCancelDownload,
  onRevealInstaller,
  onCheckAgain,
  onOpenReleases,
}: ReleaseUpdateModalProps) {
  const statusId = useId();
  const step = currentStep(update);
  const actions = {
    onClose,
    onDownload,
    onCancelDownload,
    onRevealInstaller,
    onCheckAgain,
    onOpenReleases,
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Update Relay"
      subtitle={
        update.latestVersion
          ? `v${update.currentVersion} → v${update.latestVersion}`
          : `v${update.currentVersion}`
      }
      variant="standard"
      bodyClassName="release-update-modal__body"
      dialogProps={{
        className: 'release-update-modal',
        'aria-describedby': statusId,
        'aria-busy': update.phase === 'downloading',
      }}
      footer={modalFooter(update, actions)}
    >
      <div className="release-update-modal__content">
        <ol className="release-update-modal__steps" aria-label="Update steps">
          {(
            [
              ['download', 'Download'],
              ['install', 'Install manually'],
            ] as const
          ).map(([item, label]) => {
            const state = stepState(item, step);
            return (
              <li
                key={item}
                className="release-update-modal__step"
                data-state={state}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                <StepMarker state={state} />
                <span>{label}</span>
              </li>
            );
          })}
        </ol>

        {update.phase === 'error' ? (
          <p id={statusId} className="release-update-modal__message" role="alert">
            {phaseMessage(update)}
          </p>
        ) : (
          <output id={statusId} className="release-update-modal__message" aria-live="polite">
            {phaseMessage(update)}
          </output>
        )}

        <UpdateProgress update={update} />

        {update.latestVersion && (
          <section
            className="release-update-modal__notes"
            aria-labelledby="release-update-notes-title"
          >
            <div className="release-update-modal__notes-heading">
              <h3 id="release-update-notes-title">What's new in v{update.latestVersion}</h3>
              {releaseNotes?.version === update.latestVersion && (
                <time dateTime={releaseNotes.publishedAt}>
                  {new Intl.DateTimeFormat(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  }).format(new Date(releaseNotes.publishedAt))}
                </time>
              )}
            </div>
            {releaseNotes?.version === update.latestVersion ? (
              <ReleaseNotesContent
                body={releaseNotes.body}
                className="release-update-modal__notes-content release-notes-content"
              />
            ) : (
              <p className="release-update-modal__notes-unavailable">
                Release notes are not available yet. You can still review this release on GitHub.
              </p>
            )}
          </section>
        )}

        <div className="release-update-modal__trust">
          <svg
            className="release-update-modal__trust-icon"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3 5 6v5c0 4.7 2.7 8.1 7 10 4.3-1.9 7-5.3 7-10V6l-7-3Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <div>
            <strong>Integrity check</strong>
            <span>
              {update.installable
                ? 'Immutable GitHub release metadata and two matching SHA-256 digests are required.'
                : 'Relay installs only immutable GitHub releases with matching SHA-256 digests.'}
            </span>
            <span>Publisher signing is not included in this update path.</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
