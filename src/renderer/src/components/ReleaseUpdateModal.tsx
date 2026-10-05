import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
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
  onInstall: () => void;
  onRestart: () => void;
  onCheckAgain: () => void;
  onOpenReleases: () => void;
}>;

type UpdateStep = 'download' | 'install' | 'restart';

const ERROR_MESSAGES: Record<RelayUpdateFailureCode, string> = {
  unsupported:
    'In-app updates are available only in packaged Relay for Windows x64. Use GitHub Releases for this update.',
  'release-not-immutable':
    'GitHub has not locked this release as immutable, so Relay will not download or run it.',
  'release-changed':
    'The latest GitHub release changed during verification. Check again before downloading.',
  'release-quarantined':
    'Relay already tried this exact release and rolled it back. A newer immutable release is required before updating again.',
  'download-failed':
    'The download did not finish. Your current Relay installation was not changed.',
  'verification-failed': 'The downloaded files did not pass integrity checks and were discarded.',
  cancelled: 'The download was cancelled. Your current Relay installation was not changed.',
  'install-failed':
    'Relay could not prepare the new runtime. The verified download is available to retry.',
  'restart-unavailable':
    'Relay could not validate its stable launcher. Keep this window open and try restarting again.',
  'client-data-unavailable':
    'Relay could not open its offline cache, so it cannot safely test this update. Your current installation was not changed. Reopen Relay and try restarting again.',
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

function updateProgressDetails(update: RelayUpdateSnapshot): {
  label: string;
  detail: string;
  total?: number;
  value?: number;
  percent?: number;
} {
  if (update.phase === 'installing') {
    return { label: 'Update installation progress', detail: 'Preparing update…' };
  }
  const complete = update.phase === 'downloaded';
  const label = complete ? 'Update download complete' : 'Update download progress';
  const downloaded = Math.max(0, update.downloadedBytes);
  const total = update.totalBytes;
  if (total === null || total <= 0) {
    const detail = `${formatBytes(downloaded)} downloaded`;
    // Without a known size a finished download still renders as a full bar, not an indeterminate one.
    return complete ? { label, detail, total: 1, value: 1, percent: 100 } : { label, detail };
  }
  const value = complete ? total : Math.min(downloaded, total);
  return {
    label,
    detail: complete
      ? `${formatBytes(total)} verified`
      : `${formatBytes(value)} of ${formatBytes(total)}`,
    total,
    value,
    percent: Math.floor((value / total) * 100),
  };
}

function UpdateProgress({ update }: Readonly<{ update: RelayUpdateSnapshot }>) {
  if (!['downloading', 'downloaded', 'installing'].includes(update.phase)) return null;
  const { label, detail, total, value, percent } = updateProgressDetails(update);
  const determinate = percent !== undefined;
  return (
    <div className="release-update-modal__progress">
      {update.phase !== 'installing' && (
        <div className="release-update-modal__progress-caption" aria-hidden="true">
          <span>{detail}</span>
          {determinate && <strong>{percent}%</strong>}
        </div>
      )}
      <progress
        className="release-update-modal__progress-bar"
        aria-label={label}
        aria-valuetext={determinate ? `${percent}%, ${detail}` : detail}
        data-mode={determinate ? 'determinate' : 'indeterminate'}
        max={total}
        value={value}
      />
    </div>
  );
}

function currentStep(update: RelayUpdateSnapshot): UpdateStep {
  if (
    update.phase === 'ready-to-restart' ||
    (update.phase === 'error' &&
      (update.failureCode === 'restart-unavailable' ||
        update.failureCode === 'client-data-unavailable'))
  ) {
    return 'restart';
  }
  if (
    update.phase === 'downloaded' ||
    update.phase === 'installing' ||
    (update.phase === 'error' && update.failureCode === 'install-failed')
  ) {
    return 'install';
  }
  return 'download';
}

function stepState(step: UpdateStep, current: UpdateStep): 'complete' | 'current' | 'upcoming' {
  const order: UpdateStep[] = ['download', 'install', 'restart'];
  const comparison = order.indexOf(step) - order.indexOf(current);
  if (comparison < 0) return 'complete';
  return comparison === 0 ? 'current' : 'upcoming';
}

function phaseMessage(update: RelayUpdateSnapshot): string {
  if (update.phase === 'error' && update.failureCode) {
    return [ERROR_MESSAGES[update.failureCode], update.failureDetail].filter(Boolean).join(' ');
  }
  if (update.failureCode === 'unsupported' || update.failureCode === 'release-quarantined') {
    return ERROR_MESSAGES[update.failureCode];
  }
  if (!update.installable) {
    return 'This release can be reviewed, but Relay cannot install it because GitHub has not locked it as immutable.';
  }
  const messages: Record<RelayUpdatePhase, string> = {
    idle: 'Relay is waiting for the next release check.',
    available: 'A verified Windows update is available. Relay will wait for you at every step.',
    downloading:
      'Downloading from the official Relay repository. You can cancel without changing this installation.',
    downloaded:
      'Download verified. Installing prepares the new runtime but does not restart Relay.',
    installing: 'Preparing the new Relay runtime. Relay will stay open until preparation finishes.',
    'ready-to-restart':
      'The update is prepared. Restart only when you are ready to switch versions.',
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
  installingActionRef: RefObject<HTMLButtonElement | null>,
): ReactNode {
  const githubButton = (
    <TactileButton
      key="github"
      ref={update.phase === 'installing' ? installingActionRef : undefined}
      variant="secondary"
      onClick={actions.onOpenReleases}
    >
      View on GitHub
    </TactileButton>
  );

  if (update.phase === 'downloading') {
    return (
      <>
        {githubButton}
        <TactileButton variant="secondary" onClick={actions.onCancelDownload}>
          Cancel Download
        </TactileButton>
      </>
    );
  }
  if (update.phase === 'installing') {
    return (
      <>
        <output className="release-update-modal__footer-status">Preparing update…</output>
        {githubButton}
      </>
    );
  }
  if (update.phase === 'downloaded') {
    return (
      <>
        {githubButton}
        <TactileButton variant="primary" onClick={actions.onInstall}>
          Install Update
        </TactileButton>
      </>
    );
  }
  if (update.phase === 'ready-to-restart') {
    return (
      <>
        {githubButton}
        <TactileButton variant="secondary" onClick={actions.onClose}>
          Later
        </TactileButton>
        <TactileButton variant="primary" onClick={actions.onRestart}>
          Restart Relay
        </TactileButton>
      </>
    );
  }
  if (update.phase === 'error') {
    let primaryAction: ReactNode = null;
    if (update.failureCode === 'install-failed') {
      primaryAction = (
        <TactileButton variant="primary" onClick={actions.onInstall}>
          Retry Install
        </TactileButton>
      );
    } else if (
      update.failureCode === 'restart-unavailable' ||
      update.failureCode === 'client-data-unavailable'
    ) {
      primaryAction = (
        <TactileButton variant="primary" onClick={actions.onRestart}>
          Retry Restart
        </TactileButton>
      );
    } else if (update.failureCode === 'release-changed') {
      primaryAction = (
        <TactileButton variant="primary" onClick={actions.onCheckAgain}>
          Check Again
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
          Retry Download
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
        Download Update
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
  onInstall,
  onRestart,
  onCheckAgain,
  onOpenReleases,
}: ReleaseUpdateModalProps) {
  const statusId = useId();
  const installingActionRef = useRef<HTMLButtonElement>(null);
  const step = currentStep(update);
  const actions = {
    onClose,
    onDownload,
    onCancelDownload,
    onInstall,
    onRestart,
    onCheckAgain,
    onOpenReleases,
  };
  useEffect(() => {
    if (isOpen && update.phase === 'installing') installingActionRef.current?.focus();
  }, [isOpen, update.phase]);

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
        'aria-busy': update.phase === 'downloading' || update.phase === 'installing',
      }}
      dismissible={update.phase !== 'installing'}
      footer={modalFooter(update, actions, installingActionRef)}
    >
      <div className="release-update-modal__content">
        <ol className="release-update-modal__steps" aria-label="Update steps">
          {(['download', 'install', 'restart'] as const).map((item) => {
            const state = stepState(item, step);
            return (
              <li
                key={item}
                className="release-update-modal__step"
                data-state={state}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                <StepMarker state={state} />
                <span>{item[0]!.toUpperCase() + item.slice(1)}</span>
              </li>
            );
          })}
        </ol>

        {update.phase === 'error' ? (
          <p
            id={statusId}
            className="release-update-modal__message panel-error ink-rail ink-rail--alarm"
            role="alert"
          >
            {phaseMessage(update)}
          </p>
        ) : (
          <output id={statusId} className="release-update-modal__message">
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
