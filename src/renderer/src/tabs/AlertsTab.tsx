import React, { useState, useReducer, useRef, useCallback, useMemo, useEffect } from 'react';
// html2canvas is dynamically imported on demand to reduce initial bundle size
import { TactileButton } from '../components/TactileButton';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useAlertHistory } from '../hooks/useAlertHistory';
import { useAlertReminders } from '../hooks/useAlertReminders';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { useModalState } from '../hooks/useModalState';
import { AlertHistoryModal } from './AlertHistoryModal';
import { AlertReminderModal } from './AlertReminderModal';
import { AlertReminderManagerModal } from './AlertReminderManagerModal';
import { AlertForm } from './AlertForm';
import { AlertCard } from './AlertCard';
import { isAlertMessageComplete, sanitizeHtml } from './alertUtils';
import type { Severity } from './alertUtils';
import { buildAlertOutlookEml, sanitizeAlertClickUrl } from './alertLinks';
import { localToIso } from './alertTimeUtils';
import type { AlertFormHandle } from './AlertForm';
import type { AlertReminderInput, AlertReminderRecord } from '../services/alertReminderService';
import {
  getReminderAlarmLabel,
  hasCustomReminderAlarmSource,
  resetReminderAlarmSource,
  saveReminderAlarmSource,
} from '../services/reminderAlarmSoundService';
import type { ReminderAlertLoadDetail } from '../services/reminderAlertLoadEvent';
import { MAX_IMAGE_DATA_URL_LENGTH, type AlertHistoryEntry } from '@shared/ipc';

import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';

const ALERT_EXPORT_WIDTH_PX = 640;
const ALERT_CAPTURE_SCALE = 2;
const ALERT_OUTLOOK_CAPTURE_SCALE = 2;
const ALERT_OUTLOOK_FALLBACK_SCALE = 1;
const ALERT_SEVERITIES: readonly Severity[] = ['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED'];

interface AlertFormState {
  severity: Severity;
  subject: string;
  bodyHtml: string;
  sender: string;
  recipient: string;
  clickThroughUrl: string;
  updateNumber: number;
  eventTimeStart: string;
  eventTimeEnd: string;
  eventTimeSourceTz: string;
}

type AlertFormAction =
  | { type: 'SET_FIELD'; field: keyof AlertFormState; value: AlertFormState[keyof AlertFormState] }
  | { type: 'RESET' }
  | { type: 'LOAD_HISTORY'; entry: AlertHistoryEntry };

const initialFormState: AlertFormState = {
  severity: 'INFO',
  subject: '',
  bodyHtml: '',
  sender: '',
  recipient: '',
  clickThroughUrl: '',
  updateNumber: 0,
  eventTimeStart: '',
  eventTimeEnd: '',
  eventTimeSourceTz: 'America/Chicago',
};

function formReducer(state: AlertFormState, action: AlertFormAction): AlertFormState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'RESET':
      return initialFormState;
    case 'LOAD_HISTORY':
      return {
        ...initialFormState,
        severity: action.entry.severity,
        subject: action.entry.subject,
        bodyHtml: sanitizeHtml(action.entry.bodyHtml),
        sender: action.entry.sender,
        recipient: action.entry.recipient ?? '',
      };
    default:
      return state;
  }
}

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
  return ALERT_SEVERITIES.includes(severity as Severity) ? (severity as Severity) : 'INFO';
}

