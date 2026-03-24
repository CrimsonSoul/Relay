import React, { useRef } from 'react';
import type { Severity } from './alertUtils';
import { AlertSeveritySelector } from './alerts/AlertSeveritySelector';
import { AlertBodyEditor } from './alerts/AlertBodyEditor';
import type { AlertBodyEditorHandle } from './alerts/AlertBodyEditor';
import { AlertLogoUpload } from './alerts/AlertLogoUpload';

export interface AlertFormProps {
  severity: Severity;
  setSeverity: (s: Severity) => void;
  subject: string;
  setSubject: (s: string) => void;
  setBodyHtml: (s: string) => void;
  sender: string;
  setSender: (s: string) => void;
  recipient: string;
  setRecipient: (s: string) => void;
  updateNumber: number;
  setUpdateNumber: (n: number) => void;
  customTimestamp: string;
  setCustomTimestamp: (s: string) => void;
  logoDataUrl: string | null;
  onSetLogo: () => void;
  onRemoveLogo: () => void;
}

export interface AlertFormHandle {
  setEditorContent: (html: string) => void;
}

export const AlertForm = React.forwardRef<AlertFormHandle, AlertFormProps>(
  (
    {
      severity,
      setSeverity,
      subject,
      setSubject,
      setBodyHtml,
      sender,
      setSender,
      recipient,
      setRecipient,
      updateNumber,
      setUpdateNumber,
      customTimestamp,
      setCustomTimestamp,
      logoDataUrl,
      onSetLogo,
      onRemoveLogo,
    },
    ref,
  ) => {
    const bodyEditorRef = useRef<AlertBodyEditorHandle>(null);

    React.useImperativeHandle(ref, () => ({
      setEditorContent(html: string) {
        bodyEditorRef.current?.setEditorContent(html);
      },
    }));

    return (
      <div className="alerts-composer">
        <div className="alerts-form-section">
          <AlertSeveritySelector severity={severity} setSeverity={setSeverity} />

          {/* Subject */}
          <div className="alerts-field">
            <label className="alerts-field-label" htmlFor="alerts-subject">
              Subject{' '}
              <span className={`alerts-char-count${subject.length > 80 ? ' warn' : ''}`}>
                {subject.length}
              </span>
            </label>
            <input
              id="alerts-subject"
              type="text"
              className="alerts-input"
              placeholder="e.g. Planned Maintenance — POS Systems Saturday 2AM–4AM CT"
              spellCheck
              maxLength={10000}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <AlertBodyEditor ref={bodyEditorRef} setBodyHtml={setBodyHtml} />

          {/* Sender */}
          <div className="alerts-field">
            <label className="alerts-field-label" htmlFor="alerts-sender">
              Sender / From Name <span className="alerts-optional-tag">OPTIONAL</span>
            </label>
            <input
              id="alerts-sender"
              type="text"
              className="alerts-input"
              placeholder="e.g. IT"
              maxLength={10000}
              value={sender}
              onChange={(e) => setSender(e.target.value)}
            />
          </div>

          {/* Recipient */}
          <div className="alerts-field">
            <label className="alerts-field-label" htmlFor="alerts-recipient">
              To / Recipient <span className="alerts-optional-tag">OPTIONAL</span>
            </label>
            <input
              id="alerts-recipient"
              type="text"
              className="alerts-input"
              placeholder="e.g. All Employees"
              maxLength={10000}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </div>

          {/* Update Number */}
          <div className="alerts-field">
            <span className="alerts-field-label">
              Update Prefix <span className="alerts-optional-tag">OPTIONAL</span>
            </span>
            <div className="alerts-update-controls">
              <button
                type="button"
                className={`alerts-update-toggle${updateNumber > 0 ? ' active' : ''}`}
                onClick={() => setUpdateNumber(updateNumber > 0 ? 0 : 1)}
              >
                {updateNumber > 0 ? 'ON' : 'OFF'}
              </button>
              {updateNumber > 0 && (
                <div className="alerts-update-stepper">
                  <button
                    type="button"
                    className="alerts-stepper-btn"
                    onClick={() => setUpdateNumber(Math.max(1, updateNumber - 1))}
                  >
                    −
                  </button>
                  <span className="alerts-stepper-value">#{updateNumber}</span>
                  <button
                    type="button"
                    className="alerts-stepper-btn"
                    onClick={() => setUpdateNumber(updateNumber + 1)}
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Timestamp Override */}
          <div className="alerts-field">
            <label className="alerts-field-label" htmlFor="alerts-timestamp">
              Date / Time <span className="alerts-optional-tag">OPTIONAL</span>
            </label>
            <div className="alerts-timestamp-controls">
              <input
                id="alerts-timestamp"
                type="datetime-local"
                className={`alerts-input alerts-input-datetime${customTimestamp ? '' : ' is-empty'}`}
                value={customTimestamp}
                onChange={(e) => setCustomTimestamp(e.target.value)}
              />
              {customTimestamp && (
                <button
                  type="button"
                  className="alerts-timestamp-reset"
                  onClick={() => setCustomTimestamp('')}
                  title="Reset to current time"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          <AlertLogoUpload
            logoDataUrl={logoDataUrl}
            onSetLogo={onSetLogo}
            onRemoveLogo={onRemoveLogo}
          />
        </div>
      </div>
    );
  },
);

AlertForm.displayName = 'AlertForm';
