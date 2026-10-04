import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
// html2canvas is dynamically imported on demand to reduce initial bundle size
import { TactileButton } from '../components/TactileButton';
import { Tooltip } from '../components/Tooltip';
import { Modal } from '../components/Modal';
import { useToast, type ToastOptions } from '../components/Toast';
import { formatFailure } from '../utils/failureMessage';
import { useAlertHistory } from '../hooks/useAlertHistory';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { useModalState } from '../hooks/useModalState';
import { AlertHistoryModal } from './AlertHistoryModal';
import { AlertReminderModal } from './AlertReminderModal';
import { AlertReminderManagerModal } from './AlertReminderManagerModal';
import { AlertForm, type AlertAttentionField, type AlertAttentionRequest } from './AlertForm';
import { AlertCard } from './AlertCard';
import { AlertActionsMenu } from './alerts/AlertActionsMenu';
import { useAlertShortcuts } from './alerts/useAlertShortcuts';
import { useTabCommandRequests } from '../hooks/useTabCommandShortcuts';
import { DEFAULT_ALERT_RECIPIENT, missingAlertExportFields } from './alertUtils';
import type { Severity } from './alertUtils';
import { localToIso } from './alertTimeUtils';
import {
  AlertDraftProvider,
  initialAlertDraftState,
  useAlertDraft,
  type AlertDraftState,
} from './alerts/AlertDraftContext';
import type { ReminderAlertLoadDetail } from '../services/reminderAlertLoadEvent';
import type { AlertHistoryEntry } from '@shared/ipc';
import { getRelayRuntime, hasRelayCapability } from '../runtime/relayRuntime';
import { TabCommandBar, TabCommandGroup, TabPageHeader } from '../components/tab-chrome/TabChrome';
import { ALERT_EXPORT_WIDTH_PX, useAlertExport } from './alerts/useAlertExport';
import { useAlertBranding } from './alerts/useAlertBranding';
import { useAlertReminderWorkflow } from './alerts/useAlertReminderWorkflow';
import { useUndoableHistoryDelete } from './alerts/useUndoableHistoryDelete';
import { secureStorage } from '../utils/secureStorage';
import './alerts.css';

/** secureStorage key of the unsent draft, kept on this workstation across reloads. */
const ALERT_DRAFT_STORAGE_KEY = 'alerts-draft';

const ALERT_SEVERITIES = new Set<Severity>(['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED']);
/** Pinned-template severity, spoken before the label; the dot's shape carries it visually. */
const PINNED_SEVERITY_LABEL: Record<Severity, string> = {
  ISSUE: 'Issue',
  MAINTENANCE: 'Maintenance',
  INFO: 'Info',
  RESOLVED: 'Resolved',
};

type AlertsTabProps = {
  loadedReminderAlert?: ReminderAlertLoadDetail | null;
  onLoadedReminderAlertConsumed?: () => void;
};

function normalizeLoadedSeverity(severity: ReminderAlertLoadDetail['severity']): Severity {
  return ALERT_SEVERITIES.has(severity as Severity) ? (severity as Severity) : 'INFO';
}

/** Toast copy for a loaded alert: `Loaded "<first non-blank name>" from <source>`, or the fallback. */
function describeLoadedAlert(
  source: string,
  fallback: string,
  ...names: ReadonlyArray<string | undefined>
): string {
  const name = names.map((candidate) => candidate?.trim()).find(Boolean);
  return name ? `Loaded "${name}" from ${source}` : fallback;
}

/** Loading over a composition keeps it behind the same toast Undo that Reset uses. */
function undoLoadOptions(
  hadComposition: boolean,
  previous: AlertDraftState,
  load: (state: AlertDraftState) => void,
): ToastOptions | undefined {
  if (!hadComposition) return undefined;
  return { action: { label: 'Undo', onClick: () => load(previous) } };
}

