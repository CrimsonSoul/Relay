import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
// html2canvas is dynamically imported on demand to reduce initial bundle size
import { TactileButton } from '../components/TactileButton';
import { ConfirmModal } from '../components/ConfirmModal';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useAlertHistory } from '../hooks/useAlertHistory';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { useModalState } from '../hooks/useModalState';
import { AlertHistoryModal } from './AlertHistoryModal';
import { AlertReminderModal } from './AlertReminderModal';
import { AlertReminderManagerModal } from './AlertReminderManagerModal';
import {
  AlertForm,
  type AlertOptionalAttentionRequest,
  type AlertOptionalField,
} from './AlertForm';
import { AlertCard } from './AlertCard';
import { AlertActionsMenu } from './alerts/AlertActionsMenu';
import { isAlertMessageComplete } from './alertUtils';
import type { Severity } from './alertUtils';
import { localToIso } from './alertTimeUtils';
import {
  AlertDraftProvider,
  initialAlertDraftState,
  useAlertDraft,
} from './alerts/AlertDraftContext';
import type { ReminderAlertLoadDetail } from '../services/reminderAlertLoadEvent';
import type { AlertHistoryEntry } from '@shared/ipc';
import { getRelayRuntime, hasRelayCapability } from '../runtime/relayRuntime';
import { TabCommandBar, TabCommandGroup, TabPageHeader } from '../components/tab-chrome/TabChrome';
import { ALERT_EXPORT_WIDTH_PX, useAlertExport } from './alerts/useAlertExport';
import { useAlertBranding } from './alerts/useAlertBranding';
import { useAlertReminderWorkflow } from './alerts/useAlertReminderWorkflow';
import './alerts.css';

const ALERT_SEVERITIES = new Set<Severity>(['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED']);

type AlertsTabProps = {
  loadedReminderAlert?: ReminderAlertLoadDetail | null;
  onLoadedReminderAlertConsumed?: () => void;
};