export const AlertsTab: React.FC<AlertsTabProps> = ({
  loadedReminderAlert = null,
  onLoadedReminderAlertConsumed,
}) => {
  const { showToast } = useToast();
  const cardRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<AlertFormHandle>(null);

  const [form, dispatch] = useReducer(formReducer, initialFormState);
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

  const setSeverity = useCallback(
    (v: Severity) => dispatch({ type: 'SET_FIELD', field: 'severity', value: v }),
    [],
  );
  const setSubject = useCallback(
    (v: string) => dispatch({ type: 'SET_FIELD', field: 'subject', value: v }),
    [],
  );
  const setBodyHtml = useCallback(
    (v: string) => dispatch({ type: 'SET_FIELD', field: 'bodyHtml', value: v }),
    [],
  );
  const setSender = useCallback(
    (v: string) => dispatch({ type: 'SET_FIELD', field: 'sender', value: v }),
    [],
  );
  const setRecipient = useCallback(
    (v: string) => dispatch({ type: 'SET_FIELD', field: 'recipient', value: v }),
    [],
  );
  const setClickThroughUrl = useCallback(
    (v: string) => dispatch({ type: 'SET_FIELD', field: 'clickThroughUrl', value: v }),
    [],
  );
  const setUpdateNumber = useCallback(
    (v: number) => dispatch({ type: 'SET_FIELD', field: 'updateNumber', value: v }),
    [],
  );
  const setEventTimeStart = useCallback(
    (v: string) => dispatch({ type: 'SET_FIELD', field: 'eventTimeStart', value: v }),
    [],
  );
  const setEventTimeEnd = useCallback(
    (v: string) => dispatch({ type: 'SET_FIELD', field: 'eventTimeEnd', value: v }),
    [],
  );
  const setEventTimeSourceTz = useCallback(
    (v: string) => dispatch({ type: 'SET_FIELD', field: 'eventTimeSourceTz', value: v }),
    [],
  );
  const [isCapturing, setIsCapturing] = useState(false);
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
  const nextReminder = pendingReminders[0];
  const additionalReminderCount = Math.max(0, pendingReminders.length - 1);

  useEffect(() => {
    if (!loadedReminderAlert) return;

    const nextBodyHtml = sanitizeHtml(loadedReminderAlert.bodyHtml);
    dispatch({
      type: 'SET_FIELD',
      field: 'severity',
      value: normalizeLoadedSeverity(loadedReminderAlert.severity),
    });
    dispatch({ type: 'SET_FIELD', field: 'subject', value: loadedReminderAlert.subject.trim() });
    dispatch({ type: 'SET_FIELD', field: 'bodyHtml', value: nextBodyHtml });
    dispatch({ type: 'SET_FIELD', field: 'sender', value: loadedReminderAlert.sender.trim() });
    dispatch({ type: 'SET_FIELD', field: 'recipient', value: '' });
    dispatch({ type: 'SET_FIELD', field: 'clickThroughUrl', value: '' });
    dispatch({ type: 'SET_FIELD', field: 'updateNumber', value: 0 });
    formRef.current?.setEditorContent(nextBodyHtml);
    showToast('Alert loaded from alarm', 'success');
    onLoadedReminderAlertConsumed?.();
  }, [loadedReminderAlert, onLoadedReminderAlertConsumed, showToast]);

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

  const handleLoadFromHistory = useCallback((entry: AlertHistoryEntry) => {
    dispatch({ type: 'LOAD_HISTORY', entry });
    formRef.current?.setEditorContent(sanitizeHtml(entry.bodyHtml));
  }, []);

  const handleClear = useCallback(() => {
    dispatch({ type: 'RESET' });
    formRef.current?.setEditorContent('');
    // logoDataUrl is intentionally NOT cleared — it's a persistent setting
  }, []);

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
        showToast('Outlook draft opened', 'success');
        void addHistory({ severity, subject, bodyHtml, sender, recipient });
        return true;
      }
      showToast('Failed to open Outlook draft', 'error');
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
      <header className="alerts-page-header">
        <div>
          <div className="alerts-page-context">Alerts</div>
          <h2 className="alerts-page-title">Operational alert composer</h2>
        </div>
        <div className="alerts-page-meta" role="status" aria-live="polite">
          <span className="alerts-page-state-dot" aria-hidden="true" />
          <span>Draft · {severity}</span>
        </div>
      </header>

      <div className="alerts-command-bar" role="toolbar" aria-label="Alert actions">
        <CollapsibleHeader>
          <div className="alerts-command-group alerts-command-group--utility">
            <TactileButton
              variant="secondary"
              className="alerts-utility-action"
              onClick={handleClear}
              tooltip="Reset alert composer"
              icon={
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M23 4v6h-6" />
                  <path d="M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              }
            >
              RESET
            </TactileButton>
            <TactileButton
              variant="secondary"
              className="alerts-utility-action"
              onClick={historyModal.open}
              tooltip="Open alert history"
              icon={
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              }
            >
              HISTORY
            </TactileButton>
            <TactileButton
              variant="secondary"
              className="alerts-utility-action"
              onClick={reminderManagerModal.open}
              tooltip="View and manage alarms"
              icon={
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="13" r="7" />
                  <path d="M12 10v3l2 2" />
                  <path d="M5 3 2.5 5.5" />
                  <path d="m19 3 2.5 2.5" />
                  <path d="m6.5 19.5-1.5 2" />
                  <path d="m17.5 19.5 1.5 2" />
                </svg>
              }
            >
              ALARMS
            </TactileButton>
            <TactileButton
              variant="secondary"
              className="alerts-utility-action"
              onClick={handlePinTemplate}
              tooltip="Pin current alert as a template"
              icon={
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 17v5" />
                  <path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v1a1 1 0 001 1 1 1 0 011 1z" />
                </svg>
              }
            >
              PIN TEMPLATE
            </TactileButton>
            <TactileButton
              variant="secondary"
              className="alerts-utility-action"
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
              SAVE IMAGE
            </TactileButton>
          </div>
          <div className="alerts-command-group alerts-command-group--primary">
            <TactileButton
              variant="secondary"
              onClick={openNewReminderModal}
              tooltip="Schedule an alarm for this alert"
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
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M8 3v4" />
                  <path d="M16 3v4" />
                  <path d="M3 10h18" />
                  <path d="M12 13v5" />
                  <path d="M9.5 15.5h5" />
                </svg>
              }
            >
              SCHEDULE ALARM
            </TactileButton>
            <TactileButton
              variant="primary"
              onClick={() => void handleOpenOutlookDraft()}
              loading={isCapturing}
              tooltip="Open an editable Outlook draft with a crisp inline alert"
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
              OPEN IN OUTLOOK
            </TactileButton>
          </div>
        </CollapsibleHeader>
      </div>

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
            ref={formRef}
            severity={severity}
            setSeverity={setSeverity}
            subject={subject}
            setSubject={setSubject}
            bodyHtml={bodyHtml}
            setBodyHtml={setBodyHtml}
            sender={sender}
            setSender={setSender}
            recipient={recipient}
            setRecipient={setRecipient}
            clickThroughUrl={clickThroughUrl}
            setClickThroughUrl={setClickThroughUrl}
            updateNumber={updateNumber}
            setUpdateNumber={setUpdateNumber}
            eventTimeStart={eventTimeStart}
            setEventTimeStart={setEventTimeStart}
            eventTimeEnd={eventTimeEnd}
            setEventTimeEnd={setEventTimeEnd}
            eventTimeSourceTz={eventTimeSourceTz}
            setEventTimeSourceTz={setEventTimeSourceTz}
            logoDataUrl={logoDataUrl}
            onSetLogo={handleSetLogo}
            onRemoveLogo={handleRemoveLogo}
            footerLogoDataUrl={footerLogoDataUrl}
            onSetFooterLogo={handleSetFooterLogo}
            onRemoveFooterLogo={handleRemoveFooterLogo}
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
      />
      <Modal
        isOpen={pinPromptModal.isOpen}
        onClose={pinPromptModal.close}
        title="Pin Template"
        width="400px"
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
          <div className="pin-template-actions">
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
          </div>
        </div>
      </Modal>

      <StatusBar left={<StatusBarLive />} right={<span>Alert Composer</span>} />
    </div>
  );
};
