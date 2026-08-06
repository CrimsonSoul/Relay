import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
// html2canvas is dynamically imported on demand to reduce initial bundle size
import { TactileButton } from '../components/TactileButton';
import { ConfirmModal } from '../components/ConfirmModal';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useAlertHistory } from '../hooks/useAlertHistory';
import { useAlertReminders } from '../hooks/useAlertReminders';
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
import { buildAlertOutlookEml, sanitizeAlertClickUrl } from './alertLinks';
import { localToIso } from './alertTimeUtils';
import {
  AlertDraftProvider,
  initialAlertDraftState,
  useAlertDraft,
} from './alerts/AlertDraftContext';
import type { AlertReminderInput, AlertReminderRecord } from '../services/alertReminderService';
import {
  getReminderAlarmLabel,
  hasCustomReminderAlarmSource,
  resetReminderAlarmSource,
  saveReminderAlarmSource,
} from '../services/reminderAlarmSoundService';
import type { ReminderAlertLoadDetail } from '../services/reminderAlertLoadEvent';
import { MAX_IMAGE_DATA_URL_LENGTH, type AlertHistoryEntry } from '@shared/ipc';
import { getRelayRuntime, hasRelayCapability } from '../runtime/relayRuntime';
import { TabCommandBar, TabCommandGroup, TabPageHeader } from '../components/tab-chrome/TabChrome';

const ALERT_EXPORT_WIDTH_PX = 640;
const ALERT_CAPTURE_SCALE = 2;
const ALERT_OUTLOOK_CAPTURE_SCALE = 2;
const ALERT_OUTLOOK_FALLBACK_SCALE = 1;
const ALERT_SEVERITIES = new Set<Severity>(['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED']);

function readCssValue(element: HTMLElement, property: string): string {
  return (
    element.style.getPropertyValue(property).trim() ||
    getComputedStyle(element).getPropertyValue(property).trim()
  );
}

function applySolidColor(element: HTMLElement | null, color: string): void {
  if (!element || !color) return;
  element.style.background = color;
  element.style.backgroundColor = color;
}

function preserveIconOverlapBackground(wrapper: HTMLElement | null): void {
  if (!wrapper) return;
  wrapper.style.background = 'transparent';
  wrapper.style.backgroundColor = '';
  const fill = document.createElement('div');
  fill.className = 'alerts-email-icon-wrapper-fill';
  fill.style.position = 'absolute';
  fill.style.left = '0';
  fill.style.right = '0';
  fill.style.top = '26px';
  fill.style.bottom = '0';
  fill.style.background = '#ffffff';
  fill.style.backgroundColor = '#ffffff';
  fill.style.pointerEvents = 'none';
  fill.style.zIndex = '0';
  wrapper.prepend(fill);
}

function addWhiteIconFill(icon: HTMLElement): void {
  const fill = document.createElement('div');
  fill.className = 'alerts-email-icon-fill';
  fill.style.position = 'absolute';
  fill.style.inset = '0';
  fill.style.borderRadius = '50%';
  fill.style.background = '#ffffff';
  fill.style.backgroundColor = '#ffffff';
  fill.style.pointerEvents = 'none';
  fill.style.zIndex = '0';
  icon.prepend(fill);

  icon.querySelectorAll<HTMLElement>('svg').forEach((svg) => {
    svg.style.position = 'relative';
    svg.style.zIndex = '1';
  });
}

