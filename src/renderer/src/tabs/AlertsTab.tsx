import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import html2canvas from 'html2canvas';
import { TactileButton } from '../components/TactileButton';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useAlertHistory } from '../hooks/useAlertHistory';
import { AlertHistoryModal } from './AlertHistoryModal';
import { AlertForm } from './AlertForm';
import { AlertCard } from './AlertCard';
import { sanitizeHtml } from './alertUtils';
import type { Severity } from './alertUtils';
import type { AlertFormHandle } from './AlertForm';
import type { AlertHistoryEntry } from '@shared/ipc';

import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/montserrat/800.css';

export const AlertsTab: React.FC = () => {
  const { showToast } = useToast();
  const cardRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<AlertFormHandle>(null);

  const [severity, setSeverity] = useState<Severity>('INFO');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [sender, setSender] = useState('');
  const [recipient, setRecipient] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [updateNumber, setUpdateNumber] = useState(0); // 0 = off, 1+ = "UPDATE #N"
  const [customTimestamp, setCustomTimestamp] = useState('');
  const [pinPromptOpen, setPinPromptOpen] = useState(false);
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

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (customTimestamp) return;
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, [customTimestamp]);

  const formattedDate = useMemo(() => {
    const date = customTimestamp ? new Date(customTimestamp) : now;
    if (customTimestamp && Number.isNaN(date.getTime())) return 'Invalid date';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }, [customTimestamp, now]);

  const captureCard = useCallback(async (): Promise<HTMLCanvasElement> => {
    if (!cardRef.current) throw new Error('Card ref not available');
    // Force card to render at full width regardless of viewport
    const el = cardRef.current;
    const prev = el.style.minWidth;
    el.style.minWidth = '640px';
    try {
      return await html2canvas(el, {
        scale: 3,
        useCORS: true,
        backgroundColor: null,
        logging: false,
      });
    } finally {
      el.style.minWidth = prev;
    }
  }, []);

  const handleCopyImage = useCallback(async () => {
    setIsCapturing(true);
    try {
      const canvas = await captureCard();
      const dataUrl = canvas.toDataURL('image/png');
      const success = await globalThis.api?.writeClipboardImage(dataUrl);
      if (success) {
        showToast('Image copied — paste into Outlook!', 'success');
        void addHistory({ severity, subject, bodyHtml, sender, recipient });
      } else {
        showToast('Failed to copy image to clipboard', 'error');
      }
    } catch {
      showToast('Capture failed', 'error');
    } finally {
      setIsCapturing(false);
    }
  }, [captureCard, showToast, addHistory, severity, subject, bodyHtml, sender, recipient]);

  const handleSavePNG = useCallback(async () => {
    setIsCapturing(true);
    try {
      const canvas = await captureCard();
      const dataUrl = canvas.toDataURL('image/png');
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
    } catch {
      showToast('Capture failed', 'error');
    } finally {
      setIsCapturing(false);
    }
  }, [captureCard, showToast, subject, addHistory, severity, bodyHtml, sender, recipient]);

  const handleLoadFromHistory = useCallback((entry: AlertHistoryEntry) => {
    setSeverity(entry.severity);
    setSubject(entry.subject);
    const safeBody = sanitizeHtml(entry.bodyHtml);
    setBodyHtml(safeBody);
    formRef.current?.setEditorContent(safeBody);
    setSender(entry.sender);
    setRecipient(entry.recipient ?? '');
    setUpdateNumber(0);
    setCustomTimestamp('');
  }, []);

  const handleClear = useCallback(() => {
    setSeverity('INFO');
    setSubject('');
    setBodyHtml('');
    formRef.current?.setEditorContent('');
    setSender('');
    setRecipient('');
    setUpdateNumber(0);
    setCustomTimestamp('');
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

  const handlePinTemplate = useCallback(() => {
    setPinPromptLabel(subject.trim() || 'Untitled Template');
    setPinPromptOpen(true);
  }, [subject]);

  const handlePinTemplateConfirm = useCallback(async () => {
    setPinPromptOpen(false);
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
  }, [addHistory, severity, subject, bodyHtml, sender, recipient, pinPromptLabel, showToast]);

  const displaySubject = useMemo(() => {
    const base = subject.trim() || 'Alert Subject';
    return updateNumber > 0 ? `UPDATE #${updateNumber} — ${base}` : base;
  }, [subject, updateNumber]);

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
          onClick={() => setHistoryOpen(true)}
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
          customTimestamp={customTimestamp}
          setCustomTimestamp={setCustomTimestamp}
          logoDataUrl={logoDataUrl}
          onSetLogo={handleSetLogo}
          onRemoveLogo={handleRemoveLogo}
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
        />
      </div>

      <AlertHistoryModal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        history={history}
        onLoad={handleLoadFromHistory}
        onDelete={(id) => void deleteHistory(id)}
        onClear={() => void clearHistory()}
        onPin={(id, pinned) => pinHistory(id, pinned)}
        onUpdateLabel={(id, label) => void updateLabel(id, label)}
      />
      <Modal
        isOpen={pinPromptOpen}
        onClose={() => setPinPromptOpen(false)}
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
            <TactileButton variant="ghost" size="sm" onClick={() => setPinPromptOpen(false)}>
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
    </div>
  );
};