function getDraftTooltip(isWebRuntime: boolean, modKeyLabel: string): string {
  return isWebRuntime
    ? `Download an editable EML draft with a crisp inline alert (${modKeyLabel}+Enter)`
    : `Open an editable Outlook draft with a crisp inline alert (${modKeyLabel}+Enter)`;
}

type ReminderStripProps = Readonly<{
  title: string;
  dueMs: number;
  overdue: boolean;
  moreCount: number;
  onOpen: () => void;
}>;

/** Next-alarm strip. Its name leads with the visible label, then the alarm, time and overflow. */
function ReminderStrip({ title, dueMs, overdue, moreCount, onOpen }: ReminderStripProps) {
  const label = overdue ? 'Overdue alarm' : 'Next alarm';
  const time = new Date(dueMs).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const more = moreCount > 0 ? `+${moreCount} more` : '';
  return (
    <button
      type="button"
      className={`alert-reminder-strip alert-reminder-strip--button${overdue ? ' is-overdue' : ''}`}
      aria-label={[`${label}: ${title}`, time, more].filter(Boolean).join(', ')}
      onClick={onOpen}
    >
      <span className="alert-reminder-strip-label">{label}</span>
      <span className="alert-reminder-strip-title">{title}</span>
      <span className="alert-reminder-strip-time">{time}</span>
      {more && <span className="alert-reminder-strip-count">{more}</span>}
    </button>
  );
}

