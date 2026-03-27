import React, { useState, useReducer, useRef, useCallback, useMemo, useEffect } from 'react';
// html2canvas is dynamically imported on demand to reduce initial bundle size
import { TactileButton } from '../components/TactileButton';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useAlertHistory } from '../hooks/useAlertHistory';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { useModalState } from '../hooks/useModalState';
import { AlertHistoryModal } from './AlertHistoryModal';
import { AlertForm } from './AlertForm';
import { AlertCard } from './AlertCard';
import { sanitizeHtml } from './alertUtils';
import type { Severity } from './alertUtils';
import { compactText } from './alerts/compactEngine';
import { enhanceHtml } from './alerts/enhanceEngine';
import type { AlertFormHandle } from './AlertForm';
import type { AlertHistoryEntry } from '@shared/ipc';

import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/montserrat/800.css';

interface AlertFormState {
  severity: Severity;
  subject: string;
  bodyHtml: string;
  sender: string;
  recipient: string;
  updateNumber: number;
  eventTimeStart: string;
  eventTimeEnd: string;
  eventTimeSourceTz: string;
  isCompact: boolean;
  isEnhanced: boolean;
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
  updateNumber: 0,
  eventTimeStart: '',
  eventTimeEnd: '',
  eventTimeSourceTz: 'America/Chicago',
  isCompact: false,
  isEnhanced: false,
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

export const AlertsTab: React.FC = () => {
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
    updateNumber,
    eventTimeStart,
    eventTimeEnd,
    eventTimeSourceTz,
    isCompact,
    isEnhanced,
  } = form;

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
  const setIsCompact = useCallback(
    (v: boolean) => dispatch({ type: 'SET_FIELD', field: 'isCompact', value: v }),
    [],
  );
  const setIsEnhanced = useCallback(
    (v: boolean) => dispatch({ type: 'SET_FIELD', field: 'isEnhanced', value: v }),
    [],
  );

  const [isCapturing, setIsCapturing] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [footerLogoDataUrl, setFooterLogoDataUrl] = useState<string | null>(null);
  const historyModal = useModalState();
  const originalBodyRef = useRef<string | null>(null);
  const pinPromptModal = useModalState();
  const [pinPromptLabel, setPinPromptLabel] = useState('');

  const { history, addHistory, deleteHistory, clearHistory, pinHistory, updateLabel } =
    useAlertHistory();

