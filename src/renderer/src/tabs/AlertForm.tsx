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
  eventTimeStart: string;
  setEventTimeStart: (s: string) => void;
  eventTimeEnd: string;
  setEventTimeEnd: (s: string) => void;
  eventTimeSourceTz: string;
  setEventTimeSourceTz: (s: string) => void;
  logoDataUrl: string | null;
  onSetLogo: () => void;
  onRemoveLogo: () => void;
  footerLogoDataUrl: string | null;
  onSetFooterLogo: () => void;
  onRemoveFooterLogo: () => void;
  isCompact: boolean;
  setIsCompact: (v: boolean) => void;
  isEnhanced: boolean;
  setIsEnhanced: (v: boolean) => void;
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
      eventTimeStart,
      setEventTimeStart,
      eventTimeEnd,
      setEventTimeEnd,
      eventTimeSourceTz,
      setEventTimeSourceTz,
      logoDataUrl,
      onSetLogo,
      onRemoveLogo,
      footerLogoDataUrl,
      onSetFooterLogo,
      onRemoveFooterLogo,
      isCompact,
      setIsCompact,
      isEnhanced,
      setIsEnhanced,
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

          <AlertBodyEditor
            ref={bodyEditorRef}
            setBodyHtml={setBodyHtml}
            isCompact={isCompact}
            setIsCompact={setIsCompact}
            isEnhanced={isEnhanced}
            setIsEnhanced={setIsEnhanced}
          />

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

          {/* Event Time — replaces old timestamp override */}
          <div className="alerts-field">
            <span className="alerts-field-label">
              Event Time <span className="alerts-optional-tag">OPTIONAL</span>
            </span>
            <div className="alerts-event-time-inputs">
              <div className="alerts-event-time-input-group">
                <label className="alerts-event-time-sublabel" htmlFor="alerts-event-time-start">
                  Start
                </label>
                <input
                  id="alerts-event-time-start"
                  type="datetime-local"
                  className="alerts-input alerts-input-datetime"
                  value={eventTimeStart}
                  onChange={(e) => setEventTimeStart(e.target.value)}
                />
              </div>
              <div className="alerts-event-time-input-group">
                <label className="alerts-event-time-sublabel" htmlFor="alerts-event-time-end">
                  End <span className="alerts-optional-tag">OPTIONAL</span>
                </label>
                <input
                  id="alerts-event-time-end"
                  type="datetime-local"
                  className="alerts-input alerts-input-datetime"
                  value={eventTimeEnd}
                  onChange={(e) => setEventTimeEnd(e.target.value)}
                />
              </div>
              <div className="alerts-event-time-input-group">
                <label className="alerts-event-time-sublabel" htmlFor="alerts-event-time-tz">
                  Source TZ
                </label>
                <select
                  id="alerts-event-time-tz"
                  className="alerts-input alerts-event-time-tz"
                  value={eventTimeSourceTz}
                  onChange={(e) => setEventTimeSourceTz(e.target.value)}
                >
                  <option value="America/Chicago">CT (CST/CDT)</option>
                  <option value="America/New_York">ET (EST/EDT)</option>
                  <option value="America/Denver">MT (MST/MDT)</option>
                  <option value="America/Los_Angeles">PT (PST/PDT)</option>
                  <option value="UTC">UTC</option>
                  <option value="Europe/London">GMT/BST</option>
                  <option value="Europe/Berlin">CET/CEST</option>
                  <option value="Asia/Tokyo">JST</option>
                  <option value="Asia/Kolkata">IST</option>
                  <option value="Australia/Sydney">AEST/AEDT</option>
                </select>
              </div>
              {(eventTimeStart || eventTimeEnd) && (
                <button
                  type="button"
                  className="alerts-event-time-clear"
                  onClick={() => {
                    setEventTimeStart('');
                    setEventTimeEnd('');
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            <span className="alerts-event-time-hint">
              Enter times in the source timezone — they&apos;ll display as Central Time on the card
            </span>
          </div>

          <AlertLogoUpload
            logoDataUrl={logoDataUrl}
            onSetLogo={onSetLogo}
            onRemoveLogo={onRemoveLogo}
          />

          {/* Footer Logo — separate upload, shown at original colors */}
          <div className="alerts-field">
            <span className="alerts-field-label">
              Footer Logo <span className="alerts-optional-tag">OPTIONAL</span>
            </span>
            <span className="alerts-field-hint">Shown at original colors in the card footer</span>
            <div className="alerts-logo-controls">
              {footerLogoDataUrl ? (
                <>
                  <img
                    src={footerLogoDataUrl}
                    alt="Footer logo"
                    className="alerts-logo-thumbnail"
                  />
                  <button type="button" className="alerts-logo-action" onClick={onRemoveFooterLogo}>
                    REMOVE
                  </button>
                </>
              ) : (
                <button type="button" className="alerts-logo-action" onClick={onSetFooterLogo}>
                  UPLOAD
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

AlertForm.displayName = 'AlertForm';