function normalizeLoadedSeverity(severity: ReminderAlertLoadDetail['severity']): Severity {
  return ALERT_SEVERITIES.has(severity as Severity) ? (severity as Severity) : 'INFO';
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
  const requiredStepsReady = isAlertMessageComplete(subject, bodyHtml) ? 2 : 1;

  const optionalAttentionSequenceRef = useRef(0);
  const [optionalAttentionRequest, setOptionalAttentionRequest] =
    useState<AlertOptionalAttentionRequest | null>(null);
  const historyModal = useModalState();
  const pinPromptModal = useModalState();
  const [pinPromptLabel, setPinPromptLabel] = useState('');

  const { history, addHistory, deleteHistory, clearHistory, pinHistory, updateLabel } =
    useAlertHistory();
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
  } = useAlertReminderWorkflow({ draft: reminderDraft, showToast });

  const displaySender = sender.trim() || 'IT';
  const displayRecipient = recipient.trim() || 'All Employees';
  const displaySubject = useMemo(() => {
    const base = subject.trim() || 'Alert Subject';
    return updateNumber > 0 ? `UPDATE #${updateNumber} — ${base}` : base;
  }, [subject, updateNumber]);
  const requestOptionalFieldAttention = useCallback((field: AlertOptionalField) => {
    optionalAttentionSequenceRef.current += 1;
    setOptionalAttentionRequest({
      requestId: optionalAttentionSequenceRef.current,
      field,
    });
  }, []);
  const alertHistoryDraft = useMemo(
    () => ({ severity, subject, bodyHtml, sender, recipient }),
    [bodyHtml, recipient, sender, severity, subject],
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
    addHistory,
    requestOptionalFieldAttention,
    showToast,
  });

  // History is only written on Save Image / Open in Outlook / Pin Template, so anything
  // still being composed exists nowhere else. Both destructive paths — RESET and loading
  // an alert off an alarm — have to ask before discarding it.
  const hasComposition = useMemo(
    () =>
      (Object.keys(initialAlertDraftState) as Array<keyof typeof initialAlertDraftState>).some(
        (field) => form[field] !== initialAlertDraftState[field],
      ),
    [form],
  );
  const hasCompositionRef = useRef(hasComposition);
  useEffect(() => {
    hasCompositionRef.current = hasComposition;
  }, [hasComposition]);

  const resetConfirmModal = useModalState();
  const [pendingReminderAlert, setPendingReminderAlert] = useState<ReminderAlertLoadDetail | null>(
    null,
  );

  const clearComposition = useCallback(() => {
    reset();
    // logoDataUrl is intentionally NOT cleared — it's a persistent setting
  }, [reset]);

  const applyReminderAlert = useCallback(
    (detail: ReminderAlertLoadDetail) => {
      load((currentState) => ({
        ...currentState,
        severity: normalizeLoadedSeverity(detail.severity),
        subject: detail.subject.trim(),
        bodyHtml: detail.bodyHtml,
        sender: detail.sender.trim(),
        recipient: '',
        clickThroughUrl: '',
        updateNumber: 0,
      }));
      showToast('Alert loaded from alarm', 'success');
    },
    [load, showToast],
  );

  useEffect(() => {
    if (!loadedReminderAlert) return;

    // Read the dirty flag through a ref so composing does not re-trigger this effect
    if (hasCompositionRef.current) {
      setPendingReminderAlert(loadedReminderAlert);
    } else {
      applyReminderAlert(loadedReminderAlert);
    }
    onLoadedReminderAlertConsumed?.();
  }, [applyReminderAlert, loadedReminderAlert, onLoadedReminderAlertConsumed]);

  const eventTimeStartIso = useMemo(
    () => localToIso(eventTimeStart, eventTimeSourceTz),
    [eventTimeStart, eventTimeSourceTz],
  );
  const eventTimeEndIso = useMemo(
    () => localToIso(eventTimeEnd, eventTimeSourceTz),
    [eventTimeEnd, eventTimeSourceTz],
  );

  const handleLoadFromHistory = useCallback(
    (entry: AlertHistoryEntry) => {
      load({
        ...initialAlertDraftState,
        severity: entry.severity,
        subject: entry.subject,
        bodyHtml: entry.bodyHtml,
        sender: entry.sender,
        recipient: entry.recipient ?? '',
      });
    },
    [load],
  );

  const handleClear = useCallback(() => {
    // RESET sits right next to HISTORY and there is no undo, so an unexported
    // composition only goes away after the operator says so.
    if (hasComposition) {
      resetConfirmModal.open();
      return;
    }
    clearComposition();
  }, [clearComposition, hasComposition, resetConfirmModal]);

  const handleConfirmReset = useCallback(() => {
    resetConfirmModal.close();
    clearComposition();
  }, [clearComposition, resetConfirmModal]);

  const handleConfirmLoadReminderAlert = useCallback(() => {
    if (pendingReminderAlert) applyReminderAlert(pendingReminderAlert);
    setPendingReminderAlert(null);
  }, [applyReminderAlert, pendingReminderAlert]);

  const handlePinTemplate = useCallback(() => {
    setPinPromptLabel(subject.trim() || 'Untitled Template');
    pinPromptModal.open();
  }, [subject, pinPromptModal]);

  const handlePinTemplateConfirm = useCallback(async () => {
    pinPromptModal.close();
    try {
      const entry = await addHistory({
        severity,
        subject,
        bodyHtml,
        sender,
        recipient,
        pinned: true,
        label: pinPromptLabel.trim() || undefined,
      });
      if (entry) {
        showToast('Pinned as template', 'success');
      }
    } catch {
      showToast('Failed to pin template', 'error');
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
        context="Alerts"
        title="Operational Alert Utility"
        metadata={
          <span className="tab-page-status" role="status" aria-live="polite">
            <span className="tab-page-status__dot alerts-page-state-dot" aria-hidden="true" />
            <span>Draft · {severity}</span>
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
        </TabCommandGroup>
        <TabCommandGroup kind="workflow">
          <TactileButton
            variant="secondary"
            className="alerts-save-image-action"
            onClick={handleSaveImage}
            loading={isCapturing}
            tooltip="Save a high-resolution PNG image"
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
            tooltip={
              isWebRuntime
                ? 'Download an editable EML draft with a crisp inline alert'
                : 'Open an editable Outlook draft with a crisp inline alert'
            }
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
            onReset={handleClear}
          />
        </TabCommandGroup>
      </TabCommandBar>

      {nextReminder && (
        <button
          type="button"
          className="alert-reminder-strip alert-reminder-strip--button"
          aria-label="Upcoming alert alarms"
          onClick={reminderManagerModal.open}
        >
          <span className="alert-reminder-strip-label">Next alarm</span>
          <span className="alert-reminder-strip-title">{nextReminder.title}</span>
          <span className="alert-reminder-strip-time">
            {new Date(nextReminder.snoozeUntil || nextReminder.dueAt).toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
          {additionalReminderCount > 0 && (
            <span className="alert-reminder-strip-count">+{additionalReminderCount} more</span>
          )}
        </button>
      )}

      <div className="alerts-layout">
        <section className="alerts-pane alerts-definition-pane" aria-label="Alert definition">
          <div className="alerts-pane-header">
            <span>Alert definition</span>
            <span>{requiredStepsReady} of 2 required ready</span>
          </div>
          <AlertForm
            logoDataUrl={logoDataUrl}
            onSetLogo={handleSetLogo}
            onRemoveLogo={handleRemoveLogo}
            footerLogoDataUrl={footerLogoDataUrl}
            onSetFooterLogo={handleSetFooterLogo}
            onRemoveFooterLogo={handleRemoveFooterLogo}
            attentionRequest={optionalAttentionRequest}
          />
        </section>
        <section className="alerts-pane alerts-preview-pane" aria-label="Live email preview">
          <div className="alerts-pane-header">
            <span>Live email preview</span>
            <span>
              {severity} · {ALERT_EXPORT_WIDTH_PX}px
            </span>
          </div>
          <AlertCard
            cardRef={cardRef}
            severity={severity}
            displaySubject={displaySubject}
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
        onDelete={(id) => void deleteHistory(id)}
        onClear={() => void clearHistory()}
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
      <ConfirmModal
        isOpen={resetConfirmModal.isOpen}
        onClose={resetConfirmModal.close}
        onConfirm={handleConfirmReset}
        title="Reset Alert"
        message="Discard this alert? The severity, subject, body, recipients, and event times are cleared, and an alert that has not been saved or opened in Outlook cannot be recovered."
        confirmLabel="Discard Alert"
        isDanger
      />

      <ConfirmModal
        isOpen={pendingReminderAlert !== null}
        onClose={() => setPendingReminderAlert(null)}
        onConfirm={handleConfirmLoadReminderAlert}
        title="Load Alert From Alarm"
        message={`Load "${pendingReminderAlert?.subject.trim() || 'the stored alert'}"? This overwrites the alert you are composing, which cannot be recovered.`}
        confirmLabel="Load Alert"
        isDanger
      />

      <Modal
        isOpen={pinPromptModal.isOpen}
        onClose={pinPromptModal.close}
        variant="confirmation"
        title="Pin Template"
        footer={
          <>
            <TactileButton variant="ghost" size="sm" onClick={pinPromptModal.close}>
              CANCEL
            </TactileButton>
            <TactileButton
              variant="primary"
              size="sm"
              onClick={() => void handlePinTemplateConfirm()}
            >
              PIN
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
            autoFocus
          />
        </div>
      </Modal>

      <StatusBar left={<StatusBarLive />} right={<span>Alert Utility</span>} />
    </div>
  );
};

export const AlertsTab: React.FC<AlertsTabProps> = (props) => (
  <AlertDraftProvider>
    <AlertsTabContent {...props} />
  </AlertDraftProvider>
);