  const displaySender = sender.trim() || 'IT';
  const displayRecipient = recipient.trim() || 'All Employees';

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

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  const formattedDate = useMemo(() => {
    return (
      now.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'America/Chicago',
      }) +
      ' · ' +
      now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Chicago',
      })
    );
  }, [now]);

  function localToIso(datetimeLocal: string, sourceTz: string): string {
    if (!datetimeLocal) return '';
    const systemLocal = new Date(datetimeLocal);
    if (Number.isNaN(systemLocal.getTime())) return '';
    const inSourceTz = new Date(systemLocal.toLocaleString('en-US', { timeZone: sourceTz }));
    const offsetMs = systemLocal.getTime() - inSourceTz.getTime();
    return new Date(systemLocal.getTime() + offsetMs).toISOString();
  }

  const eventTimeStartIso = useMemo(
    () => localToIso(eventTimeStart, eventTimeSourceTz),
    [eventTimeStart, eventTimeSourceTz],
  );
  const eventTimeEndIso = useMemo(
    () => localToIso(eventTimeEnd, eventTimeSourceTz),
    [eventTimeEnd, eventTimeSourceTz],
  );

  const captureCard = useCallback(async (): Promise<HTMLCanvasElement> => {
    if (!cardRef.current) throw new Error('Card ref not available');
    // Clone the card off-screen so the visible preview never jumps
    const el = cardRef.current;
    const clone = el.cloneNode(true) as HTMLDivElement;
    clone.style.position = 'fixed';
    clone.style.left = '-9999px';
    clone.style.top = '0';
    clone.style.minWidth = '700px';
    clone.style.maxWidth = '700px';
    clone.style.zIndex = '-1';
    document.body.appendChild(clone);
    try {
      const { default: html2canvas } = await import('html2canvas');
      return await html2canvas(clone, {
        scale: 3,
        useCORS: true,
        backgroundColor: null,
        logging: false,
      });
    } finally {
      document.body.removeChild(clone);
    }
  }, []);

  /** Shared capture wrapper: captures the card as a PNG data URL, manages loading state, and handles errors. */
  const withCapture = useCallback(
    async (action: (dataUrl: string) => Promise<void>) => {
      setIsCapturing(true);
      try {
        const hiRes = await captureCard();
        // Step-downsample 3x → 1.5x → 1x for sharper text than a single jump
        const halfW = Math.round(hiRes.width / 2);
        const halfH = Math.round(hiRes.height / 2);
        const mid = document.createElement('canvas');
        mid.width = halfW;
        mid.height = halfH;
        const midCtx = mid.getContext('2d')!;
        midCtx.imageSmoothingEnabled = true;
        midCtx.imageSmoothingQuality = 'high';
        midCtx.drawImage(hiRes, 0, 0, halfW, halfH);

        const finalW = Math.round(hiRes.width / 3);
        const finalH = Math.round(hiRes.height / 3);
        const canvas = document.createElement('canvas');
        canvas.width = finalW;
        canvas.height = finalH;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(mid, 0, 0, finalW, finalH);
        const dataUrl = canvas.toDataURL('image/png');
        await action(dataUrl);
      } catch {
        showToast('Capture failed', 'error');
      } finally {
        setIsCapturing(false);
      }
    },
    [captureCard, showToast],
  );

  const handleCopyImage = useCallback(
    () =>
      withCapture(async (dataUrl) => {
        const success = await globalThis.api?.writeClipboardImage(dataUrl);
        if (success) {
          showToast('Image copied — paste into Outlook!', 'success');
          void addHistory({ severity, subject, bodyHtml, sender, recipient });
        } else {
          showToast('Failed to copy image to clipboard', 'error');
        }
      }),
    [withCapture, showToast, addHistory, severity, subject, bodyHtml, sender, recipient],
  );

  const handleSavePNG = useCallback(
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
    originalBodyRef.current = null;
  }, []);

  const handleClear = useCallback(() => {
    dispatch({ type: 'RESET' });
    formRef.current?.setEditorContent('');
    originalBodyRef.current = null;
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

  /**
   * Apply compact rules to HTML while preserving markup (including data-hl spans).
   */
  function compactHtml(html: string): string {
    // eslint-disable-next-line sonarjs/slow-regex -- splitting on HTML tags; input is sanitized, no ReDoS risk
    const parts = html.split(/(<[^>]*>)/g);
    return parts
      .map((part) => {
        if (part.startsWith('<')) return part;
        return compactText(part);
      })
      .join('');
  }

  const applyTransforms = useCallback((html: string, compact: boolean, enhanced: boolean) => {
    let result = sanitizeHtml(html);
    if (compact) result = compactHtml(result);
    if (enhanced) result = enhanceHtml(result);
    return result;
  }, []);

  const handleToggleCompact = useCallback(() => {
    const nextCompact = !isCompact;
    if (!nextCompact && !isEnhanced) {
      // Both off — restore original
      const original = originalBodyRef.current ?? bodyHtml;
      originalBodyRef.current = null;
      setBodyHtml(original);
      formRef.current?.setEditorContent(original);
    } else {
      // Save original if first toggle on
      if (originalBodyRef.current === null) originalBodyRef.current = bodyHtml;
      const transformed = applyTransforms(originalBodyRef.current, nextCompact, isEnhanced);
      setBodyHtml(transformed);
      formRef.current?.setEditorContent(transformed);
    }
    setIsCompact(nextCompact);
  }, [isCompact, isEnhanced, bodyHtml, applyTransforms, setBodyHtml, setIsCompact]);

  const handleToggleEnhanced = useCallback(() => {
    const nextEnhanced = !isEnhanced;
    if (!isCompact && !nextEnhanced) {
      // Both off — restore original
      const original = originalBodyRef.current ?? bodyHtml;
      originalBodyRef.current = null;
      setBodyHtml(original);
      formRef.current?.setEditorContent(original);
    } else {
      // Save original if first toggle on
      if (originalBodyRef.current === null) originalBodyRef.current = bodyHtml;
      const transformed = applyTransforms(originalBodyRef.current, isCompact, nextEnhanced);
      setBodyHtml(transformed);
      formRef.current?.setEditorContent(transformed);
    }
    setIsEnhanced(nextEnhanced);
  }, [isCompact, isEnhanced, bodyHtml, applyTransforms, setBodyHtml, setIsEnhanced]);

  return (
    <div className="alerts-tab">
      <CollapsibleHeader>
        <TactileButton
          variant="ghost"
          onClick={handleClear}
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
          variant="ghost"
          onClick={historyModal.open}
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
          variant="ghost"
          onClick={handlePinTemplate}
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
          variant="ghost"
          onClick={handleSavePNG}
          loading={isCapturing}
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
          SAVE PNG
        </TactileButton>
        <TactileButton
          variant="primary"
          onClick={handleCopyImage}
          loading={isCapturing}
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
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          }
        >
          COPY FOR OUTLOOK
        </TactileButton>
      </CollapsibleHeader>

      <div className="alerts-layout">
        {/* Left Panel — Composer */}
        <AlertForm
          ref={formRef}
          severity={severity}
          setSeverity={setSeverity}
          subject={subject}
          setSubject={setSubject}
          setBodyHtml={setBodyHtml}
          sender={sender}
          setSender={setSender}
          recipient={recipient}
          setRecipient={setRecipient}
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
          isCompact={isCompact}
          onToggleCompact={handleToggleCompact}
          isEnhanced={isEnhanced}
          onToggleEnhanced={handleToggleEnhanced}
        />

        {/* Right Panel — Preview */}
        <AlertCard
          cardRef={cardRef}
          severity={severity}
          displaySubject={displaySubject}
          displaySender={displaySender}
          displayRecipient={displayRecipient}
          formattedDate={formattedDate}
          bodyHtml={bodyHtml}
          logoDataUrl={logoDataUrl}
          footerLogoDataUrl={footerLogoDataUrl}
          eventTimeStart={eventTimeStartIso}
          eventTimeEnd={eventTimeEndIso}
        />
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