function prepareAlertCaptureClone(clone: HTMLDivElement, source: HTMLDivElement): void {
  clone.style.position = 'fixed';
  clone.style.left = '-9999px';
  clone.style.top = '0';
  clone.style.width = `${ALERT_EXPORT_WIDTH_PX}px`;
  clone.style.minWidth = `${ALERT_EXPORT_WIDTH_PX}px`;
  clone.style.maxWidth = `${ALERT_EXPORT_WIDTH_PX}px`;
  clone.style.zIndex = '-1';
  clone.style.backgroundColor = '#ffffff';

  const bannerColor = readCssValue(source, '--email-banner');
  if (!bannerColor) return;

  clone.style.setProperty('--email-banner', bannerColor);
  clone.style.borderColor = bannerColor;

  applySolidColor(clone.querySelector<HTMLElement>('.alerts-email-severity-header'), bannerColor);
  preserveIconOverlapBackground(clone.querySelector<HTMLElement>('.alerts-email-icon-wrapper'));
  applySolidColor(clone.querySelector<HTMLElement>('.alerts-email-header'), '#ffffff');
  applySolidColor(clone.querySelector<HTMLElement>('.alerts-email-body'), '#ffffff');
  applySolidColor(clone.querySelector<HTMLElement>('.alerts-email-meta'), '#fafafa');
  applySolidColor(clone.querySelector<HTMLElement>('.alerts-email-footer'), '#fafafa');
  const icon = clone.querySelector<HTMLElement>('.alerts-email-icon');
  if (icon) {
    icon.style.position = 'relative';
    icon.style.zIndex = '1';
    icon.style.background = '#ffffff';
    icon.style.backgroundColor = '#ffffff';
    icon.style.borderColor = bannerColor;
    addWhiteIconFill(icon);
  }
}

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

  const [isCapturing, setIsCapturing] = useState(false);
  const optionalAttentionSequenceRef = useRef(0);
  const [optionalAttentionRequest, setOptionalAttentionRequest] =
    useState<AlertOptionalAttentionRequest | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [footerLogoDataUrl, setFooterLogoDataUrl] = useState<string | null>(null);
  const historyModal = useModalState();
  const reminderModal = useModalState();
  const reminderManagerModal = useModalState();
  const [editingReminder, setEditingReminder] = useState<AlertReminderRecord | null>(null);
  const [reminderAlarmLabel, setReminderAlarmLabel] = useState(getReminderAlarmLabel);
  const [hasCustomReminderAlarm, setHasCustomReminderAlarm] = useState(
    hasCustomReminderAlarmSource,
  );
  const pinPromptModal = useModalState();
  const [pinPromptLabel, setPinPromptLabel] = useState('');

  const { history, addHistory, deleteHistory, clearHistory, pinHistory, updateLabel } =
    useAlertHistory();
  const {
    pendingReminders,
    completedReminders,
    loading: remindersLoading,
    error: remindersError,
    refetch: refetchReminders,
    scheduleReminder,
    updateReminder,
    markDone,
    dismissReminder,
  } = useAlertReminders();

  const displaySender = sender.trim() || 'IT';
  const displayRecipient = recipient.trim() || 'All Employees';
  const alertClickHref = useMemo(
    () => sanitizeAlertClickUrl(clickThroughUrl) ?? undefined,
    [clickThroughUrl],
  );
  const requestOptionalFieldAttention = useCallback((field: AlertOptionalField) => {
    optionalAttentionSequenceRef.current += 1;
    setOptionalAttentionRequest({
      requestId: optionalAttentionSequenceRef.current,
      field,
    });
  }, []);
  const nextReminder = pendingReminders[0];
  const additionalReminderCount = Math.max(0, pendingReminders.length - 1);

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

  // Load persisted logo on mount
  useEffect(() => {
    void globalThis.api
      ?.getCompanyLogo()
      .then((url) => {
        if (url) setLogoDataUrl(url);
      })
      .catch(() => {
        // Logo load is best-effort; a missing logo is not an error the user needs to see
      });
  }, []);

  // Load persisted footer logo on mount
  useEffect(() => {
    void globalThis.api
      ?.getFooterLogo()
      .then((url) => {
        if (url) setFooterLogoDataUrl(url);
      })
      .catch(() => {});
  }, []);

  const eventTimeStartIso = useMemo(
    () => localToIso(eventTimeStart, eventTimeSourceTz),
    [eventTimeStart, eventTimeSourceTz],
  );
  const eventTimeEndIso = useMemo(
    () => localToIso(eventTimeEnd, eventTimeSourceTz),
    [eventTimeEnd, eventTimeSourceTz],
  );

  const captureCard = useCallback(
    async (scale = ALERT_CAPTURE_SCALE): Promise<HTMLCanvasElement> => {
      if (!cardRef.current) throw new Error('Card ref not available');
      // Clone the card off-screen so the visible preview never jumps
      const el = cardRef.current;
      const clone = el.cloneNode(true) as HTMLDivElement;
      prepareAlertCaptureClone(clone, el);
      document.body.appendChild(clone);
      try {
        const { default: html2canvas } = await import('html2canvas');
        return await html2canvas(clone, {
          scale,
          useCORS: true,
          backgroundColor: null,
          logging: false,
        });
      } finally {
        clone.remove();
      }
    },
    [],
  );

  const withCapture = useCallback(
    async <T,>(
      action: (dataUrl: string) => Promise<T>,
      scale = ALERT_CAPTURE_SCALE,
    ): Promise<T | null> => {
      setIsCapturing(true);
      try {
        const canvas = await captureCard(scale);
        return await action(canvas.toDataURL('image/png'));
      } catch {
        showToast('Capture failed', 'error');
        return null;
      } finally {
        setIsCapturing(false);
      }
    },
    [captureCard, showToast],
  );

  const prepareOutlookDraftImage = useCallback(async () => {
    let canvas = await captureCard(ALERT_OUTLOOK_CAPTURE_SCALE);
    let dataUrl = canvas.toDataURL('image/png');

    // Inline body images can push a 2x PNG past IPC limits. Preserve the draft
    // path by falling back to a native-size image.
    if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      canvas = await captureCard(ALERT_OUTLOOK_FALLBACK_SCALE);
      dataUrl = canvas.toDataURL('image/png');
    }

    const optimized = await globalThis.api?.optimizeAlertImage?.(dataUrl).catch(() => null);
    return {
      dataUrl: optimized?.success && optimized.data ? optimized.data : dataUrl,
      width: canvas.width,
      height: canvas.height,
    };
  }, [captureCard]);

  const openNewReminderModal = useCallback(() => {
    setEditingReminder(null);
    reminderModal.open();
  }, [reminderModal]);

  const handleSaveImage = useCallback(
    () =>
      withCapture(async (dataUrl) => {
        const slug =
          subject
            .trim()
            .replaceAll(/[^a-z0-9]/gi, '_')
            .toLowerCase()
            .slice(0, 40) || 'alert';
        const result = await globalThis.api?.saveAlertImage(dataUrl, `alert_${slug}.png`);
        if (result?.success) {
          showToast('Saved!', 'success');
          void addHistory({ severity, subject, bodyHtml, sender, recipient });
        } else if (result?.error !== 'Cancelled') {
          showToast(result?.error || 'Save failed', 'error');
        }
      }),
    [withCapture, showToast, subject, addHistory, severity, bodyHtml, sender, recipient],
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

  const handleSetLogo = useCallback(async () => {
    const result = await globalThis.api?.saveCompanyLogo();
    if (result?.success && result.data) {
      setLogoDataUrl(result.data);
      showToast('Logo saved', 'success');
    } else if (result?.error && result.error !== 'Cancelled') {
      showToast(result.error, 'error');
    }
  }, [showToast]);

  const handleRemoveLogo = useCallback(async () => {
    try {
      const result = await globalThis.api?.removeCompanyLogo();
      if (result?.success === false) {
        showToast(result.error || 'Failed to remove logo', 'error');
        return;
      }
      setLogoDataUrl(null);
    } catch {
      showToast('Failed to remove logo', 'error');
    }
  }, [showToast]);

  const handleSetFooterLogo = useCallback(async () => {
    const result = await globalThis.api?.saveFooterLogo();
    if (result?.success && result.data) {
      setFooterLogoDataUrl(result.data);
      showToast('Footer logo saved', 'success');
    } else if (result?.error && result.error !== 'Cancelled') {
      showToast(result.error, 'error');
    }
  }, [showToast]);

  const handleRemoveFooterLogo = useCallback(async () => {
    try {
      const result = await globalThis.api?.removeFooterLogo();
      if (result?.success === false) {
        showToast(result.error || 'Failed to remove footer logo', 'error');
        return;
      }
      setFooterLogoDataUrl(null);
    } catch {
      showToast('Failed to remove footer logo', 'error');
    }
  }, [showToast]);

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

  const displaySubject = useMemo(() => {
    const base = subject.trim() || 'Alert Subject';
    return updateNumber > 0 ? `UPDATE #${updateNumber} — ${base}` : base;
  }, [subject, updateNumber]);

  const handleOpenOutlookDraft = useCallback(async () => {
    if (clickThroughUrl.trim() && !alertClickHref) {
      requestOptionalFieldAttention('clickThroughUrl');
      showToast('Enter a valid HTTP or HTTPS click-through URL', 'error');
      return false;
    }

    setIsCapturing(true);
    try {
      const image = await prepareOutlookDraftImage();
      const content = buildAlertOutlookEml({
        subject: displaySubject,
        imageDataUrl: image.dataUrl,
        imageHref: alertClickHref,
        width: image.width,
        height: image.height,
      });
      const success = await globalThis.api?.saveAndOpenAlertDraft?.(content);
      if (success) {
        showToast(isWebRuntime ? 'Alert draft downloaded' : 'Outlook draft opened', 'success');
        void addHistory({ severity, subject, bodyHtml, sender, recipient });
        return true;
      }
      showToast(
        isWebRuntime ? 'Failed to download alert draft' : 'Failed to open Outlook draft',
        'error',
      );
      return false;
    } catch {
      showToast('Failed to prepare Outlook draft', 'error');
      return false;
    } finally {
      setIsCapturing(false);
    }
  }, [
    clickThroughUrl,
    alertClickHref,
    showToast,
    prepareOutlookDraftImage,
    displaySubject,
    addHistory,
    severity,
    subject,
    bodyHtml,
    sender,
    recipient,
    isWebRuntime,
    requestOptionalFieldAttention,
  ]);

  const reminderDraft = useMemo(
    () => ({
      severity,
      subject,
      bodyHtml,
      sender,
    }),
    [severity, subject, bodyHtml, sender],
  );

  const handleReminderModalClose = useCallback(() => {
    reminderModal.close();
    setEditingReminder(null);
  }, [reminderModal]);

  const handleReminderSubmit = useCallback(
    async (input: AlertReminderInput): Promise<boolean> => {
      if (editingReminder) {
        return await updateReminder(editingReminder.id, {
          title: input.title,
          note: input.note,
          dueAt: input.dueAt,
        });
      }
      return await scheduleReminder(input);
    },
    [editingReminder, scheduleReminder, updateReminder],
  );

  const handleScheduleFromManager = useCallback(() => {
    reminderManagerModal.close();
    openNewReminderModal();
  }, [openNewReminderModal, reminderManagerModal]);

  const handleEditReminder = useCallback(
    (reminder: AlertReminderRecord) => {
      reminderManagerModal.close();
      setEditingReminder(reminder);
      reminderModal.open();
    },
    [reminderManagerModal, reminderModal],
  );

  const refreshReminderAlarmState = useCallback(() => {
    setReminderAlarmLabel(getReminderAlarmLabel());
    setHasCustomReminderAlarm(hasCustomReminderAlarmSource());
  }, []);

  const handleChooseReminderAlarmSound = useCallback(async () => {
    const result = await globalThis.api?.selectReminderSound?.();
    if (result?.success && result.data) {
      if (saveReminderAlarmSource(result.data)) {
        refreshReminderAlarmState();
        showToast('Alarm sound saved', 'success');
      } else {
        showToast('Select an MP3 file', 'error');
      }
    } else if (result?.error && result.error !== 'Cancelled') {
      showToast(result.error, 'error');
    }
  }, [refreshReminderAlarmState, showToast]);

  const handleResetReminderAlarmSound = useCallback(() => {
    resetReminderAlarmSource();
    refreshReminderAlarmState();
    showToast('Alarm sound reset', 'success');
  }, [refreshReminderAlarmState, showToast]);

  return (
    <div className="alerts-tab">
      <TabPageHeader
        context="Alerts"
        title="Operational Alert Utility"
        metadata={
          <span className="alerts-page-meta" role="status" aria-live="polite">
            <span className="alerts-page-state-dot" aria-hidden="true" />
            <span>Draft · {severity}</span>
          </span>
        }
      />

      <TabCommandBar ariaLabel="Alert actions">
        <TabCommandGroup kind="utility">
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
        </TabCommandGroup>
        <TabCommandGroup kind="workflow">
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
            onOpenHistory={historyModal.open}
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