const AlertsTabContent: React.FC<AlertsTabProps> = ({
  loadedReminderAlert = null,
  onLoadedReminderAlertConsumed,
}) => {
  const isWebRuntime = getRelayRuntime().kind === 'web';
  const canCustomizeReminderSound = hasRelayCapability('customReminderSound');
  const { showToast } = useToast();
  const cardRef = useRef<HTMLDivElement>(null);
  const {
    logoDataUrl,
    footerLogoDataUrl,
    setLogo: handleSetLogo,
    removeLogo: handleRemoveLogo,
    setFooterLogo: handleSetFooterLogo,
    removeFooterLogo: handleRemoveFooterLogo,
  } = useAlertBranding(showToast);

  const { state: form, load, reset } = useAlertDraft();
  const {
    severity,
    severityConfirmed,
    subject,
    bodyHtml,
    sender,
    recipient,
    clickThroughUrl,
    updateNumber,
    eventTimeStart,
    eventTimeEnd,
    eventTimeSourceTz,
  } = form;
  // The export buttons stay enabled: an incomplete draft refuses the export, names what is
  // missing in an error toast and focuses the first missing field (see useAlertExport).
  const exportReady = useMemo(
    () => missingAlertExportFields(severityConfirmed, subject, bodyHtml).length === 0,
    [bodyHtml, severityConfirmed, subject],
  );

  const attentionSequenceRef = useRef(0);
  const [attentionRequest, setAttentionRequest] = useState<AlertAttentionRequest | null>(null);
  const historyModal = useModalState();
  const pinPromptModal = useModalState();
  const [pinPromptLabel, setPinPromptLabel] = useState('');

  const {
    history: storedHistory,
    addHistory,
    deleteHistory,
    deleteHistoryEntries,
    pinHistory,
    updateLabel,
  } = useAlertHistory();
  const {
    visibleHistory: history,
    requestDelete: requestHistoryDelete,
    requestClear: requestHistoryClear,
  } = useUndoableHistoryDelete({
    history: storedHistory,
    deleteHistory,
    deleteHistoryEntries,
    addHistory,
    showToast,
  });
  const reminderDraft = useMemo(
    () => ({ severity, subject, bodyHtml, sender }),
    [severity, subject, bodyHtml, sender],
  );
  const {
    pendingReminders,
    completedReminders,
    loading: remindersLoading,
    error: remindersError,
    refetch: refetchReminders,
    markDone,
    dismissReminder,
    reminderModal,
    reminderManagerModal,
    editingReminder,
    nextReminder,
    additionalReminderCount,
    reminderAlarmLabel,
    hasCustomReminderAlarm,
    openNewReminder: openNewReminderModal,
    closeReminder: handleReminderModalClose,
    submitReminder: handleReminderSubmit,
    scheduleFromManager: handleScheduleFromManager,
    editReminder: handleEditReminder,
    chooseAlarmSound: handleChooseReminderAlarmSound,
    resetAlarmSound: handleResetReminderAlarmSound,
  } = useAlertReminderWorkflow({ showToast });

  // Re-render once a minute while an alarm is pending so a due alarm flips to "Overdue"
  // even when nothing else on the tab changes.
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    if (!nextReminder) return;
    setNowMs(Date.now());
    const intervalId = globalThis.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => globalThis.clearInterval(intervalId);
  }, [nextReminder]);
  const nextReminderDueMs = nextReminder
    ? new Date(nextReminder.snoozeUntil || nextReminder.dueAt).getTime()
    : 0;
  const nextReminderOverdue = nextReminder !== undefined && nextReminderDueMs <= nowMs;
  const pinnedTemplates = useMemo(() => history.filter((entry) => entry.pinned), [history]);
  const modKeyLabel = globalThis.api?.platform === 'darwin' ? '⌘' : 'Ctrl';

  const displaySender = sender.trim() || 'IT';
  const displayRecipient = recipient.trim() || DEFAULT_ALERT_RECIPIENT;
  const subjectIsPlaceholder = subject.trim() === '';
  const displaySubject = useMemo(() => {
    const base = subject.trim() || 'Alert Subject';
    return updateNumber > 0 ? `UPDATE #${updateNumber} — ${base}` : base;
  }, [subject, updateNumber]);
  const requestFieldAttention = useCallback((field: AlertAttentionField) => {
    attentionSequenceRef.current += 1;
    setAttentionRequest({
      requestId: attentionSequenceRef.current,
      field,
    });
  }, []);
  const alertHistoryDraft = useMemo(
    () => ({ severity, subject, bodyHtml, sender, recipient }),
    [bodyHtml, recipient, sender, severity, subject],
  );
  const eventTimeStartIso = useMemo(
    () => localToIso(eventTimeStart, eventTimeSourceTz),
    [eventTimeStart, eventTimeSourceTz],
  );
  const eventTimeEndIso = useMemo(
    () => localToIso(eventTimeEnd, eventTimeSourceTz),
    [eventTimeEnd, eventTimeSourceTz],
  );
  // An exported alert lives in History from here on, so the reload-safe copy of the draft is
  // dropped; any further edit stores it again.
  const addExportHistory = useCallback(
    (entry: Parameters<typeof addHistory>[0]) => {
      secureStorage.removeItem(ALERT_DRAFT_STORAGE_KEY);
      return addHistory(entry);
    },
    [addHistory],
  );
  const {
    isCapturing,
    saveImage: handleSaveImage,
    openOutlookDraft: handleOpenOutlookDraft,
  } = useAlertExport({
    cardRef,
    clickThroughUrl,
    displaySubject,
    isWebRuntime,
    historyDraft: alertHistoryDraft,
    severityConfirmed,
    updateNumber,
    eventTimeStart: eventTimeStartIso,
    eventTimeEnd: eventTimeEndIso,
    addHistory: addExportHistory,
    requestFieldAttention,
    showToast,
  });

  useAlertShortcuts({
    blocked: isCapturing,
    onSaveImage: () => void handleSaveImage(),
    onOpenDraft: () => void handleOpenOutlookDraft(),
  });

  // History is only written on Save Image / Open in Outlook / Pin Template, so anything
  // still being composed exists nowhere else. Reset and loading a saved alert both act at once
  // and keep the replaced draft behind a toast Undo.
  // severityConfirmed only records whether the operator touched the default; clicking
  // INFO on a blank form is not content worth keeping.
  const hasComposition = useMemo(
    () =>
      (Object.keys(initialAlertDraftState) as Array<keyof typeof initialAlertDraftState>).some(
        (field) => field !== 'severityConfirmed' && form[field] !== initialAlertDraftState[field],
      ),
    [form],
  );
  // Read through refs so composing does not re-trigger the alarm-load effect below.
  const hasCompositionRef = useRef(hasComposition);
  const formRef = useRef(form);
  useEffect(() => {
    hasCompositionRef.current = hasComposition;
    formRef.current = form;
  }, [form, hasComposition]);

  const loadOverDraft = useCallback(
    (next: AlertDraftState, loadedMessage: string) => {
      const previous = formRef.current;
      const hadComposition = hasCompositionRef.current;
      load(next);
      showToast(loadedMessage, 'success', undoLoadOptions(hadComposition, previous, load));
    },
    [load, showToast],
  );

  const applyReminderAlert = useCallback(
    (detail: ReminderAlertLoadDetail) => {
      const loadedSubject = detail.subject.trim();
      loadOverDraft(
        {
          ...initialAlertDraftState,
          severity: normalizeLoadedSeverity(detail.severity),
          severityConfirmed: ALERT_SEVERITIES.has(detail.severity as Severity),
          subject: loadedSubject,
          bodyHtml: detail.bodyHtml,
          sender: detail.sender.trim(),
        },
        describeLoadedAlert('the alarm', "Loaded the alarm's alert", loadedSubject),
      );
    },
    [loadOverDraft],
  );

  useEffect(() => {
    if (!loadedReminderAlert) return;
    applyReminderAlert(loadedReminderAlert);
    onLoadedReminderAlertConsumed?.();
  }, [applyReminderAlert, loadedReminderAlert, onLoadedReminderAlertConsumed]);

  const handleLoadFromHistory = useCallback(
    (entry: AlertHistoryEntry) => {
      const loadedMessage = describeLoadedAlert(
        'history',
        'Loaded the saved alert',
        entry.label,
        entry.subject,
      );
      loadOverDraft(
        {
          ...initialAlertDraftState,
          severity: entry.severity,
          severityConfirmed: ALERT_SEVERITIES.has(entry.severity),
          subject: entry.subject,
          bodyHtml: entry.bodyHtml,
          sender: entry.sender,
          recipient: entry.recipient ?? '',
        },
        loadedMessage,
      );
    },
    [loadOverDraft],
  );

  // Reset clears at once and keeps the whole draft behind Undo, as Clear Bridge does on Compose.
  // Logos are a persistent branding setting, so Reset never touches them.
  const handleClear = useCallback(() => {
    const previous = form;
    reset();
    const previousSubject = previous.subject.trim();
    showToast(previousSubject ? `Reset "${previousSubject}"` : 'Reset the alert', 'success', {
      action: { label: 'Undo', onClick: () => load(previous) },
    });
  }, [form, load, reset, showToast]);
  useTabCommandRequests({ 'reset-alert': !isCapturing && hasComposition ? handleClear : null });

  const handlePinTemplate = useCallback(() => {
    setPinPromptLabel(subject.trim() || 'Untitled Template');
    pinPromptModal.open();
  }, [subject, pinPromptModal]);

  const handlePinTemplateConfirm = useCallback(async () => {
    pinPromptModal.close();
    const label = pinPromptLabel.trim() || undefined;
    const name = label ?? (subject.trim() || 'this alert');
    try {
      const entry = await addHistory({
        severity,
        subject,
        bodyHtml,
        sender,
        recipient,
        pinned: true,
        label,
      });
      // A null entry was already reported by the history hook with its cause.
      if (entry) {
        showToast(`Pinned "${name}" as a template`, 'success');
      }
    } catch (error) {
      showToast(
        formatFailure({
          what: `Couldn't pin "${name}" as a template`,
          error,
          outcome: 'Your draft is unchanged.',
        }),
        'error',
      );
    }
  }, [
    addHistory,
    severity,
    subject,
    bodyHtml,
    sender,
    recipient,
    pinPromptLabel,
    showToast,
    pinPromptModal,
  ]);

  return (
    <div className="alerts-tab">
      <TabPageHeader
        title="Alerts"
        subtitle="Compose and export"
        metadata={
          <span // NOSONAR - role=status is the live-region pattern; <output> would imply a calculated result.
            className="tab-page-status alerts-page-state"
            role="status"
          >
            {/* Only the ready state is a readout; an incomplete draft is explained when an export
                is attempted, so the live region stays empty until then. */}
            {exportReady && (
              <>
                <span className="tab-page-status__dot alerts-page-state-dot" aria-hidden="true" />
                <span>Draft ready</span>
              </>
            )}
          </span>
        }
      />

      <TabCommandBar ariaLabel="Alert actions">
        <TabCommandGroup kind="utility">
          <TactileButton
            variant="secondary"
            onClick={historyModal.open}
            disabled={isCapturing}
            tooltip="Open alert history"
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            }
          >
            History
          </TactileButton>
          <TactileButton
            variant="secondary"
            className="alerts-reset-action"
            onClick={handleClear}
            disabled={isCapturing || !hasComposition}
            tooltip="Clear the alert you are composing"
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            }
          >
            Reset
          </TactileButton>
        </TabCommandGroup>
        <TabCommandGroup kind="workflow">
          <TactileButton
            variant="secondary"
            className="alerts-save-image-action"
            onClick={() => void handleSaveImage()}
            loading={isCapturing}
            tooltip={`Save a high-resolution PNG image (${modKeyLabel}+S)`}
            aria-keyshortcuts="Control+S Meta+S"
            icon={
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            }
          >
            Save Image
          </TactileButton>
          <TactileButton
            variant="primary"
            onClick={() => void handleOpenOutlookDraft()}
            loading={isCapturing}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            tooltip={getDraftTooltip(isWebRuntime, modKeyLabel)}
            icon={
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="5" width="18" height="14" rx="1" />
                <path d="m3 7 9 6 9-6" />
              </svg>
            }
          >
            {isWebRuntime ? 'Download Draft' : 'Open in Outlook'}
          </TactileButton>
          <AlertActionsMenu
            captureBusy={isCapturing}
            onScheduleAlarm={openNewReminderModal}
            onOpenAlarms={reminderManagerModal.open}
            onPinTemplate={handlePinTemplate}
          />
        </TabCommandGroup>
      </TabCommandBar>

      {nextReminder && (
        <ReminderStrip
          title={nextReminder.title}
          dueMs={nextReminderDueMs}
          overdue={nextReminderOverdue}
          moreCount={additionalReminderCount}
          onOpen={reminderManagerModal.open}
        />
      )}

      {pinnedTemplates.length > 0 && (
        <nav className="alerts-pinned-templates" aria-label="Pinned templates">
          <span className="alerts-pinned-templates-label">Templates</span>
          <ul className="alerts-pinned-templates-list">
            {pinnedTemplates.map((entry) => (
              <li key={entry.id}>
                <Tooltip
                  content={entry.label && entry.subject !== entry.label ? entry.subject : undefined}
                >
                  <button
                    type="button"
                    className="alerts-pinned-template"
                    data-sev={entry.severity}
                    disabled={isCapturing}
                    onClick={() => handleLoadFromHistory(entry)}
                  >
                    <span className="sr-only">{PINNED_SEVERITY_LABEL[entry.severity]}:</span>{' '}
                    {entry.label || entry.subject || 'Untitled template'}
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="alerts-layout">
        <section className="alerts-pane alerts-definition-pane" aria-label="Alert definition">
          <div className="alerts-pane-header">
            <span>Alert definition</span>
            {exportReady && <span className="alerts-readiness-ready">Ready to export</span>}
          </div>
          <AlertForm
            logoDataUrl={logoDataUrl}
            onSetLogo={handleSetLogo}
            onRemoveLogo={handleRemoveLogo}
            footerLogoDataUrl={footerLogoDataUrl}
            onSetFooterLogo={handleSetFooterLogo}
            onRemoveFooterLogo={handleRemoveFooterLogo}
            attentionRequest={attentionRequest}
          />
        </section>
        <section className="alerts-pane alerts-preview-pane" aria-label="Live email preview">
          <div className="alerts-pane-header">
            <span>Live email preview</span>
            <span>{ALERT_EXPORT_WIDTH_PX}px export width</span>
          </div>
          <AlertCard
            cardRef={cardRef}
            severity={severityConfirmed ? severity : null}
            displaySubject={displaySubject}
            subjectIsPlaceholder={subjectIsPlaceholder}
            displaySender={displaySender}
            displayRecipient={displayRecipient}
            bodyHtml={bodyHtml}
            logoDataUrl={logoDataUrl}
            footerLogoDataUrl={footerLogoDataUrl}
            eventTimeStart={eventTimeStartIso}
            eventTimeEnd={eventTimeEndIso}
          />
        </section>
      </div>

      <AlertHistoryModal
        isOpen={historyModal.isOpen}
        onClose={historyModal.close}
        history={history}
        onLoad={handleLoadFromHistory}
        onDelete={requestHistoryDelete}
        onClear={requestHistoryClear}
        onPin={(id, pinned) => pinHistory(id, pinned)}
        onUpdateLabel={(id, label) => void updateLabel(id, label)}
      />
      <AlertReminderModal
        isOpen={reminderModal.isOpen}
        onClose={handleReminderModalClose}
        onSchedule={handleReminderSubmit}
        draft={reminderDraft}
        mode={editingReminder ? 'edit' : 'schedule'}
        reminder={editingReminder}
      />
      <AlertReminderManagerModal
        isOpen={reminderManagerModal.isOpen}
        onClose={reminderManagerModal.close}
        pendingReminders={pendingReminders}
        completedReminders={completedReminders}
        loading={remindersLoading}
        error={remindersError}
        onRetry={() => void refetchReminders()}
        onScheduleNew={handleScheduleFromManager}
        onEdit={handleEditReminder}
        onDone={(id) => void markDone(id)}
        onDismiss={(id) => void dismissReminder(id)}
        alarmSoundLabel={reminderAlarmLabel}
        hasCustomAlarmSound={hasCustomReminderAlarm}
        onChooseAlarmSound={() => void handleChooseReminderAlarmSound()}
        onResetAlarmSound={handleResetReminderAlarmSound}
        canCustomizeAlarmSound={canCustomizeReminderSound}
      />
      <Modal
        isOpen={pinPromptModal.isOpen}
        onClose={pinPromptModal.close}
        variant="confirmation"
        title="Pin template"
        footer={
          <>
            <TactileButton variant="secondary" onClick={pinPromptModal.close}>
              Cancel
            </TactileButton>
            <TactileButton variant="primary" onClick={() => void handlePinTemplateConfirm()}>
              Pin Template
            </TactileButton>
          </>
        }
      >
        <div className="pin-template-form">
          <label className="alerts-field-label" htmlFor="pin-template-name">
            Template name
          </label>
          <input
            id="pin-template-name"
            type="text"
            className="alerts-input"
            maxLength={10000}
            value={pinPromptLabel}
            onChange={(e) => setPinPromptLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handlePinTemplateConfirm();
            }}
          />
        </div>
      </Modal>

      <StatusBar left={<StatusBarLive />} />
    </div>
  );
};

export const AlertsTab: React.FC<AlertsTabProps> = (props) => (
  <AlertDraftProvider storageKey={ALERT_DRAFT_STORAGE_KEY}>
    <AlertsTabContent {...props} />
  </AlertDraftProvider>
);
